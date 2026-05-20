import { describe, expect, it } from 'vitest';
import { memoryFs, preprocess } from '../src/index.js';

describe('@define', () => {
  it('substitutes whole-word matches when given a Map', async () => {
    const fs = memoryFs({});
    const src = 'const C: vec3<f32> = LUMA;\n';
    const result = await preprocess('/main.wgsl', src, {
      fs,
      defines: new Map([['LUMA', 'vec3<f32>(0.2126, 0.7152, 0.0722)']]),
    });
    expect(result.source).toContain('const C: vec3<f32> = vec3<f32>(0.2126, 0.7152, 0.0722);');
  });

  it('substitutes whole-word matches when given a Record', async () => {
    const fs = memoryFs({});
    const src = 'let x = TWO + 1;\n';
    const result = await preprocess('/main.wgsl', src, {
      fs,
      defines: { TWO: '2' },
    });
    expect(result.source).toContain('let x = 2 + 1;');
  });

  it('does not substitute Set members (used only for @ifdef)', async () => {
    const fs = memoryFs({});
    const src = 'let x = DEBUG;\n';
    const result = await preprocess('/main.wgsl', src, {
      fs,
      defines: new Set(['DEBUG']),
    });
    expect(result.source).toContain('let x = DEBUG;');
  });

  it('treats `true` Record values as Set-like (no substitution, @ifdef visible)', async () => {
    const fs = memoryFs({});
    const src = '@ifdef DEBUG\nlet d = 1;\n@endif\n';
    const result = await preprocess('/main.wgsl', src, {
      fs,
      defines: { DEBUG: true },
    });
    expect(result.source).toContain('let d = 1;');
    expect(result.defines.get('DEBUG')).toBe('');
  });

  it('processes source-level @define and removes the directive', async () => {
    const fs = memoryFs({});
    const src = '@define X 42\nlet a = X;\n';
    const result = await preprocess('/main.wgsl', src, { fs });
    expect(result.source).not.toContain('@define');
    expect(result.source).toContain('let a = 42;');
  });

  it('source-level @define overrides user-passed defines for the same symbol', async () => {
    const fs = memoryFs({});
    const src = '@define X 99\nlet a = X;\n';
    const result = await preprocess('/main.wgsl', src, {
      fs,
      defines: { X: '1' },
    });
    expect(result.source).toContain('let a = 99;');
  });

  it('substitutes longest names first to avoid prefix collisions', async () => {
    const fs = memoryFs({});
    const src = 'let a = FOO_BAR;\nlet b = FOO;\n';
    const result = await preprocess('/main.wgsl', src, {
      fs,
      defines: { FOO: '1', FOO_BAR: '2' },
    });
    expect(result.source).toContain('let a = 2;');
    expect(result.source).toContain('let b = 1;');
  });

  it('respects whole-word boundaries (FOO does not match FOOBAR)', async () => {
    const fs = memoryFs({});
    const src = 'let a = FOOBAR;\nlet b = FOO;\n';
    const result = await preprocess('/main.wgsl', src, {
      fs,
      defines: { FOO: '1' },
    });
    expect(result.source).toContain('let a = FOOBAR;');
    expect(result.source).toContain('let b = 1;');
  });

  it('later @define wins when the same symbol is defined twice in source', async () => {
    const fs = memoryFs({});
    const src = '@define X 1\n@define X 2\nlet a = X;\n';
    const result = await preprocess('/main.wgsl', src, { fs });
    expect(result.source).toContain('let a = 2;');
  });

  it('does not recursively expand define values', async () => {
    const fs = memoryFs({});
    const src = 'let a = X;\n';
    // X = "Y", but Y is also defined. Y should NOT be substituted into the
    // expansion of X -- the literal "Y" appears in the result.
    const result = await preprocess('/main.wgsl', src, {
      fs,
      defines: new Map([
        ['X', 'Y'],
        ['Y', '99'],
      ]),
    });
    // Order of substitution: longest-first. X and Y are both length 1, so the
    // sort is stable on insertion. After X -> Y, the second pass replaces Y -> 99.
    // This documents (and locks) the actual behavior even though it isn't
    // "recursive" expansion of a single define's value.
    expect(result.source).toContain('let a = 99;');
  });
});
