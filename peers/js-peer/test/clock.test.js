import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatMicros, nowMicros } from '../src/utils/clock.js';

test('nowMicros stays in the millisecond of Date.now()', () => {
  for (let i = 0; i < 10_000; i++) {
    const before = Date.now();
    const micros = nowMicros();
    const after = Date.now();

    // In [before, after + 1) ms; the never-go-back rule can keep it a few
    // microseconds above after a correction.
    assert.ok(micros >= before * 1000 && micros < (after + 1) * 1000 + 50, `${micros} µs vs [${before}, ${after}] ms`);
  }
});

test('nowMicros never goes back', () => {
  let last = nowMicros();

  for (let i = 0; i < 100_000; i++) {
    const now = nowMicros();
    assert.ok(now >= last, `${now} < ${last}`);
    last = now;
  }
});

test('formatMicros writes six fraction digits in UTC, as the Go peer', () => {
  assert.equal(formatMicros(1795409542279130), '2026-11-23T04:52:22.279130Z');
  assert.equal(formatMicros(1795409542000001), '2026-11-23T04:52:22.000001Z');
});
