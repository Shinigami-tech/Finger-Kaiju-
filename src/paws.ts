/**
 * God mode: your hands (tracked hands or Quest controllers) become giant fluffy hamster paws:
 * a furry palm, pink pads and five little fingers that follow your fingertips, so the paw
 * closes into a fist when you squeeze.
 */
import { Group, Mesh, MeshStandardMaterial, Quaternion, SphereGeometry, CylinderGeometry, Vector3 } from '@iwsdk/core';
import type { HandData } from './hands.js';

const FUR = 0xf3e4cc;
const FUR_DARK = 0xd9b98f;
const PAD = 0xff9fae;

class Paw {
  readonly root = new Group();
  private palm: Mesh;
  private pad: Mesh;
  private cuff: Mesh;
  private fingers: { bone: Mesh; tip: Mesh; bean: Mesh }[] = [];
  private q = new Quaternion();
  private a = new Vector3();
  private b = new Vector3();
  private up = new Vector3(0, 1, 0);
  private dir = new Vector3();

  constructor(fur: MeshStandardMaterial, furDark: MeshStandardMaterial, pad: MeshStandardMaterial, ball: SphereGeometry, rod: CylinderGeometry) {
    this.palm = new Mesh(ball, fur);
    this.pad = new Mesh(ball, pad);
    this.cuff = new Mesh(ball, furDark);
    this.root.add(this.palm, this.pad, this.cuff);
    for (let i = 0; i < 5; i++) {
      const bone = new Mesh(rod, fur);
      const tip = new Mesh(ball, fur);
      const bean = new Mesh(ball, pad);
      this.root.add(bone, tip, bean);
      this.fingers.push({ bone, tip, bean });
    }
    for (const m of [this.palm, this.pad, this.cuff]) m.castShadow = true;
    this.root.visible = false;
  }

  update(h: HandData, show: boolean) {
    this.root.visible = show && h.tracked;
    if (!this.root.visible) return;
    // palm: between wrist and the middle-finger knuckle, a fat flattened ball
    this.a.lerpVectors(h.wrist, h.palm, 0.75);
    this.dir.subVectors(h.palm, h.wrist).normalize();
    this.q.setFromUnitVectors(this.up, this.dir);
    this.palm.position.copy(this.a);
    this.palm.quaternion.copy(this.q);
    this.palm.scale.set(0.036, 0.042, 0.022);
    this.cuff.position.copy(h.wrist).addScaledVector(this.dir, 0.006);
    this.cuff.quaternion.copy(this.q);
    this.cuff.scale.set(0.03, 0.022, 0.026);
    // pad on the palm side (approximated by the direction towards the curled thumb)
    this.b.subVectors(h.tips[0], this.a).projectOnPlane(this.dir).normalize();
    this.pad.position.copy(this.a).addScaledVector(this.b, 0.008);
    this.pad.quaternion.copy(this.q);
    this.pad.scale.set(0.022, 0.024, 0.012);
    for (let i = 0; i < 5; i++) {
      const f = this.fingers[i];
      const base = this.b.lerpVectors(h.palm, h.distal[i], i === 0 ? 0.2 : 0.05);
      const tip = h.tips[i];
      const len = Math.max(0.004, base.distanceTo(tip));
      this.dir.subVectors(tip, base).normalize();
      f.bone.position.addVectors(base, tip).multiplyScalar(0.5);
      f.bone.quaternion.setFromUnitVectors(this.up, this.dir);
      const r = i === 0 ? 0.0105 : i === 4 ? 0.0085 : 0.0095;
      f.bone.scale.set(r, len, r);
      f.tip.position.copy(tip);
      f.tip.scale.setScalar(r * 1.15);
      // little pink bean on the fingertip
      f.bean.position.copy(tip).addScaledVector(this.dir, -r * 0.3);
      f.bean.scale.setScalar(r * 0.75);
    }
  }
}

export class HamsterPaws {
  readonly root = new Group();
  readonly left: Paw;
  readonly right: Paw;

  constructor() {
    this.root.name = 'HamsterPaws';
    const ball = new SphereGeometry(1, 20, 14);
    const rod = new CylinderGeometry(1, 1, 1, 12, 1);
    const fur = new MeshStandardMaterial({ color: FUR, roughness: 0.95 });
    const furDark = new MeshStandardMaterial({ color: FUR_DARK, roughness: 0.95 });
    const pad = new MeshStandardMaterial({ color: PAD, roughness: 0.6 });
    this.left = new Paw(fur, furDark, pad, ball, rod);
    this.right = new Paw(fur, furDark, pad, ball, rod);
    this.root.add(this.left.root, this.right.root);
  }

  update(hands: [HandData, HandData], show: boolean) {
    this.left.update(hands[0], show);
    this.right.update(hands[1], show);
  }
}
