import { createServer } from 'node:http';

import express from 'express';

import { errorHandler } from './middlewares/error-handler.js';
import { requestLogger } from './middlewares/request-logger.js';
import { registerRoutes } from './routes/index.js';

/** @typedef {import('./services/publish.js').Publisher & import('./services/status.js').PeerLister} Node */

/** The HTTP API of the peer. */
export class HttpServer {
  /** @type {import('node:http').Server} */
  #server;
  /** @type {number} */
  #port;

  /**
   * Use createHttpServer.
   *
   * @param {import('node:http').Server} server - HTTP server of the Express app
   * @param {number} port - port of the API
   */
  constructor(server, port) {
    this.#server = server;
    this.#port = port;
  }

  /**
   * Binds the port and serves.
   *
   * @returns {Promise<void>}
   */
  start() {
    return new Promise((resolve, reject) => {
      this.#server.once('error', reject);
      this.#server.listen(this.#port, () => {
        this.#server.off('error', reject);
        resolve();
      });
    });
  }

  /**
   * Stops the server after the requests in progress.
   *
   * @returns {Promise<void>}
   */
  stop() {
    return new Promise((resolve, reject) => {
      this.#server.close((err) => (err ? reject(err) : resolve()));
      this.#server.closeIdleConnections();
    });
  }

  /** @returns {number} the port the server listens on */
  get port() {
    return this.#server.address().port;
  }
}

/**
 * Returns the HTTP API.
 *
 * @param {object} options
 * @param {Node} options.node - the p2p server
 * @param {string} options.peerName - name of this peer
 * @param {number} options.port - port of the API; 0 picks a free port
 * @param {import('pino').Logger} options.logger - logger of the peer
 * @returns {HttpServer} the server, not started
 */
export const createHttpServer = ({ node, peerName, port, logger }) => {
  const app = express();

  app.disable('x-powered-by');
  app.use(requestLogger(logger));
  // Parse any body as JSON, as Gin does. bodyLength tells an empty body from {}.
  app.use(
    express.json({
      type: () => true,
      verify: (req, res, buf) => {
        req.bodyLength = buf.length;
      },
    }),
  );
  registerRoutes(app, node, peerName, logger);
  app.use(errorHandler(logger));

  return new HttpServer(createServer(app), port);
};
