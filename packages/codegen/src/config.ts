export type DefineValue = string | true;
export type DefineMap = Record<string, DefineValue>;

export interface ShaderDefines {
  /**
   * Glob pattern matched against the shader's path relative to cwd.
   * Patterns use picomatch syntax (e.g. `shaders/particles/**`).
   */
  match: string;
  /** Defines applied to shaders matching `match`. */
  defines: DefineMap;
}

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
  /**
   * Defines applied to all shaders. Keys are symbol names; values are either a
   * substitution string or `true` (symbol-only, for @ifdef gating).
   */
  defines: DefineMap;
  /**
   * Per-shader define overrides. The first matching entry (in array order) is
   * merged on top of the global `defines` for that shader.
   */
  shaderDefines: ShaderDefines[];
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
    defines: {},
    shaderDefines: [],
    ...config,
  };
}

export const DEFAULT_CONFIG: CodegenConfig = defineConfig({
  shaders: ['shaders/**/*.wgsl'],
});
