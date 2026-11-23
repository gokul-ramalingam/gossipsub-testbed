import { Router } from 'express';

import { metricsController } from '../controllers/metrics.js';
import { MetricsService } from '../services/metrics.js';
import { methodNotAllowed } from './fallback.js';

/**
 * Returns the router of GET /metrics.
 *
 * @returns {import('express').Router} the router
 */
export function metricsRoutes() {
  const controller = metricsController(new MetricsService());
  const router = Router();

  router.route('/metrics').get(controller.getMetrics).all(methodNotAllowed);

  return router;
}
