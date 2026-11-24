import { loadConfig } from './config.js';
import { EVENT_HTTP_SHUTDOWN_FAILED, EVENT_P2P_CLOSE_FAILED, EVENT_STARTUP_FAILED } from './constants.js';
import { createHttpServer } from './http/index.js';
import { createLogger } from './logger.js';
import { createP2PServer, localPeerId } from './p2p/index.js';

/**
 * @typedef {object} Peer
 * @property {import('pino').Logger} logger - logger of the peer
 * @property {Awaited<ReturnType<typeof createP2PServer>>} p2pServer - p2p layer
 * @property {ReturnType<typeof createHttpServer>} httpServer - HTTP API
 */

/** Starts the peer, and stops it on SIGINT or SIGTERM. */
const main = async () => {
  const peer = await startPeer();

  onShutdownSignal(async () => {
    await stopPeer(peer);
    process.exit(0);
  });
};

/**
 * Loads the settings and starts the p2p layer and the HTTP API. On error, it exits.
 *
 * @returns {Promise<Peer>} the running peer
 */
const startPeer = async () => {
  // Replaced once the settings and the peer ID are known.
  let logger = createLogger({ level: 'info', peerName: process.env.PEER_NAME ?? '', peerId: '' });

  try {
    const config = loadConfig();
    const peerId = await localPeerId(config);
    logger = createLogger({ level: config.logLevel, peerName: config.peerName, peerId: peerId.toString() });

    const p2pServer = await createP2PServer(config, logger);
    await p2pServer.start();

    const httpServer = createHttpServer({ node: p2pServer, peerName: config.peerName, port: config.httpPort, logger });
    await httpServer.start();

    return { logger, p2pServer, httpServer };
  } catch (err) {
    return fatal(logger, err);
  }
};

/**
 * Stops the HTTP API first, so that no new request arrives, then the p2p layer.
 *
 * @param {Peer} peer - the running peer
 */
const stopPeer = async ({ logger, p2pServer, httpServer }) => {
  await stopOrWarn(() => httpServer.stop(), logger, EVENT_HTTP_SHUTDOWN_FAILED);
  await stopOrWarn(() => p2pServer.stop(), logger, EVENT_P2P_CLOSE_FAILED);
};

/**
 * Runs one stop step, and logs an error as a warning.
 *
 * @param {() => Promise<void>} stop - the step
 * @param {import('pino').Logger} logger - logger of the peer
 * @param {string} event - log event of a failure
 */
const stopOrWarn = async (stop, logger, event) => {
  try {
    await stop();
  } catch (err) {
    logger.warn({ error: err.message }, event);
  }
};

/**
 * Calls handler once, on the first SIGINT or SIGTERM.
 *
 * @param {() => Promise<void>} handler - the shutdown
 */
const onShutdownSignal = (handler) => {
  let called = false;

  /** Runs handler on the first call only. */
  const once = async () => {
    if (called) {
      return;
    }
    called = true;
    await handler();
  };

  process.once('SIGINT', once);
  process.once('SIGTERM', once);
};

/**
 * Logs startup_failed and exits with status 1.
 *
 * @param {import('pino').Logger} logger - logger of the peer
 * @param {Error} err - why the peer cannot start
 * @returns {never}
 */
const fatal = (logger, err) => {
  logger.error({ error: err.message }, EVENT_STARTUP_FAILED);
  process.exit(1);
};

await main();
