/** Floating scoreboard drawn on a canvas texture (works in XR and browser). */
import {
  CanvasTexture,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from '@iwsdk/core';

export interface HudState {
  mode: 'loading' | 'searching' | 'ready' | 'playing' | 'over';
  damage: number;
  best: number;
  time: number;
  hp: number;
  combo: number;
  destroyed: number;
  total: number;
  title?: string;
  grade?: string;
  hint?: string;
  wave?: number;
  game?: 'blitz' | 'heli' | 'missions' | 'rampage';
  countdown?: number;
  catches?: number;
  lives?: number;
  cleared?: number;
  mission?: string;
  missionLeft?: number;
  missionProgress?: string;
  newBest?: boolean;
  busy?: boolean;
}

export const money = (v: number) =>
  v >= 1000 ? `$${(v / 1000).toFixed(2)}B` : `$${Math.round(v)}M`;

export class Hud {
  readonly mesh: Mesh;
  private canvas = document.createElement('canvas');
  private g: CanvasRenderingContext2D;
  private tex: CanvasTexture;
  private last = '';

  constructor() {
    this.canvas.width = 1024;
    this.canvas.height = 512;
    this.g = this.canvas.getContext('2d')!;
    this.tex = new CanvasTexture(this.canvas);
    this.tex.colorSpace = SRGBColorSpace;
    this.mesh = new Mesh(
      new PlaneGeometry(0.32, 0.16),
      new MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false }),
    );
    this.mesh.name = 'HUD';
    this.mesh.renderOrder = 5;
  }

  private hpBar(hpv: number, label: string) {
    const g = this.g;
    const W = 1024;
    g.textAlign = 'center';
    g.font = '700 34px system-ui, sans-serif';
    g.fillStyle = '#a9a3d6';
    g.fillText(label, W / 2, 360);
    g.fillStyle = 'rgba(255,255,255,0.12)';
    rr(g, 90, 395, W - 180, 44, 22);
    g.fill();
    const hp = Math.max(0, Math.min(1, hpv / 100));
    g.fillStyle = hp > 0.5 ? '#6fe08a' : hp > 0.25 ? '#ffcf3a' : '#ff5a5a';
    rr(g, 90, 395, Math.max(44, (W - 180) * hp), 44, 22);
    g.fill();
  }

  draw(s: HudState) {
    const tkey = s.game === 'blitz' && Number.isFinite(s.time) ? Math.ceil(s.time * 10) : Math.ceil(s.time);
    const key = JSON.stringify([s.mode, Math.round(s.damage), s.best, tkey, Math.round(s.hp), s.combo, s.destroyed, s.title, s.hint, s.wave, s.game, Math.ceil((s.countdown ?? 0) - 0.4), s.catches, s.lives, s.cleared, s.mission, Math.round((s.missionLeft ?? 0) * 60), s.missionProgress, s.newBest, s.busy]);
    if (key === this.last) return;
    this.last = key;
    const g = this.g;
    const W = 1024;
    const H = 512;
    g.clearRect(0, 0, W, H);
    // card
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, 'rgba(26,22,52,0.92)');
    grd.addColorStop(1, 'rgba(12,10,28,0.92)');
    g.fillStyle = grd;
    rr(g, 12, 12, W - 24, H - 24, 48);
    g.fill();
    g.lineWidth = 6;
    g.strokeStyle = s.mode === 'over' ? '#ff5a5a' : '#ffcf3a';
    g.stroke();
    g.textAlign = 'center';
    g.textBaseline = 'middle';

    const title = (t: string, y: number, size: number, color: string) => {
      g.font = `900 ${size}px system-ui, "Arial Black", sans-serif`;
      g.fillStyle = color;
      g.fillText(t, W / 2, y);
    };

    if (s.mode === 'loading') {
      title('FINGER KAIJU', 150, 96, '#ffcf3a');
      title('Building the city...', 290, 52, '#ffffff');
    } else if (s.mode === 'searching') {
      title('FINGER KAIJU', 130, 96, '#ffcf3a');
      title('Looking for a table...', 260, 52, '#ffffff');
      title(s.hint ?? 'Look at your desk', 350, 40, '#a9a3d6');
    } else if (s.mode === 'ready' || (s.mode === 'playing' && (s.countdown ?? 0) > 0)) {
      const cd = Math.ceil((s.countdown ?? 0) - 0.4);
      const names = { blitz: 'BLITZ', heli: 'HELI HUNT', missions: 'MISSIONS', rampage: 'RAMPAGE' };
      if (s.mode === 'playing') {
        title(names[s.game ?? 'rampage'], 110, 70, '#a9a3d6');
        title(cd > 0 ? String(cd) : 'GO!', 290, 220, cd > 0 ? '#ffcf3a' : '#6fe08a');
      } else if (s.busy) {
        title('FINGER KAIJU', 130, 96, '#ffcf3a');
        title('Get ready...', 270, 60, '#ffffff');
      } else {
        title('FINGER KAIJU', 120, 96, '#ffcf3a');
        title('CHOOSE A GAME', 240, 64, '#ffffff');
        title('Touch a card below the city', 320, 38, '#a9a3d6');
        title(s.hint ?? 'Grab, throw, crush, slam!', 400, 32, '#8a84b8');
      }
    } else if (s.mode === 'playing' && s.game === 'heli') {
      g.font = '700 40px system-ui, sans-serif';
      g.fillStyle = '#a9a3d6';
      g.fillText('HELICOPTERS CAUGHT', W / 2, 70);
      title(String(s.catches ?? 0), 170, 130, '#9ef0ff');
      g.font = '900 64px system-ui, sans-serif';
      g.fillStyle = s.time <= 5 ? '#ff5a5a' : '#ffffff';
      g.fillText(`${Math.ceil(s.time)}s`, W / 2, 290);
      this.hpBar(s.hp, 'KAIJU HP');
    } else if (s.mode === 'playing' && s.game === 'missions') {
      g.font = '800 34px system-ui, sans-serif';
      g.textAlign = 'left';
      g.fillStyle = '#a9a3d6';
      g.fillText(`MISSION ${(s.cleared ?? 0) + 1}`, 60, 64);
      g.textAlign = 'right';
      g.fillStyle = '#ff5a6a';
      g.fillText('LIVES ' + '\u2665'.repeat(Math.max(0, s.lives ?? 0)) + '\u2661'.repeat(Math.max(0, 3 - (s.lives ?? 0))), W - 60, 64);
      g.textAlign = 'center';
      // mission text, wrapped to two lines if needed
      const text = s.mission ?? '';
      let size = 64;
      g.font = `900 ${size}px system-ui, "Arial Black", sans-serif`;
      const words = text.split(' ');
      let l1 = text;
      let l2 = '';
      if (g.measureText(text).width > W - 100) {
        const half = Math.ceil(words.length / 2);
        l1 = words.slice(0, half).join(' ');
        l2 = words.slice(half).join(' ');
        while (Math.max(g.measureText(l1).width, g.measureText(l2).width) > W - 100 && size > 30) {
          size -= 4;
          g.font = `900 ${size}px system-ui, "Arial Black", sans-serif`;
        }
      }
      g.fillStyle = '#ffcf3a';
      g.fillText(l1, W / 2, l2 ? 160 : 190);
      if (l2) g.fillText(l2, W / 2, 160 + size + 6);
      if (s.missionProgress) title(s.missionProgress, 330, 60, '#ffffff');
      // time bar
      g.fillStyle = 'rgba(255,255,255,0.12)';
      rr(g, 90, 400, W - 180, 40, 20);
      g.fill();
      const left = s.missionLeft ?? 0;
      g.fillStyle = left > 0.5 ? '#6fe08a' : left > 0.25 ? '#ffcf3a' : '#ff5a5a';
      if (left > 0) {
        rr(g, 90, 400, Math.max(40, (W - 180) * left), 40, 20);
        g.fill();
      }
      g.font = '700 30px system-ui, sans-serif';
      g.fillStyle = '#a9a3d6';
      g.fillText(`${s.cleared ?? 0} cleared`, W / 2, 470);
    } else if (s.mode === 'playing') {
      g.font = '700 40px system-ui, sans-serif';
      g.fillStyle = '#a9a3d6';
      g.fillText('CITY DAMAGE', W / 2, 70);
      title(money(s.damage), 160, 120, '#ffcf3a');
      // time + combo row
      g.font = '900 64px system-ui, sans-serif';
      g.textAlign = 'left';
      g.fillStyle = s.time <= (s.game === 'blitz' ? 3 : 10) ? '#ff5a5a' : '#ffffff';
      const tt = !Number.isFinite(s.time) ? '∞' : s.game === 'blitz' ? `${Math.max(0, s.time).toFixed(1)}s` : `${Math.ceil(s.time)}s`;
      g.fillText(tt, 70, 280);
      if ((s.wave ?? 1) > 1) {
        g.font = '800 34px system-ui, sans-serif';
        g.fillStyle = '#9ef0ff';
        g.textAlign = 'left';
        g.fillText(`CITY ${s.wave}`, 70, 70);
        g.font = '900 64px system-ui, sans-serif';
      }
      g.textAlign = 'right';
      g.fillStyle = '#ff8a5a';
      if (s.combo > 1) g.fillText(`COMBO x${s.combo}`, W - 70, 280);
      g.textAlign = 'center';
      // HP bar
      g.font = '700 34px system-ui, sans-serif';
      g.fillStyle = '#a9a3d6';
      g.fillText('KAIJU HP', W / 2, 360);
      g.fillStyle = 'rgba(255,255,255,0.12)';
      rr(g, 90, 395, W - 180, 44, 22);
      g.fill();
      const hp = Math.max(0, Math.min(1, s.hp / 100));
      g.fillStyle = hp > 0.5 ? '#6fe08a' : hp > 0.25 ? '#ffcf3a' : '#ff5a5a';
      rr(g, 90, 395, Math.max(44, (W - 180) * hp), 44, 22);
      g.fill();
      g.font = '700 30px system-ui, sans-serif';
      g.fillStyle = '#a9a3d6';
      g.fillText(`${s.destroyed}/${s.total} buildings`, W / 2, 470);
    } else {
      title(s.title ?? 'GAME OVER', 90, 74, '#ff5a5a');
      const main = s.game === 'heli' ? `${s.catches ?? 0} CAUGHT` : s.game === 'missions' ? `${s.cleared ?? 0} MISSIONS` : money(s.damage);
      title(main, 200, 104, '#ffcf3a');
      const best = s.game === 'heli' ? `${s.best} caught` : s.game === 'missions' ? `${s.best} missions` : money(s.best);
      title(s.newBest ? 'NEW RECORD!' : `Rank ${s.grade ?? '-'}   |   Best ${best}`, 300, 50, s.newBest ? '#6fe08a' : '#ffffff');
      title('Pick a game below to play again', 410, 36, '#a9a3d6');
    }
    this.tex.needsUpdate = true;
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

/** "BREAKING NEWS" ticker that runs under the scoreboard. Headlines are pushed by game events. */
export class Ticker {
  readonly mesh: Mesh;
  private canvas = document.createElement('canvas');
  private g: CanvasRenderingContext2D;
  private tex: CanvasTexture;
  private text = '';
  private queue: string[] = [];
  private x = 0;
  private textW = 0;
  private hold = 0;

  constructor() {
    this.canvas.width = 1024;
    this.canvas.height = 72;
    this.g = this.canvas.getContext('2d')!;
    this.tex = new CanvasTexture(this.canvas);
    this.tex.colorSpace = SRGBColorSpace;
    this.mesh = new Mesh(
      new PlaneGeometry(0.32, 0.0225),
      new MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false }),
    );
    this.mesh.name = 'NewsTicker';
    this.mesh.renderOrder = 5;
    this.push('LIVE FROM TINY CITY: a quiet evening downtown');
  }

  /** Queue a headline; urgent ones jump the queue. */
  push(text: string, urgent = false) {
    if (text === this.text || this.queue.includes(text)) return;
    if (urgent) this.queue.unshift(text);
    else this.queue.push(text);
    if (this.queue.length > 4) this.queue.length = 4;
    if (!this.text || urgent) this.next();
  }

  reset(text: string) {
    this.queue.length = 0;
    this.text = '';
    this.push(text);
  }

  private next() {
    const t = this.queue.shift();
    if (!t) return;
    this.text = t;
    this.g.font = '800 40px system-ui, "Arial Black", sans-serif';
    this.textW = this.g.measureText(t).width;
    this.x = 1024;
    this.hold = 0;
  }

  private acc = 0;
  /** settings: hide the ticker */
  enabled = true;

  update(dt: number) {
    if (!this.text || !this.enabled) return;
    // 30 Hz is plenty for a ticker and halves the texture uploads
    this.acc += dt;
    if (this.acc < 1 / 30) return;
    dt = this.acc;
    this.acc = 0;
    const g = this.g;
    const W = 1024;
    const H = 72;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(12,10,28,0.88)';
    g.fillRect(0, 6, W, H - 12);
    const LABEL = 250;
    // scrolling headline
    this.x -= dt * 260;
    const end = LABEL + 30;
    if (this.x < end) {
      this.x = end;
      this.hold += dt;
      const room = W - end - 20;
      if (this.textW > room) this.x = end - Math.min(this.textW - room, (this.hold - 0) * 140);
      if (this.hold > Math.max(3.5, (this.textW - room) / 140 + 2.5) && this.queue.length) this.next();
    }
    g.save();
    g.beginPath();
    g.rect(LABEL, 0, W - LABEL, H);
    g.clip();
    g.font = '800 40px system-ui, "Arial Black", sans-serif';
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.fillStyle = '#ffffff';
    g.fillText(this.text, this.x, H / 2 + 2);
    g.restore();
    g.textBaseline = 'middle';
    // red BREAKING label with a blinking dot
    g.fillStyle = '#e0242c';
    g.fillRect(0, 6, LABEL, H - 12);
    g.fillStyle = Math.floor(performance.now() / 450) % 2 ? '#ffffff' : '#ffb0b0';
    g.beginPath();
    g.arc(30, H / 2, 9, 0, Math.PI * 2);
    g.fill();
    g.font = '900 36px system-ui, "Arial Black", sans-serif';
    g.fillStyle = '#ffffff';
    g.fillText('BREAKING', 50, H / 2 + 2);
    this.tex.needsUpdate = true;
  }
}

/** Short "how to play" card that floats over the city at the start of a game. */
export class Coach {
  readonly mesh: Mesh;
  private canvas = document.createElement('canvas');
  private g: CanvasRenderingContext2D;
  private tex: CanvasTexture;
  private t = 0;
  private dur = 0;

  constructor() {
    this.canvas.width = 1024;
    this.canvas.height = 440;
    this.g = this.canvas.getContext('2d')!;
    this.tex = new CanvasTexture(this.canvas);
    this.tex.colorSpace = SRGBColorSpace;
    this.mesh = new Mesh(
      new PlaneGeometry(0.3, 0.129),
      new MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false, opacity: 0 }),
    );
    this.mesh.name = 'Coach';
    this.mesh.renderOrder = 8;
    this.mesh.visible = false;
  }

  /** show `tips` (icon + text pairs) for `seconds` */
  show(title: string, tips: [string, string][], seconds: number) {
    const g = this.g;
    const W = 1024;
    const H = 440;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(14,10,34,0.9)';
    rr(g, 8, 8, W - 16, H - 16, 40);
    g.fill();
    g.lineWidth = 6;
    g.strokeStyle = '#6fe08a';
    g.stroke();
    g.textBaseline = 'middle';
    g.textAlign = 'center';
    g.font = '900 46px system-ui, "Arial Black", sans-serif';
    g.fillStyle = '#6fe08a';
    g.fillText(title, W / 2, 62);
    tips.forEach(([icon, text], i) => {
      const y = 150 + i * 92;
      g.fillStyle = '#2c2560';
      g.beginPath();
      g.arc(90, y, 38, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#ffcf3a';
      g.font = '900 38px system-ui, sans-serif';
      g.fillText(icon, 90, y + 2);
      g.textAlign = 'left';
      g.font = '700 40px system-ui, sans-serif';
      g.fillStyle = '#ffffff';
      g.fillText(text, 150, y + 2);
      g.textAlign = 'center';
    });
    this.tex.needsUpdate = true;
    this.t = 0;
    this.dur = seconds;
    this.mesh.visible = true;
  }

  hide() {
    this.dur = Math.min(this.dur, this.t + 0.3);
  }

  update(dt: number) {
    if (!this.mesh.visible) return;
    this.t += dt;
    const m = this.mesh.material as MeshBasicMaterial;
    m.opacity = Math.min(1, this.t / 0.3, Math.max(0, (this.dur - this.t) / 0.4));
    if (this.t >= this.dur) this.mesh.visible = false;
  }
}
