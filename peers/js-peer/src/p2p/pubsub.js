import { gossipsub } from '@libp2p/gossipsub';

import {
  EVENT_GRAFT,
  EVENT_PRUNE,
  EVENT_RECEIVED,
  EVENT_REJECTED,
  GOSSIPSUB_OPTIONS,
  REASON_DECODE,
  SAMPLE_INTERVAL_MS,
} from '../constants.js';
import { captureDelivery, captureRejected, gossipsubMetricsRegister, setMeshPeers, setTopicPeers } from '../metrics.js';
import { nowMicros } from '../utils/clock.js';
import { decodeMessage } from '../utils/message.js';
import { specMessageId } from './message-id.js';

/**
 * Returns the GossipSub service for the libp2p node:
 * - the settings of the Go peer where the defaults of the two implementations differ;
 * - the message ID of the pubsub spec, the same as the Go peer (see message-id.js),
 *   with each ID passed to the duplicate counter;
 * - the internal metrics of the library sent to the gs_* metrics that they feed.
 *
 * @param {string} topic - the topic of the testbed
 * @param {import('./message-id.js').DuplicateCounter} duplicates - counts the duplicate copies
 * @returns {Function} the service factory for the services option of createLibp2p
 */
export function gossipsubService(topic, duplicates) {
  return gossipsub({
    ...GOSSIPSUB_OPTIONS,
    msgIdFn: (msg) => {
      const id = specMessageId(msg);
      duplicates.observe(id, msg.data);
      return id;
    },
    metricsRegister: gossipsubMetricsRegister(),
    metricsTopicStrToLabel: new Map([[topic, topic]]),
  });
}

/**
 * The GossipSub part of the peer: one topic. It publishes to the topic, logs
 * and counts each unique delivery, logs the mesh changes, and samples the
 * topic and mesh peer counts.
 */
export class Gossip {
  /** @type {import('@libp2p/gossipsub').GossipSub} */
  #pubsub;
  /** @type {string} */
  #topic;
  /** @type {import('./peer-names.js').PeerNames} */
  #names;
  /** @type {import('pino').Logger} */
  #logger;
  /** @type {(event: CustomEvent) => void} */
  #onMessage;
  /** @type {(event: CustomEvent) => void} */
  #onGraft;
  /** @type {(event: CustomEvent) => void} */
  #onPrune;
  /** @type {NodeJS.Timeout | undefined} samples the topic and mesh peer counts */
  #sampler;

  /**
   * @param {import('@libp2p/gossipsub').GossipSub} pubsub - the GossipSub service of the node
   * @param {string} topic - the topic of the testbed
   * @param {import('./peer-names.js').PeerNames} names - peer ID -> peer name, for the source and remote fields
   * @param {import('pino').Logger} logger - logger of the peer
   */
  constructor(pubsub, topic, names, logger) {
    this.#pubsub = pubsub;
    this.#topic = topic;
    this.#names = names;
    this.#logger = logger;
    this.#onMessage = (event) => this.#handle(event.detail, nowMicros());
    this.#onGraft = (event) => this.#logMesh(EVENT_GRAFT, event.detail);
    this.#onPrune = (event) => this.#logMesh(EVENT_PRUNE, event.detail);
  }

  /** Subscribes to the topic and starts the logging and the sampling. */
  start() {
    this.#pubsub.addEventListener('gossipsub:message', this.#onMessage);
    this.#pubsub.addEventListener('gossipsub:graft', this.#onGraft);
    this.#pubsub.addEventListener('gossipsub:prune', this.#onPrune);
    this.#pubsub.subscribe(this.#topic);
    this.#sampler = setInterval(() => this.#sample(), SAMPLE_INTERVAL_MS);
  }

  /**
   * Stops the logging and the sampling. It does not leave the topic: leaving
   * sends a PRUNE to each mesh peer, and a PRUNE makes the peers refuse this
   * peer ID in their mesh for the prune backoff (1 minute). A restarted pod
   * has the same name and so the same peer ID, and would stay out of the
   * meshes for that minute (seen on the cluster). The node closes the
   * connections when it stops; a closed connection sets no backoff.
   */
  stop() {
    clearInterval(this.#sampler);
    this.#pubsub.removeEventListener('gossipsub:message', this.#onMessage);
    this.#pubsub.removeEventListener('gossipsub:graft', this.#onGraft);
    this.#pubsub.removeEventListener('gossipsub:prune', this.#onPrune);
  }

  /**
   * Publishes one encoded message to the topic.
   *
   * @param {Uint8Array} data - the encoded message
   * @returns {Promise<void>}
   */
  async publish(data) {
    await this.#pubsub.publish(this.#topic, data);
  }

  /** @returns {number} the number of peers that are subscribed to the topic */
  topicPeers() {
    return this.#pubsub.getSubscribers(this.#topic).length;
  }

  /**
   * Records one delivery. gossipsub:message fires only for the first copy of
   * each message, after validation, and not for the messages of this peer, so
   * each call is a unique delivery; this is the same point as the
   * subscription of the Go peer. The latency is the receive time minus the
   * publication timestamp, exact only when the two peers share one clock.
   *
   * @param {{ propagationSource: import('@libp2p/interface').PeerId, msg: { topic: string, data: Uint8Array } }} detail - the event
   * @param {number} receivedAtUs - receive time, Unix microseconds
   */
  #handle({ propagationSource, msg }, receivedAtUs) {
    if (msg.topic !== this.#topic) {
      return;
    }

    const source = this.#names.name(propagationSource);

    let decoded;
    try {
      decoded = decodeMessage(msg.data);
    } catch (err) {
      captureRejected(REASON_DECODE);
      this.#logger.warn({ reason: REASON_DECODE, source, error: err.message }, EVENT_REJECTED);
      return;
    }

    const latencyUs = receivedAtUs - decoded.ts_us;

    captureDelivery(decoded.run_id, decoded.publisher, source, latencyUs / 1e6);
    this.#logger.info(
      { run_id: decoded.run_id, publisher: decoded.publisher, seq: decoded.seq, latency_us: latencyUs, source },
      EVENT_RECEIVED,
    );
  }

  /**
   * Logs a mesh change of the topic of the testbed.
   *
   * @param {string} event - graft or prune
   * @param {{ peerId: import('@libp2p/interface').PeerId, topic: string }} detail - the event
   */
  #logMesh(event, { peerId, topic }) {
    if (topic === this.#topic) {
      this.#logger.info({ remote: this.#names.name(peerId) }, event);
    }
  }

  /**
   * Sets gs_topic_peers and gs_mesh_peers. @libp2p/gossipsub has no event for
   * a subscription change, and not every mesh change has an event, so both
   * counts are sampled.
   */
  #sample() {
    setTopicPeers(this.topicPeers());
    setMeshPeers(this.#pubsub.getMeshPeers(this.#topic).length);
  }
}
