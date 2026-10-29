/**
 * Campaign: hand-made levels with one clear goal, a time to beat and a "nobody gets hurt" bonus.
 *   * = goal done   ** = faster than the par time   *** = no civilians hurt
 * Stars are saved in localStorage; a level unlocks once the previous one has a star.
 * This module holds the level data, the save and the floating UI (board, level cards, buttons).
 */
import { CanvasTexture, CircleGeometry, Group, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, Vector3 } from '@iwsdk/core';
import type { HandData } from './hands.js';
import { formForLevel, HERO_FORMS } from './hero.js';

export interface LevelGoal {
  /** glowing target buildings */
  marked?: number;
  /** extra buildings of any kind */
  buildings?: number;
  cars?: number;
  tanks?: number;
}
export interface LevelDef {
  n: number;
  city: string;
  title: string;
  story: string;
  goal: LevelGoal;
  /** marked targets must be at least this tall (forces the new form's strength) */
  markedMin?: number;
  limit: number;
  par: number;
  /** 0 = day .. 1 = night */
  sky: number;
  theme: number;
}

export const LEVELS: LevelDef[] = [
  { n: 1, city: 'TOKYO', title: 'WAKE UP, GIANT', story: 'Smash the 3 glowing houses', goal: { marked: 3 }, limit: 120, par: 50, sky: 0.12, theme: 4 },
  { n: 2, city: 'TOKYO', title: 'RUSH HOUR', story: 'Punch the cars off the road', goal: { cars: 6 }, limit: 100, par: 35, sky: 0.3, theme: 4 },
  { n: 3, city: 'TOKYO', title: 'BLOCK PARTY', story: 'Flatten a whole street', goal: { buildings: 8 }, limit: 120, par: 70, sky: 0.45, theme: 4 },
  { n: 4, city: 'TOKYO', title: 'KING OF THE STREET', story: 'Gorilla power: topple the big ones', goal: { marked: 2, buildings: 8 }, markedMin: 0.07, limit: 130, par: 80, sky: 0.62, theme: 4 },
  { n: 5, city: 'TOKYO', title: 'THE ARMY ARRIVES', story: 'Tanks! Beat them and keep smashing', goal: { tanks: 4, buildings: 6 }, limit: 150, par: 95, sky: 0.86, theme: 4 },
];

export const goalLines = (g: LevelGoal, p: Required<LevelGoal> | null) => {
  const out: string[] = [];
  const f = (have: number | undefined, need: number) => (p ? ` ${Math.min(have ?? 0, need)}/${need}` : '');
  if (g.marked) out.push(`Smash ${g.marked} glowing building${g.marked > 1 ? 's' : ''}${f(p?.marked, g.marked)}`);
  if (g.buildings) out.push(`Destroy ${g.buildings} ${g.marked ? 'more ' : ''}buildings${f(p?.buildings, g.buildings)}`);
  if (g.cars) out.push(`Wreck ${g.cars} cars${f(p?.cars, g.cars)}`);
  if (g.tanks) out.push(`Destroy ${g.tanks} tanks${f(p?.tanks, g.tanks)}`);
  return out;
};

const STORE = 'finger-kaiju-campaign';
export class CampaignSave {
  stars: number[] = LEVELS.map(() => 0);
  times: number[] = LEVELS.map(() => 0);
  constructor() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE) ?? 'null') as { stars?: number[]; times?: number[] } | null;
      if (v?.stars) v.stars.forEach((s, i) => i < this.stars.length && (this.stars[i] = s | 0));
      if (v?.times) v.times.forEach((s, i) => i < this.times.length && (this.times[i] = +s || 0));
    } catch {
      /* storage unavailable */
    }
  }
  get total() {
    return this.stars.reduce((a, b) => a + b, 0);
  }
  unlocked(i: number) {
    return i === 0 || this.stars[i - 1] > 0 || new URLSearchParams(location.search).has('unlockall');
  }
  record(i: number, stars: number, time: number) {
    const better = stars > this.stars[i];
    this.stars[i] = Math.max(this.stars[i], stars);
    if (stars > 0 && (this.times[i] === 0 || time < this.times[i])) this.times[i] = time;
    try {
      localStorage.setItem(STORE, JSON.stringify({ stars: this.stars, times: this.times }));
    } catch {
      /* storage unavailable */
    }
    return better;
  }
  reset() {
    this.stars.fill(0);
    this.times.fill(0);
    try {
      localStorage.removeItem(STORE);
    } catch {
      /* storage unavailable */
    }
  }
}

/* ---------------- drawing helpers ---------------- */
function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
export function star(g: CanvasRenderingContext2D, x: number, y: number, r: number, on: boolean, glow = false) {
  g.save();
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 === 0 ? r : r * 0.46;
    g.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
  }
  g.closePath();
  if (glow && on) {
    g.shadowColor = '#ffcf3a';
    g.shadowBlur = r * 0.8;
  }
  g.fillStyle = on ? '#ffcf3a' : 'rgba(255,255,255,0.13)';
  g.fill();
  g.shadowBlur = 0;
  g.lineWidth = Math.max(3, r * 0.12);
  g.strokeStyle = on ? '#fff3c2' : 'rgba(255,255,255,0.25)';
  g.stroke();
  g.restore();
}
const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

class CanvasPlane {
  readonly mesh: Mesh;
  readonly g: CanvasRenderingContext2D;
  readonly tex: CanvasTexture;
  constructor(
    readonly cw: number,
    readonly ch: number,
    readonly w: number,
    name: string,
    round = false,
  ) {
    const c = document.createElement('canvas');
    c.width = cw;
    c.height = ch;
    this.g = c.getContext('2d')!;
    this.tex = new CanvasTexture(c);
    this.tex.colorSpace = SRGBColorSpace;
    const h = (w * ch) / cw;
    this.mesh = new Mesh(
      round ? new CircleGeometry(w / 2, 40) : new PlaneGeometry(w, h),
      new MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false, depthTest: false }),
    );
    this.mesh.name = name;
    this.mesh.renderOrder = 20;
    this.mesh.visible = false;
  }
  get h() {
    return (this.w * this.ch) / this.cw;
  }
}

export type UiPick = { kind: 'level'; i: number } | { kind: 'retry' } | { kind: 'next' } | { kind: 'levels' } | { kind: 'back' } | { kind: 'zoom'; dir: 1 | -1 };

export interface UiButton {
  plane: CanvasPlane;
  pick: UiPick;
  inside: boolean[];
  enabled: boolean;
}

export interface BoardState {
  level: LevelDef;
  phase: 'intro' | 'play' | 'won' | 'lost';
  time: number;
  progress: Required<LevelGoal>;
  hurt: number;
  hp: number;
  stars: number;
  /** stars revealed so far on the result card (animated) */
  shown: number;
  reason: string;
  newForm: string;
  countdown: number;
  best: number;
}

export class CampaignUi {
  readonly root = new Group();
  readonly board = new CanvasPlane(1024, 560, 0.36, 'CampaignBoard');
  readonly buttons: UiButton[] = [];
  readonly levelCards: UiButton[] = [];
  readonly resultButtons: UiButton[] = [];
  readonly zoomButtons: UiButton[] = [];
  readonly back: UiButton;
  private v = new Vector3();
  private cool = 0;
  private t = 0;
  private lastKey = '';

  constructor() {
    this.root.name = 'CampaignUi';
    this.root.add(this.board.mesh);
    LEVELS.forEach((_, i) => {
      const b = this.add(new CanvasPlane(384, 500, 0.085, `LevelCard-${i + 1}`), { kind: 'level', i });
      this.levelCards.push(b);
    });
    this.back = this.add(new CanvasPlane(384, 500, 0.085, 'LevelCard-back'), { kind: 'back' });
    for (const [id, label] of [
      ['retry', 'RETRY'],
      ['next', 'NEXT'],
      ['levels', 'LEVELS'],
    ] as const) {
      const b = this.add(new CanvasPlane(400, 150, 0.1, `Result-${id}`), { kind: id });
      this.drawButton(b.plane, label, id === 'next' ? '#3fbf5a' : id === 'retry' ? '#ff8a3a' : '#6a5cff');
      this.resultButtons.push(b);
    }
    for (const dir of [1, -1] as const) {
      const b = this.add(new CanvasPlane(200, 200, 0.034, `Zoom-${dir > 0 ? 'in' : 'out'}`, true), { kind: 'zoom', dir });
      const g = b.plane.g;
      g.clearRect(0, 0, 200, 200);
      g.fillStyle = 'rgba(16,12,36,0.9)';
      g.beginPath();
      g.arc(100, 100, 94, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 10;
      g.strokeStyle = '#9ef0ff';
      g.stroke();
      g.fillStyle = '#fff';
      g.fillRect(55, 90, 90, 20);
      if (dir > 0) g.fillRect(90, 55, 20, 90);
      b.plane.tex.needsUpdate = true;
      this.zoomButtons.push(b);
    }
  }

  private add(plane: CanvasPlane, pick: UiPick) {
    const b: UiButton = { plane, pick, inside: [false, false], enabled: true };
    this.root.add(plane.mesh);
    this.buttons.push(b);
    return b;
  }

  private drawButton(p: CanvasPlane, label: string, color: string) {
    const g = p.g;
    g.clearRect(0, 0, p.cw, p.ch);
    g.fillStyle = color;
    rr(g, 8, 8, p.cw - 16, p.ch - 16, 60);
    g.fill();
    g.lineWidth = 8;
    g.strokeStyle = 'rgba(255,255,255,0.8)';
    g.stroke();
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '900 64px system-ui, "Arial Black", sans-serif';
    g.fillText(label, p.cw / 2, p.ch / 2 + 4);
    p.tex.needsUpdate = true;
  }

  drawLevelCards(save: CampaignSave) {
    this.levelCards.forEach((b, i) => {
      const L = LEVELS[i];
      const p = b.plane;
      const g = p.g;
      const open = save.unlocked(i);
      b.enabled = open;
      const form = formForLevel(L.n);
      const newForm = form.level === L.n && L.n > 1;
      g.clearRect(0, 0, p.cw, p.ch);
      const grad = g.createLinearGradient(0, 0, 0, p.ch);
      grad.addColorStop(0, open ? '#2a2060' : '#1c1a26');
      grad.addColorStop(1, open ? '#120d2c' : '#121118');
      g.fillStyle = grad;
      rr(g, 8, 8, p.cw - 16, p.ch - 16, 40);
      g.fill();
      g.lineWidth = 10;
      g.strokeStyle = open ? form.color : '#3a3848';
      g.stroke();
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = open ? '#fff' : '#5a586a';
      g.font = '900 150px system-ui, "Arial Black", sans-serif';
      g.fillText(open ? String(L.n) : '\u{1F512}', p.cw / 2, 150);
      g.font = '800 26px system-ui, sans-serif';
      g.fillStyle = open ? '#9ef0ff' : '#5a586a';
      g.fillText(L.city, p.cw / 2, 255);
      g.font = '900 34px system-ui, sans-serif';
      g.fillStyle = open ? '#fff' : '#5a586a';
      const words = L.title.split(' ');
      const l1 = words.slice(0, Math.ceil(words.length / 2)).join(' ');
      const l2 = words.slice(Math.ceil(words.length / 2)).join(' ');
      g.fillText(l1, p.cw / 2, 300);
      if (l2) g.fillText(l2, p.cw / 2, 340);
      for (let s = 0; s < 3; s++) star(g, p.cw / 2 + (s - 1) * 92, 410, 36, save.stars[i] > s);
      g.font = '800 24px system-ui, sans-serif';
      g.fillStyle = newForm ? form.color : '#a9a3d6';
      g.fillText(newForm ? `NEW: ${form.name.toUpperCase()}!` : form.name.toUpperCase(), p.cw / 2, 466);
      p.tex.needsUpdate = true;
    });
    const p = this.back.plane;
    const g = p.g;
    g.clearRect(0, 0, p.cw, p.ch);
    g.fillStyle = 'rgba(16,12,36,0.92)';
    rr(g, 8, 8, p.cw - 16, p.ch - 16, 40);
    g.fill();
    g.lineWidth = 8;
    g.strokeStyle = '#6a5cff';
    g.stroke();
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '900 120px system-ui, sans-serif';
    g.fillText('←', p.cw / 2, 170);
    g.font = '900 44px system-ui, sans-serif';
    g.fillText('MODES', p.cw / 2, 300);
    g.font = '700 30px system-ui, sans-serif';
    g.fillStyle = '#ffcf3a';
    g.fillText(`★ ${save.total} / ${LEVELS.length * 3}`, p.cw / 2, 380);
    p.tex.needsUpdate = true;
  }

  /** the floating scoreboard */
  drawBoard(s: BoardState) {
    const key = JSON.stringify([s.phase, s.level.n, Math.ceil(s.time), s.progress, s.hurt, Math.round(s.hp), s.shown, s.reason, Math.ceil(s.countdown), s.newForm]);
    if (key === this.lastKey) return;
    this.lastKey = key;
    const p = this.board;
    const g = p.g;
    const W = p.cw;
    const H = p.ch;
    g.clearRect(0, 0, W, H);
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, 'rgba(34,26,78,0.95)');
    grad.addColorStop(1, 'rgba(14,10,34,0.95)');
    g.fillStyle = grad;
    rr(g, 10, 10, W - 20, H - 20, 44);
    g.fill();
    g.lineWidth = 10;
    g.strokeStyle = s.phase === 'lost' ? '#ff5a5a' : s.phase === 'won' ? '#ffcf3a' : formForLevel(s.level.n).color;
    g.stroke();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const L = s.level;
    g.font = '800 30px system-ui, sans-serif';
    g.fillStyle = '#9ef0ff';
    g.fillText(`${L.city}  ·  LEVEL ${L.n}`, W / 2, 58);
    g.font = '900 58px system-ui, "Arial Black", sans-serif';
    g.fillStyle = '#fff';
    g.fillText(L.title, W / 2, 112);

    if (s.phase === 'intro' || s.phase === 'play') {
      const lines = goalLines(L.goal, s.phase === 'play' ? s.progress : null);
      g.textAlign = 'left';
      lines.forEach((l, k) => {
        const done = s.phase === 'play' && this.lineDone(L.goal, s.progress, k);
        g.font = '800 38px system-ui, sans-serif';
        g.fillStyle = done ? '#6fe08a' : '#ffffff';
        g.fillText(`${done ? '✔' : '▸'} ${l}`, 70, 182 + k * 50);
      });
      // the three star rules, live
      const y = 330;
      const goalDone = s.phase === 'play' && this.allDone(L.goal, s.progress);
      const fast = s.phase !== 'play' || L.limit - s.time <= L.par;
      const safe = s.hurt === 0;
      const rules: [boolean, string][] = [
        [goalDone, 'Goal'],
        [fast, `Under ${fmt(L.par)}`],
        [safe, s.hurt ? `${s.hurt} hurt!` : 'Nobody hurt'],
      ];
      rules.forEach(([on, text], k) => {
        const x = 175 + k * 340;
        star(g, x - 95, y, 34, on, true);
        g.textAlign = 'left';
        g.font = '800 34px system-ui, sans-serif';
        g.fillStyle = on ? '#ffe9a6' : k === 2 && s.hurt ? '#ff7a7a' : '#a9a3d6';
        g.fillText(text, x - 50, y + 2);
      });
      g.textAlign = 'center';
      if (s.phase === 'intro') {
        g.font = '700 34px system-ui, sans-serif';
        g.fillStyle = '#d0caf5';
        g.fillText(L.story, W / 2, 410);
        g.font = '900 80px system-ui, "Arial Black", sans-serif';
        g.fillStyle = '#ffcf3a';
        g.fillText(s.countdown > 0.4 ? String(Math.ceil(s.countdown - 0.4)) : 'GO!', W / 2, s.newForm ? 470 : 482);
        if (s.newForm) {
          g.font = '900 36px system-ui, sans-serif';
          g.fillStyle = formForLevel(L.n).color;
          g.fillText(`NEW FORM: ${s.newForm.toUpperCase()}!`, W / 2, 528);
        }
      } else {
        // timer + health
        const left = Math.max(0, s.time);
        g.font = '900 64px system-ui, "Arial Black", sans-serif';
        g.fillStyle = left <= 10 ? '#ff5a5a' : '#ffffff';
        g.fillText(fmt(left), W / 2, 420);
        if (L.goal.tanks) {
          g.fillStyle = 'rgba(255,255,255,0.12)';
          rr(g, 200, 468, W - 400, 34, 17);
          g.fill();
          const hp = Math.max(0, Math.min(1, s.hp / 100));
          g.fillStyle = hp > 0.5 ? '#6fe08a' : hp > 0.25 ? '#ffcf3a' : '#ff5a5a';
          rr(g, 200, 468, Math.max(34, (W - 400) * hp), 34, 17);
          g.fill();
        } else {
          g.font = '700 28px system-ui, sans-serif';
          g.fillStyle = '#a9a3d6';
          g.fillText('People run from you. Don’t hit them!', W / 2, 486);
        }
      }
      p.tex.needsUpdate = true;
      return;
    }
    // result card
    g.textAlign = 'center';
    g.font = '900 74px system-ui, "Arial Black", sans-serif';
    g.fillStyle = s.phase === 'won' ? '#ffcf3a' : '#ff5a5a';
    g.fillText(s.phase === 'won' ? (s.stars === 3 ? 'PERFECT!' : 'LEVEL CLEAR!') : s.reason, W / 2, 196);
    for (let k = 0; k < 3; k++) star(g, W / 2 + (k - 1) * 170, 318, 66, k < s.shown, true);
    g.font = '700 32px system-ui, sans-serif';
    g.fillStyle = '#d0caf5';
    if (s.phase === 'won') {
      const tips: string[] = [];
      if (s.stars < 3) {
        if (s.hurt > 0) tips.push(`${s.hurt} civilian${s.hurt > 1 ? 's' : ''} hurt: be careful for the 3rd star`);
        const used = L.limit - s.time;
        if (used > L.par) tips.push(`${fmt(used)}: beat ${fmt(L.par)} for a star (${Math.ceil(used - L.par)}s faster)`);
      } else tips.push('Fast, clean, flawless. A true kaiju.');
      tips.slice(0, 2).forEach((t, k) => g.fillText(t, W / 2, 428 + k * 42));
    } else {
      g.fillText('So close! Try again.', W / 2, 428);
    }
    if (s.newForm) {
      g.font = '900 36px system-ui, sans-serif';
      g.fillStyle = '#6fe08a';
      g.fillText(`UNLOCKED: ${s.newForm.toUpperCase()}!`, W / 2, 508);
    }
    p.tex.needsUpdate = true;
  }

  private lineDone(goal: LevelGoal, p: Required<LevelGoal>, k: number) {
    const keys = (['marked', 'buildings', 'cars', 'tanks'] as const).filter((x) => goal[x]);
    const key = keys[k];
    return !!key && p[key] >= (goal[key] ?? 0);
  }
  allDone(goal: LevelGoal, p: Required<LevelGoal>) {
    return (['marked', 'buildings', 'cars', 'tanks'] as const).every((k) => !goal[k] || p[k] >= (goal[k] ?? 0));
  }

  /** fingertip pokes; returns the button pressed this frame */
  update(dt: number, hands: HandData[]): UiPick | null {
    this.t += dt;
    this.cool = Math.max(0, this.cool - dt);
    let picked: UiPick | null = null;
    for (const b of this.buttons) {
      const m = b.plane.mesh;
      if (!m.visible) {
        b.inside[0] = b.inside[1] = false;
        continue;
      }
      for (let h = 0; h < hands.length; h++) {
        const hand = hands[h];
        let hit = false;
        if (hand.tracked) {
          for (let f = 1; f < 3; f++) {
            m.worldToLocal(this.v.copy(hand.tips[f]));
            const sx = m.scale.x || 1;
            if (Math.abs(this.v.x) < b.plane.w / 2 && Math.abs(this.v.y) < b.plane.h / 2 && Math.abs(this.v.z * sx) < 0.015) hit = true;
          }
        }
        if (hit && !b.inside[h] && this.cool === 0 && b.enabled) {
          picked = b.pick;
          this.cool = b.pick.kind === 'zoom' ? 0.25 : 0.7;
        }
        b.inside[h] = hit;
      }
    }
    return picked;
  }

  get time() {
    return this.t;
  }
}

export const FORM_COUNT = HERO_FORMS.length;
