/**
 * Builds the miniature city from the Kenney CC0 kits (kenney.nl).
 * All positions are city-local meters, table surface at y = 0.
 */
import {
  AnimationClip,
  BufferGeometry,
  Material,
  Matrix4,
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  ShadowMaterial,
  Texture,
  CanvasTexture,
  Color,
  InstancedMesh,
  MeshBasicMaterial,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from '@iwsdk/core';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { KIT } from './kit-manifest.js';

export const TILE = 0.05;
export const GRID = 13; // tiles per side
export const HALF = (GRID * TILE) / 2; // 0.325
export const ROAD_LINES = [0, 3, 6, 9, 12].map((i) => (i - 6) * TILE); // -0.3 .. 0.3
export const RING = 0.3; // outer ring road (tanks)
export const BLOCK_CENTERS = [-0.225, -0.075, 0.075, 0.225];

export type District = 'downtown' | 'commercial' | 'suburban' | 'industrial' | 'park';

export interface KitLot {
  x: number;
  z: number;
  bi: number;
  bj: number;
  lx: number;
  lz: number;
}
export interface BuildingStats {
  height: number;
  width: number;
  depth: number;
  value: number;
  palette: number[];
  glass: boolean;
}
export interface BuildingSpec extends BuildingStats {
  object: Object3D;
  lot: KitLot;
}
export interface CarProto {
  key: string;
  object: Object3D;
}

export interface CharProto {
  object: Object3D;
  clips: AnimationClip[];
}

export interface KitCity {
  root: Group;
  buildings: BuildingSpec[];
  cars: CarProto[];
  chars: CharProto[];
  /** city-local positions of street-lamp heads */
  lamps: Vector3[];
  /** building materials whose windows light up at night */
  windowMats: MeshStandardMaterial[];
  /** block ground plates (instance i = bi * 4 + bj) */
  plates: InstancedMesh;
  /** a fresh random building model for a lot in a district */
  pick: (d: District, lot: KitLot) => { model: Object3D; stats: BuildingStats } | null;
}

export const GROUND: Record<District, number> = {
  downtown: 0xd8d5ce,
  commercial: 0xd8d5ce,
  suburban: 0x8cc36b,
  industrial: 0xb9b4aa,
  park: 0x8cc36b,
};

/** City themes: every time the city is wiped out a new one grows in its place. */
export const THEMES: { name: string; layout: (bi: number, bj: number) => District }[] = [
  { name: 'TINY CITY', layout: (bi, bj) => districtOf(bi, bj) },
  {
    name: 'MEGA METRO',
    layout: (bi, bj) => (bi === 3 && bj === 0 ? 'park' : (bi === 0 || bi === 3) && (bj === 0 || bj === 3) ? 'commercial' : 'downtown'),
  },
  {
    name: 'SLEEPY SUBURBIA',
    layout: (bi, bj) => (bi === 3 && bj === 0 ? 'park' : (bi === 1 || bi === 2) && (bj === 1 || bj === 2) ? 'commercial' : 'suburban'),
  },
  {
    name: 'FACTORY TOWN',
    layout: (bi, bj) => (bi === 3 && bj === 0 ? 'park' : bj <= 1 ? 'industrial' : bi === 1 || bi === 2 ? 'commercial' : 'suburban'),
  },
  {
    // campaign city: a downtown core of towers (too big for a human!) ringed by shops and houses
    name: 'TOKYO',
    layout: (bi, bj) =>
      (bi === 1 || bi === 2) && (bj === 1 || bj === 2) ? 'downtown' : (bi + bj) % 2 === 0 ? 'commercial' : 'suburban',
  },
  {
    name: 'HARBOUR HEIGHTS',
    layout: (bi, bj) => (bi === 3 && bj === 0 ? 'park' : bi === 0 ? 'industrial' : bi === 1 ? 'downtown' : bj === 3 ? 'suburban' : 'commercial'),
  },
  {
    // dense, tall and neon: towers everywhere with a ring of shops
    name: 'SEOUL',
    layout: (bi, bj) => (bi === 0 && bj === 3 ? 'park' : (bi === 0 || bi === 3 || bj === 0 || bj === 3) && (bi + bj) % 2 === 1 ? 'commercial' : 'downtown'),
  },
  {
    // sunny, wide and low: houses, shops, palm-tree parks and a port
    name: 'LOS ANGELES',
    layout: (bi, bj) =>
      (bi === 3 && bj === 0) || (bi === 0 && bj === 3) ? 'park' : bi === 3 ? 'industrial' : (bi === 1 || bi === 2) && (bj === 1 || bj === 2) ? 'commercial' : 'suburban',
  },
];

function pickBuilding(get: (k: string) => GLTF | undefined, d: District, lot: KitLot): { model: Object3D; stats: BuildingStats } | null {
  for (let attempt = 0; attempt < 6; attempt++) {
    const key = rnd(SETS[d]);
    const g = get(key);
    const meta = KIT[key];
    if (!g || !meta) continue;
    const foot = Math.max(meta.size[0], meta.size[2]);
    const fit = Math.min(1, 0.92 / foot);
    const unit = TILE * fit;
    const model = new Group();
    model.add(place(g, unit));
    const height = meta.size[1] * unit;
    // suburban extras ride along with the house (and are destroyed with it)
    if (d === 'suburban' && Math.random() < 0.7) {
      const tg = get('sub/tree-small');
      if (tg) {
        const tree = place(tg, TILE * 0.9);
        // the wrapper is rotated by PI for lz < 0, so mirror the local offset back
        const flip = lot.lz > 0 ? 1 : -1;
        tree.position.set((lot.lx > 0 ? 0.019 : -0.019) * flip, 0, -lot.lz * 0.012 * flip);
        model.add(tree);
      }
    }
    return {
      model,
      stats: {
        height,
        width: meta.size[0] * unit,
        depth: meta.size[2] * unit,
        value: Math.round(10 + height * 900),
        palette: PALETTES[d],
        glass: d === 'downtown',
      },
    };
  }
  return null;
}

/** Shared night-time materials (their emissive intensity is driven by the day cycle). */
export const headlightMat = new MeshStandardMaterial({ color: 0x9a9a8a, emissive: 0xfff1c4, emissiveIntensity: 0 });
export const taillightMat = new MeshStandardMaterial({ color: 0x6a2020, emissive: 0xff2a2a, emissiveIntensity: 0 });
export const sirenRedMat = new MeshBasicMaterial({ color: 0xff2a2a });
export const sirenBlueMat = new MeshBasicMaterial({ color: 0x2a6bff });
export const sirenOffMat = new MeshBasicMaterial({ color: 0x33333a });

/** Kenney window glass is the light-blue swatch of the colormap: turn just those texels into
 *  a warm "lights on" emissive map so whole buildings don't glow, only their windows. */
function windowGlowMap(src: Texture): Texture | null {
  const img = src.image as CanvasImageSource & { width: number; height: number };
  if (!img || !img.width) return null;
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) return null;
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height);
  const px = d.data;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i];
    const gg = px[i + 1];
    const b = px[i + 2];
    // pale-blue and mid-blue glass swatches (checked against renders of every building kit)
    const glass = (b > 215 && r > 150 && b - r > 25 && gg > r) || (b > 150 && b - r > 60 && gg > r && gg - r > 20);
    // random-ish per-texel warmth so windows are not all the same colour
    if (glass) {
      px[i] = 255;
      px[i + 1] = 160 + ((i >> 4) % 40);
      px[i + 2] = 30 + ((i >> 6) % 30);
    } else {
      px[i] = px[i + 1] = px[i + 2] = 0;
    }
    px[i + 3] = 255;
  }
  g.putImageData(d, 0, 0);
  const t = new CanvasTexture(c);
  t.flipY = src.flipY;
  t.colorSpace = SRGBColorSpace;
  t.magFilter = src.magFilter;
  t.minFilter = src.minFilter;
  t.needsUpdate = true;
  return t;
}

const PALETTES: Record<District, number[]> = {
  downtown: [0xc9d3e0, 0x7f93b5, 0xe8e4dc, 0x55607a],
  commercial: [0xe7ddc9, 0xc9744e, 0x8fa3c4, 0xf0c070],
  suburban: [0xf3e6cc, 0xd77d57, 0x9cb87a, 0x8f6b4e],
  industrial: [0xbab3a6, 0x8a8f99, 0xd4823f, 0x6d7280],
  park: [0x6fae5b, 0x8a6a45],
};

type Loader = (key: string) => Promise<GLTF>;

/** Every model in a Kenney kit uses the same colormap and the same few materials.
 *  Make them literally the same objects: 6 textures instead of ~100, and static meshes
 *  that share a material merge into one draw call. */
function shareMaterials(gltfs: Map<string, GLTF>): MeshStandardMaterial[] {
  const mats = new Map<string, Material>();
  const maps = new Map<string, Texture>();
  for (const [key, g] of gltfs) {
    const kit = key.split('/')[0];
    g.scene.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh || Array.isArray(m.material)) return;
      const mat = m.material as MeshStandardMaterial;
      const id = `${kit}|${mat.name}|${mat.color?.getHexString?.() ?? ''}`;
      const shared = mats.get(id);
      if (shared) {
        if (shared !== mat) {
          m.material = shared;
          mat.dispose();
        }
        return;
      }
      if (mat.map) {
        const t = maps.get(kit);
        if (t && t !== mat.map) {
          mat.map.dispose();
          mat.map = t;
        } else if (!t) maps.set(kit, mat.map);
      }
      mats.set(id, mat);
    });
  }
  // windows light up at night (building kits only)
  const out: MeshStandardMaterial[] = [];
  const glow = new Map<string, Texture | null>();
  for (const [id, m] of mats) {
    const kit = id.split('|')[0];
    if (kit !== 'com' && kit !== 'sub' && kit !== 'ind') continue;
    const mat = m as MeshStandardMaterial;
    if (!mat.map || !mat.isMeshStandardMaterial) continue;
    if (!glow.has(kit)) glow.set(kit, windowGlowMap(mat.map));
    const gm = glow.get(kit);
    if (!gm) continue;
    mat.emissiveMap = gm;
    mat.emissive.set(0xffffff);
    mat.emissiveIntensity = 0;
    mat.needsUpdate = true;
    out.push(mat);
  }
  return out;
}

function prepare(obj: Object3D, shadows: boolean) {
  obj.traverse((o) => {
    const m = o as Mesh;
    if (m.isMesh) {
      m.castShadow = shadows;
      m.receiveShadow = true;
    }
  });
}

/** Clone a kit model, scaled so one kit unit equals `unit` meters. */
function place(gltf: GLTF, unit: number, shadows = true): Object3D {
  const g = gltf.scene.clone(true);
  g.scale.setScalar(unit);
  prepare(g, shadows);
  const wrap = new Group();
  wrap.add(g);
  return wrap;
}


/**
 * Merge every static mesh under `src` into one mesh per material (huge draw-call
 * savings on Quest). Transforms are baked relative to `src`.
 */
export function mergeStatic(src: Object3D, castShadow: boolean): Group {
  src.updateMatrixWorld(true);
  const inv = new Matrix4().copy(src.matrixWorld).invert();
  const byMat = new Map<Material, BufferGeometry[]>();
  src.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh || Array.isArray(m.material)) return;
    const g = m.geometry.clone();
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) continue_missing(g);
    g.applyMatrix4(new Matrix4().multiplyMatrices(inv, m.matrixWorld));
    const geo = g.index ? g.toNonIndexed() : g;
    const list = byMat.get(m.material) ?? [];
    list.push(geo);
    byMat.set(m.material, list);
  });
  const out = new Group();
  out.name = src.name + '-merged';
  for (const [mat, geos] of byMat) {
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    const mesh = new Mesh(merged, mat);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    out.add(mesh);
  }
  return out;
}

function continue_missing(g: BufferGeometry) {
  const n = g.attributes.position.count;
  g.setAttribute('uv', new (g.attributes.position.constructor as typeof import('@iwsdk/core').BufferAttribute)(new Float32Array(n * 2), 2));
}

const slab = new BoxGeometry(1, 1, 1);
slab.translate(0, 0.5, 0);
const slabMats = new Map<number, MeshStandardMaterial>();
function plate(w: number, h: number, d: number, color: number, x: number, z: number) {
  let m = slabMats.get(color);
  if (!m) {
    m = new MeshStandardMaterial({ color, roughness: 0.95 });
    slabMats.set(color, m);
  }
  const mesh = new Mesh(slab, m);
  mesh.scale.set(w, h, d);
  mesh.position.set(x, 0, z);
  mesh.receiveShadow = true;
  return mesh;
}

function rnd<T>(a: T[]): T {
  return a[Math.floor(Math.random() * a.length)];
}

function districtOf(bi: number, bj: number): District {
  const edge = (v: number) => v === 0 || v === 3;
  if (!edge(bi) && !edge(bj)) return 'downtown';
  if (edge(bi) && edge(bj)) {
    if (bi === 0 && bj === 3) return 'industrial';
    if (bi === 3 && bj === 0) return 'park';
    return 'suburban';
  }
  return 'commercial';
}

const SETS: Record<District, string[]> = {
  downtown: ['com/building-skyscraper-a', 'com/building-skyscraper-b', 'com/building-skyscraper-c', 'com/building-skyscraper-d', 'com/building-skyscraper-e', 'com/building-l', 'com/building-m', 'com/building-n'],
  commercial: 'abcdefghijk'.split('').map((c) => `com/building-${c}`),
  suburban: 'abcdefghijklmnopqrstu'.split('').map((c) => `sub/building-type-${c}`),
  industrial: [...'abcdefghijklmnopqrst'.split('').map((c) => `ind/building-${c}`), 'ind/water-tower', 'ind/chimney-large', 'ind/detail-tank-large'],
  park: ['sub/building-type-a', 'sub/building-type-g', 'sub/building-type-m'],
};

export const CAR_KEYS = ['car/police', 'car/taxi', 'car/sedan', 'car/suv', 'car/van', 'car/delivery', 'car/firetruck', 'car/ambulance', 'car/garbage-truck', 'car/truck', 'car/hatchback-sports'];
const CHAR_KEYS = ['chr/character-male-a', 'chr/character-male-c', 'chr/character-male-e', 'chr/character-female-a', 'chr/character-female-c', 'chr/character-female-e'];

export async function buildKitCity(load: Loader): Promise<KitCity> {
  const keys = new Set<string>([
    ...Object.values(SETS).flat(),
    ...CAR_KEYS,
    ...CHAR_KEYS,
    'road/road-straight',
    'road/road-crossroad',
    'road/road-intersection',
    'road/road-bend',
    'road/light-square',
    'road/traffic-light',
    'road/construction-cone',
    'sub/tree-large',
    'sub/tree-small',
    'sub/planter',
  ]);
  const gltfs = new Map<string, GLTF>();
  await Promise.all(
    [...keys].map(async (k) => {
      try {
        gltfs.set(k, await load(k));
      } catch (err) {
        console.warn('[FingerKaiju] failed to load', k, err);
      }
    }),
  );
  const windowMats = shareMaterials(gltfs);
  const get = (k: string) => gltfs.get(k);

  const root = new Group();
  root.name = 'KitCity';
  const statics = new Group();
  statics.name = 'Statics';

  // shadow catcher for the real table + ground plates
  const catcher = new Mesh(new PlaneGeometry(GRID * TILE + 0.4, GRID * TILE + 0.4), new ShadowMaterial({ opacity: 0.35 }));
  catcher.rotation.x = -Math.PI / 2;
  catcher.position.y = 0.0004;
  catcher.receiveShadow = true;
  root.add(catcher);
  statics.add(plate(GRID * TILE + 0.012, 0.0015, GRID * TILE + 0.012, 0x4b5160, 0, 0));

  // ---- roads ----
  const isLine = (i: number) => i % 3 === 0;
  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      const rx = isLine(i);
      const rz = isLine(j);
      if (!rx && !rz) continue;
      let key = 'road/road-straight';
      let rot = 0;
      const edgeI = i === 0 || i === GRID - 1;
      const edgeJ = j === 0 || j === GRID - 1;
      if (rx && rz) {
        if (edgeI && edgeJ) {
          key = 'road/road-bend';
          // corner: open towards the inside of the city
          rot = i === 0 ? (j === 0 ? -Math.PI / 2 : 0) : j === 0 ? Math.PI : Math.PI / 2;
        } else if (edgeI || edgeJ) {
          key = 'road/road-intersection';
          // the T tile's closed side is +Z by default; turn it to face outwards
          rot = edgeJ ? (j === 0 ? Math.PI : 0) : i === 0 ? -Math.PI / 2 : Math.PI / 2;
        } else key = 'road/road-crossroad';
      } else if (rx) {
        rot = Math.PI / 2; // runs along z (tile runs along x by default)
      } else {
        rot = 0; // runs along x
      }
      const g = get(key);
      if (!g) continue;
      const tile = place(g, TILE, false);
      tile.position.set((i - 6) * TILE, 0.0015, (j - 6) * TILE);
      tile.rotation.y = rot;
      statics.add(tile);
    }
  }

  // ---- blocks ----
  // ground plates are one instanced mesh so a new city can recolour them per district
  const plates = new InstancedMesh(slab, new MeshStandardMaterial({ roughness: 0.95 }), 16);
  plates.receiveShadow = true;
  plates.name = 'BlockPlates';
  const blockSize = 2 * TILE;
  const lots: KitLot[] = [];
  const layout = THEMES[0].layout;
  for (let bi = 0; bi < 4; bi++) {
    for (let bj = 0; bj < 4; bj++) {
      const d = layout(bi, bj);
      const cx = BLOCK_CENTERS[bi];
      const cz = BLOCK_CENTERS[bj];
      const m = new Matrix4().compose(new Vector3(cx, 0, cz), new Quaternion(), new Vector3(blockSize, 0.004, blockSize));
      plates.setMatrixAt(bi * 4 + bj, m);
      plates.setColorAt(bi * 4 + bj, new Color(GROUND[d]));
      const corners: [number, number][] = [
        [-0.5, -0.5],
        [0.5, -0.5],
        [-0.5, 0.5],
        [0.5, 0.5],
      ];
      for (const [lx, lz] of corners) {
        const x = cx + lx * TILE;
        const z = cz + lz * TILE;
        if (d === 'park') {
          // the park stays a park in every city
          for (let t = 0; t < 4; t++) {
            const tg = get(Math.random() < 0.5 ? 'sub/tree-large' : 'sub/tree-small');
            if (!tg) continue;
            const tree = place(tg, TILE * (0.8 + Math.random() * 0.4));
            tree.position.set(x + (Math.random() - 0.5) * TILE * 0.8, 0.004, z + (Math.random() - 0.5) * TILE * 0.8);
            tree.rotation.y = Math.random() * Math.PI * 2;
            statics.add(tree);
          }
          continue;
        }
        lots.push({ x, z, bi, bj, lx, lz });
      }
    }
  }
  root.add(plates);
  const pick = (d: District, lot: KitLot) => pickBuilding(get, d, lot);
  const buildings: BuildingSpec[] = [];
  for (const lot of lots) {
    const wrap = new Group();
    wrap.position.set(lot.x, 0.004, lot.z);
    // face the nearest outer road of the block
    wrap.rotation.y = lot.lz > 0 ? 0 : Math.PI;
    const spec = pick(layout(lot.bi, lot.bj), lot);
    if (!spec) continue;
    wrap.add(spec.model);
    buildings.push({ object: wrap, lot, ...spec.stats });
  }

  // ---- street props ----
  const light = get('road/light-square');
  const traffic = get('road/traffic-light');
  for (const lx of ROAD_LINES) {
    for (const lz of ROAD_LINES) {
      if (Math.abs(lx) < 0.31 && Math.abs(lz) < 0.31 && Math.abs(lx) < 0.29 && Math.abs(lz) < 0.29 && traffic) {
        const t = place(traffic, TILE);
        t.position.set(lx + TILE * 0.42, 0.0015, lz + TILE * 0.42);
        t.rotation.y = Math.PI / 4;
        statics.add(t);
      }
    }
  }
  const lamps: Vector3[] = [];
  if (light) {
    const LAMP_H = KIT['road/light-square'].size[1] * TILE * 0.93;
    const ARM = KIT['road/light-square'].size[2] * TILE * 0.3;
    // along every road (both kerbs alternate), between the intersections
    for (const line of ROAD_LINES) {
      for (const b of BLOCK_CENTERS) {
        for (const s of [-1, 1]) {
          if (Math.abs(line) > 0.29 && Math.sign(line) === s) continue; // no lamps on the outer edge of the ring
          const off = line + s * TILE * 0.44;
          for (const axis of ['x', 'z'] as const) {
            const l1 = place(light, TILE);
            if (axis === 'x') {
              l1.position.set(b + s * TILE * 0.25, 0.0015, off);
              l1.rotation.y = s < 0 ? Math.PI : 0; // arm reaches over the road
              lamps.push(new Vector3(l1.position.x, LAMP_H, off - s * ARM));
            } else {
              l1.position.set(off, 0.0015, b - s * TILE * 0.25);
              l1.rotation.y = s < 0 ? -Math.PI / 2 : Math.PI / 2;
              lamps.push(new Vector3(off - s * ARM, LAMP_H, l1.position.z));
            }
            statics.add(l1);
          }
        }
      }
    }
  }

  root.add(mergeStatic(statics, false));

  const cars: CarProto[] = [];
  for (const k of CAR_KEYS) {
    const g = get(k);
    if (g) {
      const holder = new Group();
      holder.add(g.scene.clone(true));
      cars.push({ key: k, object: mergeStatic(holder, true) });
    }
  }
  const chars: CharProto[] = [];
  for (const k of CHAR_KEYS) {
    const g = get(k);
    if (g) chars.push({ object: g.scene, clips: g.animations });
  }
  return { root, buildings, cars, chars, lamps, windowMats, plates, pick };
}

export const CAR_UNIT = 0.0075;
export const CHAR_UNIT = 0.016;

const lightBox = new BoxGeometry(1, 1, 1);
export const EMERGENCY = new Set(['car/police', 'car/ambulance', 'car/firetruck']);

export function spawnCar(proto: CarProto): Object3D {
  const g = proto.object.clone(true);
  g.scale.setScalar(CAR_UNIT);
  prepare(g, true);
  // head/tail lights (glow at night) and a roof light bar for emergency vehicles
  const size = KIT[proto.key]?.size ?? [1.5, 1.3, 3];
  const [w, h, l] = size;
  for (const sx of [-1, 1]) {
    const hl = new Mesh(lightBox, headlightMat);
    hl.scale.set(w * 0.18, h * 0.1, 0.06);
    hl.position.set(sx * w * 0.3, h * 0.33, l / 2 + 0.01);
    g.add(hl);
    const tl = new Mesh(lightBox, taillightMat);
    tl.scale.set(w * 0.16, h * 0.08, 0.06);
    tl.position.set(sx * w * 0.32, h * 0.36, -l / 2 - 0.01);
    g.add(tl);
  }
  if (EMERGENCY.has(proto.key)) {
    const roof = proto.key === 'car/police' ? h * 1.02 : h * 1.0;
    for (const sx of [-1, 1]) {
      const b = new Mesh(lightBox, sirenOffMat);
      b.name = sx < 0 ? 'sirenR' : 'sirenB';
      b.scale.set(w * 0.28, h * 0.12, w * 0.22);
      b.position.set(sx * w * 0.17, roof, proto.key === 'car/police' ? -l * 0.05 : l * 0.3);
      g.add(b);
    }
  }
  const wrap = new Group();
  wrap.name = 'Car';
  wrap.add(g);
  return wrap;
}

export function spawnChar(proto: CharProto): Object3D {
  const g = cloneSkinned(proto.object);
  g.scale.setScalar(CHAR_UNIT);
  prepare(g, false);
  return g;
}
