import { Router } from 'express';

import { statusController } from '../controllers/status.js';
import { StatusService } from '../services/status.js';
import { methodNotAllowed } from './fallback.js';

/**
 * Returns the router of GET /healthz and GET /connections.
 *
 * @param {import('../services/status.js').PeerLister} peers - lists the connected peers
 * @returns {import('express').Router} the router
 */
export const statusRoutes = (peers) => {
  const controller = statusController(new StatusService(peers));
  const router = Router();

  router.route('/healthz').get(controller.getHealth).all(methodNotAllowed);
  router.route('/connections').get(controller.getConnections).all(methodNotAllowed);

  return router;
};
