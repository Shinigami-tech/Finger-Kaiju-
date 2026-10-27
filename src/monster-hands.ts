/**
 * Turns the player's real hands into kaiju hands: scaly fingertip caps with curved claws
 * that follow each finger, plus soft "contact shadows" on the city under the palm and
 * every fingertip so you can judge height above the tiny streets in mixed reality.
 */
import {
  CanvasTexture,
  CircleGeometry,
  Color,
  ConeGeometry,
  Group,
  IcosahedronGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  SRGBColorSpace,
  Vector3,
} from '@iwsdk/core';
import type { HandData } from './hands.js';

function clawGeometry() {
  const g = new ConeGeometry(0.5, 1, 7, 4);
  g.translate(0, 0.5, 0); // base at the origin, tip at +Y
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    p.setX(i, p.getX(i) + y * y * 0.55); // curve towards +X (palm side)
  }
  g.computeVertexNormals();
  return g;
}

function capGeometry() {
  const g = new IcosahedronGeometry(1, 2);
  const p = g.attributes.position;
  // small random bumps = scales
  const seen = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let k = seen.get(key);
    if (k === undefined) {
      k = 0.95 + Math.random() * 0.1;
      seen.set(key, k);
    }
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}

function softDisc() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(10,8,20,1)');
  grd.addColorStop(0.5, 'rgba(10,8,20,0.55)');
  grd.addColorStop(1, 'rgba(10,8,20,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

const SKIN = new Color(0x2f6a3a);
const HURT = new Color(0xff3a3a);
const ZOOM = new Color(0x7dff9a);

export class MonsterHands {
  /** world-space parts (caps + claws) */
  readonly root = new Group();
  /** city-local contact shadows */
  readonly shadows = new Group();
  private caps: Mesh[] = [];
  private claws: Mesh[] = [];
  private skin = new MeshStandardMaterial({ color: SKIN, roughness: 0.4, metalness: 0.1, flatShading: true });
  private clawMat = new MeshStandardMaterial({ color: 0xf1e6c8, roughness: 0.35, flatShading: true, emissive: 0x201810 });
  private palmShadows: Mesh[] = [];
  private tipShadows: Mesh[] = [];
  private dir = new Vector3();
  private down = new Vector3();
  private side = new Vector3();
  private local = new Vector3();
  private m = new Matrix4();
  private col = new Color();

  constructor() {
    this.root.name = 'MonsterHands';
    this.shadows.name = 'HandShadows';
    const cap = capGeometry();
    const claw = clawGeometry();
    for (let i = 0; i < 10; i++) {
      const c = new Mesh(cap, this.skin);
      c.visible = false;
      this.root.add(c);
      this.caps.push(c);
      const k = new Mesh(claw, this.clawMat);
      k.visible = false;
      this.root.add(k);
      this.claws.push(k);
    }
    const disc = new CircleGeometry(1, 24).rotateX(-Math.PI / 2);
    const tex = softDisc();
    const mk = () => {
      const m = new Mesh(disc, new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 }));
      m.renderOrder = 3;
      m.visible = false;
      this.shadows.add(m);
      return m;
    };
    for (let i = 0; i < 2; i++) this.palmShadows.push(mk());
    for (let i = 0; i < 10; i++) this.tipShadows.push(mk());
  }

  /**
   * @param city the city group (for the local-space shadows)
   * @param half half the city size (shadows only over the city)
   * @param tint 0 normal, 1 hurt flash, 2 zooming
   */
  update(hands: HandData[], visible: boolean, city: Object3D, half: number, tint: number) {
    this.skin.color.copy(tint === 1 ? HURT : tint === 2 ? ZOOM : SKIN);
    const scale = city.scale.x;
    for (let h = 0; h < 2; h++) {
      const hand = hands[h];
      const on = visible && hand.tracked;
      for (let f = 0; f < 5; f++) {
        const i = h * 5 + f;
        const cap = this.caps[i];
        const claw = this.claws[i];
        cap.visible = claw.visible = on;
        if (!on) {
          this.tipShadows[i].visible = false;
          continue;
        }
        const tip = hand.tips[f];
        this.dir.subVectors(tip, hand.distal[f]);
        const len = this.dir.length();
        if (len < 1e-4) this.dir.set(0, 0, -1);
        else this.dir.divideScalar(len);
        // palm side: from the fingertip towards the palm, made perpendicular to the finger
        this.down.subVectors(hand.palm, tip);
        this.down.addScaledVector(this.dir, -this.down.dot(this.dir));
        if (this.down.lengthSq() < 1e-8) this.down.set(0, -1, 0);
        this.down.normalize();
        this.side.crossVectors(this.down, this.dir);
        // basis: X = palm side (claw curls that way), Y = along the finger, Z = side
        this.m.makeBasis(this.down, this.dir, this.side);
        const thumb = f === 0;
        const r = thumb ? 0.0088 : 0.0076;
        cap.quaternion.setFromRotationMatrix(this.m);
        cap.position.copy(tip).addScaledVector(this.dir, -0.006);
        cap.scale.set(r, r * 1.45, r);
        claw.quaternion.copy(cap.quaternion);
        // claw grows out of the top of the fingertip (back of the finger), past the tip
        claw.position.copy(tip).addScaledVector(this.down, -0.0035).addScaledVector(this.dir, -0.002);
        const cl = thumb ? 0.021 : f === 4 ? 0.015 : 0.019;
        claw.scale.set(0.0068, cl, 0.0068);

        // fingertip shadow on the city
        const s = this.tipShadows[i];
        city.worldToLocal(this.local.copy(tip));
        const ht = this.local.y;
        const over = Math.abs(this.local.x) < half + 0.02 && Math.abs(this.local.z) < half + 0.02;
        s.visible = over && ht > -0.005 && ht < 0.16 / scale;
        if (s.visible) {
          const hh = Math.max(0, ht);
          s.position.set(this.local.x, 0.0048, this.local.z);
          s.scale.setScalar(0.0035 + hh * 0.05);
          (s.material as MeshBasicMaterial).opacity = 0.6 * (1 - hh / (0.16 / scale));
        }
      }
      // palm shadow
      const ps = this.palmShadows[h];
      if (!on) {
        ps.visible = false;
        continue;
      }
      city.worldToLocal(this.local.copy(hand.palm));
      const hp = this.local.y;
      const over = Math.abs(this.local.x) < half + 0.04 && Math.abs(this.local.z) < half + 0.04;
      const max = 0.35 / scale;
      ps.visible = over && hp > -0.01 && hp < max;
      if (ps.visible) {
        const hh = Math.max(0, hp);
        ps.position.set(this.local.x, 0.0047, this.local.z);
        ps.scale.setScalar(0.03 + hh * 0.15);
        (ps.material as MeshBasicMaterial).opacity = 0.42 * (1 - hh / max);
      }
    }
    void this.col;
  }
}
