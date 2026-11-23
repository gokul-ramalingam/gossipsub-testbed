import pino from 'pino';

import { IMPL } from './constants.js';
import { formatMicros, nowMicros } from './utils/clock.js';

/**
 * Field names of each log line. The Go and JS peers use the same names.
 */
export const FIELD_TIME = 'ts';
/** Event name, for example received. */
export const FIELD_EVENT = 'event';

/**
 * Returns the logger of this peer: one JSON line per event on stdout, with the
 * common fields ts, event, peer, impl ("js") and peer_id, plus level. An event
 * is logged as logger.info({ ...fields }, EVENT_NAME).
 *
 * @param {object} options
 * @param {string} options.level - debug, info, warn or error; any other value means info
 * @param {string} options.peerName - name of this peer
 * @param {string} options.peerId - peer ID of this peer; empty before it is known
 * @param {import('pino').DestinationStream} [options.destination] - where the lines go; stdout by default
 * @returns {import('pino').Logger} the logger
 */
export function createLogger({ level, peerName, peerId, destination }) {
  return pino(
    {
      level: ['debug', 'info', 'warn', 'error'].includes(level) ? level : 'info',
      messageKey: FIELD_EVENT,
      base: { peer: peerName, impl: IMPL, peer_id: peerId },
      timestamp: () => `,"${FIELD_TIME}":"${formatMicros(nowMicros())}"`,
      formatters: {
        // The Go peer writes the level in upper case.
        level: (label) => ({ level: label.toUpperCase() }),
      },
    },
    destination ?? pino.destination({ dest: 1, sync: true }),
  );
}
