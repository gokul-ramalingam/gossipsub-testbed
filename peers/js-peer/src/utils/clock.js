/**
 * Wall-clock time with microsecond resolution. Date.now() has milliseconds
 * only; the Go peer writes ts and ts_us in microseconds. The high-resolution
 * clock (performance.timeOrigin + performance.now()) gives the microseconds.
 * It follows the wall clock of the process start and drifts from it only
 * when the system clock is changed or slewed, so it is put back on the wall
 * clock when the two differ by more than MAX_DRIFT_MS.
 */

/** Largest difference to the wall clock before a correction, in milliseconds. */
const MAX_DRIFT_MS = 2;

/** Correction of the high-resolution clock to the wall clock, in milliseconds. */
let offsetMs = 0;

/** Last time returned, in microseconds; the clock never goes back from it. */
let lastMicros = 0;

/**
 * Returns the current time in microseconds since the Unix epoch. The time
 * never goes back, so a latency measured within one process is never negative.
 *
 * Date.now() is read before the high-resolution clock, so the two reads can
 * fall in different milliseconds, more so on a busy machine. A tolerance of
 * MAX_DRIFT_MS keeps such a pair from being taken for a drift.
 *
 * @returns {number} the time in microseconds
 */
export function nowMicros() {
  const wallMs = Date.now();
  let ms = performance.timeOrigin + performance.now() + offsetMs;

  if (Math.abs(ms - (wallMs + 0.5)) > MAX_DRIFT_MS) {
    offsetMs += wallMs + 0.5 - ms;
    ms = wallMs + 0.5;
  }

  lastMicros = Math.max(lastMicros, Math.floor(ms * 1000));

  return lastMicros;
}

/**
 * Formats a time in microseconds as RFC 3339 in UTC with exactly six fraction
 * digits, the format of the ts field of the Go peer.
 *
 * @param {number} micros - time in microseconds since the Unix epoch
 * @returns {string} for example 2026-11-23T04:52:22.279130Z
 */
export function formatMicros(micros) {
  const iso = new Date(Math.floor(micros / 1000)).toISOString(); // ...T04:52:22.279Z
  const extra = String(micros % 1000).padStart(3, '0');

  return `${iso.slice(0, -1)}${extra}Z`;
}
