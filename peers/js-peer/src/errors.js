/**
 * Errors of the peer.
 */

/** ConfigError is thrown when a setting in the environment is invalid. The peer then stops. */
export class ConfigError extends Error {
  /**
   * @param {string} message - what is wrong, with the name of the setting
   * @param {ErrorOptions} [options] - the cause, if the error comes from another error
   */
  constructor(message, options) {
    super(message, options);
    this.name = 'ConfigError';
  }
}

/** AlreadyPublishingError is thrown when a run starts while another run is in progress. */
export class AlreadyPublishingError extends Error {
  constructor() {
    super('already publishing');
    this.name = 'AlreadyPublishingError';
  }
}

/** RequestError is thrown when a request is not valid. code is the error code of the response. */
export class RequestError extends Error {
  /**
   * @param {string} code - CODE_BAD_REQUEST or CODE_VALIDATION_ERROR
   * @param {string} message - what is wrong
   */
  constructor(code, message) {
    super(message);
    this.name = 'RequestError';
    this.code = code;
  }
}
