import { EVENT_DUPLICATE, SEEN_TTL_MS } from '../constants.js';
import { captureDuplicate } from '../metrics.js';
import { decodeMessage } from '../utils/message.js';

/**
 * The message ID of the libp2p pubsub spec: the from field (the peer ID of
 * the publisher, as bytes) followed by the sequence number (8 bytes, big
 * endian). go-libp2p-pubsub uses it (DefaultMsgIdFn).
 *
 * @libp2p/gossipsub 17.2.1 uses the public key of the publisher instead of
 * its peer ID. For an Ed25519 key, the peer ID is the identity multihash of
 * the public key, so the JS ID is the Go ID without its 2 first bytes. With
 * the two IDs, the IHAVE, IWANT and IDONTWANT messages between a Go peer and a
 * JS peer name messages that the other side does not know. The JS peer
 * therefore uses the spec ID.
 *
 * @param {import('@libp2p/interface').Message} msg - a signed message
 * @returns {Uint8Array} the message ID
 */
export function specMessageId(msg) {
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
}

/**
 * Counts and logs the duplicate copies of messages. GossipSub computes the
 * message ID of each message that this peer publishes and of each message it
 * receives, before its own duplicate check; the first time an ID is seen, the
 * message is new, and each later time within the seen TTL it is a duplicate,
 * as in GossipSub. @libp2p/gossipsub has no event for a duplicate, so the
 * count is made here, where the message data (and so its run) is known.
 */
export class DuplicateCounter {
  /** @type {Map<string, number>} message ID (hex) -> time after which it is forgotten, in ms */
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
   * Records one message. GossipSub calls this through the message ID function.
   *
   * @param {Uint8Array} id - the message ID
   * @param {Uint8Array} data - the message data
   * @param {number} [nowMs] - current time; Date.now() by default
   */
  observe(id, data, nowMs = Date.now()) {
    this.#forget(nowMs);

    const key = Buffer.from(id).toString('hex');
    if (!this.#seen.has(key)) {
      this.#seen.set(key, nowMs + SEEN_TTL_MS);
      return;
    }

    let decoded;
    try {
      decoded = decodeMessage(data);
    } catch {
      captureDuplicate('');
      this.#logger.info({}, EVENT_DUPLICATE);
      return;
    }

    captureDuplicate(decoded.run_id);
    this.#logger.info({ run_id: decoded.run_id, seq: decoded.seq }, EVENT_DUPLICATE);
  }

  /**
   * Forgets the IDs whose seen TTL is over. The map is in the order of the
   * first sight, so the expired IDs are at its start.
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
