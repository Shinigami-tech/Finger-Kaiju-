/** Pooled visual effects + procedural audio. All positions are city-local. */
import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  RingGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
} from '@iwsdk/core';

const GRAVITY = -2.2;

interface Particle {
  active: boolean;
  p: Vector3;
  v: Vector3;
  rot: Vector3;
  av: Vector3;
  s: number;
  life: number;
  max: number;
}

/** A lumpy, flat-shaded rock/concrete chunk (reads much better than a cube). */
function chunkGeometry() {
  const g = new IcosahedronGeometry(0.62, 0);
  const pos = g.attributes.position;
  // same vertex positions must move together or the faces tear apart
  const moved = new Map<string, [number, number, number]>();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    let m = moved.get(key);
    if (!m) {
      const k = 0.75 + Math.random() * 0.5;
      m = [pos.getX(i) * k * 1.25, pos.getY(i) * k * 0.8, pos.getZ(i) * k];
      moved.set(key, m);
    }
    pos.setXYZ(i, m[0], m[1], m[2]);
  }
  g.computeVertexNormals();
  return g;
}

function makeParticles(n: number): Particle[] {
  const a: Particle[] = [];
  for (let i = 0; i < n; i++) {
    a.push({
      active: false,
      p: new Vector3(),
      v: new Vector3(),
      rot: new Vector3(),
      av: new Vector3(),
      s: 0,
      life: 0,
      max: 1,
    });
  }
  return a;
}

export class Fx {
  readonly root = new Group();
  private debris: InstancedMesh;
  private debrisP = makeParticles(700);
  private dust: InstancedMesh;
  private dustP = makeParticles(260);
  private sparks: InstancedMesh;
  private sparkP = makeParticles(160);
  private rings: { mesh: Mesh; t: number; dur: number; scale: number }[] = [];
  private popups: { sprite: Sprite; t: number; ctx: CanvasRenderingContext2D; tex: CanvasTexture }[] = [];
  private cursorD = 0;
  private cursorS = 0;
  private cursorK = 0;
  private m = new Matrix4();
  private q = new Quaternion();
  private e = new Object3D();
  private tmp = new Vector3();
  private col = new Color();
  private hidden = new Matrix4().makeScale(0, 0, 0);
  /** half size of the city plate (debris rests only inside it) */
  half = 0.34;
  /** effects quality 0..1 (scales particle counts) */
  quality = 1;
  private dustDay = new Color(0xe8e2d6);
  private dustNight = new Color(0x5e5a62);

  /** 0 = day, 1 = night: dust clouds darken with the light */
  setNight(n: number) {
    (this.dust.material as MeshStandardMaterial).color.copy(this.dustDay).lerp(this.dustNight, n);
  }

  constructor() {
    this.root.name = 'FX';
    this.debris = new InstancedMesh(
      chunkGeometry(),
      new MeshStandardMaterial({ roughness: 0.8, flatShading: true }),
      this.debrisP.length,
    );
    this.debris.castShadow = true;
    this.dust = new InstancedMesh(
      new IcosahedronGeometry(1, 0),
      new MeshStandardMaterial({ color: 0xe8e2d6, roughness: 1, transparent: true, opacity: 0.4, flatShading: true, depthWrite: false }),
      this.dustP.length,
    );
    this.sparks = new InstancedMesh(
      new IcosahedronGeometry(1, 0),
      new MeshBasicMaterial({ color: 0xffb340, blending: AdditiveBlending, transparent: true, depthWrite: false }),
      this.sparkP.length,
    );
    for (const im of [this.debris, this.dust, this.sparks]) {
      im.instanceMatrix.setUsage(DynamicDrawUsage);
      im.frustumCulled = false;
      for (let i = 0; i < im.count; i++) im.setMatrixAt(i, this.hidden);
      this.root.add(im);
    }
    for (let i = 0; i < this.debrisP.length; i++) this.debris.setColorAt(i, this.col.set(0xffffff));
    for (let i = 0; i < 6; i++) {
      const mesh = new Mesh(
        new RingGeometry(0.8, 1, 48),
        new MeshBasicMaterial({ color: 0xffd25a, transparent: true, side: DoubleSide, depthWrite: false }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      this.root.add(mesh);
      this.rings.push({ mesh, t: 1, dur: 0.5, scale: 0.1 });
    }
    for (let i = 0; i < 8; i++) {
      const c = document.createElement('canvas');
      c.width = 256;
      c.height = 64;
      const ctx = c.getContext('2d')!;
      const tex = new CanvasTexture(c);
      tex.colorSpace = SRGBColorSpace;
      const sprite = new Sprite(new SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
      sprite.scale.set(0.08, 0.02, 1);
      sprite.visible = false;
      sprite.renderOrder = 10;
      this.root.add(sprite);
      this.popups.push({ sprite, t: 9, ctx, tex });
    }
  }

  /** Building collapse: colored chunks, dust cloud and a few sparks. */
  explode(center: Vector3, from: Vector3, width: number, height: number, color: number | number[], power = 1) {
    const n = Math.round(Math.min(48, 12 + Math.round(height * 160)) * (0.4 + 0.6 * this.quality));
    for (let k = 0; k < n; k++) {
      const i = this.cursorD;
      this.cursorD = (this.cursorD + 1) % this.debrisP.length;
      const d = this.debrisP[i];
      d.active = true;
      d.p.set(
        center.x + (Math.random() - 0.5) * width,
        center.y + Math.random() * height,
        center.z + (Math.random() - 0.5) * width,
      );
      this.tmp.set(d.p.x - from.x, 0, d.p.z - from.z);
      if (this.tmp.lengthSq() < 1e-8) this.tmp.set(Math.random() - 0.5, 0, Math.random() - 0.5);
      this.tmp.normalize().multiplyScalar((0.15 + Math.random() * 0.35) * power);
      d.v.set(this.tmp.x, (0.25 + Math.random() * 0.5) * power, this.tmp.z);
      d.av.set(Math.random() * 12, Math.random() * 12, Math.random() * 12);
      d.s = Math.max(0.0025, width * (0.08 + Math.random() * 0.14));
      d.life = d.max = 1.6 + Math.random() * 1.2;
      const base = Array.isArray(color) ? color[Math.floor(Math.random() * color.length)] : color;
      this.col.set(base).multiplyScalar(0.8 + Math.random() * 0.3);
      this.debris.setColorAt(i, this.col);
    }
    if (this.debris.instanceColor) this.debris.instanceColor.needsUpdate = true;
    this.puff(center, height, 10 + Math.round(height * 120));
    this.spark(center, 6, 0.4);
  }

  puff(center: Vector3, height: number, n: number) {
    n = Math.max(1, Math.round(n * (0.3 + 0.7 * this.quality)));
    for (let k = 0; k < n; k++) {
      const d = this.dustP[this.cursorS];
      this.cursorS = (this.cursorS + 1) % this.dustP.length;
      d.active = true;
      d.p.set(center.x + (Math.random() - 0.5) * 0.03, center.y + Math.random() * height * 0.6, center.z + (Math.random() - 0.5) * 0.03);
      d.v.set((Math.random() - 0.5) * 0.12, 0.03 + Math.random() * 0.06, (Math.random() - 0.5) * 0.12);
      d.s = 0.006 + Math.random() * 0.008;
      d.life = d.max = 0.9 + Math.random() * 0.8;
    }
  }

  spark(center: Vector3, n: number, speed: number, color = 0xffb340) {
    (this.sparks.material as MeshBasicMaterial).color.set(color);
    for (let k = 0; k < n; k++) {
      const d = this.sparkP[this.cursorK];
      this.cursorK = (this.cursorK + 1) % this.sparkP.length;
      d.active = true;
      d.p.copy(center);
      d.v.set((Math.random() - 0.5) * speed, Math.random() * speed, (Math.random() - 0.5) * speed);
      d.s = 0.0025 + Math.random() * 0.002;
      d.life = d.max = 0.35 + Math.random() * 0.3;
    }
  }

  ring(center: Vector3, scale: number, color = 0xffd25a, dur = 0.5) {
    const r = this.rings.find((x) => x.t >= x.dur) ?? this.rings[0];
    r.t = 0;
    r.dur = dur;
    r.scale = scale;
    (r.mesh.material as MeshBasicMaterial).color.set(color);
    r.mesh.position.set(center.x, center.y + 0.006, center.z);
    r.mesh.visible = true;
  }

  popup(pos: Vector3, text: string, color = '#ffd25a') {
    const p = this.popups.reduce((a, b) => (a.t > b.t ? a : b));
    const g = p.ctx;
    g.clearRect(0, 0, 256, 64);
    let size = 44;
    g.font = `900 ${size}px system-ui, Arial Black, sans-serif`;
    const w = g.measureText(text).width + 10;
    if (w > 250) {
      size = Math.floor((size * 250) / w);
      g.font = `900 ${size}px system-ui, Arial Black, sans-serif`;
    }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 8;
    g.strokeStyle = 'rgba(20,16,40,0.9)';
    g.strokeText(text, 128, 34);
    g.fillStyle = color;
    g.fillText(text, 128, 34);
    p.tex.needsUpdate = true;
    p.t = 0;
    p.sprite.position.copy(pos);
    p.sprite.visible = true;
  }

  clear() {
    const sets: [Particle[], InstancedMesh][] = [
      [this.debrisP, this.debris],
      [this.dustP, this.dust],
      [this.sparkP, this.sparks],
    ];
    for (const [set, im] of sets) {
      for (let i = 0; i < set.length; i++) {
        set[i].active = false;
        im.setMatrixAt(i, this.hidden);
      }
      im.instanceMatrix.needsUpdate = true;
    }
    for (const r of this.rings) {
      r.t = r.dur;
      r.mesh.visible = false;
    }
    for (const p of this.popups) {
      p.t = 9;
      p.sprite.visible = false;
    }
  }

  private step(set: Particle[], im: InstancedMesh, dt: number, kind: 'debris' | 'dust' | 'spark') {
    let dirty = false;
    let hi = -1;
    for (let i = 0; i < set.length; i++) {
      const d = set[i];
      if (!d.active) continue;
      dirty = true;
      hi = i;
      d.life -= dt;
      if (d.life <= 0) {
        d.active = false;
        im.setMatrixAt(i, this.hidden);
        continue;
      }
      let s = d.s;
      if (kind === 'debris') {
        d.v.y += GRAVITY * dt;
        d.p.addScaledVector(d.v, dt);
        // only the city has a floor; chunks that fly off the table keep falling and vanish
        const onCity = Math.abs(d.p.x) < this.half && Math.abs(d.p.z) < this.half;
        const floor = onCity ? 0.004 + d.s * 0.5 : -1;
        if (!onCity && d.p.y < -0.25) d.life = Math.min(d.life, 0.05);
        if (d.p.y < floor) {
          d.p.y = floor;
          d.v.y *= -0.3;
          d.v.x *= 0.6;
          d.v.z *= 0.6;
          d.av.multiplyScalar(0.7);
        }
        d.rot.addScaledVector(d.av, dt);
        if (d.life < 0.4) s *= d.life / 0.4;
      } else if (kind === 'dust') {
        d.v.multiplyScalar(1 - 1.8 * dt);
        d.p.addScaledVector(d.v, dt);
        const k = 1 - d.life / d.max;
        s = d.s * (1 + k * 1.4) * Math.min(1, d.life * 2);
      } else {
        d.v.y += GRAVITY * 0.5 * dt;
        d.p.addScaledVector(d.v, dt);
        s = d.s * (d.life / d.max);
      }
      this.e.position.copy(d.p);
      this.e.rotation.set(d.rot.x, d.rot.y, d.rot.z);
      this.e.scale.setScalar(s);
      this.e.updateMatrix();
      im.setMatrixAt(i, this.e.matrix);
    }
    if (dirty) im.instanceMatrix.needsUpdate = true;
    im.count = hi + 1; // don't draw the idle tail of the pool
  }

  update(dt: number, camWorld: Vector3) {
    this.step(this.debrisP, this.debris, dt, 'debris');
    this.step(this.dustP, this.dust, dt, 'dust');
    this.step(this.sparkP, this.sparks, dt, 'spark');
    for (const r of this.rings) {
      if (r.t >= r.dur) continue;
      r.t += dt;
      const k = Math.min(1, r.t / r.dur);
      r.mesh.scale.setScalar(0.005 + r.scale * (1 - (1 - k) * (1 - k)));
      (r.mesh.material as MeshBasicMaterial).opacity = 1 - k;
      if (k >= 1) r.mesh.visible = false;
    }
    void camWorld;
    for (const p of this.popups) {
      if (p.t > 1.1) continue;
      p.t += dt;
      p.sprite.position.y += dt * 0.05;
      p.sprite.material.opacity = Math.min(1, (1.1 - p.t) * 3);
      const pop = p.t < 0.12 ? 0.6 + (p.t / 0.12) * 0.6 : 1.2 - Math.min(0.2, (p.t - 0.12));
      p.sprite.scale.set(0.08 * pop, 0.02 * pop, 1);
      if (p.t > 1.1) p.sprite.visible = false;
    }
    void this.m;
    void this.q;
  }
}

/* ---------------- audio: Kenney CC0 samples + procedural fallback ---------------- */
const GROUPS: Record<string, string[]> = {
  crunch: ['impactWood_heavy', 'impactPlate_heavy', 'impactMining'],
  big: ['explosionCrunch', 'lowFrequency_explosion'],
  glass: ['impactGlass_heavy'],
  metal: ['impactMetal_heavy'],
  punch: ['impactPunch_heavy'],
  quake: ['lowFrequency_explosion'],
  boom: ['explosionCrunch'],
  shot: ['laserSmall'],
  ouch: ['error_006'],
  combo: ['select_005'],
  rip: ['impactPlate_heavy', 'impactSoft_heavy'],
  start: ['jingles_HIT00'],
  end: ['jingles_NES03'],
  win: ['jingles_NES09'],
  grab: ['pluck_001'],
  zap: ['forceField_000', 'laserRetro_000'],
  roar: ['kaiju_roar'],
  scream: ['tiny_scream'],
  siren: ['police_siren'],
  fire: ['fire_crackle'],
};

export type MusicTrack = 'calm' | 'fight';

export class Sfx {
  private ctx?: AudioContext;
  private noise?: AudioBuffer;
  private master?: GainNode;
  private musicGain?: GainNode;
  private tracks: Record<MusicTrack, { buf?: AudioBuffer; gain?: GainNode; src?: AudioBufferSourceNode }> = {
    calm: {},
    fight: {},
  };
  private active: MusicTrack = 'calm';
  private musicBus?: GainNode;
  private musicVol = 0.3;
  private sfxVol = 0.8;

  /** user volume settings, 0..1 each */
  setVolumes(music: number, sfx: number) {
    this.musicVol = music;
    this.sfxVol = sfx;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.musicBus?.gain.setTargetAtTime(music, t, 0.05);
    this.master?.gain.setTargetAtTime(sfx, t, 0.05);
  }
  private samples = new Map<string, AudioBuffer[]>();
  private last = new Map<string, number>();

  /** true if `group` played less than `gap` seconds ago (rate limiting for noisy events) */
  private busy(group: string, gap: number) {
    const t = this.ctx?.currentTime ?? 0;
    if (t - (this.last.get(group) ?? -99) < gap) return true;
    this.last.set(group, t);
    return false;
  }

  /** Register decoded samples (file name without extension -> buffer). */
  addSample(name: string, buf: AudioBuffer) {
    for (const [group, prefixes] of Object.entries(GROUPS)) {
      if (prefixes.some((p) => name.startsWith(p))) {
        const list = this.samples.get(group) ?? [];
        list.push(buf);
        this.samples.set(group, list);
      }
    }
  }
  setMusic(track: MusicTrack, buf: AudioBuffer) {
    this.tracks[track].buf = buf;
    this.startMusic();
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      // sfx -> master(sfx volume) -> out ; music tracks -> musicGain(level) -> musicBus(music volume) -> out
      const out = this.ctx.createGain();
      out.gain.value = 0.9;
      out.connect(this.ctx.destination);
      this.master = this.ctx.createGain();
      this.master.gain.value = this.sfxVol;
      this.master.connect(out);
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = this.musicVol;
      this.musicBus.connect(out);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.25;
      this.musicGain.connect(this.musicBus);
      for (const k of ['calm', 'fight'] as const) {
        const g = this.ctx.createGain();
        g.gain.value = k === this.active ? 1 : 0;
        g.connect(this.musicGain);
        this.tracks[k].gain = g;
      }
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    this.startMusic();
  }

  private startMusic() {
    if (!this.ctx) return;
    for (const k of ['calm', 'fight'] as const) {
      const t = this.tracks[k];
      if (!t.buf || !t.gain || t.src) continue;
      const src = this.ctx.createBufferSource();
      src.buffer = t.buf;
      src.loop = true;
      src.connect(t.gain);
      src.start();
      t.src = src;
    }
  }

  /** Crossfade to a music track (calm city ambience or the fight theme). */
  music(track: MusicTrack, fade = 1.2) {
    if (track === this.active) return;
    this.active = track;
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const k of ['calm', 'fight'] as const) {
      const g = this.tracks[k].gain;
      if (!g) continue;
      g.gain.cancelScheduledValues(now);
      g.gain.setTargetAtTime(k === track ? 1 : 0, now, fade / 3);
    }
    // the fight theme restarts on its downbeat when it kicks in
    const f = this.tracks.fight;
    if (track === 'fight' && f.src && f.buf && f.gain) {
      f.src.stop();
      f.src.disconnect();
      const src = this.ctx.createBufferSource();
      src.buffer = f.buf;
      src.loop = true;
      src.connect(f.gain);
      src.start();
      f.src = src;
      f.gain.gain.cancelScheduledValues(now);
      f.gain.gain.setValueAtTime(0.0001, now);
      f.gain.gain.linearRampToValueAtTime(1, now + 0.35);
    }
  }

  musicLevel(level: number) {
    if (!this.ctx || !this.musicGain) return;
    this.musicGain.gain.setTargetAtTime(level, this.ctx.currentTime, 0.4);
  }

  /** Play a random sample from a group. Returns false if none is loaded. */
  private play(group: string, gain = 0.7, rate = 1) {
    const c = this.ctx;
    const list = this.samples.get(group);
    if (!c || !this.master || !list || list.length === 0) return false;
    const src = c.createBufferSource();
    src.buffer = list[Math.floor(Math.random() * list.length)];
    src.playbackRate.value = rate * (0.92 + Math.random() * 0.16);
    const g = c.createGain();
    g.gain.value = gain;
    src.connect(g).connect(this.master);
    src.start();
    return true;
  }

  private noiseBurst(dur: number, freq: number, gain: number, type: BiquadFilterType = 'lowpass') {
    const c = this.ctx;
    if (!c || !this.noise || !this.master) return;
    const t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(60, freq * 0.25), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.3);
    src.stop(t + dur);
  }

  private tone(f0: number, f1: number, dur: number, gain: number, type: OscillatorType = 'sine') {
    const c = this.ctx;
    if (!c || !this.master) return;
    const t = c.currentTime;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur);
  }

  crunch(size: number, glass = false) {
    const rate = 1.25 - size * 0.45;
    if (!this.play('crunch', 0.65, rate)) this.noiseBurst(0.25 + size * 0.5, 2600 - size * 1800, 0.55);
    if (size > 0.45) this.play('big', 0.5 * size, 1.1 - size * 0.3);
    if (glass) this.play('glass', 0.35, 1);
    this.tone(140 - size * 60, 40, 0.3 + size * 0.3, 0.25);
  }
  metal() {
    if (!this.play('metal', 0.55)) this.noiseBurst(0.2, 3000, 0.4, 'bandpass');
  }
  punch() {
    this.play('punch', 0.7, 0.9);
  }
  rip() {
    if (!this.play('rip', 0.6, 0.8)) this.noiseBurst(0.3, 1200, 0.5);
  }
  grab() {
    this.play('grab', 0.5, 1);
  }
  quake() {
    if (!this.play('quake', 0.9, 0.8)) this.noiseBurst(0.9, 500, 0.8);
    this.tone(70, 28, 0.9, 0.6);
  }
  boom() {
    if (!this.play('boom', 0.75)) this.noiseBurst(0.6, 1800, 0.7);
    this.tone(200, 45, 0.5, 0.3, 'triangle');
  }
  shot() {
    if (!this.play('shot', 0.3, 1.3)) this.noiseBurst(0.12, 4000, 0.25, 'bandpass');
  }
  ouch() {
    this.play('punch', 0.5, 1.4);
    if (!this.play('ouch', 0.35)) this.tone(520, 180, 0.25, 0.25, 'square');
  }
  combo(level: number) {
    if (!this.play('combo', 0.3, 0.9 + Math.min(level, 8) * 0.12)) this.tone(440 * Math.pow(1.12, Math.min(level, 10)), 880, 0.12, 0.12, 'triangle');
  }
  start() {
    if (!this.play('start', 0.6)) {
      this.tone(220, 660, 0.35, 0.2, 'sawtooth');
      this.tone(330, 990, 0.45, 0.12, 'triangle');
    }
  }
  end(win = false) {
    if (!this.play(win ? 'win' : 'end', 0.6)) this.tone(660, 110, 1.1, 0.25, 'sawtooth');
  }
  zap() {
    this.play('zap', 0.4);
  }
  roar(gain = 0.8) {
    if (this.busy('roar', 2.5)) return;
    if (!this.play('roar', gain, 0.95)) {
      this.noiseBurst(0.9, 900, 0.5, 'bandpass');
      this.tone(110, 70, 0.9, 0.35, 'sawtooth');
    }
  }
  /** Tiny people screaming: the source scream pitched up into a chipmunk register. */
  scream(n = 1) {
    if (this.busy('scream', 0.35)) return;
    for (let i = 0; i < Math.min(3, n); i++) {
      if (!this.play('scream', 0.16, 1.5 + Math.random() * 0.7)) this.tone(1400 + Math.random() * 500, 700, 0.35, 0.05, 'triangle');
    }
  }
  siren() {
    if (this.busy('siren', 3.2)) return;
    this.play('siren', 0.22, 1.15);
  }
  /** soft pop as a new building springs up */
  pop() {
    if (this.busy('pop', 0.06)) return;
    this.tone(500 + Math.random() * 300, 1100, 0.09, 0.05, 'sine');
  }
  fire() {
    if (this.busy('fire', 2.8)) return;
    this.play('fire', 0.3, 0.9 + Math.random() * 0.3);
  }
}
