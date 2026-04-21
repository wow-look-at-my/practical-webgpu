@include "common/camera.wgsli"

struct Particle {
  pos: vec3<f32>,
  vel: vec3<f32>,
  life: f32,
}

@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<storage, read_write> particles: array<Particle>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= arrayLength(&particles)) { return; }
  particles[i].pos += particles[i].vel;
  particles[i].life -= 0.01;
}
