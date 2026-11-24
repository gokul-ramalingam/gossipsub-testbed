import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { PublishService } from '../src/http/services/publish.js';
import { decodeMessage } from '../src/utils/message.js';

/** A logger that drops every line. */
const noop = () => {};
const logger = { debug: noop, info: noop, warn: noop, error: noop };

/** The real Date.now, restored after each test that replaces it. */
const realDateNow = Date.now;

afterEach(() => {
  Date.now = realDateNow;
});

/**
 * Returns a fake publisher that records the messages and calls onPublish with each one.
 *
 * @param {(msg: object) => Promise<void> | void} [onPublish] - called with each message
 * @returns {{ published: object[], publish: (data: Uint8Array) => Promise<void> }} the publisher
 */
const fakePublisher = (onPublish = noop) => {
  return {
    published: [],
    async publish(data) {
      const msg = decodeMessage(data);
      await onPublish(msg);
      this.published.push(msg);
    },
  };
};

/**
 * Runs a timed run to its end.
 *
 * @param {PublishService} service - the service
 * @param {object} params - the run
 * @returns {Promise<{ status: object, tookMs: number }>} the final status and the run time
 */
const runToEnd = async (service, params) => {
  const t0 = performance.now();
  service.start(params);

  while (service.status().publishing) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  return { status: service.status(), tookMs: performance.now() - t0 };
};

test('a run catches up after a stall of the publisher', async () => {
  // One publish of 300 ms in a run of 1 s at 50 msg/s.
  const publisher = fakePublisher((msg) =>
    msg.seq === 10 ? new Promise((resolve) => setTimeout(resolve, 300)) : undefined,
  );
  const service = new PublishService(publisher, 'js-0', logger);

  const { status, tookMs } = await runToEnd(service, { run_id: 'p1', rate: 50, size: 512, duration_s: 1 });

  assert.equal(status.success, 50);
  assert.equal(status.last_seq, 50);
  assert.ok(tookMs < 1150, `run took ${tookMs} ms, want about 1 s`);
});

test('a change of the wall clock during a run does not move the schedule', async () => {
  // At message 10, the wall clock goes 10 s back.
  let offsetMs = 0;
  Date.now = () => realDateNow() + offsetMs;

  const publisher = fakePublisher((msg) => {
    if (msg.seq === 10) {
      offsetMs = -10_000;
    }
  });
  const service = new PublishService(publisher, 'js-0', logger);

  const { status, tookMs } = await runToEnd(service, { run_id: 'p2', rate: 50, size: 512, duration_s: 1 });

  assert.equal(status.success, 50);
  assert.ok(tookMs < 1150, `run took ${tookMs} ms, want about 1 s`);
  assert.deepEqual(
    publisher.published.map((msg) => msg.seq),
    Array.from({ length: 50 }, (_, i) => i + 1),
  );
});

test('an unexpected error ends the run with run_failed, without an unhandled rejection', async () => {
  // A failed publish logs a warning; a throwing warn gives an unexpected error.
  const events = [];
  const failingLogger = {
    ...logger,
    warn: () => {
      throw new Error('logger broken');
    },
    error: (fields, event) => events.push([event, fields]),
  };
  const publisher = {
    async publish() {
      throw new Error('no topic');
    },
  };
  let unhandled;
  /** Records an unhandled rejection. */
  const onUnhandled = (reason) => {
    unhandled = reason;
  };
  process.on('unhandledRejection', onUnhandled);

  try {
    const service = new PublishService(publisher, 'js-0', failingLogger);
    const { status } = await runToEnd(service, { run_id: 'p3', rate: 50, size: 512, duration_s: 1 });
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(status.publishing, false);
    assert.deepEqual(events, [['run_failed', { run_id: 'p3', error: 'logger broken' }]]);
    assert.equal(unhandled, undefined);

    assert.equal(service.start({ run_id: 'p4', rate: 10, size: 512, duration_s: 0 }).publishing, true);
    await service.stop();
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});
