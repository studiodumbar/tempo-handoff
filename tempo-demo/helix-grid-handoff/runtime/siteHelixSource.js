import * as THREE from "../vendor/three.module.js";
import { ParticleEngine, sortLayout } from "./particles.js";
import { TerminalPass } from "./terminal.js";
import { MODE_BY_KEY, paramValues } from "./modes.js";

/** The merch preset through the original particle and quadrant-glyph passes. */
export async function createSiteHelixSource() {
  const response = await fetch(new URL("../presets/merch-transition.tempo.json", import.meta.url));
  if (!response.ok) throw new Error("Could not load the merch helix preset");
  const project = await response.json();
  const clip = project.clips.find((entry) => entry.key === "helix-train");
  return new SiteHelixSource(project, clip);
}

export class SiteHelixSource {
  constructor(project, clip) {
    this.project = project;
    this.frame.referenceHelix = this;
    this.settings = { ...paramValues(MODE_BY_KEY[clip.key]), ...clip.params };
    // The site prints these cells with its glyph font, whose ink box differs
    // from the editor's shader glyphs. Metrics measured from the supplied recording.
    this.glyph = { gapX: .075, gapY: .0625, dotRadius: .75 };
    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
    this.renderer.setSize(1, 1, false);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, .1, 60);
    this.camera.position.set(0, 0, 3.55);
    this.engine = new ParticleEngine(16384);
    this.engine.camera = this.camera;
    this.scene.add(this.engine.points);
    this.mode = Object.create(MODE_BY_KEY[clip.key]);
    this.mode._values = this.settings;
    const layout = sortLayout(this.mode.gen(this.engine.N, this.settings), this.engine.N);
    this.engine.setPairDirect(this.mode, layout, this.mode, layout);
    this.terminal = new TerminalPass();
    this.terminal.cellRT.texture.type = THREE.FloatType;
    this.width = this.height = 0;
    this.disposed = false;
  }

  resize(width, height) {
    const scn = this.project.scene, baseAspect = this.project.comp.width / this.project.comp.height;
    this.width = width; this.height = height;
    this.terminal.cellW = scn.cellW; this.terminal.cellH = scn.cellH;
    this.terminal.setSize(width, height, width, height);
    const { cols, rows } = this.terminal;
    this.camera.aspect = cols * scn.cellW / (rows * scn.cellH);
    this.camera.fov = this.camera.aspect >= baseAspect ? scn.fov
      : 360 * Math.atan(baseAspect / this.camera.aspect * Math.tan(scn.fov * Math.PI / 360)) / Math.PI;
    this.camera.updateProjectionMatrix();
    this.pixels = new Float32Array(cols * rows * 4);
    const u = this.engine.material.uniforms;
    u.uGain.value = scn.gain;
    u.uBaseSize.value = scn.baseSize;
    u.uSnapGrid.value.set(cols * 2, rows * 4);
    u.uProjScale.value = rows * 4 / (2 * Math.tan(this.camera.fov * Math.PI / 360));
    u.uMaxPt.value = 7; u.uMinPt.value = 1; u.uSplit.value = 1;
    const c = this.terminal.cellify.mat.uniforms;
    c.uDotThresh.value = scn.dotThresh; c.uDither.value = scn.dither;
    c.uBlockLo.value = scn.blockLo; c.uBlockHi.value = scn.blockHi;
  }

  frame = (time, width, height, pose = {}) => {
    if (this.disposed) return [];
    if (width !== this.width || height !== this.height) this.resize(width, height);
    this.engine.rotExtra = pose.rotation || 0;
    this.engine.renderState(time, 1);
    return this.readGlyphs();
  };

  readGlyphs() {
    const { renderer, terminal, camera, pixels, width, height } = this;
    renderer.setRenderTarget(terminal.sceneRT);
    renderer.setClearColor(0, 0); renderer.clear();
    renderer.render(this.scene, camera);
    renderer.setRenderTarget(terminal.cellRT);
    renderer.render(terminal.cellify.scene, terminal.cellify.cam);
    renderer.readRenderTargetPixels(terminal.cellRT, 0, 0, terminal.cols, terminal.rows, pixels);
    renderer.setRenderTarget(null);
    const scn = this.project.scene, glyphs = [];
    const originX = (width - terminal.cols * scn.cellW) / 2;
    const originY = (height - terminal.rows * scn.cellH) / 2;
    for (let y = 0; y < terminal.rows; y++) for (let x = 0; x < terminal.cols; x++) {
      const i = ((terminal.rows - y - 1) * terminal.cols + x) * 4;
      const bits = Math.round(pixels[i]), quadrants = Math.round(pixels[i + 3]);
      if (!bits && !quadrants) continue;
      let mask = 0;
      for (let row = 0; row < 4; row++) mask |= ((bits >> (row * 2)) & 3) << ((3 - row) * 2);
      const qmask = ((quadrants & 3) << 2) | ((quadrants >> 2) & 3);
      glyphs.push({ x: originX + x * scn.cellW, y: originY + y * scn.cellH,
        mask, qmask, alpha: 1, cellWidth: scn.cellW, cellHeight: scn.cellH,
        ...this.glyph });
    }
    return glyphs;
  }

  /** Project the same helix stations for emission, keeping their angular velocity. */
  emitters = (time, width, height, pose = {}) => {
    if (width !== this.width || height !== this.height) this.resize(width, height);
    const p = this.settings, lens = height / (2 * Math.tan(this.camera.fov * Math.PI / 360));
    const points = [], angular = -(p.spin + (pose.angularVelocity || 0));
    for (let i = 0; i < p.line; i++) {
      const f = i / (p.line - 1) * .999;
      const angle = f * p.turns * Math.PI * 2 - time * p.spin - (pose.rotation || 0);
      const wx = Math.cos(angle) * p.radius, wz = Math.sin(angle) * p.radius;
      const wy = p.height / 2 - p.height * f, depth = 3.55 - wz;
      const x = width / 2 + wx * lens / depth, y = height / 2 - wy * lens / depth;
      if (x < 0 || x > width || y < 0 || y > height) continue;
      const vx = lens * (-wz * depth + wx * wx) / (depth * depth) * angular;
      const vy = -wy * lens * wx / (depth * depth) * angular;
      points.push({ x, y, vx, vy, station: f, mask: 1, alpha: 1 });
    }
    return points;
  };

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.engine.points.traverse((object) => { object.geometry?.dispose(); object.material?.dispose(); });
    this.engine.printMat.dispose();
    for (const pass of [this.terminal.compose, this.terminal.phosmix, this.terminal.cellify, this.terminal.glyph]) {
      pass.scene.traverse((object) => object.geometry?.dispose()); pass.mat.dispose();
    }
    for (const rt of [this.terminal.sceneRT, this.terminal.cellRT, this.terminal.mixRT, ...this.terminal.accumRT]) rt.dispose();
    this.renderer.dispose();
  }
}
