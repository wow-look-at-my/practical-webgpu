# practical-webgpu

Offline WGSL shader reflection and TypeScript codegen for WebGPU. Parses `.wgsl` files at build time, computes byte-accurate struct layouts, and emits strongly-typed TypeScript helpers so runtime code never touches raw byte offsets.

WebGPU stripped reflection from the spec. This project gives it back.

## Quick start

```ts
// generated from shaders/particles/simulate.wgsl
import * as Sim from './generated/shaders/particles/simulate';

const pipeline = Sim.createMainComputePipeline(device);
const cam      = Sim.createCameraBuffer(device, { label: 'camera' });
const parts    = Sim.createParticlesBuffer(device, 10_000);

Sim.writeCamera(device, cam, { view: viewMatrix, proj: projMatrix });

const layouts = Sim.createBindGroupLayouts(device);
const bg = Sim.createGroup0(device, layouts.group0, {
  camera: cam,
  particles: parts,
});

pass.setPipeline(pipeline);
pass.setBindGroup(0, bg);
pass.dispatchWorkgroups(Math.ceil(10_000 / 64));
```

## Workspace layout

```
packages/
  codegen/     # Build-time tool: WGSL → TypeScript
  runtime/     # Isomorphic support library (~200 lines)
shaders/       # Canonical .wgsl source files
  common/      # Shared .wgsli include files
generated/     # Codegen output — committed, never hand-edit
demos/         # Browser demos (Vite)
```

## Running codegen

```bash
pnpm codegen          # build once
pnpm codegen:check    # CI: fail if generated/ is stale
pnpm codegen:watch    # watch mode
```

## Generated API

For each shader `shaders/foo/bar.wgsl`, codegen writes `generated/shaders/foo/bar.ts` with:

- `SOURCE` — expanded WGSL string, ready for `device.createShaderModule()`
- `SOURCE_SHA256` — sha256 of source + all includes
- `REQUIRED_FEATURES` — `GPUFeatureName[]` (from `enable` directives)
- Per-struct layout constants: `MyStruct.size`, `MyStruct.align`, `MyStruct.offsets.*`
- Per-struct view classes: `class MyStructView extends StructView` with typed getters/setters
- Per-binding buffer types: `type MyBuffer = TypedGPUBuffer<'MyStruct', MyStructView>`
- Buffer factories: `createMyBuffer(device, count?, opts?)`
- Write helpers: `writeMyBuffer(device, buf, value)`, `writeMyBufferAt(device, buf, i, value)`, `writeMyBufferBatch(...)`
- Bind group layout descriptors and factories per `@group`
- `createBindGroupLayouts(device)`, `createPipelineLayout(device, layouts?)`
- Entry helpers: `createMainComputePipeline(device, opts?)`
- `reflection` — full normalized `ReflectionIR` as an `as const` literal

## Include preprocessor

```wgsl
// shaders/common/camera.wgsli
@pragma once
struct Camera { view: mat4x4<f32>, proj: mat4x4<f32> }
```

```wgsl
// shaders/particles/simulate.wgsl
@include "common/camera.wgsli"
```

Only `.wgsli` files may be included. Paths are resolved relative to the including file, then relative to each `includePaths` in config. Include file changes invalidate downstream codegen.
