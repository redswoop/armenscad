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
  console.log('[viewer] debug handle: window.viewer');
}
