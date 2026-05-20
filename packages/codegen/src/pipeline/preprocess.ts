/**
 * Re-export of the standalone preprocessor package, kept here so internal
 * callers (`runCodegen`, the `print` CLI) keep their existing import paths.
 *
 * The implementation lives in `@practical-webgpu/preprocessor`. See that
 * package for documentation of `@include`, `@pragma once`, `@define`, and
 * `@ifdef`/`@endif`.
 */
export { computeSourceHash, preprocess } from '@practical-webgpu/preprocessor';
export type { PreprocessOptions, PreprocessResult } from '@practical-webgpu/preprocessor';
