@include "common/sampling.wgsli"
@include "common/cubemap.wgsli"

struct SpecularParams {
  face: u32,
  roughness: f32,
  output_size: u32,
  sample_count: u32,
  input_size: u32,
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

  // Below roughness ~0.02 the GGX pdf math is f32-degenerate: a^2 underflows
  // against 1.0 in the NDF denominator, and per-sample ulp wobble in the
  // half-vector swings the pdf between ~1 and inf, scattering the FIS mip
  // level per sample. A mirror mip needs no filtering at all -- the input is
  // resolvable by construction -- so copy it straight through.
  if (params.roughness < 0.02) {
    let c = textureSampleLevel(env_cubemap, env_sampler, n, 0.0).rgb;
    textureStore(output_face, gid.xy, vec4<f32>(c, 1.0));
    return;
  }

  let v = n;
  var color = vec3<f32>(0.0);
  var total_weight = 0.0;
  let roughness = params.roughness;

  for (var i = 0u; i < params.sample_count; i++) {
    let xi = hammersley(i, params.sample_count);
    let h = importance_sample_ggx(xi, roughness, n);
    let l = normalize(2.0 * dot(v, h) * h - v);
    let n_dot_l = max(dot(n, l), 0.0);

    if (n_dot_l > 0.0) {
      let n_dot_h = max(dot(n, h), 0.0);
      let h_dot_v = max(dot(h, v), 0.001);
      let d = distribution_ggx(n_dot_h, roughness);
      let pdf = d * n_dot_h / (4.0 * h_dot_v);
      let sa_texel = 4.0 * PI / (6.0 * f32(params.input_size) * f32(params.input_size));
      let sa_sample = 1.0 / (f32(params.sample_count) * pdf + 0.0001);
      let mip_level = 0.5 * log2(sa_sample / sa_texel) + 1.0;

      let sample_color = textureSampleLevel(env_cubemap, env_sampler, l, mip_level);
      color += sample_color.rgb * n_dot_l;
      total_weight += n_dot_l;
    }
  }

  if (total_weight > 0.0) {
    color /= total_weight;
  }

  textureStore(output_face, gid.xy, vec4<f32>(color, 1.0));
}
