import { EVENT_DUPLICATE, SEEN_TTL_MS } from '../constants.js';
import { captureDuplicate } from '../metrics.js';
import { decodeMessage } from '../utils/message.js';

/**
 * Returns the message ID of the pubsub spec: publisher peer ID + sequence
 * number, as go-libp2p-pubsub. The @libp2p/gossipsub default uses the public
 * key, so Go and JS peers would not match IHAVE and IWANT IDs.
 *
 * @param {import('@libp2p/interface').Message} msg - a signed message
 * @returns {Uint8Array} the message ID
 */
export const specMessageId = (msg) => {
  if (msg.type !== 'signed') {
    throw new Error('expected a signed message');
  }

  const from = msg.from.toMultihash().bytes;
  const seqno = new Uint8Array(8);
  new DataView(seqno.buffer).setBigUint64(0, msg.sequenceNumber);

  const id = new Uint8Array(from.length + seqno.length);
  id.set(from, 0);
  id.set(seqno, from.length);

  return id;
};

/**
 * Counts and logs duplicate messages. The library has no duplicate event, so
 * each message ID is checked here, within the seen TTL.
 */
export class DuplicateCounter {
  /** @type {Map<string, number>} message ID (hex) -> expiry time, ms */
  #seen = new Map();
  /** @type {import('pino').Logger} */
  #logger;

  /**
   * @param {import('pino').Logger} logger - logger of the peer
   */
  constructor(logger) {
    this.#logger = logger;
  }

  /**
   * Records one message, and counts it if it is a duplicate.
   *
   * @param {Uint8Array} id - message ID
   * @param {Uint8Array} data - message data
   * @param {number} [nowMs] - current time; Date.now() by default
   */
  observe(id, data, nowMs = Date.now()) {
    this.#forget(nowMs);

    const key = Buffer.from(id).toString('hex');
    if (!this.#seen.has(key)) {
      this.#seen.set(key, nowMs + SEEN_TTL_MS);
      return;
    }

    const decoded = decodeOrUndefined(data);

    captureDuplicate(decoded?.run_id ?? '');
    this.#logger.info(decoded ? { run_id: decoded.run_id, seq: decoded.seq } : {}, EVENT_DUPLICATE);
  }

  /**
   * Forgets the expired IDs. The map is in insertion order, so they are first.
   *
   * @param {number} nowMs - current time
   */
  #forget(nowMs) {
    for (const [key, expires] of this.#seen) {
      if (expires > nowMs) {
        return;
      }

      this.#seen.delete(key);
    }
  }
}

/**
 * Decodes a message, or returns undefined.
 *
 * @param {Uint8Array} data - message data
 * @returns {ReturnType<typeof decodeMessage> | undefined} the message; undefined if it does not decode
 */
const decodeOrUndefined = (data) => {
  try {
    return decodeMessage(data);
  } catch {
    return undefined;
  }
};
