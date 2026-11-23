import { DISCOVERY_SRV, DISCOVERY_STATIC } from './constants.js';
import { ConfigError } from './errors.js';
import { parseDuration } from './utils/duration.js';
import { parsePeers } from './utils/peers.js';

/**
 * Settings of the peer, from environment variables. The names, defaults and
 * checks are the same as in the Go peer (env/env.go).
 */

/** Defaults of the settings that are not set. A setting without a default is empty. */
const DEFAULTS = Object.freeze({
  HTTP_PORT: '8080',
  P2P_PORT: '4001',
  KEY_SEED: 'gossipsub-testbed',
  TOPIC: 'gossipsub-testbed',
  DISCOVERY: DISCOVERY_STATIC,
  REDIAL_INTERVAL: '5s',
  LOG_LEVEL: 'info',
});

/**
 * @typedef {object} Config
 * @property {string} peerName - name of this peer, for example js-0 (PEER_NAME, required)
 * @property {number} httpPort - port of the HTTP API (HTTP_PORT)
 * @property {number} p2pPort - libp2p TCP port (P2P_PORT)
 * @property {string} keySeed - seed of the peer keys, the same on all peers (KEY_SEED)
 * @property {string} topic - GossipSub topic of the testbed (TOPIC)
 * @property {string} discovery - static (the PEERS list) or srv (a DNS SRV lookup) (DISCOVERY)
 * @property {string} srvName - DNS name of the SRV lookup, required for srv (SRV_NAME)
 * @property {ReadonlyArray<import('./utils/peers.js').Target>} peers - peers of the static discovery (PEERS)
 * @property {number} redialIntervalMs - time between two discovery rounds, in milliseconds (REDIAL_INTERVAL)
 * @property {string} logLevel - debug, info, warn or error (LOG_LEVEL)
 */

/**
 * Reads and checks all settings once at start. An empty variable counts as not set.
 *
 * @param {Record<string, string | undefined>} [env] - the environment; process.env by default
 * @returns {Readonly<Config>} the checked settings
 * @throws {ConfigError} if a setting is invalid; the message names the setting
 */
export function loadConfig(env = process.env) {
  /**
   * Returns the value of a setting, or its default if it is not set.
   *
   * @param {string} key - name of the environment variable
   * @returns {string} the value
   */
  const value = (key) => (env[key] ? env[key] : (DEFAULTS[key] ?? ''));

  const peerName = value('PEER_NAME');
  if (peerName === '') {
    throw new ConfigError('PEER_NAME must be set');
  }

  const httpPort = port(value, 'HTTP_PORT');
  const p2pPort = port(value, 'P2P_PORT');

  const discovery = value('DISCOVERY');
  const srvName = value('SRV_NAME');

  if (discovery !== DISCOVERY_STATIC && discovery !== DISCOVERY_SRV) {
    throw new ConfigError(`${discovery}: discovery must be srv or static`);
  }

  if (discovery === DISCOVERY_SRV && srvName === '') {
    throw new ConfigError(`SRV_NAME must be set when DISCOVERY is ${DISCOVERY_SRV}`);
  }

  let peers;
  try {
    peers = parsePeers(value('PEERS'));
  } catch (err) {
    throw new ConfigError(`PEERS: ${err.message}`, { cause: err });
  }

  const interval = value('REDIAL_INTERVAL');
  let redialIntervalMs;
  try {
    redialIntervalMs = parseDuration(interval);
  } catch {
    throw new ConfigError(`REDIAL_INTERVAL must be a duration, got ${JSON.stringify(interval)}`);
  }

  if (redialIntervalMs <= 0) {
    throw new ConfigError(`REDIAL_INTERVAL must be positive, got ${interval}`);
  }

  return Object.freeze({
    peerName,
    httpPort,
    p2pPort,
    keySeed: value('KEY_SEED'),
    topic: value('TOPIC'),
    discovery,
    srvName,
    peers: Object.freeze(peers.map((target) => Object.freeze(target))),
    redialIntervalMs,
    logLevel: value('LOG_LEVEL'),
  });
}

/**
 * Reads a port number.
 *
 * @param {(key: string) => string} value - returns the value of a setting
 * @param {string} key - name of the environment variable
 * @returns {number} the port
 * @throws {ConfigError} if the value is not an integer from 1 to 65535
 */
function port(value, key) {
  const text = value(key);

  if (!/^[+-]?\d+$/.test(text)) {
    throw new ConfigError(`${key} must be an integer, got ${JSON.stringify(text)}`);
  }

  const number = Number(text);
  if (number < 1 || number > 65535) {
    throw new ConfigError(`${key} must be a port number, got ${number}`);
  }

  return number;
}
