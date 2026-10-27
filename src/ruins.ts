/**
 * What a destroyed city leaves behind: rubble piles in the building's own colours,
 * scorch marks, quake cracks, and burning ruins with fire, smoke columns, embers
 * and a couple of flickering fire lights. Everything is pooled and city-local.
 */
import {
  AdditiveBlending,
  CanvasTexture,
  CircleGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  PointLight,
  SRGBColorSpace,
  Vector3,
} from '@iwsdk/core';

interface Pile {
  start: number;
  count: number;
  t: number;
}
interface Fire {
  active: boolean;
  p: Vector3;
  size: number;
  life: number;
  max: number;
  acc: number;
  smokeAcc: number;
}
interface P {
  active: boolean;
  p: Vector3;
  v: Vector3;
  s: number;
  life: number;
  max: number;
  spin: number;
}

const pool = (n: number): P[] =>
  Array.from({ length: n }, () => ({ active: false, p: new Vector3(), v: new Vector3(), s: 0, life: 0, max: 1, spin: 0 }));

function lumpy(detail: number, seedScale = 0.35) {
  const g = new IcosahedronGeometry(1, detail);
  const pos = g.attributes.position;
  const moved = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    let k = moved.get(key);
    if (k === undefined) {
      k = 1 - seedScale / 2 + Math.random() * seedScale;
      moved.set(key, k);
    }
    pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k, pos.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}

function radialTexture(inner: string, outer: string) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grd.addColorStop(0, inner);
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Hand-drawn style ground crack: a few jagged branches from the centre. */
function crackTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.strokeStyle = 'rgba(25,20,18,0.95)';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const branch = (x: number, y: number, ang: number, len: number, w: number, depth: number) => {
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(x, y);
    let cx = x;
    let cy = y;
    const steps = 6;
    for (let i = 0; i < steps; i++) {
      ang += (Math.random() - 0.5) * 0.9;
      cx += Math.cos(ang) * (len / steps);
      cy += Math.sin(ang) * (len / steps);
      g.lineTo(cx, cy);
      if (depth > 0 && Math.random() < 0.3) branch(cx, cy, ang + (Math.random() < 0.5 ? 0.9 : -0.9), len * 0.45, w * 0.6, depth - 1);
    }
    g.stroke();
  };
  const n = 6 + Math.floor(Math.random() * 3);
  for (let i = 0; i < n; i++) branch(128, 128, (i / n) * Math.PI * 2 + Math.random() * 0.4, 70 + Math.random() * 50, 7, 2);
  // dark centre
  const grd = g.createRadialGradient(128, 128, 2, 128, 128, 34);
  grd.addColorStop(0, 'rgba(20,16,14,0.8)');
  grd.addColorStop(1, 'rgba(20,16,14,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export class Ruins {
  readonly root = new Group();
  private rubble: InstancedMesh;
  private rubbleN = 0;
  private rubbleMax = 0;
  private piles: Pile[] = [];
  private scorch: InstancedMesh;
  private scorchN = 0;
  private cracks: Mesh[] = [];
  private crackI = 0;
  private fires: Fire[] = Array.from({ length: 36 }, () => ({ active: false, p: new Vector3(), size: 0, life: 0, max: 1, acc: 0, smokeAcc: 0 }));
  private flame: InstancedMesh;
  private flameP = pool(260);
  private flameI = 0;
  private smoke: InstancedMesh;
  private smokeP = pool(360);
  private smokeI = 0;
  private ember: InstancedMesh;
  private emberP = pool(140);
  private emberI = 0;
  private lights: PointLight[] = [];
  private e = new Object3D();
  private capacity = new Map<InstancedMesh, number>();
  private col = new Color();
  private hidden = new Matrix4().makeScale(0, 0, 0);
  private wind = new Vector3(0.012, 0, 0.006);
  private time = 0;
  /** 0 = day, 1 = night; fire glows harder in the dark */
  night = 0;
  /** effects quality 0..1 (scales fire / smoke / ember emission) */
  quality = 1;

  constructor() {
    this.root.name = 'Ruins';
    const RUBBLE = 1400;
    this.rubble = new InstancedMesh(lumpy(0, 0.5), new MeshStandardMaterial({ roughness: 0.95, flatShading: true }), RUBBLE);
    this.rubble.receiveShadow = true;
    this.rubble.castShadow = true;
    this.scorch = new InstancedMesh(
      new CircleGeometry(1, 20).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({ map: radialTexture('rgba(18,14,12,0.85)', 'rgba(18,14,12,0)'), transparent: true, depthWrite: false }),
      90,
    );
    this.scorch.renderOrder = 1;
    this.flame = new InstancedMesh(
      lumpy(0, 0.3),
      // cartoon flames: solid unlit colour (additive blending washed out to white)
      new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }),
      this.flameP.length,
    );
    this.smoke = new InstancedMesh(
      lumpy(1, 0.25),
      new MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0.38, flatShading: true, depthWrite: false }),
      this.smokeP.length,
    );
    this.ember = new InstancedMesh(
      new IcosahedronGeometry(1, 0),
      new MeshBasicMaterial({ color: 0xffa040, blending: AdditiveBlending, transparent: true, depthWrite: false }),
      this.emberP.length,
    );
    for (const im of [this.rubble, this.scorch, this.flame, this.smoke, this.ember]) {
      im.instanceMatrix.setUsage(DynamicDrawUsage);
      im.frustumCulled = false;
      for (let i = 0; i < im.count; i++) im.setMatrixAt(i, this.hidden);
      this.root.add(im);
    }
    this.capacity.set(this.rubble, this.rubble.count);
    this.capacity.set(this.scorch, this.scorch.count);
    this.capacity.set(this.flame, this.flame.count);
    this.capacity.set(this.smoke, this.smoke.count);
    this.capacity.set(this.ember, this.ember.count);
    // only draw instances that have ever been used (hidden ones still cost vertices)
    this.rubble.count = this.scorch.count = this.flame.count = this.smoke.count = this.ember.count = 0;
    for (let i = 0; i < this.rubble.count; i++) this.rubble.setColorAt(i, this.col.set(0x888888));
    for (let i = 0; i < this.flame.count; i++) this.flame.setColorAt(i, this.col.set(0xffaa33));
    for (let i = 0; i < this.smoke.count; i++) this.smoke.setColorAt(i, this.col.set(0x444444));
    const crackGeo = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    for (let i = 0; i < 6; i++) {
      const m = new Mesh(crackGeo, new MeshBasicMaterial({ map: crackTexture(), transparent: true, depthWrite: false, opacity: 0.9 }));
      m.visible = false;
      m.renderOrder = 1;
      this.root.add(m);
      this.cracks.push(m);
    }
    // one flickering fire light (each extra light costs every lit pixel on Quest)
    for (let i = 0; i < 1; i++) {
      const l = new PointLight(0xff7a2a, 0, 0.45, 2);
      this.root.add(l);
      this.lights.push(l);
    }
  }

  /** A collapsed building: rubble mound over its footprint, scorch, maybe a fire. */
  addRuin(x: number, z: number, w: number, d: number, height: number, palette: number[], burn: boolean) {
    const n = Math.min(26, 9 + Math.round(height * 110));
    if (this.rubbleN + n > this.capacity.get(this.rubble)!) this.rubbleN = 0; // recycle the oldest piles
    const start = this.rubbleN;
    const mound = Math.min(0.022, 0.006 + height * 0.08);
    for (let k = 0; k < n; k++) {
      const i = this.rubbleN++;
      const u = (Math.random() - 0.5) * 1.1;
      const v = (Math.random() - 0.5) * 1.1;
      const centre = 1 - Math.min(1, Math.hypot(u, v) * 1.5);
      const s = (0.18 + Math.random() * 0.22) * Math.min(w, d) * 0.5 + 0.002;
      this.e.position.set(x + u * w, 0.004 + centre * mound * Math.random() + s * 0.3, z + v * d);
      this.e.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      this.e.scale.set(s * (0.8 + Math.random() * 0.6), s * (0.5 + Math.random() * 0.4), s * (0.8 + Math.random() * 0.6));
      this.e.updateMatrix();
      this.rubble.setMatrixAt(i, this.e.matrix);
      this.col.set(palette[Math.floor(Math.random() * palette.length)]).multiplyScalar(0.55 + Math.random() * 0.35);
      this.rubble.setColorAt(i, this.col);
    }
    this.piles.push({ start, count: n, t: 0 });
    this.rubbleMax = Math.max(this.rubbleMax, this.rubbleN);
    this.rubble.count = this.rubbleMax;
    this.rubble.instanceMatrix.needsUpdate = true;
    if (this.rubble.instanceColor) this.rubble.instanceColor.needsUpdate = true;
    this.addScorch(x, z, Math.max(w, d) * 0.8);
    if (burn) this.ignite(x, z, Math.max(0.6, Math.min(1.6, height * 14)), 14 + Math.random() * 16);
  }

  addScorch(x: number, z: number, r: number) {
    const i = this.scorchN;
    const cap = this.capacity.get(this.scorch)!;
    this.scorchN = (this.scorchN + 1) % cap;
    this.scorch.count = Math.max(this.scorch.count, i + 1);
    this.e.position.set(x, 0.0042 + i * 0.000004, z);
    this.e.rotation.set(0, Math.random() * 6, 0);
    this.e.scale.set(r, 1, r);
    this.e.updateMatrix();
    this.scorch.setMatrixAt(i, this.e.matrix);
    this.scorch.instanceMatrix.needsUpdate = true;
  }

  addCrack(x: number, z: number, size: number) {
    const m = this.cracks[this.crackI];
    this.crackI = (this.crackI + 1) % this.cracks.length;
    m.position.set(x, 0.0045, z);
    m.rotation.y = Math.random() * Math.PI * 2;
    m.scale.set(size, 1, size);
    m.visible = true;
  }

  ignite(x: number, z: number, size: number, life: number) {
    let f = this.fires.find((q) => !q.active);
    if (!f) f = this.fires.reduce((a, b) => (a.life < b.life ? a : b));
    f.active = true;
    f.p.set(x, 0.006, z);
    f.size = size;
    f.life = f.max = life;
    f.acc = 0;
    f.smokeAcc = Math.random();
  }

  /** put every fire out (smoke already in the air drifts away) */
  extinguish() {
    for (const f of this.fires) f.active = false;
  }

  get burning() {
    let n = 0;
    for (const f of this.fires) if (f.active) n++;
    return n;
  }

  clear() {
    for (let i = 0; i < this.rubble.count; i++) this.rubble.setMatrixAt(i, this.hidden);
    for (let i = 0; i < this.scorch.count; i++) this.scorch.setMatrixAt(i, this.hidden);
    this.rubble.count = this.scorch.count = 0;
    this.rubbleMax = 0;
    this.rubble.instanceMatrix.needsUpdate = true;
    this.scorch.instanceMatrix.needsUpdate = true;
    this.rubbleN = 0;
    this.scorchN = 0;
    this.piles.length = 0;
    for (const c of this.cracks) c.visible = false;
    for (const f of this.fires) f.active = false;
    for (const set of [this.flameP, this.smokeP, this.emberP]) for (const p of set) p.active = false;
    for (const im of [this.flame, this.smoke, this.ember]) {
      for (let i = 0; i < im.count; i++) im.setMatrixAt(i, this.hidden);
      im.instanceMatrix.needsUpdate = true;
      im.count = 0;
    }
    for (const l of this.lights) l.intensity = 0;
  }

  private emit(set: P[], cursor: number) {
    const p = set[cursor];
    p.active = true;
    return p;
  }

  update(dt: number) {
    this.time += dt;
    // rubble mounds grow out of the dust
    for (let k = this.piles.length - 1; k >= 0; k--) {
      const pile = this.piles[k];
      pile.t += dt;
      if (pile.t > 0.6) this.piles.splice(k, 1);
    }
    // fires
    let best0: Fire | null = null;
    let best1: Fire | null = null;
    for (const f of this.fires) {
      if (!f.active) continue;
      f.life -= dt;
      if (f.life <= 0) {
        f.active = false;
        continue;
      }
      const strength = Math.min(1, f.life / 4) * Math.min(1, (f.max - f.life) / 0.6 + 0.3);
      // flames
      f.acc += dt * 22 * f.size * strength * (0.4 + 0.6 * this.quality);
      while (f.acc > 1) {
        f.acc -= 1;
        const p = this.emit(this.flameP, this.flameI);
        this.flameI = (this.flameI + 1) % this.flameP.length;
        const r = 0.008 * f.size;
        p.p.set(f.p.x + (Math.random() - 0.5) * r * 2, f.p.y + Math.random() * 0.003, f.p.z + (Math.random() - 0.5) * r * 2);
        p.v.set((Math.random() - 0.5) * 0.01, 0.04 + Math.random() * 0.035, (Math.random() - 0.5) * 0.01);
        p.s = (0.0045 + Math.random() * 0.004) * Math.sqrt(f.size);
        p.life = p.max = 0.4 + Math.random() * 0.35;
      }
      // smoke column
      f.smokeAcc += dt * 9 * Math.sqrt(f.size) * (0.4 + strength * 0.6) * this.quality;
      while (f.smokeAcc > 1) {
        f.smokeAcc -= 1;
        const p = this.emit(this.smokeP, this.smokeI);
        this.smokeI = (this.smokeI + 1) % this.smokeP.length;
        p.p.set(f.p.x + (Math.random() - 0.5) * 0.006, f.p.y + 0.016 * f.size, f.p.z + (Math.random() - 0.5) * 0.006);
        p.v.set((Math.random() - 0.5) * 0.006, 0.035 + Math.random() * 0.025, (Math.random() - 0.5) * 0.006);
        p.s = (0.004 + Math.random() * 0.003) * Math.sqrt(f.size);
        p.life = p.max = 2.6 + Math.random() * 1.6;
        p.spin = Math.random() * 6;
      }
      // embers
      if (Math.random() < dt * 5 * f.size * this.quality) {
        const p = this.emit(this.emberP, this.emberI);
        this.emberI = (this.emberI + 1) % this.emberP.length;
        p.p.copy(f.p);
        p.v.set((Math.random() - 0.5) * 0.05, 0.06 + Math.random() * 0.06, (Math.random() - 0.5) * 0.05);
        p.s = 0.0008 + Math.random() * 0.0007;
        p.life = p.max = 0.8 + Math.random() * 0.8;
      }
      const score = f.size * strength;
      if (!best0 || score > best0.size) {
        best1 = best0;
        best0 = f;
      } else if (!best1 || score > best1.size) best1 = f;
    }
    // fire lights follow the two biggest fires
    const lit = [best0, best1];
    for (let i = 0; i < this.lights.length; i++) {
      const l = this.lights[i];
      const f = lit[i];
      if (!f) {
        l.intensity = 0;
        continue;
      }
      l.position.set(f.p.x, 0.03, f.p.z);
      const flick = 0.75 + Math.sin(this.time * 23 + i * 2) * 0.12 + Math.sin(this.time * 37 + i) * 0.1;
      l.intensity = (0.006 + this.night * 0.024) * f.size * flick;
    }

    // particles
    let n = 0;
    let hiflame = -1;
    for (let i = 0; i < this.flameP.length; i++) {
      const p = this.flameP[i];
      if (!p.active) continue;
      n++;
      hiflame = i;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        this.flame.setMatrixAt(i, this.hidden);
        continue;
      }
      const k = 1 - p.life / p.max; // 0 -> 1
      p.v.x += this.wind.x * dt * 2;
      p.v.z += this.wind.z * dt * 2;
      p.p.addScaledVector(p.v, dt);
      const s = p.s * (k < 0.2 ? 0.5 + k * 2.5 : 1 - (k - 0.2) * 1.1);
      this.e.position.copy(p.p);
      this.e.rotation.set(0, k * 4, 0);
      this.e.scale.set(s, s * 1.7, s);
      this.e.updateMatrix();
      this.flame.setMatrixAt(i, this.e.matrix);
      // white-yellow core -> orange -> deep red
      // yellow core -> orange -> deep red; additive, so keep it well below white
      if (k < 0.25) this.col.setRGB(1, 0.86, 0.32); // yellow core
      else this.col.setRGB(1, 0.62 - (k - 0.25) * 0.55, 0.12 - (k - 0.25) * 0.12); // orange -> red

      this.flame.setColorAt(i, this.col);
    }
    this.flame.count = hiflame + 1;
    if (n) {
      this.flame.instanceMatrix.needsUpdate = true;
      if (this.flame.instanceColor) this.flame.instanceColor.needsUpdate = true;
    }
    n = 0;
    let hismoke = -1;
    for (let i = 0; i < this.smokeP.length; i++) {
      const p = this.smokeP[i];
      if (!p.active) continue;
      n++;
      hismoke = i;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        this.smoke.setMatrixAt(i, this.hidden);
        continue;
      }
      const k = 1 - p.life / p.max;
      p.v.x += this.wind.x * dt;
      p.v.z += this.wind.z * dt;
      p.v.y *= 1 - dt * 0.3;
      p.p.addScaledVector(p.v, dt);
      const s = p.s * (0.6 + k * 3.6) * Math.min(1, p.life * 1.2);
      this.e.position.copy(p.p);
      this.e.rotation.set(p.spin, p.spin + k, 0);
      this.e.scale.setScalar(s);
      this.e.updateMatrix();
      this.smoke.setMatrixAt(i, this.e.matrix);
      // soot black near the fire, lighter grey as it rises
      // dark soot at the base, lighter grey as it rises and thins out
      const g = (0.26 + k * 0.36) * (1 - this.night * 0.45);
      this.col.setRGB(g, g * 0.97, g * 1.03);
      this.smoke.setColorAt(i, this.col);
    }
    this.smoke.count = hismoke + 1;
    if (n) {
      this.smoke.instanceMatrix.needsUpdate = true;
      if (this.smoke.instanceColor) this.smoke.instanceColor.needsUpdate = true;
    }
    n = 0;
    let hiember = -1;
    for (let i = 0; i < this.emberP.length; i++) {
      const p = this.emberP[i];
      if (!p.active) continue;
      n++;
      hiember = i;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        this.ember.setMatrixAt(i, this.hidden);
        continue;
      }
      p.v.y -= 0.05 * dt;
      p.v.x += this.wind.x * dt * 3 + (Math.random() - 0.5) * 0.02;
      p.p.addScaledVector(p.v, dt);
      this.e.position.copy(p.p);
      this.e.rotation.set(0, 0, 0);
      this.e.scale.setScalar(p.s * Math.min(1, p.life * 2) * (0.6 + Math.random() * 0.6));
      this.e.updateMatrix();
      this.ember.setMatrixAt(i, this.e.matrix);
    }
    this.ember.count = hiember + 1;
    if (n) this.ember.instanceMatrix.needsUpdate = true;
  }
}
