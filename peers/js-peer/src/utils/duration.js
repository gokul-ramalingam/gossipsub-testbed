// Durations in the format of Go time.ParseDuration, such as 5s, 200ms or 1m30s.

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

/** One number and its unit, such as 1.5s. */
const PART = /(\d+(?:\.\d*)?|\.\d+)(ns|us|µs|μs|ms|s|m|h)/gy;

/**
 * Parses a duration into milliseconds. As in Go, "0" needs no unit.
 *
 * @param {string} text - the duration
 * @returns {number} the duration, ms
 * @throws {Error} if the text is not a duration
 */
export const parseDuration = (text) => {
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
};

/**
 * Formats milliseconds as a duration, such as 5s or 200ms.
 *
 * @param {number} ms - the duration, ms
 * @returns {string} the duration
 */
export const formatDuration = (ms) => {
  return ms >= 1000 ? `${ms / 1000}s` : `${ms}ms`;
};
