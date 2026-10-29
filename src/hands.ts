/** Reads WebXR hand joints each frame and exposes world-space fingertips. */
import { Matrix4, Object3D, Quaternion, Vector3, WebGLRenderer } from '@iwsdk/core';

export const TIP_NAMES: XRHandJoint[] = [
  'thumb-tip',
  'index-finger-tip',
  'middle-finger-tip',
  'ring-finger-tip',
  'pinky-finger-tip',
];
export const DISTAL_NAMES: XRHandJoint[] = [
  'thumb-phalanx-distal',
  'index-finger-phalanx-distal',
  'middle-finger-phalanx-distal',
  'ring-finger-phalanx-distal',
  'pinky-finger-phalanx-distal',
];

export interface HandData {
  tracked: boolean;
  tips: Vector3[];
  /** last finger joint before each tip (tip - distal = finger direction) */
  distal: Vector3[];
  wrist: Vector3;
  palm: Vector3;
  wristPrev: Vector3;
  wristVel: Vector3;
  pinch: boolean;
  pinchStart: boolean;
  pinchEnd: boolean;
  pinchPoint: Vector3;
  pinchPrev: Vector3;
  pinchVel: Vector3;
  pinchHeld: number;
  /** average fingertip-to-palm distance (m); small = closed fist */
  curl: number;
  fist: boolean;
  /** pinch or fist */
  grab: boolean;
  grabStart: boolean;
  grabEnd: boolean;
  grabPoint: Vector3;
  speed: number;
}

function makeHand(): HandData {
  return {
    tracked: false,
    tips: TIP_NAMES.map(() => new Vector3()),
    distal: TIP_NAMES.map(() => new Vector3()),
    wrist: new Vector3(),
    palm: new Vector3(),
    wristPrev: new Vector3(),
    wristVel: new Vector3(),
    pinch: false,
    pinchStart: false,
    pinchEnd: false,
    pinchPoint: new Vector3(),
    pinchPrev: new Vector3(),
    pinchVel: new Vector3(),
    pinchHeld: 0,
    curl: 0.1,
    fist: false,
    grab: false,
    grabStart: false,
    grabEnd: false,
    grabPoint: new Vector3(),
    speed: 0,
  };
}

export class HandTracker {
  readonly hands: Record<'left' | 'right', HandData> = { left: makeHand(), right: makeHand() };
  private v = new Vector3();
  private virtual = { left: false, right: false };

  update(renderer: WebGLRenderer, player: Object3D, dt: number) {
    const frame = renderer.xr.getFrame?.() as XRFrame | null | undefined;
    const ref = renderer.xr.getReferenceSpace();
    const session = renderer.xr.getSession();
    const seen = { left: false, right: false };
    if (frame && ref && session) {
      player.updateWorldMatrix(true, false);
      for (const src of session.inputSources) {
        if (!src.hand || (src.handedness !== 'left' && src.handedness !== 'right')) continue;
        const h = this.hands[src.handedness];
        let ok = true;
        const read = (name: XRHandJoint, out: Vector3) => {
          const space = src.hand!.get(name);
          const pose = space ? frame.getJointPose?.(space, ref) : undefined;
          if (!pose) {
            ok = false;
            return;
          }
          const p = pose.transform.position;
          out.set(p.x, p.y, p.z).applyMatrix4(player.matrixWorld);
        };
        for (let i = 0; i < TIP_NAMES.length; i++) {
          read(TIP_NAMES[i], h.tips[i]);
          read(DISTAL_NAMES[i], h.distal[i]);
        }
        read('wrist', h.wrist);
        read('middle-finger-metacarpal', h.palm);
        if (!ok) continue;
        seen[src.handedness] = true;
        // wrist velocity (smoothed)
        if (h.tracked && dt > 0) {
          this.v.subVectors(h.wrist, h.wristPrev).divideScalar(dt);
          h.wristVel.lerp(this.v, 0.6);
        } else h.wristVel.set(0, 0, 0);
        h.wristPrev.copy(h.wrist);
        // pinch with hysteresis
        const d = h.tips[0].distanceTo(h.tips[1]);
        const was = h.pinch;
        h.pinch = was ? d < 0.035 : d < 0.018;
        h.pinchStart = h.pinch && !was;
        h.pinchEnd = !h.pinch && was;
        h.pinchPrev.copy(h.pinchPoint);
        h.pinchPoint.addVectors(h.tips[0], h.tips[1]).multiplyScalar(0.5);
        if (h.tracked && dt > 0) {
          this.v.subVectors(h.pinchPoint, h.pinchPrev).divideScalar(dt);
          h.pinchVel.lerp(this.v, 0.5);
        }
        h.pinchHeld = h.pinch ? h.pinchHeld + dt : 0;
        // fist: index..pinky tips close to the palm
        let curl = 0;
        for (let i = 1; i < 5; i++) curl += h.tips[i].distanceTo(h.palm);
        h.curl = curl / 4;
        h.fist = h.fist ? h.curl < 0.07 : h.curl < 0.055;
        const wasGrab = h.grab;
        h.grab = h.pinch || h.fist;
        h.grabStart = h.grab && !wasGrab;
        h.grabEnd = !h.grab && wasGrab;
        if (h.pinch) h.grabPoint.copy(h.pinchPoint);
        else h.grabPoint.lerpVectors(h.palm, h.tips[2], 0.35);
        h.speed = h.wristVel.length();
        h.tracked = true;
      }
    }
    for (const side of ['left', 'right'] as const) {
      const h = this.hands[side];
      // driven by a controller last frame (fromController): keep its edges intact
      if (!seen[side] && this.virtual[side]) {
        this.virtual[side] = false;
        continue;
      }
      if (!seen[side]) {
        h.pinchEnd = h.pinch;
        h.grabEnd = h.grab;
        h.grab = false;
        h.grabStart = false;
        h.fist = false;
        h.tracked = false;
        h.pinch = false;
        h.pinchStart = false;
        h.pinchHeld = 0;
      }
    }
  }

  private m = new Matrix4();
  private pos = new Vector3();
  private q = new Quaternion();
  private fwd = new Vector3();
  private up = new Vector3();
  private side = new Vector3();

  /**
   * No tracked hand but a Quest controller: synthesize a "paw" from the grip pose so every
   * hand interaction (touch-smash, pinch, fist-grab, crush, slam) works with controllers too.
   * close = 0..1 (squeeze), pinch = trigger.
   */
  fromController(which: 'left' | 'right', grip: Object3D, close: number, pinchBtn: boolean, dt: number) {
    const h = this.hands[which];
    this.virtual[which] = true;
    grip.updateWorldMatrix(true, false);
    this.m.copy(grip.matrixWorld);
    this.m.decompose(this.pos, this.q, this.v);
    this.fwd.set(0, 0, -1).applyQuaternion(this.q);
    this.up.set(0, 1, 0).applyQuaternion(this.q);
    this.side.set(which === 'left' ? 1 : -1, 0, 0).applyQuaternion(this.q);
    // palm a little in front of the controller, fingers further out (curling in when closed)
    h.wrist.copy(this.pos);
    h.palm.copy(this.pos).addScaledVector(this.fwd, 0.035);
    const k = Math.max(0, Math.min(1, close));
    for (let i = 0; i < 5; i++) {
      const lat = i === 0 ? 0.03 : (i - 2.5) * 0.017;
      const reach = i === 0 ? 0.045 : 0.085 - (i === 4 ? 0.012 : 0);
      const tip = h.tips[i];
      tip.copy(h.palm).addScaledVector(this.side, lat * (1 - k * 0.5)).addScaledVector(this.fwd, (reach - 0.035) * (1 - k * 0.85)).addScaledVector(this.up, -k * 0.022);
      h.distal[i].lerpVectors(h.palm, tip, 0.75);
    }
    if (pinchBtn) h.tips[0].copy(h.tips[1]).addScaledVector(this.side, 0.004);
    if (h.tracked && dt > 0) {
      this.v.subVectors(h.wrist, h.wristPrev).divideScalar(dt);
      h.wristVel.lerp(this.v, 0.6);
    } else h.wristVel.set(0, 0, 0);
    h.wristPrev.copy(h.wrist);
    const was = h.pinch;
    h.pinch = pinchBtn;
    h.pinchStart = h.pinch && !was;
    h.pinchEnd = !h.pinch && was;
    h.pinchPrev.copy(h.pinchPoint);
    h.pinchPoint.addVectors(h.tips[0], h.tips[1]).multiplyScalar(0.5);
    if (h.tracked && dt > 0) {
      this.v.subVectors(h.pinchPoint, h.pinchPrev).divideScalar(dt);
      h.pinchVel.lerp(this.v, 0.5);
    }
    h.pinchHeld = h.pinch ? h.pinchHeld + dt : 0;
    let curl = 0;
    for (let i = 1; i < 5; i++) curl += h.tips[i].distanceTo(h.palm);
    h.curl = curl / 4;
    h.fist = k > 0.6;
    const wasGrab = h.grab;
    h.grab = h.pinch || h.fist;
    h.grabStart = h.grab && !wasGrab;
    h.grabEnd = !h.grab && wasGrab;
    if (h.pinch) h.grabPoint.copy(h.pinchPoint);
    else h.grabPoint.lerpVectors(h.palm, h.tips[2], 0.35);
    h.speed = h.wristVel.length();
    h.tracked = true;
  }
}
