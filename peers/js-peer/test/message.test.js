import assert from 'node:assert/strict';
import { test } from 'node:test';

import { decodeMessage, encodeMessage } from '../src/utils/message.js';

/** A message of the test. */
const MESSAGE = { run_id: 'r1', publisher: 'go-0', seq: 7, ts_us: 1795409542279130 };

/** The same message as encoded by the Go peer (utils.EncodeMessage), without padding. */
const GO_ENCODED = '{"run_id":"r1","publisher":"go-0","seq":7,"ts_us":1795409542279130,"payload":""}';

test('the encoding is the same bytes as the Go peer', () => {
  const text = (size) => new TextDecoder().decode(encodeMessage(MESSAGE, size));

  assert.equal(text(0), GO_ENCODED);
  assert.equal(text(100), GO_ENCODED.replace('"payload":""', `"payload":"${'x'.repeat(20)}"`));
});

test('the encoded message has the requested size', () => {
  for (const size of [100, 256, 1024, 524288]) {
    assert.equal(encodeMessage(MESSAGE, size).length, size, String(size));
  }
});

test('decode gives the fields back', () => {
  const decoded = decodeMessage(encodeMessage(MESSAGE, 1024));

  assert.equal(decoded.run_id, 'r1');
  assert.equal(decoded.publisher, 'go-0');
  assert.equal(decoded.seq, 7);
  assert.equal(decoded.ts_us, 1795409542279130);
});

test('decode rejects data that is not a message of the testbed', () => {
  for (const text of ['not json', '42', '{"seq":1}', '{"run_id":"r1","seq":"1"}']) {
    assert.throws(() => decodeMessage(new TextEncoder().encode(text)), Error, text);
  }
});
