/**
 * Campaign hero: one animated character that walks the streets of the city and smashes it
 * (third-person, Moss-style). Forms unlock with the campaign level: human -> gorilla -> robot ->
 * dinosaur -> kaiju. All models are CC0 (see public/models/hero/LICENSE.txt).
 */
import {
  AdditiveBlending,
  AnimationAction,
  AnimationClip,
  AnimationMixer,
  Box3,
  CircleGeometry,
  Color,
  Group,
  LoopOnce,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  RingGeometry,
  SkinnedMesh,
  Vector3,
} from '@iwsdk/core';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

export type HeroAnim = 'idle' | 'walk' | 'run' | 'punch' | 'kick' | 'jump' | 'win' | 'hurt' | 'fall';

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
  color: string;
  tint?: number;
  clips: Record<HeroAnim, string>;
}

const KENNEY: Record<HeroAnim, string> = {
  idle: 'idle',
  walk: 'walk',
  run: 'sprint',
  punch: 'attack-melee-right',
  kick: 'attack-kick-right',
  jump: 'jump',
  win: 'emote-yes',
  hurt: 'die',
  fall: 'fall',
};
const QUAT: Record<HeroAnim, string> = {
  idle: 'Idle',
  walk: 'Walk',
  run: 'Run',
  punch: 'Punch',
  kick: 'Weapon',
  jump: 'Jump',
  win: 'Yes',
  hurt: 'HitReact',
  fall: 'Jump_Idle',
};
const ROBOT: Record<HeroAnim, string> = {
  idle: 'Idle',
  walk: 'Walking',
  run: 'Running',
  punch: 'Punch',
  kick: 'Punch',
  jump: 'Jump',
  win: 'ThumbsUp',
  hurt: 'No',
  fall: 'Jump',
};

export const HERO_FORMS: HeroForm[] = [
  { id: 'human', name: 'Human', level: 1, asset: 'hero-human', height: 0.032, power: 0.066, speed: 0.07, stomp: 0, color: '#ffcf3a', clips: KENNEY },
  { id: 'gorilla', name: 'Gorilla', level: 4, asset: 'hero-gorilla', height: 0.05, power: 0.125, speed: 0.08, stomp: 0, color: '#ff8a3a', tint: 0x7a6a62, clips: QUAT },
  { id: 'robot', name: 'Robot', level: 7, asset: 'hero-robot', height: 0.068, power: 0.18, speed: 0.09, stomp: 0.3, color: '#5ff0ff', clips: ROBOT },
  { id: 'dino', name: 'Dinosaur', level: 11, asset: 'hero-dino', height: 0.09, power: 0.3, speed: 0.1, stomp: 0.35, color: '#6fe08a', clips: QUAT },
  { id: 'kaiju', name: 'Kaiju', level: 15, asset: 'hero-dino', height: 0.13, power: 1, speed: 0.11, stomp: 0.45, color: '#b55cff', tint: 0x3d5a46, clips: QUAT },
];


/** the form a campaign level is played with */
export function formForLevel(level: number): HeroForm {
  let f = HERO_FORMS[0];
  for (const h of HERO_FORMS) if (h.level <= level) f = h;
  return f;
}

const ONCE: HeroAnim[] = ['punch', 'kick', 'jump', 'win', 'hurt'];

export class Hero {
  readonly root = new Group();
  form: HeroForm = HERO_FORMS[0];
  /** facing angle around Y (model faces +Z at 0) */
  yaw = 0;
  /** horizontal radius used for collisions (city-local m) */
  radius = 0.008;
  /** 0..1 how fast it is moving this frame (drives walk/run) */
  moving = 0;
  attackT = 0;
  attackHit = false;
  attackKind: 'punch' | 'kick' = 'punch';
  jumpT = 0;
  hurtT = 0;
  /** picked up by a hand */
  carried = false;
  private model: Object3D | null = null;
  private mixer: AnimationMixer | null = null;
  private actions: Partial<Record<HeroAnim, AnimationAction>> = {};
  private current: HeroAnim | '' = '';
  private ring: Mesh;
  private glow: Mesh;
  private ringMat: MeshBasicMaterial;
  private cache = new Map<string, GLTF>();
  private loading = new Map<string, Promise<GLTF>>();
  private box = new Box3();
  private size = new Vector3();
  private t = 0;
  private flash = 0;
  private flashMats: MeshStandardMaterial[] = [];

  constructor(private load: (asset: string) => Promise<GLTF>) {
    this.root.name = 'Hero';
    this.root.visible = false;
    this.ringMat = new MeshBasicMaterial({ color: 0xffcf3a, transparent: true, opacity: 0.85, depthWrite: false, blending: AdditiveBlending });
    this.ring = new Mesh(new RingGeometry(0.8, 1, 40), this.ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.0012;
    this.ring.renderOrder = 2;
    this.glow = new Mesh(
      new CircleGeometry(1, 32),
      new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }),
    );
    this.glow.rotation.x = -Math.PI / 2;
    this.glow.position.y = 0.001;
    this.root.add(this.glow, this.ring);
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

  /** swap to a form (loads the model on first use) */
  async setForm(form: HeroForm) {
    this.form = form;
    const g = await this.get(form.asset);
    if (this.form !== form) return;
    if (this.model) this.root.remove(this.model);
    this.mixer?.stopAllAction();
    const m = cloneSkinned(g.scene);
    // normalise: feet on y = 0, given standing height, facing +Z
    m.updateMatrixWorld(true);
    this.box.setFromObject(m);
    this.box.getSize(this.size);
    const k = form.height / Math.max(1e-4, this.size.y);
    const wrap = new Group();
    m.scale.multiplyScalar(k);
    m.position.y -= this.box.min.y * k;
    wrap.add(m);
    this.flashMats = [];
    const tint = form.tint !== undefined ? new Color(form.tint) : null;
    m.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      const src = mesh.material as MeshStandardMaterial;
      const mat = src.clone();
      if (tint) mat.color.multiply(tint).multiplyScalar(1.25);
      mat.emissive = new Color(0xff2020);
      mat.emissiveIntensity = 0;
      if ('metalness' in mat) mat.metalness = Math.min(mat.metalness, 0.3);
      mesh.material = mat;
      this.flashMats.push(mat);
      if ((mesh as SkinnedMesh).isSkinnedMesh) (mesh as SkinnedMesh).frustumCulled = false;
    });
    this.model = wrap;
    this.root.add(wrap);
    this.radius = Math.max(0.006, form.height * 0.24);
    this.ring.scale.setScalar(this.radius * 1.9);
    this.glow.scale.setScalar(this.radius * 1.6);
    this.ringMat.color.set(form.color);
    this.mixer = new AnimationMixer(m);
    this.actions = {};
    for (const [key, name] of Object.entries(form.clips) as [HeroAnim, string][]) {
      const clip = AnimationClip.findByName(g.animations, name);
      if (!clip) continue;
      const a = this.mixer.clipAction(clip);
      if (ONCE.includes(key)) {
        a.setLoop(LoopOnce, 1);
        a.clampWhenFinished = true;
      }
      this.actions[key] = a;
    }
    this.current = '';
    this.play('idle', 0);
  }

  get ready() {
    return !!this.model;
  }

  play(name: HeroAnim, fade = 0.15) {
    if (this.current === name && !ONCE.includes(name)) return;
    const next = this.actions[name] ?? (name === 'kick' ? this.actions.punch : undefined);
    if (!next) return;
    if (this.current) this.actions[this.current]?.fadeOut(fade);
    next.reset().fadeIn(fade).play();
    // attacks play fast so the game feels snappy
    next.timeScale = name === 'punch' || name === 'kick' ? 1.7 : name === 'run' ? 1.1 : 1;
    this.current = name;
  }

  /** start an attack; returns false while one is already playing */
  attack(kind: 'punch' | 'kick') {
    if (this.attackT > 0 || this.jumpT > 0 || this.carried) return false;
    this.attackT = 0.42;
    this.attackHit = false;
    this.attackKind = kind;
    this.play(kind, 0.05);
    return true;
  }

  jump() {
    if (this.jumpT > 0 || this.attackT > 0 || this.carried) return false;
    this.jumpT = 0.7;
    this.play('jump', 0.05);
    return true;
  }

  hurt() {
    this.hurtT = 0.5;
    this.flash = 0.25;
  }

  /** true exactly once, at the moment the attack lands */
  attackLands() {
    if (this.attackT <= 0 || this.attackHit) return false;
    if (this.attackT < 0.27) {
      this.attackHit = true;
      return true;
    }
    return false;
  }

  update(dt: number) {
    this.t += dt;
    this.attackT = Math.max(0, this.attackT - dt);
    this.jumpT = Math.max(0, this.jumpT - dt);
    this.hurtT = Math.max(0, this.hurtT - dt);
    this.flash = Math.max(0, this.flash - dt);
    for (const m of this.flashMats) m.emissiveIntensity = this.flash > 0 ? 1.4 : 0;
    if (this.carried) this.play('fall', 0.2);
    else if (this.attackT <= 0 && this.jumpT <= 0 && this.hurtT <= 0) {
      if (this.moving > 0.75) this.play('run', 0.2);
      else if (this.moving > 0.05) this.play('walk', 0.2);
      else if (this.current !== 'win') this.play('idle', 0.25);
    }
    if (this.model) {
      this.model.rotation.y = this.yaw;
      // a little hop on the jump, a bounce when the walk is fast
      const j = this.jumpT > 0 ? Math.sin(((0.7 - this.jumpT) / 0.7) * Math.PI) * this.form.height * 0.55 : 0;
      this.model.position.y = j;
      const s = this.form.height;
      this.glow.scale.setScalar(this.radius * 1.6 * (1 - j / (s * 1.4)));
    }
    this.ringMat.opacity = 0.55 + Math.sin(this.t * 4) * 0.25;
    this.mixer?.update(dt);
  }

  celebrate() {
    this.attackT = 0;
    this.jumpT = 0;
    this.play('win', 0.2);
  }
}
