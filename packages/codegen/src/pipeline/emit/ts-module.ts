/**
 * Emits the generated TypeScript module for a single WGSL shader.
 *
 * Given a fully-laid-out ReflectionIR, produces a .ts file with:
 *  - SOURCE / SOURCE_SHA256 / REQUIRED_FEATURES exports
 *  - Layout constants per struct
 *  - StructView subclasses for typed read/write
 *  - TypedGPUBuffer brands per binding
 *  - Buffer factories: createXBuffer(device, count?)
 *  - Write helpers: writeX(device, buf, value) and writeXAt(device, buf, index, value)
 *  - Bind group layout descriptors and factories per @group
 *  - Pipeline layout and entry-point helpers
 *  - The full reflection IR as an `as const` literal
 */

import type {
  BindGroupLayout,
  Binding,
  EntryPoint,
  ReflectionIR,
  StructDef,
  StructMember,
  TypeDef,
  TypeRef,
} from '../../ir/types.js';
import { makeBanner, normalizeLF } from '../../util/formatter.js';
import { toCamelCase, toPascalCase } from '../../util/identifier.js';

// ─── Public API ───────────────────────────────────────────────────────────────

export function emitTsModule(
  ir: ReflectionIR,
  rawWgslSource: string,
  runtimePkg = '@practical-webgpu/runtime',
): string {
  const lines: string[] = [];

  lines.push(makeBanner(ir.source.path, ir.source.sha256));
  lines.push(
    `import { StructView, createTypedBuffer, bindGroupFromEntries, type TypedGPUBuffer } from '${runtimePkg}';`,
  );
  lines.push('');

  lines.push(emitSourceExports(ir, rawWgslSource));
  lines.push('');

  // Layout constants and StructView subclasses for each struct that's used in a binding
  const boundStructIndices = collectBoundStructIndices(ir);
  for (const si of boundStructIndices) {
    const sd = ir.structs[si];
    if (!sd) continue;
    lines.push(emitStructLayout(ir, sd));
    lines.push('');
    lines.push(emitStructView(ir, sd));
    lines.push('');
  }

  // Buffer type aliases and factories per binding
  for (const b of ir.bindings) {
    if (b.resource.kind !== 'buffer') continue;
    const bufferLines = emitBufferBinding(ir, b, boundStructIndices);
    if (bufferLines) {
      lines.push(bufferLines);
      lines.push('');
    }
  }

  // Bind group layouts and factories
  for (const bg of ir.bindGroups) {
    lines.push(emitBindGroupLayout(ir, bg));
    lines.push('');
  }

  if (ir.bindGroups.length > 0) {
    lines.push(emitPipelineLayout(ir));
    lines.push('');
  }

  // Entry point helpers
  for (const entry of ir.entries) {
    lines.push(emitEntryHelper(ir, entry));
    lines.push('');
  }

  // Reflection IR literal
  lines.push(emitReflectionConst(ir));
  lines.push('');

  return normalizeLF(lines.join('\n'));
}

// ─── Source exports ───────────────────────────────────────────────────────────

function emitSourceExports(ir: ReflectionIR, raw: string): string {
  const escaped = raw.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
  return [
    `export const SOURCE = \`${escaped}\`;`,
    `export const SOURCE_SHA256 = '${ir.source.sha256}';`,
    `export const REQUIRED_FEATURES: readonly GPUFeatureName[] = [${ir.enables.map((e) => `'${e}' as GPUFeatureName`).join(', ')}];`,
  ].join('\n');
}

// ─── Struct layout constants ──────────────────────────────────────────────────

function emitStructLayout(_ir: ReflectionIR, sd: StructDef): string {
  const offsets = sd.members.map((m) => `    ${m.name}: ${m.offset}`).join(',\n');
  const sizes = sd.members.map((m) => `    ${m.name}: ${m.size}`).join(',\n');
  return [
    `export const ${sd.name} = {`,
    `  size: ${sd.size},`,
    `  align: ${sd.align},`,
    `  offsets: {\n${offsets}\n  } as const,`,
    `  sizes: {\n${sizes}\n  } as const,`,
    '} as const;',
  ].join('\n');
}

// ─── StructView subclass ──────────────────────────────────────────────────────

function emitStructView(ir: ReflectionIR, sd: StructDef): string {
  const viewName = `${sd.name}View`;
  const members = sd.members.map((m) => emitMemberAccessors(ir, m, sd.name)).join('\n\n');

  return [
    `export class ${viewName} extends StructView {`,
    `  static readonly BYTE_SIZE = ${sd.size};`,
    '',
    members,
    '}',
  ].join('\n');
}

function emitMemberAccessors(ir: ReflectionIR, m: StructMember, structName: string): string {
  const td = ir.types[m.type];
  if (!td) return `  // ${m.name}: unknown type`;

  const off = `${structName}.offsets.${m.name}`;

  switch (td.kind) {
    case 'scalar': {
      if (td.name === 'f32') {
        return [
          `  get ${m.name}(): number { return this.f32(${off}); }`,
          `  set ${m.name}(v: number) { this.setF32(${off}, v); }`,
        ].join('\n');
      }
      if (td.name === 'u32') {
        return [
          `  get ${m.name}(): number { return this.u32(${off}); }`,
          `  set ${m.name}(v: number) { this.setU32(${off}, v); }`,
        ].join('\n');
      }
      if (td.name === 'i32') {
        return [
          `  get ${m.name}(): number { return this.i32(${off}); }`,
          `  set ${m.name}(v: number) { this.setI32(${off}, v); }`,
        ].join('\n');
      }
      return `  // ${m.name}: ${td.name} (no accessor generated for this scalar)`;
    }
    case 'vec': {
      const count = td.n;
      return [
        `  get ${m.name}(): Float32Array { return this.f32x(${off}, ${count}); }`,
        `  set ${m.name}(v: ArrayLike<number>) { this.setF32x(${off}, v); }`,
      ].join('\n');
    }
    case 'mat': {
      const count = td.size / 4; // total floats
      return [
        `  get ${m.name}(): Float32Array { return this.f32x(${off}, ${count}); }`,
        `  set ${m.name}(v: ArrayLike<number>) { this.setF32x(${off}, v); }`,
      ].join('\n');
    }
    default:
      return `  // ${m.name}: complex type (no accessor generated)`;
  }
}

// ─── Buffer binding ────────────────────────────────────────────────────────────

function emitBufferBinding(
  ir: ReflectionIR,
  b: Binding,
  _boundStructIndices: Set<number>,
): string | null {
  if (b.resource.kind !== 'buffer') return null;
  const res = b.resource;

  // Find the element type info
  const elemInfo = resolveBufferElemType(ir, b);
  if (!elemInfo) return null;

  const { viewClass, tsTag, isArray, elemStride } = elemInfo;
  const bufTypeName = `${toPascalCase(b.name)}Buffer`;
  const factoryFn = `create${toPascalCase(b.name)}Buffer`;
  const writeFn = isArray ? `write${toPascalCase(b.name)}` : `write${toPascalCase(b.name)}`;
  const writeAtFn = isArray ? `write${toPascalCase(b.name)}At` : null;

  const defaultUsage =
    res.addressSpace === 'uniform'
      ? 'GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST'
      : 'GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST';

  const lines: string[] = [];

  // Type alias
  lines.push(`export type ${bufTypeName} = TypedGPUBuffer<'${tsTag}', ${viewClass}>;`);

  // Factory function
  if (isArray) {
    lines.push(
      `export function ${factoryFn}(device: GPUDevice, count: number, opts?: { label?: string; usage?: GPUBufferUsageFlags }): ${bufTypeName} {`,
      `  const byteSize = ${elemStride} * count;`,
      `  return createTypedBuffer({ device, tag: '${tsTag}', byteSize, elementCount: count, usage: opts?.usage ?? (${defaultUsage}), ...(opts?.label !== undefined && { label: opts.label }), viewAt: (buf, off) => new ${viewClass}(buf, off) });`,
      '}',
    );
  } else {
    lines.push(
      `export function ${factoryFn}(device: GPUDevice, opts?: { label?: string }): ${bufTypeName} {`,
      `  return createTypedBuffer({ device, tag: '${tsTag}', byteSize: ${viewClass}.BYTE_SIZE, usage: ${defaultUsage}, ...(opts?.label !== undefined && { label: opts.label }), viewAt: (buf, off) => new ${viewClass}(buf, off) });`,
      '}',
    );
  }

  // Write helper(s)
  const structName = viewClass.replace(/View$/, '');
  const sd = ir.structs.find((s) => s.name === structName);

  if (sd) {
    const valueType = sd.members
      .map((m) => {
        const td = ir.types[m.type];
        const tsType = td ? tsTypeForMember(td) : 'unknown';
        return `${m.name}: ${tsType}`;
      })
      .join('; ');

    if (isArray) {
      // writeX(device, buf, index, value)
      lines.push(
        `export function ${writeAtFn ?? writeFn}(device: GPUDevice, buf: ${bufTypeName}, index: number, value: { ${valueType} }): void {`,
        '  const v = buf.viewAt(index);',
        ...sd.members.map((m) => `  v.${m.name} = value.${m.name};`),
        `  device.queue.writeBuffer(buf.buffer, index * ${elemStride}, buf.cpuBuffer, index * ${elemStride}, ${elemStride});`,
        '}',
      );
      // writeXBatch(device, buf, values, startIndex?)
      lines.push(
        `export function ${writeFn}Batch(device: GPUDevice, buf: ${bufTypeName}, values: Iterable<{ ${valueType} }>, startIndex = 0): void {`,
        '  let i = startIndex;',
        `  for (const value of values) { ${writeAtFn ?? `${writeFn}At`}(device, buf, i++, value); }`,
        `  device.queue.writeBuffer(buf.buffer, startIndex * ${elemStride}, buf.cpuBuffer, startIndex * ${elemStride}, (i - startIndex) * ${elemStride});`,
        '}',
      );
    } else {
      lines.push(
        `export function ${writeFn}(device: GPUDevice, buf: ${bufTypeName}, value: { ${valueType} }): void {`,
        '  const v = buf.viewAt();',
        ...sd.members.map((m) => `  v.${m.name} = value.${m.name};`),
        '  device.queue.writeBuffer(buf.buffer, 0, buf.cpuBuffer);',
        '}',
      );
    }
  }

  return lines.join('\n');
}

interface BufferElemInfo {
  viewClass: string;
  tsTag: string;
  isArray: boolean;
  elemStride: number;
}

function resolveBufferElemType(ir: ReflectionIR, b: Binding): BufferElemInfo | null {
  if (b.resource.kind !== 'buffer') return null;
  const typeRef = b.resource.type;
  const td = ir.types[typeRef];
  if (!td) return null;

  if (td.kind === 'array') {
    const elemTd = ir.types[td.elem];
    if (!elemTd || elemTd.kind !== 'struct') return null;
    const sd = ir.structs[elemTd.ref];
    if (!sd) return null;
    return {
      viewClass: `${sd.name}View`,
      tsTag: `${sd.name}[]`,
      isArray: true,
      elemStride: td.stride,
    };
  }

  if (td.kind === 'struct') {
    const sd = ir.structs[td.ref];
    if (!sd) return null;
    return {
      viewClass: `${sd.name}View`,
      tsTag: sd.name,
      isArray: false,
      elemStride: sd.size,
    };
  }

  return null;
}

// ─── Bind group layout ────────────────────────────────────────────────────────

function emitBindGroupLayout(ir: ReflectionIR, bg: BindGroupLayout): string {
  const entries = bg.bindings.map((b) => emitBindGroupEntry(ir, b)).join(',\n');

  const createFn = `createGroup${bg.group}Layout`;
  const createBGFn = `createGroup${bg.group}`;
  const resType = bg.bindings
    .map((b) => {
      const name = toCamelCase(b.name);
      const bufInfo = b.resource.kind === 'buffer' ? resolveBufferElemType(ir, b) : null;
      const type = bufInfo
        ? `${toPascalCase(b.name)}Buffer | GPUBindingResource`
        : 'GPUBindingResource';
      return `${name}: ${type}`;
    })
    .join('; ');

  const entriesCode = bg.bindings
    .map((b) => {
      const name = toCamelCase(b.name);
      return `    { binding: ${b.binding}, resource: typeof res.${name} === 'object' && 'buffer' in res.${name} && 'byteSize' in res.${name} ? { buffer: (res.${name} as { buffer: GPUBuffer }).buffer } : res.${name} as GPUBindingResource },`;
    })
    .join('\n');

  return [
    'export const bindGroupLayouts = {',
    `  group${bg.group}: {`,
    '    entries: [',
    `${entries}`,
    '    ],',
    '  } satisfies GPUBindGroupLayoutDescriptor,',
    '} as const;',
    '',
    `export function ${createFn}(device: GPUDevice): GPUBindGroupLayout {`,
    `  return device.createBindGroupLayout(bindGroupLayouts.group${bg.group});`,
    '}',
    '',
    `export function ${createBGFn}(`,
    '  device: GPUDevice,',
    '  layout: GPUBindGroupLayout,',
    `  res: { ${resType} },`,
    '): GPUBindGroup {',
    '  return bindGroupFromEntries(device, layout, [',
    `${entriesCode}`,
    '  ]);',
    '}',
  ].join('\n');
}

function emitBindGroupEntry(_ir: ReflectionIR, b: Binding): string {
  const visibility =
    b.stages.length > 0
      ? b.stages.map(stageToGPUFlag).join(' | ')
      : 'GPUShaderStage.COMPUTE | GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT';

  if (b.resource.kind === 'buffer') {
    const res = b.resource;
    const bufType =
      res.addressSpace === 'uniform'
        ? 'uniform'
        : res.access === 'read'
          ? 'read-only-storage'
          : 'storage';
    const minSize = res.minBindingSize > 0 ? `, minBindingSize: ${res.minBindingSize}` : '';
    return `      { binding: ${b.binding}, visibility: ${visibility}, buffer: { type: '${bufType}'${minSize} } }`;
  }

  if (b.resource.kind === 'sampler') {
    return `      { binding: ${b.binding}, visibility: ${visibility}, sampler: { type: '${b.resource.samplerType}' } }`;
  }

  if (b.resource.kind === 'texture') {
    const res = b.resource;
    return `      { binding: ${b.binding}, visibility: ${visibility}, texture: { viewDimension: '${res.viewDimension}', sampleType: '${res.sampleType}', multisampled: ${res.multisampled} } }`;
  }

  if (b.resource.kind === 'storageTexture') {
    const res = b.resource;
    return `      { binding: ${b.binding}, visibility: ${visibility}, storageTexture: { format: '${res.format}', access: '${res.access}', viewDimension: '${res.viewDimension}' } }`;
  }

  return `      { binding: ${b.binding}, visibility: ${visibility} }`;
}

function stageToGPUFlag(stage: string): string {
  if (stage === 'vertex') return 'GPUShaderStage.VERTEX';
  if (stage === 'fragment') return 'GPUShaderStage.FRAGMENT';
  return 'GPUShaderStage.COMPUTE';
}

// ─── Pipeline layout ──────────────────────────────────────────────────────────

function emitPipelineLayout(ir: ReflectionIR): string {
  const groupParams = ir.bindGroups.map((bg) => `group${bg.group}?: GPUBindGroupLayout`).join('; ');
  const layoutsArg = ir.bindGroups
    .map((bg) => `    layouts?.group${bg.group} ?? createGroup${bg.group}Layout(device)`)
    .join(',\n');

  return [
    `export function createBindGroupLayouts(device: GPUDevice): { ${ir.bindGroups.map((bg) => `group${bg.group}: GPUBindGroupLayout`).join('; ')} } {`,
    '  return {',
    `${ir.bindGroups.map((bg) => `    group${bg.group}: createGroup${bg.group}Layout(device),`).join('\n')}`,
    '  };',
    '}',
    '',
    `export function createPipelineLayout(device: GPUDevice, layouts?: { ${groupParams} }): GPUPipelineLayout {`,
    '  return device.createPipelineLayout({',
    '    bindGroupLayouts: [',
    `${layoutsArg}`,
    '    ],',
    '  });',
    '}',
  ].join('\n');
}

// ─── Entry point helpers ──────────────────────────────────────────────────────

function emitEntryHelper(_ir: ReflectionIR, entry: EntryPoint): string {
  const fnName = `create${toPascalCase(entry.name)}${entry.stage === 'compute' ? 'Compute' : entry.stage === 'vertex' ? 'Vertex' : 'Fragment'}Pipeline`;

  if (entry.stage === 'compute') {
    const ws = entry.workgroupSize ?? [1, 1, 1];
    return [
      `export const ${toCamelCase(entry.name)}Entry = {`,
      `  name: '${entry.name}',`,
      `  stage: 'compute' as const,`,
      `  workgroupSize: [${ws.map((v) => (typeof v === 'number' ? v : `'${v.override}'`)).join(', ')}] as const,`,
      '} as const;',
      '',
      `export function ${fnName}(device: GPUDevice, opts?: { layout?: GPUPipelineLayout; constants?: Record<string, number>; label?: string }): GPUComputePipeline {`,
      '  const module = device.createShaderModule({ ...(opts?.label !== undefined && { label: opts.label }), code: SOURCE });',
      '  return device.createComputePipeline({',
      '    ...(opts?.label !== undefined && { label: opts.label }),',
      '    layout: opts?.layout ?? createPipelineLayout(device),',
      `    compute: { module, entryPoint: '${entry.name}', ...(opts?.constants !== undefined && { constants: opts.constants }) },`,
      '  });',
      '}',
    ].join('\n');
  }

  // vertex/fragment — just emit a marker for now
  return [
    `export const ${toCamelCase(entry.name)}Entry = {`,
    `  name: '${entry.name}',`,
    `  stage: '${entry.stage}' as const,`,
    '} as const;',
  ].join('\n');
}

// ─── Reflection IR literal ────────────────────────────────────────────────────

function emitReflectionConst(ir: ReflectionIR): string {
  // Serialize IR as an as-const literal (no JSON.parse at runtime)
  const serialized = JSON.stringify(ir, null, 2).replace(/"([a-zA-Z_][a-zA-Z0-9_]*)"\s*:/g, '$1:'); // unquote simple keys
  return `export const reflection = ${serialized} as const;`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function collectBoundStructIndices(ir: ReflectionIR): Set<number> {
  const result = new Set<number>();
  for (const b of ir.bindings) {
    if (b.resource.kind !== 'buffer') continue;
    collectStructsFromTypeRef(ir, b.resource.type, result);
  }
  return result;
}

function collectStructsFromTypeRef(ir: ReflectionIR, ref: TypeRef, out: Set<number>): void {
  const td = ir.types[ref];
  if (!td) return;
  if (td.kind === 'struct') {
    if (out.has(td.ref)) return;
    out.add(td.ref);
    const sd = ir.structs[td.ref];
    if (sd) {
      for (const m of sd.members) collectStructsFromTypeRef(ir, m.type, out);
    }
  }
  if (td.kind === 'array') collectStructsFromTypeRef(ir, td.elem, out);
  if (td.kind === 'atomic') collectStructsFromTypeRef(ir, td.elem, out);
}

function tsTypeForMember(td: TypeDef): string {
  switch (td.kind) {
    case 'scalar':
      return 'number';
    case 'vec':
      return 'ArrayLike<number>';
    case 'mat':
      return 'ArrayLike<number>';
    default:
      return 'unknown';
  }
}
