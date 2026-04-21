export interface CodegenConfig {
  /** Glob patterns for .wgsl source files, relative to cwd. */
  shaders: string[];
  /** Additional base directories searched when resolving @include paths. */
  includePaths: string[];
  /** Output directory, relative to cwd. */
  outDir: string;
  /** How to map source paths to output paths. */
  outLayout: 'mirror';
  /** Hoist shared bind groups into generated/groups/. */
  hoistGroups: boolean;
  /** Emit options. */
  emit: {
    /** Also emit a .refl.json alongside each .ts (useful for debugging). */
    json: boolean;
  };
  /** Runtime package import path. */
  runtimePackage: string;
}

export function defineConfig(
  config: Partial<CodegenConfig> & { shaders: string[] },
): CodegenConfig {
  return {
    outDir: 'generated',
    outLayout: 'mirror',
    hoistGroups: true,
    includePaths: ['shaders'],
    emit: { json: false },
    runtimePackage: '@practical-webgpu/runtime',
    ...config,
  };
}

export const DEFAULT_CONFIG: CodegenConfig = defineConfig({
  shaders: ['shaders/**/*.wgsl'],
});
