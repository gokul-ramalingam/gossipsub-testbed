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

/** Exact versions of the dependencies, from package.json, for the started event. */
const DEPENDENCIES = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).dependencies;

/**
 * One remote peer that this peer is connected to. The peer ID is in each
 * address, so it has no field of its own (as in the Go peer).
 *
 * @typedef {object} ConnectedPeer
 * @property {string} name - peer name, or the short peer ID if the peer is unknown
 * @property {string[]} addrs - full remote address of each connection, with /p2p/<peer ID>; a pair can have two
 */

/**
 * The p2p layer of the peer: the libp2p node, the discovery that connects it
 * to the other peers, the connection events, and GossipSub on the topic of the
 * testbed.
 */
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
  /** @type {(() => void) | undefined} stops the connection events */
  #unwatch;

  /**
   * Use createP2PServer.
   *
   * @param {import('libp2p').Libp2p} node - the libp2p node, not started
   * @param {PeerNames} names - peer ID -> peer name
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

  /** Starts the node, the connection events, the topic and the discovery, and logs the started event. */
  async start() {
    this.#unwatch = watchConnections(this.#node, this.#names, this.#logger);
    await this.#node.start();
    this.#gossip.start();
    this.#discovery.start();
    this.#logStarted();
  }

  /** Stops the discovery, leaves the topic, stops the node and closes all connections. */
  async stop() {
    this.#discovery.stop();
    this.#gossip.stop();
    await this.#node.stop();
    this.#unwatch?.();
  }

  /**
   * Publishes one encoded message to the topic.
   *
   * @param {Uint8Array} data - the encoded message
   * @returns {Promise<void>}
   */
  async publish(data) {
    await this.#gossip.publish(data);
  }

  /** @returns {number} the number of peers that are subscribed to the topic */
  topicPeers() {
    return this.#gossip.topicPeers();
  }

  /**
   * Returns the peers that this peer is connected to, sorted by name, with the
   * remote address of each connection.
   *
   * @returns {ConnectedPeer[]} the connected peers
   */
  connectedPeers() {
    const peers = this.#node.getPeers().map((id) => ({
      name: this.#names.name(id),
      // The full address of each connection, with /p2p/<peer ID>, as /connections of the Go peer.
      addrs: this.#node.getConnections(id).map((conn) => withPeerId(conn.remoteAddr.toString(), id.toString())),
    }));

    return peers.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Writes the started event: the peer name to peer ID mapping, the versions and the settings. */
  #logStarted() {
    this.#logger.info(
      {
        // Without the /p2p/<peer ID> suffix, as in the started event of the Go peer.
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
 * Returns the address with /p2p/<peer ID> at its end. js-libp2p writes the
 * peer ID in the remote address of a connection that this peer dialed, but
 * not of an incoming one.
 *
 * @param {string} addr - the remote address
 * @param {string} peerId - peer ID of the remote peer
 * @returns {string} the full address
 */
function withPeerId(addr, peerId) {
  return addr.endsWith(`/p2p/${peerId}`) ? addr : `${addr}/p2p/${peerId}`;
}

/**
 * Removes the /p2p/<peer ID> suffix of an address, so that the listen
 * addresses of the started event have the form of the Go peer.
 *
 * @param {string} addr - the address
 * @returns {string} the address without the suffix
 */
function withoutPeerId(addr) {
  return addr.replace(/\/p2p\/[^/]+$/, '');
}

/**
 * Returns the p2p layer with the settings of config. The node listens only
 * after start.
 *
 * @param {Readonly<import('../config.js').Config>} config - settings of the peer
 * @param {import('pino').Logger} logger - logger of the peer
 * @returns {Promise<P2PServer>} the p2p layer, not started
 */
export async function createP2PServer(config, logger) {
  const node = await createHost(await privateKey(config.keySeed, config.peerName), config.p2pPort, {
    pubsub: gossipsubService(config.topic, new DuplicateCounter(logger)),
  });

  const names = new PeerNames();
  names.add(node.peerId, config.peerName);

  // Static peers are known before any connection, so that the first
  // connection events already name them.
  for (const target of config.peers) {
    names.add(await peerId(config.keySeed, target.name), target.name);
  }

  return new P2PServer(node, names, config, logger);
}

/**
 * Returns the peer ID of this peer from its name and the key seed. It is known
 * before the node starts, so that the logger can write it on every line.
 *
 * @param {Readonly<import('../config.js').Config>} config - settings of the peer
 * @returns {Promise<import('@libp2p/interface').PeerId>} the peer ID
 */
export async function localPeerId(config) {
  return peerId(config.keySeed, config.peerName);
}
