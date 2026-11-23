import {
  CODE_ALREADY_PUBLISHING,
  CODE_BAD_REQUEST,
  CODE_VALIDATION_ERROR,
  MAX_RATE,
  MAX_SIZE,
  MIN_SIZE,
} from '../../constants.js';
import { AlreadyPublishingError, RequestError } from '../../errors.js';
import { errorResponse, successResponse } from '../../utils/response.js';

/**
 * Returns the handlers of /publish/start, /publish/stop and /publish/status.
 *
 * @param {import('../services/publish.js').PublishService} service - publisher state and publish loop
 * @returns {Record<string, import('express').RequestHandler>} the handlers
 */
export function publishController(service) {
  return {
    /** Starts a run: 200 when it starts, 400 for an invalid body or field, 409 when a run is in progress. */
    start(req, res) {
      let params;
      try {
        params = parseStartParams(req.bodyLength ? req.body : undefined);
      } catch (err) {
        if (!(err instanceof RequestError)) {
          throw err;
        }

        const message =
          err.code === CODE_BAD_REQUEST ? 'Invalid request payload' : 'Invalid request params, validation failed';
        res.status(400).json(errorResponse(err.code, err.message, message));
        return;
      }

      try {
        res.status(200).json(successResponse(service.start(params), 'Publishing started!'));
      } catch (err) {
        if (!(err instanceof AlreadyPublishingError)) {
          throw err;
        }

        res.status(409).json(errorResponse(CODE_ALREADY_PUBLISHING, err.message, 'A run is already in progress'));
      }
    },

    /** Ends the current run and returns the final status. */
    async stop(req, res) {
      res.status(200).json(successResponse(await service.stop(), 'Publishing stopped!'));
    },

    /** Returns the publisher state and counts. */
    status(req, res) {
      res.status(200).json(successResponse(service.status(), 'Publisher status'));
    },
  };
}

/** Expected JSON type of each field of the start request. */
const FIELD_TYPES = { run_id: 'string', rate: 'number', size: 'integer', duration_s: 'integer' };

/**
 * Reads and checks the body of POST /publish/start, as the Go peer does: an
 * empty body or a field with the wrong type is a bad request, a missing field
 * is zero, and a value out of range is a validation error. Unknown fields are
 * ignored.
 *
 * @param {unknown} body - the parsed JSON body; undefined for an empty body
 * @returns {import('../services/publish.js').StartParams} the run
 * @throws {RequestError} if the body or a field is not valid
 */
export function parseStartParams(body) {
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
}
