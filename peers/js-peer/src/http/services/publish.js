import { setTimeout as sleep } from 'node:timers/promises';

import {
  EVENT_PUBLISHED,
  EVENT_PUBLISH_FAILED,
  EVENT_RUN_STARTED,
  EVENT_RUN_STOPPED,
  REASON_ENCODE,
  REASON_PUBLISH,
} from '../../constants.js';
import { AlreadyPublishingError } from '../../errors.js';
import { capturePublishAttempt, capturePublishError, capturePublishSuccess } from '../../metrics.js';
import { formatMicros, nowMicros } from '../../utils/clock.js';
import { encodeMessage } from '../../utils/message.js';

/**
 * @typedef {object} StartParams
 * @property {string} run_id - run identifier, written to each message and metric
 * @property {number} rate - messages per second
 * @property {number} size - bytes per encoded message
 * @property {number} duration_s - run length in seconds; 0 = until stop
 */

/**
 * @typedef {object} Publisher
 * @property {(data: Uint8Array) => Promise<void>} publish - publishes one encoded message to the topic
 */

/**
 * Publishes one run at a time. Sequence numbers start at 1 in each run. The
 * first message goes at once, then one per interval; a timed run publishes
 * exactly rate × duration messages (as the Go peer).
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
  /** @type {AbortController | undefined} ends the current run; undefined when idle */
  #stop;
  /** @type {Promise<void> | undefined} settles when the publish loop exits; undefined when idle */
  #done;

  /**
   * @param {Publisher} publisher - publishes each message to the topic
   * @param {string} peerName - name of this peer, written to each message as the publisher
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
   */
  start(params) {
    if (this.#status.publishing) {
      throw new AlreadyPublishingError();
    }

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
    this.#done = this.#run(params, startedAtUs / 1000, this.#stop.signal);

    return this.status();
  }

  /**
   * Ends the current run and waits for the publish loop to exit. If no run is
   * in progress, it returns the last status.
   *
   * @returns {Promise<object>} the final status
   */
  async stop() {
    this.#stop?.abort();
    await this.#done;

    return this.status();
  }

  /** @returns {object} the state and counts of the current or last run, without the unset fields */
  status() {
    const status = { ...this.#status };

    // As omitempty and omitzero in the Go peer.
    for (const key of ['run_id', 'rate', 'size', 'started_at', 'stopped_at']) {
      if (!status[key]) {
        delete status[key];
      }
    }

    return status;
  }

  /**
   * Publishes the first message at once, then one per interval, until stop or
   * until the next message would be at or after the deadline. The schedule is
   * fixed from the start time, so that a delay of one message does not move
   * the next ones.
   *
   * @param {StartParams} params - the run
   * @param {number} startedAtMs - start time, Unix milliseconds
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

        const waitMs = dueMs - Date.now();
        if (waitMs > 0) {
          await sleep(waitMs, undefined, { signal });
        }

        await this.#publishOne(params, seq);
      }
    } catch (err) {
      if (!signal.aborted) {
        throw err;
      }
    } finally {
      this.#finish();
    }
  }

  /**
   * Encodes and publishes one message, logs it, and updates the metrics and the counts.
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
