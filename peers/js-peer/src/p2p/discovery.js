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

/**
 * Finds the other peers and dials each one that is not connected, once at
 * start and then every redial interval. The targets are the PEERS list or the
 * answers of the SRV lookup of _p2p._tcp.<SRV_NAME>. The peer ID of each
 * target is computed from its name, as in the Go peer.
 */
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
  /** @type {AbortController | undefined} stops the loop */
  #stop;

  /**
   * @param {import('libp2p').Libp2p} node - the node that dials
   * @param {import('./peer-names.js').PeerNames} names - filled with the name of each target
   * @param {Readonly<import('../config.js').Config>} config - discovery mode, SRV name, peers, redial interval
   * @param {import('pino').Logger} logger - logger of the peer
   */
  constructor(node, names, config, logger) {
    this.#node = node;
    this.#names = names;
    this.#config = config;
    this.#logger = logger;
  }

  /** Starts the loop in the background: one round at once, then one every redial interval. */
  start() {
    this.#stop = new AbortController();
    this.#loop(this.#stop.signal);
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
      await this.#round(signal);

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
    let targets;
    try {
      targets = await this.#targets();
    } catch (err) {
      this.#logger.warn({ error: err.message }, EVENT_DISCOVERY_FAILED);
      return;
    }

    for (const target of targets) {
      if (target.name === this.#config.peerName || signal.aborted) {
        continue;
      }

      let id;
      try {
        id = await peerId(this.#config.keySeed, target.name);
      } catch (err) {
        this.#logger.error({ remote: target.name, error: err.message }, EVENT_PEER_ID_FAILED);
        continue;
      }

      this.#names.add(id, target.name);

      if (this.#node.getConnections(id).length > 0) {
        continue;
      }

      this.#dial(target, id);
    }
  }

  /**
   * Dials one peer in the background. It returns at once if a dial to the peer is in progress.
   *
   * @param {import('../utils/peers.js').Target} target - name and address of the peer
   * @param {import('@libp2p/interface').PeerId} id - peer ID of the peer
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
 * Resolves _p2p._tcp.<srvName>. Each answer is the hostname of one peer, such
 * as "js-1.peers.dst.svc.cluster.local", and the first label of the hostname
 * is the peer name.
 *
 * @param {string} srvName - DNS name of the SRV lookup
 * @returns {Promise<import('../utils/peers.js').Target[]>} the targets
 */
export async function lookupSrv(srvName) {
  const records = await resolveSrv(`_p2p._tcp.${srvName}`);

  return records.map((record) => srvTarget(record.name, record.port));
}

/**
 * Converts one SRV answer into a target: the peer name and a /dns4 address.
 *
 * @param {string} hostname - target of the SRV record
 * @param {number} port - port of the SRV record
 * @returns {import('../utils/peers.js').Target} the target
 */
export function srvTarget(hostname, port) {
  const host = hostname.replace(/\.$/, '');

  return { name: host.split('.')[0], addr: multiaddr(`/dns4/${host}/tcp/${port}`) };
}
