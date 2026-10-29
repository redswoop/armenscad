// window.viewer: a handle for driving the page from devtools (Claude uses it through the Chrome tools).
import * as THREE from 'three';
import { app } from './app.js';
import * as scene from './scene.js';
import { meshes, select, clearSelect, selectGroup, groupNames, groupMembers, pickPart } from './parts.js';

export function installDebug(extra = {}) {
  window.viewer = {
    get state() { return app.state; },
    get meshes() { return meshes; },
    pose: scene.getPose, setPose: scene.setPose, fit: scene.fit, fitView: scene.fitView, ortho: scene.setOrtho,
    project: (xyz) => scene.project(new THREE.Vector3(...xyz)),
    pick: (u, v) => pickPart(scene.uvToNDC(u, v)),
    select, clearSelect, selectGroup, groupNames, groupMembers,
    three: THREE, scene,
    ...extra,
  };
  window.viewer.gpu = gpu;
  const g = gpu();
  console.log('[viewer] debug handle: window.viewer');
  console.log(`[viewer] gpu: ${g.renderer} · dpr ${g.dpr} · ${g.software ? 'SOFTWARE RENDERING' : 'accelerated'}`);
}
// what WebGL is running on; "software" when the browser fell back to SwiftShader (acceleration off or blocked)
export function gpu() {
  const gl = scene.renderer.getContext();
  const d = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  return { renderer, vendor: d ? gl.getParameter(d.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR), version: gl.getParameter(gl.VERSION),
           software: /swiftshader|software|llvmpipe/i.test(renderer), dpr: devicePixelRatio, buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight] };
}
