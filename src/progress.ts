/**
 * Long-term progression ("a reason to come back"):
 *  - every game earns XP -> the kaiju levels up and gets a new title
 *  - levels unlock new claw skins
 *  - a daily challenge (same for everyone on a given day) with a streak counter
 * Everything is stored locally in localStorage.
 */

export interface RoundStats {
  game: 'campaign' | 'blitz' | 'heli' | 'missions' | 'rampage';
  damage: number;
  catches: number;
  cleared: number;
  cities: number;
  people: number;
  cars: number;
  tanks: number;
  newBest: boolean;
  /** Blitz round length in seconds (0 = endless) */
  seconds: number;
}

export interface Skin {
  id: string;
  name: string;
  level: number;
  skin: number;
  claw: number;
  rainbow?: boolean;
}

export const SKINS: Skin[] = [
  { id: 'jungle', name: 'Jungle Green', level: 1, skin: 0x2f6a3a, claw: 0xf1e6c8 },
  { id: 'lava', name: 'Lava Red', level: 2, skin: 0x9a2a1a, claw: 0xffc46a },
  { id: 'ice', name: 'Ice Blue', level: 4, skin: 0x3a7fb8, claw: 0xe8fbff },
  { id: 'toxic', name: 'Toxic Purple', level: 6, skin: 0x6a2f9a, claw: 0xb8ff6a },
  { id: 'gold', name: 'Royal Gold', level: 8, skin: 0xc89a2a, claw: 0xfff6d0 },
  { id: 'shadow', name: 'Shadow', level: 12, skin: 0x1c1c26, claw: 0xff3a3a },
  { id: 'rainbow', name: 'Rainbow', level: 15, skin: 0xff0000, claw: 0xffffff, rainbow: true },
];

const TITLES: [number, string][] = [
  [1, 'Baby Kaiju'],
  [3, 'Street Stomper'],
  [5, 'Block Buster'],
  [8, 'Skyline Smasher'],
  [12, 'City Crusher'],
  [16, 'Mega Kaiju'],
  [20, 'Legend of the Desk'],
];

interface Daily {
  text: string;
  check: (s: RoundStats) => boolean;
}

/** today's challenge, picked deterministically from the date (same for every player) */
export function dailyFor(date: Date): Daily {
  const key = date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
  let h = key;
  const rnd = () => {
    h = (h * 1103515245 + 12345) & 0x7fffffff;
    return h / 0x7fffffff;
  };
  rnd();
  const pick = Math.floor(rnd() * 7);
  const n = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  switch (pick) {
    case 0: {
      const v = n(45, 60) * 1000; // $45B..$60B in a 10-second Blitz
      return {
        text: `10s BLITZ: cause $${v / 1000}B of damage`,
        check: (s) => s.game === 'blitz' && s.seconds === 10 && s.damage >= v,
      };
    }
    case 1: {
      const v = n(10, 14);
      return { text: `HELI HUNT: catch ${v} helicopters`, check: (s) => s.game === 'heli' && s.catches >= v };
    }
    case 2: {
      const v = n(10, 14);
      return { text: `MISSIONS: clear ${v} missions`, check: (s) => s.game === 'missions' && s.cleared >= v };
    }
    case 3: {
      const v = n(12, 20) * 10;
      return { text: `Knock down ${v} people in one game`, check: (s) => s.people >= v };
    }
    case 4: {
      const v = n(2, 3);
      return { text: `RAMPAGE: flatten ${v} whole cities in one game`, check: (s) => s.game === 'rampage' && s.cities >= v };
    }
    case 5: {
      const v = n(25, 40);
      return { text: `Wreck ${v} cars in one game`, check: (s) => s.cars >= v };
    }
    default: {
      const v = n(12, 20);
      return { text: `Destroy ${v} tanks in one game`, check: (s) => s.tanks >= v };
    }
  }
}

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
const STORE = 'finger-kaiju-progress';

export interface RoundResult {
  xp: number;
  lines: string[];
  levelUp: boolean;
  unlocked: Skin[];
  dailyDone: boolean;
}

export class Progress {
  xp = 0;
  streak = 0;
  lastDaily = '';
  skin = 'jungle';
  games = 0;

  constructor() {
    try {
      const raw = localStorage.getItem(STORE);
      if (raw) Object.assign(this, JSON.parse(raw));
    } catch {
      /* storage unavailable */
    }
  }

  private save() {
    try {
      localStorage.setItem(STORE, JSON.stringify({ xp: this.xp, streak: this.streak, lastDaily: this.lastDaily, skin: this.skin, games: this.games }));
    } catch {
      /* storage unavailable */
    }
  }

  /** XP needed to go from level n to n+1 */
  static need(level: number) {
    return 150 + (level - 1) * 75;
  }

  get level() {
    let lv = 1;
    let xp = this.xp;
    while (lv < 30 && xp >= Progress.need(lv)) {
      xp -= Progress.need(lv);
      lv++;
    }
    return lv;
  }

  /** progress inside the current level, 0..1 */
  get levelFrac() {
    let lv = 1;
    let xp = this.xp;
    while (lv < 30 && xp >= Progress.need(lv)) {
      xp -= Progress.need(lv);
      lv++;
    }
    return lv >= 30 ? 1 : xp / Progress.need(lv);
  }

  get title() {
    let t = TITLES[0][1];
    for (const [lv, name] of TITLES) if (this.level >= lv) t = name;
    return t;
  }

  get daily() {
    return dailyFor(new Date());
  }

  get dailyDoneToday() {
    return this.lastDaily === dayKey(new Date());
  }

  /** current streak, counting yesterday's completion as still alive */
  get liveStreak() {
    const y = new Date();
    y.setDate(y.getDate() - 1);
    return this.lastDaily === dayKey(new Date()) || this.lastDaily === dayKey(y) ? this.streak : 0;
  }

  unlockedSkins() {
    return SKINS.filter((s) => s.level <= this.level);
  }

  currentSkin(): Skin {
    return this.unlockedSkins().find((s) => s.id === this.skin) ?? SKINS[0];
  }

  setSkin(id: string) {
    if (!this.unlockedSkins().some((s) => s.id === id)) return;
    this.skin = id;
    this.save();
  }

  /** score a finished round */
  finish(s: RoundStats): RoundResult {
    const before = this.level;
    const lines: string[] = [];
    let xp = 0;
    // damage is in $M; a strong 10 s Blitz (~$30B) is worth ~300 XP
    if (s.game === 'blitz') xp += Math.round(s.damage / (100 * Math.max(1, (s.seconds || 60) / 10)));
    else if (s.game === 'heli') xp += s.catches * 25;
    else if (s.game === 'missions') xp += s.cleared * 30;
    else xp += Math.round(s.damage / 300) + s.cities * 80;
    xp = Math.max(10, Math.min(600, xp));
    lines.push(`+${xp} XP`);
    if (s.newBest) {
      xp += 50;
      lines.push('+50 new record');
    }
    let dailyDone = false;
    if (!this.dailyDoneToday && this.daily.check(s)) {
      dailyDone = true;
      this.streak = this.liveStreak + 1;
      this.lastDaily = dayKey(new Date());
      const bonus = 150 + Math.min(10, this.streak - 1) * 25;
      xp += bonus;
      lines.push(`+${bonus} daily (streak ${this.streak})`);
    }
    this.xp += xp;
    this.games++;
    const after = this.level;
    const unlocked = SKINS.filter((k) => k.level > before && k.level <= after);
    this.save();
    return { xp, lines, levelUp: after > before, unlocked, dailyDone };
  }
}
