/**
 * MCP tool annotations (readOnlyHint, destructiveHint, idempotentHint) for the
 * pro tools. Every tool declares its class here so a client -- or an
 * aggregator's read-only toolset such as muster's `preset:read-only`, which is
 * an annotation predicate -- can tell the reads from the writes. A tool
 * without annotations is treated as a destructive write by the MCP defaults.
 *
 * openWorldHint is left to the MCP default (true): every tool talks to
 * GitHub's API.
 */

/** A tool that reads GitHub and changes nothing. */
export const READ_ONLY = Object.freeze({
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true
});

/** A write that only adds (create, add to a board): repeating it adds again unless noted. */
export function additiveWrite({ idempotent = false } = {}) {
  return Object.freeze({
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: idempotent
  });
}

/** A write that changes or removes what exists (set a field, close, archive, remove). */
export function destructiveWrite({ idempotent = true } = {}) {
  return Object.freeze({
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: idempotent
  });
}
