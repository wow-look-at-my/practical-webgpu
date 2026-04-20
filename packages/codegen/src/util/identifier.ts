/** Converts a WGSL identifier to a valid TypeScript identifier. */
export function toTsIdent(name: string): string {
  return name.replace(/[^a-zA-Z0-9_$]/g, '_');
}

/** UpperCamelCase for class/type names. */
export function toPascalCase(name: string): string {
  return toTsIdent(name).replace(/(?:^|_)([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** lowerCamelCase for variable/function names. */
export function toCamelCase(name: string): string {
  const pascal = toPascalCase(name);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}
