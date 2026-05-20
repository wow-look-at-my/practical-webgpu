import { describe, expect, it } from 'vitest';
import { memoryFs, preprocess } from '../src/index.js';

describe('@ifdef / @endif', () => {
  it('keeps body when symbol is defined (Set)', async () => {
    const fs = memoryFs({});
    const src = '@ifdef DEBUG\nlet d = 1;\n@endif\nlet other = 2;\n';
    const result = await preprocess('/main.wgsl', src, {
      fs,
      defines: new Set(['DEBUG']),
    });
    expect(result.source).toContain('let d = 1;');
    expect(result.source).toContain('let other = 2;');
    expect(result.source).not.toContain('@ifdef');
    expect(result.source).not.toContain('@endif');
  });

  it('removes body when symbol is not defined', async () => {
    const fs = memoryFs({});
    const src = '@ifdef DEBUG\nlet d = 1;\n@endif\nlet other = 2;\n';
    const result = await preprocess('/main.wgsl', src, { fs });
    expect(result.source).not.toContain('let d = 1;');
    expect(result.source).toContain('let other = 2;');
  });

  it('keeps body when symbol is defined via source-level @define', async () => {
    const fs = memoryFs({});
    const src = '@define DEBUG 1\n@ifdef DEBUG\nlet d = 1;\n@endif\n';
    const result = await preprocess('/main.wgsl', src, { fs });
    expect(result.source).toContain('let d = 1;');
  });

  it('keeps body when symbol has empty-string value (Set or Map with "")', async () => {
    const fs = memoryFs({});
    const src = '@ifdef MARKER\nlet m = 1;\n@endif\n';
    const result = await preprocess('/main.wgsl', src, {
      fs,
      defines: new Map([['MARKER', '']]),
    });
    expect(result.source).toContain('let m = 1;');
  });

  it('throws with file path and line number when @endif is missing', async () => {
    const fs = memoryFs({});
    const src = 'let pre = 0;\n@ifdef DEBUG\nlet d = 1;\nlet still_inside = 2;\n';
    await expect(preprocess('/main.wgsl', src, { fs })).rejects.toThrow(
      /@ifdef DEBUG is missing a matching @endif.*\/main\.wgsl.*line 2/,
    );
  });

  it('handles multiple sequential @ifdef blocks independently', async () => {
    const fs = memoryFs({});
    const src = '@ifdef A\nlet a = 1;\n@endif\n@ifdef B\nlet b = 2;\n@endif\nlet c = 3;\n';
    const result = await preprocess('/main.wgsl', src, {
      fs,
      defines: new Set(['A']),
    });
    expect(result.source).toContain('let a = 1;');
    expect(result.source).not.toContain('let b = 2;');
    expect(result.source).toContain('let c = 3;');
  });
});
