/**
 * Process `@ifdef SYMBOL ... @endif` blocks.
 *
 * - If `SYMBOL` is a key in `defines`, the body is kept (without the directive lines).
 * - Otherwise the entire block (directive lines + body) is removed.
 * - Nesting is NOT supported: the first `@endif` always closes the current block.
 * - `@ifdef` and `@endif` must each appear on their own line (the parser tolerates
 *   leading/trailing whitespace on those lines).
 *
 * Throws if an `@ifdef` lacks a matching `@endif`.
 */
export function processIfdefs(
  source: string,
  defines: Map<string, string>,
  filePath = '<source>',
): string {
  const lines = source.split('\n');
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';
    const ifdefMatch = /^[ \t]*@ifdef[ \t]+(\w+)[ \t]*$/.exec(line);
    if (!ifdefMatch) {
      out.push(line);
      i += 1;
      continue;
    }

    const symbol = ifdefMatch[1] ?? '';
    const startLine = i + 1;
    const bodyLines: string[] = [];
    let foundEnd = false;
    i += 1;

    while (i < lines.length) {
      const inner = lines[i] ?? '';
      if (/^[ \t]*@endif[ \t]*$/.test(inner)) {
        foundEnd = true;
        i += 1;
        break;
      }
      bodyLines.push(inner);
      i += 1;
    }

    if (!foundEnd) {
      throw new Error(
        `@ifdef ${symbol} is missing a matching @endif (in ${filePath} at line ${startLine})`,
      );
    }

    if (defines.has(symbol)) {
      out.push(...bodyLines);
    }
  }

  return out.join('\n');
}
