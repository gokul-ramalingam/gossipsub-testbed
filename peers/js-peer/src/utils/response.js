// JSON response bodies, as the Go peer: {status, data, error: {code, message}, message}.

/**
 * Returns the body of a successful response.
 *
 * @param {unknown} data - the response data, or undefined
 * @param {string} message - human-readable summary
 * @returns {object} the body
 */
export const successResponse = (data, message) => {
  return { status: 'success', data, message };
};

/**
 * Returns the body of a failed response.
 *
 * @param {string} code - error code, such as BAD_REQUEST
 * @param {string} error - text of the error
 * @param {string} message - human-readable summary
 * @returns {object} the body
 */
export const errorResponse = (code, error, message) => {
  return { status: 'failed', error: { code, message: error }, message };
};
