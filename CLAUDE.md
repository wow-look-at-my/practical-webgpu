# practical-webgpu — CLAUDE.md

## Repo map

```
packages/codegen/src/
  cli.ts                    # CLI entry: webgpu-codegen build/watch/print
  config.ts                 # defineConfig() + CodegenConfig type
  index.ts                  # Programmatic API: runCodegen()
  ir/types.ts               # ReflectionIR schema — lock before editing emitter
  pipeline/
    discover.ts             # fast-glob → DiscoveredShader[]
    preprocess.ts           # @include / @pragma once expansion
    normalize.ts            # wgsl_reflect → ReflectionIR
    layout.ts               # WGSL byte layout rules (highest-risk code)
    emit/ts-module.ts       # ReflectionIR → generated .ts
  util/
    identifier.ts           # WGSL → TS name sanitization
    formatter.ts            # sha256, stableJson, normalizeLF, banner
    wgsl-types.ts           # scalar/vec/mat name helpers

packages/runtime/src/
  struct-view.ts            # StructView base class
  types.ts                  # TypedGPUBuffer brand + createTypedBuffer
  align.ts                  # alignTo()
  bind-group.ts             # bindGroupFromEntries()

shaders/                    # Canonical WGSL source — edit these
  common/*.wgsli            # Shared include files
generated/                  # COMMITTED — never hand-edit
  shaders/*/                # Mirrors shaders/ layout
```

## Pipeline phases

```
discover → preprocess → normalize → fillLayoutIntoIR → emitTsModule → writeIfChanged
```

| Phase | Key function | File |
|---|---|---|
| discover | `discover(globs, cwd)` | pipeline/discover.ts |
| preprocess | `preprocess(path, source, includePaths)` | pipeline/preprocess.ts |
| normalize | `normalize(path, hash, includes, source)` | pipeline/normalize.ts |
| layout fill | `fillLayoutIntoIR(ir)` | pipeline/layout.ts |
| emit | `emitTsModule(ir, expandedWgsl, runtimePkg)` | pipeline/emit/ts-module.ts |
| write | `writeIfChanged(path, content)` | index.ts |

## How to add a new shader

1. Create `shaders/<your-dir>/<name>.wgsl`
2. Add any shared structs to `shaders/common/<name>.wgsli` (with `@pragma once`)
3. Run `pnpm codegen` — writes `generated/shaders/<your-dir>/<name>.ts`
4. Commit both the `.wgsl` and the generated `.ts`

## Invariants

- `generated/` is COMMITTED and deterministic (sha256 in banner, sorted keys, LF endings)
- Never hand-edit anything in `generated/` — regenerate instead
- Always run `pnpm codegen` after editing `.wgsl` or `.wgsli` files
- CI runs `pnpm codegen:check` which fails if generated files are stale
- `SOURCE` in generated files is the EXPANDED wgsl (includes inlined) — pass directly to `device.createShaderModule()`

## Layout rules (layout.ts)

- Scalars: f32/i32/u32/bool = size+align 4; f16 = size+align 2
- vec2: size=2×elem, align=2×elem; vec3: size=3×elem, align=4×elem; vec4: size=4×elem, align=4×elem
- matCxR: colStride = AlignOf(vecR<elem>), size = cols × colStride (NOT hardcoded ×16 — that was a spec-compliance bug)
- struct: align = max member align; size = alignTo(last offset + last size, struct align)
- array (storage): stride = alignTo(elem size, elem align)
- array (uniform): stride = alignTo(above, 16)

## Known limitations / future work

- `enable f16` views emit raw f32 accessors (f16 TypedArray not in JS yet)
- Vertex buffer layout helpers not generated (v2)
- Cross-shader bind group hoisting not yet implemented (v2)
- No Vite plugin yet — run `pnpm codegen:watch` alongside `vite dev`
- `layout: 'auto'` not supported — always explicit layouts required
