import { metricsRoutes } from './metrics.js';
import { publishRoutes } from './publish.js';
import { statusRoutes } from './status.js';
import { notFound } from './fallback.js';

/**
 * Registers the API routes, with 404 and 405 for the others. The paths match the Go peer.
 *
 * @param {import('express').Express} app - the Express app
 * @param {import('../index.js').Node} node - the p2p layer
 * @param {string} peerName - name of this peer
 * @param {import('pino').Logger} logger - logger of the peer
 */
export const registerRoutes = (app, node, peerName, logger) => {
  app.use(statusRoutes(node));
  app.use(publishRoutes(node, peerName, logger));
  app.use(metricsRoutes());
  app.use(notFound);
};
