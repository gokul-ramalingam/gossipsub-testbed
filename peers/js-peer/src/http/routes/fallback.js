import { CODE_METHOD_NOT_ALLOWED, CODE_NOT_FOUND } from '../../constants.js';
import { errorResponse } from '../../utils/response.js';

/** Answers 404 for an unknown path. */
export const notFound = (req, res) => {
  res.status(404).json(errorResponse(CODE_NOT_FOUND, 'path not found', 'Path not found'));
};

/** Answers 405 for a method that the path does not accept. */
export const methodNotAllowed = (req, res) => {
  res.status(405).json(errorResponse(CODE_METHOD_NOT_ALLOWED, 'method not allowed', 'Method not allowed on this path'));
};
