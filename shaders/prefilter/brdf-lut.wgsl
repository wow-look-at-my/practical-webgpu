@include "common/sampling.wgsli"

struct BrdfLutParams {
  size: u32,
  sample_count: u32,
}

@group(0) @binding(0) var output_lut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(1) var<uniform> params: BrdfLutParams;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let size = params.size;
  if (gid.x >= size || gid.y >= size) { return; }

  let n_dot_v = max((f32(gid.x) + 0.5) / f32(size), 0.001);
  let roughness = max((f32(gid.y) + 0.5) / f32(size), 0.001);

  let v = vec3<f32>(sqrt(1.0 - n_dot_v * n_dot_v), 0.0, n_dot_v);
  let n = vec3<f32>(0.0, 0.0, 1.0);

  var scale = 0.0;
  var bias = 0.0;

  for (var i = 0u; i < params.sample_count; i++) {
    let xi = hammersley(i, params.sample_count);
    let h = importance_sample_ggx(xi, roughness, n);
    let l = normalize(2.0 * dot(v, h) * h - v);

    let n_dot_l = max(l.z, 0.0);
    let n_dot_h = max(h.z, 0.0);
    let v_dot_h = max(dot(v, h), 0.0);

    if (n_dot_l > 0.0) {
      let g = geometry_smith(n, v, l, roughness);
      let g_vis = (g * v_dot_h) / (n_dot_h * n_dot_v);
      let fc = pow(1.0 - v_dot_h, 5.0);

      scale += (1.0 - fc) * g_vis;
      bias += fc * g_vis;
    }
  }

  scale /= f32(params.sample_count);
  bias /= f32(params.sample_count);

  textureStore(output_lut, gid.xy, vec4<f32>(scale, bias, 0.0, 1.0));
}
