import { sha256 } from '@practical-webgpu/preprocessor';

export { sha256 };

export const BANNER_PREFIX = '// AUTO-GENERATED -- DO NOT EDIT.';

export function makeBanner(sourcePath: string, sha256: string): string {
  return `${BANNER_PREFIX} Source: ${sourcePath}  sha256: ${sha256.slice(0, 16)}\n`;
}

/** Stable JSON stringify with sorted keys (for deterministic output). */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, sortedReplacer, 2);
}

function sortedReplacer(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
    );
  }
  return value;
}

/** Normalise line endings to LF. */
export function normalizeLF(s: string): string {
  return s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}
