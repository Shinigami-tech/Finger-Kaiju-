/**
 * Game-mode picker: four cards floating at the front edge of the city.
 * Poke one with a fingertip (mixed reality) or click it (desktop).
 */
import { CanvasTexture, Group, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, Vector3 } from '@iwsdk/core';
import type { HandData } from './hands.js';

export type GameMode = 'campaign' | 'blitz' | 'heli' | 'missions' | 'rampage';

export interface ModeInfo {
  id: GameMode;
  title: string;
  lines: string[];
  color: string;
  icon: (g: CanvasRenderingContext2D, x: number, y: number) => void;
}

const CW = 512;
const CH = 640;
export const CARD_W = 0.105;
export const CARD_H = (CARD_W * CH) / CW;

export const MODES: ModeInfo[] = [
  {
    id: 'campaign',
    title: 'CAMPAIGN',
    lines: ['Walk the city as a giant.', 'Win all 3 stars!'],
    color: '#ffcf3a',
    icon: (g, x, y) => {
      g.fillStyle = '#fff';
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const r = i % 2 === 0 ? 100 : 44;
        g.lineTo(x + Math.cos(a) * r, y + 8 + Math.sin(a) * r);
      }
      g.closePath();
      g.fill();
    },
  },
  {
    id: 'blitz',
    title: 'BLITZ',
    lines: ['Smash as much as you can', 'before the clock runs out'],
    color: '#ff5a36',
    icon: (g, x, y) => {
      // stopwatch
      g.lineWidth = 16;
      g.strokeStyle = '#fff';
      g.beginPath();
      g.arc(x, y + 10, 78, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = '#fff';
      g.fillRect(x - 18, y - 100, 36, 26);
      g.beginPath();
      g.moveTo(x, y + 10);
      g.lineTo(x + 46, y - 30);
      g.stroke();
      g.font = '900 56px system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText('10', x, y + 52);
    },
  },
  {
    id: 'heli',
    title: 'HELI HUNT',
    lines: ['The city is gone. Catch', 'the fast chopper!'],
    color: '#36b0ff',
    icon: (g, x, y) => {
      g.fillStyle = '#fff';
      g.beginPath();
      g.ellipse(x - 6, y + 14, 66, 38, 0, 0, Math.PI * 2);
      g.fill();
      g.fillRect(x + 40, y + 2, 96, 18);
      g.fillRect(x + 122, y - 22, 16, 40);
      g.fillRect(x - 120, y - 46, 230, 12);
      g.fillRect(x - 10, y - 46, 16, 30);
      g.fillRect(x - 60, y + 58, 110, 10);
      g.fillStyle = '#36b0ff';
      g.beginPath();
      g.ellipse(x - 30, y + 8, 26, 18, 0, 0, Math.PI * 2);
      g.fill();
    },
  },
  {
    id: 'missions',
    title: 'MISSIONS',
    lines: ['Crazy quick orders,', '3 lives. How far can you go?'],
    color: '#b55cff',
    icon: (g, x, y) => {
      g.fillStyle = '#fff';
      g.font = '900 150px system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText('!?', x, y + 40);
    },
  },
  {
    id: 'rampage',
    title: 'RAMPAGE',
    lines: ['Classic: wreck the city,', 'fight tanks & choppers'],
    color: '#3fbf5a',
    icon: (g, x, y) => {
      // skyline
      g.fillStyle = '#fff';
      const b = [
        [-120, 60],
        [-80, 120],
        [-30, 90],
        [20, 150],
        [70, 70],
        [110, 110],
      ];
      for (const [dx, h] of b) g.fillRect(x + dx - 18, y + 70 - h, 40, h);
      g.fillStyle = '#3fbf5a';
      for (const [dx, h] of b) for (let wy = y + 80 - h; wy < y + 60; wy += 26) g.fillRect(x + dx - 8, wy, 18, 12);
    },
  },
];

export const BLITZ_INDEX = MODES.findIndex((m) => m.id === 'blitz');
export const CHIP_W = 0.046;
export const CHIP_H = 0.022;
/** 10s Blitz round lengths (0 = endless) */
export const BLITZ_TIMES = [10, 15, 30, 60, 0];
export const blitzLabel = (t: number) => (t === 0 ? 'ENDLESS' : t >= 60 ? `${t / 60} MIN` : `${t}s`);

export class ModeMenu {
  readonly root = new Group();
  readonly cards: Mesh[] = [];
  /** round-length switch on the Blitz card (top-right corner) */
  readonly chip: Mesh;
  private chipCtx: CanvasRenderingContext2D;
  private chipTex: CanvasTexture;
  private chipInside = [false, false];
  private ctx: CanvasRenderingContext2D[] = [];
  private tex: CanvasTexture[] = [];
  private inside: boolean[][] = [];
  private v = new Vector3();
  private cool = 0;
  private t = 0;

  constructor() {
    this.root.name = 'ModeMenu';
    const geo = new PlaneGeometry(CARD_W, CARD_H);
    MODES.forEach((m, i) => {
      const c = document.createElement('canvas');
      c.width = CW;
      c.height = CH;
      const g = c.getContext('2d')!;
      const tex = new CanvasTexture(c);
      tex.colorSpace = SRGBColorSpace;
      const mesh = new Mesh(geo, new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
      mesh.name = `ModeCard-${m.id}`;
      mesh.renderOrder = 6;
      this.root.add(mesh);
      this.cards.push(mesh);
      this.ctx.push(g);
      this.tex.push(tex);
      this.inside.push([false, false]);
      void i;
    });
    const cc = document.createElement('canvas');
    cc.width = 256;
    cc.height = 122;
    this.chipCtx = cc.getContext('2d')!;
    this.chipTex = new CanvasTexture(cc);
    this.chipTex.colorSpace = SRGBColorSpace;
    this.chip = new Mesh(new PlaneGeometry(CHIP_W, CHIP_H), new MeshBasicMaterial({ map: this.chipTex, transparent: true, depthWrite: false }));
    this.chip.name = 'BlitzTimeChip';
    this.chip.renderOrder = 7;
    this.chip.position.set(CARD_W / 2 - CHIP_W / 2 + 0.008, CARD_H / 2 - CHIP_H / 2 + 0.004, 0.002);
    this.cards[BLITZ_INDEX].add(this.chip);
  }

  drawChip(seconds: number) {
    const g = this.chipCtx;
    g.clearRect(0, 0, 256, 122);
    g.fillStyle = '#ffcf3a';
    rr(g, 6, 6, 244, 110, 50);
    g.fill();
    g.fillStyle = '#1a1430';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '900 52px system-ui, sans-serif';
    g.fillText(`${blitzLabel(seconds)} \u25B8`, 128, 64);
    this.chipTex.needsUpdate = true;
  }

  /** redraw the cards (best scores change) */
  draw(bests: string[], locked: boolean[] = []) {
    MODES.forEach((m, i) => {
      const g = this.ctx[i];
      g.clearRect(0, 0, CW, CH);
      g.fillStyle = 'rgba(16,12,36,0.94)';
      rr(g, 10, 10, CW - 20, CH - 20, 48);
      g.fill();
      g.lineWidth = 12;
      g.strokeStyle = m.color;
      g.stroke();
      // icon disc
      g.fillStyle = m.color;
      g.beginPath();
      g.arc(CW / 2, 200, 140, 0, Math.PI * 2);
      g.fill();
      m.icon(g, CW / 2, 200);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#fff';
      g.font = '900 64px system-ui, "Arial Black", sans-serif';
      g.fillText(m.title, CW / 2, 400);
      g.font = '600 30px system-ui, sans-serif';
      g.fillStyle = '#d0caf5';
      m.lines.forEach((l, k) => g.fillText(l, CW / 2, 460 + k * 38));
      g.font = '800 34px system-ui, sans-serif';
      g.fillStyle = '#ffcf3a';
      g.fillText(m.id === 'campaign' ? bests[i] : `BEST ${bests[i]}`, CW / 2, 580);
      if (locked[i]) {
        g.fillStyle = 'rgba(10,8,20,0.78)';
        rr(g, 10, 10, CW - 20, CH - 20, 48);
        g.fill();
        g.fillStyle = '#fff';
        g.font = '900 120px system-ui, sans-serif';
        g.fillText('\u{1F512}', CW / 2, 250);
        g.font = '800 34px system-ui, sans-serif';
        g.fillText('Clear CAMPAIGN', CW / 2, 400);
        g.fillText('level 3 to unlock', CW / 2, 445);
      }
      this.tex[i].needsUpdate = true;
    });
  }

  /** Lay the cards out along the front edge of the city, facing the player. */
  layout(toWorld: (local: Vector3, out: Vector3) => Vector3, half: number, head: Vector3, scale: number) {
    const gap = 0.012;
    const n = this.cards.length;
    this.cards.forEach((c, i) => {
      const x = (i - (n - 1) / 2) * (CARD_W + gap) / scale;
      toWorld(this.v.set(x, 0.1 / scale, half + 0.045 / scale), c.position);
      c.position.y += Math.sin(this.t * 2 + i) * 0.003;
      c.lookAt(head);
    });
  }

  /** returns the mode a fingertip poked this frame, if any */
  update(dt: number, hands: HandData[]): GameMode | 'blitz-time' | null {
    this.t += dt;
    this.cool = Math.max(0, this.cool - dt);
    let picked: GameMode | 'blitz-time' | null = null;
    // the time chip wins over the card underneath it
    let onChip = false;
    for (let h = 0; h < hands.length; h++) {
      const hand = hands[h];
      let hit = false;
      if (hand.tracked) {
        for (let f = 1; f < 3; f++) {
          this.chip.worldToLocal(this.v.copy(hand.tips[f]));
          if (Math.abs(this.v.x) < CHIP_W / 2 + 0.004 && Math.abs(this.v.y) < CHIP_H / 2 + 0.004 && Math.abs(this.v.z) < 0.015) hit = true;
        }
      }
      if (hit) onChip = true;
      if (hit && !this.chipInside[h] && this.cool === 0) {
        picked = 'blitz-time';
        this.cool = 0.45;
      }
      this.chipInside[h] = hit;
    }
    this.cards.forEach((card, i) => {
      // gentle pulse so the menu reads as interactive
      const s = 1 + Math.sin(this.t * 3 + i) * 0.02;
      card.scale.set(s, s, 1);
      for (let h = 0; h < hands.length; h++) {
        const hand = hands[h];
        let hit = false;
        if (hand.tracked) {
          for (let f = 1; f < 3; f++) {
            card.worldToLocal(this.v.copy(hand.tips[f]));
            if (Math.abs(this.v.x) < CARD_W / 2 && Math.abs(this.v.y) < CARD_H / 2 && Math.abs(this.v.z) < 0.015) hit = true;
          }
        }
        if (i === BLITZ_INDEX && onChip) hit = false;
        if (hit && !this.inside[i][h] && this.cool === 0) {
          picked = MODES[i].id;
          this.cool = 0.8;
        }
        this.inside[i][h] = hit;
      }
    });
    return picked;
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
