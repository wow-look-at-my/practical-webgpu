import { dirname, resolve } from 'node:path';
import type { FileSystem } from './types.js';

export interface ExpandIncludesResult {
  source: string;
  includes: string[];
}

/**
 * Expands `@include "path.wgsli"` directives recursively and honours `@pragma once`.
 *
 * Only `.wgsli` files may be included -- `.wgsl` is reserved for entry points.
 *
 * Resolution: the include path is resolved first relative to the current file's
 * directory, then against each entry of `extraIncludePaths`. The first existing
 * candidate wins.
 *
 * `@pragma once` skips a file if it has already been included anywhere in this
 * compilation unit (keyed by resolved absolute path).
 *
 * Note: includes are expanded BEFORE `@ifdef` blocks are evaluated. An
 * `@include` inside an `@ifdef` block always reads its target from disk, even
 * if the surrounding block will later be stripped. This keeps the transitive
 * include set complete and stable for hashing.
 */
export async function expandIncludes(
  filePath: string,
  source: string,
  extraIncludePaths: string[],
  fs: FileSystem,
): Promise<ExpandIncludesResult> {
  const seen = new Set<string>();
  const order: string[] = [];
  const expanded = await expand(source, filePath, seen, order, extraIncludePaths, fs);
  return { source: expanded, includes: order };
}

async function expand(
  source: string,
  currentFile: string,
  seen: Set<string>,
  order: string[],
  extraIncludePaths: string[],
  fs: FileSystem,
): Promise<string> {
  const lines = source.split('\n');
  const out: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === '@pragma once') {
      // The @pragma once directive itself is consumed; dedup is handled per-file
      // when we attempt to include a file that has already been seen.
      continue;
    }

    const includeMatch = /^@include\s+"([^"]+)"/.exec(trimmed);
    if (!includeMatch) {
      out.push(line);
      continue;
    }

    const includeArg = includeMatch[1] ?? '';
    if (!includeArg.endsWith('.wgsli')) {
      throw new Error(
        `@include only accepts .wgsli files, got: "${includeArg}" (in ${currentFile})`,
      );
    }

    const candidates = [
      resolve(dirname(currentFile), includeArg),
      ...extraIncludePaths.map((base) => resolve(base, includeArg)),
    ];
    let resolvedPath: string | null = null;
    for (const candidate of candidates) {
      if (await fs.exists(candidate)) {
        resolvedPath = candidate;
        break;
      }
    }
    if (!resolvedPath) {
      throw new Error(
        `Cannot find @include file: "${includeArg}" (from ${currentFile})\n  Searched: ${candidates.join(', ')}`,
      );
    }

    if (seen.has(resolvedPath)) {
      continue;
    }
    seen.add(resolvedPath);
    order.push(resolvedPath);

    const includedSource = await fs.readFile(resolvedPath);
    const expanded = await expand(includedSource, resolvedPath, seen, order, extraIncludePaths, fs);
    out.push(expanded);
  }

  return out.join('\n');
}
