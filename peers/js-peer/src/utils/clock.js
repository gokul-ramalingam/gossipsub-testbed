/**
 * Wall-clock time with microsecond resolution. Date.now() has milliseconds
 * only; the Go peer writes ts and ts_us in microseconds from the wall clock.
 * The high-resolution clock (performance.timeOrigin + performance.now()) gives
 * the microseconds. It follows the wall clock of the process start, and can
 * drift from it when the system clock is changed or slewed (a VM syncs its
 * clock, for example), so it is kept within the millisecond that Date.now()
 * gives at each call.
 */

/** Correction of the high-resolution clock to the wall clock, in milliseconds. */
let offsetMs = 0;

/** Last time returned, in microseconds; the clock never goes back from it. */
let lastMicros = 0;

/**
 * Returns the current time in microseconds since the Unix epoch.
 *
 * Date.now() is the wall clock rounded down to the millisecond, so a correct
 * time is in [Date.now(), Date.now() + 1 ms). When the high-resolution time is
 * outside, it is moved to the nearest end of the range, by no more than it is
 * outside. Over many calls, the times fall at all points of the millisecond,
 * so the correction converges to the true offset. Date.now() is read before
 * the high-resolution clock, so a millisecond can end between the two reads;
 * the time is then up to the gap between the reads (microseconds) above the
 * range and is moved back by that much only.
 *
 * The time never goes back, so a latency measured within one process is
 * never negative.
 *
 * @returns {number} the time in microseconds
 */
export function nowMicros() {
  const wallMs = Date.now();
  let ms = performance.timeOrigin + performance.now() + offsetMs;

  if (ms < wallMs) {
    offsetMs += wallMs - ms;
    ms = wallMs;
  } else if (ms >= wallMs + 1) {
    const over = ms - (wallMs + 1) + 0.001;
    offsetMs -= over;
    ms -= over;
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
