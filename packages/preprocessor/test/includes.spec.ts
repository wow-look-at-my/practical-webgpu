import { describe, expect, it } from 'vitest';
import { memoryFs, preprocess } from '../src/index.js';

describe('@include', () => {
  it('expands a single include inline', async () => {
    const fs = memoryFs({
      '/shaders/main.wgsl': '@include "common.wgsli"\nfn main() {}\n',
      '/shaders/common.wgsli': 'const X: u32 = 1u;\n',
    });
    const result = await preprocess(
      '/shaders/main.wgsl',
      '@include "common.wgsli"\nfn main() {}\n',
      { fs },
    );
    expect(result.source).toContain('const X: u32 = 1u;');
    expect(result.source).toContain('fn main() {}');
    expect(result.includes).toEqual(['/shaders/common.wgsli']);
  });

  it('expands recursively (A includes B includes C)', async () => {
    const fs = memoryFs({
      '/shaders/a.wgsl': '@include "b.wgsli"\n',
      '/shaders/b.wgsli': '@include "c.wgsli"\nconst B: u32 = 2u;\n',
      '/shaders/c.wgsli': 'const C: u32 = 3u;\n',
    });
    const result = await preprocess('/shaders/a.wgsl', '@include "b.wgsli"\n', { fs });
    expect(result.source).toContain('const C: u32 = 3u;');
    expect(result.source).toContain('const B: u32 = 2u;');
    expect(result.includes).toEqual(['/shaders/b.wgsli', '/shaders/c.wgsli']);
  });

  it('@pragma once dedups across multiple includes', async () => {
    const fs = memoryFs({
      '/shaders/main.wgsl': '@include "a.wgsli"\n@include "b.wgsli"\n',
      '/shaders/a.wgsli': '@include "common.wgsli"\nconst A: u32 = 1u;\n',
      '/shaders/b.wgsli': '@include "common.wgsli"\nconst B: u32 = 2u;\n',
      '/shaders/common.wgsli': '@pragma once\nconst C: u32 = 3u;\n',
    });
    const src = '@include "a.wgsli"\n@include "b.wgsli"\n';
    const result = await preprocess('/shaders/main.wgsl', src, { fs });
    const matches = result.source.match(/const C: u32 = 3u;/g) ?? [];
    expect(matches).toHaveLength(1);
    expect(result.includes).toContain('/shaders/common.wgsli');
    // common.wgsli should only appear once in the order list
    expect(result.includes.filter((p) => p === '/shaders/common.wgsli')).toHaveLength(1);
  });

  it('rejects @include of .wgsl files', async () => {
    const fs = memoryFs({
      '/shaders/main.wgsl': '@include "other.wgsl"\n',
    });
    await expect(
      preprocess('/shaders/main.wgsl', '@include "other.wgsl"\n', { fs }),
    ).rejects.toThrow(/@include only accepts \.wgsli files/);
  });

  it('throws a descriptive error when include is missing', async () => {
    const fs = memoryFs({
      '/shaders/main.wgsl': '@include "missing.wgsli"\n',
    });
    await expect(
      preprocess('/shaders/main.wgsl', '@include "missing.wgsli"\n', { fs }),
    ).rejects.toThrow(/Cannot find @include file: "missing\.wgsli"/);
  });

  it('falls back to extraIncludePaths when not found relative to current file', async () => {
    const fs = memoryFs({
      '/project/shaders/main.wgsl': '@include "shared.wgsli"\n',
      '/project/common/shared.wgsli': 'const S: u32 = 7u;\n',
    });
    const result = await preprocess('/project/shaders/main.wgsl', '@include "shared.wgsli"\n', {
      fs,
      extraIncludePaths: ['/project/common'],
    });
    expect(result.source).toContain('const S: u32 = 7u;');
    expect(result.includes).toEqual(['/project/common/shared.wgsli']);
  });

  it('strips @pragma once directive lines from output', async () => {
    const fs = memoryFs({
      '/shaders/main.wgsl': '@include "x.wgsli"\n',
      '/shaders/x.wgsli': '@pragma once\nconst X: u32 = 1u;\n',
    });
    const result = await preprocess('/shaders/main.wgsl', '@include "x.wgsli"\n', { fs });
    expect(result.source).not.toContain('@pragma once');
    expect(result.source).toContain('const X: u32 = 1u;');
  });
});
