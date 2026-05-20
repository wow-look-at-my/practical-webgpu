import { collectDefines, normalizeDefines, substituteDefines } from './defines.js';
import { nodeFs } from './fs.js';
import { processIfdefs } from './ifdefs.js';
import { expandIncludes } from './includes.js';
import type { PreprocessOptions, PreprocessResult } from './types.js';

/**
 * Run the full WGSL preprocessor pipeline:
 *
 *   1. `@include` + `@pragma once`  -- recursive file inclusion
 *   2. `@define`                    -- collect directives, populate defines map (no substitution yet)
 *   3. `@ifdef SYMBOL ... @endif`   -- conditional compilation, sees raw symbol names
 *   4. `@define`                    -- substitute defined names with their values
 *
 * Splitting `@define` into collect-then-substitute and running `@ifdef` in
 * between is essential: it prevents value substitution from rewriting symbol
 * names inside `@ifdef SYMBOL` directives.
 *
 * @param filePath - Path of the entry-point file (used for error messages and
 *                   for resolving relative `@include` paths).
 * @param source - Raw WGSL source. Pass the file content yourself so callers
 *                 control how the entry point is read (HTTP, fs, bundler, etc.).
 * @param options - See {@link PreprocessOptions}.
 */
export async function preprocess(
  filePath: string,
  source: string,
  options: PreprocessOptions = {},
): Promise<PreprocessResult> {
  const fs = options.fs ?? nodeFs();
  const extraIncludePaths = options.extraIncludePaths ?? [];
  const defines = options.defines ? normalizeDefines(options.defines) : new Map<string, string>();

  const { source: includedSource, includes } = await expandIncludes(
    filePath,
    source,
    extraIncludePaths,
    fs,
  );

  const sourceWithoutDefineDirectives = collectDefines(includedSource, defines);
  const afterIfdefs = processIfdefs(sourceWithoutDefineDirectives, defines, filePath);
  const finalSource = substituteDefines(afterIfdefs, defines);

  return { source: finalSource, includes, defines };
}
