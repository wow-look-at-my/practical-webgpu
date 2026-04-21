// ─── Type references ────────────────────────────────────────────────────────

/** Index into ReflectionIR.types[]. */
export type TypeRef = number;

// ─── Type definitions ────────────────────────────────────────────────────────

export type ScalarKind = 'f32' | 'i32' | 'u32' | 'bool' | 'f16';

export interface ScalarTypeDef {
  kind: 'scalar';
  name: ScalarKind;
  size: number;
  align: number;
}

export interface VecTypeDef {
  kind: 'vec';
  n: 2 | 3 | 4;
  elem: TypeRef;
  size: number;
  align: number;
}

export interface MatTypeDef {
  kind: 'mat';
  cols: number;
  rows: number;
  elem: TypeRef;
  size: number;
  align: number;
  /** Stride between columns in bytes (= alignTo(rows * elemSize, 16)). */
  colStride: number;
}

export interface ArrayTypeDef {
  kind: 'array';
  elem: TypeRef;
  /** null = runtime-sized (only legal as last member of storage struct) */
  count: number | null;
  stride: number;
  size: number;
  align: number;
}

export interface AtomicTypeDef {
  kind: 'atomic';
  elem: TypeRef;
  size: number;
  align: number;
}

export interface StructRefTypeDef {
  kind: 'struct';
  /** Index into ReflectionIR.structs[]. */
  ref: number;
}

export type TypeDef =
  | ScalarTypeDef
  | VecTypeDef
  | MatTypeDef
  | ArrayTypeDef
  | AtomicTypeDef
  | StructRefTypeDef;

// ─── Struct definitions ──────────────────────────────────────────────────────

export interface StructMember {
  name: string;
  type: TypeRef;
  offset: number;
  size: number;
  align: number;
}

export interface StructDef {
  name: string;
  size: number;
  align: number;
  members: StructMember[];
}

// ─── Bindings ────────────────────────────────────────────────────────────────

export type AddressSpace = 'uniform' | 'storage' | 'read_only_storage';
export type AccessMode = 'read' | 'read_write';

export interface BufferBindingResource {
  kind: 'buffer';
  addressSpace: AddressSpace;
  access?: AccessMode;
  type: TypeRef;
  /** Minimum binding size in bytes (0 = unknown/runtime-sized). */
  minBindingSize: number;
}

export type SamplerType = 'filtering' | 'non-filtering' | 'comparison';

export interface SamplerBindingResource {
  kind: 'sampler';
  samplerType: SamplerType;
}

export type TextureSampleType = 'float' | 'unfilterable-float' | 'depth' | 'sint' | 'uint';
export type TextureViewDimension = '1d' | '2d' | '2d-array' | 'cube' | 'cube-array' | '3d';

export interface TextureBindingResource {
  kind: 'texture';
  viewDimension: TextureViewDimension;
  sampleType: TextureSampleType;
  multisampled: boolean;
}

export interface StorageTextureBindingResource {
  kind: 'storageTexture';
  format: string;
  access: 'write-only' | 'read-only' | 'read-write';
  viewDimension: TextureViewDimension;
}

export interface ExternalTextureBindingResource {
  kind: 'externalTexture';
}

export type BindingResource =
  | BufferBindingResource
  | SamplerBindingResource
  | TextureBindingResource
  | StorageTextureBindingResource
  | ExternalTextureBindingResource;

export type ShaderStage = 'vertex' | 'fragment' | 'compute';

export interface Binding {
  group: number;
  binding: number;
  name: string;
  resource: BindingResource;
  /** Which shader stages reference this binding. */
  stages: ShaderStage[];
}

export interface BindGroupLayout {
  group: number;
  bindings: Binding[];
}

// ─── Overrides ───────────────────────────────────────────────────────────────

export interface OverrideDef {
  name: string;
  id?: number;
  type: TypeRef;
  initValue?: string;
}

// ─── Entry points ────────────────────────────────────────────────────────────

export type OverrideRef = { override: string };

export interface EntryInput {
  name: string;
  type: TypeRef;
  location?: number;
  builtin?: string;
}

export interface EntryOutput {
  name?: string;
  type: TypeRef;
  location?: number;
  builtin?: string;
}

export interface EntryPoint {
  name: string;
  stage: ShaderStage;
  workgroupSize?: (number | OverrideRef)[];
  inputs: EntryInput[];
  outputs: EntryOutput[];
  bindingsUsed: { group: number; binding: number }[];
}

// ─── Vertex inputs ───────────────────────────────────────────────────────────

export interface VertexInput {
  entryPoint: string;
  attributes: {
    name: string;
    location: number;
    type: TypeRef;
    /** GPUVertexFormat, e.g. 'float32x4' */
    format: string;
    offset: number;
  }[];
  arrayStride: number;
}

// ─── Top-level IR ────────────────────────────────────────────────────────────

export interface ReflectionIR {
  version: 1;
  source: {
    path: string;
    sha256: string;
    includes: string[];
  };
  enables: string[];
  requires: string[];
  overrides: OverrideDef[];
  /** All interned types; referenced by TypeRef (index). */
  types: TypeDef[];
  structs: StructDef[];
  bindings: Binding[];
  bindGroups: BindGroupLayout[];
  vertexInputs: VertexInput[];
  entries: EntryPoint[];
}
