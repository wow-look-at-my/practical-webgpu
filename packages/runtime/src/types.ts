import type { StructView } from './struct-view.js';

declare const _gpuBufTag: unique symbol;

export type TypedGPUBuffer<Tag extends string, View extends StructView> = {
  readonly [_gpuBufTag]: Tag;
  readonly buffer: GPUBuffer;
  readonly byteSize: number;
  readonly elementCount: number | undefined;
  readonly cpuBuffer: ArrayBuffer;
  viewAt(index?: number): View;
};

export type CreateTypedBufferOptions<Tag extends string, View extends StructView> = {
  device: GPUDevice;
  tag: Tag;
  byteSize: number;
  elementCount?: number;
  usage: GPUBufferUsageFlags;
  label?: string;
  viewAt: (cpuBuffer: ArrayBuffer, byteOffset: number) => View;
};

export function createTypedBuffer<Tag extends string, View extends StructView>(
  opts: CreateTypedBufferOptions<Tag, View>,
): TypedGPUBuffer<Tag, View> {
  const { device, tag, byteSize, elementCount, usage, label, viewAt } = opts;
  const cpuBuffer = new ArrayBuffer(byteSize);
  const buffer = device.createBuffer({ ...(label !== undefined && { label }), size: byteSize, usage });
  return {
    [_gpuBufTag]: tag as Tag,
    buffer,
    byteSize,
    elementCount,
    cpuBuffer,
    viewAt: (index = 0) => {
      const stride = elementCount !== undefined ? byteSize / elementCount : byteSize;
      return viewAt(cpuBuffer, Math.floor(index) * stride);
    },
  } as TypedGPUBuffer<Tag, View>;
}
