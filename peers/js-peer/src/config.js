import { DISCOVERY_SRV, DISCOVERY_STATIC } from './constants.js';
import { ConfigError } from './errors.js';
import { parseDuration } from './utils/duration.js';
import { parsePeers } from './utils/peers.js';

// Settings of the peer, from environment variables. Names, defaults and checks match the Go peer.

/** Defaults of the settings. A setting without a default is empty. */
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
 * @property {string} peerName - name of this peer, such as js-0 (PEER_NAME, required)
 * @property {number} httpPort - port of the HTTP API (HTTP_PORT)
 * @property {number} p2pPort - libp2p TCP port (P2P_PORT)
 * @property {string} keySeed - seed of the peer keys (KEY_SEED)
 * @property {string} topic - GossipSub topic of the testbed (TOPIC)
 * @property {string} discovery - static or srv (DISCOVERY)
 * @property {string} srvName - DNS name of the SRV lookup (SRV_NAME)
 * @property {ReadonlyArray<import('./utils/peers.js').Target>} peers - static peers (PEERS)
 * @property {number} redialIntervalMs - time between discovery rounds (REDIAL_INTERVAL)
 * @property {string} logLevel - debug, info, warn or error (LOG_LEVEL)
 */

/**
 * Reads and checks all settings. An empty variable counts as not set.
 *
 * @param {Record<string, string | undefined>} [env] - environment; process.env by default
 * @returns {Readonly<Config>} the checked settings
 * @throws {ConfigError} if a setting is invalid
 */
export const loadConfig = (env = process.env) => {
  /**
   * Returns the value of a setting, or its default.
   *
   * @param {string} key - variable name
   * @returns {string} the value
   */
  const value = (key) => {
    return env[key] ? env[key] : (DEFAULTS[key] ?? '');
  };

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

  const peers = peerList(value, 'PEERS');

  const redialIntervalMs = duration(value, 'REDIAL_INTERVAL');
  if (redialIntervalMs <= 0) {
    throw new ConfigError(`REDIAL_INTERVAL must be positive, got ${value('REDIAL_INTERVAL')}`);
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
};

/**
 * Reads a port number.
 *
 * @param {(key: string) => string} value - reads a setting
 * @param {string} key - variable name
 * @returns {number} the port
 * @throws {ConfigError} if the value is not an integer from 1 to 65535
 */
const port = (value, key) => {
  const text = value(key);

  if (!/^[+-]?\d+$/.test(text)) {
    throw new ConfigError(`${key} must be an integer, got ${JSON.stringify(text)}`);
  }

  const number = Number(text);
  if (number < 1 || number > 65535) {
    throw new ConfigError(`${key} must be a port number, got ${number}`);
  }

  return number;
};

/**
 * Reads a list of peers.
 *
 * @param {(key: string) => string} value - reads a setting
 * @param {string} key - variable name
 * @returns {import('./utils/peers.js').Target[]} the peers
 * @throws {ConfigError} if an entry is not valid
 */
const peerList = (value, key) => {
  try {
    return parsePeers(value(key));
  } catch (err) {
    throw new ConfigError(`${key}: ${err.message}`, { cause: err });
  }
};

/**
 * Reads a duration, such as "5s".
 *
 * @param {(key: string) => string} value - reads a setting
 * @param {string} key - variable name
 * @returns {number} the duration, milliseconds
 * @throws {ConfigError} if the value is not a duration
 */
const duration = (value, key) => {
  const text = value(key);

  try {
    return parseDuration(text);
  } catch (err) {
    throw new ConfigError(`${key} must be a duration, got ${JSON.stringify(text)}`, { cause: err });
  }
};
