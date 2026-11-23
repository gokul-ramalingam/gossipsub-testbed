import { Router } from 'express';

import { publishController } from '../controllers/publish.js';
import { PublishService } from '../services/publish.js';
import { methodNotAllowed } from './fallback.js';

/**
 * Returns the router of /publish/start, /publish/stop and /publish/status.
 *
 * @param {import('../services/publish.js').Publisher} publisher - publishes each message to the topic
 * @param {string} peerName - name of this peer, the publisher name in each message
 * @param {import('pino').Logger} logger - logger of the peer
 * @returns {import('express').Router} the router
 */
export function publishRoutes(publisher, peerName, logger) {
  const controller = publishController(new PublishService(publisher, peerName, logger));
  const router = Router();

  router.route('/publish/start').post(controller.start).all(methodNotAllowed);
  router.route('/publish/stop').post(controller.stop).all(methodNotAllowed);
  router.route('/publish/status').get(controller.status).all(methodNotAllowed);

  return router;
}
