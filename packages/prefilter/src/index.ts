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
): ArrayBuffer {
  const ab = new ArrayBuffer(SpecularShader.SpecularParams.size);
  const v = new SpecularShader.SpecularParamsView(ab);
  v.face = face;
  v.roughness = roughness;
  v.output_size = outputSize;
  v.sample_count = sampleCount;
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

  let envCubemap: GPUTexture;
  let tempCubemap: GPUTexture | undefined;

  if (input.type === 'equirectangular') {
    envCubemap = device.createTexture({
      size: [cubemapSize, cubemapSize, 6],
      format: 'rgba16float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
    });
    tempCubemap = envCubemap;

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
        }),
        params: { buffer: uniformBuf(makeEquirectParams(face, cubemapSize)) },
      });
      pass.setBindGroup(0, bg);
      pass.dispatchWorkgroups(groups(cubemapSize), groups(cubemapSize));
    }

    pass.end();
    device.queue.submit([encoder.finish()]);
  } else {
    envCubemap = input.texture;
  }

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
          params: { buffer: uniformBuf(makeSpecularParams(face, roughness, mipSize, sampleCount)) },
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
  tempCubemap?.destroy();

  return { specularMap, irradianceMap, brdfLut };
}
