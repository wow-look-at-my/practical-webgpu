import { describe, expect, it } from 'vitest';
import { computeSourceHash, memoryFs, preprocess } from '../src/index.js';

describe('preprocessor integration', () => {
  it('@define inside an included file is visible to outer @ifdef', async () => {
    const fs = memoryFs({
      '/shaders/main.wgsl': '@include "config.wgsli"\n@ifdef DEBUG\nlet d = 1;\n@endif\n',
      '/shaders/config.wgsli': '@define DEBUG 1\n',
    });
    const src = '@include "config.wgsli"\n@ifdef DEBUG\nlet d = 1;\n@endif\n';
    const result = await preprocess('/shaders/main.wgsl', src, { fs });
    expect(result.source).toContain('let d = 1;');
    expect(result.defines.get('DEBUG')).toBe('1');
  });

  it('@include inside a stripped @ifdef block is still read from disk', async () => {
    // This documents the deliberate ordering: includes happen before ifdefs,
    // so the include set is complete and stable for hashing even when the
    // surrounding block is later removed.
    const reads: string[] = [];
    const baseFs = memoryFs({
      '/shaders/main.wgsl': '@ifdef DEBUG\n@include "dbg.wgsli"\n@endif\n',
      '/shaders/dbg.wgsli': 'let dbg = 1;\n',
    });
    const fs = {
      readFile: async (p: string) => {
        reads.push(p);
        return baseFs.readFile(p);
      },
      exists: baseFs.exists,
    };
    const src = '@ifdef DEBUG\n@include "dbg.wgsli"\n@endif\n';
    const result = await preprocess('/shaders/main.wgsl', src, { fs });
    expect(reads).toContain('/shaders/dbg.wgsli'); // file WAS read
    expect(result.source).not.toContain('let dbg = 1;'); // body still stripped
    expect(result.includes).toEqual(['/shaders/dbg.wgsli']);
  });

  it('computeSourceHash is stable across runs with identical inputs', async () => {
    const fs = memoryFs({
      '/shaders/a.wgsli': 'const A: u32 = 1u;\n',
    });
    const src = 'fn main() {}\n';
    const h1 = await computeSourceHash(src, ['/shaders/a.wgsli'], { fs });
    const h2 = await computeSourceHash(src, ['/shaders/a.wgsli'], { fs });
    expect(h1).toBe(h2);
  });

  it('computeSourceHash differs when an included file changes', async () => {
    const src = 'fn main() {}\n';
    const fs1 = memoryFs({ '/shaders/a.wgsli': 'const A: u32 = 1u;\n' });
    const fs2 = memoryFs({ '/shaders/a.wgsli': 'const A: u32 = 2u;\n' });
    const h1 = await computeSourceHash(src, ['/shaders/a.wgsli'], { fs: fs1 });
    const h2 = await computeSourceHash(src, ['/shaders/a.wgsli'], { fs: fs2 });
    expect(h1).not.toBe(h2);
  });

  it('computeSourceHash differs when a define flips', async () => {
    const fs = memoryFs({});
    const src = 'fn main() {}\n';
    const h1 = await computeSourceHash(src, [], { fs });
    const h2 = await computeSourceHash(src, [], { fs, defines: { DEBUG: true } });
    const h3 = await computeSourceHash(src, [], { fs, defines: { DEBUG: 'verbose' } });
    expect(h1).not.toBe(h2);
    expect(h2).not.toBe(h3);
  });

  it('computeSourceHash is deterministic regardless of include order', async () => {
    const fs = memoryFs({
      '/shaders/a.wgsli': 'const A: u32 = 1u;\n',
      '/shaders/b.wgsli': 'const B: u32 = 2u;\n',
    });
    const src = 'fn main() {}\n';
    const h1 = await computeSourceHash(src, ['/shaders/a.wgsli', '/shaders/b.wgsli'], { fs });
    const h2 = await computeSourceHash(src, ['/shaders/b.wgsli', '/shaders/a.wgsli'], { fs });
    expect(h1).toBe(h2);
  });

  it('computeSourceHash is deterministic regardless of define key order', async () => {
    const fs = memoryFs({});
    const src = 'fn main() {}\n';
    const h1 = await computeSourceHash(src, [], {
      fs,
      defines: new Map([
        ['B', '2'],
        ['A', '1'],
      ]),
    });
    const h2 = await computeSourceHash(src, [], {
      fs,
      defines: new Map([
        ['A', '1'],
        ['B', '2'],
      ]),
    });
    expect(h1).toBe(h2);
  });

  it('matches an ao-gen-2-style multi-feature scenario end to end', async () => {
    // Approximates the ao_compute.wgsl shape: include common, ifdef variant,
    // define for Metal MSL workaround.
    const fs = memoryFs({
      '/shaders/main.wgsl': [
        '@include "common.wgsli"',
        '@ifdef COMPUTE_SHADER',
        'fn computeMain() { let c = LUMA; }',
        '@endif',
        '@ifdef PIXEL_SHADER',
        'fn pixelMain() {}',
        '@endif',
        '',
      ].join('\n'),
      '/shaders/common.wgsli': [
        '@pragma once',
        '@define LUMA vec3<f32>(0.2126, 0.7152, 0.0722)',
        'const PI: f32 = 3.14159;',
        '',
      ].join('\n'),
    });
    const src = await fs.readFile('/shaders/main.wgsl');
    const compute = await preprocess('/shaders/main.wgsl', src, {
      fs,
      defines: new Set(['COMPUTE_SHADER']),
    });
    expect(compute.source).toContain('fn computeMain()');
    expect(compute.source).toContain('let c = vec3<f32>(0.2126, 0.7152, 0.0722);');
    expect(compute.source).not.toContain('fn pixelMain()');

    const pixel = await preprocess('/shaders/main.wgsl', src, {
      fs,
      defines: new Set(['PIXEL_SHADER']),
    });
    expect(pixel.source).toContain('fn pixelMain()');
    expect(pixel.source).not.toContain('fn computeMain()');
  });
});
