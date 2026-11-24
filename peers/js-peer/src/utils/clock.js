// Wall-clock time in microseconds. Date.now() has milliseconds only, so the
// high-resolution clock gives the microseconds and Date.now() keeps it correct.

/** Correction of the high-resolution clock, ms. */
let offsetMs = 0;

/** Last time returned, in microseconds. The clock never goes back. */
let lastMicros = 0;

/**
 * Returns the current time in microseconds since the Unix epoch. If the
 * high-resolution time is outside [Date.now(), Date.now() + 1 ms), it is
 * moved to the nearest end.
 *
 * @returns {number} the time, in microseconds
 */
export const nowMicros = () => {
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
};

/**
 * Formats a time as RFC 3339 UTC with six fraction digits, as the Go peer.
 *
 * @param {number} micros - Unix time, in microseconds
 * @returns {string} for example 2026-11-23T04:52:22.279130Z
 */
export const formatMicros = (micros) => {
  const iso = new Date(Math.floor(micros / 1000)).toISOString(); // ...T04:52:22.279Z
  const extra = String(micros % 1000).padStart(3, '0');

  return `${iso.slice(0, -1)}${extra}Z`;
};
