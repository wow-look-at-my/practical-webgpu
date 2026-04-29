import { createHash } from 'node:crypto';
import { normalizeDefines } from './defines.js';
import { nodeFs } from './fs.js';
import type { Defines, FileSystem } from './types.js';

export function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Computes a deterministic sha256 over the source, all transitive includes, and
 * the final defines map. Any change to source content, included file content,
 * or defines (keys or values) will produce a different hash.
 *
 * Hash composition:
 *   sha256( sha256(source) + '|' + sha256(includes) + '|' + sha256(defines) )
 *
 * Includes are sorted by absolute path before hashing so the output is stable
 * regardless of include order. Define entries are normalised to a Map, sorted
 * by key, and joined as `key=value\n`.
 */
export async function computeSourceHash(
  source: string,
  includes: string[],
  options: { fs?: FileSystem; defines?: Defines } = {},
): Promise<string> {
  const fs = options.fs ?? nodeFs();
  const sortedIncludes = includes.slice().sort();

  const includeParts: string[] = [];
  for (const inc of sortedIncludes) {
    try {
      includeParts.push(sha256(await fs.readFile(inc)));
    } catch {
      // ignore -- error would have been raised during include expansion
    }
  }

  return sha256(
    [sha256(source), sha256(includeParts.join('|')), hashDefines(options.defines)].join('|'),
  );
}

function hashDefines(defines: Defines | undefined): string {
  if (!defines) return sha256('');
  const map = normalizeDefines(defines);
  const entries = [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  return sha256(entries.map(([k, v]) => `${k}=${v}`).join('\n'));
}
