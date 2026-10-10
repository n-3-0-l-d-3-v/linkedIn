/**
 * VOUCH-3 — request validation.
 *
 * Small, dependency-free checks applied at the top of every write endpoint,
 * before any engine or storage call. Two concrete bugs motivated this file:
 *
 *   - `pitch: 42` (a number, not a string) reached `pitch.trim()` unchecked
 *     and threw, surfacing as an opaque 500 instead of a clear 422.
 *   - `office-hours { open: "no" }` — a truthy JS string — silently opened
 *     office hours, because the handler did `!!open` instead of checking the
 *     type. A caller who sends the string "no" almost certainly means false.
 *
 * The fix in both cases is the same shape: validate type and shape explicitly
 * at the boundary, and never let a JS truthiness coercion stand in for a
 * boolean check on external input.
 */

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.status = 422;
  }
}

const fail = (msg) => { throw new ValidationError(msg); };

// Exported so a call site can throw a custom-worded validation failure (e.g.
// a friendlier message than the generic one) without re-deriving how 4xx
// errors get shaped.
export const failWith = fail;

export const isString = (v) => typeof v === 'string';
export const isBoolean = (v) => typeof v === 'boolean';
export const isPlainArray = (v) => Array.isArray(v);

export function requireString(value, field, { minLength = 1, maxLength = 10_000 } = {}) {
  if (!isString(value)) fail(`"${field}" must be a string, got ${typeof value}`);
  const trimmed = value.trim();
  if (trimmed.length < minLength) fail(`"${field}" must be at least ${minLength} characters`);
  if (value.length > maxLength) fail(`"${field}" must be at most ${maxLength} characters`);
  return trimmed;
}

export function optionalString(value, field, opts) {
  return value == null ? null : requireString(value, field, { minLength: 0, ...opts });
}

/**
 * Strict boolean — deliberately rejects truthy/falsy strings like "no" or
 * "false", which JS's own `!!x` would silently accept as `true`. This is the
 * exact bug this file exists to close.
 */
export function requireBoolean(value, field) {
  if (!isBoolean(value)) fail(`"${field}" must be true or false, got ${JSON.stringify(value)}`);
  return value;
}

export function optionalBoolean(value, field) {
  return value == null ? undefined : requireBoolean(value, field);
}

export function requireOneOf(value, allowed, field) {
  if (!allowed.includes(value)) fail(`"${field}" must be one of: ${allowed.join(', ')} — got ${JSON.stringify(value)}`);
  return value;
}

export function optionalStringArray(value, field, { maxItems = 50 } = {}) {
  if (value == null) return [];
  if (!isPlainArray(value)) fail(`"${field}" must be an array`);
  if (value.length > maxItems) fail(`"${field}" may have at most ${maxItems} items`);
  if (!value.every(isString)) fail(`every item in "${field}" must be a string`);
  return value;
}

export function requireInt(value, field, { min = -Infinity, max = Infinity } = {}) {
  if (!Number.isInteger(value)) fail(`"${field}" must be an integer, got ${JSON.stringify(value)}`);
  if (value < min || value > max) fail(`"${field}" must be between ${min} and ${max}`);
  return value;
}

export function optionalInt(value, field, opts) {
  return value == null ? undefined : requireInt(value, field, opts);
}

/** Wraps an Express handler so a thrown ValidationError becomes a clean 4xx JSON response instead of falling through to the generic 500 handler. */
export function withValidation(handler) {
  return (req, res, next) => {
    try {
      handler(req, res, next);
    } catch (err) {
      if (err instanceof ValidationError) {
        res.status(err.status).json({ ok: false, error: err.message });
      } else {
        next(err);
      }
    }
  };
}
