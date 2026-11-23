/**
 * Durations in the format of Go's time.ParseDuration, for example 5s, 200ms or
 * 1m30s, so that the Go and JS peers accept the same REDIAL_INTERVAL values.
 */

/** Milliseconds per unit. */
const UNIT_MS = {
  ns: 1e-6,
  us: 1e-3,
  µs: 1e-3, // U+00B5 MICRO SIGN
  μs: 1e-3, // U+03BC GREEK SMALL LETTER MU
  ms: 1,
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
};

/** One number with its unit, for example 1.5s. */
const PART = /(\d+(?:\.\d*)?|\.\d+)(ns|us|µs|μs|ms|s|m|h)/gy;

/**
 * Parses a duration such as 5s, 200ms or 1m30s into milliseconds. As in Go, a
 * sign is allowed, "0" needs no unit, and any other number needs one.
 *
 * @param {string} text - the duration
 * @returns {number} the duration in milliseconds
 * @throws {Error} if the text is not a duration
 */
export function parseDuration(text) {
  let rest = text;
  let sign = 1;

  if (rest.startsWith('-') || rest.startsWith('+')) {
    sign = rest.startsWith('-') ? -1 : 1;
    rest = rest.slice(1);
  }

  if (rest === '0') {
    return 0;
  }

  if (rest === '') {
    throw new Error(`invalid duration ${JSON.stringify(text)}`);
  }

  let ms = 0;
  PART.lastIndex = 0;

  while (PART.lastIndex < rest.length) {
    const match = PART.exec(rest);
    if (match === null) {
      throw new Error(`invalid duration ${JSON.stringify(text)}`);
    }

    ms += Number(match[1]) * UNIT_MS[match[2]];
  }

  return sign * ms;
}

/**
 * Formats milliseconds as a duration, for example 5s or 200ms, close to the
 * String form of a Go time.Duration for the values that the peer uses.
 *
 * @param {number} ms - the duration in milliseconds
 * @returns {string} the duration
 */
export function formatDuration(ms) {
  return ms >= 1000 ? `${ms / 1000}s` : `${ms}ms`;
}
