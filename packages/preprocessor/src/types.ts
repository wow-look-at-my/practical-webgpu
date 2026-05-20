/**
 * Pre-defined symbols for the WGSL preprocessor.
 *
 * - `Set<string>`: each member is an `@ifdef`-visible symbol with empty-string value.
 *   No `@define`-style substitution happens for Set members.
 * - `Map<string, string>`: each entry is `name -> substitution value`. Empty strings are
 *   treated as `@ifdef`-only markers (visible to `@ifdef`, not substituted).
 * - `Record<string, string | true>`: ergonomic plain-object form. `true` is shorthand
 *   for an empty-string value (Set-like behavior). Otherwise the string is the
 *   substitution value.
 */
export type Defines = Set<string> | Map<string, string> | Record<string, string | true>;

/**
 * Pluggable file-system access. The preprocessor never assumes Node -- supply your
 * own implementation (e.g. fetch-backed) for browser/runtime use.
 *
 * Paths passed in are absolute (or in whatever convention your custom resolver
 * produces). Path resolution is the preprocessor's job, not the FS's.
 */
export interface FileSystem {
  readFile(path: string): Promise<string>;
  exists(path: string): Promise<boolean>;
}

export interface PreprocessOptions {
  /** Additional base directories searched when resolving `@include` paths. */
  extraIncludePaths?: string[];
  /** Compile-time symbols. See {@link Defines}. */
  defines?: Defines;
  /** File system override. Defaults to a node:fs/promises-backed implementation. */
  fs?: FileSystem;
}

export interface PreprocessResult {
  /** Fully expanded WGSL source -- pass directly to `device.createShaderModule`. */
  source: string;
  /** Resolved paths of all transitively included files, in include order. */
  includes: string[];
  /**
   * Final merged define map: user-passed defines + any `@define` directives
   * encountered in source. Source-level `@define` overrides user-passed for the
   * same symbol.
   */
  defines: Map<string, string>;
}
