/**
 * Golden afternoon -> sunset -> night over one round.
 * Drives the sun/moon light, sky/ground ambient, building windows, street lamps
 * (glow sprites + light pools on the street), car head/tail lights and fire glow.
 */
import {
  AdditiveBlending,
  CanvasTexture,
  CircleGeometry,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  InstancedMesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  SRGBColorSpace,
  Vector3,
} from '@iwsdk/core';
import { headlightMat, taillightMat } from './kit-city.js';

interface Key {
  t: number;
  sun: number;
  sunI: number;
  elev: number; // degrees
  az: number; // degrees
  sky: number;
  ground: number;
  hemiI: number;
  lights: number; // 0..1 windows / lamps
}

// t = round progress
const KEYS: Key[] = [
  { t: 0.0, sun: 0xffe2b8, sunI: 2.5, elev: 52, az: 35, sky: 0xe6eeff, ground: 0x6b5a48, hemiI: 1.0, lights: 0 },
  { t: 0.35, sun: 0xffc485, sunI: 2.3, elev: 30, az: 55, sky: 0xffe0c0, ground: 0x6b5040, hemiI: 0.85, lights: 0 },
  { t: 0.55, sun: 0xff8040, sunI: 1.7, elev: 12, az: 70, sky: 0xffa080, ground: 0x553838, hemiI: 0.62, lights: 0.35 },
  { t: 0.72, sun: 0x9a70c8, sunI: 0.55, elev: 20, az: 110, sky: 0x6e64b0, ground: 0x282030, hemiI: 0.36, lights: 0.8 },
  { t: 1.0, sun: 0x9fb6ff, sunI: 0.5, elev: 48, az: 150, sky: 0x4a5aa8, ground: 0x1c1822, hemiI: 0.26, lights: 1 },
];

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,240,200,1)');
  grd.addColorStop(0.25, 'rgba(255,200,120,0.6)');
  grd.addColorStop(1, 'rgba(255,170,80,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export class DayCycle {
  readonly root = new Group();
  /** current light level of the city (0 = day, 1 = full night) */
  night = 0;
  private t = 0;
  private target = 0;
  private windowMats: MeshStandardMaterial[] = [];
  private lampGlow: InstancedMesh | null = null;
  private lampPool: InstancedMesh | null = null;
  private glowMat: MeshBasicMaterial;
  private poolMat: MeshBasicMaterial;
  private cA = new Color();
  private cB = new Color();
  private e = new Object3D();
  readonly dir = new Vector3();

  constructor(
    private sun: DirectionalLight,
    private hemi: HemisphereLight,
  ) {
    this.root.name = 'DayCycle';
    const tex = glowTexture();
    this.glowMat = new MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false });
    this.poolMat = new MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false });
    this.apply(0);
  }

  setup(lamps: Vector3[], windowMats: MeshStandardMaterial[]) {
    this.windowMats = windowMats;
    if (lamps.length === 0) return;
    // glow halo at each lamp head (billboard-ish: horizontal + vertical cross planes)
    this.lampGlow = new InstancedMesh(new PlaneGeometry(1, 1), this.glowMat, lamps.length * 2);
    this.lampPool = new InstancedMesh(new CircleGeometry(1, 16).rotateX(-Math.PI / 2), this.poolMat, lamps.length);
    lamps.forEach((p, i) => {
      for (let k = 0; k < 2; k++) {
        this.e.position.copy(p);
        this.e.rotation.set(0, k * (Math.PI / 2), 0);
        this.e.scale.setScalar(0.012);
        this.e.updateMatrix();
        this.lampGlow!.setMatrixAt(i * 2 + k, this.e.matrix);
      }
      this.e.position.set(p.x, 0.0046, p.z);
      this.e.rotation.set(0, 0, 0);
      this.e.scale.set(0.02, 1, 0.02);
      this.e.updateMatrix();
      this.lampPool!.setMatrixAt(i, this.e.matrix);
    });
    for (const im of [this.lampGlow, this.lampPool]) {
      im.frustumCulled = false;
      im.renderOrder = 2;
      this.root.add(im);
    }
  }

  /** Where the cycle should head (0 = afternoon, 1 = night); it eases there. */
  setTarget(t: number) {
    this.target = Math.max(0, Math.min(1, t));
  }

  /** Jump immediately (e.g. on restart). */
  snap(t: number) {
    this.target = this.t = t;
    this.apply(t);
  }

  update(dt: number) {
    const d = this.target - this.t;
    if (Math.abs(d) < 0.0005) return;
    // forward slowly with the round, rewind quickly on restart
    this.t += Math.sign(d) * Math.min(Math.abs(d), dt * (d > 0 ? 0.08 : 0.6));
    this.apply(this.t);
  }

  private apply(t: number) {
    let i = 0;
    while (i < KEYS.length - 2 && t > KEYS[i + 1].t) i++;
    const a = KEYS[i];
    const b = KEYS[i + 1];
    const k = Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t)));
    const lerp = (x: number, y: number) => x + (y - x) * k;
    this.sun.color.copy(this.cA.set(a.sun)).lerp(this.cB.set(b.sun), k);
    this.sun.intensity = lerp(a.sunI, b.sunI);
    const el = (lerp(a.elev, b.elev) * Math.PI) / 180;
    const az = (lerp(a.az, b.az) * Math.PI) / 180;
    this.dir.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
    this.sun.position.copy(this.dir).multiplyScalar(1.1);
    this.hemi.color.copy(this.cA.set(a.sky)).lerp(this.cB.set(b.sky), k);
    this.hemi.groundColor.copy(this.cA.set(a.ground)).lerp(this.cB.set(b.ground), k);
    this.hemi.intensity = lerp(a.hemiI, b.hemiI);
    const L = lerp(a.lights, b.lights);
    this.night = L;
    for (const m of this.windowMats) m.emissiveIntensity = L * 1.5;
    headlightMat.emissiveIntensity = 0.2 + L * 2.2;
    taillightMat.emissiveIntensity = 0.1 + L * 1.6;
    this.glowMat.opacity = L * 0.9;
    this.poolMat.opacity = L * 0.35;
    if (this.lampGlow) this.lampGlow.visible = this.lampPool!.visible = L > 0.02;
  }
}
