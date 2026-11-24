/** A setting is invalid. */
export class ConfigError extends Error {
  /**
   * @param {string} message - what is wrong
   * @param {ErrorOptions} [options] - the cause
   */
  constructor(message, options) {
    super(message, options);
    this.name = 'ConfigError';
  }
}

/** A run starts while another run is in progress. */
export class AlreadyPublishingError extends Error {
  constructor() {
    super('already publishing');
    this.name = 'AlreadyPublishingError';
  }
}

/** A run starts with a run ID that was used before. */
export class RunIdUsedError extends Error {
  constructor() {
    super('run_id already used');
    this.name = 'RunIdUsedError';
  }
}

/** A request is not valid. */
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
