import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatDuration, parseDuration } from '../src/utils/duration.js';

test('durations in the format of Go time.ParseDuration', () => {
  const cases = { '5s': 5000, '200ms': 200, '1m30s': 90_000, '1.5h': 5_400_000, 0: 0, '-2s': -2000, '500us': 0.5 };

  for (const [text, ms] of Object.entries(cases)) {
    assert.equal(parseDuration(text), ms, text);
  }
});

test('text that is not a duration', () => {
  for (const text of ['', '5', 's', '5x', '1s2', 'soon']) {
    assert.throws(() => parseDuration(text), Error, text);
  }
});

test('format of a duration for the started event', () => {
  assert.equal(formatDuration(5000), '5s');
  assert.equal(formatDuration(1500), '1.5s');
  assert.equal(formatDuration(200), '200ms');
});
