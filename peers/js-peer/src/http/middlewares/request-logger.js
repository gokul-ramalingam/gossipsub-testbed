import { EVENT_HTTP_REQUEST } from '../../constants.js';

/**
 * Paths that are not logged. Prometheus scrapes /metrics every few seconds,
 * the probes call /healthz often, and the run script polls /connections until
 * the network is ready, so their lines would hide the events of the experiment.
 */
const QUIET_PATHS = new Set(['/metrics', '/healthz', '/connections']);

/**
 * Logs one http_request line for each API request, when the response is
 * sent, with the method, path, status and duration.
 *
 * @param {import('pino').Logger} logger - logger of the peer
 * @returns {import('express').RequestHandler} the middleware
 */
export function requestLogger(logger) {
  return (req, res, next) => {
    const start = process.hrtime.bigint();

    res.on('finish', () => {
      if (QUIET_PATHS.has(req.path)) {
        return;
      }

      logger.info(
        {
          method: req.method,
          path: req.path,
          status: res.statusCode,
          duration_us: Number((process.hrtime.bigint() - start) / 1000n),
        },
        EVENT_HTTP_REQUEST,
      );
    });

    next();
  };
}
