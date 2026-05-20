/**
 * Converts wgsl_reflect output into the canonical ReflectionIR.
 *
 * wgsl_reflect is used for AST/struct discovery only. Byte layout is computed
 * separately by layout.ts (which correctly handles all address-space rules).
 */

import { ResourceType, WgslReflect } from 'wgsl_reflect';
import type {
  BindGroupLayout,
  Binding,
  EntryPoint,
  ReflectionIR,
  ShaderStage,
  StructDef,
  TypeDef,
  TypeRef,
} from '../ir/types.js';
import { isScalarName, parseMatName, parseVecName } from '../util/wgsl-types.js';
import { fillLayoutIntoIR } from './layout.js';

// ─── wgsl_reflect type shims ─────────────────────────────────────────────────
// wgsl_reflect doesn't ship full TS types for its internal structures; we use
// the shapes we confirmed empirically.

interface WRType {
  name: string;
  size?: number;
  format?: WRType | null;
  members?: WRMember[];
  count?: number;
  stride?: number;
  align?: number;
  attributes?: WRAttr[] | null;
  access?: string | null;
}

interface WRMember {
  name: string;
  type: WRType;
  offset: number;
  size: number;
  attributes?: WRAttr[] | null;
}

interface WRAttr {
  name: string;
  value: string | string[] | null;
}

interface WREntry {
  name: string;
  stage: string | null;
  inputs?: WRInput[];
  attributes?: WRAttr[] | null;
  resources?: WRBindingRef[];
}

interface WRInput {
  name: string;
  type: WRType | null;
  locationType?: string;
  location?: string | number;
}

interface WRBindingRef {
  group: number;
  binding: number;
}

interface WRBinding {
  name: string;
  group: number;
  binding: number;
  type: WRType;
  resourceType: number;
  access?: string;
}

// ─── Type intern table ───────────────────────────────────────────────────────

class TypeIntern {
  readonly types: TypeDef[] = [];
  private _scalarCache = new Map<string, TypeRef>();
  private _vecCache = new Map<string, TypeRef>();
  private _matCache = new Map<string, TypeRef>();
  private _arrayCache = new Map<string, TypeRef>();
  private _atomicCache = new Map<string, TypeRef>();
  private _structRefCache = new Map<number, TypeRef>();

  scalar(name: string): TypeRef {
    let ref = this._scalarCache.get(name);
    if (ref !== undefined) return ref;
    ref = this.types.length;
    if (!isScalarName(name)) throw new Error(`Unknown scalar: ${name}`);
    this.types.push({ kind: 'scalar', name, size: 0, align: 0 });
    this._scalarCache.set(name, ref);
    return ref;
  }

  vec(n: 2 | 3 | 4, elemRef: TypeRef): TypeRef {
    const key = `vec${n}:${elemRef}`;
    let ref = this._vecCache.get(key);
    if (ref !== undefined) return ref;
    ref = this.types.length;
    this.types.push({ kind: 'vec', n, elem: elemRef, size: 0, align: 0 });
    this._vecCache.set(key, ref);
    return ref;
  }

  mat(cols: number, rows: number, elemRef: TypeRef): TypeRef {
    const key = `mat${cols}x${rows}:${elemRef}`;
    let ref = this._matCache.get(key);
    if (ref !== undefined) return ref;
    ref = this.types.length;
    this.types.push({ kind: 'mat', cols, rows, elem: elemRef, size: 0, align: 0, colStride: 0 });
    this._matCache.set(key, ref);
    return ref;
  }

  array(elemRef: TypeRef, count: number | null): TypeRef {
    const key = `arr:${elemRef}:${count ?? 'rt'}`;
    let ref = this._arrayCache.get(key);
    if (ref !== undefined) return ref;
    ref = this.types.length;
    this.types.push({ kind: 'array', elem: elemRef, count, stride: 0, size: 0, align: 0 });
    this._arrayCache.set(key, ref);
    return ref;
  }

  atomic(elemRef: TypeRef): TypeRef {
    const key = `atomic:${elemRef}`;
    let ref = this._atomicCache.get(key);
    if (ref !== undefined) return ref;
    ref = this.types.length;
    this.types.push({ kind: 'atomic', elem: elemRef, size: 0, align: 0 });
    this._atomicCache.set(key, ref);
    return ref;
  }

  structRef(structIndex: number): TypeRef {
    let ref = this._structRefCache.get(structIndex);
    if (ref !== undefined) return ref;
    ref = this.types.length;
    this.types.push({ kind: 'struct', ref: structIndex });
    this._structRefCache.set(structIndex, ref);
    return ref;
  }
}

// ─── Type conversion ─────────────────────────────────────────────────────────

function wrTypeToRef(
  wrType: WRType,
  intern: TypeIntern,
  structs: StructDef[],
  structNameToIndex: Map<string, number>,
): TypeRef {
  const { name } = wrType;

  if (isScalarName(name)) return intern.scalar(name);

  const vecN = parseVecName(name);
  if (vecN !== null) {
    const elemName = wrType.format?.name ?? 'f32';
    const elemRef = intern.scalar(isScalarName(elemName) ? elemName : 'f32');
    return intern.vec(vecN, elemRef);
  }

  const mat = parseMatName(name);
  if (mat !== null) {
    const elemName = wrType.format?.name ?? 'f32';
    const elemRef = intern.scalar(isScalarName(elemName) ? elemName : 'f32');
    return intern.mat(mat.cols, mat.rows, elemRef);
  }

  if (name === 'array') {
    const elemType = wrType.format;
    if (!elemType) throw new Error('array type missing element type');
    const elemRef = wrTypeToRef(elemType, intern, structs, structNameToIndex);
    // wgsl_reflect uses count=0 for runtime-sized arrays
    const count = wrType.count != null && wrType.count > 0 ? wrType.count : null;
    return intern.array(elemRef, count);
  }

  if (name === 'atomic') {
    const elemType = wrType.format;
    if (!elemType) throw new Error('atomic type missing element type');
    const elemRef = wrTypeToRef(elemType, intern, structs, structNameToIndex);
    return intern.atomic(elemRef);
  }

  // Must be a struct name
  const idx = structNameToIndex.get(name);
  if (idx === undefined) {
    // Fallback: treat as u32 to avoid crash (shouldn't happen with valid WGSL)
    return intern.scalar('u32');
  }
  return intern.structRef(idx);
}

// ─── Main normalize function ─────────────────────────────────────────────────

export function normalize(
  sourcePath: string,
  sourceHash: string,
  includes: string[],
  preprocessedSource: string,
): ReflectionIR {
  const reflect = new WgslReflect(preprocessedSource);

  const intern = new TypeIntern();
  const structs: StructDef[] = [];
  const structNameToIndex = new Map<string, number>();

  // ── 1. Register all struct names first (needed for forward references) ──
  for (const wrStruct of reflect.structs) {
    const idx = structs.length;
    structNameToIndex.set(wrStruct.name, idx);
    structs.push({ name: wrStruct.name, size: 0, align: 0, members: [] });
  }

  // ── 2. Fill struct members ──
  for (const wrStruct of reflect.structs) {
    const idx = structNameToIndex.get(wrStruct.name)!;
    const sd = structs[idx]!;
    sd.members = (wrStruct.members ?? []).map((m: WRMember) => ({
      name: m.name,
      type: wrTypeToRef(m.type, intern, structs, structNameToIndex),
      offset: 0, // will be filled by layout
      size: 0,
      align: 0,
    }));
    // Intern the struct ref so it appears in the types array
    intern.structRef(idx);
  }

  // ── 3. Build bindings from getBindGroups() ──
  const bindings: Binding[] = [];
  const bindGroups: BindGroupLayout[] = [];

  const rawGroups = reflect.getBindGroups() as WRBinding[][];
  for (let groupIdx = 0; groupIdx < rawGroups.length; groupIdx++) {
    const rawGroup = rawGroups[groupIdx];
    if (!rawGroup) continue;
    const groupBindings: Binding[] = [];

    for (const raw of rawGroup) {
      const b = rawBindingToBinding(raw, intern, structs, structNameToIndex);
      bindings.push(b);
      groupBindings.push(b);
    }

    bindGroups.push({ group: groupIdx, bindings: groupBindings });
  }

  // ── 4. Build entry points ──
  const entries: EntryPoint[] = [];
  const allEntries: WREntry[] = [
    ...(reflect.entry.vertex ?? []),
    ...(reflect.entry.fragment ?? []),
    ...(reflect.entry.compute ?? []),
  ];

  for (const e of allEntries) {
    entries.push(wrEntryToEntryPoint(e as WREntry, intern, structs, structNameToIndex));
  }

  // ── 4b. Populate binding stages from entry point cross-references ──
  for (const ep of entries) {
    for (const ref of ep.bindingsUsed) {
      const b = bindings.find((x) => x.group === ref.group && x.binding === ref.binding);
      if (b && !b.stages.includes(ep.stage)) {
        b.stages.push(ep.stage);
      }
    }
  }

  // ── 5. Build IR and fill layout ──
  const ir: ReflectionIR = {
    version: 1,
    source: { path: sourcePath, sha256: sourceHash, includes },
    enables: [],
    requires: [],
    overrides: [],
    types: intern.types,
    structs,
    bindings,
    bindGroups,
    vertexInputs: [],
    entries,
  };

  fillLayoutIntoIR(ir);
  return ir;
}

// ─── Binding conversion ───────────────────────────────────────────────────────

function rawBindingToBinding(
  raw: WRBinding,
  intern: TypeIntern,
  structs: StructDef[],
  structNameToIndex: Map<string, number>,
): Binding {
  const resourceType: number = raw.resourceType;

  if (resourceType === ResourceType.Uniform || resourceType === ResourceType.Storage) {
    const typeRef = wrTypeToRef(raw.type, intern, structs, structNameToIndex);
    const addressSpace = resourceType === ResourceType.Uniform ? 'uniform' : 'storage';
    const access =
      resourceType === ResourceType.Storage && raw.access === 'read'
        ? 'read'
        : resourceType === ResourceType.Storage
          ? 'read_write'
          : undefined;

    // minBindingSize: for a uniform buffer, it's the struct size; for runtime-sized storage, 0
    let minBindingSize = 0;
    if (raw.type.name !== 'array' || (raw.type.count != null && raw.type.count > 0)) {
      minBindingSize = raw.type.size ?? 0;
    }

    return {
      group: raw.group,
      binding: raw.binding,
      name: raw.name,
      resource: {
        kind: 'buffer',
        addressSpace:
          addressSpace === 'storage' && access === 'read' ? 'read_only_storage' : addressSpace,
        ...(access !== undefined && { access }),
        type: typeRef,
        minBindingSize,
      },
      stages: [],
    };
  }

  if (resourceType === ResourceType.Sampler) {
    return {
      group: raw.group,
      binding: raw.binding,
      name: raw.name,
      resource: { kind: 'sampler', samplerType: 'filtering' },
      stages: [],
    };
  }

  if (resourceType === ResourceType.Texture) {
    return {
      group: raw.group,
      binding: raw.binding,
      name: raw.name,
      resource: {
        kind: 'texture',
        viewDimension: textureViewDimension(raw.type.name),
        sampleType: textureSampleType(raw.type.format?.name),
        multisampled: raw.type.name.includes('multisampled'),
      },
      stages: [],
    };
  }

  if (resourceType === ResourceType.StorageTexture) {
    return {
      group: raw.group,
      binding: raw.binding,
      name: raw.name,
      resource: {
        kind: 'storageTexture',
        format: raw.type.format?.name ?? 'rgba8unorm',
        access: storageTextureAccess(raw.type.access),
        viewDimension: textureViewDimension(raw.type.name),
      },
      stages: [],
    };
  }

  // Fallback
  return {
    group: raw.group,
    binding: raw.binding,
    name: raw.name,
    resource: { kind: 'sampler', samplerType: 'filtering' },
    stages: [],
  };
}

// ─── Entry point conversion ───────────────────────────────────────────────────

function wrEntryToEntryPoint(
  e: WREntry,
  intern: TypeIntern,
  structs: StructDef[],
  structNameToIndex: Map<string, number>,
): EntryPoint {
  const stageStr = e.stage ?? 'compute';
  const stage: ShaderStage =
    stageStr === 'compute' ? 'compute' : stageStr === 'vertex' ? 'vertex' : 'fragment';

  // Extract workgroupSize from attributes
  let workgroupSize: (number | { override: string })[] | undefined;
  const wsAttr = e.attributes?.find((a) => a.name === 'workgroup_size');
  if (wsAttr?.value != null) {
    const raw = Array.isArray(wsAttr.value) ? wsAttr.value : [wsAttr.value];
    workgroupSize = raw.map((v: string) => {
      const n = Number.parseInt(v, 10);
      return Number.isNaN(n) ? { override: v } : n;
    });
  }

  const inputs = (e.inputs ?? [])
    .filter((inp: WRInput) => inp.type !== null)
    .map((inp: WRInput) => ({
      name: inp.name,
      type: wrTypeToRef(inp.type!, intern, structs, structNameToIndex),
      ...(inp.locationType === 'location' ? { location: Number(inp.location) } : {}),
      ...(inp.locationType === 'builtin' ? { builtin: String(inp.location) } : {}),
    }));

  return {
    name: e.name,
    stage,
    ...(workgroupSize !== undefined && { workgroupSize }),
    inputs,
    outputs: [],
    bindingsUsed: (e.resources ?? []).map((r: WRBindingRef) => ({
      group: r.group,
      binding: r.binding,
    })),
  };
}

// ─── Texture helpers ─────────────────────────────────────────────────────────

const VIEW_DIM_MAP: Record<string, string> = {
  texture_1d: '1d',
  texture_2d: '2d',
  texture_2d_array: '2d-array',
  texture_multisampled_2d: '2d',
  texture_cube: 'cube',
  texture_cube_array: 'cube-array',
  texture_3d: '3d',
  texture_storage_1d: '1d',
  texture_storage_2d: '2d',
  texture_storage_2d_array: '2d-array',
  texture_storage_3d: '3d',
};

function textureViewDimension(
  typeName: string,
): '1d' | '2d' | '2d-array' | 'cube' | 'cube-array' | '3d' {
  return (VIEW_DIM_MAP[typeName] ?? '2d') as
    | '1d'
    | '2d'
    | '2d-array'
    | 'cube'
    | 'cube-array'
    | '3d';
}

function textureSampleType(
  formatName: string | undefined,
): 'float' | 'unfilterable-float' | 'depth' | 'sint' | 'uint' {
  if (formatName === 'i32') return 'sint';
  if (formatName === 'u32') return 'uint';
  return 'float';
}

function storageTextureAccess(
  access: string | null | undefined,
): 'write-only' | 'read-only' | 'read-write' {
  if (access === 'read') return 'read-only';
  if (access === 'read_write') return 'read-write';
  return 'write-only';
}
