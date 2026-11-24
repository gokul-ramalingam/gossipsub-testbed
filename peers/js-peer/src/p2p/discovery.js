import { resolveSrv } from 'node:dns/promises';
import { setTimeout as sleep } from 'node:timers/promises';

import { multiaddr } from '@multiformats/multiaddr';

import {
  DIAL_TIMEOUT_MS,
  DISCOVERY_STATIC,
  EVENT_DIAL_FAILED,
  EVENT_DISCOVERY_FAILED,
  EVENT_PEER_ID_FAILED,
} from '../constants.js';
import { peerId } from './identity.js';

/** Finds the other peers and dials each one that is not connected, every redial interval. */
export class Discovery {
  /** @type {import('libp2p').Libp2p} */
  #node;
  /** @type {import('./peer-names.js').PeerNames} */
  #names;
  /** @type {Readonly<import('../config.js').Config>} */
  #config;
  /** @type {import('pino').Logger} */
  #logger;
  /** @type {Set<string>} peer IDs with a dial in progress */
  #inflight = new Set();
  /** @type {AbortController | undefined} */
  #stop;

  /**
   * @param {import('libp2p').Libp2p} node - the node that dials
   * @param {import('./peer-names.js').PeerNames} names - peer names, filled for each target
   * @param {Readonly<import('../config.js').Config>} config - settings of the peer
   * @param {import('pino').Logger} logger - logger of the peer
   */
  constructor(node, names, config, logger) {
    this.#node = node;
    this.#names = names;
    this.#config = config;
    this.#logger = logger;
  }

  /** Starts the loop in the background. */
  start() {
    this.#stop = new AbortController();
    void this.#loop(this.#stop.signal);
  }

  /** Stops the loop. Dials in progress end with their timeout. */
  stop() {
    this.#stop?.abort();
  }

  /**
   * Runs the rounds until signal is aborted.
   *
   * @param {AbortSignal} signal - aborted by stop
   */
  async #loop(signal) {
    while (!signal.aborted) {
      // A failed round does not end the loop.
      try {
        await this.#round(signal);
      } catch (err) {
        this.#logger.warn({ error: err.message }, EVENT_DISCOVERY_FAILED);
      }

      try {
        await sleep(this.#config.redialIntervalMs, undefined, { signal });
      } catch {
        return; // stopped
      }
    }
  }

  /**
   * Finds the targets and starts a dial to each one that is not connected.
   *
   * @param {AbortSignal} signal - aborted by stop
   */
  async #round(signal) {
    const targets = await this.#targets(); // an error ends the round; #loop logs it

    for (const target of targets) {
      if (target.name === this.#config.peerName || signal.aborted) {
        continue;
      }

      const id = await this.#peerId(target.name);
      if (!id) {
        continue;
      }

      this.#names.add(id, target.name);

      if (this.#node.getConnections(id).length > 0) {
        continue;
      }

      void this.#dial(target, id); // in the background; #dial handles its own errors
    }
  }

  /**
   * Derives the peer ID of a peer from its name.
   *
   * @param {string} name - peer name
   * @returns {Promise<import('@libp2p/interface').PeerId | undefined>} the peer ID; undefined on error
   */
  async #peerId(name) {
    try {
      return await peerId(this.#config.keySeed, name);
    } catch (err) {
      this.#logger.error({ remote: name, error: err.message }, EVENT_PEER_ID_FAILED);
      return undefined;
    }
  }

  /**
   * Dials one peer, unless a dial to it is in progress.
   *
   * @param {import('../utils/peers.js').Target} target - the peer
   * @param {import('@libp2p/interface').PeerId} id - its peer ID
   */
  async #dial(target, id) {
    const key = id.toString();
    if (this.#inflight.has(key)) {
      return;
    }

    this.#inflight.add(key);

    try {
      await this.#node.dial(target.addr.encapsulate(`/p2p/${key}`), { signal: AbortSignal.timeout(DIAL_TIMEOUT_MS) });
    } catch (err) {
      this.#logger.debug({ remote: target.name, addr: target.addr.toString(), error: err.message }, EVENT_DIAL_FAILED);
    } finally {
      this.#inflight.delete(key);
    }
  }

  /**
   * Returns the peers to dial: the static list, or the answers of the SRV lookup.
   *
   * @returns {Promise<ReadonlyArray<import('../utils/peers.js').Target>>} the targets
   */
  async #targets() {
    if (this.#config.discovery === DISCOVERY_STATIC) {
      return this.#config.peers;
    }

    return lookupSrv(this.#config.srvName);
  }
}

/**
 * Resolves _p2p._tcp.<srvName> into targets.
 *
 * @param {string} srvName - DNS name of the SRV lookup
 * @returns {Promise<import('../utils/peers.js').Target[]>} the targets
 */
export const lookupSrv = async (srvName) => {
  const records = await resolveSrv(`_p2p._tcp.${srvName}`);

  return records.map((record) => srvTarget(record.name, record.port));
};

/**
 * Converts one SRV answer into a target. The first label of the hostname is the peer name.
 *
 * @param {string} hostname - target of the SRV record
 * @param {number} port - port of the SRV record
 * @returns {import('../utils/peers.js').Target} the target
 */
export const srvTarget = (hostname, port) => {
  const host = hostname.replace(/\.$/, '');

  return { name: host.split('.')[0], addr: multiaddr(`/dns4/${host}/tcp/${port}`) };
};
