/**
 * "Diorama bubble" for the close-up campaign camera (Moss-style): when the city is zoomed in,
 * everything outside a circle around the hero is cut away in the fragment shader, and a soil
 * rim + glowing edge make the cut look like a slice of a tabletop diorama.
 */
import {
  AdditiveBlending,
  CylinderGeometry,
  DoubleSide,
  Group,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  RingGeometry,
  Vector3,
} from '@iwsdk/core';

interface ShaderLike {
  uniforms: Record<string, { value: unknown }>;
  vertexShader: string;
  fragmentShader: string;
}

export class Bubble {
  /** world-space clip centre (only x/z are used) */
  readonly center = new Vector3();
  /** world-space radius; 0 = no clipping */
  readonly radius = { value: 0 };
  /** how visible the city stays far from the hero (0..1) */
  readonly minAlpha = { value: 0.28 };
  private uCenter = { value: this.center };
  private patched = new WeakSet<Material>();
  readonly rim = new Group();
  private wall: Mesh;
  private edge: Mesh;
  private edgeMat: MeshBasicMaterial;
  private t = 0;

  constructor() {
    this.rim.name = 'DioramaRim';
    this.wall = new Mesh(
      new CylinderGeometry(1, 1, 1, 96, 1, true),
      new MeshStandardMaterial({ color: 0x5b4636, roughness: 1, side: DoubleSide }),
    );
    this.wall.position.y = -0.5;
    this.edgeMat = new MeshBasicMaterial({ color: 0x9ef0ff, transparent: true, opacity: 0.7, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
    this.edge = new Mesh(new RingGeometry(0.985, 1.012, 128), this.edgeMat);
    this.edge.rotation.x = -Math.PI / 2;
    this.edge.position.y = 0.0006;
    this.rim.add(this.edge);
    this.rim.visible = false;
  }

  /** Make every material under `root` respect the clip circle (cheap after the first pass). */
  patch(root: Object3D) {
    root.traverse((o) => {
      const m = (o as Mesh).material as Material | Material[] | undefined;
      if (!m) return;
      for (const mat of Array.isArray(m) ? m : [m]) this.patchMaterial(mat);
    });
  }

  patchMaterial(mat: Material) {
    if (this.patched.has(mat)) return;
    this.patched.add(mat);
    const prev = mat.onBeforeCompile;
    const uC = this.uCenter;
    const uR = this.radius;
    const uM = this.minAlpha;
    mat.onBeforeCompile = (shader: ShaderLike, renderer: unknown) => {
      (prev as (s: ShaderLike, r: unknown) => void).call(mat, shader, renderer);
      if (!shader.vertexShader.includes('#include <project_vertex>')) return;
      shader.uniforms.fkC = uC;
      shader.uniforms.fkR = uR;
      shader.uniforms.fkMin = uM;
      shader.vertexShader = shader.vertexShader
        .replace('void main() {', 'varying vec3 vFkW;\nvoid main() {')
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>
          {
            vec4 fkP = vec4( transformed, 1.0 );
            #ifdef USE_BATCHING
              fkP = batchingMatrix * fkP;
            #endif
            #ifdef USE_INSTANCING
              fkP = instanceMatrix * fkP;
            #endif
            vFkW = ( modelMatrix * fkP ).xyz;
          }`,
        );
      shader.fragmentShader = shader.fragmentShader.replace(
        'void main() {',
        `uniform vec3 fkC;
        uniform float fkR;
        uniform float fkMin;
        varying vec3 vFkW;
        void main() {
          if ( fkR > 0.0 ) {
            // outside the focus circle the city fades to a see-through ghost (ordered dither: no sorting needed)
            float fkD = length( vFkW.xz - fkC.xz );
            float fkA = mix( 1.0, fkMin, smoothstep( fkR * 0.85, fkR * 1.35, fkD ) );
            vec2 fkP = mod( floor( gl_FragCoord.xy ), 4.0 );
            float fkB = ( fkP.x == 0.0 ? ( fkP.y == 0.0 ? 0.0 : fkP.y == 1.0 ? 12.0 : fkP.y == 2.0 ? 3.0 : 15.0 )
                       : fkP.x == 1.0 ? ( fkP.y == 0.0 ? 8.0 : fkP.y == 1.0 ? 4.0 : fkP.y == 2.0 ? 11.0 : 7.0 )
                       : fkP.x == 2.0 ? ( fkP.y == 0.0 ? 2.0 : fkP.y == 1.0 ? 14.0 : fkP.y == 2.0 ? 1.0 : 13.0 )
                       : ( fkP.y == 0.0 ? 10.0 : fkP.y == 1.0 ? 6.0 : fkP.y == 2.0 ? 9.0 : 5.0 ) ) / 16.0 + 0.03;
            if ( fkB > fkA ) discard;
          }`,
      );
    };
    const key = mat.customProgramCacheKey?.bind(mat);
    mat.customProgramCacheKey = () => `${key ? key() : ''}|fkclip`;
    mat.needsUpdate = true;
  }

  /** place the rim around the clip circle; `top` is the world height of the city ground */
  update(dt: number, top: number, depth: number) {
    this.t += dt;
    const r = this.radius.value;
    this.rim.visible = r > 0;
    if (r <= 0) return;
    this.rim.position.set(this.center.x, top, this.center.z);
    this.wall.scale.set(r, depth, r);
    this.wall.position.y = -depth / 2;
    this.edge.scale.setScalar(r);
    this.edgeMat.opacity = 0.45 + Math.sin(this.t * 2.2) * 0.15;
  }
}
