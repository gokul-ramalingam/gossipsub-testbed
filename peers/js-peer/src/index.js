import { loadConfig } from './config.js';
import { EVENT_HTTP_SHUTDOWN_FAILED, EVENT_P2P_CLOSE_FAILED, EVENT_STARTUP_FAILED } from './constants.js';
import { createHttpServer } from './http/index.js';
import { createLogger } from './logger.js';
import { createP2PServer, localPeerId } from './p2p/index.js';

/**
 * Entry of the JS peer: checks the settings, starts the p2p layer and the HTTP
 * API, and stops both on SIGINT or SIGTERM. All output is one JSON line per
 * event on stdout.
 */
async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    fatal(createLogger({ level: 'info', peerName: process.env.PEER_NAME ?? '', peerId: '' }), err);
  }

  const peerId = await localPeerId(config);
  const logger = createLogger({ level: config.logLevel, peerName: config.peerName, peerId: peerId.toString() });

  let p2pServer;
  let httpServer;
  try {
    p2pServer = await createP2PServer(config, logger);
    await p2pServer.start();

    httpServer = createHttpServer({ node: p2pServer, peerName: config.peerName, port: config.httpPort, logger });
    await httpServer.start();
  } catch (err) {
    fatal(logger, err);
  }

  /** Stops the HTTP API first, so that no new request arrives, then the p2p layer, and exits. */
  const shutdown = async () => {
    try {
      await httpServer.stop();
    } catch (err) {
      logger.warn({ error: err.message }, EVENT_HTTP_SHUTDOWN_FAILED);
    }

    try {
      await p2pServer.stop();
    } catch (err) {
      logger.warn({ error: err.message }, EVENT_P2P_CLOSE_FAILED);
    }

    process.exit(0);
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

/**
 * Logs startup_failed and exits with status 1.
 *
 * @param {import('pino').Logger} logger - logger of the peer
 * @param {Error} err - why the peer cannot start
 * @returns {never}
 */
function fatal(logger, err) {
  logger.error({ error: err.message }, EVENT_STARTUP_FAILED);
  process.exit(1);
}

await main();
