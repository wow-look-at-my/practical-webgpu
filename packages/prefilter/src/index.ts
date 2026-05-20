import * as BrdfLutShader from '../../../generated/shaders/prefilter/brdf-lut.js';
import * as EquirectShader from '../../../generated/shaders/prefilter/equirect-to-cubemap.js';
import * as IrradianceShader from '../../../generated/shaders/prefilter/irradiance.js';
import * as SpecularShader from '../../../generated/shaders/prefilter/specular.js';

export type PrefilterInput =
  | { type: 'equirectangular'; texture: GPUTexture }
  | { type: 'cubemap'; texture: GPUTexture };

export interface PrefilterOptions {
  device: GPUDevice;
  input: PrefilterInput;
  cubemapSize?: number;
  irradianceSize?: number;
  brdfLutSize?: number;
  sampleCount?: number;
}

export interface PrefilterResult {
  specularMap: GPUTexture;
  irradianceMap: GPUTexture;
  brdfLut: GPUTexture;
}

const WORKGROUP_SIZE = 8;

function createUniformBuf(device: GPUDevice, data: ArrayBuffer): GPUBuffer {
  const buf = device.createBuffer({
    size: data.byteLength,
    usage: GPUBufferUsage.UNIFORM,
    mappedAtCreation: true,
  });
  new Uint8Array(buf.getMappedRange()).set(new Uint8Array(data));
  buf.unmap();
  return buf;
}

function makeEquirectParams(face: number, outputSize: number): ArrayBuffer {
  const ab = new ArrayBuffer(EquirectShader.EquirectParams.size);
  const v = new EquirectShader.EquirectParamsView(ab);
  v.face = face;
  v.output_size = outputSize;
  return ab;
}

function makeSpecularParams(
  face: number,
  roughness: number,
  outputSize: number,
  sampleCount: number,
  inputSize: number,
): ArrayBuffer {
  const ab = new ArrayBuffer(SpecularShader.SpecularParams.size);
  const v = new SpecularShader.SpecularParamsView(ab);
  v.face = face;
  v.roughness = roughness;
  v.output_size = outputSize;
  v.sample_count = sampleCount;
  v.input_size = inputSize;
  return ab;
}

function makeIrradianceParams(face: number, outputSize: number, sampleCount: number): ArrayBuffer {
  const ab = new ArrayBuffer(IrradianceShader.IrradianceParams.size);
  const v = new IrradianceShader.IrradianceParamsView(ab);
  v.face = face;
  v.output_size = outputSize;
  v.sample_count = sampleCount;
  return ab;
}

function makeBrdfLutParams(size: number, sampleCount: number): ArrayBuffer {
  const ab = new ArrayBuffer(BrdfLutShader.BrdfLutParams.size);
  const v = new BrdfLutShader.BrdfLutParamsView(ab);
  v.size = size;
  v.sample_count = sampleCount;
  return ab;
}

function groups(size: number): number {
  return Math.ceil(size / WORKGROUP_SIZE);
}

const ANGULAR_DOWNSAMPLE_WGSL = `
struct Params {
  face: u32,
  mip_size: u32,
}

@group(0) @binding(0) var src_cubemap: texture_cube<f32>;
@group(0) @binding(1) var src_sampler: sampler;
@group(0) @binding(2) var dst: texture_storage_2d<rgba32float, write>;
@group(0) @binding(3) var<uniform> params: Params;

fn face_uv_to_dir(face: u32, uv: vec2<f32>) -> vec3<f32> {
  let u = uv.x * 2.0 - 1.0;
  let v = uv.y * 2.0 - 1.0;
  switch (face) {
    case 0u { return normalize(vec3( 1.0, -v, -u)); }
    case 1u { return normalize(vec3(-1.0, -v,  u)); }
    case 2u { return normalize(vec3( u,  1.0,  v)); }
    case 3u { return normalize(vec3( u, -1.0, -v)); }
    case 4u { return normalize(vec3( u, -v,  1.0)); }
    default { return normalize(vec3(-u, -v, -1.0)); }
  }
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= params.mip_size || gid.y >= params.mip_size) { return; }

  let uv = (vec2<f32>(gid.xy) + 0.5) / f32(params.mip_size);
  let center = face_uv_to_dir(params.face, uv);

  // Build tangent frame in cubemap space
  let up = select(vec3(1.0, 0.0, 0.0), vec3(0.0, 0.0, 1.0), abs(center.z) < 0.999);
  let tangent_x = normalize(cross(up, center));
  let tangent_y = cross(center, tangent_x);

  let sample_offset = 2.0 * 2.0 / f32(params.mip_size);

  var color = textureSampleLevel(src_cubemap, src_sampler, center, 0.0);

  let offsets = array<vec2<f32>, 8>(
    vec2(-1.0, -1.0) * 0.7,
    vec2( 1.0, -1.0) * 0.7,
    vec2(-1.0,  1.0) * 0.7,
    vec2( 1.0,  1.0) * 0.7,
    vec2( 0.0, -1.0),
    vec2(-1.0,  0.0),
    vec2( 1.0,  0.0),
    vec2( 0.0,  1.0),
  );

  for (var i = 0u; i < 8u; i++) {
    let dir = center
      + tangent_x * (offsets[i].x * sample_offset)
      + tangent_y * (offsets[i].y * sample_offset);
    color += textureSampleLevel(src_cubemap, src_sampler, dir, 0.0) * 0.375;
  }

  color *= 0.25;

  textureStore(dst, gid.xy, color);
}
`;

function generateCubemapMips(
  device: GPUDevice,
  texture: GPUTexture,
  size: number,
  mipLevels: number,
  sampler: GPUSampler,
): void {
  const module = device.createShaderModule({ code: ANGULAR_DOWNSAMPLE_WGSL });
  const bgl = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        texture: { sampleType: 'float', viewDimension: 'cube' },
      },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, sampler: { type: 'filtering' } },
      {
        binding: 2,
        visibility: GPUShaderStage.COMPUTE,
        storageTexture: { access: 'write-only', format: 'rgba32float', viewDimension: '2d' },
      },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    ],
  });
  const pipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }),
    compute: { module, entryPoint: 'main' },
  });

  for (let mip = 1; mip < mipLevels; mip++) {
    const mipSize = size >> mip;
    const srcView = texture.createView({
      dimension: 'cube',
      baseMipLevel: mip - 1,
      mipLevelCount: 1,
    });

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);

    for (let face = 0; face < 6; face++) {
      const paramsData = new ArrayBuffer(8);
      new Uint32Array(paramsData).set([face, mipSize]);
      const paramsBuf = device.createBuffer({
        size: 8,
        usage: GPUBufferUsage.UNIFORM,
        mappedAtCreation: true,
      });
      new Uint8Array(paramsBuf.getMappedRange()).set(new Uint8Array(paramsData));
      paramsBuf.unmap();

      const bg = device.createBindGroup({
        layout: bgl,
        entries: [
          { binding: 0, resource: srcView },
          { binding: 1, resource: sampler },
          {
            binding: 2,
            resource: texture.createView({
              dimension: '2d',
              baseArrayLayer: face,
              arrayLayerCount: 1,
              baseMipLevel: mip,
              mipLevelCount: 1,
            }),
          },
          { binding: 3, resource: { buffer: paramsBuf } },
        ],
      });
      pass.setBindGroup(0, bg);
      pass.dispatchWorkgroups(Math.ceil(mipSize / 8), Math.ceil(mipSize / 8));
    }

    pass.end();
    device.queue.submit([encoder.finish()]);
  }
}

export function prefilterEnvMap(opts: PrefilterOptions): PrefilterResult {
  const { device, input } = opts;
  const cubemapSize = opts.cubemapSize ?? 256;
  const irradianceSize = opts.irradianceSize ?? 32;
  const brdfLutSize = opts.brdfLutSize ?? 256;
  const sampleCount = opts.sampleCount ?? 1024;
  const mipLevels = Math.floor(Math.log2(cubemapSize)) + 1;

  const tempBuffers: GPUBuffer[] = [];

  const uniformBuf = (data: ArrayBuffer): GPUBuffer => {
    const buf = createUniformBuf(device, data);
    tempBuffers.push(buf);
    return buf;
  };

  const linearSampler = device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
    mipmapFilter: 'linear',
  });

  const envCubemap = device.createTexture({
    size: [cubemapSize, cubemapSize, 6],
    format: 'rgba32float',
    mipLevelCount: mipLevels,
    usage:
      GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_DST,
  });

  if (input.type === 'equirectangular') {
    const pipeline = EquirectShader.createMainComputePipeline(device, {
      label: 'equirect-to-cubemap',
    });
    const layout = EquirectShader.createGroup0Layout(device);
    const inputView = input.texture.createView();
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);

    for (let face = 0; face < 6; face++) {
      const bg = EquirectShader.createGroup0(device, layout, {
        equirectTex: inputView,
        equirectSampler: linearSampler,
        outputFace: envCubemap.createView({
          dimension: '2d',
          baseArrayLayer: face,
          arrayLayerCount: 1,
          baseMipLevel: 0,
          mipLevelCount: 1,
        }),
        params: { buffer: uniformBuf(makeEquirectParams(face, cubemapSize)) },
      });
      pass.setBindGroup(0, bg);
      pass.dispatchWorkgroups(groups(cubemapSize), groups(cubemapSize));
    }

    pass.end();
    device.queue.submit([encoder.finish()]);
  } else {
    const encoder = device.createCommandEncoder();
    for (let face = 0; face < 6; face++) {
      encoder.copyTextureToTexture(
        { texture: input.texture, origin: { x: 0, y: 0, z: face } },
        { texture: envCubemap, origin: { x: 0, y: 0, z: face } },
        [cubemapSize, cubemapSize],
      );
    }
    device.queue.submit([encoder.finish()]);
  }

  generateCubemapMips(device, envCubemap, cubemapSize, mipLevels, linearSampler);

  const specularMap = device.createTexture({
    size: [cubemapSize, cubemapSize, 6],
    format: 'rgba16float',
    mipLevelCount: mipLevels,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
  });

  const irradianceMap = device.createTexture({
    size: [irradianceSize, irradianceSize, 6],
    format: 'rgba16float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
  });

  const brdfLut = device.createTexture({
    size: [brdfLutSize, brdfLutSize],
    format: 'rgba16float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
  });

  const envCubeView = envCubemap.createView({ dimension: 'cube' });
  const encoder = device.createCommandEncoder();

  {
    const pipeline = SpecularShader.createMainComputePipeline(device, {
      label: 'specular-prefilter',
    });
    const layout = SpecularShader.createGroup0Layout(device);
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);

    for (let mip = 0; mip < mipLevels; mip++) {
      const mipSize = cubemapSize >> mip;
      const roughness = mipLevels > 1 ? mip / (mipLevels - 1) : 0;

      for (let face = 0; face < 6; face++) {
        const bg = SpecularShader.createGroup0(device, layout, {
          envCubemap: envCubeView,
          envSampler: linearSampler,
          outputFace: specularMap.createView({
            dimension: '2d',
            baseArrayLayer: face,
            arrayLayerCount: 1,
            baseMipLevel: mip,
            mipLevelCount: 1,
          }),
          params: {
            buffer: uniformBuf(
              makeSpecularParams(face, roughness, mipSize, sampleCount, cubemapSize),
            ),
          },
        });
        pass.setBindGroup(0, bg);
        pass.dispatchWorkgroups(groups(mipSize), groups(mipSize));
      }
    }

    pass.end();
  }

  {
    const pipeline = IrradianceShader.createMainComputePipeline(device, { label: 'irradiance' });
    const layout = IrradianceShader.createGroup0Layout(device);
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);

    for (let face = 0; face < 6; face++) {
      const bg = IrradianceShader.createGroup0(device, layout, {
        envCubemap: envCubeView,
        envSampler: linearSampler,
        outputFace: irradianceMap.createView({
          dimension: '2d',
          baseArrayLayer: face,
          arrayLayerCount: 1,
        }),
        params: { buffer: uniformBuf(makeIrradianceParams(face, irradianceSize, sampleCount)) },
      });
      pass.setBindGroup(0, bg);
      pass.dispatchWorkgroups(groups(irradianceSize), groups(irradianceSize));
    }

    pass.end();
  }

  {
    const pipeline = BrdfLutShader.createMainComputePipeline(device, { label: 'brdf-lut' });
    const layout = BrdfLutShader.createGroup0Layout(device);
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);

    const bg = BrdfLutShader.createGroup0(device, layout, {
      outputLut: brdfLut.createView(),
      params: { buffer: uniformBuf(makeBrdfLutParams(brdfLutSize, sampleCount)) },
    });
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(groups(brdfLutSize), groups(brdfLutSize));

    pass.end();
  }

  device.queue.submit([encoder.finish()]);

  for (const buf of tempBuffers) buf.destroy();
  envCubemap.destroy();

  return { specularMap, irradianceMap, brdfLut };
}
