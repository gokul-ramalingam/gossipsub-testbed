import { createServer } from 'node:http';

import express from 'express';

import { errorHandler } from './middlewares/error-handler.js';
import { requestLogger } from './middlewares/request-logger.js';
import { registerRoutes } from './routes/index.js';

/**
 * @typedef {import('./services/publish.js').Publisher & import('./services/status.js').PeerLister} Node
 * What the HTTP API needs from the p2p layer: publish to the topic and list
 * the connected peers. The p2p server satisfies it.
 */

/** The HTTP API of the peer. */
export class HttpServer {
  /** @type {import('node:http').Server} */
  #server;
  /** @type {number} */
  #port;

  /**
   * Use createHttpServer.
   *
   * @param {import('node:http').Server} server - the HTTP server with the Express app
   * @param {number} port - the port
   */
  constructor(server, port) {
    this.#server = server;
    this.#port = port;
  }

  /**
   * Binds the port and serves. It fails if the port cannot be bound.
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
   * Stops the server. It waits for the requests in progress and closes the idle connections.
   *
   * @returns {Promise<void>}
   */
  stop() {
    return new Promise((resolve, reject) => {
      this.#server.close((err) => (err ? reject(err) : resolve()));
      this.#server.closeIdleConnections();
    });
  }

  /** @returns {number} the port that the server listens on; useful with port 0 */
  get port() {
    return this.#server.address().port;
  }
}

/**
 * Returns the HTTP API on port. The API publishes and lists the connected
 * peers with node (the p2p server), and logs to logger.
 *
 * @param {object} options
 * @param {Node} options.node - the p2p server
 * @param {string} options.peerName - name of this peer
 * @param {number} options.port - port of the API; 0 picks a free port
 * @param {import('pino').Logger} options.logger - logger of the peer
 * @returns {HttpServer} the server, not started
 */
export function createHttpServer({ node, peerName, port, logger }) {
  const app = express();

  app.disable('x-powered-by');
  app.use(requestLogger(logger));
  // Parse the body as JSON whatever the content type, as Gin does in the Go
  // peer. verify runs only for a body that is not empty; bodyLength lets the
  // handlers tell an empty body (a bad request in the Go peer) from {}.
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
}
