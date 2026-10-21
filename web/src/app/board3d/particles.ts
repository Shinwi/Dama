import {
  AdditiveBlending,
  Blending,
  BufferAttribute,
  BufferGeometry,
  Color,
  NormalBlending,
  Points,
  ShaderMaterial,
} from 'three';

export interface Burst {
  count: number;
  x: number;
  y: number;
  z: number;
  /** Starting speed, world units a second, in a random direction... */
  speed: number;
  /** ...plus this much straight up. */
  lift?: number;
  /** Flattens the random direction towards the horizontal: 0 = sphere, 1 = flat ring. */
  flat?: number;
  /** Starting spread of the particles around (x, y, z). */
  spread?: number;
  gravity?: number;
  /** Slows particles down: fraction of speed kept per second. */
  drag?: number;
  life: number;
  size: number;
  colors: string[];
  alpha?: number;
}

const VERTEX = /* glsl */ `
  attribute float size;
  attribute float alpha;
  attribute vec3 tint;
  uniform float scale;
  varying float vAlpha;
  varying vec3 vTint;
  void main() {
    vAlpha = alpha;
    vTint = tint;
    vec4 view = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * scale / -view.z;
    gl_Position = projectionMatrix * view;
  }
`;

const FRAGMENT = /* glsl */ `
  varying float vAlpha;
  varying vec3 vTint;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.05, d) * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vTint, a);
    #include <colorspace_fragment>
  }
`;

/**
 * A fixed pool of soft round particles drawn as one `Points` object: dust when a piece lands,
 * shards and sparks on a capture, gold on a promotion, steam from the teapot, motes in the
 * lantern light. Particles are recycled oldest first when the pool is full.
 */
export class Particles {
  readonly points: Points;
  private readonly material: ShaderMaterial;
  private readonly position: Float32Array;
  private readonly velocity: Float32Array;
  private readonly tint: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly baseAlpha: Float32Array;
  private readonly gravity: Float32Array;
  private readonly drag: Float32Array;
  private next = 0;
  private readonly color = new Color();

  constructor(
    private readonly capacity: number,
    blending: Blending = AdditiveBlending,
  ) {
    this.position = new Float32Array(capacity * 3);
    this.velocity = new Float32Array(capacity * 3);
    this.tint = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.baseAlpha = new Float32Array(capacity);
    this.gravity = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(this.position, 3));
    geometry.setAttribute('tint', new BufferAttribute(this.tint, 3));
    geometry.setAttribute('size', new BufferAttribute(this.size, 1));
    geometry.setAttribute('alpha', new BufferAttribute(this.alpha, 1));
    this.material = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: { scale: { value: 500 } },
      transparent: true,
      depthWrite: false,
      blending,
    });
    this.points = new Points(geometry, this.material);
    this.points.frustumCulled = false;
  }

  static soft(capacity: number): Particles {
    return new Particles(capacity, NormalBlending);
  }

  /** Pixels per world unit at distance 1, so particle sizes stay in world units. */
  setScale(scale: number): void {
    this.material.uniforms['scale'].value = scale;
  }

  emit(burst: Burst): void {
    const flat = burst.flat ?? 0;
    const spread = burst.spread ?? 0;
    for (let n = 0; n < burst.count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % this.capacity;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const speed = burst.speed * (0.4 + Math.random() * 0.6);
      const dx = Math.sin(phi) * Math.cos(theta);
      const dz = Math.sin(phi) * Math.sin(theta);
      const dy = Math.cos(phi) * (1 - flat);
      this.position[i * 3] = burst.x + (Math.random() - 0.5) * spread;
      this.position[i * 3 + 1] = burst.y + (Math.random() - 0.5) * spread * (1 - flat);
      this.position[i * 3 + 2] = burst.z + (Math.random() - 0.5) * spread;
      this.velocity[i * 3] = dx * speed;
      this.velocity[i * 3 + 1] = Math.abs(dy) * speed + (burst.lift ?? 0) * (0.6 + Math.random() * 0.4);
      this.velocity[i * 3 + 2] = dz * speed;
      this.color.set(burst.colors[Math.floor(Math.random() * burst.colors.length)]);
      this.tint[i * 3] = this.color.r;
      this.tint[i * 3 + 1] = this.color.g;
      this.tint[i * 3 + 2] = this.color.b;
      this.size[i] = burst.size * (0.6 + Math.random() * 0.8);
      this.maxLife[i] = burst.life * (0.6 + Math.random() * 0.4);
      this.life[i] = this.maxLife[i];
      this.baseAlpha[i] = burst.alpha ?? 1;
      this.gravity[i] = burst.gravity ?? 0;
      this.drag[i] = burst.drag ?? 1;
    }
  }

  update(dt: number): void {
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const keep = this.drag[i] ** dt;
      this.velocity[i * 3] *= keep;
      this.velocity[i * 3 + 1] = this.velocity[i * 3 + 1] * keep - this.gravity[i] * dt;
      this.velocity[i * 3 + 2] *= keep;
      this.position[i * 3] += this.velocity[i * 3] * dt;
      this.position[i * 3 + 1] += this.velocity[i * 3 + 1] * dt;
      this.position[i * 3 + 2] += this.velocity[i * 3 + 2] * dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      // Quick fade in, long fade out.
      this.alpha[i] = this.baseAlpha[i] * Math.min(1, (1 - t) * 8) * t;
    }
    const geometry = this.points.geometry;
    geometry.attributes['position'].needsUpdate = true;
    geometry.attributes['alpha'].needsUpdate = true;
    geometry.attributes['tint'].needsUpdate = true;
    geometry.attributes['size'].needsUpdate = true;
  }

  clear(): void {
    this.life.fill(0);
    this.alpha.fill(0);
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}
