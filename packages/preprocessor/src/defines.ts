import type { Defines } from './types.js';

/**
 * Normalise the public {@link Defines} surface into a single internal `Map`.
 *
 * - `Set<string>`: each member becomes `name -> ''`.
 * - `Map<string, string>`: copied through.
 * - `Record<string, string | true>`: `true` becomes `''`, otherwise the string is preserved.
 */
export function normalizeDefines(defines: Defines): Map<string, string> {
  if (defines instanceof Map) return new Map(defines);
  if (defines instanceof Set) {
    const m = new Map<string, string>();
    for (const k of defines) m.set(k, '');
    return m;
  }
  const m = new Map<string, string>();
  for (const [k, v] of Object.entries(defines)) {
    m.set(k, v === true ? '' : v);
  }
  return m;
}

/**
 * Scan for `@define NAME value` directives, mutate the running `defines` map,
 * and remove the directive lines from the source. Substitution is deliberately
 * NOT done here -- callers run `@ifdef` evaluation between collection and
 * substitution so that `@ifdef SYMBOL` lookups see the raw symbol name.
 *
 * Source-level directives override user-passed values for the same symbol
 * (the last write wins, so a later `@define X 2` wins over an earlier `@define X 1`).
 *
 * The directive line is replaced with an empty string in place; the trailing
 * newline is preserved so downstream line numbers don't shift.
 */
export function collectDefines(source: string, defines: Map<string, string>): string {
  const defineRegex = /^[ \t]*@define[ \t]+(\w+)[ \t]+(.+?)[ \t]*$/gm;
  return source.replace(defineRegex, (_, name: string, value: string) => {
    defines.set(name, value);
    return '';
  });
}

/**
 * Substitute every whole-word occurrence of a defined name with its value.
 *
 * - Names with empty-string values are skipped (they exist solely as `@ifdef` markers).
 * - Names are processed longest-first so prefixes don't partially match
 *   (e.g. `FOO_BAR` is replaced before `FOO`).
 * - Substitution is non-recursive within a single name's pass, but later passes
 *   may still substitute tokens that earlier passes inserted (this is the
 *   ao-gen-2 behavior; see tests).
 */
export function substituteDefines(source: string, defines: Map<string, string>): string {
  if (defines.size === 0) return source;
  const names = [...defines.keys()].sort((a, b) => b.length - a.length);
  let result = source;
  for (const name of names) {
    const value = defines.get(name);
    if (value === undefined || value === '') continue;
    result = result.replace(new RegExp(`\\b${name}\\b`, 'g'), value);
  }
  return result;
}
