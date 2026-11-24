import pino from 'pino';

import { IMPL } from './constants.js';
import { formatMicros, nowMicros } from './utils/clock.js';

// Field names of each log line, as the Go peer.
export const FIELD_TIME = 'ts';
export const FIELD_EVENT = 'event';

/**
 * Returns the logger: one JSON line per event on stdout, as logger.info(fields, EVENT).
 *
 * @param {object} options
 * @param {string} options.level - debug, info, warn or error; else info
 * @param {string} options.peerName - name of this peer
 * @param {string} options.peerId - peer ID of this peer; empty if not known
 * @param {import('pino').DestinationStream} [options.destination] - output; stdout by default
 * @returns {import('pino').Logger} the logger
 */
export const createLogger = ({ level, peerName, peerId, destination }) => {
  return pino(
    {
      level: ['debug', 'info', 'warn', 'error'].includes(level) ? level : 'info',
      messageKey: FIELD_EVENT,
      base: { peer: peerName, impl: IMPL, peer_id: peerId },
      timestamp: () => `,"${FIELD_TIME}":"${formatMicros(nowMicros())}"`,
      formatters: {
        // Upper case, as the Go peer.
        level: (label) => ({ level: label.toUpperCase() }),
      },
    },
    destination ?? pino.destination({ dest: 1, sync: true }),
  );
};
