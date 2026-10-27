/** Reads WebXR hand joints each frame and exposes world-space fingertips. */
import { Object3D, Vector3, WebGLRenderer } from '@iwsdk/core';

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
}
