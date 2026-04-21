#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { watch } from 'chokidar';
import { Command } from 'commander';
import type { CodegenConfig } from './config.js';
import { DEFAULT_CONFIG, runCodegen } from './index.js';
import { normalize } from './pipeline/normalize.js';
import { preprocess } from './pipeline/preprocess.js';

const program = new Command();

program
  .name('webgpu-codegen')
  .description('Offline WGSL shader reflection and TypeScript codegen')
  .version('0.1.0');

program
  .command('build')
  .description('Run codegen once and write generated files')
  .option('-c, --config <path>', 'Config file path', 'webgpu-codegen.config.ts')
  .option('--check', 'Exit non-zero if any output would change (CI mode)')
  .action(async (opts: { config: string; check: boolean }) => {
    const config = await loadConfig(opts.config);
    const cwd = process.cwd();
    const results = await runCodegen(config, cwd);

    let anyChanged = false;
    for (const r of results) {
      const rel = relative(cwd, r.outputPath);
      if (r.changed) {
        anyChanged = true;
        console.log(opts.check ? `  STALE  ${rel}` : `  WROTE  ${rel}`);
      } else {
        console.log(`  OK     ${rel}`);
      }
    }

    if (opts.check && anyChanged) {
      console.error('\nGenerated files are out of date. Run `webgpu-codegen build` to update.');
      process.exit(1);
    }
  });

program
  .command('watch')
  .description('Watch .wgsl files and regenerate on change')
  .option('-c, --config <path>', 'Config file path', 'webgpu-codegen.config.ts')
  .action(async (opts: { config: string }) => {
    const config = await loadConfig(opts.config);
    const cwd = process.cwd();

    // Initial build
    await runCodegen(config, cwd);
    console.log('Watching for changes…');

    const watcher = watch([...config.shaders, '**/*.wgsli'], { cwd, ignoreInitial: true });
    watcher.on('change', async (path) => {
      console.log(`  CHANGE ${path}`);
      try {
        await runCodegen(config, cwd);
        console.log('  OK');
      } catch (err) {
        console.error('  ERROR:', err);
      }
    });
  });

program
  .command('print <shader>')
  .description('Print normalized reflection IR for a shader (for debugging)')
  .action(async (shaderPath: string) => {
    const absPath = resolve(shaderPath);
    const source = await readFile(absPath, 'utf8');
    const { source: expanded, includes } = await preprocess(absPath, source);
    const ir = normalize(absPath, 'debug', includes, expanded);
    console.log(JSON.stringify(ir, null, 2));
  });

program.parse();

// ─── Config loader ────────────────────────────────────────────────────────────

async function loadConfig(configPath: string): Promise<CodegenConfig> {
  const absPath = resolve(configPath);
  try {
    const mod = (await import(pathToFileURL(absPath).href)) as { default?: CodegenConfig };
    return mod.default ?? DEFAULT_CONFIG;
  } catch {
    return DEFAULT_CONFIG;
  }
}
