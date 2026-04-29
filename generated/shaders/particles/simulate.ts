// AUTO-GENERATED -- DO NOT EDIT. Source: shaders/particles/simulate.wgsl  sha256: a1b0bcd0ccde65fb

import { StructView, createTypedBuffer, bindGroupFromEntries, type TypedGPUBuffer } from '@practical-webgpu/runtime';

export const SOURCE = `
struct Camera {
  view: mat4x4<f32>,
  proj: mat4x4<f32>,
}


struct Particle {
  pos: vec3<f32>,
  vel: vec3<f32>,
  life: f32,
}

@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<storage, read_write> particles: array<Particle>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= arrayLength(&particles)) { return; }
  particles[i].pos += particles[i].vel;
  particles[i].life -= 0.01;
}
`;
export const SOURCE_SHA256 = 'a1b0bcd0ccde65fb104d2bab00624443ae30191f004ee4cba2df4d0755a4e632';
export const REQUIRED_FEATURES: readonly GPUFeatureName[] = [];

export const Camera = {
  size: 128,
  align: 16,
  offsets: {
    view: 0,
    proj: 64
  } as const,
  sizes: {
    view: 64,
    proj: 64
  } as const,
} as const;

export class CameraView extends StructView {
  static readonly BYTE_SIZE = 128;

  get view(): Float32Array { return this.f32x(Camera.offsets.view, 16); }
  set view(v: ArrayLike<number>) { this.setF32x(Camera.offsets.view, v); }

  get proj(): Float32Array { return this.f32x(Camera.offsets.proj, 16); }
  set proj(v: ArrayLike<number>) { this.setF32x(Camera.offsets.proj, v); }
}

export const Particle = {
  size: 32,
  align: 16,
  offsets: {
    pos: 0,
    vel: 16,
    life: 28
  } as const,
  sizes: {
    pos: 12,
    vel: 12,
    life: 4
  } as const,
} as const;

export class ParticleView extends StructView {
  static readonly BYTE_SIZE = 32;

  get pos(): Float32Array { return this.f32x(Particle.offsets.pos, 3); }
  set pos(v: ArrayLike<number>) { this.setF32x(Particle.offsets.pos, v); }

  get vel(): Float32Array { return this.f32x(Particle.offsets.vel, 3); }
  set vel(v: ArrayLike<number>) { this.setF32x(Particle.offsets.vel, v); }

  get life(): number { return this.f32(Particle.offsets.life); }
  set life(v: number) { this.setF32(Particle.offsets.life, v); }
}

export type CameraBuffer = TypedGPUBuffer<'Camera', CameraView>;
export function createCameraBuffer(device: GPUDevice, opts?: { label?: string }): CameraBuffer {
  return createTypedBuffer({ device, tag: 'Camera', byteSize: CameraView.BYTE_SIZE, elementCount: undefined, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, ...(opts?.label !== undefined && { label: opts.label }), viewAt: (buf, off) => new CameraView(buf, off) });
}
export function writeCamera(device: GPUDevice, buf: CameraBuffer, value: { view: ArrayLike<number>; proj: ArrayLike<number> }): void {
  const v = buf.viewAt();
  v.view = value.view;
  v.proj = value.proj;
  device.queue.writeBuffer(buf.buffer, 0, buf.cpuBuffer);
}

export type ParticlesBuffer = TypedGPUBuffer<'Particle[]', ParticleView>;
export function createParticlesBuffer(device: GPUDevice, count: number, opts?: { label?: string; usage?: GPUBufferUsageFlags }): ParticlesBuffer {
  const byteSize = 32 * count;
  return createTypedBuffer({ device, tag: 'Particle[]', byteSize, elementCount: count, usage: opts?.usage ?? (GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST), ...(opts?.label !== undefined && { label: opts.label }), viewAt: (buf, off) => new ParticleView(buf, off) });
}
export function writeParticlesAt(device: GPUDevice, buf: ParticlesBuffer, index: number, value: { pos: ArrayLike<number>; vel: ArrayLike<number>; life: number }): void {
  const v = buf.viewAt(index);
  v.pos = value.pos;
  v.vel = value.vel;
  v.life = value.life;
  device.queue.writeBuffer(buf.buffer, index * 32, buf.cpuBuffer, index * 32, 32);
}
export function writeParticlesBatch(device: GPUDevice, buf: ParticlesBuffer, values: Iterable<{ pos: ArrayLike<number>; vel: ArrayLike<number>; life: number }>, startIndex = 0): void {
  let i = startIndex;
  for (const value of values) { writeParticlesAt(device, buf, i++, value); }
  device.queue.writeBuffer(buf.buffer, startIndex * 32, buf.cpuBuffer, startIndex * 32, (i - startIndex) * 32);
}

export const bindGroupLayouts = {
  group0: {
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE | GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform', minBindingSize: 128 } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE | GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'storage' } }
    ],
  } satisfies GPUBindGroupLayoutDescriptor,
} as const;

export function createGroup0Layout(device: GPUDevice): GPUBindGroupLayout {
  return device.createBindGroupLayout(bindGroupLayouts.group0);
}

export function createGroup0(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  res: { camera: CameraBuffer | GPUBindingResource; particles: ParticlesBuffer | GPUBindingResource },
): GPUBindGroup {
  return bindGroupFromEntries(device, layout, [
    { binding: 0, resource: typeof res.camera === 'object' && 'buffer' in res.camera && 'byteSize' in res.camera ? { buffer: (res.camera as { buffer: GPUBuffer }).buffer } : res.camera as GPUBindingResource },
    { binding: 1, resource: typeof res.particles === 'object' && 'buffer' in res.particles && 'byteSize' in res.particles ? { buffer: (res.particles as { buffer: GPUBuffer }).buffer } : res.particles as GPUBindingResource },
  ]);
}

export function createBindGroupLayouts(device: GPUDevice): { group0: GPUBindGroupLayout } {
  return {
    group0: createGroup0Layout(device),
  };
}

export function createPipelineLayout(device: GPUDevice, layouts?: { group0?: GPUBindGroupLayout }): GPUPipelineLayout {
  return device.createPipelineLayout({
    bindGroupLayouts: [
    layouts?.group0 ?? createGroup0Layout(device)
    ],
  });
}

export const mainEntry = {
  name: 'main',
  stage: 'compute' as const,
  workgroupSize: [64] as const,
} as const;

export function createMainComputePipeline(device: GPUDevice, opts?: { layout?: GPUPipelineLayout; constants?: Record<string, number>; label?: string }): GPUComputePipeline {
  const module = device.createShaderModule({ ...(opts?.label !== undefined && { label: opts.label }), code: SOURCE });
  return device.createComputePipeline({
    ...(opts?.label !== undefined && { label: opts.label }),
    layout: opts?.layout ?? createPipelineLayout(device),
    compute: { module, entryPoint: 'main', ...(opts?.constants !== undefined && { constants: opts.constants }) },
  });
}

export const reflection = {
  version: 1,
  source: {
    path: "shaders/particles/simulate.wgsl",
    sha256: "a1b0bcd0ccde65fb104d2bab00624443ae30191f004ee4cba2df4d0755a4e632",
    includes: [
      "shaders/common/camera.wgsli"
    ]
  },
  enables: [],
  requires: [],
  overrides: [],
  types: [
    {
      kind: "scalar",
      name: "f32",
      size: 4,
      align: 4
    },
    {
      kind: "mat",
      cols: 4,
      rows: 4,
      elem: 0,
      size: 64,
      align: 16,
      colStride: 16
    },
    {
      kind: "struct",
      ref: 0
    },
    {
      kind: "vec",
      n: 3,
      elem: 0,
      size: 12,
      align: 16
    },
    {
      kind: "struct",
      ref: 1
    },
    {
      kind: "array",
      elem: 4,
      count: null,
      stride: 32,
      size: 0,
      align: 16
    },
    {
      kind: "scalar",
      name: "u32",
      size: 4,
      align: 4
    },
    {
      kind: "vec",
      n: 3,
      elem: 6,
      size: 12,
      align: 16
    }
  ],
  structs: [
    {
      name: "Camera",
      size: 128,
      align: 16,
      members: [
        {
          name: "view",
          type: 1,
          offset: 0,
          size: 64,
          align: 16
        },
        {
          name: "proj",
          type: 1,
          offset: 64,
          size: 64,
          align: 16
        }
      ]
    },
    {
      name: "Particle",
      size: 32,
      align: 16,
      members: [
        {
          name: "pos",
          type: 3,
          offset: 0,
          size: 12,
          align: 16
        },
        {
          name: "vel",
          type: 3,
          offset: 16,
          size: 12,
          align: 16
        },
        {
          name: "life",
          type: 0,
          offset: 28,
          size: 4,
          align: 4
        }
      ]
    }
  ],
  bindings: [
    {
      group: 0,
      binding: 0,
      name: "camera",
      resource: {
        kind: "buffer",
        addressSpace: "uniform",
        type: 2,
        minBindingSize: 128
      },
      stages: []
    },
    {
      group: 0,
      binding: 1,
      name: "particles",
      resource: {
        kind: "buffer",
        addressSpace: "storage",
        access: "read_write",
        type: 5,
        minBindingSize: 0
      },
      stages: []
    }
  ],
  bindGroups: [
    {
      group: 0,
      bindings: [
        {
          group: 0,
          binding: 0,
          name: "camera",
          resource: {
            kind: "buffer",
            addressSpace: "uniform",
            type: 2,
            minBindingSize: 128
          },
          stages: []
        },
        {
          group: 0,
          binding: 1,
          name: "particles",
          resource: {
            kind: "buffer",
            addressSpace: "storage",
            access: "read_write",
            type: 5,
            minBindingSize: 0
          },
          stages: []
        }
      ]
    }
  ],
  vertexInputs: [],
  entries: [
    {
      name: "main",
      stage: "compute",
      workgroupSize: [
        64
      ],
      inputs: [
        {
          name: "gid",
          type: 7,
          builtin: "global_invocation_id"
        }
      ],
      outputs: [],
      bindingsUsed: [
        {
          group: 0,
          binding: 1
        }
      ]
    }
  ]
} as const;
