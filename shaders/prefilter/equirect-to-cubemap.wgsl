@include "common/sampling.wgsli"
@include "common/cubemap.wgsli"

struct EquirectParams {
  face: u32,
  output_size: u32,
}

@group(0) @binding(0) var equirect_tex: texture_2d<f32>;
@group(0) @binding(1) var equirect_sampler: sampler;
@group(0) @binding(2) var output_face: texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var<uniform> params: EquirectParams;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let size = params.output_size;
  if (gid.x >= size || gid.y >= size) { return; }

  let uv = (vec2<f32>(gid.xy) + 0.5) / f32(size);
  let dir = face_uv_to_direction(params.face, uv);
  let eq_uv = direction_to_equirect_uv(dir);
  let color = textureSampleLevel(equirect_tex, equirect_sampler, eq_uv, 0.0);
  textureStore(output_face, gid.xy, color);
}
