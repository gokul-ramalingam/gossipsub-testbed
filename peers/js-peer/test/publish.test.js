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
 * A fake publisher: records the published messages and calls onPublish with
 * each one before it returns, so that a test can stall a publish or change
 * the clock at a given message.
 *
 * @param {(msg: object) => Promise<void> | void} [onPublish] - called with each message
 * @returns {{ published: object[], publish: (data: Uint8Array) => Promise<void> }} the publisher
 */
function fakePublisher(onPublish = noop) {
  return {
    published: [],
    async publish(data) {
      const msg = decodeMessage(data);
      await onPublish(msg);
      this.published.push(msg);
    },
  };
}

/**
 * Runs a timed run to its end and returns its final status and how long it
 * took, on the monotonic clock.
 *
 * @param {PublishService} service - the service
 * @param {object} params - the run
 * @returns {Promise<{ status: object, tookMs: number }>} the final status and the run time
 */
async function runToEnd(service, params) {
  const t0 = performance.now();
  service.start(params);

  while (service.status().publishing) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  return { status: service.status(), tookMs: performance.now() - t0 };
}

test('a run catches up after a stall of the publisher', async () => {
  // A publish of 300 ms (15 send times at 50 msg/s) in a run of 1 s.
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
  // At message 10, the wall clock goes 10 s back (as a VM can set it). A
  // schedule on the wall clock then waits 10 s for message 11.
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
