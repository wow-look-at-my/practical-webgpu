import { readFile } from 'node:fs/promises';
import glob from 'fast-glob';
import { sha256 } from '../util/formatter.js';

export interface DiscoveredShader {
  path: string;
  source: string;
  contentHash: string;
}

export async function discover(patterns: string[], cwd: string): Promise<DiscoveredShader[]> {
  const paths = await glob(patterns, { cwd, absolute: true, onlyFiles: true });
  return Promise.all(
    paths.sort().map(async (p) => {
      const source = await readFile(p, 'utf8');
      return { path: p, source, contentHash: sha256(source) };
    }),
  );
}
