// AUTO-GENERATED -- DO NOT EDIT. Source: shaders/prefilter/specular.wgsl  sha256: da56d2c7aaa42063

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


fn face_uv_to_direction(face: u32, uv: vec2<f32>) -> vec3<f32> {
  let u = uv.x * 2.0 - 1.0;
  let v = uv.y * 2.0 - 1.0;
  switch face {
    case 0u: { return normalize(vec3<f32>( 1.0,   -v,   -u)); }
    case 1u: { return normalize(vec3<f32>(-1.0,   -v,    u)); }
    case 2u: { return normalize(vec3<f32>(   u,  1.0,    v)); }
    case 3u: { return normalize(vec3<f32>(   u, -1.0,   -v)); }
    case 4u: { return normalize(vec3<f32>(   u,   -v,  1.0)); }
    default: { return normalize(vec3<f32>(  -u,   -v, -1.0)); }
  }
}

fn direction_to_equirect_uv(dir: vec3<f32>) -> vec2<f32> {
  let phi = atan2(dir.z, dir.x);
  let theta = asin(clamp(dir.y, -1.0, 1.0));
  let u = phi * 0.15915494309189535 + 0.5;
  let v = theta * 0.31830988618379067 + 0.5;
  return vec2<f32>(u, v);
}


struct SpecularParams {
  face: u32,
  roughness: f32,
  output_size: u32,
  sample_count: u32,
  input_size: u32,
}

@group(0) @binding(0) var env_cubemap: texture_cube<f32>;
@group(0) @binding(1) var env_sampler: sampler;
@group(0) @binding(2) var output_face: texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var<uniform> params: SpecularParams;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let size = params.output_size;
  if (gid.x >= size || gid.y >= size) { return; }

  let uv = (vec2<f32>(gid.xy) + 0.5) / f32(size);
  let n = face_uv_to_direction(params.face, uv);

  // Below roughness ~0.02 the GGX pdf math is f32-degenerate: a^2 underflows
  // against 1.0 in the NDF denominator, and per-sample ulp wobble in the
  // half-vector swings the pdf between ~1 and inf, scattering the FIS mip
  // level per sample. A mirror mip needs no filtering at all -- the input is
  // resolvable by construction -- so copy it straight through.
  if (params.roughness < 0.02) {
    let c = textureSampleLevel(env_cubemap, env_sampler, n, 0.0).rgb;
    textureStore(output_face, gid.xy, vec4<f32>(c, 1.0));
    return;
  }

  let v = n;
  var color = vec3<f32>(0.0);
  var total_weight = 0.0;
  let roughness = params.roughness;

  for (var i = 0u; i < params.sample_count; i++) {
    let xi = hammersley(i, params.sample_count);
    let h = importance_sample_ggx(xi, roughness, n);
    let l = normalize(2.0 * dot(v, h) * h - v);
    let n_dot_l = max(dot(n, l), 0.0);

    if (n_dot_l > 0.0) {
      let n_dot_h = max(dot(n, h), 0.0);
      let h_dot_v = max(dot(h, v), 0.001);
      let d = distribution_ggx(n_dot_h, roughness);
      let pdf = d * n_dot_h / (4.0 * h_dot_v);
      let sa_texel = 4.0 * PI / (6.0 * f32(params.input_size) * f32(params.input_size));
      let sa_sample = 1.0 / (f32(params.sample_count) * pdf + 0.0001);
      let mip_level = 0.5 * log2(sa_sample / sa_texel) + 1.0;

      let sample_color = textureSampleLevel(env_cubemap, env_sampler, l, mip_level);
      color += sample_color.rgb * n_dot_l;
      total_weight += n_dot_l;
    }
  }

  if (total_weight > 0.0) {
    color /= total_weight;
  }

  textureStore(output_face, gid.xy, vec4<f32>(color, 1.0));
}
`;
export const SOURCE_SHA256 = 'da56d2c7aaa4206389d90380769fc7e7c4d8da676c9402679f584e39f1ae3a2d';
export const REQUIRED_FEATURES: readonly GPUFeatureName[] = [];

export const SpecularParams = {
  size: 20,
  align: 4,
  offsets: {
    face: 0,
    roughness: 4,
    output_size: 8,
    sample_count: 12,
    input_size: 16
  } as const,
  sizes: {
    face: 4,
    roughness: 4,
    output_size: 4,
    sample_count: 4,
    input_size: 4
  } as const,
} as const;

export class SpecularParamsView extends StructView {
  static readonly BYTE_SIZE = 20;

  get face(): number { return this.u32(SpecularParams.offsets.face); }
  set face(v: number) { this.setU32(SpecularParams.offsets.face, v); }

  get roughness(): number { return this.f32(SpecularParams.offsets.roughness); }
  set roughness(v: number) { this.setF32(SpecularParams.offsets.roughness, v); }

  get output_size(): number { return this.u32(SpecularParams.offsets.output_size); }
  set output_size(v: number) { this.setU32(SpecularParams.offsets.output_size, v); }

  get sample_count(): number { return this.u32(SpecularParams.offsets.sample_count); }
  set sample_count(v: number) { this.setU32(SpecularParams.offsets.sample_count, v); }

  get input_size(): number { return this.u32(SpecularParams.offsets.input_size); }
  set input_size(v: number) { this.setU32(SpecularParams.offsets.input_size, v); }
}

export type ParamsBuffer = TypedGPUBuffer<'SpecularParams', SpecularParamsView>;
export function createParamsBuffer(device: GPUDevice, opts?: { label?: string }): ParamsBuffer {
  return createTypedBuffer({ device, tag: 'SpecularParams', byteSize: SpecularParamsView.BYTE_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, ...(opts?.label !== undefined && { label: opts.label }), viewAt: (buf, off) => new SpecularParamsView(buf, off) });
}
export function writeParams(device: GPUDevice, buf: ParamsBuffer, value: { face: number; roughness: number; output_size: number; sample_count: number; input_size: number }): void {
  const v = buf.viewAt();
  v.face = value.face;
  v.roughness = value.roughness;
  v.output_size = value.output_size;
  v.sample_count = value.sample_count;
  v.input_size = value.input_size;
  device.queue.writeBuffer(buf.buffer, 0, buf.cpuBuffer);
}

export const bindGroupLayouts = {
  group0: {
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { viewDimension: 'cube', sampleType: 'float', multisampled: false } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, sampler: { type: 'filtering' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, storageTexture: { format: 'rgba16float', access: 'write-only', viewDimension: '2d' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform', minBindingSize: 20 } }
    ],
  } satisfies GPUBindGroupLayoutDescriptor,
} as const;

export function createGroup0Layout(device: GPUDevice): GPUBindGroupLayout {
  return device.createBindGroupLayout(bindGroupLayouts.group0);
}

export function createGroup0(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  res: { envCubemap: GPUBindingResource; envSampler: GPUBindingResource; outputFace: GPUBindingResource; params: ParamsBuffer | GPUBindingResource },
): GPUBindGroup {
  return bindGroupFromEntries(device, layout, [
    { binding: 0, resource: typeof res.envCubemap === 'object' && 'buffer' in res.envCubemap && 'byteSize' in res.envCubemap ? { buffer: (res.envCubemap as { buffer: GPUBuffer }).buffer } : res.envCubemap as GPUBindingResource },
    { binding: 1, resource: typeof res.envSampler === 'object' && 'buffer' in res.envSampler && 'byteSize' in res.envSampler ? { buffer: (res.envSampler as { buffer: GPUBuffer }).buffer } : res.envSampler as GPUBindingResource },
    { binding: 2, resource: typeof res.outputFace === 'object' && 'buffer' in res.outputFace && 'byteSize' in res.outputFace ? { buffer: (res.outputFace as { buffer: GPUBuffer }).buffer } : res.outputFace as GPUBindingResource },
    { binding: 3, resource: typeof res.params === 'object' && 'buffer' in res.params && 'byteSize' in res.params ? { buffer: (res.params as { buffer: GPUBuffer }).buffer } : res.params as GPUBindingResource },
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
    path: "shaders/prefilter/specular.wgsl",
    sha256: "da56d2c7aaa4206389d90380769fc7e7c4d8da676c9402679f584e39f1ae3a2d",
    includes: [
      "shaders/common/sampling.wgsli",
      "shaders/common/cubemap.wgsli"
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
      kind: "scalar",
      name: "f32",
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
      name: "SpecularParams",
      size: 20,
      align: 4,
      members: [
        {
          name: "face",
          type: 0,
          offset: 0,
          size: 4,
          align: 4
        },
        {
          name: "roughness",
          type: 1,
          offset: 4,
          size: 4,
          align: 4
        },
        {
          name: "output_size",
          type: 0,
          offset: 8,
          size: 4,
          align: 4
        },
        {
          name: "sample_count",
          type: 0,
          offset: 12,
          size: 4,
          align: 4
        },
        {
          name: "input_size",
          type: 0,
          offset: 16,
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
      name: "env_cubemap",
      resource: {
        kind: "texture",
        viewDimension: "cube",
        sampleType: "float",
        multisampled: false
      },
      stages: [
        "compute"
      ]
    },
    {
      group: 0,
      binding: 1,
      name: "env_sampler",
      resource: {
        kind: "sampler",
        samplerType: "filtering"
      },
      stages: [
        "compute"
      ]
    },
    {
      group: 0,
      binding: 2,
      name: "output_face",
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
      binding: 3,
      name: "params",
      resource: {
        kind: "buffer",
        addressSpace: "uniform",
        type: 2,
        minBindingSize: 20
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
          name: "env_cubemap",
          resource: {
            kind: "texture",
            viewDimension: "cube",
            sampleType: "float",
            multisampled: false
          },
          stages: [
            "compute"
          ]
        },
        {
          group: 0,
          binding: 1,
          name: "env_sampler",
          resource: {
            kind: "sampler",
            samplerType: "filtering"
          },
          stages: [
            "compute"
          ]
        },
        {
          group: 0,
          binding: 2,
          name: "output_face",
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
          binding: 3,
          name: "params",
          resource: {
            kind: "buffer",
            addressSpace: "uniform",
            type: 2,
            minBindingSize: 20
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
          type: 3,
          builtin: "global_invocation_id"
        }
      ],
      outputs: [],
      bindingsUsed: [
        {
          group: 0,
          binding: 3
        },
        {
          group: 0,
          binding: 0
        },
        {
          group: 0,
          binding: 1
        },
        {
          group: 0,
          binding: 2
        }
      ]
    }
  ]
} as const;
