/**
 * Game settings: one store, two UIs.
 *  - Desktop: an HTML gear button + panel over the canvas.
 *  - Mixed reality: a gear you poke next to the city, opening a floating board with
 *    big [<] [>] buttons you press with your index fingertip.
 * Values persist in localStorage.
 */
import { CanvasTexture, Group, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, Vector3 } from '@iwsdk/core';
import type { HandData } from './hands.js';

export interface SettingValues {
  music: number;
  sfx: number;
  round: number; // seconds, 0 = endless (Rampage)
  blitz: number; // seconds, 0 = endless (10s Blitz)
  difficulty: 'easy' | 'normal' | 'hard';
  sky: 'cycle' | 'day' | 'sunset' | 'night';
  effects: 'low' | 'medium' | 'high';
  rebuild: boolean;
  shake: boolean;
  claws: boolean;
  shadows: boolean;
  news: boolean;
}

type Key = keyof SettingValues;
interface Def {
  key: Key;
  label: string;
  options: (number | string | boolean)[];
  show: (v: number | string | boolean) => string;
}

const pct = (v: number | string | boolean) => `${Math.round(Number(v) * 100)}%`;
const onOff = (v: number | string | boolean) => (v ? 'ON' : 'OFF');
const cap = (v: number | string | boolean) => String(v).toUpperCase();
const vol = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];

export const DEFS: Def[] = [
  { key: 'music', label: 'Music volume', options: vol, show: pct },
  { key: 'sfx', label: 'Sound effects', options: vol, show: pct },
  { key: 'blitz', label: 'Blitz length', options: [10, 15, 30, 60, 0], show: (v) => (v === 0 ? 'ENDLESS' : v === 60 ? '1 MIN' : `${v}s`) },
  { key: 'round', label: 'Rampage length', options: [60, 90, 120, 180, 0], show: (v) => (v === 0 ? 'ENDLESS' : `${v}s`) },
  { key: 'difficulty', label: 'Difficulty', options: ['easy', 'normal', 'hard'], show: cap },
  { key: 'sky', label: 'Time of day', options: ['cycle', 'day', 'sunset', 'night'], show: (v) => (v === 'cycle' ? 'DAY > NIGHT' : cap(v)) },
  { key: 'effects', label: 'Fire & smoke', options: ['low', 'medium', 'high'], show: cap },
  { key: 'rebuild', label: 'New city (Rampage)', options: [true, false], show: onOff },
  { key: 'shake', label: 'Earthquake shake', options: [true, false], show: onOff },
  { key: 'claws', label: 'Kaiju claws', options: [true, false], show: onOff },
  { key: 'shadows', label: 'Hand shadows', options: [true, false], show: onOff },
  { key: 'news', label: 'News ticker', options: [true, false], show: onOff },
];

const DEFAULTS: SettingValues = {
  music: 0.3,
  sfx: 0.8,
  round: 90,
  blitz: 10,
  difficulty: 'normal',
  sky: 'cycle',
  effects: 'high',
  rebuild: true,
  shake: true,
  claws: true,
  shadows: true,
  news: true,
};
const STORE = 'finger-kaiju-settings';

export class Settings {
  values: SettingValues = { ...DEFAULTS };
  private listeners: ((v: SettingValues, changed: Key | null) => void)[] = [];
  /** extra actions shown at the bottom of the panels */
  onResetBest: (() => void) | null = null;
  /** end the current game and go back to the mode menu */
  onQuit: (() => void) | null = null;

  constructor() {
    try {
      const raw = localStorage.getItem(STORE);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<SettingValues>;
        for (const d of DEFS) {
          const v = saved[d.key];
          if (v !== undefined && d.options.includes(v)) (this.values as unknown as Record<string, unknown>)[d.key] = v;
        }
      }
    } catch {
      /* storage unavailable */
    }
  }

  onChange(fn: (v: SettingValues, changed: Key | null) => void) {
    this.listeners.push(fn);
    fn(this.values, null);
  }

  set<K extends Key>(key: K, value: SettingValues[K]) {
    if (this.values[key] === value) return;
    this.values[key] = value;
    try {
      localStorage.setItem(STORE, JSON.stringify(this.values));
    } catch {
      /* storage unavailable */
    }
    for (const fn of this.listeners) fn(this.values, key);
  }

  /** step a setting through its options (dir = -1 / +1) */
  step(key: Key, dir: number) {
    const d = DEFS.find((x) => x.key === key)!;
    const i = d.options.indexOf(this.values[key]);
    const n = d.options.length;
    // numeric scales clamp, choices wrap around
    const next = typeof d.options[0] === 'number' && key !== 'round' && key !== 'blitz' ? Math.max(0, Math.min(n - 1, i + dir)) : (i + dir + n) % n;
    this.set(key, d.options[next] as never);
  }

  reset() {
    for (const d of DEFS) this.set(d.key, DEFAULTS[d.key] as never);
  }
}

/* ---------------- desktop HTML panel ---------------- */
export function mountDesktopSettings(s: Settings) {
  const css = document.createElement('style');
  css.textContent = `
  .fk-gear{position:fixed;top:14px;right:14px;z-index:20;width:46px;height:46px;border-radius:50%;border:2px solid #ffcf3a;
    background:rgba(18,14,40,.88);color:#ffcf3a;font:700 24px system-ui;cursor:pointer;display:flex;align-items:center;justify-content:center}
  .fk-gear:hover{transform:rotate(30deg)}
  .fk-panel{position:fixed;top:70px;right:14px;z-index:20;width:min(330px,calc(100vw - 28px));max-height:calc(100vh - 90px);overflow:auto;
    background:rgba(18,14,40,.94);border:2px solid #ffcf3a;border-radius:18px;padding:14px 16px;color:#fff;font:14px system-ui;display:none}
  .fk-panel.open{display:block}
  .fk-panel h3{margin:0 0 10px;font:900 18px system-ui;color:#ffcf3a;letter-spacing:.5px}
  .fk-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.07)}
  .fk-row label{color:#cfc9f2}
  .fk-row .ctl{display:flex;align-items:center;gap:6px}
  .fk-row button{width:28px;height:28px;border-radius:8px;border:0;background:#2c2560;color:#fff;font:700 15px system-ui;cursor:pointer}
  .fk-row button:hover{background:#463c94}
  .fk-row .val{min-width:96px;text-align:center;font-weight:800;color:#ffcf3a}
  .fk-actions{display:flex;gap:8px;margin-top:12px}
  .fk-actions button{flex:1;padding:8px;border-radius:10px;border:0;background:#e0242c;color:#fff;font:700 13px system-ui;cursor:pointer}
  .fk-actions button.alt{background:#2c2560}`;
  document.head.appendChild(css);
  const gear = document.createElement('button');
  gear.className = 'fk-gear';
  gear.title = 'Settings';
  gear.textContent = '⚙';
  const panel = document.createElement('div');
  panel.className = 'fk-panel';
  panel.innerHTML = '<h3>SETTINGS</h3>';
  const vals = new Map<Key, HTMLElement>();
  for (const d of DEFS) {
    const row = document.createElement('div');
    row.className = 'fk-row';
    row.innerHTML = `<label>${d.label}</label><div class="ctl"><button aria-label="less">‹</button><span class="val"></span><button aria-label="more">›</button></div>`;
    const [minus, plus] = row.querySelectorAll('button');
    minus.addEventListener('click', () => s.step(d.key, -1));
    plus.addEventListener('click', () => s.step(d.key, 1));
    vals.set(d.key, row.querySelector('.val') as HTMLElement);
    panel.appendChild(row);
  }
  const actions = document.createElement('div');
  actions.className = 'fk-actions';
  actions.innerHTML = '<button class="alt">Defaults</button><button class="alt">Reset best</button><button>End game</button>';
  const [defs, best, quit] = actions.querySelectorAll('button');
  defs.addEventListener('click', () => s.reset());
  best.addEventListener('click', () => s.onResetBest?.());
  quit.addEventListener('click', () => {
    s.onQuit?.();
    panel.classList.remove('open');
  });
  panel.appendChild(actions);
  gear.addEventListener('click', () => panel.classList.toggle('open'));
  for (const el of [gear, panel]) {
    // keep clicks on the UI from smashing the city underneath
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    document.body.appendChild(el);
  }
  s.onChange((v) => {
    for (const d of DEFS) vals.get(d.key)!.textContent = d.show(v[d.key]);
  });
  return { isOpen: () => panel.classList.contains('open') };
}

/* ---------------- mixed reality board (finger-poke buttons) ---------------- */
const W = 1024;
const ROW_H = 74;
const TOP = 112;
const H = TOP + DEFS.length * ROW_H + 120;

interface Btn {
  x: number;
  y: number;
  w: number;
  h: number;
  act: () => void;
}

export class SettingsBoard {
  /** world-space group; position it each frame next to the city */
  readonly root = new Group();
  readonly gear: Mesh;
  readonly board: Mesh;
  open = false;
  private canvas = document.createElement('canvas');
  private g: CanvasRenderingContext2D;
  private tex: CanvasTexture;
  private buttons: Btn[] = [];
  private hot = -1;
  private cool = 0;
  private gearInside = [false, false];
  private boardInside = [false, false];
  private v = new Vector3();
  private readonly size = { w: 0.3, h: (0.3 * H) / W };

  constructor(private s: Settings) {
    this.root.name = 'SettingsBoard';
    this.canvas.width = W;
    this.canvas.height = H;
    this.g = this.canvas.getContext('2d')!;
    this.tex = new CanvasTexture(this.canvas);
    this.tex.colorSpace = SRGBColorSpace;
    this.board = new Mesh(new PlaneGeometry(this.size.w, this.size.h), new MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false }));
    this.board.renderOrder = 6;
    this.board.visible = false;
    this.root.add(this.board);
    // gear icon
    const gc = document.createElement('canvas');
    gc.width = gc.height = 128;
    const gg = gc.getContext('2d')!;
    gg.fillStyle = 'rgba(18,14,40,0.92)';
    gg.beginPath();
    gg.arc(64, 64, 60, 0, Math.PI * 2);
    gg.fill();
    gg.lineWidth = 6;
    gg.strokeStyle = '#ffcf3a';
    gg.stroke();
    gg.fillStyle = '#ffcf3a';
    gg.font = '900 84px system-ui, sans-serif';
    gg.textAlign = 'center';
    gg.textBaseline = 'middle';
    gg.fillText('⚙', 64, 70);
    const gt = new CanvasTexture(gc);
    gt.colorSpace = SRGBColorSpace;
    this.gear = new Mesh(new PlaneGeometry(0.04, 0.04), new MeshBasicMaterial({ map: gt, transparent: true, depthWrite: false }));
    this.gear.renderOrder = 6;
    this.root.add(this.gear);
    s.onChange(() => this.draw());
  }

  private draw() {
    const g = this.g;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(18,14,40,0.95)';
    rr(g, 8, 8, W - 16, H - 16, 40);
    g.fill();
    g.lineWidth = 6;
    g.strokeStyle = '#ffcf3a';
    g.stroke();
    g.textBaseline = 'middle';
    g.font = '900 54px system-ui, "Arial Black", sans-serif';
    g.fillStyle = '#ffcf3a';
    g.textAlign = 'left';
    g.fillText('SETTINGS', 48, 62);
    this.buttons = [];
    // close
    this.button(W - 120, 26, 80, 72, 'X', () => (this.open = false), '#e0242c');
    DEFS.forEach((d, i) => {
      const y = TOP + i * ROW_H;
      g.font = '600 36px system-ui, sans-serif';
      g.fillStyle = '#d9d3ff';
      g.textAlign = 'left';
      g.fillText(d.label, 48, y + ROW_H / 2);
      this.button(560, y + 7, 76, ROW_H - 14, '<', () => this.s.step(d.key, -1));
      this.button(W - 124, y + 7, 76, ROW_H - 14, '>', () => this.s.step(d.key, 1));
      g.font = '900 34px system-ui, sans-serif';
      g.fillStyle = '#ffcf3a';
      g.textAlign = 'center';
      g.fillText(d.show(this.s.values[d.key]), (636 + W - 124) / 2, y + ROW_H / 2);
    });
    const by = TOP + DEFS.length * ROW_H + 24;
    this.button(40, by, 290, 76, 'DEFAULTS', () => this.s.reset(), '#2c2560');
    this.button(367, by, 290, 76, 'RESET BEST', () => this.s.onResetBest?.(), '#2c2560');
    this.button(W - 330, by, 290, 76, 'END GAME', () => {
      this.s.onQuit?.();
      this.open = false;
    }, '#e0242c');
    this.tex.needsUpdate = true;
  }

  private button(x: number, y: number, w: number, h: number, label: string, act: () => void, bg = '#2c2560') {
    const g = this.g;
    const hot = this.buttons.length === this.hot;
    g.fillStyle = hot ? '#ffcf3a' : bg;
    rr(g, x, y, w, h, 16);
    g.fill();
    g.fillStyle = hot ? '#1a1430' : '#ffffff';
    g.font = '900 36px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText(label, x + w / 2, y + h / 2 + 2);
    this.buttons.push({ x, y, w, h, act });
  }

  /** Poke with index fingertips. Returns true while the board is open (game pauses). */
  update(dt: number, hands: HandData[]) {
    this.cool = Math.max(0, this.cool - dt);
    this.board.visible = this.open;
    for (let h = 0; h < hands.length; h++) {
      const hand = hands[h];
      if (!hand.tracked) {
        this.gearInside[h] = this.boardInside[h] = false;
        continue;
      }
      const tip = hand.tips[1];
      // gear
      this.gear.worldToLocal(this.v.copy(tip));
      const inGear = Math.abs(this.v.x) < 0.024 && Math.abs(this.v.y) < 0.024 && Math.abs(this.v.z) < 0.015;
      if (inGear && !this.gearInside[h] && this.cool === 0) {
        this.open = !this.open;
        this.cool = 0.5;
      }
      this.gearInside[h] = inGear;
      if (!this.open) continue;
      // board buttons
      this.board.worldToLocal(this.v.copy(tip));
      const inside = Math.abs(this.v.x) < this.size.w / 2 && Math.abs(this.v.y) < this.size.h / 2 && Math.abs(this.v.z) < 0.012;
      if (inside && !this.boardInside[h] && this.cool === 0) {
        const px = (this.v.x / this.size.w + 0.5) * W;
        const py = (0.5 - this.v.y / this.size.h) * H;
        const i = this.buttons.findIndex((b) => px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h);
        if (i >= 0) {
          this.hot = i;
          this.buttons[i].act();
          this.cool = 0.3;
          this.draw();
          setTimeout(() => {
            this.hot = -1;
            this.draw();
          }, 160);
        }
      }
      this.boardInside[h] = inside;
    }
    this.board.visible = this.open;
    return this.open;
  }
}

function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
