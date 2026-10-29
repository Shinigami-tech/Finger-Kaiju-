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
  { n: 1, city: 'TOKYO', title: 'WAKE UP, HAMSTER', story: 'Smash the 3 glowing houses', goal: { marked: 3 }, limit: 120, par: 50, sky: 0.12, theme: 4 },
  { n: 2, city: 'TOKYO', title: 'RUSH HOUR', story: 'Grab cars, gnaw them, throw them!', goal: { cars: 6 }, limit: 100, par: 35, sky: 0.3, theme: 4 },
  { n: 3, city: 'TOKYO', title: 'BLOCK PARTY', story: 'Flatten a whole street', goal: { buildings: 8 }, limit: 120, par: 70, sky: 0.45, theme: 4 },
  { n: 4, city: 'TOKYO', title: 'CHONKY POWER', story: 'Bigger hamster: topple the big ones', goal: { marked: 2, buildings: 8 }, markedMin: 0.07, limit: 130, par: 80, sky: 0.62, theme: 4 },
  { n: 5, city: 'TOKYO', title: 'THE ARMY ARRIVES', story: 'Tanks and a helicopter! Throw cars at them', goal: { tanks: 4, buildings: 6 }, limit: 150, par: 95, sky: 0.86, theme: 4 },
  { n: 6, city: 'SEOUL', title: 'NIGHT MARKET', story: 'Neon Seoul: smash the glowing shops', goal: { marked: 4, cars: 3 }, limit: 130, par: 75, sky: 0.74, theme: 6 },
  { n: 7, city: 'SEOUL', title: 'MEGA HAMSTER', story: 'You are huge now: stomp through the small stuff', goal: { buildings: 12 }, limit: 120, par: 70, sky: 0.5, theme: 6 },
  { n: 8, city: 'SEOUL', title: 'CORNERED', story: 'Police everywhere. Break out!', goal: { tanks: 3, buildings: 8 }, limit: 140, par: 90, sky: 0.8, theme: 6 },
  { n: 9, city: 'SEOUL', title: 'TOWER TOPPLE', story: 'Bring down the glowing towers', goal: { marked: 3 }, markedMin: 0.12, limit: 120, par: 70, sky: 0.36, theme: 6 },
  { n: 10, city: 'SEOUL', title: 'SEOUL SIEGE', story: 'The whole army. Survive and wreck', goal: { tanks: 5, cars: 4, buildings: 10 }, limit: 170, par: 115, sky: 0.9, theme: 6 },
  { n: 11, city: 'LOS ANGELES', title: 'GIGA HAMSTER', story: 'Sunny LA meets a giga hamster', goal: { buildings: 15 }, limit: 130, par: 75, sky: 0.15, theme: 7 },
  { n: 12, city: 'LOS ANGELES', title: 'FREEWAY FRENZY', story: 'Eat or throw 10 cars', goal: { cars: 10 }, limit: 120, par: 65, sky: 0.3, theme: 7 },
  { n: 13, city: 'LOS ANGELES', title: 'HOLLYWOOD STOMP', story: 'Topple the glowing landmarks', goal: { marked: 4, buildings: 10 }, markedMin: 0.14, limit: 150, par: 95, sky: 0.52, theme: 7 },
  { n: 14, city: 'LOS ANGELES', title: 'AIR RAID', story: 'Helicopters and tanks: throw everything!', goal: { tanks: 6, buildings: 12 }, limit: 170, par: 115, sky: 0.7, theme: 7 },
  { n: 15, city: 'LOS ANGELES', title: 'KAIJU HAMSTER', story: 'The final form. Flatten LA', goal: { buildings: 25, tanks: 4 }, limit: 180, par: 120, sky: 0.93, theme: 7 },
  { n: 16, city: 'ASTANA', title: 'STEPPE STORM', story: 'A giant hamster on the left bank', goal: { buildings: 18 }, limit: 140, par: 85, sky: 0.2, theme: 8 },
  { n: 17, city: 'ASTANA', title: 'GLASS TOWERS', story: 'Topple the glowing glass towers', goal: { marked: 5 }, markedMin: 0.15, limit: 130, par: 80, sky: 0.45, theme: 8 },
  { n: 18, city: 'ASTANA', title: 'WINTER TRAFFIC', story: 'Eat or throw 12 cars', goal: { cars: 12 }, limit: 130, par: 75, sky: 0.3, theme: 8 },
  { n: 19, city: 'ASTANA', title: 'BOULEVARD BRAWL', story: 'Tanks on the boulevard', goal: { tanks: 6, buildings: 14 }, limit: 170, par: 115, sky: 0.65, theme: 8 },
  { n: 20, city: 'ASTANA', title: 'CAPITAL NIGHT', story: 'Flatten the capital under the city lights', goal: { buildings: 30, tanks: 4 }, limit: 190, par: 130, sky: 0.92, theme: 8 },
  { n: 21, city: 'VIENNA', title: 'WALTZ OF RUIN', story: 'Old Vienna, new hamster', goal: { buildings: 20 }, limit: 140, par: 85, sky: 0.25, theme: 9 },
  { n: 22, city: 'VIENNA', title: 'OPERA SMASH', story: 'Smash the glowing palaces', goal: { marked: 5, cars: 5 }, limit: 140, par: 90, sky: 0.5, theme: 9 },
  { n: 23, city: 'VIENNA', title: 'CAFE CRUNCH', story: 'Nobody gets hurt. Be careful!', goal: { buildings: 22 }, limit: 150, par: 95, sky: 0.35, theme: 9 },
  { n: 24, city: 'VIENNA', title: 'RING ROAD RUMBLE', story: 'Tanks circle the Ring', goal: { tanks: 7, cars: 6 }, limit: 170, par: 110, sky: 0.7, theme: 9 },
  { n: 25, city: 'VIENNA', title: 'EMPIRE FALLS', story: 'The whole old town', goal: { buildings: 34, tanks: 5 }, limit: 200, par: 140, sky: 0.9, theme: 9 },
  { n: 26, city: 'PALERMO', title: 'SICILIAN SUN', story: 'Hot streets, hungry hamster', goal: { buildings: 22, cars: 6 }, limit: 150, par: 95, sky: 0.18, theme: 10 },
  { n: 27, city: 'PALERMO', title: 'HARBOUR HAVOC', story: 'Wreck the port', goal: { marked: 5, tanks: 4 }, limit: 160, par: 105, sky: 0.4, theme: 10 },
  { n: 28, city: 'PALERMO', title: 'MARKET MAYHEM', story: 'Eat or throw 15 cars', goal: { cars: 15 }, limit: 150, par: 90, sky: 0.55, theme: 10 },
  { n: 29, city: 'PALERMO', title: 'LAST STAND', story: 'The biggest army yet', goal: { tanks: 9, buildings: 18 }, limit: 200, par: 140, sky: 0.75, theme: 10 },
  { n: 30, city: 'PALERMO', title: 'HAMSTER LEGEND', story: 'Leave nothing standing', goal: { buildings: 40, tanks: 6, cars: 6 }, limit: 230, par: 160, sky: 0.94, theme: 10 },
];
export const CITIES = ['TOKYO', 'SEOUL', 'LOS ANGELES', 'ASTANA', 'VIENNA', 'PALERMO'];
export const PER_CITY = 5;

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
/** permanent hamster upgrades, picked from cards after each newly cleared level */
export interface Upgrades {
  power: number;
  fur: number;
  speed: number;
  jump: number;
  cheeks: number;
  double: number;
  pound: number;
}
export type UpgradeId = keyof Upgrades;
export interface UpgradeCard {
  id: UpgradeId;
  title: string;
  lines: string[];
  color: string;
  icon: string;
  max: number;
  /** level (1-based) from which the card can show up */
  from: number;
  needs?: UpgradeId;
}
export const UPGRADES: UpgradeCard[] = [
  { id: 'power', title: 'STRONGER PAWS', lines: ['+25% damage', 'to buildings'], color: '#ff5a36', icon: '\u{1F44A}', max: 6, from: 1 },
  { id: 'fur', title: 'THICK FUR', lines: ['+25 max health', 'and full heal'], color: '#6fe08a', icon: '\u2764\uFE0F', max: 6, from: 1 },
  { id: 'speed', title: 'QUICK FEET', lines: ['+12% walk', 'and run speed'], color: '#36b0ff', icon: '\u{1F45F}', max: 4, from: 1 },
  { id: 'jump', title: 'SPRING LEGS', lines: ['+18% jump height', 'reach taller roofs'], color: '#b55cff', icon: '\u{1F998}', max: 4, from: 2 },
  { id: 'cheeks', title: 'BIG CHEEKS', lines: ['Seeds heal more', 'and give +2s more'], color: '#ffcf3a', icon: '\u{1F33B}', max: 3, from: 2 },
  { id: 'double', title: 'DOUBLE JUMP', lines: ['Press JUMP again', 'in the air'], color: '#5ff0ff', icon: '\u2B06\uFE0F', max: 1, from: 3 },
  { id: 'pound', title: 'QUAKE POUND', lines: ['Double jump, then PUNCH', 'in the air: EARTHQUAKE!'], color: '#ff8a3a', icon: '\u{1F4A5}', max: 1, from: 4, needs: 'double' },
];

export class CampaignSave {
  stars: number[] = LEVELS.map(() => 0);
  times: number[] = LEVELS.map(() => 0);
  up: Upgrades = { power: 0, fur: 0, speed: 0, jump: 0, cheeks: 0, double: 0, pound: 0 };
  constructor() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE) ?? 'null') as { stars?: number[]; times?: number[]; up?: Partial<Upgrades> } | null;
      if (v?.stars) v.stars.forEach((s, i) => i < this.stars.length && (this.stars[i] = s | 0));
      if (v?.times) v.times.forEach((s, i) => i < this.times.length && (this.times[i] = +s || 0));
      if (v?.up) for (const k of Object.keys(this.up) as UpgradeId[]) this.up[k] = Math.max(0, (v.up[k] ?? 0) | 0);
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
      localStorage.setItem(STORE, JSON.stringify({ stars: this.stars, times: this.times, up: this.up }));
    } catch {
      /* storage unavailable */
    }
    return better;
  }
  /** 3 random cards the player can still take at this level */
  offer(level: number): UpgradeCard[] {
    const pool = UPGRADES.filter((u) => level >= u.from && this.up[u.id] < u.max && (!u.needs || this.up[u.needs] > 0));
    // the new moves are special: offer them as soon as they are available
    const special = pool.filter((u) => u.max === 1);
    const rest = pool.filter((u) => u.max > 1).sort(() => Math.random() - 0.5);
    return [...special, ...rest].slice(0, 3);
  }
  take(id: UpgradeId) {
    this.up[id]++;
    try {
      localStorage.setItem(STORE, JSON.stringify({ stars: this.stars, times: this.times, up: this.up }));
    } catch {
      /* storage unavailable */
    }
  }
  reset() {
    this.stars.fill(0);
    this.times.fill(0);
    for (const k of Object.keys(this.up) as UpgradeId[]) this.up[k] = 0;
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

export type UiPick = { kind: 'card'; i: number } | { kind: 'help' } | { kind: 'page'; dir: 1 | -1 } | { kind: 'level'; i: number } | { kind: 'retry' } | { kind: 'next' } | { kind: 'levels' } | { kind: 'back' } | { kind: 'zoom'; dir: 1 | -1 };

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
  seeds: number;
  hpMax: number;
  god: number;
  holding: boolean;
}

export class CampaignUi {
  readonly root = new Group();
  readonly board = new CanvasPlane(1024, 560, 0.36, 'CampaignBoard');
  readonly buttons: UiButton[] = [];
  readonly levelCards: UiButton[] = [];
  readonly pageButtons: UiButton[] = [];
  page = 0;
  readonly resultButtons: UiButton[] = [];
  readonly zoomButtons: UiButton[] = [];
  readonly cards: UiButton[] = [];
  readonly helpButton: UiButton;
  readonly help: CanvasPlane;
  offered: UpgradeCard[] = [];
  readonly back: UiButton;
  private v = new Vector3();
  private cool = 0;
  private t = 0;
  private lastKey = '';

  constructor() {
    this.root.name = 'CampaignUi';
    this.root.add(this.board.mesh);
    for (let i = 0; i < PER_CITY; i++) {
      const b = this.add(new CanvasPlane(384, 500, 0.085, `LevelCard-${i + 1}`), { kind: 'level', i });
      this.levelCards.push(b);
    }
    for (const dir of [-1, 1] as const) {
      const b = this.add(new CanvasPlane(200, 200, 0.04, `CityPage-${dir}`, true), { kind: 'page', dir });
      const g = b.plane.g;
      g.fillStyle = 'rgba(16,12,36,0.92)';
      g.beginPath();
      g.arc(100, 100, 94, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 10;
      g.strokeStyle = '#ffcf3a';
      g.stroke();
      g.fillStyle = '#fff';
      g.beginPath();
      g.moveTo(100 + dir * 42, 100);
      g.lineTo(100 - dir * 28, 52);
      g.lineTo(100 - dir * 28, 148);
      g.closePath();
      g.fill();
      b.plane.tex.needsUpdate = true;
      this.pageButtons.push(b);
    }
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
    for (let k = 0; k < 3; k++) this.cards.push(this.add(new CanvasPlane(384, 520, 0.09, `Upgrade-${k}`), { kind: 'card', i: k }));
    this.helpButton = this.add(new CanvasPlane(200, 200, 0.034, 'HelpButton', true), { kind: 'help' });
    {
      const g = this.helpButton.plane.g;
      g.fillStyle = 'rgba(16,12,36,0.92)';
      g.beginPath();
      g.arc(100, 100, 94, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 10;
      g.strokeStyle = '#ffcf3a';
      g.stroke();
      g.fillStyle = '#ffcf3a';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = '900 120px system-ui, sans-serif';
      g.fillText('?', 100, 108);
      this.helpButton.plane.tex.needsUpdate = true;
    }
    this.help = new CanvasPlane(1600, 1000, 0.62, 'ControlsSheet');
    this.help.mesh.renderOrder = 40; // above every other floating icon
    this.root.add(this.help.mesh);
    this.drawHelp();
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
    this.pageButtons[0].enabled = this.page > 0;
    this.pageButtons[1].enabled = this.page < CITIES.length - 1;
    this.levelCards.forEach((b, k) => {
      const i = this.page * PER_CITY + k;
      b.pick = { kind: 'level', i };
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
    g.font = '900 34px system-ui, sans-serif';
    g.fillStyle = '#9ef0ff';
    g.fillText(`${CITIES[this.page]} ${this.page + 1}/${CITIES.length}`, p.cw / 2, 440);
    p.tex.needsUpdate = true;
  }

  drawCards(save: CampaignSave) {
    this.cards.forEach((b, k) => {
      const c = this.offered[k];
      b.enabled = !!c;
      const p = b.plane;
      const g = p.g;
      g.clearRect(0, 0, p.cw, p.ch);
      if (!c) {
        p.tex.needsUpdate = true;
        return;
      }
      const grad = g.createLinearGradient(0, 0, 0, p.ch);
      grad.addColorStop(0, '#2a2060');
      grad.addColorStop(1, '#120d2c');
      g.fillStyle = grad;
      rr(g, 8, 8, p.cw - 16, p.ch - 16, 40);
      g.fill();
      g.lineWidth = 12;
      g.strokeStyle = c.color;
      g.stroke();
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = c.color;
      g.beginPath();
      g.arc(p.cw / 2, 140, 92, 0, Math.PI * 2);
      g.fill();
      g.font = '110px system-ui, "Apple Color Emoji", "Noto Color Emoji", sans-serif';
      g.fillText(c.icon, p.cw / 2, 146);
      g.fillStyle = '#fff';
      g.font = '900 40px system-ui, "Arial Black", sans-serif';
      g.fillText(c.title, p.cw / 2, 285);
      g.font = '700 30px system-ui, sans-serif';
      g.fillStyle = '#d0caf5';
      c.lines.forEach((l, i) => g.fillText(l, p.cw / 2, 345 + i * 40));
      g.font = '800 28px system-ui, sans-serif';
      g.fillStyle = '#ffcf3a';
      const lv = save.up[c.id];
      g.fillText(c.max > 1 ? `LEVEL ${lv} \u2192 ${lv + 1}` : 'NEW MOVE!', p.cw / 2, 455);
      p.tex.needsUpdate = true;
    });
  }

  /** the move list ("like the combo list in a fighting game") */
  drawHelp() {
    const p = this.help;
    const g = p.g;
    const W = p.cw;
    const H = p.ch;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(14,10,34,0.96)';
    rr(g, 10, 10, W - 20, H - 20, 50);
    g.fill();
    g.lineWidth = 12;
    g.strokeStyle = '#ffcf3a';
    g.stroke();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#ffcf3a';
    g.font = '900 64px system-ui, "Arial Black", sans-serif';
    g.fillText('HAMSTER MOVE LIST', W / 2, 78);
    g.font = '700 28px system-ui, sans-serif';
    g.fillStyle = '#a9a3d6';
    g.fillText('Touch ? or press H to close', W / 2, 128);
    const cols: [string, [string, string][]][] = [
      [
        'QUEST CONTROLLERS',
        [
          ['Left stick', 'Walk (full tilt = run)'],
          ['A / right trigger', 'Punch'],
          ['B', 'Jump (onto roofs!)'],
          ['B in the air', 'Double jump *'],
          ['Double jump + A', 'QUAKE POUND *'],
          ['X / left trigger', 'Grab a car or tank'],
          ['Hold X', 'Eat it  (NOM NOM)'],
          ['A while holding', 'Throw it'],
          ['Right stick', 'Zoom in / out'],
          ['Hold grip + point', 'Move the whole city'],
        ],
      ],
      [
        'HANDS ONLY',
        [
          ['Pinch the street', 'Walk there'],
          ['Pinch a building', 'Go and smash it'],
          ['Pinch a car', 'Go, grab and eat it'],
          ['Holding + pinch house', 'Throw it there'],
          ['Pinch the hamster', 'Pick him up, carry'],
          ['Two-hand pinch', 'Zoom'],
          ['Pinch & hold 1 s', 'Move the city (menus)'],
          ['RAMPAGE: pinch / fist', 'Rip off, crush, THROW'],
          ['RAMPAGE: slam palm', 'Earthquake'],
        ],
      ],
      [
        'KEYBOARD & TIPS',
        [
          ['W A S D  +  Shift', 'Walk / run'],
          ['J', 'Punch / throw'],
          ['Space (x2)', 'Jump / double jump *'],
          ['E (hold)', 'Grab / eat'],
          ['+ / -', 'Zoom'],
          ['Seeds', 'Heal  |  5 = SUPER PUNCH'],
          ['God mode', 'RAMPAGE & HELI HUNT'],
          ['Police', 'Knock them over (free)'],
          ['People', 'Hurt nobody = 3rd star'],
        ],
      ],
    ];
    const cw = (W - 120) / 3;
    cols.forEach(([title, rows], c) => {
      const x = 60 + c * cw;
      g.textAlign = 'left';
      g.font = '900 36px system-ui, sans-serif';
      g.fillStyle = '#9ef0ff';
      g.fillText(title, x + 10, 200);
      rows.forEach(([k, v], i) => {
        const y = 262 + i * 70;
        g.fillStyle = 'rgba(255,255,255,0.08)';
        rr(g, x, y - 30, cw - 24, 60, 14);
        g.fill();
        g.font = '800 26px system-ui, sans-serif';
        g.fillStyle = '#ffcf3a';
        g.fillText(k, x + 16, y - 6);
        g.font = '600 24px system-ui, sans-serif';
        g.fillStyle = '#ffffff';
        g.fillText(v, x + 16, y + 18);
      });
    });
    g.textAlign = 'center';
    g.font = '700 26px system-ui, sans-serif';
    g.fillStyle = '#a9a3d6';
    g.fillText('* unlock with upgrade cards (win levels to get them)', W / 2, H - 40);
    p.tex.needsUpdate = true;
  }

  /** the floating scoreboard */
  drawBoard(s: BoardState) {
    const key = JSON.stringify([s.phase, s.level.n, Math.ceil(s.time), s.progress, s.hurt, Math.round(s.hp), s.hpMax, s.shown, s.reason, Math.ceil(s.countdown), s.newForm, s.seeds, Math.ceil(s.god), s.holding]);
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
        if (L.n >= 2) {
          g.fillStyle = 'rgba(255,255,255,0.12)';
          rr(g, 200, 468, W - 400, 34, 17);
          g.fill();
          const hp = Math.max(0, Math.min(1, s.hp / s.hpMax));
          g.fillStyle = hp > 0.5 ? '#6fe08a' : hp > 0.25 ? '#ffcf3a' : '#ff5a5a';
          rr(g, 200, 468, Math.max(34, (W - 400) * hp), 34, 17);
          g.fill();
        }
        g.font = '800 28px system-ui, sans-serif';
        if (s.god > 0) {
          g.fillStyle = '#ffcf3a';
          g.fillText(`\u2728 GOD MODE ${Math.ceil(s.god)}s: use YOUR hands! \u2728`, W / 2, L.n >= 2 ? 530 : 490);
        } else {
          g.fillStyle = '#a9a3d6';
          g.fillText(
            s.holding ? 'Hold GRAB to gnaw it  |  PUNCH to throw it' : `\u{1F33B} ${s.seeds} seeds   \u00B7   Don\u2019t hit the people!`,
            W / 2,
            L.n >= 2 ? 530 : 490,
          );
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
