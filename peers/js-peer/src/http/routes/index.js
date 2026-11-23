import { metricsRoutes } from './metrics.js';
import { publishRoutes } from './publish.js';
import { statusRoutes } from './status.js';
import { notFound } from './fallback.js';

/**
 * Registers the peer API on the app. The paths are at the root, with no /api
 * prefix: the Go and JS peers share the same paths. Unknown paths get 404 and
 * known paths with another method 405, in the same JSON body as the API.
 *
 * @param {import('express').Express} app - the Express app
 * @param {import('../index.js').Node} node - publishes and lists the connected peers (the p2p server)
 * @param {string} peerName - name of this peer
 * @param {import('pino').Logger} logger - logger of the peer
 */
export function registerRoutes(app, node, peerName, logger) {
  app.use(statusRoutes(node));
  app.use(publishRoutes(node, peerName, logger));
  app.use(metricsRoutes());
  app.use(notFound);
}
