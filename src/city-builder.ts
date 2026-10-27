/** Procedural military vehicles, modelled in the same chunky low-poly style as the Kenney kits. */
import {
  BufferGeometry,
  Material,
  Matrix4,
  Object3D,
  BoxGeometry,
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
} from '@iwsdk/core';

import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Collapse a hand-built model into one mesh per material (dozens of parts -> a few draw calls).
 * Named children (turret, rotor, beacon...) stay separate so the game can animate them;
 * named groups are baked recursively.
 */
export function bake<T extends Object3D>(node: T): T {
  node.updateMatrixWorld(true);
  const inv = new Matrix4().copy(node.matrixWorld).invert();
  const byMat = new Map<Material, BufferGeometry[]>();
  const keep: Object3D[] = [];
  const tmp = new Matrix4();
  const visit = (o: Object3D) => {
    for (const c of o.children) {
      if (c.name) {
        keep.push(c);
        continue;
      }
      const m = c as Mesh;
      if (m.isMesh && !Array.isArray(m.material)) {
        const geo = m.geometry.index ? m.geometry.clone() : m.geometry.clone();
        geo.applyMatrix4(tmp.multiplyMatrices(inv, m.matrixWorld));
        for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal') geo.deleteAttribute(k);
        const list = byMat.get(m.material) ?? [];
        list.push(geo.index ? geo.toNonIndexed() : geo);
        byMat.set(m.material, list);
      }
      visit(c);
    }
  };
  visit(node);
  for (const k of keep) {
    tmp.multiplyMatrices(inv, k.matrixWorld);
    tmp.decompose(k.position, k.quaternion, k.scale);
  }
  node.clear();
  for (const [material, geos] of byMat) {
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    const mesh = new Mesh(merged, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    node.add(mesh);
  }
  for (const k of keep) {
    node.add(k);
    if (!(k as Mesh).isMesh) bake(k);
  }
  return node;
}

const unitBox = new BoxGeometry(1, 1, 1);
const cyl6 = new CylinderGeometry(0.5, 0.5, 1, 6);
const cyl10 = new CylinderGeometry(0.5, 0.5, 1, 10);
const cone = new ConeGeometry(0.5, 1, 8);

const mats = new Map<string, MeshStandardMaterial>();
function mat(key: string, make: () => MeshStandardMaterial) {
  let m = mats.get(key);
  if (!m) {
    m = make();
    mats.set(key, m);
  }
  return m;
}
export function solid(color: number, rough = 0.75, metal = 0) {
  return mat(`s${color}-${rough}-${metal}`, () => new MeshStandardMaterial({ color, roughness: rough, metalness: metal, flatShading: true }));
}
const glow = (color: number) => mat(`g${color}`, () => new MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2 }));
const glass = () =>
  mat('glass', () => new MeshStandardMaterial({ color: 0x8fd0ff, roughness: 0.1, metalness: 0.3, emissive: 0x1d4060, emissiveIntensity: 0.5, flatShading: true }));

function part(geo: BoxGeometry | CylinderGeometry | ConeGeometry | SphereGeometry | CapsuleGeometry, m: MeshStandardMaterial, sx: number, sy: number, sz: number, x = 0, y = 0, z = 0) {
  const mesh = new Mesh(geo, m);
  mesh.scale.set(sx, sy, sz);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
const box = (w: number, h: number, d: number, m: MeshStandardMaterial, x = 0, y = 0, z = 0) => part(unitBox, m, w, h, d, x, y, z);

/** Main battle tank, barrel along +X, ~4.5 cm long once scaled by 1.3. */
export function buildTank(): Group {
  const g = new Group();
  const olive = solid(0x6b7f3a);
  const oliveDark = solid(0x55662d);
  const sand = solid(0x9c9a5e);
  const steel = solid(0x2d3126, 0.6, 0.3);
  const rubber = solid(0x1f221c, 0.9);

  // lower hull with a sloped glacis plate
  g.add(box(0.028, 0.006, 0.0165, oliveDark, -0.001, 0.0058, 0));
  const glacis = box(0.008, 0.0012, 0.0165, olive, 0.0143, 0.0082, 0);
  glacis.rotation.z = -0.55;
  g.add(glacis);
  // upper deck + engine deck grille
  g.add(box(0.025, 0.003, 0.0185, olive, -0.0015, 0.0098, 0));
  for (let i = 0; i < 4; i++) g.add(box(0.0008, 0.0006, 0.012, steel, -0.0095 - i * 0.0017, 0.0114, 0));
  // tracks: belt + tread ribs + road wheels + sprocket/idler
  for (const s of [-1, 1]) {
    const z = s * 0.0098;
    g.add(box(0.031, 0.0068, 0.0052, rubber, 0, 0.0036, z));
    for (let i = 0; i < 14; i++) g.add(box(0.0009, 0.0072, 0.0054, steel, -0.0145 + i * 0.00223, 0.0036, z));
    for (let i = 0; i < 6; i++) {
      const w = part(cyl10, solid(0x3b4030), 0.0048, 0.0056, 0.0048, -0.0115 + i * 0.0046, 0.0033, z);
      w.rotation.x = Math.PI / 2;
      g.add(w);
      const hub = part(cyl6, steel, 0.0018, 0.0058, 0.0018, -0.0115 + i * 0.0046, 0.0033, z + s * 0.0001);
      hub.rotation.x = Math.PI / 2;
      g.add(hub);
    }
    for (const x of [-0.0152, 0.0152]) {
      const sp = part(cyl6, steel, 0.0042, 0.0058, 0.0042, x, 0.0046, z);
      sp.rotation.x = Math.PI / 2;
      g.add(sp);
    }
    // side skirt with a sand stripe
    g.add(box(0.026, 0.0026, 0.0009, olive, 0, 0.0076, s * 0.0127));
    g.add(box(0.026, 0.0006, 0.001, sand, 0, 0.0068, s * 0.0128));
    // headlight + tool box
    g.add(box(0.0016, 0.0014, 0.0016, glow(0xfff0b0), 0.0128, 0.0108, s * 0.0068));
    g.add(box(0.006, 0.0018, 0.0022, oliveDark, -0.006, 0.0118, s * 0.0078));
  }
  // exhausts
  for (const s of [-1, 1]) {
    const ex = part(cyl6, steel, 0.0018, 0.003, 0.0018, -0.0148, 0.0098, s * 0.005);
    ex.rotation.z = Math.PI / 2;
    g.add(ex);
  }

  // ---- turret ----
  const turret = new Group();
  turret.name = 'turret';
  turret.position.set(-0.0015, 0.0113, 0);
  const tbody = part(cyl6, olive, 0.0175, 0.0062, 0.0145, 0, 0.0031, 0);
  turret.add(tbody);
  turret.add(box(0.007, 0.0045, 0.0118, oliveDark, -0.0085, 0.0028, 0)); // bustle
  turret.add(box(0.0016, 0.0005, 0.0122, sand, -0.0122, 0.005, 0)); // stowage rail
  turret.add(box(0.004, 0.0042, 0.0062, oliveDark, 0.0088, 0.0029, 0)); // gun mantlet
  const barrel = part(cyl10, steel, 0.0026, 0.024, 0.0026, 0.0215, 0.0031, 0);
  barrel.rotation.z = Math.PI / 2;
  turret.add(barrel);
  const sleeve = part(cyl10, oliveDark, 0.0036, 0.006, 0.0036, 0.0128, 0.0031, 0);
  sleeve.rotation.z = Math.PI / 2;
  turret.add(sleeve);
  const brake = part(cyl10, steel, 0.0036, 0.0034, 0.0036, 0.0333, 0.0031, 0); // muzzle brake
  brake.rotation.z = Math.PI / 2;
  turret.add(brake);
  // commander cupola + hatch + machine gun
  turret.add(part(cyl10, oliveDark, 0.0052, 0.0022, 0.0052, -0.003, 0.0072, 0.0032));
  turret.add(part(cyl10, olive, 0.0044, 0.0008, 0.0044, -0.003, 0.0086, 0.0032));
  const mg = part(cyl6, steel, 0.0008, 0.0062, 0.0008, 0.0006, 0.0088, 0.0032);
  mg.rotation.z = Math.PI / 2;
  turret.add(mg);
  // smoke dischargers
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const d = part(cyl6, steel, 0.0011, 0.0022, 0.0011, 0.0048 - i * 0.0013, 0.0052, s * 0.0072);
      d.rotation.x = (s * Math.PI) / 3;
      turret.add(d);
    }
  }
  // star insignia
  turret.add(box(0.0034, 0.0034, 0.0003, solid(0xeeeeee), -0.002, 0.0032, 0.0074));
  // antenna + red beacon
  turret.add(box(0.0006, 0.016, 0.0006, steel, -0.0095, 0.012, -0.0045));
  const beacon = box(0.0026, 0.0026, 0.0026, glow(0xff3030), -0.0095, 0.0205, -0.0045);
  beacon.name = 'beacon';
  turret.add(beacon);
  g.add(turret);
  bake(g);
  g.scale.setScalar(1.3);
  return g;
}

/** Attack helicopter, nose along +X. */
export function buildHelicopter(): Group {
  const g = new Group();
  const body = solid(0x4c6146);
  const bodyDark = solid(0x39493a);
  const sand = solid(0xa39d6a);
  const steel = solid(0x262a26, 0.55, 0.3);

  // fuselage: capsule body, tapered nose, engine hump
  const fus = part(new CapsuleGeometry(0.5, 1, 4, 10), body, 0.016, 0.022, 0.0135, 0, 0, 0);
  fus.rotation.z = Math.PI / 2;
  g.add(fus);
  g.add(box(0.016, 0.0015, 0.0132, sand, -0.002, -0.004, 0)); // belly stripe
  const canopy = part(new SphereGeometry(0.5, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), glass(), 0.016, 0.012, 0.011, 0.0085, 0.003, 0);
  canopy.rotation.z = -0.35;
  g.add(canopy);
  g.add(box(0.0008, 0.006, 0.0115, bodyDark, 0.0085, 0.0058, 0)); // canopy frame
  const nose = part(cone, bodyDark, 0.009, 0.008, 0.009, 0.0215, -0.001, 0);
  nose.rotation.z = -Math.PI / 2;
  g.add(nose);
  const gun = part(cyl6, steel, 0.0012, 0.008, 0.0012, 0.019, -0.0075, 0); // chin gun
  gun.rotation.z = Math.PI / 2;
  g.add(gun);
  g.add(box(0.014, 0.0055, 0.0095, bodyDark, -0.004, 0.0085, 0)); // engine hump
  for (const s of [-1, 1]) {
    const ex = part(cyl6, steel, 0.0028, 0.004, 0.0028, -0.0115, 0.0085, s * 0.0045);
    ex.rotation.z = Math.PI / 2;
    g.add(ex);
  }
  // tail boom, fin, stabiliser
  const boom = new Mesh(new CylinderGeometry(0.0019, 0.0042, 0.032, 8), body);
  boom.rotation.z = Math.PI / 2;
  boom.position.set(-0.03, 0.003, 0);
  boom.castShadow = true;
  g.add(boom);
  const fin = box(0.007, 0.012, 0.0012, body, -0.0455, 0.0085, 0);
  fin.rotation.z = 0.35;
  g.add(fin);
  g.add(box(0.0055, 0.0008, 0.014, bodyDark, -0.041, 0.003, 0));
  g.add(box(0.003, 0.0016, 0.0013, sand, -0.0465, 0.0128, 0));
  // stub wings with rocket pods + missiles
  for (const s of [-1, 1]) {
    g.add(box(0.008, 0.0012, 0.012, bodyDark, -0.002, -0.0015, s * 0.0115));
    const pod = part(cyl10, steel, 0.0042, 0.0085, 0.0042, -0.001, -0.0045, s * 0.0155);
    pod.rotation.z = Math.PI / 2;
    g.add(pod);
    const podFace = part(cyl10, solid(0x111111), 0.0034, 0.0004, 0.0034, 0.0034, -0.0045, s * 0.0155);
    podFace.rotation.z = Math.PI / 2;
    g.add(podFace);
    const mis = part(cyl6, sand, 0.0016, 0.009, 0.0016, -0.0005, -0.0035, s * 0.0185);
    mis.rotation.z = Math.PI / 2;
    g.add(mis);
  }
  // skids
  for (const s of [-1, 1]) {
    const skid = part(cyl6, steel, 0.0012, 0.03, 0.0012, 0.001, -0.0125, s * 0.0078);
    skid.rotation.z = Math.PI / 2;
    g.add(skid);
    for (const x of [0.008, -0.006]) {
      const strut = box(0.001, 0.007, 0.001, steel, x, -0.009, s * 0.0068);
      strut.rotation.x = s * 0.3;
      g.add(strut);
    }
  }
  // main rotor: mast, hub, 4 blades
  g.add(part(cyl6, steel, 0.0024, 0.005, 0.0024, -0.002, 0.0128, 0));
  const rotor = new Group();
  rotor.name = 'rotor';
  rotor.position.set(-0.002, 0.0155, 0);
  rotor.add(part(cyl10, steel, 0.005, 0.0016, 0.005));
  for (let i = 0; i < 4; i++) {
    const blade = box(0.036, 0.0005, 0.0032, solid(0x1d211d), 0.019, 0, 0);
    const arm = new Group();
    arm.rotation.y = (i * Math.PI) / 2;
    arm.add(blade);
    rotor.add(arm);
  }
  g.add(rotor);
  // tail rotor
  const tailRotor = new Group();
  tailRotor.name = 'tailRotor';
  tailRotor.position.set(-0.047, 0.009, 0.0022);
  tailRotor.add(box(0.0008, 0.015, 0.0018, solid(0x1d211d)));
  tailRotor.add(box(0.015, 0.0008, 0.0018, solid(0x1d211d)));
  g.add(tailRotor);
  // nav lights
  const beacon = box(0.0024, 0.0024, 0.0024, glow(0xff3030), -0.004, 0.0118, 0);
  beacon.name = 'beacon';
  g.add(beacon);
  g.add(box(0.0016, 0.0016, 0.0016, glow(0x40ff60), -0.002, -0.001, 0.0222));
  g.add(box(0.0016, 0.0016, 0.0016, glow(0xff4040), -0.002, -0.001, -0.0222));
  return bake(g);
}
