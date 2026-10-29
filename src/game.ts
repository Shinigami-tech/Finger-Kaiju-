/**
 * Finger Kaiju game loop.
 * A Kenney-kit city sits on your real table. Smash it with your fingertips,
 * punch it, grab and rip buildings off the ground, crush them in your fist,
 * throw them, slam your palm for earthquakes, and survive tanks + helicopters.
 * Pinch with both hands and pull apart to zoom / rotate the whole city.
 */
import {
  AdditiveBlending,
  AnimationAction,
  AnimationClip,
  AnimationMixer,
  AssetManager,
  Color,
  ConeGeometry,
  CanvasTexture,
  CylinderGeometry,
  createSystem,
  DirectionalLight,
  Entity,
  EnvironmentRaycastTarget,
  InputComponent,
  RaycastSpace,
  RingGeometry,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  LoopOnce,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Pressed,
  Quaternion,
  RayInteractable,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  VisibilityState,
  XRPlane,
} from '@iwsdk/core';
import { buildHelicopter, buildTank } from './city-builder.js';
import { Fx, Sfx } from './fx.js';
import { Building, ModeCard, RestartOrb, Tank, Vehicle } from './game-components.js';
import { BLITZ_TIMES, blitzLabel, GameMode, MODES, ModeMenu } from './menu.js';
import { HandData, HandTracker } from './hands.js';
import { DayCycle } from './daycycle.js';
import { Coach, Hud, HudState, money, Ticker } from './hud.js';
import { Progress, RoundResult, SKINS } from './progress.js';
import { mountDesktopSettings, setSkinLabeler, Settings, SettingsBoard, SettingValues } from './settings.js';
import {
  buildKitCity,
  GROUND,
  KitCity,
  KitLot,
  THEMES,
  CarProto,
  CharProto,
  EMERGENCY,
  HALF,
  RING,
  ROAD_LINES,
  sirenBlueMat,
  sirenOffMat,
  sirenRedMat,
  spawnCar,
  spawnChar,
  TILE,
} from './kit-city.js';
import { MonsterHands } from './monster-hands.js';
import { Bubble } from './bubble.js';
import { BoardState, CampaignSave, CampaignUi, LEVELS, UiPick } from './campaign.js';
import { formForLevel, Hero } from './hero.js';
import { Ruins } from './ruins.js';
import { kitAssetId } from './kit-manifest.js';
import { CALM_MUSIC_ID, MUSIC_ID, SFX_FILES, sfxAssetId } from './sfx-manifest.js';

type Mode = HudState['mode'];
type Side = 'left' | 'right';

/** ?round=SECONDS overrides the settings (handy for testing) */
const ROUND_OVERRIDE = (() => {
  const v = Number(new URLSearchParams(location.search).get('round'));
  return v > 0 ? v : 0;
})();
const DIFFICULTY = {
  easy: { dmg: 4, tanks: 4, spawn: 1.5, heli: 30, fire: 1.5 },
  normal: { dmg: 8, tanks: 6, spawn: 1, heli: 18, fire: 1 },
  hard: { dmg: 12, tanks: 6, spawn: 0.65, heli: 9, fire: 0.65 },
};
const SKY = { cycle: -1, day: 0, sunset: 0.5, night: 1 };
const SINK = 1.2; // seconds the old ruins take to sink away
const GROW = 2.6; // seconds over which the new city grows
const TIP_R = 0.009; // world meters
const GRAB_R = 0.03; // world meters
const GRAVITY = 2.4; // world m/s^2
const BEST_KEY = 'finger-kaiju-best';
const SIDES: Side[] = ['left', 'right'];

interface Shell {
  mesh: Mesh;
  v: Vector3;
  life: number;
  active: boolean;
}
interface Collapse {
  obj: Object3D;
  t: number;
  tilt: number;
}
interface Car {
  obj: Object3D;
  axis: 'x' | 'z';
  line: number;
  pos: number;
  speed: number;
  state: 'drive' | 'held' | 'thrown' | 'dead';
  respawn: number;
  emergency: boolean;
  police: boolean;
  sirens: Mesh[];
}
interface Person {
  obj: Object3D;
  mixer: AnimationMixer;
  actions: Record<string, AnimationAction | undefined>;
  current: string;
  /** sidewalk graph node we came from / are walking to */
  fx: number;
  fz: number;
  tx: number;
  tz: number;
  yaw: number;
  state: 'walk' | 'idle' | 'down' | 'getup';
  stateT: number;
  speed: number;
  scared: number;
  jumpT: number;
  vx: number;
  vz: number;
}
interface Heli {
  obj: Object3D;
  /** Heli Hunt: flees from your hand */
  evasive: boolean;
  speed: number;
  angle: number;
  alt: number;
  state: 'off' | 'fly' | 'held' | 'thrown';
  cd: number;
  vel: Vector3;
  goal: Vector3;
  goalT: number;
  yaw: number;
  bank: number;
  pitch: number;
}
type MissionId = 'glow' | 'tanks' | 'heli' | 'hands' | 'people' | 'count' | 'cars';
interface Mission {
  id: MissionId;
  text: string;
  t: number;
  max: number;
  need: number;
  progress: number;
  targets: Entity[];
  result: 'win' | 'fail' | null;
}
interface Wobble {
  obj: Object3D;
  e: Entity;
  t: number;
  amp: number;
  phase: number;
}
/** Sidewalk lines: both sides of every road. People walk on this 10x10 grid graph. */
const SIDEWALK = ROAD_LINES.flatMap((l) => [l - TILE * 0.45, l + TILE * 0.45]);
const SW_N = SIDEWALK.length;
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
type Ref =
  | { kind: 'building'; e: Entity }
  | { kind: 'tank'; e: Entity }
  | { kind: 'car'; car: Car }
  | { kind: 'heli'; heli: Heli };
interface Held {
  ref: Ref;
  obj: Object3D;
  offset: Vector3;
  crushT: number;
  size: number;
  value: number;
  palette: number[];
}
interface Flying {
  ref: Ref;
  obj: Object3D;
  v: Vector3;
  spin: Vector3;
  size: number;
  value: number;
  palette: number[];
}
interface BuildingInfo {
  pos: Vector3;
  rotY: number;
  palette: number[];
  glass: boolean;
  depth: number;
  lot: KitLot;
}
interface Rebuild {
  t: number;
  theme: number;
  bonus: boolean;
  swapped: boolean;
  order: { e: Entity; start: number; popped: boolean; done: boolean }[];
  from: Color[];
  to: Color[];
  /** only sink the city away (Heli Hunt), don't grow a new one */
  vanish: boolean;
}

export class GameSystem extends createSystem({
  buildings: { required: [Building] },
  pressedBuildings: { required: [Building, Pressed] },
  tanks: { required: [Tank] },
  pressedTanks: { required: [Tank, Pressed] },
  pressedOrb: { required: [RestartOrb, Pressed] },
  pressedVehicles: { required: [Vehicle, Pressed] },
  pressedCards: { required: [ModeCard, Pressed] },
  planes: { required: [XRPlane] },
}) {
  private hands = new HandTracker();
  private fx = new Fx();
  private sfx = new Sfx();
  private hud = new Hud();
  private ticker = new Ticker();
  private ruins = new Ruins();
  private monster = new MonsterHands();
  private day!: DayCycle;
  private hitStopT = 0;
  /* ---- campaign ---- */
  private hero!: Hero;
  private bubble = new Bubble();
  private cui = new CampaignUi();
  private csave = new CampaignSave();
  private sun!: DirectionalLight;
  private sunTarget = new Object3D();
  /** where the city sits on the real table (world) and which way it faces */
  private anchor = new Vector3(0, 0.72, -0.62);
  private anchorYaw = 0;
  private qYaw = new Quaternion();
  private zoomT = 1;
  private zoomV = 1;
  private focus = new Vector3();
  private heroPos = new Vector3();
  private reticle!: Mesh;
  private reticleEntity!: Entity;
  private placing = false;
  private pinchZoom: { d0: number; z0: number } | null = null;
  private seeds: { mesh: Mesh; pos: Vector3; active: boolean; roof: Entity | null }[] = [];
  private golden!: { mesh: Mesh; pos: Vector3; active: boolean; life: number };
  private policeCd = new Map<Car, number>();
  private camp = {
    phase: 'off' as 'off' | 'select' | 'intro' | 'play' | 'won' | 'lost',
    level: 0,
    hurt: 0,
    stars: 0,
    shown: 0,
    revealT: 0,
    reason: '',
    newForm: '',
    progress: { marked: 0, buildings: 0, cars: 0, tanks: 0 },
    targets: [] as Entity[],
    hits: new Map<number, number>(),
    stepT: 0,
    tooBigT: 0,
    tankT: 0,
    goTo: null as Vector3 | null,
    goEntity: null as Entity | null,
    /** a car or tank to chase and punch */
    goActor: null as Object3D | null,
    carry: null as Side | null,
    path: [] as Vector3[],
    blockT: 0,
    held: null as { car?: Car; tank?: Entity; obj: Object3D } | null,
    chewT: 0,
    crumbT: 0,
    autoChew: false,
    throws: [] as { held: { car?: Car; tank?: Entity; obj: Object3D }; v: Vector3; spin: Vector3 }[],
    seeds: 0,
    powerT: 0,
    godT: 0,
    godSpawnAt: 25,
    godDone: false,
    heliT: 8,
    prevMode: 'rampage' as GameMode,
  };
  /** dev/testing: pin the time of day (null = follow the round) */
  dayLock: number | null = null;
  /** dev/testing: city-local point the desktop camera looks at */
  debugLook: Vector3 | null = null;
  /** dev/testing: virtual stick + punch for scripted campaign tests */
  testInput: { x: number; y: number; punch?: boolean; run?: boolean; grab?: boolean; chew?: boolean; jump?: boolean } | null = null;
  /** dev/testing: ?campaign=N jumps straight into campaign level N */
  private autoLevel = (() => {
    if (!import.meta.env.DEV) return -1;
    const v = new URLSearchParams(location.search).get('campaign');
    return v ? Math.max(0, Math.min(LEVELS.length - 1, Number(v) - 1)) : -1;
  })();
  /** dev/testing: hand data is written by a test script instead of WebXR */
  fakeHands = false;
  private newsFlags = new Set<string>();
  private city!: Group;
  private cityEntity!: Entity;
  private orb!: Mesh;
  private orbEntity!: Entity;
  private info = new Map<number, BuildingInfo>();
  private collapses: Collapse[] = [];
  private shells: Shell[] = [];
  private flying: Flying[] = [];
  private held: Record<Side, Held | null> = { left: null, right: null };
  private cars: Car[] = [];
  private people: Person[] = [];
  private wobbles: Wobble[] = [];
  private debugCam: Vector3 | null = (() => {
    if (!import.meta.env.DEV) return null;
    const m = /[?&]cam=([-\d.]+),([-\d.]+),([-\d.]+)/.exec(location.search);
    return m ? new Vector3(+m[1], +m[2], +m[3]) : null;
  })();
  private shakeT = 0;
  private shakeAmp = 0;
  private shakeOff = new Vector3();
  private carHop = new Map<Car, number>();
  private heli: Heli | null = null;
  private tipMarkers: Mesh[] = [];
  private tipMat = new MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.9 });

  private mode: Mode = 'loading';
  private ready = false;
  private placed = false;
  private searchT = 0;
  private time = 90;
  private settings = new Settings();
  private board = new SettingsBoard(this.settings);
  private desktopUi: { isOpen: () => boolean } | null = null;
  private kit: KitCity | null = null;
  private wave = 1;
  private theme = 0;
  private rebuild: Rebuild | null = null;
  private paused = false;
  private diff = DIFFICULTY.normal;
  private menu = new ModeMenu();
  private coach = new Coach();
  private progress = new Progress();
  private lastResult: RoundResult | null = null;
  private stat = { people: 0, cars: 0, tanks: 0, cities: 0 };
  /** which moves the player has discovered this session (drives the tip nudges) */
  private used = { grab: false, quake: false, crush: false };
  private tipsShown = new Set<string>();
  private newBest = false;
  private game: GameMode = 'rampage';
  private pendingStart = false;
  private countdown = 0;
  private catches = 0;
  private heliRespawnT = 0;
  private lives = 3;
  private cleared = 0;
  private mission: Mission | null = null;
  private missionLevel = 0;
  private missionGap = 0;
  private lastMission = '';
  private markers: Mesh[] = [];
  private bests: Record<GameMode, number> = { campaign: 0, blitz: 0, heli: 0, missions: 0, rampage: 0 };
  private elapsed = 0;
  private damage = 0;
  private best = 0;
  private hp = 100;
  private combo = 0;
  private lastSmash = -10;
  private destroyed = 0;
  private total = 0;
  private totalValue = 0;
  private spawnT = 8;
  private heliT = 18;
  private overT = 0;
  private hurtT = 0;
  private slamCd: Record<Side, number> = { left: 0, right: 0 };
  private zoom: { d0: number; s0: number; a0: number; r0: number } | null = null;
  private title = '';
  private grade = '';
  private now = 0;
  private wasImmersive = false;
  private tipCount = 0;
  private tipSide: Side[] = [];

  private a = new Vector3();
  private b = new Vector3();
  private c = new Vector3();
  private head = new Vector3();
  private q = new Quaternion();
  private c3 = new Color();
  private qi = new Quaternion();
  private localTips: Vector3[] = [];

  init(): void {
    for (const m of MODES) {
      try {
        const legacy = m.id === 'rampage' ? localStorage.getItem(BEST_KEY) : null;
        this.bests[m.id] = Number(localStorage.getItem(`${BEST_KEY}-${m.id}`) ?? legacy ?? 0) || 0;
      } catch {
        this.bests[m.id] = 0;
      }
    }
    this.best = this.bests.rampage;
    for (let i = 0; i < 14; i++) {
      this.localTips.push(new Vector3());
      this.tipSide.push('left');
    }

    const renderer = this.world.renderer;
    renderer.shadowMap.enabled = true;
    // Software-rendered emulator sessions (IWER) get a lighter framebuffer.
    if ((window as unknown as { IWER_DEVICE?: unknown }).IWER_DEVICE) renderer.xr.setFramebufferScaleFactor(0.35);

    this.city = new Group();
    this.city.name = 'FingerKaijuCity';
    this.cityEntity = this.world.createTransformEntity(this.city);
    this.city.add(this.fx.root);

    const sun = new DirectionalLight(0xfff1d6, 2.4);
    sun.position.set(0.6, 0.9, 0.4);
    sun.target = this.sunTarget;
    this.city.add(this.sunTarget);
    this.sun = sun;
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.0015;
    Object.assign(sun.shadow.camera, { left: -0.5, right: 0.5, top: 0.5, bottom: -0.5, near: 0.1, far: 3 });
    this.city.add(sun);
    const hemi = new HemisphereLight(0xe3ecff, 0x6b5a48, 1.0);
    this.city.add(hemi);
    this.day = new DayCycle(sun, hemi);
    this.city.add(this.day.root);
    this.city.add(this.ruins.root);
    this.city.add(this.monster.shadows);
    this.world.createTransformEntity(this.monster.root);

    // campaign hero, diorama rim, campaign UI, placement reticle
    this.hero = new Hero((id) => AssetManager.loadGLTFById(id));
    this.city.add(this.hero.root);
    this.world.createTransformEntity(this.bubble.rim);
    const cuiEntity = this.world.createTransformEntity(this.cui.root);
    this.cui.buttons.forEach((b, k) => {
      const be = this.world.createTransformEntity(b.plane.mesh, { parent: cuiEntity });
      be.addComponent(ModeCard, { index: 400 + k });
      be.addComponent(RayInteractable);
    });
    this.reticle = new Mesh(
      new RingGeometry(0.03, 0.04, 40).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({ color: 0x6fe08a, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    this.reticle.name = 'PlaceReticle';
    this.reticle.visible = false;
    this.reticleEntity = this.world.createTransformEntity(this.reticle);
    // sunflower seeds (striped) + the rare golden seed
    const seedCanvas = document.createElement('canvas');
    seedCanvas.width = 64;
    seedCanvas.height = 16;
    const sg = seedCanvas.getContext('2d')!;
    sg.fillStyle = '#2b2622';
    sg.fillRect(0, 0, 64, 16);
    sg.fillStyle = '#e9e2cf';
    for (let k = 0; k < 8; k++) sg.fillRect(k * 8 + 2, 0, 2, 16);
    const seedTex = new CanvasTexture(seedCanvas);
    seedTex.colorSpace = SRGBColorSpace;
    const seedGeo = new SphereGeometry(1, 14, 10);
    seedGeo.scale(0.0026, 0.0018, 0.0048);
    const seedMat = new MeshStandardMaterial({ map: seedTex, roughness: 0.55 });
    for (let k = 0; k < 16; k++) {
      const m = new Mesh(seedGeo, seedMat);
      m.castShadow = true;
      m.visible = false;
      m.rotation.x = 0.5;
      this.city.add(m);
      this.seeds.push({ mesh: m, pos: new Vector3(), active: false, roof: null });
    }
    const gm = new Mesh(seedGeo, new MeshStandardMaterial({ color: 0xffcf3a, emissive: 0xffa000, emissiveIntensity: 1.1, metalness: 0.6, roughness: 0.25 }));
    gm.scale.setScalar(1.8);
    const halo = new Mesh(new SphereGeometry(0.009, 16, 10), new MeshBasicMaterial({ color: 0xffd860, transparent: true, opacity: 0.35, blending: AdditiveBlending, depthWrite: false }));
    gm.add(halo);
    halo.scale.set(1 / 0.0026 * 0.0048, 1 / 0.0018 * 0.0048, 1);
    gm.visible = false;
    this.city.add(gm);
    this.golden = { mesh: gm, pos: new Vector3(), active: false, life: 0 };

    // shells
    const shellGeo = new SphereGeometry(0.0035, 10, 8);
    const shellMat = new MeshBasicMaterial({ color: 0xff7a1a });
    const glowMat = new MeshBasicMaterial({ color: 0xffb340, transparent: true, opacity: 0.45, blending: AdditiveBlending, depthWrite: false });
    for (let i = 0; i < 20; i++) {
      const mesh = new Mesh(shellGeo, shellMat);
      const glow = new Mesh(shellGeo, glowMat);
      glow.scale.setScalar(2.2);
      mesh.add(glow);
      mesh.visible = false;
      this.city.add(mesh);
      this.shells.push({ mesh, v: new Vector3(), life: 0, active: false });
    }

    // tanks
    for (let i = 0; i < 6; i++) {
      const t = buildTank();
      t.name = 'Tank';
      t.visible = false;
      const e = this.world.createTransformEntity(t, { parent: this.cityEntity });
      e.addComponent(Tank, { alive: false });
      e.addComponent(RayInteractable);
    }

    // helicopter
    const ho = buildHelicopter();
    ho.name = 'Helicopter';
    ho.visible = false;
    this.heli = {
      obj: ho,
      evasive: false,
      speed: 1,
      angle: 0,
      alt: 0.3,
      state: 'off',
      cd: 3,
      vel: new Vector3(),
      goal: new Vector3(),
      goalT: 0,
      yaw: 0,
      bank: 0,
      pitch: 0,
    };
    ho.rotation.order = 'YXZ';

    // HUD + restart orb
    this.world.createTransformEntity(this.hud.mesh);
    this.world.createTransformEntity(this.ticker.mesh);
    this.world.createTransformEntity(this.coach.mesh);
    this.orb = new Mesh(
      new IcosahedronGeometry(0.022, 2),
      new MeshStandardMaterial({ color: 0xff5a36, emissive: 0xff7a3a, emissiveIntensity: 1.2, roughness: 0.3 }),
    );
    this.orb.name = 'RestartOrb';
    this.orb.position.set(0, 0.1, HALF + 0.07);
    this.orbEntity = this.world.createTransformEntity(this.orb, { parent: this.cityEntity });
    this.orbEntity.addComponent(RayInteractable);
    this.orbEntity.addComponent(RestartOrb);
    this.orb.visible = false;

    // fingertip markers
    const tipGeo = new SphereGeometry(0.005, 12, 8);
    const tipGroup = new Group();
    tipGroup.name = 'FingertipMarkers';
    for (let i = 0; i < 10; i++) {
      const m = new Mesh(tipGeo, this.tipMat);
      m.visible = false;
      tipGroup.add(m);
      this.tipMarkers.push(m);
    }
    tipGroup.visible = false; // replaced by MonsterHands, kept for the hurt/zoom colour state
    this.world.createTransformEntity(tipGroup);

    this.placeCity(new Vector3(0, 0.72, -0.62), false);

    // ---- interactions ----
    if (import.meta.env.DEV) Object.assign(window, { __fk: this, __fkC: { Building, Tank } }); // dev-only debug handles
    this.cleanupFuncs.push(
      this.queries.pressedBuildings.subscribe('qualify', (e) => {
        this.sfx.unlock();
        if (!this.canScore() || (this.camp.phase !== 'off' && this.camp.godT <= 0)) return;
        const o = e.object3D;
        if (o) this.smash(e, this.a.copy(o.position).setY(o.position.y + 0.02), 1.2, 1);
      }),
      this.queries.pressedTanks.subscribe('qualify', (e) => {
        this.sfx.unlock();
        if (this.camp.phase !== 'off' && this.camp.godT <= 0) return;
        if (e.getValue(Tank, 'alive')) this.killTank(e, 60, 'TANK!');
      }),
      this.queries.pressedOrb.subscribe('qualify', () => this.restart()),
      this.queries.pressedCards.subscribe('qualify', (e) => {
        this.sfx.unlock();
        const i = e.getValue(ModeCard, 'index') ?? 0;
        if (i >= 400) {
          const b = this.cui.buttons[i - 400];
          if (b && b.enabled && b.plane.mesh.visible) this.onCampaignPick(b.pick);
          return;
        }
        if (this.camp.phase !== 'off') return;
        this.onMenuPick(i === 99 ? 'blitz-time' : MODES[i].id);
      }),
      this.queries.pressedVehicles.subscribe('qualify', (e) => {
        this.sfx.unlock();
        if (!this.canScore() || (this.camp.phase !== 'off' && this.camp.godT <= 0)) return;
        const i = e.getValue(Vehicle, 'index') ?? 0;
        if (i < 0) {
          if (this.heli?.evasive) this.catchHeli();
          else this.swatHeli(this.a.set((Math.random() - 0.5) * 0.4, 0.2, (Math.random() - 0.5) * 0.4));
        }
        else {
          const car = this.cars[i];
          if (car && car.state === 'drive') this.wreckCar(car, this.a.copy(car.obj.position).setY(0.03));
        }
      }),
      this.onKey(),
      this.queries.planes.subscribe('qualify', (e) => this.considerPlane(e)),
      this.world.visibilityState.subscribe((vs) => {
        const immersive = vs !== VisibilityState.NonImmersive;
        const panel = this.world.getSceneObject('welcome-panel');
        if (panel) panel.visible = !immersive;
        if (immersive && !this.wasImmersive) this.onEnterXR();
        if (!immersive && this.wasImmersive) this.onExitXR();
        this.wasImmersive = immersive;
      }),
    );
    const unlock = () => this.sfx.unlock();
    renderer.domElement.addEventListener('pointerdown', unlock);
    this.cleanupFuncs.push(() => renderer.domElement.removeEventListener('pointerdown', unlock));

    // game-mode menu cards (+ Blitz time switch), clickable on desktop
    this.menu.cards.forEach((card, i) => {
      const ce = this.world.createTransformEntity(card);
      ce.addComponent(ModeCard, { index: i });
      ce.addComponent(RayInteractable);
      if (MODES[i].id === 'blitz') {
        const chip = this.world.createTransformEntity(this.menu.chip, { parent: ce });
        chip.addComponent(ModeCard, { index: 99 });
        chip.addComponent(RayInteractable);
      }
    });
    this.refreshMenu();
    // mission target beacons
    const beamGeo = new CylinderGeometry(0.006, 0.012, 0.12, 10, 1, true);
    const beamMat = new MeshBasicMaterial({ color: 0x5ff0ff, transparent: true, opacity: 0.45, blending: AdditiveBlending, depthWrite: false });
    const arrowGeo = new ConeGeometry(0.009, 0.016, 4);
    const arrowMat = new MeshBasicMaterial({ color: 0x5ff0ff });
    for (let i = 0; i < 8; i++) {
      const beam = new Mesh(beamGeo, beamMat);
      const arrow = new Mesh(arrowGeo, arrowMat);
      arrow.rotation.x = Math.PI;
      arrow.position.y = 0.075;
      beam.add(arrow);
      beam.visible = false;
      this.city.add(beam);
      this.markers.push(beam);
    }

    // settings
    this.world.createTransformEntity(this.board.root);
    try {
      this.desktopUi = mountDesktopSettings(this.settings);
    } catch {
      this.desktopUi = null;
    }
    this.settings.onResetBest = () => {
      this.best = 0;
      for (const m of MODES) {
        this.bests[m.id] = 0;
        try {
          localStorage.removeItem(`${BEST_KEY}-${m.id}`);
          localStorage.removeItem(BEST_KEY);
        } catch {
          /* storage unavailable */
        }
      }
      this.refreshMenu();
    };
    // claw skins unlock with the kaiju's level
    this.settings.allowed = (key, v) => key !== 'skin' || this.progress.unlockedSkins().some((k) => k.id === v);
    setSkinLabeler((id) => {
      const k = SKINS.find((x) => x.id === id);
      if (!k) return id;
      return k.level <= this.progress.level ? k.name.toUpperCase() : `LOCKED (LV ${k.level})`;
    });
    this.settings.onChange((v, changed) => this.applySettings(v, changed));
    this.settings.onQuit = () => {
      if (this.mode === 'playing') this.endRound('GAME ENDED');
    };

    void this.loadContent();
  }

  private roundTime() {
    return ROUND_OVERRIDE || this.settings.values.round;
  }

  /** seconds on the clock for the current game mode (Infinity = no clock) */
  private modeTime() {
    if (this.game === 'campaign') return LEVELS[this.camp.level].limit;
    if (this.game === 'blitz') return this.settings.values.blitz || Infinity;
    if (this.game === 'heli') return 30;
    if (this.game === 'missions') return Infinity;
    return this.roundTime() || Infinity;
  }

  private bestText(m: GameMode) {
    if (m === 'campaign') return `\u2605 ${this.csave.total} / ${LEVELS.length * 3}`;
    const b = this.bests[m];
    if (m === 'heli') return `${b} caught`;
    if (m === 'missions') return `${b} cleared`;
    return money(b);
  }

  private refreshMenu() {
    this.menu.draw(
      MODES.map((m) => this.bestText(m.id)),
      MODES.map((m) => m.id !== 'campaign' && this.modesLocked()),
    );
  }

  /* ---------------- game modes ---------------- */
  /** the classic modes open up once campaign level 3 has a star */
  private modesLocked() {
    return this.csave.stars[2] === 0 && !new URLSearchParams(location.search).has('unlockall');
  }

  private onMenuPick(pick: GameMode | 'blitz-time') {
    if (pick === 'campaign') {
      if (this.menuOpen()) this.openCampaignSelect();
      return;
    }
    if (pick !== 'blitz-time' && this.modesLocked()) {
      if (!this.menuOpen()) return;
      this.sfx.ouch();
      this.ticker.push('LOCKED: clear CAMPAIGN level 3 to unlock the classic modes', true);
      return;
    }
    if (pick === 'blitz-time') {
      const i = BLITZ_TIMES.indexOf(this.settings.values.blitz);
      this.settings.set('blitz', BLITZ_TIMES[(i + 1) % BLITZ_TIMES.length]);
      this.sfx.combo(2);
      return;
    }
    if (!this.menuOpen()) return;
    this.game = pick;
    this.sfx.start();
    const needRegrow = this.destroyed > 0 || this.cityGone || this.ruins.burning > 0;
    // start the transition first so the reset below doesn't pop the old city back up
    if (pick === 'heli') {
      // the city sinks away: only you and the chopper are left
      this.startRebuild(this.theme, false, true);
    } else if (needRegrow) {
      this.startRebuild(Math.floor(Math.random() * THEMES.length), false);
    }
    this.resetRound(false);
    this.cityGone = pick === 'heli';
    this.pendingStart = true;
    const m = MODES.find((x) => x.id === pick)!;
    this.ticker.push(`${m.title}: ${m.lines.join(' ')}`, true);
  }

  private cityGone = false;

  private menuOpen() {
    return !this.pendingStart && !this.rebuild && ((this.mode === 'ready' && this.ready) || (this.mode === 'over' && this.overT > 1.5));
  }

  /** How-to-play card for the chosen mode (the first 3 times each mode is played). */
  private showCoach() {
    const xr = this.wasImmersive;
    const key = `finger-kaiju-coach-${this.game}`;
    let seen = 0;
    try {
      seen = Number(localStorage.getItem(key) ?? 0) || 0;
      localStorage.setItem(key, String(seen + 1));
    } catch {
      /* storage unavailable */
    }
    if (seen >= 3) return;
    const tips: Record<GameMode, [string, string][]> = xr
      ? {
          campaign: [
            ['1', 'LEFT STICK walk  |  A punch  |  B jump on roofs'],
            ['2', 'X: GRAB a car, hold X to GNAW, A to THROW'],
            ['3', 'Eat seeds. GOLDEN seed = 15 s GOD MODE'],
          ],
          blitz: [
            ['1', 'TOUCH or PUNCH buildings to smash them'],
            ['2', 'SLAM your palm on the table = earthquake'],
            ['3', 'Keep hitting fast for COMBO x5'],
          ],
          heli: [
            ['1', 'PINCH or GRAB the helicopter'],
            ['2', '...or SWAT it out of the air'],
            ['3', 'It dodges your fingers: corner it!'],
          ],
          missions: [
            ['1', 'Read the order on the scoreboard'],
            ['2', 'Finish it before the bar runs out'],
            ['3', '3 lives. Some orders are traps!'],
          ],
          rampage: [
            ['1', 'PINCH a building to rip it off & THROW it'],
            ['2', 'SQUEEZE your fist to CRUSH what you hold'],
            ['3', 'Hit the tanks before they hit you'],
          ],
        }
      : {
          campaign: [
            ['1', 'WASD walk (SHIFT run)  |  SPACE jump on roofs'],
            ['2', 'E grab a car, hold E gnaw, J punch / throw'],
            ['3', '+ / - zoom  |  eat seeds, find the GOLDEN one'],
          ],
          blitz: [
            ['1', 'CLICK buildings to smash them'],
            ['2', 'Press SPACE for an earthquake'],
            ['3', 'Keep hitting fast for COMBO x5'],
          ],
          heli: [
            ['1', 'CLICK the helicopter to catch it'],
            ['2', 'Every catch makes it faster'],
            ['3', 'Best played with hands in a Quest!'],
          ],
          missions: [
            ['1', 'Read the order on the scoreboard'],
            ['2', 'CLICK things, SPACE = earthquake'],
            ['3', '3 lives. Some orders are traps!'],
          ],
          rampage: [
            ['1', 'CLICK buildings, cars and tanks'],
            ['2', 'Press SPACE for an earthquake'],
            ['3', 'Destroy everything for a NEW CITY'],
          ],
        };
    this.coach.show('HOW TO PLAY', tips[this.game], 8);
  }

  /** gentle one-time hints for moves the player hasn't discovered yet */
  private updateNudges() {
    if (this.mode !== 'playing' || this.countdown > 0 || this.rebuild) return;
    if (this.game !== 'rampage' && !(this.game === 'blitz' && (this.settings.values.blitz === 0 || this.settings.values.blitz >= 30))) return;
    const xr = this.wasImmersive;
    const tip = (id: string, at: number, cond: boolean, text: string) => {
      if (!cond || this.elapsed < at || this.tipsShown.has(id)) return;
      this.tipsShown.add(id);
      this.coach.show('TIP', [['!', text]], 4.5);
      this.sfx.combo(3);
    };
    if (xr) {
      tip('quake', 12, !this.used.quake, 'SLAM your palm on the table: EARTHQUAKE!');
      tip('grab', 22, !this.used.grab, 'PINCH a building to rip it off, then THROW');
      tip('crush', 34, this.used.grab && !this.used.crush, 'While holding: SQUEEZE your fist to CRUSH');
    } else {
      tip('quake', 8, !this.used.quake, 'Press SPACE for an EARTHQUAKE!');
    }
  }

  /** called when the 3-2-1 countdown finishes */
  private beginGame() {
    this.startPlaying();
    if (this.game === 'campaign') {
      this.camp.phase = 'play';
      this.ticker.push(`${LEVELS[this.camp.level].city}: ${LEVELS[this.camp.level].story.toUpperCase()}`, true);
    }
    this.time = this.modeTime();
    if (this.game === 'heli') this.spawnHeli(true, 1);
    if (this.game === 'missions') {
      this.lives = 3;
      this.cleared = 0;
      this.missionLevel = 0;
      this.missionGap = 0.2;
    }
  }

  private spawnHeli(evasive: boolean, speed: number) {
    const h = this.heli;
    if (!h) return;
    h.state = 'fly';
    h.evasive = evasive;
    h.speed = speed;
    h.obj.visible = true;
    h.angle = Math.random() * Math.PI * 2;
    h.alt = evasive ? 0.12 : 0.26;
    h.cd = 3;
    h.obj.position.set(Math.cos(h.angle) * 0.55, h.alt + 0.05, Math.sin(h.angle) * 0.55);
    h.yaw = Math.atan2(Math.sin(h.angle), -Math.cos(h.angle));
    h.vel.set(-Math.cos(h.angle), 0, -Math.sin(h.angle)).multiplyScalar(0.12);
    h.goal.set(0, h.alt, 0);
    h.goalT = 0;
    this.sfx.zap();
  }

  /** Heli Hunt / mission: caught the chopper */
  private catchHeli() {
    const h = this.heli;
    if (!h || (h.state !== 'fly' && h.state !== 'held') || !this.canScore()) return;
    this.c.copy(h.obj.position);
    this.fx.spark(this.c, 24, 0.5, 0x9ef0ff);
    this.fx.puff(this.c, 0.01, 10);
    this.fx.ring(this.c.clone().setY(0.005), 0.08, 0x9ef0ff, 0.5);
    this.sfx.grab();
    this.sfx.combo(Math.min(8, this.catches + 2));
    h.state = 'off';
    h.obj.visible = false;
    for (const side of SIDES) if (this.held[side]?.ref.kind === 'heli') this.held[side] = null;
    this.flying = this.flying.filter((f) => f.ref.kind !== 'heli');
    this.c.y += 0.03;
    if (this.game === 'heli') {
      this.catches++;
      this.fx.popup(this.c, `CAUGHT! x${this.catches}`, '#9ef0ff');
      this.heliRespawnT = 0.9;
      if (this.catches % 3 === 0) this.ticker.push(`${this.catches} HELICOPTERS CAUGHT. Pilots demand a raise`, true);
    } else {
      this.fx.popup(this.c, 'CAUGHT!', '#9ef0ff');
      if (this.mission?.id === 'heli') this.mission.progress++;
    }
  }

  /* ---------------- missions ---------------- */
  private startMission() {
    const ids: MissionId[] = ['glow', 'tanks', 'heli', 'hands', 'people', 'count', 'cars'];
    let id = ids[Math.floor(Math.random() * ids.length)];
    if (id === this.lastMission) id = ids[(ids.indexOf(id) + 1) % ids.length];
    // the hands-off joke works best once the player is in a smashing rhythm
    if (id === 'hands' && this.missionLevel < 2) id = 'count';
    this.lastMission = id;
    const L = this.missionLevel;
    const speed = Math.max(0.55, 1 - L * 0.06);
    const alive = [...this.queries.buildings.entities].filter((e) => e.getValue(Building, 'alive'));
    const m: Mission = { id, text: '', t: 0, max: 10, need: 1, progress: 0, targets: [], result: null };
    if (id === 'glow') {
      m.need = Math.min(7, 3 + Math.floor(L / 2), alive.length);
      for (let i = 0; i < m.need; i++) m.targets.push(alive.splice(Math.floor(Math.random() * alive.length), 1)[0]);
      m.text = `SMASH THE ${m.need} GLOWING BUILDINGS!`;
      m.max = 9 * speed + m.need * 0.3;
    } else if (id === 'tanks') {
      m.need = Math.min(5, 2 + Math.floor(L / 3));
      for (let i = 0; i < m.need; i++) this.spawnTank();
      m.text = `DESTROY ${m.need} TANKS!`;
      m.max = 12 * speed;
    } else if (id === 'heli') {
      this.spawnHeli(true, 1 + L * 0.08);
      m.text = 'CATCH THE HELICOPTER!';
      m.max = 11 * speed;
    } else if (id === 'hands') {
      m.text = "DON'T TOUCH THE CITY!";
      m.max = 4 + Math.random() * 2;
    } else if (id === 'people') {
      m.need = Math.min(this.people.length, 10 + L);
      m.text = `KNOCK DOWN ${m.need} PEOPLE! (slam the table)`;
      m.max = 9 * speed;
    } else if (id === 'count') {
      m.need = Math.min(alive.length, 6 + L);
      m.text = `DESTROY ${m.need} BUILDINGS!`;
      m.max = 9 * speed;
    } else {
      m.need = Math.min(this.cars.length, 3 + Math.floor(L / 2));
      m.text = `WRECK ${m.need} CARS!`;
      m.max = 10 * speed;
    }
    this.mission = m;
    this.ticker.push(`MISSION ${this.cleared + 1}: ${m.text}`, true);
    this.sfx.zap();
  }

  /** mission counters, fed by the game events */
  private missionEvent(kind: 'building' | 'tank' | 'car' | 'people' | 'touch', e?: Entity) {
    const m = this.mission;
    if (!m || m.result || this.game !== 'missions') return;
    if (m.id === 'hands' && kind !== 'people') {
      m.result = 'fail';
      return;
    }
    if (m.id === 'glow' && kind === 'building' && e && m.targets.includes(e)) m.progress++;
    if (m.id === 'count' && kind === 'building') m.progress++;
    if (m.id === 'tanks' && kind === 'tank') m.progress++;
    if (m.id === 'cars' && kind === 'car') m.progress++;
    if (m.id === 'people' && kind === 'people') m.progress++;
  }

  private updateMissions(dt: number) {
    if (this.game !== 'missions' || this.mode !== 'playing' || this.countdown > 0) return;
    // markers on the glowing targets
    let mi = 0;
    if (this.mission?.id === 'glow' && !this.mission.result) {
      for (const e of this.mission.targets) {
        if (mi >= this.markers.length) break;
        const o = e.object3D;
        if (!o || !e.getValue(Building, 'alive')) continue;
        const mk = this.markers[mi++];
        mk.visible = true;
        mk.scale.setScalar(1);
        mk.position.set(o.position.x, o.position.y + (e.getValue(Building, 'height') ?? 0.05) + 0.06 + Math.sin(this.now * 5) * 0.006, o.position.z);
        mk.rotation.y += dt * 3;
      }
    }
    for (; mi < this.markers.length; mi++) this.markers[mi].visible = false;

    if (!this.mission) {
      if (this.rebuild) return;
      this.missionGap -= dt;
      if (this.missionGap > 0) return;
      // running low on city? grow a fresh one between missions
      const alive = [...this.queries.buildings.entities].filter((e) => e.getValue(Building, 'alive')).length;
      if (alive < 30) {
        this.startRebuild((this.theme + 1) % THEMES.length, false);
        return;
      }
      this.startMission();
      return;
    }
    const m = this.mission;
    if (!m.result) {
      m.t += dt;
      if (m.id !== 'hands' && m.progress >= m.need) m.result = 'win';
      else if (m.t >= m.max) m.result = m.id === 'hands' ? 'win' : 'fail';
      if (!m.result) return;
    }
    // resolve
    this.c.set(0, 0.16, 0);
    if (m.result === 'win') {
      this.cleared++;
      this.missionLevel++;
      this.fx.popup(this.c, ['NICE!', 'GREAT!', 'MONSTROUS!', 'TOO EASY!'][this.cleared % 4], '#6fe08a');
      this.sfx.combo(Math.min(8, 2 + this.cleared));
      if (this.cleared % 5 === 0) this.sfx.roar(0.8);
    } else {
      this.lives--;
      this.fx.popup(this.c, m.id === 'hands' ? 'YOU TOUCHED IT!' : 'FAILED!', '#ff5a5a');
      this.sfx.ouch();
    }
    // tidy up the mission's actors
    if (m.id === 'heli' && this.heli && this.heli.state !== 'off') {
      this.heli.state = 'off';
      this.heli.obj.visible = false;
    }
    if (m.id === 'tanks') for (const e of this.queries.tanks.entities) if (e.getValue(Tank, 'alive') && !e.getValue(Tank, 'held')) this.hideTank(e);
    this.mission = null;
    this.missionGap = 1.4;
    if (this.lives <= 0) this.endRound('OUT OF LIVES');
  }

  private applySettings(v: SettingValues, changed: keyof SettingValues | null) {
    this.sfx.setVolumes(v.music, v.sfx);
    this.diff = DIFFICULTY[v.difficulty];
    const q = v.effects === 'low' ? 0.35 : v.effects === 'medium' ? 0.65 : 1;
    this.ruins.quality = q;
    this.fx.quality = q;
    this.monster.root.visible = v.claws;
    const skin = this.progress.unlockedSkins().find((k) => k.id === v.skin) ?? SKINS[0];
    this.monster.setSkin(skin.skin, skin.claw, skin.rainbow);
    this.monster.shadows.visible = v.shadows;
    this.ticker.enabled = v.news;
    const sky = SKY[v.sky];
    this.dayLock = sky < 0 ? null : sky;
    if (changed === 'sky' && sky >= 0) this.day.snap(sky);
    // a new round length applies right away while waiting to start
    if ((changed === 'round' || changed === 'blitz' || changed === null) && this.mode !== 'playing') this.time = this.modeTime();
    if (changed === 'blitz' || changed === null) this.menu.drawChip(v.blitz);
  }

  /* ---------------- loading ---------------- */
  private async loadContent() {
    const kit = await buildKitCity((key) => AssetManager.loadGLTFById(kitAssetId(key)));
    this.kit = kit;
    this.city.add(kit.root);
    this.day.setup(kit.lamps, kit.windowMats);
    for (const spec of kit.buildings) {
      spec.object.name = 'Building';
      const e = this.world.createTransformEntity(spec.object, { parent: this.cityEntity });
      e.addComponent(Building, {
        height: spec.height,
        width: Math.max(spec.width, spec.depth),
        value: spec.value,
        alive: true,
      });
      e.addComponent(RayInteractable);
      this.info.set(e.index, {
        pos: spec.object.position.clone(),
        rotY: spec.object.rotation.y,
        palette: spec.palette,
        glass: spec.glass,
        depth: spec.depth,
        lot: spec.lot,
      });
      this.total++;
      this.totalValue += spec.value;
    }
    this.spawnTraffic(kit.cars);
    this.spawnPeople(kit.chars);
    // the helicopter is clickable on desktop too
    if (this.heli) {
      const he = this.world.createTransformEntity(this.heli.obj, { parent: this.cityEntity });
      he.addComponent(Vehicle, { index: -1 });
      he.addComponent(RayInteractable);
    }
    this.ready = true;
    if (this.mode === 'loading') this.mode = this.wasImmersive && !this.placed ? 'searching' : 'ready';

    // audio loads in the background
    for (const name of SFX_FILES) {
      AssetManager.loadAudioById(sfxAssetId(name))
        .then((buf) => this.sfx.addSample(name, buf))
        .catch(() => undefined);
    }
    AssetManager.loadAudioById(MUSIC_ID)
      .then((buf) => this.sfx.setMusic('fight', buf))
      .catch(() => undefined);
    AssetManager.loadAudioById(CALM_MUSIC_ID)
      .then((buf) => this.sfx.setMusic('calm', buf))
      .catch(() => undefined);
  }

  private spawnTraffic(protos: CarProto[]) {
    if (protos.length === 0) return;
    const inner = ROAD_LINES.slice(1, -1);
    for (let i = 0; i < 16; i++) {
      const obj = spawnCar(protos[i % protos.length]);
      const ce = this.world.createTransformEntity(obj, { parent: this.cityEntity });
      ce.addComponent(Vehicle, { index: i });
      ce.addComponent(RayInteractable);
      const dir = i % 2 === 0 ? 1 : -1;
      this.cars.push({
        obj,
        axis: i % 4 < 2 ? 'x' : 'z',
        line: inner[i % inner.length] + dir * TILE * 0.2,
        pos: Math.random() * 2 - 1,
        speed: dir * (0.03 + Math.random() * 0.025),
        state: 'drive',
        respawn: 0,
        emergency: EMERGENCY.has(protos[i % protos.length].key),
        police: protos[i % protos.length].key === 'car/police',
        sirens: ['sirenR', 'sirenB'].map((n) => obj.getObjectByName(n)).filter((m): m is Mesh => !!m),
      });
    }
  }

  private spawnPeople(protos: CharProto[]) {
    if (protos.length === 0) return;
    for (let i = 0; i < 28; i++) {
      const proto = protos[i % protos.length];
      const obj = spawnChar(proto);
      this.city.add(obj);
      const mixer = new AnimationMixer(obj);
      const find = (n: string) => AnimationClip.findByName(proto.clips, n);
      const actions: Record<string, AnimationAction | undefined> = {};
      for (const n of ['walk', 'sprint', 'jump', 'idle', 'die', 'emote-yes', 'interact-right']) {
        const clip = find(n);
        if (clip) actions[n] = mixer.clipAction(clip);
      }
      for (const n of ['jump', 'die', 'emote-yes', 'interact-right']) {
        const a = actions[n];
        if (!a) continue;
        a.setLoop(LoopOnce, 1);
        a.clampWhenFinished = true;
      }
      actions.walk?.play();
      mixer.update(Math.random() * 2); // desync the walk cycles
      const fx = Math.floor(Math.random() * SW_N);
      const fz = Math.floor(Math.random() * SW_N);
      const p: Person = {
        obj,
        mixer,
        actions,
        current: 'walk',
        fx,
        fz,
        tx: fx,
        tz: fz,
        yaw: 0,
        state: 'walk',
        stateT: 0,
        speed: 0.011 + Math.random() * 0.006,
        scared: 0,
        jumpT: 0,
        vx: 0,
        vz: 0,
      };
      obj.position.set(SIDEWALK[fx], 0.004, SIDEWALK[fz]);
      this.pickNext(p, 0, 0, false);
      // start somewhere along the first segment
      const k = Math.random();
      obj.position.x += (SIDEWALK[p.tx] - SIDEWALK[fx]) * k;
      obj.position.z += (SIDEWALK[p.tz] - SIDEWALK[fz]) * k;
      p.yaw = Math.atan2(SIDEWALK[p.tx] - SIDEWALK[fx], SIDEWALK[p.tz] - SIDEWALK[fz]);
      this.people.push(p);
    }
  }

  /* ---------------- placement ---------------- */
  private placeCity(pos: Vector3, faceHead: boolean) {
    this.city.position.copy(pos);
    if (faceHead) {
      this.player.head.getWorldPosition(this.head);
      this.city.rotation.set(0, Math.atan2(this.head.x - pos.x, this.head.z - pos.z), 0);
    } else this.city.rotation.set(0, 0, 0);
    this.anchor.copy(pos);
    this.anchorYaw = this.city.rotation.y;
    this.city.visible = true;
    this.placed = true;
  }

  private onEnterXR() {
    this.sfx.unlock();
    const blend = this.world.session?.environmentBlendMode;
    this.resetRound();
    this.city.scale.setScalar(1);
    if (blend && blend !== 'opaque') {
      if (this.ready) this.mode = 'searching';
      this.placed = false;
      this.city.visible = false;
      this.searchT = 0;
      for (const e of this.queries.planes.entities) this.considerPlane(e);
    } else {
      this.placeInFront();
    }
  }

  private onExitXR() {
    this.resetRound();
    this.city.scale.setScalar(1);
    this.placeCity(new Vector3(0, 0.72, -0.62), false);
  }

  private placeInFront() {
    this.player.head.getWorldPosition(this.head);
    this.player.head.getWorldQuaternion(this.q);
    this.a.set(0, 0, -1).applyQuaternion(this.q);
    this.a.y = 0;
    if (this.a.lengthSq() < 1e-4) this.a.set(0, 0, -1);
    this.a.normalize();
    this.b.copy(this.head).addScaledVector(this.a, 0.6);
    this.b.y = Math.max(0.6, this.head.y - 0.55);
    this.placeCity(this.b, true);
    if (this.mode === 'searching') this.mode = 'ready';
  }

  private considerPlane(e: Entity) {
    if (this.mode !== 'searching' || this.placed) return;
    const plane = e.getValue(XRPlane, '_plane') as XRPlane | undefined;
    const o = e.object3D;
    if (!plane || !o || plane.orientation !== 'horizontal') return;
    o.getWorldPosition(this.a);
    if (this.a.y < 0.4 || this.a.y > 1.25) return; // floor or ceiling
    this.player.head.getWorldPosition(this.head);
    this.b.set(this.a.x - this.head.x, 0, this.a.z - this.head.z);
    if (this.b.length() > 0.9) {
      this.b.normalize();
      this.a.x = this.head.x + this.b.x * 0.6;
      this.a.z = this.head.z + this.b.z * 0.6;
    }
    this.placeCity(this.a, true);
    this.mode = 'ready';
    this.fx.ring(this.c.set(0, 0, 0), 0.45, 0x6fe08a, 0.8);
    this.sfx.start();
  }

  /* ---------------- round flow ---------------- */
  /** Desktop: Space = earthquake at a random spot (handy without a headset). */
  private onKey() {
    const fn = (ev: KeyboardEvent) => {
      if (ev.code !== 'Space' || !this.ready || !this.placed || this.camp.phase !== 'off') return;
      ev.preventDefault();
      this.sfx.unlock();
      this.quake(new Vector3((Math.random() - 0.5) * 0.4, 0, (Math.random() - 0.5) * 0.4));
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }

  private restart() {
    /* replaced by the game-mode menu (cards appear after a round) */
  }

  private resetRound(regrow = false) {
    if (regrow && this.kit) {
      this.startRebuild(0, false);
    }
    this.wave = 1;
    for (const side of SIDES) this.held[side] = null;
    this.flying.length = 0;
    this.wobbles.length = 0;
    this.carHop.clear();
    this.shakeT = 0;
    if (!this.rebuild) {
      for (const e of this.queries.buildings.entities) {
        e.setValue(Building, 'alive', true);
        const o = e.object3D;
        const inf = this.info.get(e.index);
        if (o && inf) {
          o.visible = true;
          o.scale.set(1, 1, 1);
          o.position.copy(inf.pos);
          o.rotation.set(0, inf.rotY, 0);
        }
      }
    }
    for (const e of this.queries.tanks.entities) this.hideTank(e);
    for (const car of this.cars) {
      car.state = 'drive';
      car.obj.visible = true;
      car.obj.scale.set(1, 1, 1);
      car.obj.rotation.set(0, 0, 0);
    }
    if (this.heli) {
      this.heli.state = 'off';
      this.heli.obj.visible = false;
      this.heli.evasive = false;
    }
    for (const s of this.shells) {
      s.active = false;
      s.mesh.visible = false;
    }
    if (!this.rebuild) this.collapses.length = 0;
    this.fx.clear();
    if (!this.rebuild) this.ruins.clear();
    this.day.setTarget(0);
    this.newsFlags.clear();
    this.ticker.reset('LIVE FROM TINY CITY: calm skies, light traffic, no monsters reported');
    this.damage = 0;
    this.hp = 100;
    this.combo = 0;
    this.destroyed = 0;
    this.time = this.modeTime();
    this.catches = 0;
    this.cleared = 0;
    this.lives = 3;
    this.tipsShown.clear();
    this.coach.hide();
    this.stat = { people: 0, cars: 0, tanks: 0, cities: 0 };
    this.lastResult = null;
    this.mission = null;
    this.countdown = 0;
    for (const mk of this.markers) mk.visible = false;
    this.elapsed = 0;
    this.spawnT = 8;
    this.heliT = this.diff.heli;
    this.orb.visible = false;
    if (this.mode !== 'searching' && this.mode !== 'loading') this.mode = 'ready';
    this.sfx.music('calm', 2);
    this.sfx.musicLevel(0.32);
  }

  private startPlaying() {
    this.mode = 'playing';
    this.sfx.start();
    this.sfx.roar(0.9);
    this.ticker.push('BREAKING: GIANT MONSTER HAND ATTACKS TINY CITY!', true);
    this.sfx.music('fight');
    this.sfx.musicLevel(0.3);
  }

  private endRound(title: string) {
    if (this.mode !== 'playing') return;
    this.mode = 'over';
    this.title = title;
    this.overT = 0;
    const pct = this.damage / Math.max(1, this.totalValue);
    const scoreNow = this.game === 'heli' ? this.catches : this.game === 'missions' ? this.cleared : this.damage;
    if (this.game === 'heli') this.grade = this.catches >= 12 ? 'S' : this.catches >= 8 ? 'A' : this.catches >= 5 ? 'B' : this.catches >= 2 ? 'C' : 'D';
    else if (this.game === 'missions') this.grade = this.cleared >= 15 ? 'S' : this.cleared >= 10 ? 'A' : this.cleared >= 6 ? 'B' : this.cleared >= 3 ? 'C' : 'D';
    else if (this.game === 'blitz') {
      const per = this.damage / Math.max(1, this.settings.values.blitz || this.elapsed || 1);
      // $M per second: ~$30B in 10 s is an A, $50B+ is an S
      this.grade = per >= 5000 ? 'S' : per >= 3000 ? 'A' : per >= 2000 ? 'B' : per >= 1000 ? 'C' : 'D';
    } else this.grade = pct >= 1.6 ? 'S' : pct >= 1.1 ? 'A' : pct >= 0.7 ? 'B' : pct >= 0.4 ? 'C' : 'D';
    this.newBest = scoreNow > this.bests[this.game];
    if (this.newBest) {
      this.bests[this.game] = scoreNow;
      try {
        localStorage.setItem(`${BEST_KEY}-${this.game}`, String(Math.round(scoreNow)));
      } catch {
        /* storage unavailable */
      }
      this.refreshMenu();
    }
    this.best = this.bests[this.game];
    // progression: XP, level-ups, unlocks, daily challenge
    const lvBefore = this.progress.level;
    const res = this.progress.finish({
      game: this.game,
      damage: this.damage,
      catches: this.catches,
      cleared: this.cleared,
      cities: this.stat.cities,
      people: this.stat.people,
      cars: this.stat.cars,
      tanks: this.stat.tanks,
      newBest: this.newBest,
      seconds: this.settings.values.blitz,
    });
    this.lastResult = res;
    if (res.levelUp) {
      const lv = this.progress.level;
      const tips: [string, string][] = [['*', `Level ${lv}: ${this.progress.title.toUpperCase()}`]];
      for (const k of res.unlocked) tips.push(['+', `New claw skin: ${k.name} (Settings)`]);
      if (tips.length < 3) tips.push(['>', `Next level in ${Math.round((1 - this.progress.levelFrac) * Progress.need(lv))} XP`]);
      setTimeout(() => {
        this.coach.show(lvBefore + 1 === lv ? 'LEVEL UP!' : `LEVEL UP x${lv - lvBefore}!`, tips.slice(0, 3), 7);
        this.sfx.roar(0.8);
        this.sfx.combo(8);
      }, 1500);
      // a freshly unlocked skin is worn right away
      if (res.unlocked.length) this.settings.set('skin', res.unlocked[res.unlocked.length - 1].id);
      this.ticker.push(`THE MONSTER GROWS: now level ${lv}, "${this.progress.title}"`, true);
    }
    if (res.dailyDone) this.ticker.push(`DAILY CHALLENGE COMPLETE! Streak: ${this.progress.streak} day${this.progress.streak > 1 ? 's' : ''}`, true);
    this.mission = null;
    for (const mk of this.markers) mk.visible = false;
    if (this.heli && this.heli.state !== 'off') {
      this.heli.state = 'off';
      this.heli.obj.visible = false;
    }
    for (const s of this.shells) {
      s.active = false;
      s.mesh.visible = false;
    }
    this.sfx.end(this.grade === 'S' || this.grade === 'A' || this.newBest);
    this.ticker.push(
      this.game === 'heli'
        ? `${this.catches} HELICOPTERS CAUGHT. Air force considers paper planes`
        : this.game === 'missions'
          ? `MONSTER COMPLETES ${this.cleared} MISSIONS before running out of lives`
          : this.destroyed >= this.total
            ? 'CITY FLATTENED. Monster last seen heading for the fridge'
            : `DAMAGE ESTIMATE: ${money(this.damage)}. Insurance companies in tears`,
      true,
    );
    this.sfx.music('calm', 4);
    this.sfx.musicLevel(0.18);
  }

  /** true the first time a news/event flag is seen this round */
  private once(flag: string) {
    if (this.newsFlags.has(flag)) return false;
    this.newsFlags.add(flag);
    return true;
  }

  private hitStop(t: number) {
    this.hitStopT = Math.max(this.hitStopT, t);
  }

  private canScore() {
    return this.mode === 'playing' && this.countdown <= 0 && !this.rebuild && !this.paused;
  }

  private score(gain: number, at: Vector3, label: string, color: string) {
    this.missionEvent('touch');
    this.scare(at, 0.16);
    this.combo = this.now - this.lastSmash < 0.9 ? this.combo + 1 : 1;
    this.lastSmash = this.now;
    const mult = Math.min(this.combo, 5);
    const total = gain * mult;
    this.damage += total;
    this.fx.popup(at, `${label}+${money(total)}`, mult > 1 ? '#ff8a5a' : color);
    if (mult > 1) this.sfx.combo(mult);
    if (mult >= 5 && this.once('combo5')) {
      this.ticker.push('EXPERTS: "THE MONSTER IS ON A ROLL"', true);
      this.sfx.roar(0.7);
    }
    if (this.damage >= 1000 && this.once('1b')) this.ticker.push('DAMAGE TOPS $1 BILLION AND RISING', true);
    if (this.damage >= 3000 && this.once('3b')) this.ticker.push('MAYOR: "PLEASE STOP TOUCHING OUR CITY"');
    // emergency services respond
    if (this.mode === 'playing' && Math.random() < 0.35) this.sfx.siren();
    return total;
  }

  /* ---------------- destruction ---------------- */
  private smash(e: Entity, fromLocal: Vector3, power: number, mult: number, label = '') {
    if (!this.canScore() || !e.getValue(Building, 'alive')) return;
    e.setValue(Building, 'alive', false);
    const o = e.object3D;
    if (!o) return;
    const h = e.getValue(Building, 'height') ?? 0.05;
    const w = e.getValue(Building, 'width') ?? 0.03;
    const inf = this.info.get(e.index);
    this.destroyed++;
    this.missionEvent('building', e);
    this.campaignBuilding(e, o, w, inf?.depth ?? w);
    this.collapses.push({ obj: o, t: 0, tilt: (Math.random() - 0.5) * 0.6 });
    this.c.copy(o.position);
    this.fx.explode(this.c, fromLocal, w, h, inf?.palette ?? [0xcccccc], power);
    this.sfx.crunch(Math.min(1, h / 0.2), inf?.glass ?? false);
    this.ruins.addRuin(o.position.x, o.position.z, w, inf?.depth ?? w, h, inf?.palette ?? [0x999999], h > 0.09 || Math.random() < 0.5);
    if (h > 0.11) {
      this.hitStop(0.09);
      if (this.once('tower')) this.ticker.push('SKYSCRAPER DOWN! Residents report "a really big finger"', true);
    }
    if (this.destroyed === 10 && this.once('ten')) this.ticker.push('TEN BUILDINGS DESTROYED. Army on the way');
    this.c.y += h + 0.03;
    this.score((e.getValue(Building, 'value') ?? 10) * mult, this.c, label, '#ffd25a');
    this.checkCleared();
  }

  /**
   * Smoothly replace the city: the ruins (and anything still standing) sink away while the
   * block plates change colour, then a new city of the given theme grows lot by lot from the centre.
   */
  private startRebuild(theme: number, bonus: boolean, vanish = false) {
    const kit = this.kit;
    if (!kit) return;
    this.theme = theme;
    const layout = THEMES[theme].layout;
    const from: Color[] = [];
    const to: Color[] = [];
    for (let i = 0; i < 16; i++) {
      const c = new Color();
      kit.plates.getColorAt(i, c);
      from.push(c);
      to.push(new Color(GROUND[layout(Math.floor(i / 4), i % 4)]));
    }
    for (const side of SIDES) {
      const hd = this.held[side];
      if (hd && hd.ref.kind === 'building') this.held[side] = null;
    }
    this.flying = this.flying.filter((f) => f.ref.kind !== 'building');
    for (const s of this.shells) {
      s.active = false;
      s.mesh.visible = false;
    }
    this.ruins.extinguish();
    this.rebuild = { t: 0, theme, bonus, swapped: false, order: [], from, to, vanish };
  }

  private updateRebuild(dt: number) {
    const r = this.rebuild;
    const kit = this.kit;
    if (!r || !kit) return;
    r.t += dt;
    if (!r.swapped) {
      const k = Math.min(1, r.t / SINK);
      const ease = k * k * (3 - 2 * k);
      // old ruins and any surviving buildings sink into the ground
      this.ruins.root.scale.y = Math.max(0.001, 1 - ease);
      for (const e of this.queries.buildings.entities) {
        const o = e.object3D;
        if (o && e.getValue(Building, 'alive')) {
          e.setValue(Building, 'alive', false);
          this.collapses.push({ obj: o, t: 0, tilt: (Math.random() - 0.5) * 0.3 });
        }
      }
      for (let i = 0; i < 16; i++) kit.plates.setColorAt(i, this.c3.copy(r.from[i]).lerp(r.to[i], ease));
      if (kit.plates.instanceColor) kit.plates.instanceColor.needsUpdate = true;
      if (k < 1) return;
      // swap every lot to a new building of the new theme, hidden at zero height
      r.swapped = true;
      this.ruins.clear();
      this.ruins.root.scale.y = 1;
      this.collapses.length = 0;
      this.wobbles.length = 0;
      const layout = THEMES[r.theme].layout;
      this.totalValue = 0;
      const list: { e: Entity; d: number }[] = [];
      for (const e of this.queries.buildings.entities) {
        const o = e.object3D;
        const inf = this.info.get(e.index);
        if (!o || !inf) continue;
        const spec = kit.pick(layout(inf.lot.bi, inf.lot.bj), inf.lot);
        if (!spec) continue;
        o.clear();
        o.add(spec.model);
        o.position.copy(inf.pos);
        o.rotation.set(0, inf.rotY, 0);
        o.scale.set(1, 0.001, 1);
        o.visible = false;
        e.setValue(Building, 'height', spec.stats.height);
        e.setValue(Building, 'width', Math.max(spec.stats.width, spec.stats.depth));
        e.setValue(Building, 'value', spec.stats.value);
        e.setValue(Building, 'alive', false);
        inf.palette = spec.stats.palette;
        inf.glass = spec.stats.glass;
        inf.depth = spec.stats.depth;
        this.totalValue += spec.stats.value;
        list.push({ e, d: Math.hypot(inf.pos.x, inf.pos.z) + Math.random() * 0.06 });
      }
      list.sort((a, b) => a.d - b.d);
      if (r.vanish) {
        this.rebuild = null;
        return;
      }
      r.order = list.map((x, i) => ({ e: x.e, start: SINK + 0.15 + (i / Math.max(1, list.length)) * GROW, popped: false, done: false }));
      this.destroyed = 0;
      return;
    }
    // grow the new city
    let done = 0;
    for (const item of r.order) {
      if (item.done) {
        done++;
        continue;
      }
      if (r.t < item.start) continue;
      const o = item.e.object3D;
      if (!o) {
        item.done = true;
        continue;
      }
      if (!item.popped) {
        item.popped = true;
        o.visible = true;
        this.fx.puff(this.c.copy(o.position), 0.01, 4);
        this.sfx.pop();
      }
      const k = Math.min(1, (r.t - item.start) / 0.45);
      // ease-out-back: shoots up, overshoots a little, settles
      const c1 = 1.9;
      const y = 1 + (c1 + 1) * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
      o.scale.set(1 - (1 - k) * 0.3, Math.max(0.001, y), 1 - (1 - k) * 0.3);
      if (k >= 1) {
        o.scale.set(1, 1, 1);
        item.e.setValue(Building, 'alive', true);
        item.done = true;
      }
    }
    if (done >= r.order.length) {
      const name = THEMES[r.theme].name;
      this.rebuild = null;
      if (r.bonus) {
        this.ticker.push(`WELCOME TO ${name}! Population: nervous`, true);
        this.c.set(0, 0.16, 0);
        this.fx.popup(this.c, `WAVE ${this.wave}: ${name}`, '#9ef0ff');
      }
    }
  }

  private checkCleared() {
    if (this.destroyed >= this.total && this.mode === 'playing' && !this.rebuild && (this.game === 'rampage' || this.game === 'blitz')) {
      if (Number.isFinite(this.time)) this.damage += Math.max(0, this.time) * 10;
      if (!this.settings.values.rebuild) return this.endRound('CITY DESTROYED!');
      // wave cleared: a brand new city grows in place of the ruins, with bonus time
      this.wave++;
      this.stat.cities++;
      if (Number.isFinite(this.time)) this.time += 30;
      this.sfx.roar(1);
      this.sfx.start();
      this.fx.popup(this.c.set(0, 0.16, 0), 'CITY DESTROYED!', '#ff5a5a');
      this.ticker.push(`CITY DESTROYED! Wave ${this.wave - 1} cleared, +30s. A new city is already growing...`, true);
      this.startRebuild((this.theme + 1 + Math.floor(Math.random() * (THEMES.length - 1))) % THEMES.length, true);
    }
  }

  private quake(local: Vector3) {
    if (!this.canScore()) return;
    this.missionEvent('touch');
    this.used.quake = true;
    this.fx.ring(local, 0.2, 0xffd25a, 0.6);
    this.fx.ring(local, 0.42, 0xffffff, 0.9);
    this.fx.puff(local, 0.02, 30);
    this.sfx.quake();
    this.ruins.addCrack(local.x, local.z, 0.14);
    this.hitStop(0.06);
    if (this.once('quake')) this.ticker.push('EARTHQUAKE! Citizens knocked off their feet', true);
    this.shakeT = 0.9;
    this.shakeAmp = this.settings.values.shake ? 0.0045 : 0;
    // the ground rolls: buildings sway, cars hop, people fall over
    for (const e of this.queries.buildings.entities) {
      const o = e.object3D;
      if (!o || !e.getValue(Building, 'alive')) continue;
      const d = Math.hypot(o.position.x - local.x, o.position.z - local.z);
      if (d < 0.45) this.wobble(e, o, 0.09 * (1 - d / 0.45), d * 25);
    }
    for (const car of this.cars) {
      if (car.state !== 'drive') continue;
      const d = car.obj.position.distanceTo(local);
      if (d < 0.4) this.carHop.set(car, 0.45 + Math.random() * 0.2);
    }
    this.knockDown(local, 0.4, 0.06);
    this.sfx.scream(3);
    const r2 = 0.11 * 0.11;
    for (const e of this.queries.buildings.entities) {
      const o = e.object3D;
      if (!o || !e.getValue(Building, 'alive')) continue;
      const dx = o.position.x - local.x;
      const dz = o.position.z - local.z;
      if (dx * dx + dz * dz < r2) this.smash(e, local, 1.8, 1, 'QUAKE ');
    }
    for (const e of this.queries.tanks.entities) {
      const o = e.object3D;
      if (!o || !e.getValue(Tank, 'alive') || e.getValue(Tank, 'held')) continue;
      if (o.position.distanceTo(local) < 0.13) this.killTank(e, 40, 'QUAKE ');
    }
    for (const car of this.cars) {
      if (car.state === 'drive' && car.obj.position.distanceTo(local) < 0.11) this.wreckCar(car, local);
    }
  }

  private wobble(e: Entity, obj: Object3D, amp: number, phase: number) {
    const w = this.wobbles.find((x) => x.obj === obj);
    if (w) {
      w.t = 0;
      w.amp = Math.max(w.amp, amp);
      return;
    }
    this.wobbles.push({ obj, e, t: 0, amp, phase });
  }

  /** People within `radius` are thrown off their feet (they get back up and run). */
  private knockDown(at: Vector3, radius: number, push: number) {
    let shouted = 0;
    for (const p of this.people) {
      if (p.state === 'down') continue;
      const dx = p.obj.position.x - at.x;
      const dz = p.obj.position.z - at.z;
      const d = Math.hypot(dx, dz);
      if (d > radius) continue;
      p.state = 'down';
      this.missionEvent('people');
      if (this.mode === 'playing') this.stat.people++;
      p.stateT = 1.4 + Math.random() * 1.1 + d * 2;
      p.jumpT = 0;
      const k = (push * (1 - d / radius)) / Math.max(0.01, d);
      p.vx = dx * k;
      p.vz = dz * k;
      p.yaw = Math.atan2(-dx, -dz) + (Math.random() - 0.5) * 0.8; // fall away from the blast
      this.playAnim(p, 'die', 0.08);
      if (shouted < 3 && Math.random() < 0.5) {
        shouted++;
        this.c.copy(p.obj.position).setY(0.035);
        this.fx.popup(this.c, Math.random() < 0.5 ? 'WHOA!' : 'AAAH!', '#ffffff');
      }
    }
  }

  /** Startle people near a smash without knocking them over. */
  private scare(at: Vector3, radius: number) {
    for (const p of this.people) {
      if (p.state === 'down') continue;
      if (Math.hypot(p.obj.position.x - at.x, p.obj.position.z - at.z) < radius) {
        p.scared = 3;
        if (p.state === 'idle') p.state = 'walk';
        this.pickNext(p, at.x, at.z, true);
        this.sfx.scream(1);
      }
    }
  }

  private wreckCar(car: Car, from: Vector3) {
    this.missionEvent('car');
    if (this.camp.phase === 'play') this.camp.progress.cars++;
    if (this.mode === 'playing') this.stat.cars++;
    car.state = 'dead';
    car.respawn = 5;
    car.obj.scale.set(1.25, 0.3, 1.25);
    this.c.copy(car.obj.position);
    this.ruins.addScorch(this.c.x, this.c.z, 0.016);
    if (Math.random() < 0.6) this.ruins.ignite(this.c.x, this.c.z, 0.5, 6 + Math.random() * 6);
    this.fx.explode(this.c, from, 0.012, 0.01, [0xe84b4b, 0x3f8fe8, 0x2a2a2a, 0xffd23f], 1.2);
    this.fx.spark(this.c, 10, 0.3, 0xffd060);
    this.sfx.metal();
    this.c.y += 0.025;
    this.score(6, this.c, '', '#ffe066');
  }

  /* ---------------- tanks & helicopter ---------------- */
  private ringPos(u: number, out: Vector3) {
    const R = RING;
    const side = Math.floor(((u % 4) + 4) % 4);
    const f = (((u % 1) + 1) % 1) * 2 - 1;
    if (side === 0) out.set(f * R, 0, R);
    else if (side === 1) out.set(R, 0, -f * R);
    else if (side === 2) out.set(-f * R, 0, -R);
    else out.set(-R, 0, f * R);
    out.y = 0.002;
    return out;
  }

  private spawnTank() {
    for (const e of this.queries.tanks.entities) {
      if (e.getValue(Tank, 'alive')) continue;
      const o = e.object3D;
      if (!o) return;
      e.setValue(Tank, 'alive', true);
      e.setValue(Tank, 'held', false);
      e.setValue(Tank, 'angle', Math.random() * 4);
      e.setValue(Tank, 'speed', (Math.random() < 0.5 ? -1 : 1) * (0.06 + Math.random() * 0.04));
      e.setValue(Tank, 'cooldown', 1.5 + Math.random() * 1.5);
      o.visible = true;
      o.rotation.set(0, 0, 0);
      o.scale.setScalar(1.3);
      this.ringPos(e.getValue(Tank, 'angle') ?? 0, o.position);
      this.fx.puff(o.position, 0.01, 8);
      return;
    }
  }

  private hideTank(e: Entity) {
    e.setValue(Tank, 'alive', false);
    e.setValue(Tank, 'held', false);
    const o = e.object3D;
    if (o) o.visible = false;
  }

  private killTank(e: Entity, bonus: number, label: string) {
    const o = e.object3D;
    if (!o) return;
    this.c.copy(o.position);
    this.fx.explode(this.c, this.c, 0.025, 0.015, [0x6f8f3a, 0x3d4a2a, 0x9aa45a], 1.3);
    this.fx.spark(this.c, 20, 0.6);
    this.fx.ring(this.c, 0.06, 0xff8a3a, 0.4);
    this.sfx.boom();
    if (this.c.y < 0.03) {
      this.ruins.addScorch(this.c.x, this.c.z, 0.028);
      this.ruins.ignite(this.c.x, this.c.z, 0.8, 10 + Math.random() * 6);
    }
    this.c.y += 0.035;
    if (this.mode === 'playing') this.score(bonus, this.c, label, '#9ef0ff');
    this.missionEvent('tank');
    if (this.camp.phase === 'play') this.camp.progress.tanks++;
    if (this.mode === 'playing') this.stat.tanks++;
    for (const side of SIDES) {
      const hd = this.held[side];
      if (hd && hd.ref.kind === 'tank' && hd.ref.e === e) this.held[side] = null;
    }
    this.flying = this.flying.filter((f) => !(f.ref.kind === 'tank' && f.ref.e === e));
    this.hideTank(e);
  }

  /** Swatted: the helicopter tumbles out of the sky and crashes. */
  private swatHeli(v: Vector3) {
    const hl = this.heli;
    if (!hl || hl.state !== 'fly') return;
    if (hl.evasive) return this.catchHeli();
    hl.state = 'thrown';
    this.flying.push({
      ref: { kind: 'heli', heli: hl },
      obj: hl.obj,
      v: v.clone(),
      spin: new Vector3(4, 9, 3),
      size: 0.04,
      value: 120,
      palette: [0x4f6b4a, 0x2b332c],
    });
    this.sfx.punch();
  }

  private killHeli(label: string) {
    const h = this.heli;
    if (!h) return;
    this.c.copy(h.obj.position);
    this.fx.explode(this.c, this.c, 0.03, 0.02, [0x4f6b4a, 0x2b332c, 0xff8a3a], 1.4);
    this.fx.spark(this.c, 26, 0.7);
    this.fx.ring(this.c.clone().setY(0.004), 0.08, 0xff8a3a, 0.5);
    this.sfx.boom();
    this.hitStop(0.1);
    if (this.c.y < 0.03) {
      this.ruins.addScorch(this.c.x, this.c.z, 0.04);
      this.ruins.ignite(this.c.x, this.c.z, 1.1, 16);
    }
    this.ticker.push('ARMY HELICOPTER SWATTED "LIKE A FLY"', true);
    this.c.y += 0.04;
    if (this.mode === 'playing') this.score(120, this.c, label, '#9ef0ff');
    h.state = 'off';
    h.obj.visible = false;
    this.heliT = 14;
  }

  /* ---------------- per frame ---------------- */
  update(delta: number): void {
    if (this.world.visibilityState.peek() === VisibilityState.VisibleBlurred) return;
    const dt = Math.min(delta, 0.05);
    this.now += dt;
    this.city.position.sub(this.shakeOff);
    this.shakeOff.set(0, 0, 0);
    const immersive = this.world.visibilityState.peek() !== VisibilityState.NonImmersive;

    if (!this.fakeHands) this.hands.update(this.world.renderer, this.player, dt);
    this.player.head.getWorldPosition(this.head);

    if (!immersive) {
      if (this.debugCam) {
        // dev only: ?cam=x,y,z puts the desktop camera relative to the city
        this.world.camera.position.copy(this.city.position).add(this.debugCam).sub(this.player.position);
      }
      if (this.debugLook) this.world.camera.lookAt(this.city.localToWorld(this.c.copy(this.debugLook)));
      else if (this.camp.phase !== 'off') this.world.camera.lookAt(this.c.copy(this.anchor).setY(this.anchor.y + 0.03));
      else this.world.camera.lookAt(this.c.copy(this.city.position).setY(this.city.position.y + 0.02));
      // on desktop the viewer is the camera, not the (unused) headset pose
      this.world.camera.getWorldPosition(this.head);
    }

    if (this.mode === 'searching') {
      this.searchT += dt;
      if (this.searchT > 6) this.placeInFront();
    }

    this.campaignCamera(dt);
    this.city.updateMatrixWorld();
    this.updateTipMarkers();
    if (this.placed && this.ready) this.handleHands(dt);

    for (let i = this.collapses.length - 1; i >= 0; i--) {
      const c = this.collapses[i];
      c.t += dt;
      const k = Math.min(1, c.t / 0.42);
      const ease = k * k * (1.6 - 0.6 * k); // slow start, fast finish
      const shudder = k < 0.35 ? Math.sin(c.t * 90) * 0.035 * (1 - k / 0.35) : 0;
      c.obj.scale.set(1 + ease * 0.15, Math.max(0.001, 1 - ease), 1 + ease * 0.15);
      c.obj.rotation.z = c.tilt * ease + shudder;
      c.obj.rotation.x = shudder * 0.7;
      if (k >= 1) {
        c.obj.visible = false;
        this.collapses.splice(i, 1);
      }
    }

    // settings board (mixed reality): poke the gear next to the city
    if (this.placed) {
      this.a.set(-HALF - 0.03, 0.03, HALF + 0.03);
      this.city.localToWorld(this.board.gear.position.copy(this.a));
      this.board.gear.lookAt(this.head);
      this.a.set(-HALF - 0.2, 0.2, 0);
      this.city.localToWorld(this.board.board.position.copy(this.a));
      this.board.board.lookAt(this.head);
    }
    this.board.gear.visible = this.placed && immersive;
    this.paused = (immersive && this.board.update(dt, [this.hands.hands.left, this.hands.hands.right])) || !!this.desktopUi?.isOpen();
    if (this.paused) {
      this.updateHud();
      return;
    }
    this.updateRebuild(dt);

    // game-mode menu
    const showMenu = this.placed && this.menuOpen() && this.camp.phase === 'off';
    for (const c of this.menu.cards) c.visible = showMenu;
    if (showMenu) {
      this.menu.layout((l, out) => this.city.localToWorld(out.copy(l)), HALF, this.head, this.city.scale.x);
      const pick = this.menu.update(dt, [this.hands.hands.left, this.hands.hands.right]);
      if (pick) this.onMenuPick(pick);
    }
    if (this.autoLevel >= 0 && this.placed && this.ready && !this.rebuild && !this.pendingStart && this.mode === 'ready') {
      if (this.camp.phase === 'off') this.openCampaignSelect();
      else if (this.camp.phase === 'select') {
        this.startLevel(this.autoLevel);
        this.autoLevel = -1;
      }
    }
    this.updateCampaignUi(dt);
    // 3-2-1-GO
    if (this.pendingStart && !this.rebuild && this.ready && (this.game !== 'campaign' || this.hero.ready)) {
      this.pendingStart = false;
      if (this.game === 'campaign') this.campaignSetup();
      this.mode = 'playing';
      this.countdown = 3.4;
      this.sfx.combo(1);
      this.showCoach();
    }
    if (this.mode === 'playing' && this.countdown > 0) {
      const before = Math.ceil(this.countdown - 0.4);
      this.countdown -= dt;
      const after = Math.ceil(this.countdown - 0.4);
      if (after !== before && after > 0) this.sfx.combo(4 - after);
      if (this.countdown <= 0) this.beginGame();
    }
    this.updateMissions(dt);

    if (this.mode === 'playing' && !this.rebuild && this.countdown <= 0) {
      this.time -= dt;
      this.elapsed += dt;
      this.spawnT -= dt;
      this.heliT -= dt;
      // Heli Hunt: a new, faster chopper right after each catch
      if (this.game === 'heli' && this.heli && this.heli.state === 'off') {
        this.heliRespawnT -= dt;
        if (this.heliRespawnT <= 0) this.spawnHeli(true, Math.min(1.9, 1 + this.catches * 0.14));
      }
      let alive = 0;
      for (const e of this.queries.tanks.entities) if (e.getValue(Tank, 'alive')) alive++;
      const maxAlive = Math.min(this.diff.tanks, 2 + Math.floor(this.elapsed / 20) + (this.wave - 1));
      // only the classic rampage brings in the army on its own
      if (this.game === 'rampage' && this.spawnT <= 0 && alive < maxAlive) {
        this.spawnTank();
        if (this.once('tanks')) this.ticker.push('ARMY SENDS TANKS. Monster unimpressed');
        this.spawnT = Math.max(2.5, 7 - this.elapsed * 0.06) * this.diff.spawn;
      }
      if (this.game === 'rampage' && this.heli && this.heli.state === 'off' && this.heliT <= 0) {
        const h = this.heli;
        h.evasive = false;
        h.speed = 1;
        h.state = 'fly';
        h.obj.visible = true;
        h.angle = Math.random() * Math.PI * 2;
        h.alt = 0.26;
        h.cd = 3;
        // enter from outside the city, flying inwards
        h.obj.position.set(Math.cos(h.angle) * 0.6, 0.3, Math.sin(h.angle) * 0.6);
        h.yaw = Math.atan2(-h.obj.position.z, h.obj.position.x) + Math.PI;
        h.vel.set(-Math.cos(h.angle), 0, -Math.sin(h.angle)).multiplyScalar(0.12);
        h.goal.set(0, h.alt, 0);
        h.goalT = 0;
        this.sfx.zap();
        this.ticker.push('ATTACK HELICOPTER SCRAMBLED TO STOP THE MONSTER', true);
      }
      if (this.game === 'campaign') {
        if (this.time <= 0) {
          this.time = 0;
          this.campaignEnd(false, "TIME'S UP!");
        } else if (this.hp <= 0) this.campaignEnd(false, 'KNOCKED OUT!');
      } else if (this.time <= 0) {
        this.time = 0;
        this.endRound("TIME'S UP!");
      } else if (this.hp <= 0) {
        if (this.game === 'missions') {
          // in Missions getting shot down costs a life instead of the game
          this.hp = 100;
          this.lives--;
          if (this.lives <= 0) this.endRound('OUT OF LIVES');
        } else this.endRound('KAIJU DEFEATED');
      }
      if (this.hp < 40 && this.once('lowhp')) this.ticker.push('GENERAL: "WE ARE WINNING" (they might be)', true);
      if (this.day.night > 0.6 && this.once('night')) this.ticker.push('NIGHT FALLS OVER A BURNING CITY');
    } else if (this.mode === 'over') {
      this.overT += dt;
    }
    this.orb.visible = false;

    // hit-stop: big hits freeze the world for a heartbeat (hands keep tracking)
    const sim = this.hitStopT > 0 ? dt * 0.12 : dt;
    this.hitStopT = Math.max(0, this.hitStopT - dt);
    this.updateQuakeFx(sim);
    if (this.ready) {
      this.updateCars(sim);
      this.updatePeople(sim);
      this.updateHero(sim);
      this.updateTanks(sim);
      this.updateHeli(sim);
      this.updateFlying(sim);
    }
    this.updateShells(sim);
    this.fx.update(sim, this.head);
    if (this.dayLock !== null) this.day.setTarget(this.dayLock);
    else {
      let p = 0;
      if (this.game === 'rampage') {
        const rt = this.roundTime();
        // endless: a new day every 150 s; timed rounds: afternoon -> night over the round
        p = rt ? Math.min(1, this.elapsed / (rt + (this.wave - 1) * 30)) : (this.elapsed % 150) / 150;
      } else if (this.game === 'blitz') {
        const bt = this.settings.values.blitz;
        p = bt ? 0.15 + 0.4 * Math.min(1, this.elapsed / bt) : (this.elapsed % 120) / 120;
      } else if (this.game === 'heli') p = 0.5;
      else if (this.game === 'campaign') p = LEVELS[this.camp.level].sky;
      else p = Math.min(1, this.cleared * 0.1);
      this.day.setTarget(this.mode === 'playing' || this.mode === 'over' || (this.camp.phase !== 'off' && this.camp.phase !== 'select') ? p : 0);
    }
    this.day.update(dt);
    // keep the sun's shadow box on the part of the city you are looking at
    this.sun.position.copy(this.day.dir).multiplyScalar(1.1 / this.city.scale.x).add(this.sunTarget.position);
    this.ruins.night = this.day.night;
    this.fx.setNight(this.day.night);
    this.ruins.update(sim);
    if (this.ruins.burning > 1 && Math.random() < dt * 2) this.sfx.fire();
    this.ticker.update(dt);
    if (this.shakeT > 0) {
      // tiny decaying table shake, applied after all game logic and removed next frame
      const k = this.shakeAmp * Math.min(1, this.shakeT / 0.5) * this.city.scale.x;
      this.shakeOff.set(Math.sin(this.now * 71) * k, Math.sin(this.now * 53) * k * 0.5, Math.cos(this.now * 63) * k);
      this.city.position.add(this.shakeOff);
    }
    this.hurtT = Math.max(0, this.hurtT - dt);
    this.tipMat.color.set(this.hurtT > 0 ? 0xff4040 : this.zoom ? 0x6fe08a : 0xffe066);
    this.monster.update([this.hands.hands.left, this.hands.hands.right], this.placed, this.city, HALF, this.hurtT > 0 ? 1 : this.zoom ? 2 : 0);
    this.updateNudges();
    if (this.coach.mesh.visible && this.camp.phase !== 'off') {
      this.qYaw.setFromAxisAngle(this.b.set(0, 1, 0), this.anchorYaw);
      this.coach.mesh.position.set(-0.4, 0.16, 0.08).applyQuaternion(this.qYaw).add(this.anchor);
      this.coach.mesh.lookAt(this.head);
    } else if (this.coach.mesh.visible) {
      this.a.set(0, 0.2 / this.city.scale.x, 0.12);
      this.city.localToWorld(this.coach.mesh.position.copy(this.a));
      this.coach.mesh.lookAt(this.head);
    }
    this.coach.update(dt);
    this.updateHud();
  }

  private updateTipMarkers() {
    let i = 0;
    for (const side of SIDES) {
      const h = this.hands.hands[side];
      for (let k = 0; k < 5; k++, i++) {
        const m = this.tipMarkers[i];
        m.visible = h.tracked && this.placed;
        if (m.visible) m.position.copy(h.tips[k]);
      }
    }
  }

  private toLocal(world: Vector3, out: Vector3) {
    return this.city.worldToLocal(out.copy(world));
  }

  /** World-space velocity -> city-local velocity. */
  private velToLocal(v: Vector3, out: Vector3) {
    this.city.getWorldQuaternion(this.qi).invert();
    return out.copy(v).applyQuaternion(this.qi).divideScalar(this.city.scale.x);
  }

  private handleHands(dt: number) {
    if (this.camp.phase !== 'off' && this.camp.godT <= 0) return this.campaignHands(dt);
    const s = this.city.scale.x;
    const L = this.hands.hands.left;
    const R = this.hands.hands.right;

    // ---- two-hand pinch: zoom + rotate the city ----
    const zoomOk = L.tracked && R.tracked && L.pinch && R.pinch && !this.held.left && !this.held.right;
    if (zoomOk) {
      const d = L.pinchPoint.distanceTo(R.pinchPoint);
      const ang = Math.atan2(R.pinchPoint.z - L.pinchPoint.z, R.pinchPoint.x - L.pinchPoint.x);
      if (!this.zoom) {
        this.zoom = { d0: Math.max(0.05, d), s0: s, a0: ang, r0: this.city.rotation.y };
        this.sfx.grab();
      }
      const ns = Math.min(2.6, Math.max(0.5, (this.zoom.s0 * d) / this.zoom.d0));
      this.city.scale.setScalar(ns);
      this.city.rotation.y = this.zoom.r0 - (ang - this.zoom.a0);
      L.pinchHeld = R.pinchHeld = -10;
    } else if (this.zoom && !(L.pinch && R.pinch)) {
      this.zoom = null;
    }

    let n = 0;
    for (const side of SIDES) {
      const h: HandData = this.hands.hands[side];
      this.slamCd[side] = Math.max(0, this.slamCd[side] - dt);
      if (!h.tracked) {
        this.release(side, h);
        continue;
      }
      for (let k = 0; k < 5; k++) {
        this.toLocal(h.tips[k], this.localTips[n]);
        this.tipSide[n++] = side;
      }
      this.toLocal(h.wrist, this.localTips[n]);
      this.tipSide[n++] = side;
      this.toLocal(h.palm, this.localTips[n]);
      this.tipSide[n++] = side;
      if (this.zoom) continue;

      // re-place the city: pinch & hold (one hand) while waiting to start
      if (this.mode === 'ready' && h.pinchHeld > 1.1 && !this.held[side] && !(L.pinch && R.pinch)) {
        this.a.copy(h.pinchPoint);
        this.a.y -= 0.012;
        this.placeCity(this.a, true);
        this.fx.ring(this.c.set(0, 0, 0), 0.45, 0x6fe08a, 0.6);
        h.pinchHeld = -10;
      }

      // palm slam -> earthquake
      this.toLocal(h.palm, this.b);
      if (
        this.slamCd[side] === 0 &&
        !this.held[side] &&
        h.wristVel.y < -0.9 &&
        this.b.y < 0.07 / s &&
        Math.abs(this.b.x) < HALF + 0.04 &&
        Math.abs(this.b.z) < HALF + 0.04
      ) {
        this.slamCd[side] = 0.8;
        this.b.y = 0;
        this.quake(this.b.clone());
      }

      // grab something
      if (h.grabStart && !this.held[side] && this.canScore()) this.tryGrab(side, h);

      // carry / crush
      const hd = this.held[side];
      if (hd) {
        this.toLocal(h.grabPoint, this.a);
        hd.obj.position.copy(this.a).add(hd.offset);
        hd.obj.rotation.z = Math.sin(this.now * 18) * 0.06;
        if (h.curl < 0.045) hd.crushT += dt;
        else hd.crushT = Math.max(0, hd.crushT - dt);
        if (hd.crushT > 0.3) this.crush(side, hd);
        else if (h.grabEnd || !h.grab) this.release(side, h);
      }
    }
    this.tipCount = n;
    if (this.zoom) return;

    // ---- contacts: fingertips, wrist and palm vs the world ----
    const r = TIP_R / s;
    for (let t = 0; t < n; t++) {
      const p = this.localTips[t];
      const side = this.tipSide[t];
      if (this.held[side]) continue; // a busy hand doesn't smash
      const isTip = t % 7 < 5;
      if (p.y > 0.4 || p.y < -0.02) continue;
      const hand = this.hands.hands[side];
      const fast = hand.speed > 1.1;
      for (const e of this.queries.buildings.entities) {
        if (!e.getValue(Building, 'alive')) continue;
        const o = e.object3D;
        if (!o) continue;
        const hw = (e.getValue(Building, 'width') ?? 0.03) / 2 + r;
        const top = o.position.y + (e.getValue(Building, 'height') ?? 0.05) + r;
        if (Math.abs(p.x - o.position.x) < hw && Math.abs(p.z - o.position.z) < hw && p.y < top) {
          if (fast) {
            this.sfx.punch();
            this.smash(e, p, 2.3, 1.5, 'PUNCH ');
          } else this.smash(e, p, 1.1, 1);
        }
      }
      if (this.mode === 'playing') {
        for (const e of this.queries.tanks.entities) {
          if (!e.getValue(Tank, 'alive') || e.getValue(Tank, 'held')) continue;
          const o = e.object3D;
          if (o && o.position.distanceTo(p) < r + 0.012) this.killTank(e, 60, 'TANK ');
        }
        const hl = this.heli;
        if (hl && hl.state === 'fly' && hl.obj.position.distanceTo(p) < r + 0.025) {
          this.swatHeli(this.velToLocal(hand.wristVel, this.b).multiplyScalar(0.6));
        }
      }
      for (const car of this.cars) {
        if (car.state === 'drive' && car.obj.position.distanceTo(p) < r + 0.008) this.wreckCar(car, p);
      }
      if (isTip && this.mode === 'over' && this.orb.visible && this.orb.position.distanceTo(p) < r + 0.022) this.restart();
    }
  }

  private tryGrab(side: Side, h: HandData) {
    const s = this.city.scale.x;
    const r = GRAB_R / s;
    const p = this.toLocal(h.grabPoint, new Vector3());
    let bestD = r;
    let pick: Ref | null = null;
    let obj: Object3D | null = null;
    for (const e of this.queries.buildings.entities) {
      if (!e.getValue(Building, 'alive')) continue;
      const o = e.object3D;
      if (!o) continue;
      const hw = (e.getValue(Building, 'width') ?? 0.03) / 2;
      const top = o.position.y + (e.getValue(Building, 'height') ?? 0.05);
      const dx = Math.max(0, Math.abs(p.x - o.position.x) - hw);
      const dz = Math.max(0, Math.abs(p.z - o.position.z) - hw);
      const dy = Math.max(0, p.y - top);
      const d = Math.hypot(dx, dy, dz);
      if (d < bestD) {
        bestD = d;
        pick = { kind: 'building', e };
        obj = o;
      }
    }
    for (const e of this.queries.tanks.entities) {
      const o = e.object3D;
      if (!o || !e.getValue(Tank, 'alive') || e.getValue(Tank, 'held')) continue;
      const d = o.position.distanceTo(p) - 0.015;
      if (d < bestD) {
        bestD = d;
        pick = { kind: 'tank', e };
        obj = o;
      }
    }
    for (const car of this.cars) {
      if (car.state !== 'drive') continue;
      const d = car.obj.position.distanceTo(p) - 0.01;
      if (d < bestD) {
        bestD = d;
        pick = { kind: 'car', car };
        obj = car.obj;
      }
    }
    if (this.heli && this.heli.state === 'fly') {
      const d = this.heli.obj.position.distanceTo(p) - 0.025;
      if (d < bestD) {
        bestD = d;
        pick = { kind: 'heli', heli: this.heli };
        obj = this.heli.obj;
      }
    }
    if (!pick || !obj) return;

    let size = 0.02;
    let value = 20;
    let palette = [0x888888];
    if (pick.kind === 'building') {
      const e = pick.e;
      e.setValue(Building, 'alive', false);
      const inf = this.info.get(e.index);
      size = e.getValue(Building, 'height') ?? 0.05;
      value = e.getValue(Building, 'value') ?? 10;
      palette = inf?.palette ?? palette;
      this.destroyed++;
      this.missionEvent('building', e);
      // rip it out of the ground
      this.c.copy(obj.position);
      this.fx.explode(this.c, this.c, e.getValue(Building, 'width') ?? 0.03, 0.01, palette, 0.8);
      this.fx.puff(this.c, 0.01, 14);
      this.sfx.rip();
      this.ruins.addRuin(obj.position.x, obj.position.z, (e.getValue(Building, 'width') ?? 0.03) * 0.9, inf?.depth ?? 0.03, 0.006, [0x6b5f52, 0x8a7d6c, 0x4a4038], false);
      if (this.once('rip')) this.ticker.push('BUILDING STOLEN! "It was just... lifted," says witness');
      this.c.y += size + 0.03;
      this.score(value * 0.5, this.c, 'RIPPED ', '#ffd25a');
    } else if (pick.kind === 'tank') {
      pick.e.setValue(Tank, 'held', true);
      value = 60;
      palette = [0x6f8f3a, 0x3d4a2a];
      this.sfx.grab();
    } else if (pick.kind === 'car') {
      pick.car.state = 'held';
      value = 10;
      palette = [0xe84b4b, 0x3f8fe8, 0x2a2a2a];
      this.sfx.grab();
    } else if (pick.heli.evasive) {
      this.catchHeli();
      return;
    } else {
      pick.heli.state = 'held';
      value = 120;
      size = 0.04;
      palette = [0x4f6b4a, 0x2b332c];
      this.sfx.grab();
    }
    this.used.grab = true;
    this.flying = this.flying.filter((f) => f.obj !== obj);
    const offset = obj.position.clone().sub(p);
    if (offset.length() > size * 0.6 + 0.01) offset.setLength(size * 0.6 + 0.01);
    this.held[side] = { ref: pick, obj, offset, crushT: 0, size, value, palette };
  }

  private crush(side: Side, hd: Held) {
    this.used.crush = true;
    this.held[side] = null;
    this.c.copy(hd.obj.position);
    this.fx.explode(this.c, this.c, Math.max(0.015, hd.size * 0.4), hd.size * 0.6, hd.palette, 0.7);
    this.fx.puff(this.c, hd.size * 0.5, 16);
    this.sfx.crunch(Math.min(1, hd.size / 0.15));
    this.sfx.punch();
    this.c.y += 0.03;
    this.score(hd.value, this.c, 'CRUSHED ', '#ff8a5a');
    this.removeRef(hd.ref);
    this.checkCleared();
  }

  private release(side: Side, h: HandData) {
    const hd = this.held[side];
    if (!hd) return;
    this.held[side] = null;
    if (hd.ref.kind === 'tank') hd.ref.e.setValue(Tank, 'held', false);
    const v = this.velToLocal(h.wristVel, new Vector3());
    const max = 3 / this.city.scale.x;
    if (v.length() > max) v.setLength(max);
    this.flying.push({
      ref: hd.ref,
      obj: hd.obj,
      v,
      spin: new Vector3((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 10),
      size: hd.size,
      value: hd.value,
      palette: hd.palette,
    });
    if (hd.ref.kind === 'car') hd.ref.car.state = 'thrown';
    if (hd.ref.kind === 'heli') hd.ref.heli.state = 'thrown';
  }

  /** Hide/disable an object that was destroyed while held or flying. */
  private removeRef(ref: Ref) {
    if (ref.kind === 'building') {
      const o = ref.e.object3D;
      if (o) o.visible = false;
    } else if (ref.kind === 'tank') {
      this.hideTank(ref.e);
    } else if (ref.kind === 'car') {
      ref.car.state = 'dead';
      ref.car.respawn = 5;
      ref.car.obj.visible = false;
    } else {
      ref.heli.state = 'off';
      ref.heli.obj.visible = false;
      this.heliT = 14;
    }
  }

  private updateFlying(dt: number) {
    const g = GRAVITY / this.city.scale.x;
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const f = this.flying[i];
      f.v.y -= g * dt;
      f.obj.position.addScaledVector(f.v, dt);
      f.obj.rotation.x += f.spin.x * dt;
      f.obj.rotation.y += f.spin.y * dt;
      f.obj.rotation.z += f.spin.z * dt;
      if (f.obj.position.y > 0.004) continue;
      // impact
      this.flying.splice(i, 1);
      f.obj.position.y = 0.004;
      const p = f.obj.position;
      const radius = 0.035 + f.size * 0.4;
      this.fx.ring(p, radius * 1.4, 0xff8a3a, 0.45);
      this.fx.spark(p, 16, 0.5);
      this.sfx.boom();
      for (const e of this.queries.buildings.entities) {
        const o = e.object3D;
        if (!o || !e.getValue(Building, 'alive')) continue;
        const dx = o.position.x - p.x;
        const dz = o.position.z - p.z;
        if (dx * dx + dz * dz < radius * radius) this.smash(e, p, 1.6, 1, 'IMPACT ');
      }
      for (const car of this.cars) {
        if (car.state === 'drive' && car.obj.position.distanceTo(p) < radius) this.wreckCar(car, p);
      }
      for (const e of this.queries.tanks.entities) {
        const o = e.object3D;
        if (!o || !e.getValue(Tank, 'alive') || e.getValue(Tank, 'held')) continue;
        if (f.ref.kind === 'tank' && f.ref.e === e) continue;
        if (o.position.distanceTo(p) < radius) this.killTank(e, 50, 'BOOM ');
      }
      if (f.ref.kind === 'tank') {
        this.killTank(f.ref.e, 80, 'AIR STRIKE ');
        continue;
      }
      if (f.ref.kind === 'heli') {
        this.killHeli('HELI DOWN ');
        continue;
      }
      this.c.copy(p);
      this.fx.explode(this.c, this.c, Math.max(0.015, f.size * 0.4), f.size * 0.5, f.palette, 1.3);
      this.ruins.addRuin(p.x, p.z, Math.max(0.02, f.size * 0.35), Math.max(0.02, f.size * 0.35), f.size * 0.3, f.palette, true);
      this.ruins.addCrack(p.x, p.z, 0.05 + f.size * 0.3);
      this.hitStop(0.07);
      this.c.y += 0.04;
      if (this.canScore()) this.score(f.value, this.c, 'SPLAT ', '#ffd25a');
      this.removeRef(f.ref);
      this.checkCleared();
    }
  }

  private nearestTarget(): Vector3 | null {
    let target: Vector3 | null = null;
    let bestD = 1e9;
    for (let i = 0; i < this.tipCount; i++) {
      const d = this.localTips[i].lengthSq();
      if (d < bestD) {
        bestD = d;
        target = this.localTips[i];
      }
    }
    return target;
  }

  private updateTanks(dt: number) {
    const target = this.nearestTarget();
    for (const e of this.queries.tanks.entities) {
      if (!e.getValue(Tank, 'alive') || e.getValue(Tank, 'held')) continue;
      const o = e.object3D;
      if (!o || this.flying.some((f) => f.obj === o)) continue;
      if (this.mode !== 'playing') continue;
      const u = (e.getValue(Tank, 'angle') ?? 0) + ((e.getValue(Tank, 'speed') ?? 0.1) * dt) / (RING * 2);
      e.setValue(Tank, 'angle', u);
      this.ringPos(u + 0.01 * Math.sign(e.getValue(Tank, 'speed') ?? 1), this.a);
      this.ringPos(u, o.position);
      // tracks turn smoothly round the corners instead of snapping 90 degrees
      const want = Math.atan2(-(this.a.z - o.position.z), this.a.x - o.position.x);
      const yaw = o.rotation.y + wrapAngle(want - o.rotation.y) * Math.min(1, dt * 7);
      o.rotation.set(0, yaw, 0);
      const turret = o.getObjectByName('turret');
      const beacon = turret?.getObjectByName('beacon');
      if (beacon) beacon.visible = Math.sin(this.now * 10 + o.id) > 0;
      let cd = (e.getValue(Tank, 'cooldown') ?? 2) - dt;
      if (target && turret) {
        this.b.copy(target).sub(o.position);
        turret.rotation.y = Math.atan2(-this.b.z, this.b.x) - o.rotation.y;
        if (cd <= 0 && this.b.length() < 0.7 && !this.rebuild) {
          this.fire(this.a.copy(o.position).setY(o.position.y + 0.02), target, 0.22);
          cd = (2.2 + Math.random() * 1.6) * this.diff.fire;
        }
      }
      e.setValue(Tank, 'cooldown', cd);
    }
  }

  private updateHeli(dt: number) {
    const h = this.heli;
    if (!h || h.state === 'off') return;
    const rotor = h.obj.getObjectByName('rotor');
    const tail = h.obj.getObjectByName('tailRotor');
    if (rotor) rotor.rotation.y += dt * 40;
    if (tail) tail.rotation.z += dt * 50;
    const beacon = h.obj.getObjectByName('beacon');
    if (beacon) beacon.visible = Math.sin(this.now * 8) > 0;
    if (h.state !== 'fly') return;
    if (this.mode !== 'playing') {
      h.state = 'off';
      h.obj.visible = false;
      return;
    }
    // Steering flight: pick a waypoint, accelerate toward it, nose follows the velocity,
    // bank into turns and pitch the nose down when speeding up (like a real heli).
    const pos = h.obj.position;
    const target = this.nearestTarget();
    h.goalT -= dt;
    // evasive chopper (Heli Hunt): dart away from the closest fingertip
    let threat = 1e9;
    if (h.evasive && target) {
      threat = target.distanceTo(pos);
      if (threat < 0.17 && h.goalT > 0.25) h.goalT = 0; // re-plan right now
    }
    if (h.goalT <= 0 || pos.distanceTo(h.goal) < 0.05) {
      if (h.evasive && target && threat < 0.3) {
        this.b.copy(pos).sub(target).setY(0);
        if (this.b.lengthSq() < 1e-6) this.b.set(Math.random() - 0.5, 0, Math.random() - 0.5);
        this.b.normalize();
        // flee, with a random sideways jink so it can't be predicted
        const side = (Math.random() - 0.5) * 1.6;
        const fx = this.b.x - this.b.z * side;
        const fz = this.b.z + this.b.x * side;
        h.goal.set(pos.x + fx * 0.22, 0.07 + Math.random() * 0.15, pos.z + fz * 0.22);
        h.goal.x = Math.max(-0.3, Math.min(0.3, h.goal.x));
        h.goal.z = Math.max(-0.3, Math.min(0.3, h.goal.z));
        h.goalT = 0.6 + Math.random() * 0.5;
      } else {
        const ang = Math.random() * Math.PI * 2;
        const r = 0.08 + Math.random() * 0.2;
        h.goal.set(Math.cos(ang) * r, h.alt + (Math.random() - 0.5) * 0.06, Math.sin(ang) * r);
        h.goalT = h.evasive ? 1 + Math.random() : 3 + Math.random() * 3;
      }
    }
    const prevVx = h.vel.x;
    const prevVz = h.vel.z;
    this.a.copy(h.goal).sub(pos);
    // only Heli Hunt gets the extra-fast chopper; Missions and Rampage keep their speed
    const fast = h.evasive ? (this.game === 'heli' ? 3.3 : 2.3) * h.speed : 1;
    const maxSpeed = 0.11 * fast;
    this.a.setLength(Math.min(maxSpeed, this.a.length() * 1.2 * Math.sqrt(fast))).sub(h.vel); // desired - current
    const maxAcc = 0.12 * fast * fast * dt;
    if (this.a.length() > maxAcc) this.a.setLength(maxAcc);
    h.vel.add(this.a);
    pos.addScaledVector(h.vel, dt);
    pos.y += Math.sin(this.now * 1.7) * 0.004 * dt;
    // keep it above the city
    pos.x = Math.max(-0.45, Math.min(0.45, pos.x));
    pos.z = Math.max(-0.45, Math.min(0.45, pos.z));

    const hs = Math.hypot(h.vel.x, h.vel.z);
    // when slow, turn to face the target (to aim); otherwise face where it flies
    let wantYaw = h.yaw;
    if (hs > 0.02) wantYaw = Math.atan2(-h.vel.z, h.vel.x);
    else if (target) wantYaw = Math.atan2(-(target.z - pos.z), target.x - pos.x);
    const dYaw = wrapAngle(wantYaw - h.yaw) * Math.min(1, dt * (h.evasive ? 7 : 2.5));
    h.yaw += dYaw;
    // bank (roll) into the turn, pitch with forward acceleration
    const turnRate = dt > 0 ? dYaw / dt : 0;
    const fwdAcc = dt > 0 ? ((h.vel.x - prevVx) * Math.cos(h.yaw) - (h.vel.z - prevVz) * Math.sin(h.yaw)) / dt : 0;
    h.bank += (Math.max(-0.5, Math.min(0.5, -turnRate * 0.35)) - h.bank) * Math.min(1, dt * 4);
    h.pitch += (-Math.max(-0.3, Math.min(0.3, hs * 1.6 + fwdAcc * 0.8)) - h.pitch) * Math.min(1, dt * 3);
    // Euler order YXZ: yaw, then roll (about the nose axis X), then pitch (about the side axis Z)
    h.obj.rotation.set(h.bank, h.yaw, h.pitch);

    h.cd -= dt;
    if (target && h.cd <= 0 && target.distanceTo(pos) < 0.6 && !this.rebuild) {
      // only shoot roughly forward
      const toT = Math.atan2(-(target.z - pos.z), target.x - pos.x);
      if (Math.abs(wrapAngle(toT - h.yaw)) < 1.2) {
        this.a.set(Math.cos(h.yaw) * 0.02, -0.012, -Math.sin(h.yaw) * 0.02).add(pos);
        this.fire(this.a, target, 0.3);
        h.cd = (1.6 + Math.random() * 1.2) * this.diff.fire;
      }
    }
  }

  private updateCars(dt: number) {
    const lim = HALF + TILE * 0.3;
    for (const car of this.cars) {
      const o = car.obj;
      if (car.state === 'dead') {
        car.respawn -= dt;
        if (car.respawn <= 0) {
          car.state = 'drive';
          car.pos = -Math.sign(car.speed);
          o.scale.set(1, 1, 1);
          o.rotation.set(0, 0, 0);
          o.visible = true;
        }
        continue;
      }
      if (car.state !== 'drive') continue;
      // emergency vehicles light up and race once the attack starts
      const alarm = car.emergency && this.mode === 'playing';
      if (car.sirens.length === 2) {
        const ph = Math.floor((this.now + car.line * 7) * 6) % 2 === 0;
        car.sirens[0].material = alarm ? (ph ? sirenRedMat : sirenOffMat) : sirenOffMat;
        car.sirens[1].material = alarm ? (ph ? sirenOffMat : sirenBlueMat) : sirenOffMat;
      }
      car.pos += ((alarm ? car.speed * 2.1 : car.speed) * dt) / lim;
      if (car.pos > 1) car.pos = -1;
      if (car.pos < -1) car.pos = 1;
      const along = car.pos * lim;
      let hy = 0.002;
      let tilt = 0;
      const hop = this.carHop.get(car);
      if (hop !== undefined) {
        const t = hop - dt;
        if (t <= 0) this.carHop.delete(car);
        else {
          this.carHop.set(car, t);
          hy += Math.abs(Math.sin(t * 22)) * 0.006 * t;
          tilt = Math.sin(t * 31) * 0.25 * t;
        }
      }
      // drive off / onto the edge of the table: shrink instead of popping
      const edge = Math.min(1, (1 - Math.abs(car.pos)) / 0.06);
      o.scale.setScalar(Math.max(0.001, edge));
      if (car.axis === 'x') {
        o.position.set(along, hy, car.line);
        o.rotation.set(tilt, car.speed > 0 ? Math.PI / 2 : -Math.PI / 2, tilt * 0.5);
      } else {
        o.position.set(car.line, hy, along);
        o.rotation.set(tilt, car.speed > 0 ? 0 : Math.PI, tilt * 0.5);
      }
    }
  }

  private playAnim(p: Person, name: string, fade = 0.2) {
    if (p.current === name) return;
    const next = p.actions[name];
    if (!next) return;
    p.actions[p.current]?.fadeOut(fade);
    next.reset().fadeIn(fade).play();
    p.current = name;
  }

  /** Choose the next sidewalk node. Calm: mostly straight on, sometimes turn or cross.
   *  Fleeing: the neighbour that leads furthest from the threat. */
  private pickNext(p: Person, threatX: number, threatZ: number, flee: boolean) {
    const cx = p.tx;
    const cz = p.tz;
    const dirX = Math.sign(cx - p.fx);
    const dirZ = Math.sign(cz - p.fz);
    let best = -1e9;
    let bx = cx;
    let bz = cz;
    for (let k = 0; k < 4; k++) {
      const nx = cx + (k === 0 ? 1 : k === 1 ? -1 : 0);
      const nz = cz + (k === 2 ? 1 : k === 3 ? -1 : 0);
      if (nx < 0 || nz < 0 || nx >= SW_N || nz >= SW_N) continue;
      const back = nx === p.fx && nz === p.fz && (dirX !== 0 || dirZ !== 0);
      let score: number;
      if (flee) {
        score = Math.hypot(SIDEWALK[nx] - threatX, SIDEWALK[nz] - threatZ) * 10 + Math.random() * 0.3;
      } else {
        const straight = Math.sign(nx - cx) === dirX && Math.sign(nz - cz) === dirZ;
        // pairs (2i, 2i+1) are the two kerbs of one road: moving between them is a crossing
        const crossing = nx !== cx ? Math.min(nx, cx) % 2 === 0 : Math.min(nz, cz) % 2 === 0;
        score = (straight ? 3 : 1.4) * (crossing ? 0.45 : 1) * Math.random();
        if (back) score *= 0.05;
      }
      if (score > best) {
        best = score;
        bx = nx;
        bz = nz;
      }
    }
    if (!flee || bx !== cx || bz !== cz) {
      p.fx = cx;
      p.fz = cz;
    }
    p.tx = bx;
    p.tz = bz;
  }

  private updatePeople(dt: number) {
    for (const p of this.people) {
      p.mixer.update(dt);
      const o = p.obj;
      // nearest low hand point
      let near = 1e9;
      let nx = 0;
      let nz = 0;
      for (let i = 0; i < this.tipCount; i++) {
        const t = this.localTips[i];
        if (t.y > 0.12) continue;
        const d = Math.hypot(t.x - o.position.x, t.z - o.position.z);
        if (d < near) {
          near = d;
          nx = t.x;
          nz = t.z;
        }
      }

      if (p.state === 'down') {
        // sliding to a stop on the ground
        o.position.x += p.vx * dt;
        o.position.z += p.vz * dt;
        const f = Math.max(0, 1 - dt * 5);
        p.vx *= f;
        p.vz *= f;
        o.position.x = Math.max(-HALF, Math.min(HALF, o.position.x));
        o.position.z = Math.max(-HALF, Math.min(HALF, o.position.z));
        o.position.y = 0.004;
        o.rotation.y = p.yaw;
        p.stateT -= dt;
        if (p.stateT <= 0) {
          p.state = 'getup';
          p.stateT = 0.45;
          this.playAnim(p, 'idle', 0.4);
        }
        continue;
      }
      if (p.state === 'getup') {
        p.stateT -= dt;
        if (p.stateT > 0) continue;
        // walk back to the nearest sidewalk node, then carry on in a panic
        p.state = 'walk';
        p.scared = 3;
        let bi = 0;
        let bj = 0;
        let bd = 1e9;
        for (let i = 0; i < SW_N; i++)
          for (let j = 0; j < SW_N; j++) {
            const d = Math.hypot(SIDEWALK[i] - o.position.x, SIDEWALK[j] - o.position.z);
            if (d < bd) {
              bd = d;
              bi = i;
              bj = j;
            }
          }
        p.fx = p.tx = bi;
        p.fz = p.tz = bj;
        p.tx = bi;
        p.tz = bj;
      }

      // jump when a finger comes really close
      if (p.jumpT > 0) {
        p.jumpT -= dt;
      } else if (near < 0.018 && this.canScore()) {
        p.jumpT = 0.6;
        this.playAnim(p, 'jump', 0.08);
        this.c.copy(o.position).setY(0.03);
        this.fx.popup(this.c, 'EEK!', '#ffffff');
      }
      if (near < 0.1) {
        if (p.scared <= 0 || near < 0.05) {
          if (p.state === 'idle') p.state = 'walk';
          this.pickNext(p, nx, nz, true);
        }
        p.scared = 2.5;
      }
      p.scared = Math.max(0, p.scared - dt);
      const running = p.scared > 0;

      if (p.state === 'idle') {
        p.stateT -= dt;
        if (p.stateT <= 0) p.state = 'walk';
        else {
          if (p.jumpT <= 0 && p.current !== 'emote-yes' && p.current !== 'interact-right') this.playAnim(p, 'idle', 0.3);
          continue;
        }
      }

      // walk toward the target node
      const gx = SIDEWALK[p.tx];
      const gz = SIDEWALK[p.tz];
      const dx = gx - o.position.x;
      const dz = gz - o.position.z;
      const dist = Math.hypot(dx, dz);
      const speed = running ? 0.055 : p.speed;
      if (dist < 0.002) {
        o.position.x = gx;
        o.position.z = gz;
        // sometimes stop for a chat / a look around (only when calm)
        if (!running && Math.random() < 0.18) {
          p.state = 'idle';
          p.stateT = 1.5 + Math.random() * 2.5;
          this.playAnim(p, Math.random() < 0.5 ? 'emote-yes' : 'idle', 0.3);
        }
        this.pickNext(p, nx, nz, running && near < 0.2);
        continue;
      }
      const step = Math.min(dist, speed * dt);
      o.position.x += (dx / dist) * step;
      o.position.z += (dz / dist) * step;
      o.position.y = 0.004;
      // smooth turn toward the walking direction (model faces +Z)
      const want = Math.atan2(dx, dz);
      p.yaw += wrapAngle(want - p.yaw) * Math.min(1, dt * (running ? 14 : 8));
      o.rotation.y = p.yaw;
      if (p.jumpT <= 0) this.playAnim(p, running ? 'sprint' : 'walk');
    }
  }

  private updateQuakeFx(dt: number) {
    this.shakeT = Math.max(0, this.shakeT - dt);
    for (let i = this.wobbles.length - 1; i >= 0; i--) {
      const w = this.wobbles[i];
      if (!w.e.getValue(Building, 'alive')) {
        this.wobbles.splice(i, 1); // smashed or grabbed: someone else owns its rotation now
        continue;
      }
      w.t += dt;
      const decay = Math.max(0, 1 - w.t / 1.6);
      const a = w.amp * decay * decay;
      w.obj.rotation.x = Math.sin(w.t * 19 + w.phase) * a;
      w.obj.rotation.z = Math.cos(w.t * 16 + w.phase) * a * 0.8;
      if (decay <= 0) {
        w.obj.rotation.x = 0;
        w.obj.rotation.z = 0;
        this.wobbles.splice(i, 1);
      }
    }
  }

  private fire(from: Vector3, target: Vector3, speed: number) {
    const s = this.shells.find((x) => !x.active);
    if (!s) return;
    s.active = true;
    s.life = 3.5;
    s.mesh.visible = true;
    s.mesh.position.copy(from);
    s.v.copy(target).sub(s.mesh.position).setLength(speed);
    this.fx.spark(s.mesh.position, 4, 0.15, 0xffc040);
    this.sfx.shot();
  }

  private updateShells(dt: number) {
    const hero = this.camp.phase === 'play';
    const hitR = hero ? this.hero.radius * 1.8 : 0.022 / this.city.scale.x;
    for (const s of this.shells) {
      if (!s.active) continue;
      s.life -= dt;
      s.mesh.position.addScaledVector(s.v, dt);
      let hit = false;
      for (let i = 0; i < this.tipCount; i++) {
        if (this.localTips[i].distanceTo(s.mesh.position) < hitR) {
          hit = true;
          break;
        }
      }
      if (hit) {
        if (hero) {
          this.hero.hurt();
          this.shakeT = 0.3;
          this.shakeAmp = this.settings.values.shake ? 0.002 : 0;
        }
        this.hp = Math.max(0, this.hp - this.diff.dmg * (hero ? 0.75 : 1));
        this.hurtT = 0.35;
        this.fx.spark(s.mesh.position, 12, 0.35, 0xff4040);
        this.c.copy(s.mesh.position).setY(s.mesh.position.y + 0.02);
        this.fx.popup(this.c, 'OUCH!', '#ff5a5a');
        this.sfx.ouch();
      }
      if (hit || s.life <= 0 || s.mesh.position.y < 0) {
        s.active = false;
        s.mesh.visible = false;
      }
    }
  }

  private updateHud() {
    const m = this.hud.mesh;
    m.visible = this.camp.phase === 'off' || this.mode === 'searching' || this.mode === 'loading';
    if (this.mode === 'searching' || (this.mode === 'loading' && this.wasImmersive)) {
      this.player.head.getWorldQuaternion(m.quaternion);
      this.a.set(0, -0.05, -0.6).applyQuaternion(m.quaternion);
      m.position.copy(this.head).add(this.a);
    } else {
      this.a.set(0, 0.3, -HALF - 0.08);
      this.city.localToWorld(m.position.copy(this.a));
      this.b.copy(this.head);
      this.b.y = m.position.y + (this.head.y - m.position.y) * 0.6;
      m.lookAt(this.b);
    }
    // news ticker hangs just under the scoreboard
    const t = this.ticker.mesh;
    t.quaternion.copy(m.quaternion);
    this.a.set(0, -0.094, 0.001).applyQuaternion(m.quaternion);
    t.position.copy(m.position).add(this.a);
    t.visible = this.ticker.enabled && this.mode !== 'loading' && this.mode !== 'searching' && this.camp.phase === 'off';
    this.hud.draw({
      mode: this.mode,
      damage: this.damage,
      best: this.best,
      time: this.time,
      hp: this.hp,
      combo: this.now - this.lastSmash < 0.9 ? Math.min(this.combo, 5) : 0,
      destroyed: this.destroyed,
      total: this.total,
      title: this.title,
      grade: this.grade,
      wave: this.wave,
      game: this.game,
      countdown: this.countdown,
      catches: this.catches,
      lives: this.lives,
      cleared: this.cleared,
      mission: this.mission ? this.mission.text : this.game === 'missions' && this.mode === 'playing' && this.countdown <= 0 ? 'GET READY...' : '',
      missionLeft: this.mission ? Math.max(0, 1 - this.mission.t / this.mission.max) : 0,
      missionProgress: this.mission && this.mission.id !== 'hands' ? `${Math.min(this.mission.progress, this.mission.need)}/${this.mission.need}` : '',
      newBest: this.newBest,
      busy: !!this.rebuild || this.pendingStart,
      level: this.progress.level,
      levelTitle: this.progress.title,
      xpFrac: this.progress.levelFrac,
      daily: this.progress.daily.text,
      dailyDone: this.progress.dailyDoneToday,
      streak: this.progress.liveStreak,
      xpLines: this.lastResult?.lines.join('   ') ?? '',
      hint: this.mode === 'ready' && this.wasImmersive ? 'Grab, crush, throw | 2-hand pinch = zoom' : undefined,
    });
  }

  /* =====================================================================
   * CAMPAIGN (Moss-style): one hero walks the streets, the city is a diorama
   * you can zoom into. Levels have one goal, a par time and a no-casualty star.
   * ===================================================================== */

  private openCampaignSelect() {
    if (this.camp.phase === 'off') this.camp.prevMode = this.game === 'campaign' ? 'rampage' : this.game;
    this.game = 'campaign';
    this.camp.phase = 'select';
    this.camp.goTo = null;
    this.camp.goEntity = null;
    this.zoomT = 1;
    this.hero.root.visible = false;
    for (const mk of this.markers) mk.visible = false;
    this.cui.drawLevelCards(this.csave);
    if (this.destroyed > 0 || this.cityGone || this.ruins.burning > 0 || this.theme !== LEVELS[0].theme) {
      this.startRebuild(LEVELS[0].theme, false);
    }
    this.cityGone = false;
    this.resetRound(false);
    this.hero.preload(formForLevel(1));
    this.sfx.combo(2);
  }

  private leaveCampaign() {
    this.camp.phase = 'off';
    this.game = this.camp.prevMode;
    this.zoomT = this.zoomV = 1;
    this.focus.set(0, 0, 0);
    this.sunTarget.position.set(0, 0, 0);
    this.city.scale.setScalar(1);
    this.city.rotation.set(0, this.anchorYaw, 0);
    this.city.position.copy(this.anchor);
    for (const mk of this.markers) mk.visible = false;
    for (const b of this.cui.buttons) b.plane.mesh.visible = false;
    this.cui.board.mesh.visible = false;
    this.hero.root.visible = false;
    this.bubble.radius.value = 0;
    this.resetRound(false);
    this.refreshMenu();
  }

  private onCampaignPick(p: UiPick) {
    this.sfx.unlock();
    if (p.kind === 'zoom') {
      this.zoomT = Math.min(6, Math.max(1, this.zoomT * (p.dir > 0 ? 1.5 : 1 / 1.5)));
      this.sfx.pop();
      return;
    }
    if (this.pendingStart || this.rebuild) return;
    if (p.kind === 'level') {
      if (this.camp.phase === 'select' && this.csave.unlocked(p.i)) this.startLevel(p.i);
      return;
    }
    if (this.camp.phase !== 'won' && this.camp.phase !== 'lost' && p.kind !== 'back') return;
    if (p.kind === 'retry') this.startLevel(this.camp.level);
    else if (p.kind === 'next') {
      const n = this.camp.level + 1;
      if (n < LEVELS.length && this.csave.unlocked(n)) this.startLevel(n);
      else this.openCampaignSelect();
    } else if (p.kind === 'levels') this.openCampaignSelect();
    else if (p.kind === 'back') this.leaveCampaign();
  }

  private startLevel(i: number) {
    const L = LEVELS[i];
    this.game = 'campaign';
    this.camp.level = i;
    this.camp.phase = 'intro';
    this.camp.hurt = 0;
    this.camp.stars = 0;
    this.camp.shown = 0;
    this.camp.revealT = 0;
    this.camp.reason = '';
    this.camp.progress = { marked: 0, buildings: 0, cars: 0, tanks: 0 };
    this.camp.targets = [];
    this.camp.hits.clear();
    this.camp.goTo = null;
    this.camp.goEntity = null;
    this.camp.goActor = null;
    this.camp.carry = null;
    this.camp.tankT = 3;
    this.camp.heliT = 10;
    this.camp.held = null;
    this.camp.throws.length = 0;
    this.camp.seeds = 0;
    this.camp.powerT = 0;
    this.camp.godT = 0;
    this.camp.autoChew = false;
    this.policeCd.clear();
    const form = formForLevel(L.n);
    this.camp.newForm = form.level === L.n && L.n > 1 ? form.name : '';
    void this.hero.setForm(form);
    if (i + 1 < LEVELS.length) this.hero.preload(formForLevel(LEVELS[i + 1].n));
    // a fresh city grows for every attempt
    this.startRebuild(L.theme, false);
    this.resetRound(false);
    this.hero.root.visible = false;
    this.pendingStart = true;
    this.zoomT = Math.max(this.zoomT, 1);
    this.sfx.start();
  }

  /** the new city has grown: drop the hero in and pick the targets */
  private campaignSetup() {
    const L = LEVELS[this.camp.level];
    const form = this.hero.form;
    this.heroPos.set(0, 0, ROAD_LINES[3]);
    this.hero.yaw = Math.PI;
    this.hero.root.position.copy(this.heroPos);
    this.hero.root.visible = true;
    this.hero.carried = false;
    this.focus.copy(this.heroPos);
    this.fx.ring(this.heroPos, 0.06, 0xffffff, 0.6);
    this.fx.puff(this.heroPos, 0.01, 12);
    this.sfx.roar(0.6);
    const need = L.goal.marked ?? 0;
    if (need > 0) {
      const cands: { e: Entity; d: number }[] = [];
      for (const e of this.queries.buildings.entities) {
        const o = e.object3D;
        if (!o) continue;
        const h = e.getValue(Building, 'height') ?? 0;
        if (h > form.power || h < (L.markedMin ?? 0)) continue;
        cands.push({ e, d: Math.hypot(o.position.x - this.heroPos.x, o.position.z - this.heroPos.z) + Math.random() * 0.05 });
      }
      cands.sort((a, b) => a.d - b.d);
      // spread them out a bit: skip candidates right next to an already chosen one
      for (const c of cands) {
        if (this.camp.targets.length >= need) break;
        const o = c.e.object3D!;
        if (this.camp.targets.some((t) => t.object3D!.position.distanceTo(o.position) < 0.06)) continue;
        this.camp.targets.push(c.e);
      }
      for (const c of cands) {
        if (this.camp.targets.length >= need) break;
        if (!this.camp.targets.includes(c.e)) this.camp.targets.push(c.e);
      }
    }
    if (this.zoomT < 1.8) this.zoomT = 2.2;
    this.spawnSeeds();
    this.hero.root.position.y = 0;
    this.hero.airborne = false;
    this.bubble.patch(this.city);
    for (const m of [sirenRedMat, sirenBlueMat, sirenOffMat]) this.bubble.patchMaterial(m);
    this.hp = 100;
  }

  private campaignEnd(win: boolean, reason: string) {
    if (this.camp.phase !== 'play') return;
    const L = LEVELS[this.camp.level];
    this.mode = 'over';
    this.overT = 0;
    this.camp.phase = win ? 'won' : 'lost';
    this.camp.reason = reason;
    this.camp.goTo = null;
    this.camp.goEntity = null;
    const used = L.limit - this.time;
    let stars = 0;
    if (win) stars = 1 + (used <= L.par ? 1 : 0) + (this.camp.hurt === 0 ? 1 : 0);
    this.camp.stars = stars;
    this.camp.shown = 0;
    this.camp.revealT = -0.6;
    const wasLocked = this.camp.level + 1 < LEVELS.length && !this.csave.unlocked(this.camp.level + 1);
    if (win) this.csave.record(this.camp.level, stars, used);
    this.camp.newForm = '';
    if (win && wasLocked) {
      const nf = formForLevel(LEVELS[this.camp.level + 1].n);
      if (nf.level === LEVELS[this.camp.level + 1].n) this.camp.newForm = nf.name;
    }
    for (const mk of this.markers) mk.visible = false;
    this.camp.godT = 0;
    this.hero.chew = 0;
    if (this.camp.held) {
      const hd = this.camp.held;
      hd.obj.position.set(hd.obj.position.x, 0.002, hd.obj.position.z);
      hd.obj.rotation.set(0, 0, 0);
      hd.obj.scale.setScalar(1);
      if (hd.car) hd.car.state = 'drive';
      if (hd.tank) hd.tank.setValue(Tank, 'held', false);
      this.camp.held = null;
    }
    if (this.heli && this.heli.state !== 'off') {
      this.heli.state = 'off';
      this.heli.obj.visible = false;
    }
    for (const e of this.queries.tanks.entities) if (e.getValue(Tank, 'alive')) this.hideTank(e);
    for (const sh of this.shells) {
      sh.active = false;
      sh.mesh.visible = false;
    }
    if (win) {
      this.hero.celebrate();
      this.sfx.roar(1);
      this.fx.ring(this.heroPos, 0.12, 0xffcf3a, 0.8);
    }
    this.sfx.end(win);
    this.sfx.music('calm', 3);
    this.sfx.musicLevel(0.2);
    this.cui.drawLevelCards(this.csave);
    this.refreshMenu();
  }

  /** smash() hook: count it, and hurt anyone standing where it falls */
  private campaignBuilding(e: Entity, o: Object3D, w: number, d: number) {
    if (this.camp.phase !== 'play') return;
    const ti = this.camp.targets.indexOf(e);
    if (ti >= 0) this.camp.progress.marked++;
    else this.camp.progress.buildings++;
    const r = Math.max(w, d) * 0.62;
    for (const p of this.people) {
      if (p.state === 'down') continue;
      if (Math.hypot(p.obj.position.x - o.position.x, p.obj.position.z - o.position.z) < r) this.hurtPerson(p, o.position);
    }
  }

  private hurtPerson(p: Person, from: Vector3) {
    if (p.state === 'down') return;
    p.state = 'down';
    p.stateT = 3 + Math.random();
    const dx = p.obj.position.x - from.x;
    const dz = p.obj.position.z - from.z;
    const d = Math.max(0.004, Math.hypot(dx, dz));
    p.vx = (dx / d) * 0.05;
    p.vz = (dz / d) * 0.05;
    p.yaw = Math.atan2(-dx, -dz);
    this.playAnim(p, 'die', 0.08);
    if (this.camp.phase === 'play') {
      this.camp.hurt++;
      this.c.copy(p.obj.position).setY(0.04);
      this.fx.popup(this.c, 'OUCH! -★', '#ff6a6a');
      this.sfx.scream(1);
      this.sfx.ouch();
    }
  }

  /** Zoom + follow: the city slides under the anchor so the hero stays in front of you. */
  private campaignCamera(dt: number) {
    if (this.camp.phase === 'off') {
      this.bubble.radius.value = 0;
      this.bubble.rim.visible = false;
      this.fx.textScale = 1;
      return;
    }
    // controller: right stick up/down zooms, a held grip moves the whole diorama
    const rp = this.input.gamepads.right;
    if (rp) {
      const ax = rp.getAxesValues(InputComponent.Thumbstick);
      if (ax && Math.abs(ax.y) > 0.5) this.zoomT = Math.min(6, Math.max(1, this.zoomT * (1 - ax.y * dt * 1.6)));
      this.updatePlacing(rp.getButtonPressed(InputComponent.Squeeze));
    }
    const kb = this.input.keyboard;
    if (kb.getKeyPressed('Equal') || kb.getKeyPressed('NumpadAdd')) this.zoomT = Math.min(6, this.zoomT * (1 + dt * 1.6));
    if (kb.getKeyPressed('Minus') || kb.getKeyPressed('NumpadSubtract')) this.zoomT = Math.max(1, this.zoomT * (1 - dt * 1.6));

    const zv = this.zoomV + (this.zoomT - this.zoomV) * Math.min(1, dt * 4);
    this.zoomV = zv;
    const follow = this.camp.phase === 'select' ? 0 : Math.min(1, Math.max(0, (zv - 1) / 1.2));
    this.a.copy(this.heroPos).setY(0).multiplyScalar(follow);
    // keep the diorama cut inside the city
    const lim = Math.max(0, HALF - 0.2 / zv);
    this.a.x = Math.max(-lim, Math.min(lim, this.a.x));
    this.a.z = Math.max(-lim, Math.min(lim, this.a.z));
    this.focus.lerp(this.a, Math.min(1, dt * 5));
    this.qYaw.setFromAxisAngle(this.b.set(0, 1, 0), this.anchorYaw);
    this.city.rotation.set(0, this.anchorYaw, 0);
    this.city.scale.setScalar(zv);
    this.a.copy(this.focus).multiplyScalar(zv).applyQuaternion(this.qYaw);
    this.city.position.copy(this.anchor).sub(this.a);
    this.sunTarget.position.copy(this.focus);
    // diorama cut once the city is bigger than the "bubble"
    const R = 0.36;
    this.bubble.radius.value = HALF * zv > R + 0.04 ? R : 0;
    this.bubble.center.copy(this.anchor);
    this.bubble.update(dt, this.anchor.y, 0.035);
    this.fx.textScale = 1 / Math.pow(zv, 0.75);
  }

  /** controller grip: point at any surface (table, shelf, aquarium lid...) and let go to move the city there */
  private updatePlacing(grip: boolean) {
    if (grip && !this.placing) {
      this.placing = true;
      this.reticleEntity.addComponent(EnvironmentRaycastTarget, { space: RaycastSpace.Right, maxDistance: 4 });
    } else if (!grip && this.placing) {
      this.placing = false;
      if (this.reticle.visible) {
        this.reticle.getWorldPosition(this.a);
        this.player.head.getWorldPosition(this.head);
        this.anchor.copy(this.a);
        this.anchorYaw = Math.atan2(this.head.x - this.a.x, this.head.z - this.a.z);
        this.placed = true;
        this.fx.ring(this.c.copy(this.focus), 0.3, 0x6fe08a, 0.6);
        this.sfx.start();
      }
      this.reticleEntity.removeComponent(EnvironmentRaycastTarget);
      this.reticle.visible = false;
    }
  }

  /** Hands in the campaign: pinch the hero to carry him, pinch the ground to send him,
   *  pinch a building to make him smash it, two-hand pinch to zoom, pinch-hold to move the city. */
  private campaignHands(dt: number) {
    void dt;
    const L = this.hands.hands.left;
    const R = this.hands.hands.right;
    // the hero is the only "target" for tanks, shells and frightened people
    this.localTips[0].copy(this.heroPos).setY(this.hero.form.height * 0.6);
    this.tipSide[0] = 'right';
    this.tipCount = this.camp.phase === 'play' || this.camp.phase === 'intro' ? 1 : 0;

    if (L.tracked && R.tracked && L.pinch && R.pinch && !this.camp.carry) {
      const d = L.pinchPoint.distanceTo(R.pinchPoint);
      if (!this.pinchZoom) this.pinchZoom = { d0: Math.max(0.04, d), z0: this.zoomT };
      this.zoomT = Math.min(6, Math.max(1, (this.pinchZoom.z0 * d) / this.pinchZoom.d0));
      L.pinchHeld = R.pinchHeld = -10;
      return;
    }
    if (this.pinchZoom && !(L.pinch && R.pinch)) this.pinchZoom = null;

    for (const side of SIDES) {
      const h = this.hands.hands[side];
      if (!h.tracked) {
        if (this.camp.carry === side) this.dropHero();
        continue;
      }
      // move the whole diorama: pinch & hold while no level is running
      const idle = this.camp.phase === 'select' || this.camp.phase === 'won' || this.camp.phase === 'lost';
      if (idle && h.pinchHeld > 1.1) {
        this.player.head.getWorldPosition(this.head);
        this.anchor.copy(h.pinchPoint);
        this.anchor.y -= 0.012;
        this.anchorYaw = Math.atan2(this.head.x - this.anchor.x, this.head.z - this.anchor.z);
        h.pinchHeld = -10;
        this.fx.ring(this.c.copy(this.focus), 0.3, 0x6fe08a, 0.6);
        this.sfx.start();
        continue;
      }
      if (this.camp.phase !== 'play') continue;
      this.toLocal(h.pinchPoint, this.a);
      if (this.camp.carry === side) {
        if (h.pinch) {
          this.heroPos.set(this.a.x, 0, this.a.z);
          this.hero.root.position.set(this.a.x, Math.max(0, this.a.y - this.hero.form.height * 0.95), this.a.z);
        } else this.dropHero();
        continue;
      }
      if (!h.pinchStart) continue;
      const hh = this.hero.form.height;
      const dHero = Math.hypot(this.a.x - this.heroPos.x, this.a.z - this.heroPos.z);
      if (dHero < Math.max(hh * 0.6, 0.012) && this.a.y < hh * 1.4 && this.a.y > -0.01) {
        this.camp.carry = side;
        this.hero.carried = true;
        this.camp.goTo = null;
        this.camp.goEntity = null;
        this.sfx.grab();
        continue;
      }
      if (this.a.y > 0.3 || this.a.y < -0.02) continue;
      // pinched a building? walk over and smash it
      let pick: Entity | null = null;
      for (const e of this.queries.buildings.entities) {
        if (!e.getValue(Building, 'alive')) continue;
        const o = e.object3D;
        if (!o) continue;
        const hw = (e.getValue(Building, 'width') ?? 0.03) / 2 + 0.004;
        if (Math.abs(this.a.x - o.position.x) < hw && Math.abs(this.a.z - o.position.z) < hw && this.a.y < (e.getValue(Building, 'height') ?? 0.05) + 0.01) {
          pick = e;
          break;
        }
      }
      this.camp.path.length = 0;
      this.camp.goActor = null;
      let actor: Object3D | null = null;
      let ad = 0.02;
      for (const car of this.cars) {
        if (car.state !== 'drive') continue;
        const d = Math.hypot(car.obj.position.x - this.a.x, car.obj.position.z - this.a.z);
        if (d < ad && this.a.y < 0.04) {
          ad = d;
          actor = car.obj;
        }
      }
      for (const e of this.queries.tanks.entities) {
        const o = e.object3D;
        if (!o || !e.getValue(Tank, 'alive')) continue;
        const d = Math.hypot(o.position.x - this.a.x, o.position.z - this.a.z);
        if (d < ad + 0.01 && this.a.y < 0.05) {
          ad = d;
          actor = o;
        }
      }
      if (actor) {
        this.camp.goActor = actor;
        this.camp.goEntity = null;
        this.camp.goTo = actor.position.clone().setY(0);
        this.fx.ring(this.c.copy(this.camp.goTo).setY(0.001), 0.02, 0xff8a5a, 0.45);
        this.sfx.pop();
        continue;
      }
      if (pick) {
        this.camp.goEntity = pick;
        this.camp.goTo = pick.object3D!.position.clone().setY(0);
        this.wobble(pick, pick.object3D!, 0.03, 0);
      } else if (this.a.y < 0.025) {
        this.camp.goEntity = null;
        this.camp.goTo = new Vector3(this.a.x, 0, this.a.z);
      } else continue;
      this.fx.ring(this.c.copy(this.camp.goTo).setY(0.001), 0.02, 0x9ef0ff, 0.45);
      this.sfx.pop();
    }
  }

  private dropHero() {
    this.camp.carry = null;
    this.hero.carried = false;
    this.fx.puff(this.heroPos, 0.004, 6);
    this.sfx.pop();
    this.hero.airborne = true;
    this.hero.vy = 0;
  }

  private grid = new Uint8Array(0);
  private prev = new Int32Array(0);
  /** Breadth-first search over a fine grid of the city: walk around the buildings, not through them. */
  private planPath(goal: Vector3, ignore: Entity | null) {
    const N = 66;
    const cell = (HALF * 2) / N;
    if (this.grid.length !== N * N) {
      this.grid = new Uint8Array(N * N);
      this.prev = new Int32Array(N * N);
    }
    const g = this.grid;
    g.fill(0);
    const r = this.hero.radius * 0.95;
    const idx = (v: number) => Math.max(0, Math.min(N - 1, Math.floor((v + HALF) / cell)));
    for (const e of this.queries.buildings.entities) {
      if (e === ignore || !e.getValue(Building, 'alive')) continue;
      const o = e.object3D;
      if (!o) continue;
      const half = ((e.getValue(Building, 'width') ?? 0.03) / 2) * 0.9 + r;
      for (let i = idx(o.position.x - half); i <= idx(o.position.x + half); i++)
        for (let j = idx(o.position.z - half); j <= idx(o.position.z + half); j++) g[j * N + i] = 1;
    }
    const si = idx(this.heroPos.x);
    const sj = idx(this.heroPos.z);
    const reach = ignore ? (ignore.getValue(Building, 'width') ?? 0.03) / 2 + this.hero.radius + this.hero.form.height * 0.18 : cell * 1.5;
    const prev = this.prev;
    prev.fill(-1);
    const queue: number[] = [sj * N + si];
    prev[sj * N + si] = sj * N + si;
    g[sj * N + si] = 0;
    let found = -1;
    for (let q = 0; q < queue.length; q++) {
      const c = queue[q];
      const ci = c % N;
      const cj = (c / N) | 0;
      const cx = -HALF + (ci + 0.5) * cell;
      const cz = -HALF + (cj + 0.5) * cell;
      if (Math.hypot(cx - goal.x, cz - goal.z) <= reach) {
        found = c;
        break;
      }
      for (let k = 0; k < 8; k++) {
        const di = k === 0 ? 1 : k === 1 ? -1 : k === 2 || k === 3 ? 0 : k < 6 ? 1 : -1;
        const dj = k === 2 ? 1 : k === 3 ? -1 : k < 2 ? 0 : k % 2 === 0 ? 1 : -1;
        const ni = ci + di;
        const nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
        const n = nj * N + ni;
        if (g[n] || prev[n] >= 0) continue;
        // no corner cutting
        if (di && dj && (g[cj * N + ni] || g[nj * N + ci])) continue;
        prev[n] = c;
        queue.push(n);
      }
    }
    this.camp.path.length = 0;
    if (found < 0) return false;
    const cells: number[] = [];
    for (let c = found; c !== prev[c]; c = prev[c]) cells.push(c);
    cells.reverse();
    for (let k = 0; k < cells.length; k++) {
      if (k % 3 !== 2 && k !== cells.length - 1) continue;
      const c = cells[k];
      this.camp.path.push(new Vector3(-HALF + ((c % N) + 0.5) * cell, 0, -HALF + (((c / N) | 0) + 0.5) * cell));
    }
    if (!ignore) this.camp.path.push(goal.clone());
    return true;
  }

  /** height of the roof under a point (0 = street) */
  private groundAt(x: number, z: number) {
    let g = 0;
    for (const e of this.queries.buildings.entities) {
      if (!e.getValue(Building, 'alive')) continue;
      const o = e.object3D;
      if (!o) continue;
      const half = ((e.getValue(Building, 'width') ?? 0.03) / 2) * 0.85;
      if (Math.abs(x - o.position.x) < half && Math.abs(z - o.position.z) < half) g = Math.max(g, e.getValue(Building, 'height') ?? 0);
    }
    return g;
  }

  private buildingUnder(x: number, z: number): Entity | null {
    let best: Entity | null = null;
    let bh = -1;
    for (const e of this.queries.buildings.entities) {
      if (!e.getValue(Building, 'alive')) continue;
      const o = e.object3D;
      if (!o) continue;
      const half = ((e.getValue(Building, 'width') ?? 0.03) / 2) * 0.85;
      const h = e.getValue(Building, 'height') ?? 0;
      if (Math.abs(x - o.position.x) < half && Math.abs(z - o.position.z) < half && h > bh) {
        bh = h;
        best = e;
      }
    }
    return best;
  }

  /** move with collisions (roofs you are above or can step onto don't block); returns false if blocked */
  private moveHero(dx: number, dz: number) {
    const form = this.hero.form;
    const r = this.hero.radius;
    const y = this.hero.root.position.y;
    let nx = this.heroPos.x + dx;
    let nz = this.heroPos.z + dz;
    for (const e of this.queries.buildings.entities) {
      if (!e.getValue(Building, 'alive')) continue;
      const o = e.object3D;
      if (!o) continue;
      const h = e.getValue(Building, 'height') ?? 0.05;
      if (h <= y + form.height * 0.12) continue; // on top of it, or a tiny step
      const half = ((e.getValue(Building, 'width') ?? 0.03) / 2) * 0.9;
      const cx = Math.max(o.position.x - half, Math.min(nx, o.position.x + half));
      const cz = Math.max(o.position.z - half, Math.min(nz, o.position.z + half));
      const ox = nx - cx;
      const oz = nz - cz;
      const d2 = ox * ox + oz * oz;
      if (d2 >= r * r) continue;
      // big forms just walk through small stuff
      if (form.stomp > 0 && h < form.power * form.stomp && this.canScore()) {
        this.smash(e, this.a.copy(this.heroPos).setY(0.01), 1.4, 1, 'STOMP ');
        continue;
      }
      const d = Math.sqrt(d2);
      if (d < 1e-5) {
        nx = this.heroPos.x;
        nz = this.heroPos.z;
        continue;
      }
      nx = cx + (ox / d) * r;
      nz = cz + (oz / d) * r;
    }
    const lim = HALF - r;
    nx = Math.max(-lim, Math.min(lim, nx));
    nz = Math.max(-lim, Math.min(lim, nz));
    const moved = Math.hypot(nx - this.heroPos.x, nz - this.heroPos.z);
    this.heroPos.x = nx;
    this.heroPos.z = nz;
    return moved > Math.hypot(dx, dz) * 0.3;
  }

  /** nearest car (or tank, for the bigger forms) the hamster can grab */
  private grabbable(maxD: number): { car?: Car; tank?: Entity; obj: Object3D } | null {
    let best: { car?: Car; tank?: Entity; obj: Object3D } | null = null;
    let bd = maxD;
    const fx = Math.sin(this.hero.yaw);
    const fz = Math.cos(this.hero.yaw);
    const px = this.heroPos.x + fx * this.hero.radius;
    const pz = this.heroPos.z + fz * this.hero.radius;
    for (const car of this.cars) {
      if (car.state !== 'drive') continue;
      const d = Math.hypot(car.obj.position.x - px, car.obj.position.z - pz);
      if (d < bd) {
        bd = d;
        best = { car, obj: car.obj };
      }
    }
    if (this.hero.form.lifts) {
      for (const e of this.queries.tanks.entities) {
        const o = e.object3D;
        if (!o || !e.getValue(Tank, 'alive')) continue;
        const d = Math.hypot(o.position.x - px, o.position.z - pz);
        if (d < bd) {
          bd = d;
          best = { tank: e, obj: o };
        }
      }
    }
    return best;
  }

  private tryGrabVehicle() {
    if (this.camp.held || this.hero.root.position.y > this.hero.form.height * 0.5) return false;
    const g = this.grabbable(this.hero.radius + this.hero.form.height * 0.45);
    if (!g) return false;
    if (g.car) g.car.state = 'held';
    if (g.tank) g.tank.setValue(Tank, 'held', true);
    this.camp.held = g;
    this.camp.chewT = 0;
    this.sfx.grab();
    this.c.copy(g.obj.position).setY(0.02);
    this.fx.popup(this.c, 'GOT IT!', '#9ef0ff');
    return true;
  }

  /** throw what we hold: it flies in an arc and smashes whatever it hits */
  private throwHeld() {
    const hd = this.camp.held;
    if (!hd) return;
    const s = this.hero.form.height;
    const fx = Math.sin(this.hero.yaw);
    const fz = Math.cos(this.hero.yaw);
    const k = Math.sqrt(s / 0.03);
    this.camp.throws.push({ held: hd, v: new Vector3(fx * 0.42 * k, 0.32 * k, fz * 0.42 * k), spin: new Vector3(6, 3, 9) });
    this.camp.held = null;
    this.hero.chew = 0;
    this.hero.attack('punch');
    this.sfx.rip();
  }

  private updateThrows(dt: number) {
    const g = 1.3;
    const form = this.hero.form;
    for (let i = this.camp.throws.length - 1; i >= 0; i--) {
      const t = this.camp.throws[i];
      const o = t.held.obj;
      t.v.y -= g * dt;
      o.position.addScaledVector(t.v, dt);
      o.rotation.x += t.spin.x * dt;
      o.rotation.z += t.spin.z * dt;
      let hit: 'ground' | 'building' | 'heli' | 'tank' | null = null;
      let hb: Entity | null = null;
      if (o.position.y <= 0.003) hit = 'ground';
      if (!hit) {
        for (const e of this.queries.buildings.entities) {
          if (!e.getValue(Building, 'alive')) continue;
          const bo = e.object3D;
          if (!bo) continue;
          const half = (e.getValue(Building, 'width') ?? 0.03) / 2;
          if (Math.abs(o.position.x - bo.position.x) < half && Math.abs(o.position.z - bo.position.z) < half && o.position.y < (e.getValue(Building, 'height') ?? 0)) {
            hit = 'building';
            hb = e;
            break;
          }
        }
      }
      const hl = this.heli;
      if (!hit && hl && hl.state === 'fly' && hl.obj.position.distanceTo(o.position) < 0.03 + form.height * 0.3) hit = 'heli';
      if (!hit) {
        for (const e of this.queries.tanks.entities) {
          const to = e.object3D;
          if (!to || !e.getValue(Tank, 'alive') || e === t.held.tank) continue;
          if (to.position.distanceTo(o.position) < 0.02) {
            hit = 'tank';
            hb = e;
            break;
          }
        }
      }
      if (!hit) continue;
      this.camp.throws.splice(i, 1);
      const p = this.c.copy(o.position);
      this.fx.ring(this.a.copy(p).setY(0.002), 0.05, 0xff8a3a, 0.4);
      this.fx.spark(p, 16, 0.5);
      this.sfx.boom();
      this.hitStop(0.06);
      if (hit === 'building' && hb) {
        const h = hb.getValue(Building, 'height') ?? 0.05;
        if (h <= form.power * 1.6) this.smash(hb, p, 2, 1.2, 'THROW ');
        else {
          this.wobble(hb, hb.object3D!, 0.06, 0);
          this.fx.popup(this.a.copy(p).setY(p.y + 0.02), 'TOO BIG!', '#ff8a5a');
        }
      } else if (hit === 'heli') this.killHeli('HELI DOWN ');
      else if (hit === 'tank' && hb) this.killTank(hb, 80, 'TANK HIT ');
      // people under the impact get hurt
      for (const pp of this.people) {
        if (pp.state !== 'down' && Math.hypot(pp.obj.position.x - p.x, pp.obj.position.z - p.z) < 0.02) this.hurtPerson(pp, p);
      }
      o.rotation.set(0, 0, 0);
      o.position.y = 0.002;
      if (t.held.car) this.wreckCar(t.held.car, p);
      if (t.held.tank) this.killTank(t.held.tank, 60, 'SPLAT ');
    }
  }

  /** sunflower seeds: snacks on streets and roofs (+time, +health, cheeks full = super punch) */
  private spawnSeeds() {
    const L = LEVELS[this.camp.level];
    const n = Math.min(this.seeds.length, 10 + L.n);
    const roofs = [...this.queries.buildings.entities].filter((e) => e.getValue(Building, 'alive') && (e.getValue(Building, 'height') ?? 1) < this.hero.form.height * 1.5);
    for (let i = 0; i < this.seeds.length; i++) {
      const sd = this.seeds[i];
      sd.active = i < n;
      sd.mesh.visible = sd.active;
      sd.roof = null;
      if (!sd.active) continue;
      if (i % 3 === 0 && roofs.length) {
        const e = roofs.splice(Math.floor(Math.random() * roofs.length), 1)[0];
        sd.roof = e;
        sd.pos.copy(e.object3D!.position).setY(e.getValue(Building, 'height') ?? 0);
      } else {
        sd.pos.set(SIDEWALK[Math.floor(Math.random() * SW_N)], 0, SIDEWALK[Math.floor(Math.random() * SW_N)]);
        sd.pos.x += (Math.random() - 0.5) * 0.08;
        sd.pos.x = Math.max(-HALF + 0.02, Math.min(HALF - 0.02, sd.pos.x));
      }
    }
    this.golden.active = false;
    this.golden.mesh.visible = false;
    this.camp.godSpawnAt = 18 + Math.random() * 14;
    this.camp.godDone = false;
  }

  private updateSeeds(dt: number) {
    const play = this.camp.phase === 'play';
    const hx = this.heroPos.x;
    const hz = this.heroPos.z;
    const hy = this.hero.root.position.y;
    const reach = this.hero.radius + 0.008;
    for (const sd of this.seeds) {
      if (!sd.active) continue;
      if (sd.roof && !sd.roof.getValue(Building, 'alive')) {
        sd.roof = null;
        sd.pos.y = 0;
      }
      sd.mesh.position.set(sd.pos.x, sd.pos.y + 0.004 + Math.sin(this.now * 3 + sd.pos.x * 50) * 0.0015, sd.pos.z);
      sd.mesh.rotation.y += dt * 2;
      if (!play || Math.hypot(sd.pos.x - hx, sd.pos.z - hz) > reach || Math.abs(sd.pos.y - hy) > this.hero.form.height * 0.6) continue;
      sd.active = false;
      sd.mesh.visible = false;
      this.camp.seeds++;
      this.time += 3;
      this.hp = Math.min(100, this.hp + 15);
      this.c.copy(sd.mesh.position).setY(sd.pos.y + 0.03);
      this.fx.popup(this.c, '+3s  NOM!', '#ffe9a6');
      this.fx.spark(this.c, 8, 0.2, 0xffe066);
      this.sfx.pop();
      this.sfx.combo(2 + (this.camp.seeds % 5));
      if (this.camp.seeds % 5 === 0) {
        this.camp.powerT = 8;
        this.fx.popup(this.a.copy(this.c).setY(this.c.y + 0.02), 'CHEEKS FULL! SUPER PUNCH', '#ff8a3a');
        this.sfx.roar(0.5);
      }
    }
    // the golden seed: a rare 15 s of GOD MODE (your own hands smash the city)
    const gs = this.golden;
    if (play && !this.camp.godDone && !gs.active && this.elapsed > this.camp.godSpawnAt) {
      gs.active = true;
      gs.life = 14;
      this.camp.godDone = true;
      // somewhere the hero can reach, not too far
      for (let k = 0; k < 20; k++) {
        gs.pos.set(SIDEWALK[Math.floor(Math.random() * SW_N)], 0, SIDEWALK[Math.floor(Math.random() * SW_N)]);
        if (Math.hypot(gs.pos.x - hx, gs.pos.z - hz) < 0.2) break;
      }
      this.ticker.push('A GOLDEN SEED APPEARED! Eat it for GOD MODE', true);
      this.c.copy(gs.pos).setY(0.05);
      this.fx.popup(this.c, 'GOLDEN SEED!', '#ffcf3a');
      this.sfx.zap();
    }
    if (gs.active) {
      gs.life -= dt;
      gs.mesh.visible = gs.life > 3 || Math.sin(this.now * 20) > 0;
      gs.mesh.position.set(gs.pos.x, 0.008 + Math.sin(this.now * 4) * 0.003, gs.pos.z);
      gs.mesh.rotation.y += dt * 3;
      if (gs.life <= 0) {
        gs.active = false;
        gs.mesh.visible = false;
      } else if (play && Math.hypot(gs.pos.x - hx, gs.pos.z - hz) < reach + 0.004 && hy < this.hero.form.height) {
        gs.active = false;
        gs.mesh.visible = false;
        this.camp.godT = 15;
        this.zoomT = Math.min(this.zoomT, 1.6);
        this.sfx.roar(1);
        this.sfx.start();
        this.c.copy(gs.pos).setY(0.05);
        this.fx.ring(this.c.setY(0.002), 0.25, 0xffcf3a, 0.8);
        this.fx.popup(this.a.copy(gs.pos).setY(0.06), 'GOD MODE! 15s', '#ffcf3a');
        this.coach.show('GOD MODE', [['1', 'For 15 seconds YOUR hands are the monster'], ['2', 'Punch, grab, throw, slam the table!'], ['3', 'Catch the helicopter!']], 5);
      }
    }
    if (this.camp.godT > 0) {
      this.camp.godT -= dt;
      if (this.camp.godT <= 0) {
        this.camp.godT = 0;
        for (const side of SIDES) this.held[side] = null;
        this.fx.popup(this.c.copy(this.heroPos).setY(0.05), 'GOD MODE OVER', '#d0caf5');
      }
    }
    this.camp.powerT = Math.max(0, this.camp.powerT - dt);
    this.hero.cheeks += ((this.camp.powerT > 0 ? 1 : 0) - this.hero.cheeks) * Math.min(1, dt * 6);
  }

  /** police cars and the attack helicopter shoot at the hamster */
  private updateDefense(dt: number) {
    const L = LEVELS[this.camp.level];
    if (this.camp.phase !== 'play' || !this.canScore() || this.camp.godT > 0) return;
    const tgt = this.localTips[0];
    if (L.n >= 2) {
      for (const car of this.cars) {
        if (!car.police || car.state !== 'drive') continue;
        let cd = (this.policeCd.get(car) ?? 1 + Math.random() * 2) - dt;
        const d = Math.hypot(car.obj.position.x - tgt.x, car.obj.position.z - tgt.z);
        if (cd <= 0 && d < 0.24) {
          this.fire(this.a.copy(car.obj.position).setY(0.012), tgt, 0.2);
          cd = 2.4 + Math.random() * 1.6;
          if (this.once('police')) this.ticker.push('POLICE OPEN FIRE ON GIANT HAMSTER', true);
        }
        this.policeCd.set(car, cd);
      }
    }
    // the attack helicopter joins from level 4
    const h = this.heli;
    if (L.n >= 4 && h && h.state === 'off') {
      this.camp.heliT -= dt;
      if (this.camp.heliT <= 0) {
        this.camp.heliT = 25;
        h.evasive = false;
        h.speed = 1;
        h.state = 'fly';
        h.obj.visible = true;
        h.angle = Math.random() * Math.PI * 2;
        h.alt = 0.12;
        h.cd = 3;
        h.obj.position.set(Math.cos(h.angle) * 0.5, 0.14, Math.sin(h.angle) * 0.5);
        h.yaw = Math.atan2(-h.obj.position.z, h.obj.position.x) + Math.PI;
        h.vel.set(-Math.cos(h.angle), 0, -Math.sin(h.angle)).multiplyScalar(0.12);
        h.goal.set(this.heroPos.x, h.alt, this.heroPos.z);
        h.goalT = 0;
        this.sfx.zap();
        this.ticker.push('ARMY HELICOPTER HUNTS THE HAMSTER. Throw a car at it!', true);
      }
    }
  }

  private updateHero(dt: number) {
    const ph = this.camp.phase;
    if (ph === 'off' || ph === 'select' || !this.hero.root.visible) {
      if (this.camp.phase !== 'off' && this.camp.phase !== 'select') this.hero.update(dt);
      return;
    }
    const hero = this.hero;
    const form = hero.form;
    const L = LEVELS[this.camp.level];
    let mx = 0;
    let mz = 0;
    let run = false;
    let punch = false;
    let grab = false;
    let grabHeld = false;
    let jump = false;
    const god = this.camp.godT > 0;
    if (ph === 'play' && this.canScore() && !hero.carried && !god) {
      const lp = this.input.gamepads.left;
      const rp = this.input.gamepads.right;
      const kb = this.input.keyboard;
      let sx = 0;
      let sy = 0;
      if (lp) {
        const ax = lp.getAxesValues(InputComponent.Thumbstick);
        if (ax) {
          sx = ax.x;
          sy = ax.y;
        }
        if (lp.getButtonDown(InputComponent.X_Button) || lp.getSelectStart()) grab = true;
        if (lp.getButtonPressed(InputComponent.X_Button) || lp.getSelecting()) grabHeld = true;
        if (lp.getButtonDown(InputComponent.Y_Button)) jump = true;
      }
      if (rp) {
        if (rp.getButtonDown(InputComponent.A_Button) || rp.getSelectStart()) punch = true;
        if (rp.getButtonDown(InputComponent.B_Button)) jump = true;
      }
      if (kb.getKeyPressed('KeyW') || kb.getKeyPressed('ArrowUp')) sy -= 1;
      if (kb.getKeyPressed('KeyS') || kb.getKeyPressed('ArrowDown')) sy += 1;
      if (kb.getKeyPressed('KeyA') || kb.getKeyPressed('ArrowLeft')) sx -= 1;
      if (kb.getKeyPressed('KeyD') || kb.getKeyPressed('ArrowRight')) sx += 1;
      if (kb.getKeyPressed('ShiftLeft') || kb.getKeyPressed('ShiftRight')) run = true;
      if (kb.getKeyDown('KeyJ') || kb.getKeyDown('KeyF')) punch = true;
      if (kb.getKeyDown('KeyE') || kb.getKeyDown('KeyK')) grab = true;
      if (kb.getKeyPressed('KeyE') || kb.getKeyPressed('KeyK')) grabHeld = true;
      if (kb.getKeyDown('Space')) jump = true;
      const ti = this.testInput;
      if (ti) {
        sx += ti.x;
        sy += ti.y;
        punch ||= !!ti.punch;
        run ||= !!ti.run;
        grab ||= !!ti.grab;
        grabHeld ||= !!ti.chew;
        jump ||= !!ti.jump;
        ti.punch = false;
        ti.grab = false;
        ti.jump = false;
      }
      let mag = Math.min(1, Math.hypot(sx, sy));
      if (mag > 0.15) {
        // stick directions are relative to where you look
        this.player.head.getWorldQuaternion(this.q);
        if (!this.wasImmersive) this.world.camera.getWorldQuaternion(this.q);
        this.b.set(0, 0, -1).applyQuaternion(this.q);
        this.city.getWorldQuaternion(this.qi).invert();
        this.b.applyQuaternion(this.qi);
        this.b.y = 0;
        if (this.b.lengthSq() < 1e-6) this.b.set(0, 0, -1);
        this.b.normalize();
        const fx = this.b.x;
        const fz = this.b.z;
        mx = fx * -sy + -fz * sx;
        mz = fz * -sy + fx * sx;
        const n = Math.hypot(mx, mz) || 1;
        mx /= n;
        mz /= n;
        if (mag > 0.92) run = true;
        this.camp.goTo = null;
        this.camp.goEntity = null;
        this.camp.goActor = null;
        this.camp.path.length = 0;
      } else mag = 0;
      // hand command: follow the planned street path, then punch / grab the pinched thing
      const goal = this.camp.goTo;
      const actor = this.camp.goActor;
      if (mag === 0 && actor && goal) {
        if (!actor.visible || actor.scale.y < 0.5 || this.camp.held) {
          this.camp.goActor = null;
          this.camp.goTo = null;
        } else {
          goal.copy(actor.position).setY(0);
          const gx = goal.x - this.heroPos.x;
          const gz = goal.z - this.heroPos.z;
          const gd = Math.hypot(gx, gz);
          if (gd <= hero.radius + form.height * 0.4) {
            hero.yaw = Math.atan2(gx, gz);
            if (!this.tryGrabVehicle()) punch = true;
            else this.camp.autoChew = true;
          } else {
            mx = gx / gd;
            mz = gz / gd;
            mag = 1;
            run = true;
          }
        }
      } else if (mag === 0 && goal) {
        const ge = this.camp.goEntity;
        if (ge && !ge.getValue(Building, 'alive')) {
          this.camp.goTo = null;
          this.camp.goEntity = null;
          this.camp.path.length = 0;
        } else {
          const reach = ge ? (ge.getValue(Building, 'width') ?? 0.03) / 2 + hero.radius + form.height * 0.22 : 0.005;
          const gx = goal.x - this.heroPos.x;
          const gz = goal.z - this.heroPos.z;
          const gd = Math.hypot(gx, gz);
          if (gd <= reach) {
            this.camp.path.length = 0;
            if (ge) {
              hero.yaw = Math.atan2(gx, gz);
              if (this.camp.held) {
                this.throwHeld();
                this.camp.goTo = null;
                this.camp.goEntity = null;
              } else punch = true;
            } else this.camp.goTo = null;
          } else {
            if (this.camp.path.length === 0 && !this.planPath(goal, ge)) {
              this.camp.goTo = null;
              this.camp.goEntity = null;
            }
            const wp = this.camp.path[0];
            if (wp) {
              const wx = wp.x - this.heroPos.x;
              const wz = wp.z - this.heroPos.z;
              const wd = Math.hypot(wx, wz);
              if (wd < 0.006 && this.camp.path.length > 1) this.camp.path.shift();
              mx = wx / Math.max(1e-5, wd);
              mz = wz / Math.max(1e-5, wd);
              mag = 1;
              run = gd > 0.08;
            }
          }
        }
      }
      const chewing = !!this.camp.held && (grabHeld || this.camp.autoChew) && !grab;
      if (mag > 0 && !chewing) {
        const sp = form.speed * (run ? 1.9 : 1) * Math.max(0.35, mag) * (this.camp.held ? 0.8 : 1);
        const ok = this.moveHero(mx * sp * dt, mz * sp * dt);
        const want = Math.atan2(mx, mz);
        hero.yaw += wrapAngle(want - hero.yaw) * Math.min(1, dt * 12);
        hero.moving = run ? 1 : 0.5;
        if (!ok && this.camp.goTo) {
          this.camp.blockT += dt;
          if (this.camp.blockT > 0.35) {
            this.camp.blockT = 0;
            this.camp.path.length = 0;
          }
        } else this.camp.blockT = 0;
        this.camp.stepT -= dt;
        if (this.camp.stepT <= 0 && !hero.airborne) {
          this.camp.stepT = run ? 0.2 : 0.3;
          this.fx.puff(this.c.copy(this.heroPos).setY(hero.root.position.y + 0.001), 0.001, run ? 2 : 1);
        }
      } else hero.moving = 0;
      // grab a car (or tank) / gnaw it / throw it
      if (this.camp.held) {
        if (punch) this.throwHeld();
        else if (chewing) {
          hero.chew = 1;
          this.camp.chewT += dt;
          this.camp.crumbT -= dt;
          if (this.camp.crumbT <= 0) {
            this.camp.crumbT = 0.16;
            this.c.copy(this.camp.held.obj.position);
            this.fx.spark(this.c, 5, 0.12, Math.random() < 0.5 ? 0xd8d8d8 : 0x3f8fe8);
            if (Math.random() < 0.3) this.fx.puff(this.c, 0.001, 1);
            this.sfx.crunch(0.2, false);
          }
          this.camp.held.obj.scale.setScalar(Math.max(0.35, 1 - this.camp.chewT / 2.4));
          if (this.camp.chewT > 1.8) {
            const hd = this.camp.held;
            this.camp.held = null;
            this.camp.autoChew = false;
            hero.chew = 0;
            this.c.copy(hd.obj.position);
            this.fx.popup(this.a.copy(this.c).setY(this.c.y + 0.02), 'NOM NOM NOM!', '#ffe066');
            this.sfx.combo(6);
            hd.obj.scale.setScalar(1);
            hd.obj.position.set(this.heroPos.x + Math.sin(hero.yaw) * hero.radius, 0.002, this.heroPos.z + Math.cos(hero.yaw) * hero.radius);
            if (hd.car) {
              this.wreckCar(hd.car, this.c);
              hd.car.obj.visible = false;
            }
            if (hd.tank) this.killTank(hd.tank, 80, 'EATEN ');
          }
        } else hero.chew = 0;
      } else {
        hero.chew = 0;
        if (grab && !this.tryGrabVehicle()) punch = true;
        if (punch) hero.attack('punch');
      }
      if (jump) {
        const v = Math.sqrt(2 * form.height * 40 * form.height * 1.7);
        if (hero.jump(v)) this.sfx.pop();
      }
    } else hero.moving = 0;

    // vertical: gravity, roofs, landing slams
    if (!hero.carried) {
      const g = form.height * 40;
      const ground = this.groundAt(this.heroPos.x, this.heroPos.z);
      hero.ground = ground;
      let y = hero.root.position.y;
      if (!hero.airborne && y > ground + 0.0008) {
        hero.airborne = true;
        hero.vy = 0;
      }
      if (hero.airborne) {
        hero.vy -= g * dt;
        y += hero.vy * dt;
        if (y <= ground) {
          const impact = -hero.vy;
          y = ground;
          hero.airborne = false;
          hero.land(impact);
          this.fx.puff(this.c.copy(this.heroPos).setY(ground + 0.001), 0.002, 4);
          if (ground > 0 && impact > form.height * 4 && ph === 'play') this.roofSlam();
          hero.vy = 0;
        }
      } else y = ground;
      hero.root.position.set(this.heroPos.x, y, this.heroPos.z);
    }
    // the held vehicle rides above the head (or sits at the mouth while gnawing)
    const hd = this.camp.held;
    if (hd) {
      const s = form.height;
      const chew = hero.chew > 0.05;
      const fx = Math.sin(hero.yaw);
      const fz = Math.cos(hero.yaw);
      const up = chew ? s * 0.62 : s * (1.08 + Math.sin(this.now * 6) * 0.03);
      const fwd = chew ? s * 0.42 : 0;
      hd.obj.position.set(this.heroPos.x + fx * fwd, hero.root.position.y + up, this.heroPos.z + fz * fwd);
      hd.obj.rotation.set(0, hero.yaw + Math.PI / 2 + (chew ? Math.sin(this.now * 30) * 0.15 : 0), 0);
    }
    if (hero.attackLands()) this.heroStrike();
    this.camp.tooBigT = Math.max(0, this.camp.tooBigT - dt);
    hero.update(dt);
    this.updateThrows(dt);
    this.updateSeeds(dt);
    this.updateDefense(dt);

    // glowing goal markers
    let mi = 0;
    if (ph === 'play' || ph === 'intro') {
      for (const e of this.camp.targets) {
        if (mi >= this.markers.length) break;
        const o = e.object3D;
        if (!o || !e.getValue(Building, 'alive')) continue;
        const mk = this.markers[mi++];
        const ms = 0.55 / Math.sqrt(this.zoomV);
        mk.visible = true;
        mk.scale.setScalar(ms);
        mk.position.set(o.position.x, o.position.y + (e.getValue(Building, 'height') ?? 0.05) + 0.06 * ms + Math.sin(this.now * 5) * 0.003, o.position.z);
        mk.rotation.y += dt * 3;
      }
    }
    for (; mi < this.markers.length; mi++) this.markers[mi].visible = false;

    if (ph !== 'play' || !this.canScore()) return;
    // the army: keep a couple of tanks on the ring road until enough are destroyed
    if (L.goal.tanks && this.camp.progress.tanks < L.goal.tanks) {
      let alive = 0;
      for (const e of this.queries.tanks.entities) if (e.getValue(Tank, 'alive')) alive++;
      this.camp.tankT -= dt;
      if (alive < 2 && this.camp.tankT <= 0) {
        this.spawnTank();
        this.camp.tankT = 4;
        if (this.once('camp-tanks')) this.ticker.push('ARMY TANKS ROLL INTO TOKYO', true);
      }
    }
    if (this.cui.allDone(L.goal, this.camp.progress)) this.campaignEnd(true, 'CLEAR');
  }

  /** jumping onto a roof hard counts as a hit on that building */
  private roofSlam() {
    const e = this.buildingUnder(this.heroPos.x, this.heroPos.z);
    if (!e) return;
    this.damageBuilding(e, this.c.copy(this.heroPos).setY(this.hero.root.position.y), 'BUTT SLAM ');
    this.shakeT = 0.3;
    this.shakeAmp = this.settings.values.shake ? 0.0018 : 0;
  }

  /** one hit on a building: wobble, or down it when its hits run out */
  private damageBuilding(e: Entity, at: Vector3, label: string) {
    const form = this.hero.form;
    const o = e.object3D!;
    const h = e.getValue(Building, 'height') ?? 0.05;
    if (h > form.power * (this.camp.powerT > 0 ? 1.4 : 1)) {
      this.wobble(e, o, 0.025, 0);
      this.fx.spark(at, 6, 0.2, 0xffffff);
      this.sfx.metal();
      if (this.camp.tooBigT <= 0) {
        this.camp.tooBigT = 1.2;
        this.fx.popup(this.a.copy(at).setY(h * 0.6 + 0.02), 'TOO BIG! GROW STRONGER', '#ff8a5a');
      }
      return;
    }
    const need = this.camp.powerT > 0 ? 1 : Math.max(1, Math.ceil((3 * h) / form.power));
    const left = Math.min(need, this.camp.hits.get(e.index) ?? need) - 1;
    this.camp.hits.set(e.index, left);
    this.sfx.punch();
    this.hitStop(0.05);
    this.shakeT = 0.18;
    this.shakeAmp = this.settings.values.shake ? 0.0012 : 0;
    if (left <= 0) {
      this.smash(e, at, 2.2, 1, label);
      this.hitStop(0.09);
    } else {
      this.wobble(e, o, 0.06, 0);
      this.fx.puff(at, 0.01, 5);
      this.fx.spark(at, 8, 0.25);
      this.fx.popup(this.a.copy(at).setY(h + 0.015), `${left} MORE`, '#ffffff');
    }
  }

  /** the punch connects: buildings, cars, tanks - and careless hits on people */
  private heroStrike() {
    const form = this.hero.form;
    const y0 = this.hero.root.position.y;
    const reach = this.hero.radius + form.height * 0.32;
    const fx = Math.sin(this.hero.yaw);
    const fz = Math.cos(this.hero.yaw);
    const ix = this.heroPos.x + fx * reach;
    const iz = this.heroPos.z + fz * reach;
    const hitR = form.height * 0.28;
    const imp = this.c.set(ix, y0 + form.height * 0.45, iz);
    let best: Entity | null = null;
    let bestD = 1e9;
    for (const e of this.queries.buildings.entities) {
      if (!e.getValue(Building, 'alive')) continue;
      const o = e.object3D;
      if (!o) continue;
      if ((e.getValue(Building, 'height') ?? 0) < y0 + form.height * 0.15) continue; // below our fists
      const half = (e.getValue(Building, 'width') ?? 0.03) / 2;
      const cx = Math.max(o.position.x - half, Math.min(ix, o.position.x + half));
      const cz = Math.max(o.position.z - half, Math.min(iz, o.position.z + half));
      const d = Math.hypot(ix - cx, iz - cz);
      if (d < hitR && d < bestD) {
        bestD = d;
        best = e;
      }
    }
    let hitSomething = false;
    if (best) {
      hitSomething = true;
      this.damageBuilding(best, imp, 'PUNCH ');
    }
    if (y0 < form.height * 0.5) {
      for (const car of this.cars) {
        if (car.state === 'drive' && Math.hypot(car.obj.position.x - ix, car.obj.position.z - iz) < hitR + 0.008) {
          this.wreckCar(car, imp);
          hitSomething = true;
        }
      }
      for (const e of this.queries.tanks.entities) {
        if (!e.getValue(Tank, 'alive') || e.getValue(Tank, 'held')) continue;
        const o = e.object3D;
        if (o && Math.hypot(o.position.x - ix, o.position.z - iz) < hitR + 0.014) {
          this.killTank(e, 60, 'TANK ');
          hitSomething = true;
        }
      }
      for (const p of this.people) {
        if (p.state !== 'down' && Math.hypot(p.obj.position.x - ix, p.obj.position.z - iz) < hitR * 0.8) this.hurtPerson(p, this.heroPos);
      }
    }
    if (!hitSomething) this.fx.puff(imp.setY(y0 + 0.002), 0.002, 2);
  }

  /** board, level cards, result + zoom buttons: placement, drawing and pokes */
  private updateCampaignUi(dt: number) {
    const ph = this.camp.phase;
    const on = ph !== 'off' && this.placed;
    const showCards = on && ph === 'select' && !this.rebuild;
    const showBoard = on && ph !== 'select';
    const showResult = on && (ph === 'won' || ph === 'lost') && this.camp.revealT > 1.2;
    for (const b of this.cui.levelCards) b.plane.mesh.visible = showCards;
    this.cui.back.plane.mesh.visible = showCards;
    this.cui.board.mesh.visible = showBoard;
    for (const b of this.cui.resultButtons) b.plane.mesh.visible = showResult;
    for (const b of this.cui.zoomButtons) b.plane.mesh.visible = on && ph !== 'select';
    if (!on) return;
    this.qYaw.setFromAxisAngle(this.b.set(0, 1, 0), this.anchorYaw);
    const place = (m: Mesh, x: number, y: number, z: number, bob = 0) => {
      m.position.set(x, y, z).applyQuaternion(this.qYaw).add(this.anchor);
      m.position.y += bob;
      m.lookAt(this.head);
    };
    const t = this.cui.time;
    if (showCards) {
      const all = [...this.cui.levelCards, this.cui.back];
      const n = all.length;
      all.forEach((b, i) => place(b.plane.mesh, (i - (n - 1) / 2) * 0.094, 0.1, 0.34, Math.sin(t * 2 + i) * 0.003));
    }
    if (showBoard) place(this.cui.board.mesh, 0, 0.3, -0.36);
    if (showResult) {
      const okNext = ph === 'won' && this.camp.level + 1 < LEVELS.length;
      this.cui.resultButtons[1].enabled = okNext;
      this.cui.resultButtons[1].plane.mesh.visible = okNext;
      const vis = this.cui.resultButtons.filter((b) => b.plane.mesh.visible);
      vis.forEach((b, i) => place(b.plane.mesh, (i - (vis.length - 1) / 2) * 0.115, 0.075, 0.33));
    }
    this.cui.zoomButtons.forEach((b, i) => place(b.plane.mesh, 0.37, 0.09 - i * 0.045, 0.12));
    // star reveal on the result card
    if (ph === 'won' || ph === 'lost') {
      this.camp.revealT += dt;
      const want = Math.max(0, Math.min(this.camp.stars, Math.floor(this.camp.revealT / 0.5)));
      if (want > this.camp.shown) {
        this.camp.shown = want;
        this.sfx.combo(2 + want * 2);
        this.cui.board.mesh.getWorldPosition(this.a);
        this.toLocal(this.a, this.b);
        this.fx.spark(this.b, 24, 0.4, 0xffcf3a);
      }
    }
    if (showBoard) {
      const st: BoardState = {
        level: LEVELS[this.camp.level],
        phase: ph === 'won' || ph === 'lost' ? ph : ph === 'play' ? 'play' : 'intro',
        time: this.time,
        progress: this.camp.progress,
        hurt: this.camp.hurt,
        hp: this.hp,
        stars: this.camp.stars,
        shown: this.camp.shown,
        reason: this.camp.reason,
        newForm: this.camp.newForm,
        countdown: this.countdown,
        best: this.csave.stars[this.camp.level],
        seeds: this.camp.seeds,
        god: this.camp.godT,
        holding: !!this.camp.held,
      };
      this.cui.drawBoard(st);
    }
    const pick = this.cui.update(dt, [this.hands.hands.left, this.hands.hands.right]);
    if (pick) this.onCampaignPick(pick);
    // desktop shortcuts
    const kb = this.input.keyboard;
    if (ph === 'won' || ph === 'lost') {
      if (kb.getKeyDown('KeyR')) this.onCampaignPick({ kind: 'retry' });
      if (kb.getKeyDown('KeyN')) this.onCampaignPick({ kind: 'next' });
      if (kb.getKeyDown('KeyL')) this.onCampaignPick({ kind: 'levels' });
    }
    if (ph === 'select') {
      for (let i = 0; i < LEVELS.length; i++) if (kb.getKeyDown(`Digit${i + 1}`)) this.onCampaignPick({ kind: 'level', i });
      if (kb.getKeyDown('Escape')) this.onCampaignPick({ kind: 'back' });
    }
  }
}
