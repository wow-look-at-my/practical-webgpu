@include "common/sampling.wgsli"
@include "common/cubemap.wgsli"

struct SpecularParams {
  face: u32,
  roughness: f32,
  output_size: u32,
  sample_count: u32,
}

@group(0) @binding(0) var env_cubemap: texture_cube<f32>;
@group(0) @binding(1) var env_sampler: sampler;
@group(0) @binding(2) var output_face: texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var<uniform> params: SpecularParams;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let size = params.output_size;
  if (gid.x >= size || gid.y >= size) { return; }

  let uv = (vec2<f32>(gid.xy) + 0.5) / f32(size);
  let n = face_uv_to_direction(params.face, uv);
  let v = n;

  var color = vec3<f32>(0.0);
  var total_weight = 0.0;
  let roughness = max(params.roughness, 0.001);

  for (var i = 0u; i < params.sample_count; i++) {
    let xi = hammersley(i, params.sample_count);
    let h = importance_sample_ggx(xi, roughness, n);
    let l = normalize(2.0 * dot(v, h) * h - v);
    let n_dot_l = max(dot(n, l), 0.0);

    if (n_dot_l > 0.0) {
      let sample_color = textureSampleLevel(env_cubemap, env_sampler, l, 0.0);
      color += sample_color.rgb * n_dot_l;
      total_weight += n_dot_l;
    }
  }

  if (total_weight > 0.0) {
    color /= total_weight;
  }

  textureStore(output_face, gid.xy, vec4<f32>(color, 1.0));
}
