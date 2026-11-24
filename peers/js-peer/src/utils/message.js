// Message of the testbed. The JSON fields and their order match the Go peer.

/**
 * @typedef {object} Message
 * @property {string} run_id - run ID
 * @property {string} publisher - publisher name
 * @property {number} seq - sequence number, from 1 in each run
 * @property {number} ts_us - publication time, Unix microseconds
 * @property {string} [payload] - padding to the requested size
 */

const encoder = new TextEncoder();

const decoder = new TextDecoder();

/**
 * Encodes the message as JSON, padded to size bytes if it is smaller.
 *
 * @param {Message} msg - the message; its payload is replaced
 * @param {number} size - bytes of the encoded message
 * @returns {Uint8Array} the encoded message
 */
export const encodeMessage = (msg, size) => {
  const fields = { run_id: msg.run_id, publisher: msg.publisher, seq: msg.seq, ts_us: msg.ts_us, payload: '' };
  const empty = encoder.encode(JSON.stringify(fields));

  const padding = size - empty.length;
  if (padding <= 0) {
    return empty;
  }

  return encoder.encode(JSON.stringify({ ...fields, payload: 'x'.repeat(padding) }));
};

/**
 * Parses the JSON form of a message.
 *
 * @param {Uint8Array} data - encoded message
 * @returns {Message} the message
 * @throws {Error} if the data is not a message of the testbed
 */
export const decodeMessage = (data) => {
  const msg = JSON.parse(decoder.decode(data));

  if (typeof msg !== 'object' || msg === null || typeof msg.run_id !== 'string' || !Number.isInteger(msg.seq)) {
    throw new Error('decode message: not a message of the testbed');
  }

  return msg;
};
