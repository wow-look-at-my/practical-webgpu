import type { ScalarKind } from '../ir/types.js';

export const SCALAR_NAMES = new Set<ScalarKind>(['f32', 'i32', 'u32', 'bool', 'f16']);

export function isScalarName(name: string): name is ScalarKind {
  return SCALAR_NAMES.has(name as ScalarKind);
}

/** Parse "vecN" → N, or null if not a vec type. */
export function parseVecName(name: string): 2 | 3 | 4 | null {
  const m = /^vec([234])$/.exec(name);
  if (!m) return null;
  return parseInt(m[1]!, 10) as 2 | 3 | 4;
}

/** Parse "matCxR" → { cols, rows }, or null. */
export function parseMatName(name: string): { cols: number; rows: number } | null {
  const m = /^mat([234])x([234])$/.exec(name);
  if (!m) return null;
  return { cols: parseInt(m[1]!, 10), rows: parseInt(m[2]!, 10) };
}

/**
 * Map a WGSL scalar type to the GPUVertexFormat used for single-component vertex attrs.
 * Vectors are handled by calling code.
 */
export const SCALAR_VERTEX_FORMAT: Partial<Record<ScalarKind, string>> = {
  f32: 'float32',
  i32: 'sint32',
  u32: 'uint32',
};
