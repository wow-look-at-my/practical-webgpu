import { access, readFile } from 'node:fs/promises';
import type { FileSystem } from './types.js';

/**
 * Default Node.js file system, backed by `node:fs/promises`.
 *
 * `exists(path)` returns true iff the path is accessible -- it does not check
 * type. The preprocessor only uses this to probe candidate include locations.
 */
export function nodeFs(): FileSystem {
  return {
    async readFile(path) {
      return readFile(path, 'utf8');
    },
    async exists(path) {
      try {
        await access(path);
        return true;
      } catch {
        return false;
      }
    },
  };
}

/**
 * In-memory file system for tests and browser shims.
 *
 * Keys are absolute paths (or whatever convention the caller resolves to).
 * Trailing slashes are not normalised -- keys must match resolution output exactly.
 */
export function memoryFs(files: Record<string, string>): FileSystem {
  const map = new Map(Object.entries(files));
  return {
    async readFile(path) {
      const content = map.get(path);
      if (content === undefined) {
        throw new Error(`memoryFs: file not found: ${path}`);
      }
      return content;
    },
    async exists(path) {
      return map.has(path);
    },
  };
}
