import { CODE_BAD_REQUEST, CODE_INTERNAL_ERROR, EVENT_HTTP_PANIC } from '../../constants.js';
import { errorResponse } from '../../utils/response.js';

/**
 * Turns an error of a handler into a JSON response. A body that is not valid
 * JSON gives 400 BAD_REQUEST, as in the Go peer. Any other error gives 500
 * INTERNAL_ERROR and one http_panic line with the stack, as the recovery
 * middleware of the Go peer.
 *
 * @param {import('pino').Logger} logger - logger of the peer
 * @returns {import('express').ErrorRequestHandler} the middleware
 */
export function errorHandler(logger) {
  // Express recognises an error handler by its four parameters.
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, next) => {
    if (err.type === 'entity.parse.failed') {
      res.status(400).json(errorResponse(CODE_BAD_REQUEST, err.message, 'Invalid request payload'));
      return;
    }

    logger.error({ method: req.method, path: req.path, error: err.message, stack: err.stack }, EVENT_HTTP_PANIC);
    res.status(500).json(errorResponse(CODE_INTERNAL_ERROR, 'internal error', 'Internal server error'));
  };
}
