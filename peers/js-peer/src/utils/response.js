/**
 * The body of each JSON response. The Go and JS peers use the same fields:
 * {status, data, error: {code, message}, message}. data and error are left
 * out when they are not set, as with omitempty in the Go peer.
 */

/**
 * Returns the body of a successful response.
 *
 * @param {unknown} data - the response data, or undefined
 * @param {string} message - human-readable summary
 * @returns {object} the body
 */
export function successResponse(data, message) {
  return { status: 'success', data, message };
}

/**
 * Returns the body of a failed response.
 *
 * @param {string} code - error code, for example BAD_REQUEST
 * @param {string} error - text of the error
 * @param {string} message - human-readable summary
 * @returns {object} the body
 */
export function errorResponse(code, error, message) {
  return { status: 'failed', error: { code, message: error }, message };
}
