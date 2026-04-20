export function bindGroupFromEntries(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  entries: GPUBindGroupEntry[],
  label?: string,
): GPUBindGroup {
  return device.createBindGroup({ ...(label !== undefined && { label }), layout, entries });
}
