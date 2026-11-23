/**
 * The GossipSub message of the testbed. The JSON fields and their order are
 * the same as in the Go peer: run_id, publisher, seq, ts_us, payload.
 */

/**
 * @typedef {object} Message
 * @property {string} run_id - run that the message belongs to
 * @property {string} publisher - name of the publisher
 * @property {number} seq - sequence number, from 1 in each run
 * @property {number} ts_us - publication time, Unix microseconds
 * @property {string} [payload] - padding up to the requested size
 */

/** Encoder of the JSON text into bytes. */
const encoder = new TextEncoder();

/** Decoder of bytes into the JSON text. */
const decoder = new TextDecoder();

/**
 * Returns the JSON form of the message, padded with payload so that the
 * encoded message is size bytes. If size is smaller than the message without
 * padding, the message is not padded.
 *
 * @param {Message} msg - the message; its payload is replaced
 * @param {number} size - bytes of the encoded message
 * @returns {Uint8Array} the encoded message
 */
export function encodeMessage(msg, size) {
  const fields = { run_id: msg.run_id, publisher: msg.publisher, seq: msg.seq, ts_us: msg.ts_us, payload: '' };
  const empty = encoder.encode(JSON.stringify(fields));

  const padding = size - empty.length;
  if (padding <= 0) {
    return empty;
  }

  return encoder.encode(JSON.stringify({ ...fields, payload: 'x'.repeat(padding) }));
}

/**
 * Parses the JSON form of a message.
 *
 * @param {Uint8Array} data - the encoded message
 * @returns {Message} the message
 * @throws {Error} if the data is not a message of the testbed
 */
export function decodeMessage(data) {
  const msg = JSON.parse(decoder.decode(data));

  if (typeof msg !== 'object' || msg === null || typeof msg.run_id !== 'string' || !Number.isInteger(msg.seq)) {
    throw new Error('decode message: not a message of the testbed');
  }

  return msg;
}
