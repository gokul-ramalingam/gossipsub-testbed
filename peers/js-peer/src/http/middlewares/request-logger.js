import { EVENT_HTTP_REQUEST } from '../../constants.js';

/** Paths not logged: they are polled often and would hide the run events. */
const QUIET_PATHS = new Set(['/metrics', '/healthz', '/connections']);

/**
 * Logs one http_request line per API request: method, path, status and duration.
 *
 * @param {import('pino').Logger} logger - logger of the peer
 * @returns {import('express').RequestHandler} the middleware
 */
export const requestLogger = (logger) => {
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
};
