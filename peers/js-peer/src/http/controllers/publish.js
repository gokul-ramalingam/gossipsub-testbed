import {
  CODE_ALREADY_PUBLISHING,
  CODE_BAD_REQUEST,
  CODE_RUN_ID_USED,
  CODE_VALIDATION_ERROR,
  MAX_RATE,
  MAX_SIZE,
  MIN_SIZE,
} from '../../constants.js';
import { AlreadyPublishingError, RequestError, RunIdUsedError } from '../../errors.js';
import { errorResponse, successResponse } from '../../utils/response.js';

/**
 * Returns the handlers of /publish/start, /publish/stop and /publish/status.
 *
 * @param {import('../services/publish.js').PublishService} service - the publish service
 * @returns {Record<string, import('express').RequestHandler>} the handlers
 */
export const publishController = (service) => {
  return {
    /** Starts a run: 200, or 400 for an invalid body, or 409 for a run in progress or a used run ID. */
    start(req, res) {
      try {
        const params = parseStartParams(req.bodyLength ? req.body : undefined);
        res.status(200).json(successResponse(service.start(params), 'Publishing started!'));
      } catch (err) {
        sendStartError(res, err);
      }
    },

    /** Ends the current run and returns the final status. */
    async stop(req, res) {
      const { status, stopped } = await service.stop();
      res.status(200).json(successResponse(status, stopped ? 'Publishing stopped!' : 'No run in progress'));
    },

    /** Returns the publisher state and counts. */
    status(req, res) {
      res.status(200).json(successResponse(service.status(), 'Publisher status'));
    },
  };
};

/**
 * Sends 400 or 409 for a failed start. It rethrows any other error.
 *
 * @param {import('express').Response} res - the response
 * @param {Error} err - why the start failed
 */
const sendStartError = (res, err) => {
  if (err instanceof RequestError) {
    const message =
      err.code === CODE_BAD_REQUEST ? 'Invalid request payload' : 'Invalid request params, validation failed';
    res.status(400).json(errorResponse(err.code, err.message, message));
    return;
  }

  if (err instanceof AlreadyPublishingError) {
    res.status(409).json(errorResponse(CODE_ALREADY_PUBLISHING, err.message, 'A run is already in progress'));
    return;
  }

  if (err instanceof RunIdUsedError) {
    res.status(409).json(errorResponse(CODE_RUN_ID_USED, err.message, 'The run_id was already used on this peer'));
    return;
  }

  throw err;
};

/** Expected JSON type of each field of the start request. */
const FIELD_TYPES = { run_id: 'string', rate: 'number', size: 'integer', duration_s: 'integer' };

/**
 * Reads and checks the body of a start request, as the Go peer. A missing field is zero.
 *
 * @param {unknown} body - parsed JSON body; undefined if empty
 * @returns {import('../services/publish.js').StartParams} the run
 * @throws {RequestError} if the body or a field is not valid
 */
export const parseStartParams = (body) => {
  if (body === undefined) {
    throw new RequestError(CODE_BAD_REQUEST, 'request body is empty');
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new RequestError(CODE_BAD_REQUEST, 'request body must be a JSON object');
  }

  for (const [field, type] of Object.entries(FIELD_TYPES)) {
    const value = body[field];
    if (value === undefined || value === null) {
      continue;
    }

    const ok = type === 'integer' ? Number.isInteger(value) : typeof value === type;
    if (!ok) {
      throw new RequestError(CODE_BAD_REQUEST, `${field} must be ${type === 'integer' ? 'an integer' : `a ${type}`}`);
    }
  }

  const params = {
    run_id: body.run_id ?? '',
    rate: body.rate ?? 0,
    size: body.size ?? 0,
    duration_s: body.duration_s ?? 0,
  };

  if (params.run_id === '') {
    throw new RequestError(CODE_VALIDATION_ERROR, 'run_id is required');
  }

  if (!(params.rate > 0 && params.rate <= MAX_RATE)) {
    throw new RequestError(CODE_VALIDATION_ERROR, `rate must be > 0 and <= ${MAX_RATE}`);
  }

  if (params.size < MIN_SIZE || params.size > MAX_SIZE) {
    throw new RequestError(CODE_VALIDATION_ERROR, `size must be >= ${MIN_SIZE} and <= ${MAX_SIZE}`);
  }

  if (params.duration_s < 0) {
    throw new RequestError(CODE_VALIDATION_ERROR, 'duration_s must be >= 0');
  }

  return params;
};
