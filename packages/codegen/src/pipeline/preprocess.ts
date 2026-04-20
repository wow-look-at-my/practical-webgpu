import { readFile } from 'node:fs/promises';
import { access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { sha256 } from '../util/formatter.js';

export interface PreprocessResult {
  source: string;
  includes: string[];
}

/**
 * Expands @include "path.wgsli" directives and honours @pragma once.
 *
 * Only .wgsli files may be included — .wgsl files are entry points, not includes.
 * @pragma once prevents a file from being included more than once per compilation unit.
 * Include paths are resolved: first relative to the current file, then relative
 * to each directory in extraIncludePaths.
 */
export async function preprocess(
  filePath: string,
  source: string,
  extraIncludePaths: string[] = [],
): Promise<PreprocessResult> {
  const includedPaths = new Set<string>();
  const includedList: string[] = [];

  const expanded = await expandIncludes(
    source,
    filePath,
    includedPaths,
    includedList,
    extraIncludePaths,
  );
  return { source: expanded, includes: includedList };
}

async function expandIncludes(
  source: string,
  currentFile: string,
  includedPaths: Set<string>,
  includedList: string[],
  extraIncludePaths: string[],
): Promise<string> {
  const lines = source.split('\n');
  const resultLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === '@pragma once') {
      continue;
    }

    const includeMatch = /^@include\s+"([^"]+)"/.exec(trimmed);
    if (includeMatch) {
      const includeArg = includeMatch[1]!;
      if (!includeArg.endsWith('.wgsli')) {
        throw new Error(
          `@include only accepts .wgsli files, got: "${includeArg}" (in ${currentFile})`,
        );
      }

      // Resolve: try relative to current file first, then extraIncludePaths
      const candidates = [
        resolve(dirname(currentFile), includeArg),
        ...extraIncludePaths.map((base) => resolve(base, includeArg)),
      ];
      let resolvedPath: string | null = null;
      for (const candidate of candidates) {
        try {
          await access(candidate);
          resolvedPath = candidate;
          break;
        } catch {
          /* try next */
        }
      }
      if (!resolvedPath) {
        throw new Error(
          `Cannot find @include file: "${includeArg}" (from ${currentFile})\n  Searched: ${candidates.join(', ')}`,
        );
      }

      if (includedPaths.has(resolvedPath)) {
        continue;
      }
      includedPaths.add(resolvedPath);
      includedList.push(resolvedPath);

      const includedSource = await readFile(resolvedPath, 'utf8');
      const expanded = await expandIncludes(
        includedSource,
        resolvedPath,
        includedPaths,
        includedList,
        extraIncludePaths,
      );
      resultLines.push(expanded);
      continue;
    }

    resultLines.push(line);
  }

  return resultLines.join('\n');
}

/**
 * Computes a combined sha256 of the source and all its transitive includes.
 * Changes to any included file invalidate the codegen output.
 *
 * Deterministic across machines: hashes content only, never absolute paths.
 */
export async function computeSourceHash(source: string, includes: string[]): Promise<string> {
  const parts: string[] = [sha256(source)];
  for (const inc of includes.slice().sort()) {
    try {
      const content = await readFile(inc, 'utf8');
      parts.push(sha256(content));
    } catch {
      // ignore — error would have been caught in expandIncludes
    }
  }
  return sha256(parts.join('|'));
}
