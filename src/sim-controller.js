/**
 * SpaceDebris — Simulation Controller Module
 * Ties together KesslerSimulator physics, PostProcessing, VFX, SoundEngine, and Input System.
 */

import { KesslerSimulator } from './physics/kessler.js';
import { VisualEffectsManager } from './graphics/explosion-vfx.js';
import { SoundEngine } from './audio/sound-engine.js';
import { DebrisPlacer } from './input/debris-placer.js';
import { DebrisInputPanel } from './input/debris-panel.js';
import * as THREE from 'three';

export class SimulationController {
  constructor(sceneManager, orbitRenderer, uiManager) {
    this.sceneManager = sceneManager;
    this.orbitRenderer = orbitRenderer;
    this.uiManager = uiManager;

    this.simulator = new KesslerSimulator();
    this.vfx = new VisualEffectsManager(sceneManager.getScene());
    this.sound = new SoundEngine();

    this.domElement = sceneManager.getRenderer().domElement;
    this.placer = new DebrisPlacer(sceneManager.getScene(), sceneManager.getCamera(), this.domElement);
    this.inputPanel = new DebrisInputPanel();

    this.simMesh = null; // InstancedMesh for simulation particles
    this.simActive = false;

    this.initSimMesh();
    this.bindEvents();
  }

  initSimMesh() {
    // Dedicated InstancedMesh for physics simulation debris particles (Max 5,000)
    const geo = new THREE.SphereGeometry(12, 6, 6); // 12km mesh radius
    const mat = new THREE.MeshBasicMaterial({ color: 0xff1744 }); // Red glow
    this.simMesh = new THREE.InstancedMesh(geo, mat, 5000);
    this.simMesh.count = 0;
    this.sceneManager.getScene().add(this.simMesh);
  }

  bindEvents() {
    // 1. Placer Drag Launch Callback
    this.placer.onLaunch = (particleData) => {
      this.simulator.addParticle(particleData);
      this.sound.playDebrisLaunch();
      this.uiManager.setStatus(`Launched debris particle at ${Math.round(Math.sqrt(particleData.position.x**2 + particleData.position.y**2 + particleData.position.z**2) - 6371)} km`);
    };

    // 2. Numerical Launch Callback
    this.inputPanel.onLaunchNumerical = (particleData) => {
      this.simulator.addParticle(particleData);
      this.sound.playDebrisLaunch();
      this.uiManager.setStatus(`Launched numerical particle`);
    };

    // 3. Explosion Trigger Callback
    this.inputPanel.onExplodeTarget = (energyJ) => {
      const selectedIdx = window.app ? window.app.selectedIndex : -1;
      let pos = { x: 0, y: 7000, z: 0 };
      let vel = { vx: 0, vy: 7.5, vz: 0 };

      if (selectedIdx !== -1 && this.orbitRenderer) {
        const p = this.orbitRenderer.getObjectPosition(selectedIdx);
        if (p) pos = { x: p.x, y: p.y, z: p.z };
      }

      const energyScale = energyJ / 1e8;
      this.simulator.triggerExplosion(pos, vel, 500, energyScale);
      this.vfx.triggerExplosion(pos, energyScale);
      this.sound.playExplosion(energyScale);
    };

    // 4. Listen to Physics Simulator Events
    this.simulator.on('reentry', (data) => {
      this.vfx.triggerReentry(data.position, data.velocity);
      this.sound.playReentryBurn();
    });

    this.simulator.on('collision', (data) => {
      this.vfx.triggerExplosion(data.position, 1.2);
      this.sound.playExplosion(1.5);
      this.uiManager.setStatus(`💥 COLLISION DETECTED! ${data.newFragments} fragments generated!`);
    });
  }

  update(deltaTimeSec) {
    if (!this.simActive) return;

    // 1. Step physics loop
    const result = this.simulator.step(deltaTimeSec * 5.0); // 5x speed step

    // 2. Update VFX
    this.vfx.update(deltaTimeSec);

    // 3. Update Simulation Particles InstancedMesh
    const particles = this.simulator.getParticles();
    const count = particles.length;
    this.simMesh.count = count;

    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const p = particles[i];
      dummy.position.set(p.position.x, p.position.y, p.position.z);
      dummy.updateMatrix();
      this.simMesh.setMatrixAt(i, dummy.matrix);
    }
    this.simMesh.instanceMatrix.needsUpdate = true;
  }

  setSimActive(active) {
    this.simActive = active;
    if (active) {
      this.inputPanel.show();
    } else {
      this.inputPanel.hide();
      this.placer.setActive(false);
    }
  }

  toggleSimMode() {
    this.setSimActive(!this.simActive);
    return this.simActive;
  }
}
