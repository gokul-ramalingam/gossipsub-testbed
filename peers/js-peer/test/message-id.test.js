import assert from 'node:assert/strict';
import { test } from 'node:test';

import { publicKeyToProtobuf } from '@libp2p/crypto/keys';
import { register } from '@prometheus-io/client';

import { SEEN_TTL_MS } from '../src/constants.js';
import { DuplicateCounter, specMessageId } from '../src/p2p/message-id.js';
import { peerId } from '../src/p2p/identity.js';
import { encodeMessage } from '../src/utils/message.js';

/** Returns the hex form of bytes. */
const hex = (bytes) => Buffer.from(bytes).toString('hex');

test('the message ID is the peer ID followed by the 8-byte sequence number, as DefaultMsgIdFn of the Go peer', async () => {
  const from = await peerId('gossipsub-testbed', 'go-0');
  const id = specMessageId({ type: 'signed', from, sequenceNumber: 0x0102030405060708n });

  assert.equal(hex(id), hex(from.toMultihash().bytes) + '0102030405060708');
  assert.equal(id.length, 38 + 8);
});

test('the ID of @libp2p/gossipsub would differ: it uses the public key, without the 2-byte multihash header', async () => {
  const from = await peerId('gossipsub-testbed', 'go-0');

  assert.equal(hex(from.toMultihash().bytes), '0024' + hex(publicKeyToProtobuf(from.publicKey)));
});

test('a message ID that is unsigned is refused', () => {
  assert.throws(() => specMessageId({ type: 'unsigned', data: new Uint8Array() }), /signed/);
});

/**
 * Returns the value of gs_messages_duplicate_total for a run.
 *
 * @param {string} runId - the run
 * @returns {Promise<number>} the value
 */
async function duplicates(runId) {
  const metric = (await register.getMetricsAsJSON()).find((m) => m.name === 'gs_messages_duplicate_total');

  return metric?.values.find((v) => v.labels.run_id === runId)?.value ?? 0;
}

test('the first sight of an ID is new, the later ones are duplicates, until the seen TTL is over', async () => {
  const lines = [];
  const logger = { info: (fields, event) => lines.push([event, fields]) };
  const counter = new DuplicateCounter(logger);
  const id = new Uint8Array([1, 2, 3]);
  const data = encodeMessage({ run_id: 'd1', publisher: 'go-0', seq: 4, ts_us: 0 }, 256);
  const before = await duplicates('d1');

  counter.observe(id, data, 1_000);
  counter.observe(id, data, 2_000);
  counter.observe(id, data, 3_000);
  counter.observe(id, data, 1_000 + SEEN_TTL_MS + 1); // forgotten, so new again

  assert.equal((await duplicates('d1')) - before, 2);
  assert.deepEqual(lines, [
    ['duplicate', { run_id: 'd1', seq: 4 }],
    ['duplicate', { run_id: 'd1', seq: 4 }],
  ]);
});
