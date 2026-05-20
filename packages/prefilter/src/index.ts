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

const DOWNSAMPLE_WGSL = `
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var dst: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let dst_size = textureDimensions(dst);
  if (gid.x >= dst_size.x || gid.y >= dst_size.y) { return; }
  let base = gid.xy * 2u;
  let a = textureLoad(src, base, 0);
  let b = textureLoad(src, base + vec2(1u, 0u), 0);
  let c = textureLoad(src, base + vec2(0u, 1u), 0);
  let d = textureLoad(src, base + vec2(1u, 1u), 0);
  textureStore(dst, gid.xy, (a + b + c + d) * 0.25);
}
`;

function generateCubemapMips(
  device: GPUDevice,
  texture: GPUTexture,
  size: number,
  mipLevels: number,
): void {
  const module = device.createShaderModule({ code: DOWNSAMPLE_WGSL });
  const bgl = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
      {
        binding: 1,
        visibility: GPUShaderStage.COMPUTE,
        storageTexture: { access: 'write-only', format: 'rgba16float', viewDimension: '2d' },
      },
    ],
  });
  const pipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }),
    compute: { module, entryPoint: 'main' },
  });

  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);

  for (let mip = 1; mip < mipLevels; mip++) {
    const mipSize = size >> mip;
    for (let face = 0; face < 6; face++) {
      const bg = device.createBindGroup({
        layout: bgl,
        entries: [
          {
            binding: 0,
            resource: texture.createView({
              dimension: '2d',
              baseArrayLayer: face,
              arrayLayerCount: 1,
              baseMipLevel: mip - 1,
              mipLevelCount: 1,
            }),
          },
          {
            binding: 1,
            resource: texture.createView({
              dimension: '2d',
              baseArrayLayer: face,
              arrayLayerCount: 1,
              baseMipLevel: mip,
              mipLevelCount: 1,
            }),
          },
        ],
      });
      pass.setBindGroup(0, bg);
      pass.dispatchWorkgroups(Math.ceil(mipSize / 8), Math.ceil(mipSize / 8));
    }
  }

  pass.end();
  device.queue.submit([encoder.finish()]);
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
    format: 'rgba16float',
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

  generateCubemapMips(device, envCubemap, cubemapSize, mipLevels);

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
