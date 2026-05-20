@include "common/sampling.wgsli"
@include "common/cubemap.wgsli"

struct IrradianceParams {
  face: u32,
  output_size: u32,
  sample_count: u32,
}

@group(0) @binding(0) var env_cubemap: texture_cube<f32>;
@group(0) @binding(1) var env_sampler: sampler;
@group(0) @binding(2) var output_face: texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var<uniform> params: IrradianceParams;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let size = params.output_size;
  if (gid.x >= size || gid.y >= size) { return; }

  let uv = (vec2<f32>(gid.xy) + 0.5) / f32(size);
  let n = face_uv_to_direction(params.face, uv);

  let up = select(vec3<f32>(1.0, 0.0, 0.0), vec3<f32>(0.0, 0.0, 1.0), abs(n.z) < 0.999);
  let tangent = normalize(cross(up, n));
  let bitangent = cross(n, tangent);

  var irradiance = vec3<f32>(0.0);

  for (var i = 0u; i < params.sample_count; i++) {
    let xi = hammersley(i, params.sample_count);
    let r = sqrt(xi.x);
    let phi = TWO_PI * xi.y;
    let sample_dir = normalize(
      tangent * (r * cos(phi)) + bitangent * (r * sin(phi)) + n * sqrt(1.0 - xi.x)
    );

    let color = textureSampleLevel(env_cubemap, env_sampler, sample_dir, 0.0);
    irradiance += color.rgb;
  }

  irradiance = irradiance * PI / f32(params.sample_count);
  textureStore(output_face, gid.xy, vec4<f32>(irradiance, 1.0));
}
