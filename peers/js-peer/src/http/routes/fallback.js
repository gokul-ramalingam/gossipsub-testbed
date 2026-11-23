import { CODE_METHOD_NOT_ALLOWED, CODE_NOT_FOUND } from '../../constants.js';
import { errorResponse } from '../../utils/response.js';

/** Answers a request to a path that the API does not have, in the JSON response body. */
export function notFound(req, res) {
  res.status(404).json(errorResponse(CODE_NOT_FOUND, 'path not found', 'Path not found'));
}

/** Answers a request to a known path with a method that the path does not accept. */
export function methodNotAllowed(req, res) {
  res.status(405).json(errorResponse(CODE_METHOD_NOT_ALLOWED, 'method not allowed', 'Method not allowed on this path'));
}
