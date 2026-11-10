/**
 * Campaign hero: a chubby hamster that walks the streets of the city and wrecks it
 * (third-person, Moss-style). It grows with the campaign: hamster -> chonky -> mega -> giga -> kaiju.
 *
 * The hamster mesh has no skeleton, so every motion is procedural: a plump side-to-side waddle,
 * a bouncy step, a jiggling bottom (vertex shader), squash & stretch on jumps and landings,
 * a forward lunge for punches and a fast nibble for gnawing cars.
 */
import {
  AdditiveBlending,
  Box3,
  CircleGeometry,
  DoubleSide,
  PlaneGeometry,
  SphereGeometry,
  Color,
  Group,
  Material,
  Mesh,
  Object3D,
  MeshBasicMaterial,
  MeshStandardMaterial,
  RingGeometry,
  Vector3,
} from '@iwsdk/core';
import { furRim } from './look.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

export interface HeroForm {
  id: string;
  name: string;
  /** campaign level that unlocks this form (1-based) */
  level: number;
  asset: string;
  /** standing height, city-local meters (pedestrians are ~0.016) */
  height: number;
  /** tallest building it can bring down */
  power: number;
  /** walk speed, city-local m/s (run = x1.9) */
  speed: number;
  /** walking into buildings lower than power * stomp flattens them */
  stomp: number;
  /** can pick up tanks (not only cars) */
  lifts: boolean;
  color: string;
  tint?: number;
}

export const HERO_FORMS: HeroForm[] = [
  { id: 'hamster', name: 'Hamster', level: 1, asset: 'hero-hamster', height: 0.03, power: 0.066, speed: 0.07, stomp: 0, lifts: false, color: '#ffcf3a' },
  { id: 'chonk', name: 'Chonky Hamster', level: 4, asset: 'hero-hamster', height: 0.046, power: 0.125, speed: 0.08, stomp: 0, lifts: true, color: '#ff8a3a' },
  { id: 'mega', name: 'Mega Hamster', level: 7, asset: 'hero-hamster', height: 0.066, power: 0.18, speed: 0.09, stomp: 0.3, lifts: true, color: '#5ff0ff' },
  { id: 'giga', name: 'Giga Hamster', level: 11, asset: 'hero-hamster', height: 0.09, power: 0.3, speed: 0.1, stomp: 0.35, lifts: true, color: '#6fe08a' },
  { id: 'kaiju', name: 'Kaiju Hamster', level: 15, asset: 'hero-hamster', height: 0.13, power: 1, speed: 0.11, stomp: 0.45, lifts: true, color: '#b55cff', tint: 0xfff2e6 },
];

/** the form a campaign level is played with */
export function formForLevel(level: number): HeroForm {
  let f = HERO_FORMS[0];
  for (const h of HERO_FORMS) if (h.level <= level) f = h;
  return f;
}

interface Uniforms {
  hT: { value: number };
  hWalk: { value: number };
  hChew: { value: number };
  hH: { value: number };
}

export class Hero {
  readonly root = new Group();
  form: HeroForm = HERO_FORMS[0];
  /** facing angle around Y (model faces +Z at 0) */
  yaw = 0;
  /** horizontal radius used for collisions (city-local m) */
  radius = 0.008;
  /** 0..1 how fast it is moving this frame (drives the waddle) */
  moving = 0;
  attackT = 0;
  attackHit = false;
  attackKind: 'punch' | 'kick' = 'punch';
  /** airborne: vertical speed (city m/s); y lives on root.position.y */
  vy = 0;
  airborne = false;
  hurtT = 0;
  /** picked up by a hand */
  carried = false;
  /** 0..1 gnawing intensity */
  chew = 0;
  /** cheeks full of seeds (visual + power) */
  cheeks = 0;
  private model: Object3D | null = null;
  private body = new Group();
  private ring: Mesh;
  private glow: Mesh;
  private ringMat: MeshBasicMaterial;
  private cache = new Map<string, GLTF>();
  private loading = new Map<string, Promise<GLTF>>();
  private box = new Box3();
  private size = new Vector3();
  private c = new Vector3();
  private t = 0;
  private flash = 0;
  private squash = 0;
  private squashV = 0;
  private winT = 0;
  private mats: MeshStandardMaterial[] = [];
  private u: Uniforms = { hT: { value: 0 }, hWalk: { value: 0 }, hChew: { value: 0 }, hH: { value: 1 } };

  constructor(private load: (asset: string) => Promise<GLTF>) {
    this.root.name = 'Hero';
    this.root.visible = false;
    this.ringMat = new MeshBasicMaterial({ color: 0xffcf3a, transparent: true, opacity: 0.85, depthWrite: false, blending: AdditiveBlending });
    this.ring = new Mesh(new RingGeometry(0.8, 1, 40), this.ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.renderOrder = 2;
    this.glow = new Mesh(
      new CircleGeometry(1, 32),
      new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }),
    );
    this.glow.rotation.x = -Math.PI / 2;
    this.root.add(this.body, this.glow, this.ring);
  }

  private get(asset: string) {
    let p = this.loading.get(asset);
    if (!p) {
      p = this.load(asset).then((g) => {
        this.cache.set(asset, g);
        return g;
      });
      this.loading.set(asset, p);
    }
    return p;
  }

  preload(form: HeroForm) {
    void this.get(form.asset).catch(() => undefined);
  }

  /** bottom-jiggle + nibble: bend the static mesh in the vertex shader */
  private wobbly(mat: MeshStandardMaterial) {
    const u = this.u;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace(
          'void main() {',
          `uniform float hT;
          uniform float hWalk;
          uniform float hChew;
          uniform float hH;
          void main() {`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          {
            // mesh space: centred, height hH, facing +X (sideways = Z)
            float yn = clamp( transformed.y / hH + 0.5, 0.0, 1.0 );
            // the bottom: low and towards the back wobbles opposite to the step
            float butt = smoothstep( 0.55, 0.0, yn ) * smoothstep( 0.1 * hH, -0.35 * hH, transformed.x );
            float jig = sin( hT * 15.0 ) * hWalk + sin( hT * 23.0 + 1.3 ) * 0.25 * hWalk;
            transformed.z += butt * jig * 0.09 * hH;
            transformed.y += butt * abs( sin( hT * 15.0 ) ) * hWalk * 0.03 * hH;
            transformed.x -= butt * hWalk * 0.03 * hH * ( 0.5 + 0.5 * sin( hT * 30.0 ) );
            // nibbling: the head bobs fast and the cheeks puff
            float head = smoothstep( 0.55, 0.95, yn ) * smoothstep( -0.1 * hH, 0.25 * hH, transformed.x );
            transformed.y -= head * hChew * 0.04 * hH * ( 0.5 + 0.5 * sin( hT * 38.0 ) );
            float cheek = head * smoothstep( 0.05 * hH, 0.3 * hH, abs( transformed.z ) );
            transformed.z *= 1.0 + cheek * hChew * 0.12 * ( 0.6 + 0.4 * sin( hT * 38.0 ) );
          }`,
        );
    };
    mat.customProgramCacheKey = () => 'fk-hamster';
  }

  /** swap to a form (loads the model on first use) */
  async setForm(form: HeroForm) {
    this.form = form;
    const g = await this.get(form.asset);
    if (this.form !== form) return;
    if (this.model) this.body.remove(this.model);
    const m = g.scene.clone(true);
    m.updateMatrixWorld(true);
    this.box.setFromObject(m);
    this.box.getSize(this.size);
    const k = form.height / Math.max(1e-4, this.size.y);
    const wrap = new Group();
    this.box.getCenter(this.c);
    m.scale.multiplyScalar(k);
    m.position.set(-this.c.x * k, -this.box.min.y * k, -this.c.z * k);
    // the generated mesh looks down -Z; turn it to face +Z like everything else
    const inner = new Group();
    inner.rotation.y = -Math.PI / 2; // the generated mesh looks down +X
    inner.add(m);
    wrap.add(inner);
    this.mats = [];
    const tint = form.tint !== undefined ? new Color(form.tint) : null;
    // the shader works in the mesh's own (unscaled) units
    this.u.hH.value = this.size.y / Math.max(1e-6, m.scale.y / k);
    m.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      const src = mesh.material as Material;
      const mat = (src as MeshStandardMaterial).clone();
      if (tint) mat.color.multiply(tint);
      // the fur is very light: tone it down a little so it doesn't blow out in the sun
      mat.color.multiplyScalar(0.82);
      mat.emissive = new Color(form.id === 'kaiju' ? 0x5a1a7a : 0xff2020);
      mat.emissiveIntensity = form.id === 'kaiju' ? 0.12 : 0;
      mat.metalness = 0;
      mat.roughness = Math.max(0.65, mat.roughness ?? 0.8);
      this.wobbly(mat);
      furRim(mat, form.id === 'kaiju' ? 0xc98cff : 0xffe6c2);
      mesh.material = mat;
      this.mats.push(mat);
    });
    wrap.add(this.makeCape(form));
    this.model = wrap;
    this.body.add(wrap);
    this.radius = Math.max(0.006, form.height * 0.3);
    this.ring.scale.setScalar(this.radius * 1.7);
    this.glow.scale.setScalar(this.radius * 1.3);
    this.ringMat.color.set(form.color);
  }

  private capeU = { cT: { value: 0 }, cWalk: { value: 0 }, cAir: { value: 0 } };
  /**
   * A hero cape: a segmented plane hanging from the shoulders, rippled in the vertex shader.
   * It trails further back the faster the hamster runs and flies up during jumps.
   */
  private makeCape(form: HeroForm) {
    const h = form.height;
    const w = h * 0.6;
    const len = h * 0.66;
    const geo = new PlaneGeometry(w, len, 8, 12);
    geo.translate(0, -len / 2, 0); // hang from the top edge
    const color = form.id === 'kaiju' ? 0x6a2bd6 : form.id === 'giga' ? 0x1fa86a : form.id === 'mega' ? 0x1e7bd8 : 0xd8232f;
    const mat = new MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05, side: DoubleSide });
    const u = this.capeU;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      shader.uniforms.cLen = { value: len };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float cT; uniform float cWalk; uniform float cAir; uniform float cLen;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          {
            float d = clamp(-position.y / cLen, 0.0, 1.0); // 0 at the shoulders, 1 at the hem
            float k = d * d;
            float wave = sin(cT * (6.0 + cWalk * 8.0) - d * 6.0 + position.x / cLen * 3.0);
            float back = (0.08 + cWalk * 0.55 + cAir * 0.6) * cLen;
            float xn = position.x / (cLen * 0.45);
            // drape over the round back and bottom, wrap the edges forward around the body
            transformed.z -= sqrt(d) * 0.62 * cLen + k * back + d * wave * cLen * (0.04 + cWalk * 0.08);
            transformed.z += xn * xn * cLen * 0.16 * (1.0 - 0.5 * d);
            transformed.y += k * (cWalk * 0.25 + cAir * 0.55) * cLen;
            transformed.x *= 0.62 + d * 0.62; // narrow collar, wide hem
          }`,
        );
    };
    mat.customProgramCacheKey = () => 'fk-cape';
    const cape = new Mesh(geo, mat);
    cape.name = 'HeroCape';
    cape.castShadow = true;
    cape.position.set(0, h * 0.74, -h * 0.2);
    cape.rotation.x = 0.05;
    // gold clasp at the collar
    const clasp = new Mesh(new SphereGeometry(h * 0.045, 12, 8), new MeshStandardMaterial({ color: 0xffcf3a, metalness: 0.8, roughness: 0.25, emissive: 0x6a4a00, emissiveIntensity: 0.4 }));
    clasp.position.set(0, h * 0.72, -h * 0.17);
    const g = new Group();
    g.add(cape, clasp);
    return g;
  }

  get ready() {
    return !!this.model;
  }

  /** start an attack; returns false while one is already playing */
  attack(kind: 'punch' | 'kick') {
    if (this.attackT > 0 || this.carried) return false;
    this.attackT = 0.36;
    this.attackHit = false;
    this.attackKind = kind;
    return true;
  }

  /** hop with an initial vertical speed (city m/s) */
  jump(v: number) {
    if (this.airborne || this.carried) return false;
    this.vy = v;
    this.airborne = true;
    this.squash = -0.25;
    return true;
  }

  /** landed: squash the plump body */
  land(speed: number) {
    this.squash = Math.min(0.45, 0.12 + speed * 0.6);
    this.squashV = 0;
  }

  hurt() {
    this.hurtT = 0.5;
    this.flash = 0.25;
  }

  /** true exactly once, at the moment the attack lands */
  attackLands() {
    if (this.attackT <= 0 || this.attackHit) return false;
    if (this.attackT < 0.22) {
      this.attackHit = true;
      return true;
    }
    return false;
  }

  celebrate() {
    this.attackT = 0;
    this.winT = 2.5;
  }

  update(dt: number) {
    this.t += dt;
    this.attackT = Math.max(0, this.attackT - dt);
    this.hurtT = Math.max(0, this.hurtT - dt);
    this.flash = Math.max(0, this.flash - dt);
    this.winT = Math.max(0, this.winT - dt);
    for (const m of this.mats) m.emissiveIntensity = this.flash > 0 ? 1.2 : this.form.id === 'kaiju' ? 0.12 : 0;
    const walk = this.carried || this.airborne ? 0 : this.moving;
    this.u.hT.value = this.t;
    this.capeU.cT.value = this.t;
    this.capeU.cWalk.value = this.u.hWalk.value;
    this.capeU.cAir.value += ((this.airborne ? 1 : 0) - this.capeU.cAir.value) * Math.min(1, dt * 6);
    this.u.hWalk.value += (walk - this.u.hWalk.value) * Math.min(1, dt * 8);
    this.u.hChew.value += (this.chew - this.u.hChew.value) * Math.min(1, dt * 10);
    // squash & stretch spring
    this.squashV += (-this.squash * 220 - this.squashV * 14) * dt;
    this.squash += this.squashV * dt;
    const s = this.form.height;
    this.body.rotation.set(0, this.yaw, 0);
    const wv = this.u.hWalk.value;
    const step = this.t * (walk > 0.75 ? 15 : 11);
    // the plump waddle: roll from foot to foot, bounce, lean into the walk
    let roll = Math.sin(step) * 0.16 * wv;
    let pitch = wv * 0.1;
    let y = Math.abs(Math.sin(step)) * s * 0.07 * wv;
    let fwd = 0;
    if (this.attackT > 0) {
      const k = 1 - this.attackT / 0.36;
      const lunge = Math.sin(Math.min(1, k * 1.6) * Math.PI);
      fwd = lunge * s * 0.35;
      pitch += lunge * 0.45;
      roll += (this.attackKind === 'kick' ? -1 : 1) * lunge * 0.15;
    }
    if (this.airborne) pitch -= 0.15;
    if (this.carried) {
      // dangling, little legs kicking
      roll = Math.sin(this.t * 9) * 0.25;
      pitch = -0.2;
    }
    if (this.winT > 0) {
      // happy hop in place
      y += Math.abs(Math.sin(this.t * 9)) * s * 0.25;
      roll = Math.sin(this.t * 9) * 0.2;
    }
    if (this.hurtT > 0) roll += Math.sin(this.t * 40) * 0.2 * (this.hurtT / 0.5);
    if (this.chew > 0.05) pitch += 0.12;
    if (this.model) {
      this.model.rotation.set(pitch, 0, roll);
      this.model.position.set(0, y, fwd);
      const sq = Math.max(-0.3, Math.min(0.5, this.squash));
      const cheeks = 1 + this.cheeks * 0.08;
      this.model.scale.set((1 + sq * 0.5) * cheeks, 1 - sq, (1 + sq * 0.5) * cheeks);
    }
    const lift = this.root.position.y;
    this.glow.position.y = 0.0008 - lift + this.ground;
    this.ring.position.y = 0.0012 - lift + this.ground;
    this.glow.scale.setScalar(this.radius * 1.3 * Math.max(0.4, 1 - (lift - this.ground) / (s * 2)));
    this.ringMat.opacity = 0.5 + Math.sin(this.t * 4) * 0.25;
  }

  /** height of whatever the hero stands over (street = 0, roof = building height) */
  ground = 0;

}
