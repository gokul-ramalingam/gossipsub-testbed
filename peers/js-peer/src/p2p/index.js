import { readFileSync } from 'node:fs';

import { EVENT_STARTED, GOSSIPSUB_OPTIONS, YAMUX_KEEPALIVE_MS } from '../constants.js';
import { formatDuration } from '../utils/duration.js';
import { watchConnections } from './connection-events.js';
import { Discovery } from './discovery.js';
import { createHost } from './host.js';
import { peerId, privateKey } from './identity.js';
import { DuplicateCounter } from './message-id.js';
import { PeerNames } from './peer-names.js';
import { Gossip, gossipsubService } from './pubsub.js';

/** Dependency versions from package.json, for the started event. */
const DEPENDENCIES = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).dependencies;

/**
 * @typedef {object} ConnectedPeer
 * @property {string} name - peer name, or the short peer ID if unknown
 * @property {string} peer_id - libp2p peer ID
 * @property {string[]} addrs - remote address of each connection
 */

/** The p2p layer: libp2p node, discovery, connection events and GossipSub. */
export class P2PServer {
  /** @type {import('libp2p').Libp2p} */
  #node;
  /** @type {PeerNames} */
  #names;
  /** @type {Discovery} */
  #discovery;
  /** @type {Gossip} */
  #gossip;
  /** @type {Readonly<import('../config.js').Config>} */
  #config;
  /** @type {import('pino').Logger} */
  #logger;
  /** @type {(() => void) | undefined} */
  #unwatch;

  /**
   * Use createP2PServer.
   *
   * @param {import('libp2p').Libp2p} node - libp2p node, not started
   * @param {PeerNames} names - peer names
   * @param {Readonly<import('../config.js').Config>} config - settings of the peer
   * @param {import('pino').Logger} logger - logger of the peer
   */
  constructor(node, names, config, logger) {
    this.#node = node;
    this.#names = names;
    this.#config = config;
    this.#logger = logger;
    this.#discovery = new Discovery(node, names, config, logger);
    this.#gossip = new Gossip(node.services.pubsub, config.topic, names, logger);
  }

  /** @returns {import('@libp2p/interface').PeerId} the peer ID of this peer */
  get peerId() {
    return this.#node.peerId;
  }

  /** Starts the node, the topic and the discovery, and logs the started event. */
  async start() {
    this.#unwatch = watchConnections(this.#node, this.#names, this.#logger);
    await this.#node.start();
    this.#gossip.start();
    this.#discovery.start();
    this.#logStarted();
  }

  /** Stops the discovery and the node. */
  async stop() {
    this.#discovery.stop();
    this.#gossip.stop();
    await this.#node.stop();
    this.#unwatch?.();
  }

  /**
   * Publishes one encoded message to the topic.
   *
   * @param {Uint8Array} data - encoded message
   * @returns {Promise<void>}
   */
  async publish(data) {
    await this.#gossip.publish(data);
  }

  /** @returns {number} the number of peers subscribed to the topic */
  topicPeers() {
    return this.#gossip.topicPeers();
  }

  /**
   * Returns the connected peers, sorted by name.
   *
   * @returns {ConnectedPeer[]} the connected peers
   */
  connectedPeers() {
    const peers = this.#node.getPeers().map((id) => ({
      name: this.#names.name(id),
      peer_id: id.toString(),
      addrs: this.#node.getConnections(id).map((conn) => withoutPeerId(conn.remoteAddr.toString())),
    }));

    return peers.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Logs the started event: addresses, versions and settings. */
  #logStarted() {
    this.#logger.info(
      {
        addrs: this.#node.getMultiaddrs().map((addr) => withoutPeerId(addr.toString())),
        node_version: process.version,
        libp2p_version: DEPENDENCIES.libp2p,
        pubsub_version: DEPENDENCIES['@libp2p/gossipsub'],
        topic: this.#config.topic,
        discovery: this.#config.discovery,
        redial_interval: formatDuration(this.#config.redialIntervalMs),
        yamux_keepalive: formatDuration(YAMUX_KEEPALIVE_MS),
        mesh_d: GOSSIPSUB_OPTIONS.D,
        mesh_dlo: GOSSIPSUB_OPTIONS.Dlo,
        mesh_dhi: GOSSIPSUB_OPTIONS.Dhi,
        mesh_dlazy: GOSSIPSUB_OPTIONS.Dlazy,
        mesh_dout: GOSSIPSUB_OPTIONS.Dout,
      },
      EVENT_STARTED,
    );
  }
}

/**
 * Removes the /p2p/<peer ID> suffix, so that addresses match the Go peer.
 *
 * @param {string} addr - the address
 * @returns {string} the address without the suffix
 */
const withoutPeerId = (addr) => {
  return addr.replace(/\/p2p\/[^/]+$/, '');
};

/**
 * Returns the p2p layer for config. The node listens only after start.
 *
 * @param {Readonly<import('../config.js').Config>} config - settings of the peer
 * @param {import('pino').Logger} logger - logger of the peer
 * @returns {Promise<P2PServer>} the p2p layer, not started
 */
export const createP2PServer = async (config, logger) => {
  const node = await createHost(await privateKey(config.keySeed, config.peerName), config.p2pPort, {
    pubsub: gossipsubService(config.topic, new DuplicateCounter(logger)),
  });

  const names = new PeerNames();
  names.add(node.peerId, config.peerName);

  // Name the static peers now, so that the first connection events show their names.
  for (const target of config.peers) {
    names.add(await peerId(config.keySeed, target.name), target.name);
  }

  return new P2PServer(node, names, config, logger);
};

/**
 * Returns the peer ID of this peer, before the node starts.
 *
 * @param {Readonly<import('../config.js').Config>} config - settings of the peer
 * @returns {Promise<import('@libp2p/interface').PeerId>} the peer ID
 */
export const localPeerId = async (config) => {
  return peerId(config.keySeed, config.peerName);
};
