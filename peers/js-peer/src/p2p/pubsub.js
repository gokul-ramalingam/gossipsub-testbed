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
 * Returns the GossipSub service with the settings and the message ID of the Go peer.
 *
 * @param {string} topic - topic of the testbed
 * @param {import('./message-id.js').DuplicateCounter} duplicates - counts the duplicate copies
 * @returns {Function} the service factory for createLibp2p
 */
export const gossipsubService = (topic, duplicates) => {
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
};

/** Publishes to the topic, and logs and counts the deliveries and the mesh changes. */
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
  /** @type {NodeJS.Timeout | undefined} */
  #sampler;

  /**
   * @param {import('@libp2p/gossipsub').GossipSub} pubsub - GossipSub service of the node
   * @param {string} topic - topic of the testbed
   * @param {import('./peer-names.js').PeerNames} names - peer names
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
   * Stops the logging and the sampling. It does not leave the topic: a PRUNE
   * keeps a restarted peer out of the meshes for the 1-minute backoff.
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
   * @param {Uint8Array} data - encoded message
   * @returns {Promise<void>}
   */
  async publish(data) {
    await this.#pubsub.publish(this.#topic, data);
  }

  /** @returns {number} the number of peers subscribed to the topic */
  topicPeers() {
    return this.#pubsub.getSubscribers(this.#topic).length;
  }

  /**
   * Logs and counts one delivery. The event fires only for the first copy of a message.
   *
   * @param {{ propagationSource: import('@libp2p/interface').PeerId, msg: { topic: string, data: Uint8Array } }} detail - the event
   * @param {number} receivedAtUs - receive time, Unix microseconds
   */
  #handle({ propagationSource, msg }, receivedAtUs) {
    if (msg.topic !== this.#topic) {
      return;
    }

    const source = this.#names.name(propagationSource);

    const decoded = this.#decode(msg.data, source);
    if (!decoded) {
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
   * Decodes a delivered message, or logs and counts it as rejected.
   *
   * @param {Uint8Array} data - message data
   * @param {string} source - peer that sent the message
   * @returns {ReturnType<typeof decodeMessage> | undefined} the message; undefined if rejected
   */
  #decode(data, source) {
    try {
      return decodeMessage(data);
    } catch (err) {
      captureRejected(REASON_DECODE);
      this.#logger.warn({ reason: REASON_DECODE, source, error: err.message }, EVENT_REJECTED);
      return undefined;
    }
  }

  /**
   * Logs a mesh change of the topic.
   *
   * @param {string} event - graft or prune
   * @param {{ peerId: import('@libp2p/interface').PeerId, topic: string }} detail - the event
   */
  #logMesh(event, { peerId, topic }) {
    if (topic === this.#topic) {
      this.#logger.info({ remote: this.#names.name(peerId) }, event);
    }
  }

  /** Sets the topic and mesh peer gauges. The library has no event for each change. */
  #sample() {
    setTopicPeers(this.topicPeers());
    setMeshPeers(this.#pubsub.getMeshPeers(this.#topic).length);
  }
}
