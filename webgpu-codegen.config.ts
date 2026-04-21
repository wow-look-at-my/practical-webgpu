import { defineConfig } from './packages/codegen/src/index.js';

export default defineConfig({
  shaders: ['shaders/**/*.wgsl'],
  includePaths: ['shaders'],
  outDir: 'generated',
  outLayout: 'mirror',
  hoistGroups: true,
  emit: { json: true },
  runtimePackage: '@practical-webgpu/runtime',
});
