/**
 * Programmatic API for the codegen pipeline.
 * Use the CLI for most tasks; import this for integration into custom build scripts.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import picomatch from 'picomatch';
import type { CodegenConfig, DefineMap } from './config.js';
import { discover } from './pipeline/discover.js';
import { emitTsModule } from './pipeline/emit/ts-module.js';
import { normalize } from './pipeline/normalize.js';
import { computeSourceHash, preprocess } from './pipeline/preprocess.js';
import { normalizeLF } from './util/formatter.js';

export { defineConfig, DEFAULT_CONFIG } from './config.js';
export type { CodegenConfig } from './config.js';

export interface CodegenResult {
  path: string;
  outputPath: string;
  changed: boolean;
}

export async function runCodegen(config: CodegenConfig, cwd: string): Promise<CodegenResult[]> {
  const shaders = await discover(config.shaders, cwd);
  const results: CodegenResult[] = [];

  for (const shader of shaders) {
    const absIncludePaths = config.includePaths.map((p) => resolve(cwd, p));
    const relPath = relative(cwd, shader.path);
    const defines = resolveShaderDefines(relPath, config);

    const { source: expanded, includes } = await preprocess(shader.path, shader.source, {
      extraIncludePaths: absIncludePaths,
      defines,
    });
    const sourceHash = await computeSourceHash(shader.source, includes, { defines });

    const ir = normalize(
      relPath,
      sourceHash,
      includes.map((p) => relative(cwd, p)),
      expanded,
    );

    const tsSource = emitTsModule(ir, expanded, config.runtimePackage);
    const outPath = resolveOutputPath(shader.path, cwd, config);

    const changed = await writeIfChanged(outPath, tsSource);
    results.push({ path: shader.path, outputPath: outPath, changed });

    if (config.emit.json) {
      const jsonPath = outPath.replace(/\.ts$/, '.refl.json');
      await writeIfChanged(jsonPath, `${JSON.stringify(ir, null, 2)}\n`);
    }
  }

  return results;
}

/**
 * Merge global `config.defines` with the first matching `shaderDefines` entry
 * for the given shader path. The shader path is the source path relative to
 * cwd. Glob matching uses picomatch.
 */
function resolveShaderDefines(relPath: string, config: CodegenConfig): DefineMap {
  let merged: DefineMap = { ...config.defines };
  for (const entry of config.shaderDefines) {
    const matcher = picomatch(entry.match);
    if (matcher(relPath)) {
      merged = { ...merged, ...entry.defines };
      break;
    }
  }
  return merged;
}

function resolveOutputPath(shaderPath: string, cwd: string, config: CodegenConfig): string {
  const rel = relative(cwd, shaderPath);
  const withoutExt = rel.replace(/\.wgsl$/, '.ts');
  return resolve(cwd, config.outDir, withoutExt);
}

async function writeIfChanged(outPath: string, content: string): Promise<boolean> {
  await mkdir(dirname(outPath), { recursive: true });
  const normalized = normalizeLF(content);
  let existing: string | null = null;
  try {
    existing = normalizeLF(await readFile(outPath, 'utf8'));
  } catch {
    // file doesn't exist yet
  }
  if (existing === normalized) return false;
  await writeFile(outPath, normalized, 'utf8');
  return true;
}
