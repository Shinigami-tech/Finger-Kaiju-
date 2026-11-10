/**
 * "Collector's diorama" look: filmic tone mapping, soft shadows, image-based reflections,
 * graded building materials with baked-looking ambient occlusion, a rim light, and a
 * thick display plinth with an LED edge and a city nameplate under the city.
 * Everything here is set up once; nothing allocates per frame.
 */
import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PCFShadowMap,
  PlaneGeometry,
  PMREMGenerator,
  SRGBColorSpace,
  type Scene,
  type WebGLRenderer,
} from '@iwsdk/core';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/** True on software WebGL (the desktop emulator in CI): skip the expensive extras there. */
export function softwareGl(renderer: WebGLRenderer) {
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    return /swiftshader|llvmpipe|software/i.test(name);
  } catch {
    return false;
  }
}

/** Renderer + environment. Safe to call again if something resets the renderer state. */
export function applyRendererLook(renderer: WebGLRenderer, scene: Scene, cache: { env?: unknown }) {
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.18;
  renderer.shadowMap.enabled = true;
  // PCF (not PCF-soft): sharper contact shadows at a VR-friendly cost
  renderer.shadowMap.type = PCFShadowMap;
  if (!cache.env) {
    const pmrem = new PMREMGenerator(renderer);
    cache.env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
  }
  scene.environment = cache.env as Scene['environment'];
  scene.environmentIntensity = 0.42;
}

/** Cool back light: separates buildings and the hamster from a busy real-world room. */
export function rimLight() {
  const l = new DirectionalLight(0x9cc8ff, 0.9);
  l.position.set(-0.7, 0.45, -0.8);
  return l;
}

/**
 * Building materials: richer colour, a little contrast, darker at the foot of every building
 * (fake ambient occlusion) and glassier windows. Shared Kenney atlas materials, so this is a
 * handful of shader variants for the whole city.
 */
export function gradeBuildings(mats: MeshStandardMaterial[]) {
  for (const m of mats) {
    if (m.userData.graded) continue;
    m.userData.graded = true;
    m.envMapIntensity = 0.9;
    m.roughness = Math.min(m.roughness ?? 1, 0.62);
    m.metalness = Math.max(m.metalness ?? 0, 0.08);
    const prev = m.onBeforeCompile;
    m.onBeforeCompile = (shader, r) => {
      prev?.call(m, shader, r);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vFkY;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFkY = position.y;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vFkY;')
        .replace(
          '#include <dithering_fragment>',
          `#include <dithering_fragment>
          {
            float fkAo = mix(0.58, 1.0, smoothstep(0.0, 0.55, vFkY));
            vec3 c = gl_FragColor.rgb * fkAo;
            float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
            c = mix(vec3(l), c, 1.34);
            c = (c - 0.5) * 1.1 + 0.5;
            gl_FragColor.rgb = max(c, 0.0);
          }`,
        );
    };
    m.customProgramCacheKey = () => 'fk-graded';
    m.needsUpdate = true;
  }
}

/** Fur-like rim glow for the hamster: brightens the silhouette towards the camera. */
export function furRim(m: MeshStandardMaterial, color = 0xfff0d0) {
  if (m.userData.furRim) return;
  m.userData.furRim = true;
  const col = new Color(color);
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, r) => {
    prev?.call(m, shader, r);
    shader.uniforms.fkRim = { value: col };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 fkRim;')
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
        {
          float f = 1.0 - clamp(dot(normalize(vNormal), normalize(vViewPosition)), 0.0, 1.0);
          gl_FragColor.rgb += fkRim * pow(f, 2.6) * 0.55;
        }`,
      );
  };
  const key = m.customProgramCacheKey?.bind(m);
  m.customProgramCacheKey = () => `${key ? key() : ''}|fk-fur`;
  m.needsUpdate = true;
}

function plateTexture() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 128;
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return { canvas: c, tex: t };
}

/** Total height of the plinth (top of the city ground to the table). */
export const PLINTH_H = 0.0406;

/** A display plinth under the city: walnut sides, brass-dark top lip, LED strip, nameplate. */
export class Plinth {
  readonly root = new Group();
  private plate: ReturnType<typeof plateTexture>;
  private led: MeshBasicMaterial;
  private label = '';
  private t = 0;

  constructor(half: number) {
    this.root.name = 'Plinth';
    const size = half * 2 + 0.034;
    const depth = 0.034;
    const side = new MeshStandardMaterial({ color: 0x2a1a12, roughness: 0.42, metalness: 0.05 });
    const top = new MeshStandardMaterial({ color: 0x111319, roughness: 0.35, metalness: 0.6 });
    const body = new Mesh(new BoxGeometry(size, depth, size), [side, side, top, side, side, side]);
    body.position.y = -depth / 2 - 0.0006;
    body.castShadow = true;
    body.receiveShadow = true;
    this.root.add(body);
    // stepped foot
    const foot = new Mesh(new BoxGeometry(size + 0.012, 0.006, size + 0.012), side);
    foot.position.y = -depth - 0.0036;
    foot.castShadow = true;
    this.root.add(foot);

    // LED strip around the top edge
    this.led = new MeshBasicMaterial({ color: 0x5fe3ff, transparent: true, opacity: 0.95, blending: AdditiveBlending, depthWrite: false });
    const s = size / 2 + 0.0024;
    const strip = (w: number, d: number, x: number, z: number) => {
      const m = new Mesh(new BoxGeometry(w, 0.0035, d), this.led);
      m.position.set(x, -0.006, z);
      this.root.add(m);
    };
    strip(size + 0.0026, 0.0022, 0, s);
    strip(size + 0.0026, 0.0022, 0, -s);
    strip(0.0022, size + 0.0026, s, 0);
    strip(0.0022, size + 0.0026, -s, 0);

    // nameplate on the front face
    this.plate = plateTexture();
    const pm = new Mesh(
      new PlaneGeometry(depth * 0.56 * 8, depth * 0.56),
      new MeshBasicMaterial({ map: this.plate.tex, transparent: true, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
    );
    pm.position.set(0, -depth * 0.58, size / 2 + 0.0025);
    this.root.add(pm);
    this.setLabel('TOKYO', 'FINGER KAIJU');
  }

  /** e.g. setLabel('ASTANA', 'LEVEL 16') */
  setLabel(city: string, sub: string) {
    const key = `${city}|${sub}`;
    if (key === this.label) return;
    this.label = key;
    const { canvas: c, tex } = this.plate;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, c.width, c.height);
    const grd = g.createLinearGradient(0, 0, 0, c.height);
    grd.addColorStop(0, '#d9b46a');
    grd.addColorStop(0.5, '#a07a36');
    grd.addColorStop(1, '#6e4f1f');
    g.fillStyle = grd;
    g.beginPath();
    g.roundRect(6, 10, c.width - 12, c.height - 20, 14);
    g.fill();
    g.strokeStyle = 'rgba(40,24,6,.7)';
    g.lineWidth = 3;
    g.stroke();
    g.fillStyle = '#2a1a08';
    g.textBaseline = 'middle';
    g.font = '800 58px "Space Grotesk", "Arial Black", system-ui, sans-serif';
    g.textAlign = 'left';
    g.fillText(city, 40, c.height / 2 + 3);
    g.font = '600 30px ui-monospace, Menlo, monospace';
    g.textAlign = 'right';
    g.fillText(sub, c.width - 40, c.height / 2 + 3);
    tex.needsUpdate = true;
  }

  /** LED colour follows the mood: calm cyan, red when the city is under attack. */
  update(dt: number, alarm: number) {
    this.t += dt;
    const pulse = 0.75 + 0.25 * Math.sin(this.t * (alarm > 0 ? 7 : 1.6));
    this.led.color.setRGB(0.2 + 0.8 * alarm, 0.75 - 0.6 * alarm, 1 - 0.8 * alarm).multiplyScalar(pulse * 0.6);
  }
}
