import { describe, expect, it } from 'vitest';
import { fillLayoutIntoIR } from '../src/pipeline/layout.js';
import type { ReflectionIR, TypeDef, StructDef } from '../src/ir/types.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeIR(
  types: TypeDef[],
  structs: StructDef[] = [],
): ReflectionIR {
  return {
    version: 1,
    source: { path: 'test', sha256: '', includes: [] },
    enables: [],
    requires: [],
    overrides: [],
    types,
    structs,
    bindings: [],
    bindGroups: [],
    vertexInputs: [],
    entries: [],
  };
}

const f32Idx = 0; // index of f32 in most tests
const u32Idx = 1;

// ─── Scalars ─────────────────────────────────────────────────────────────────

describe('scalar layout', () => {
  it('f32: size=4, align=4', () => {
    const ir = makeIR([{ kind: 'scalar', name: 'f32', size: 0, align: 0 }]);
    fillLayoutIntoIR(ir);
    expect(ir.types[0]).toMatchObject({ size: 4, align: 4 });
  });

  it('f16: size=2, align=2', () => {
    const ir = makeIR([{ kind: 'scalar', name: 'f16', size: 0, align: 0 }]);
    fillLayoutIntoIR(ir);
    expect(ir.types[0]).toMatchObject({ size: 2, align: 2 });
  });

  it('bool: size=4, align=4 (buffer representation)', () => {
    const ir = makeIR([{ kind: 'scalar', name: 'bool', size: 0, align: 0 }]);
    fillLayoutIntoIR(ir);
    expect(ir.types[0]).toMatchObject({ size: 4, align: 4 });
  });
});

// ─── Vectors ─────────────────────────────────────────────────────────────────

describe('vec layout', () => {
  it('vec2<f32>: size=8, align=8', () => {
    const ir = makeIR([
      { kind: 'scalar', name: 'f32', size: 0, align: 0 },
      { kind: 'vec', n: 2, elem: 0, size: 0, align: 0 },
    ]);
    fillLayoutIntoIR(ir);
    expect(ir.types[1]).toMatchObject({ size: 8, align: 8 });
  });

  it('vec3<f32>: size=12, align=16 (NOT 12)', () => {
    const ir = makeIR([
      { kind: 'scalar', name: 'f32', size: 0, align: 0 },
      { kind: 'vec', n: 3, elem: 0, size: 0, align: 0 },
    ]);
    fillLayoutIntoIR(ir);
    expect(ir.types[1]).toMatchObject({ size: 12, align: 16 });
  });

  it('vec4<f32>: size=16, align=16', () => {
    const ir = makeIR([
      { kind: 'scalar', name: 'f32', size: 0, align: 0 },
      { kind: 'vec', n: 4, elem: 0, size: 0, align: 0 },
    ]);
    fillLayoutIntoIR(ir);
    expect(ir.types[1]).toMatchObject({ size: 16, align: 16 });
  });

  it('vec2<f16>: size=4, align=4', () => {
    const ir = makeIR([
      { kind: 'scalar', name: 'f16', size: 0, align: 0 },
      { kind: 'vec', n: 2, elem: 0, size: 0, align: 0 },
    ]);
    fillLayoutIntoIR(ir);
    expect(ir.types[1]).toMatchObject({ size: 4, align: 4 });
  });
});

// ─── Matrices ────────────────────────────────────────────────────────────────

describe('mat layout', () => {
  it('mat2x2<f32>: colStride=8, size=16, align=8', () => {
    const ir = makeIR([
      { kind: 'scalar', name: 'f32', size: 0, align: 0 },
      { kind: 'mat', cols: 2, rows: 2, elem: 0, size: 0, align: 0, colStride: 0 },
    ]);
    fillLayoutIntoIR(ir);
    expect(ir.types[1]).toMatchObject({ colStride: 8, size: 16, align: 8 });
  });

  it('mat4x4<f32>: colStride=16, size=64, align=16', () => {
    const ir = makeIR([
      { kind: 'scalar', name: 'f32', size: 0, align: 0 },
      { kind: 'mat', cols: 4, rows: 4, elem: 0, size: 0, align: 0, colStride: 0 },
    ]);
    fillLayoutIntoIR(ir);
    expect(ir.types[1]).toMatchObject({ colStride: 16, size: 64, align: 16 });
  });

  it('mat3x3<f32>: colStride=16 (vec3 padded to 16), size=48, align=16', () => {
    const ir = makeIR([
      { kind: 'scalar', name: 'f32', size: 0, align: 0 },
      { kind: 'mat', cols: 3, rows: 3, elem: 0, size: 0, align: 0, colStride: 0 },
    ]);
    fillLayoutIntoIR(ir);
    expect(ir.types[1]).toMatchObject({ colStride: 16, size: 48, align: 16 });
  });

  it('mat2x3<f32>: colStride=16 (vec3→16), size=32, align=16', () => {
    const ir = makeIR([
      { kind: 'scalar', name: 'f32', size: 0, align: 0 },
      // mat2x3: 2 columns, 3 rows → col is vec3 → colStride=16 → size=32
      { kind: 'mat', cols: 2, rows: 3, elem: 0, size: 0, align: 0, colStride: 0 },
    ]);
    fillLayoutIntoIR(ir);
    expect(ir.types[1]).toMatchObject({ colStride: 16, size: 32, align: 16 });
  });
});

// ─── Arrays ──────────────────────────────────────────────────────────────────

describe('array layout (storage rules)', () => {
  it('array<f32, 4>: stride=4, size=16', () => {
    const ir = makeIR([
      { kind: 'scalar', name: 'f32', size: 0, align: 0 },
      { kind: 'array', elem: 0, count: 4, stride: 0, size: 0, align: 0 },
    ]);
    fillLayoutIntoIR(ir);
    expect(ir.types[1]).toMatchObject({ stride: 4, size: 16, align: 4 });
  });

  it('array<vec3<f32>, 4>: stride=16 (vec3 padded), size=64', () => {
    const ir = makeIR([
      { kind: 'scalar', name: 'f32', size: 0, align: 0 },
      { kind: 'vec', n: 3, elem: 0, size: 0, align: 0 },
      { kind: 'array', elem: 1, count: 4, stride: 0, size: 0, align: 0 },
    ]);
    fillLayoutIntoIR(ir);
    // vec3<f32>: size=12, align=16 → stride=alignTo(12,16)=16
    expect(ir.types[2]).toMatchObject({ stride: 16, size: 64, align: 16 });
  });

  it('runtime-sized array: size=0', () => {
    const ir = makeIR([
      { kind: 'scalar', name: 'f32', size: 0, align: 0 },
      { kind: 'array', elem: 0, count: null, stride: 0, size: 0, align: 0 },
    ]);
    fillLayoutIntoIR(ir);
    expect(ir.types[1]).toMatchObject({ stride: 4, size: 0, count: null });
  });
});

// ─── Structs ─────────────────────────────────────────────────────────────────

describe('struct layout', () => {
  it('struct { pos: vec3<f32>, life: f32 } — vec3 pads to 12, life at 12, size=16', () => {
    // types: 0=f32, 1=vec3<f32>, 2=struct-ref(0)
    // structs: 0={ pos: type1, life: type0 }
    const ir = makeIR(
      [
        { kind: 'scalar', name: 'f32', size: 0, align: 0 },
        { kind: 'vec', n: 3, elem: 0, size: 0, align: 0 },
        { kind: 'struct', ref: 0 },
      ],
      [
        {
          name: 'Particle',
          size: 0,
          align: 0,
          members: [
            { name: 'pos', type: 1, offset: 0, size: 0, align: 0 },
            { name: 'life', type: 0, offset: 0, size: 0, align: 0 },
          ],
        },
      ],
    );
    fillLayoutIntoIR(ir);
    const sd = ir.structs[0]!;
    expect(sd.members[0]).toMatchObject({ name: 'pos', offset: 0, size: 12, align: 16 });
    // life at offset=12 (vec3 only uses 12 bytes, next f32 at 12 since align=4 and 12%4=0)
    expect(sd.members[1]).toMatchObject({ name: 'life', offset: 12, size: 4, align: 4 });
    // struct size = alignTo(12+4=16, maxAlign=16) = 16
    expect(sd).toMatchObject({ size: 16, align: 16 });
  });

  it('struct { a: f32, b: vec4<f32> } — b pads to offset 16', () => {
    const ir = makeIR(
      [
        { kind: 'scalar', name: 'f32', size: 0, align: 0 },
        { kind: 'vec', n: 4, elem: 0, size: 0, align: 0 },
        { kind: 'struct', ref: 0 },
      ],
      [
        {
          name: 'Test',
          size: 0,
          align: 0,
          members: [
            { name: 'a', type: 0, offset: 0, size: 0, align: 0 },
            { name: 'b', type: 1, offset: 0, size: 0, align: 0 },
          ],
        },
      ],
    );
    fillLayoutIntoIR(ir);
    const sd = ir.structs[0]!;
    expect(sd.members[0]).toMatchObject({ name: 'a', offset: 0, size: 4 });
    // b has align=16, so offset = alignTo(4, 16) = 16
    expect(sd.members[1]).toMatchObject({ name: 'b', offset: 16, size: 16 });
    // struct size = alignTo(16+16=32, 16) = 32
    expect(sd).toMatchObject({ size: 32, align: 16 });
  });

  it('Camera struct: { view: mat4x4<f32>, proj: mat4x4<f32> } → size=128, align=16', () => {
    const ir = makeIR(
      [
        { kind: 'scalar', name: 'f32', size: 0, align: 0 },
        { kind: 'mat', cols: 4, rows: 4, elem: 0, size: 0, align: 0, colStride: 0 },
        { kind: 'struct', ref: 0 },
      ],
      [
        {
          name: 'Camera',
          size: 0,
          align: 0,
          members: [
            { name: 'view', type: 1, offset: 0, size: 0, align: 0 },
            { name: 'proj', type: 1, offset: 0, size: 0, align: 0 },
          ],
        },
      ],
    );
    fillLayoutIntoIR(ir);
    const sd = ir.structs[0]!;
    expect(sd.members[0]).toMatchObject({ name: 'view', offset: 0, size: 64, align: 16 });
    expect(sd.members[1]).toMatchObject({ name: 'proj', offset: 64, size: 64, align: 16 });
    expect(sd).toMatchObject({ size: 128, align: 16 });
  });
});

// ─── Atomic ──────────────────────────────────────────────────────────────────

describe('atomic layout', () => {
  it('atomic<u32>: same as u32 — size=4, align=4', () => {
    const ir = makeIR([
      { kind: 'scalar', name: 'u32', size: 0, align: 0 },
      { kind: 'atomic', elem: 0, size: 0, align: 0 },
    ]);
    fillLayoutIntoIR(ir);
    expect(ir.types[1]).toMatchObject({ size: 4, align: 4 });
  });
});
