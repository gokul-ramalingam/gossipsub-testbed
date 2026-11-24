import { setTimeout as sleep } from 'node:timers/promises';

import {
  EVENT_PUBLISHED,
  EVENT_PUBLISH_FAILED,
  EVENT_RUN_FAILED,
  EVENT_RUN_STARTED,
  EVENT_RUN_STOPPED,
  REASON_ENCODE,
  REASON_PUBLISH,
} from '../../constants.js';
import { AlreadyPublishingError, RunIdUsedError } from '../../errors.js';
import { capturePublishAttempt, capturePublishError, capturePublishSuccess } from '../../metrics.js';
import { formatMicros, nowMicros } from '../../utils/clock.js';
import { encodeMessage } from '../../utils/message.js';

/**
 * @typedef {object} StartParams
 * @property {string} run_id - run ID
 * @property {number} rate - messages per second
 * @property {number} size - bytes per encoded message
 * @property {number} duration_s - run length in seconds; 0 runs until stop
 */

/**
 * @typedef {object} Publisher
 * @property {(data: Uint8Array) => Promise<void>} publish - publishes one encoded message
 */

/**
 * Publishes one run at a time. Each run ID is accepted once, because the
 * sequence numbers start at 1 in each run.
 */
export class PublishService {
  /** @type {Publisher} */
  #publisher;
  /** @type {string} */
  #peerName;
  /** @type {import('pino').Logger} */
  #logger;
  /** @type {object} state and counts of the current or last run */
  #status = { publishing: false, duration_s: 0, attempts: 0, success: 0, errors: 0, last_seq: 0 };
  /** @type {AbortController | undefined} undefined when idle */
  #stop;
  /** @type {Promise<void> | undefined} settles when the run ends */
  #done;
  /** @type {Set<string>} run IDs already used */
  #used = new Set();

  /**
   * @param {Publisher} publisher - publishes each message to the topic
   * @param {string} peerName - name of this peer
   * @param {import('pino').Logger} logger - logger of the peer
   */
  constructor(publisher, peerName, logger) {
    this.#publisher = publisher;
    this.#peerName = peerName;
    this.#logger = logger;
  }

  /**
   * Begins a run in the background and returns its initial status.
   *
   * @param {StartParams} params - the run
   * @returns {object} the status
   * @throws {AlreadyPublishingError} if a run is in progress
   * @throws {RunIdUsedError} if the run ID was used before
   */
  start(params) {
    if (this.#status.publishing) {
      throw new AlreadyPublishingError();
    }

    if (this.#used.has(params.run_id)) {
      throw new RunIdUsedError();
    }

    this.#used.add(params.run_id);

    const startedAtUs = nowMicros();

    this.#status = {
      publishing: true,
      run_id: params.run_id,
      rate: params.rate,
      size: params.size,
      duration_s: params.duration_s,
      started_at: formatMicros(startedAtUs),
      attempts: 0,
      success: 0,
      errors: 0,
      last_seq: 0,
    };

    this.#logger.info(
      { run_id: params.run_id, rate: params.rate, size: params.size, duration_s: params.duration_s },
      EVENT_RUN_STARTED,
    );

    this.#stop = new AbortController();
    this.#done = this.#run(params, performance.now(), this.#stop.signal);

    return this.status();
  }

  /**
   * Ends the current run and waits for it to exit.
   *
   * @returns {Promise<{ status: object, stopped: boolean }>} the final status; stopped is false if no run was in progress
   */
  async stop() {
    if (!this.#stop) {
      return { status: this.status(), stopped: false };
    }

    this.#stop.abort();
    await this.#done;

    return { status: this.status(), stopped: true };
  }

  /** @returns {object} the state and counts of the current or last run, without unset fields */
  status() {
    const status = { ...this.#status };

    for (const key of ['run_id', 'rate', 'size', 'started_at', 'stopped_at']) {
      if (!status[key]) {
        delete status[key];
      }
    }

    return status;
  }

  /**
   * Publishes message n at start + (n-1)/rate until stop or the deadline.
   * After a stall, the late messages go out at once. The schedule uses the
   * monotonic clock, so a wall clock change does not move it.
   *
   * @param {StartParams} params - the run
   * @param {number} startedAtMs - start time, performance.now()
   * @param {AbortSignal} signal - aborted by stop
   */
  async #run(params, startedAtMs, signal) {
    const intervalMs = 1000 / params.rate;
    const deadlineMs = params.duration_s > 0 ? startedAtMs + params.duration_s * 1000 : Infinity;

    try {
      for (let seq = 1; !signal.aborted; seq++) {
        const dueMs = startedAtMs + (seq - 1) * intervalMs;
        if (dueMs >= deadlineMs) {
          break;
        }

        const waitMs = dueMs - performance.now();
        if (waitMs > 0) {
          await sleep(waitMs, undefined, { signal });
        }

        await this.#publishOne(params, seq);
      }
    } catch (err) {
      // An abort is a normal stop. Log any other error: nothing awaits this promise.
      if (!signal.aborted) {
        this.#logger.error({ run_id: params.run_id, error: err.message }, EVENT_RUN_FAILED);
      }
    } finally {
      this.#finish();
    }
  }

  /**
   * Publishes one message, and logs and counts the result.
   *
   * @param {StartParams} params - the run
   * @param {number} seq - sequence number
   */
  async #publishOne(params, seq) {
    capturePublishAttempt(params.run_id);

    const msg = { run_id: params.run_id, publisher: this.#peerName, seq, ts_us: nowMicros() }; // taken just before the publish

    let reason = REASON_ENCODE;
    try {
      const data = encodeMessage(msg, params.size);
      reason = REASON_PUBLISH;
      await this.#publisher.publish(data);

      this.#status.success++;
      capturePublishSuccess(params.run_id);
      this.#logger.info({ run_id: params.run_id, seq, ts_us: msg.ts_us }, EVENT_PUBLISHED);
    } catch (err) {
      this.#status.errors++;
      capturePublishError(params.run_id, reason);
      this.#logger.warn({ run_id: params.run_id, seq, reason, error: err.message }, EVENT_PUBLISH_FAILED);
    } finally {
      this.#status.attempts++;
      this.#status.last_seq = seq;
    }
  }

  /** Marks the run as stopped and logs its counts. */
  #finish() {
    this.#status.publishing = false;
    this.#status.stopped_at = formatMicros(nowMicros());
    this.#stop = undefined;

    const { run_id, attempts, success, errors, last_seq } = this.#status;
    this.#logger.info({ run_id, attempts, success, errors, last_seq }, EVENT_RUN_STOPPED);
  }
}
