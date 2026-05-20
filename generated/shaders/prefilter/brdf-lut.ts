// AUTO-GENERATED — DO NOT EDIT. Source: shaders/prefilter/brdf-lut.wgsl  sha256: 16a0323b404f9753

import { StructView, createTypedBuffer, bindGroupFromEntries, type TypedGPUBuffer } from '@practical-webgpu/runtime';

export const SOURCE = `
const PI: f32 = 3.14159265358979323846;
const TWO_PI: f32 = 6.28318530717958647693;
const INV_PI: f32 = 0.31830988618379067154;

fn radical_inverse_vdc(bits_in: u32) -> f32 {
  var bits = bits_in;
  bits = (bits << 16u) | (bits >> 16u);
  bits = ((bits & 0x55555555u) << 1u) | ((bits & 0xAAAAAAAAu) >> 1u);
  bits = ((bits & 0x33333333u) << 2u) | ((bits & 0xCCCCCCCCu) >> 2u);
  bits = ((bits & 0x0F0F0F0Fu) << 4u) | ((bits & 0xF0F0F0F0u) >> 4u);
  bits = ((bits & 0x00FF00FFu) << 8u) | ((bits & 0xFF00FF00u) >> 8u);
  return f32(bits) * 2.3283064365386963e-10;
}

fn hammersley(i: u32, n: u32) -> vec2<f32> {
  return vec2<f32>(f32(i) / f32(n), radical_inverse_vdc(i));
}

fn importance_sample_ggx(xi: vec2<f32>, roughness: f32, n: vec3<f32>) -> vec3<f32> {
  let a = roughness * roughness;
  let phi = TWO_PI * xi.x;
  let cos_theta = sqrt((1.0 - xi.y) / (1.0 + (a * a - 1.0) * xi.y));
  let sin_theta = sqrt(1.0 - cos_theta * cos_theta);

  let h_tangent = vec3<f32>(cos(phi) * sin_theta, sin(phi) * sin_theta, cos_theta);

  let up = select(vec3<f32>(1.0, 0.0, 0.0), vec3<f32>(0.0, 0.0, 1.0), abs(n.z) < 0.999);
  let tangent = normalize(cross(up, n));
  let bitangent = cross(n, tangent);

  return normalize(tangent * h_tangent.x + bitangent * h_tangent.y + n * h_tangent.z);
}

fn distribution_ggx(n_dot_h: f32, roughness: f32) -> f32 {
  let a = roughness * roughness;
  let a2 = a * a;
  let denom = n_dot_h * n_dot_h * (a2 - 1.0) + 1.0;
  return a2 / (PI * denom * denom);
}

fn geometry_schlick_ggx(n_dot_v: f32, roughness: f32) -> f32 {
  let k = (roughness * roughness) / 2.0;
  return n_dot_v / (n_dot_v * (1.0 - k) + k);
}

fn geometry_smith(n: vec3<f32>, v: vec3<f32>, l: vec3<f32>, roughness: f32) -> f32 {
  let n_dot_v = max(dot(n, v), 0.0);
  let n_dot_l = max(dot(n, l), 0.0);
  return geometry_schlick_ggx(n_dot_v, roughness) * geometry_schlick_ggx(n_dot_l, roughness);
}


struct BrdfLutParams {
  size: u32,
  sample_count: u32,
}

@group(0) @binding(0) var output_lut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(1) var<uniform> params: BrdfLutParams;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let size = params.size;
  if (gid.x >= size || gid.y >= size) { return; }

  let n_dot_v = max((f32(gid.x) + 0.5) / f32(size), 0.001);
  let roughness = max((f32(gid.y) + 0.5) / f32(size), 0.001);

  let v = vec3<f32>(sqrt(1.0 - n_dot_v * n_dot_v), 0.0, n_dot_v);
  let n = vec3<f32>(0.0, 0.0, 1.0);

  var scale = 0.0;
  var bias = 0.0;

  for (var i = 0u; i < params.sample_count; i++) {
    let xi = hammersley(i, params.sample_count);
    let h = importance_sample_ggx(xi, roughness, n);
    let l = normalize(2.0 * dot(v, h) * h - v);

    let n_dot_l = max(l.z, 0.0);
    let n_dot_h = max(h.z, 0.0);
    let v_dot_h = max(dot(v, h), 0.0);

    if (n_dot_l > 0.0) {
      let g = geometry_smith(n, v, l, roughness);
      let g_vis = (g * v_dot_h) / (n_dot_h * n_dot_v);
      let fc = pow(1.0 - v_dot_h, 5.0);

      scale += (1.0 - fc) * g_vis;
      bias += fc * g_vis;
    }
  }

  scale /= f32(params.sample_count);
  bias /= f32(params.sample_count);

  textureStore(output_lut, gid.xy, vec4<f32>(scale, bias, 0.0, 1.0));
}
`;
export const SOURCE_SHA256 = '16a0323b404f97533137f457cd3063871b4387c79458dfad762f401b2b675605';
export const REQUIRED_FEATURES: readonly GPUFeatureName[] = [];

export const BrdfLutParams = {
  size: 8,
  align: 4,
  offsets: {
    size: 0,
    sample_count: 4
  } as const,
  sizes: {
    size: 4,
    sample_count: 4
  } as const,
} as const;

export class BrdfLutParamsView extends StructView {
  static readonly BYTE_SIZE = 8;

  get size(): number { return this.u32(BrdfLutParams.offsets.size); }
  set size(v: number) { this.setU32(BrdfLutParams.offsets.size, v); }

  get sample_count(): number { return this.u32(BrdfLutParams.offsets.sample_count); }
  set sample_count(v: number) { this.setU32(BrdfLutParams.offsets.sample_count, v); }
}

export type ParamsBuffer = TypedGPUBuffer<'BrdfLutParams', BrdfLutParamsView>;
export function createParamsBuffer(device: GPUDevice, opts?: { label?: string }): ParamsBuffer {
  return createTypedBuffer({ device, tag: 'BrdfLutParams', byteSize: BrdfLutParamsView.BYTE_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, ...(opts?.label !== undefined && { label: opts.label }), viewAt: (buf, off) => new BrdfLutParamsView(buf, off) });
}
export function writeParams(device: GPUDevice, buf: ParamsBuffer, value: { size: number; sample_count: number }): void {
  const v = buf.viewAt();
  v.size = value.size;
  v.sample_count = value.sample_count;
  device.queue.writeBuffer(buf.buffer, 0, buf.cpuBuffer);
}

export const bindGroupLayouts = {
  group0: {
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, storageTexture: { format: 'rgba16float', access: 'write-only', viewDimension: '2d' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform', minBindingSize: 8 } }
    ],
  } satisfies GPUBindGroupLayoutDescriptor,
} as const;

export function createGroup0Layout(device: GPUDevice): GPUBindGroupLayout {
  return device.createBindGroupLayout(bindGroupLayouts.group0);
}

export function createGroup0(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  res: { outputLut: GPUBindingResource; params: ParamsBuffer | GPUBindingResource },
): GPUBindGroup {
  return bindGroupFromEntries(device, layout, [
    { binding: 0, resource: typeof res.outputLut === 'object' && 'buffer' in res.outputLut && 'byteSize' in res.outputLut ? { buffer: (res.outputLut as { buffer: GPUBuffer }).buffer } : res.outputLut as GPUBindingResource },
    { binding: 1, resource: typeof res.params === 'object' && 'buffer' in res.params && 'byteSize' in res.params ? { buffer: (res.params as { buffer: GPUBuffer }).buffer } : res.params as GPUBindingResource },
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
  workgroupSize: [8, 8] as const,
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
    path: "shaders/prefilter/brdf-lut.wgsl",
    sha256: "16a0323b404f97533137f457cd3063871b4387c79458dfad762f401b2b675605",
    includes: [
      "shaders/common/sampling.wgsli"
    ]
  },
  enables: [],
  requires: [],
  overrides: [],
  types: [
    {
      kind: "scalar",
      name: "u32",
      size: 4,
      align: 4
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
    }
  ],
  structs: [
    {
      name: "BrdfLutParams",
      size: 8,
      align: 4,
      members: [
        {
          name: "size",
          type: 0,
          offset: 0,
          size: 4,
          align: 4
        },
        {
          name: "sample_count",
          type: 0,
          offset: 4,
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
      name: "output_lut",
      resource: {
        kind: "storageTexture",
        format: "rgba16float",
        access: "write-only",
        viewDimension: "2d"
      },
      stages: [
        "compute"
      ]
    },
    {
      group: 0,
      binding: 1,
      name: "params",
      resource: {
        kind: "buffer",
        addressSpace: "uniform",
        type: 1,
        minBindingSize: 8
      },
      stages: [
        "compute"
      ]
    }
  ],
  bindGroups: [
    {
      group: 0,
      bindings: [
        {
          group: 0,
          binding: 0,
          name: "output_lut",
          resource: {
            kind: "storageTexture",
            format: "rgba16float",
            access: "write-only",
            viewDimension: "2d"
          },
          stages: [
            "compute"
          ]
        },
        {
          group: 0,
          binding: 1,
          name: "params",
          resource: {
            kind: "buffer",
            addressSpace: "uniform",
            type: 1,
            minBindingSize: 8
          },
          stages: [
            "compute"
          ]
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
        8,
        8
      ],
      inputs: [
        {
          name: "gid",
          type: 2,
          builtin: "global_invocation_id"
        }
      ],
      outputs: [],
      bindingsUsed: [
        {
          group: 0,
          binding: 1
        },
        {
          group: 0,
          binding: 0
        }
      ]
    }
  ]
} as const;
