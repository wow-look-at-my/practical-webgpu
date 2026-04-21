/**
 * Computes byte-accurate WGSL struct/array layouts per the WebGPU spec.
 *
 * Layout rules differ between address spaces:
 *
 * - storage / read_only_storage: "relaxed" rules — no extra array-element padding
 *   beyond natural alignment; struct size rounded to struct's own alignment.
 *
 * - uniform: "uniform" rules — array element stride must be rounded up to 16;
 *   struct used as array element must have size rounded to 16.
 *
 * Reference: https://www.w3.org/TR/WGSL/#memory-layouts
 */

import type {
  ArrayTypeDef,
  AtomicTypeDef,
  MatTypeDef,
  ReflectionIR,
  ScalarTypeDef,
  StructDef,
  StructMember,
  StructRefTypeDef,
  TypeDef,
  TypeRef,
  VecTypeDef,
} from '../ir/types.js';

const alignTo = (n: number, a: number): number => (n + a - 1) & ~(a - 1);

// ─── Primitive layout tables ─────────────────────────────────────────────────

const SCALAR_LAYOUT: Record<string, { size: number; align: number }> = {
  f32: { size: 4, align: 4 },
  i32: { size: 4, align: 4 },
  u32: { size: 4, align: 4 },
  bool: { size: 4, align: 4 }, // bool uses 4 bytes in buffers
  f16: { size: 2, align: 2 },
};

// ─── Public API ──────────────────────────────────────────────────────────────

export type AddressSpaceKind = 'uniform' | 'storage';

export interface LayoutOptions {
  addressSpace: AddressSpaceKind;
}

/**
 * Given a TypeDef index, returns { size, align } for the corresponding type.
 * For structs the result includes member offsets.
 * Note: does not mutate the IR; call fillLayoutIntoIR() to persist.
 */
export function sizeAndAlignOf(
  types: TypeDef[],
  structs: StructDef[],
  typeRef: TypeRef,
  opts: LayoutOptions,
): { size: number; align: number } {
  const td = types[typeRef];
  if (td === undefined) throw new Error(`TypeRef ${typeRef} out of bounds`);
  return _sizeAlign(types, structs, td, opts);
}

function _sizeAlign(
  types: TypeDef[],
  structs: StructDef[],
  td: TypeDef,
  opts: LayoutOptions,
): { size: number; align: number } {
  switch (td.kind) {
    case 'scalar':
      return scalarSizeAlign(td);

    case 'vec':
      return vecSizeAlign(types, structs, td, opts);

    case 'mat':
      return matSizeAlign(types, structs, td, opts);

    case 'array':
      return arraySizeAlign(types, structs, td, opts);

    case 'atomic':
      return atomicSizeAlign(types, structs, td, opts);

    case 'struct':
      return structSizeAlign(types, structs, td, opts);
  }
}

// ─── Scalar ─────────────────────────────────────────────────────────────────

function scalarSizeAlign(td: ScalarTypeDef): { size: number; align: number } {
  const layout = SCALAR_LAYOUT[td.name];
  if (!layout) throw new Error(`Unknown scalar type: ${td.name}`);
  return layout;
}

// ─── Vec ────────────────────────────────────────────────────────────────────

function vecSizeAlign(
  types: TypeDef[],
  structs: StructDef[],
  td: VecTypeDef,
  opts: LayoutOptions,
): { size: number; align: number } {
  const elem = _sizeAlign(types, structs, types[td.elem]!, opts);
  // vec2: size=8, align=8; vec3: size=12, align=16; vec4: size=16, align=16
  const alignMultiplier = td.n === 2 ? 2 : 4;
  return {
    size: elem.size * td.n,
    align: elem.size * alignMultiplier,
  };
}

// ─── Mat ────────────────────────────────────────────────────────────────────

function matSizeAlign(
  types: TypeDef[],
  structs: StructDef[],
  td: MatTypeDef,
  opts: LayoutOptions,
): { size: number; align: number } {
  // matCxR: C columns, each a vecR<elem>.
  // colStride = AlignOf(vecR<elem>) — NOT hardcoded 16.
  // AlignOf(vec2) = 2×elemSize; AlignOf(vec3/vec4) = 4×elemSize.
  const elem = _sizeAlign(types, structs, types[td.elem]!, opts);
  const colVecAlign = elem.size * (td.rows === 2 ? 2 : 4);
  const colVecSize = elem.size * td.rows;
  const colStride = alignTo(colVecSize, colVecAlign);
  return { size: colStride * td.cols, align: colStride };
}

// ─── Array ───────────────────────────────────────────────────────────────────

function arraySizeAlign(
  types: TypeDef[],
  structs: StructDef[],
  td: ArrayTypeDef,
  opts: LayoutOptions,
): { size: number; align: number } {
  const elem = _sizeAlign(types, structs, types[td.elem]!, opts);
  let stride = alignTo(elem.size, elem.align);
  if (opts.addressSpace === 'uniform') {
    // Uniform arrays: element stride must be multiple of 16
    stride = alignTo(stride, 16);
  }
  const align = opts.addressSpace === 'uniform' ? Math.max(elem.align, 16) : elem.align;
  if (td.count === null) {
    // Runtime-sized: size is unknown; report 0 (caller must use stride * count)
    return { size: 0, align };
  }
  return { size: stride * td.count, align };
}

// ─── Atomic ──────────────────────────────────────────────────────────────────

function atomicSizeAlign(
  types: TypeDef[],
  structs: StructDef[],
  td: AtomicTypeDef,
  opts: LayoutOptions,
): { size: number; align: number } {
  // atomic<T> has same size/align as T
  return _sizeAlign(types, structs, types[td.elem]!, opts);
}

// ─── Struct ──────────────────────────────────────────────────────────────────

function structSizeAlign(
  types: TypeDef[],
  structs: StructDef[],
  td: StructRefTypeDef,
  opts: LayoutOptions,
): { size: number; align: number } {
  const sd = structs[td.ref];
  if (sd === undefined) throw new Error(`StructRef ${td.ref} out of bounds`);
  // Struct align = max member align
  let structAlign = 1;
  for (const m of sd.members) {
    const mSA = _sizeAlign(types, structs, types[m.type]!, opts);
    structAlign = Math.max(structAlign, mSA.align);
  }
  // Struct size = offset of last member + size of last member, rounded up to struct align
  const lastMember = sd.members[sd.members.length - 1];
  if (lastMember === undefined) return { size: 0, align: structAlign };
  const lastSA = _sizeAlign(types, structs, types[lastMember.type]!, opts);
  const rawSize = lastMember.offset + lastSA.size;
  return { size: alignTo(rawSize, structAlign), align: structAlign };
}

// ─── Fill layout into IR ─────────────────────────────────────────────────────

/**
 * Mutates all TypeDefs and StructMembers in the IR to fill in size, align,
 * offset, stride, and colStride fields.  Call once after normalization.
 *
 * Two passes are required because structs can reference other structs.
 * We handle this with a recursive resolver that caches results.
 */
export function fillLayoutIntoIR(ir: ReflectionIR): void {
  const { types, structs } = ir;

  // Fill scalar/vec/mat/atomic in one pass (no deps on structs)
  for (const td of types) {
    switch (td.kind) {
      case 'scalar': {
        const { size, align } = scalarSizeAlign(td);
        (td as ScalarTypeDef).size = size;
        (td as ScalarTypeDef).align = align;
        break;
      }
      case 'vec': {
        const { size, align } = vecSizeAlign(types, structs, td, { addressSpace: 'storage' });
        (td as VecTypeDef).size = size;
        (td as VecTypeDef).align = align;
        break;
      }
      case 'mat': {
        const elem = _sizeAlign(types, structs, types[td.elem]!, { addressSpace: 'storage' });
        const colVecAlign = elem.size * (td.rows === 2 ? 2 : 4);
        const colStride = alignTo(elem.size * td.rows, colVecAlign);
        (td as MatTypeDef).colStride = colStride;
        (td as MatTypeDef).align = colStride;
        (td as MatTypeDef).size = colStride * td.cols;
        break;
      }
      case 'atomic': {
        const { size, align } = atomicSizeAlign(types, structs, td, { addressSpace: 'storage' });
        (td as AtomicTypeDef).size = size;
        (td as AtomicTypeDef).align = align;
        break;
      }
    }
  }

  // Fill struct member offsets (storage rules; members placed at natural alignment)
  for (let si = 0; si < structs.length; si++) {
    fillStructMembers(types, structs, si, { addressSpace: 'storage' });
  }

  // Back-fill array stride/size now that structs have offsets
  for (const td of types) {
    if (td.kind === 'array') {
      const arrOpts = { addressSpace: 'storage' as const };
      const elem = _sizeAlign(types, structs, types[td.elem]!, arrOpts);
      const stride = alignTo(elem.size, elem.align);
      (td as ArrayTypeDef).stride = stride;
      (td as ArrayTypeDef).align = elem.align;
      (td as ArrayTypeDef).size = td.count !== null ? stride * td.count : 0;
    }
    if (td.kind === 'struct') {
      const { size, align } = structSizeAlign(types, structs, td, { addressSpace: 'storage' });
      // These don't live on the TypeDef directly; they're on the StructDef.
      // The StructDef was already filled in fillStructMembers.
      const sd = structs[td.ref]!;
      sd.size = size;
      sd.align = align;
    }
  }
}

function fillStructMembers(
  types: TypeDef[],
  structs: StructDef[],
  structIndex: number,
  opts: LayoutOptions,
): void {
  const sd = structs[structIndex];
  if (sd === undefined) return;
  let offset = 0;
  let structAlign = 1;
  const members: StructMember[] = [];

  for (const m of sd.members) {
    const td = types[m.type];
    if (td === undefined) throw new Error(`TypeRef ${m.type} not found`);
    const { size, align } = _sizeAlign(types, structs, td, opts);
    offset = alignTo(offset, align);
    structAlign = Math.max(structAlign, align);
    members.push({ ...m, offset, size, align });
    offset += size;
  }

  const rawSize = members.reduce((acc, m) => Math.max(acc, m.offset + m.size), 0);
  sd.members = members;
  sd.align = structAlign;
  sd.size = alignTo(rawSize, structAlign);
}

// ─── Uniform layout helpers ──────────────────────────────────────────────────

/**
 * Returns the stride for using a type as a uniform buffer array element.
 * (Same as storage stride but rounded up to 16.)
 */
export function uniformArrayStride(
  types: TypeDef[],
  structs: StructDef[],
  elemRef: TypeRef,
): number {
  const { size, align } = _sizeAlign(types, structs, types[elemRef]!, { addressSpace: 'storage' });
  return alignTo(alignTo(size, align), 16);
}

/**
 * Returns the minimum binding size for a uniform buffer holding a given type.
 */
export function uniformMinBindingSize(
  types: TypeDef[],
  structs: StructDef[],
  typeRef: TypeRef,
): number {
  return _sizeAlign(types, structs, types[typeRef]!, { addressSpace: 'uniform' }).size;
}
