// Real solidity for the asset clouds. The particles are additive with no
// depth test — that's what lets 16k dots layer into the shaded look — so on
// their own you can see straight through a model: far-wall dots (and interior
// surfaces that face the camera) shine through the front.
//
// Normals can't fix that; only the surface itself can. Each asset keeps the
// triangle soup it was sampled from, and every frame the slot's occluder is
// rendered into a small view-depth map (spin + size applied, same camera).
// The particle shader then compares each dot's own depth against the nearest
// surface at its screen position and fades whatever hides behind it.
//
// Strength ramps with the flight — an arriving asset solidifies as the dots
// land (uProg 0.55→0.95), a departing one dissolves (0.05→0.45) — so mid-air
// the swarm stays airy, and the moment it settles the model is opaque.

import * as THREE from "three";
import { paramValues } from "./modes.js";

const DEPTH_VERT = /* glsl */ `
  varying float vD;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vD = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const DEPTH_FRAG = /* glsl */ `
  precision highp float;
  varying float vD;
  void main() { gl_FragColor = vec4(vD, 0.0, 0.0, 1.0); }
`;

const FAR = 1e4;

function smooth01(x) {
  x = Math.min(1, Math.max(0, x));
  return x * x * (3 - 2 * x);
}

export class OcclusionPass {
  constructor(engine) {
    this.engine = engine;
    const rtOpts = {
      type: THREE.HalfFloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      stencilBuffer: false,
    };
    this.rtA = new THREE.WebGLRenderTarget(4, 4, rtOpts);
    this.rtB = new THREE.WebGLRenderTarget(4, 4, rtOpts);
    this.scene = new THREE.Scene();
    this.material = new THREE.ShaderMaterial({
      vertexShader: DEPTH_VERT,
      fragmentShader: DEPTH_FRAG,
      side: THREE.DoubleSide,
    });
    this.farColor = new THREE.Color(FAR, FAR, FAR);
    this._frozen = null;      // occluder captured when a flight is redirected
    this._wasFrozen = false;
    this._prevA = null;       // last frame's occluders {mesh, strength, matrix}
    this._prevB = null;

    const u = engine.material.uniforms;
    u.tDepthA.value = this.rtA.texture;
    u.tDepthB.value = this.rtB.texture;
  }

  setSize(w, h) {
    const W = Math.max(256, Math.round(w)), H = Math.max(256, Math.round(h));
    this.rtA.setSize(W, H);
    this.rtB.setSize(W, H);
  }

  _meshFor(mode) {
    if (!mode || !mode.asset || !mode.tris) return null;
    // clip instances share one GPU mesh with the library mode they came from
    const host = mode._occHost || mode;
    if (!host._occMesh) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(host.tris, 3));
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 4);
      const m = new THREE.Mesh(g, this.material);
      m.matrixAutoUpdate = false;
      m.frustumCulled = false;
      host._occMesh = m;
    }
    return host._occMesh;
  }

  /** mesh.matrix ← slot's group-0 mat3 (column-major) with the mode's size,
      per-axis stretch and shift — exactly the transform the layout bakes,
      so the occluder hugs the stretched cloud. Layout shift happens before
      the rotation, hence translation = R · shift. */
  _applyTransform(mesh, grp, P) {
    const g = grp;
    const s0 = (P.size || 1) * (P["stretch x"] || 1);
    const s1 = (P.size || 1) * (P["stretch y"] || 1);
    const s2 = P.size || 1;
    const ox = P["shift x"] || 0, oy = P["shift y"] || 0;
    mesh.matrix.set(
      g[0] * s0, g[3] * s1, g[6] * s2, g[0] * ox + g[3] * oy,
      g[1] * s0, g[4] * s1, g[7] * s2, g[1] * ox + g[4] * oy,
      g[2] * s0, g[5] * s1, g[8] * s2, g[2] * ox + g[5] * oy,
      0, 0, 0, 1);
  }

  _render(renderer, camera, rt, mesh) {
    this.scene.clear();
    this.scene.add(mesh);
    renderer.setRenderTarget(rt);
    renderer.setClearColor(this.farColor, 1);
    renderer.clear();
    renderer.render(this.scene, camera);
  }

  update(renderer, camera, solidity = 1) {
    const e = this.engine;
    const u = e.material.uniforms;
    const prog = e.prog;

    // a redirect just baked the flight into slot A — keep last frame's
    // dominant occluder (stale transform on purpose: the dots froze too)
    if (e.frozenA && !this._wasFrozen) {
      const cands = [this._prevA, this._prevB].filter(Boolean)
        .sort((x, y) => y.strength - x.strength);
      this._frozen = cands[0] || null;
    }
    this._wasFrozen = e.frozenA;
    if (!e.frozenA) this._frozen = null;

    // slot B — the arriving layout solidifies as the dots land
    let bMesh = null, sB = 0;
    if (e.modeB.asset) {
      bMesh = this._meshFor(e.modeB);
      if (bMesh) {
        sB = prog >= 1 ? 1 : smooth01((prog - 0.55) / 0.4);
        this._applyTransform(bMesh, e.slotB.grp, paramValues(e.modeB));
      }
    }

    // slot A — the departing layout dissolves as the dots leave
    let aMesh = null, sA = 0;
    if (e.frozenA) {
      if (this._frozen && this._frozen.mesh !== bMesh) {
        aMesh = this._frozen.mesh;
        sA = this._frozen.strength * (1 - smooth01((prog - 0.05) / 0.4));
        aMesh.matrix.copy(this._frozen.matrix);
      }
    } else if (e.transitioning && e.modeA.asset && e.modeA !== e.modeB) {
      aMesh = this._meshFor(e.modeA);
      if (aMesh) {
        sA = 1 - smooth01((prog - 0.05) / 0.4);
        this._applyTransform(aMesh, e.slotA.grp, paramValues(e.modeA));
      }
    }

    sA *= solidity;
    sB *= solidity;
    if (aMesh && sA > 0.001) this._render(renderer, camera, this.rtA, aMesh);
    if (bMesh && sB > 0.001) this._render(renderer, camera, this.rtB, bMesh);
    u.uOccA.value = sA;
    u.uOccB.value = sB;

    this._prevA = aMesh && sA > 0.01
      ? { mesh: aMesh, strength: sA, matrix: aMesh.matrix.clone() } : null;
    this._prevB = bMesh && sB > 0.01
      ? { mesh: bMesh, strength: sB, matrix: bMesh.matrix.clone() } : null;
  }
}
