import { CODE_BAD_REQUEST, CODE_INTERNAL_ERROR, EVENT_HTTP_PANIC } from '../../constants.js';
import { errorResponse } from '../../utils/response.js';

/**
 * Turns a handler error into a JSON response: 400 for invalid JSON, else 500 and an http_panic log line.
 *
 * @param {import('pino').Logger} logger - logger of the peer
 * @returns {import('express').ErrorRequestHandler} the middleware
 */
export const errorHandler = (logger) => {
  // Express needs four parameters to see an error handler.
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, next) => {
    if (err.type === 'entity.parse.failed') {
      res.status(400).json(errorResponse(CODE_BAD_REQUEST, err.message, 'Invalid request payload'));
      return;
    }

    logger.error({ method: req.method, path: req.path, error: err.message, stack: err.stack }, EVENT_HTTP_PANIC);
    res.status(500).json(errorResponse(CODE_INTERNAL_ERROR, 'internal error', 'Internal server error'));
  };
};
