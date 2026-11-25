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
    this.placer = new DebrisPlacer(
      sceneManager.getScene(),
      sceneManager.getCamera(),
      this.domElement,
      sceneManager.getControls()
    );
    this.inputPanel = new DebrisInputPanel();

    this.simMesh = null; // InstancedMesh for simulation particles
    this.simActive = false;

    // Pre-allocated scratch objects to eliminate per-frame GC spikes
    this._dummy = new THREE.Object3D();
    this._colorUser = new THREE.Color(0xff1744);    // Vibrant Crimson Red (User-Injected Debris)
    this._colorExplode = new THREE.Color(0xff3d00); // Bright Orange-Red (Explosion Debris)
    this._colorCascade = new THREE.Color(0xff0055); // Neon Red-Pink (Cascade Debris)
    this._lastStatsUiMs = 0;

    this.initSimMesh();
    this.bindEvents();
  }

  initSimMesh() {
    const geo = new THREE.SphereGeometry(1, 6, 6);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.simMesh = new THREE.InstancedMesh(geo, mat, 2500);
    this.simMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    for (let i = 0; i < 2500; i++) {
      this.simMesh.setColorAt(i, this._colorUser);
    }
    if (this.simMesh.instanceColor) {
      this.simMesh.instanceColor.needsUpdate = true;
    }

    this.simMesh.count = 0;
    this.sceneManager.getScene().add(this.simMesh);
  }

  bindEvents() {
    // 1. Placer Drag Launch Callback
    this.placer.onLaunch = (particleData) => {
      if (!this.simActive) this.simActive = true;

      const countInput = document.getElementById('input-particle-count');
      const count = countInput ? Math.max(1, Math.min(1000, parseInt(countInput.value, 10) || 1)) : 1;

      const sharedRootId = `root_user_${Date.now()}`; // Prevent injected siblings from colliding

      for (let i = 0; i < count; i++) {
        const spread = count > 1 ? 0.5 : 0;
        const vvx = particleData.velocity.vx + (Math.random() - 0.5) * spread;
        const vvy = particleData.velocity.vy + (Math.random() - 0.5) * spread;
        const vvz = particleData.velocity.vz + (Math.random() - 0.5) * spread;

        this.simulator.addParticle({
          position: { ...particleData.position },
          velocity: { vx: vvx, vy: vvy, vz: vvz },
          mass: particleData.mass || 10,
          category: 'user_injected'
        }, sharedRootId, 1, sharedRootId);
      }

      this.sound.playDebrisLaunch();
      this.uiManager.setStatus(`🚀 Launched ${count} user-injected debris particles (Red)!`);
    };

    this.placer.onCancel = () => {
      this.uiManager.setStatus(this.simActive ? 'Simulation Engine ACTIVE' : 'Tracking Live Orbits', true);
    };

    // 2. Numerical Launch Callback
    this.inputPanel.onLaunchNumerical = (particleData) => {
      if (!this.simActive) this.simActive = true;
      const rootId = `root_num_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
      this.simulator.addParticle({
        ...particleData,
        category: 'user_injected'
      }, rootId, 1, rootId);
      this.sound.playDebrisLaunch();
      this.uiManager.setStatus(`🚀 Launched numerical particle (${particleData.mass}kg)`);
    };

    // 3. Manual Explosion Trigger Callback (fixed argument order & real orbital velocity!)
    this.inputPanel.onExplodeTarget = (energyJ) => {
      const selectedIdx = window.app ? window.app.selectedIndex : -1;
      const energyScale = Math.max(0.1, energyJ / 1e8);

      if (selectedIdx !== -1 && this.orbitRenderer) {
        const countInput = document.getElementById('input-particle-count');
        const fragmentCount = countInput ? Math.max(15, Math.min(200, parseInt(countInput.value, 10) || 60)) : 60;
        this.explodeObject(selectedIdx, fragmentCount, energyScale);
        if (window.app) window.app._selectObject(-1);
        this.inputPanel.hide();
        return;
      }

      // Fallback if no object selected: explode synthetic LEO target at 7000km
      if (!this.simActive) this.simActive = true;
      const pos = { x: 7000, y: 0, z: 0 };
      const vel = { vx: 0, vy: 7.55, vz: 0 };
      const created = this.simulator.triggerExplosion(pos, vel, 500, 60, energyScale);
      this.vfx.triggerExplosion(pos, Math.min(2.5, Math.sqrt(energyScale)));
      this.sound.playExplosion(Math.min(2.0, Math.sqrt(energyScale)));
      this.inputPanel.hide();
      this.uiManager.setStatus(`💥 Synthetic LEO explosion triggered! (+${created} fragments)`);
    };

    // 4. Scenario Execution Callback
    this.inputPanel.onExecuteScenario = (scenarioData) => {
      const { norad, frags, mass } = scenarioData;
      if (!window.app || !window.app.dataLoader) return;

      // Ensure simulation time speed is fast enough to visually observe orbital breakup immediately
      if (window.app.timeSpeed < 60 && typeof window.app.setTimeSpeed === 'function') {
        window.app.setTimeSpeed(60);
      }

      const targetIdx = window.app.dataLoader.getIndexByNoradId(norad);

      if (targetIdx !== -1) {
        window.app._selectObject(targetIdx);
        window.app._zoomToObject(targetIdx);

        setTimeout(() => {
          this.explodeObject(targetIdx, frags, 1.5, mass);
          this.inputPanel.hide();
        }, 350);
      } else {
        // Fallback if specific object is decayed/unindexed
        if (!this.simActive) this.simActive = true;
        const pos = { x: 0, y: 7150, z: 0 };
        const vel = { vx: 7.45, vy: 0, vz: 0 };
        const createdCount = this.simulator.triggerExplosion(pos, vel, mass, frags, 1.5);
        this.vfx.triggerExplosion(pos, 1.5);
        this.sound.playExplosion(1.5);
        this.inputPanel.hide();
        this.uiManager.setStatus(`💥 SCENARIO TRIGGERED! ${createdCount} fragments generated (60x speed)!`);
      }
    };

    // 5. Reset Simulation Callback
    this.inputPanel.onResetSimulation = () => {
      this.resetSimulation();
    };

    // 6. Listen to Physics Simulator Events
    this.simulator.on('reentry', (data) => {
      this.vfx.triggerReentry(data.position, data.velocity);
      this.sound.playReentryBurn();
    });

    this.simulator.on('collision', (data) => {
      this.vfx.triggerExplosion(data.position, 1.4);
      this.sound.playExplosion(1.5);

      if (data.satelliteIndex !== undefined && this.orbitRenderer?.destroySatellite) {
        this.orbitRenderer.destroySatellite(data.satelliteIndex);
      }

      if (data.satelliteName) {
        this.uiManager.setStatus(`💥 CASCADE IMPACT #${data.totalCollisions}: [${data.satelliteName}] destroyed! (+${data.newFragments} fragments)`);
      } else {
        this.uiManager.setStatus(`💥 CASCADE COLLISION #${data.totalCollisions}: Debris fragments collided! (+${data.newFragments} fragments)`);
      }
    });
  }

  /**
   * Resets all simulation particles, cascade stats, VFX, and restores destroyed catalog satellites
   */
  resetSimulation() {
    this.simulator.reset();
    this.vfx.clear();
    if (this.orbitRenderer?.restoreAllSatellites) {
      this.orbitRenderer.restoreAllSatellites();
    }
    this.simMesh.count = 0;
    this.simMesh.instanceMatrix.needsUpdate = true;

    if (this.inputPanel?.updateLiveStats) {
      this.inputPanel.updateLiveStats(this.simulator.stats, 0);
    }
    this.uiManager.setStatus('🔄 Simulation reset — all debris cleared & catalog restored.', true);
  }

  update(realDeltaSec, simDeltaSec = realDeltaSec, simDate = null) {
    if (!this.simActive) return;

    const particles = this.simulator.getParticles();

    // 1. Prepare O(1) spatial index for catalog satellites in active particle altitude bands
    if (this.orbitRenderer && particles.length > 0) {
      this.orbitRenderer.prepareSimulationFrame(simDate || this.orbitRenderer.currentSimDate, particles);
    }

    const catalogCheckFn = (pos, radius) => this.orbitRenderer
      ? this.orbitRenderer.findNearbySatellite(pos, radius, simDate || this.orbitRenderer.currentSimDate)
      : null;

    // Physics engine runs on SIMULATION time
    this.simulator.step(simDeltaSec, catalogCheckFn);

    // Throttle overlay live stats DOM update to ~10Hz
    const nowMs = performance.now();
    if (nowMs - this._lastStatsUiMs > 100) {
      this._lastStatsUiMs = nowMs;
      if (this.inputPanel?.updateLiveStats) {
        this.inputPanel.updateLiveStats(this.simulator.stats, this.simulator.particles.length);
      }
    }

    // 2. Update VFX (runs on REAL time so animations stay crisp at high time warps)
    this.vfx.update(realDeltaSec);

    // 3. Update Simulation Particles InstancedMesh (zero per-frame allocations)
    const activeParticles = this.simulator.getParticles();
    const count = activeParticles.length;
    this.simMesh.count = count;

    if (count === 0) return;

    const dummy = this._dummy;
    const colorUser = this._colorUser;
    const colorExplode = this._colorExplode;
    const colorCascade = this._colorCascade;

    for (let i = 0; i < count; i++) {
      const p = activeParticles[i];
      dummy.position.set(p.position.x, p.position.y, p.position.z);
      dummy.scale.set(22, 22, 22);
      dummy.updateMatrix();
      this.simMesh.setMatrixAt(i, dummy.matrix);

      if (p.category === 'user_injected') {
        this.simMesh.setColorAt(i, colorUser);
      } else if (p.category === 'sim_tracked') {
        this.simMesh.setColorAt(i, colorExplode);
      } else {
        this.simMesh.setColorAt(i, colorCascade);
      }
    }
    this.simMesh.instanceMatrix.needsUpdate = true;
    if (this.simMesh.instanceColor) this.simMesh.instanceColor.needsUpdate = true;
  }

  setSimActive(active) {
    this.simActive = active;
    const simBtn = document.getElementById('btn-toggle-sim');
    if (simBtn) simBtn.classList.toggle('sim-active', active);

    if (active) {
      this.inputPanel.show();
    } else {
      this.inputPanel.hide();
      this.placer.setActive(false);
    }
  }

  toggleSimMode() {
    if (this.simActive && this.inputPanel.isVisible()) {
      this.inputPanel.hide();
      return this.simActive;
    }
    this.setSimActive(true);
    return this.simActive;
  }

  explodeObject(index, fragmentCount = 50, energyScale = 1.5, overrideMass = null) {
    if (!this.orbitRenderer) return;

    const simDate = this.orbitRenderer.currentSimDate;
    const posVector = this.orbitRenderer.getObjectPosition(index, simDate);
    if (!posVector) return;

    const velVector = this.orbitRenderer.getObjectVelocity(index, simDate);

    let vel;
    if (velVector && velVector.lengthSq() > 1) {
      vel = { vx: velVector.x, vy: velVector.y, vz: velVector.z };
    } else {
      const r = posVector.length();
      const vMag = Math.sqrt(398600.4418 / r);
      const posNorm = posVector.clone().normalize();
      const refAxis = Math.abs(posNorm.y) < 0.9
        ? new THREE.Vector3(0, 1, 0)
        : new THREE.Vector3(1, 0, 0);
      const tangent = new THREE.Vector3().crossVectors(posNorm, refAxis).normalize();
      tangent.multiplyScalar(vMag);
      vel = { vx: tangent.x, vy: tangent.y, vz: tangent.z };
    }

    const pos = { x: posVector.x, y: posVector.y, z: posVector.z };

    let targetMass = overrideMass || 500;
    let obj = null;
    if (window.app && window.app.dataLoader) {
      obj = window.app.dataLoader.getObjects()[index];
      if (!overrideMass && obj) {
        if (obj.rcsSize === 'LARGE') targetMass = 1800;
        else if (obj.rcsSize === 'MEDIUM') targetMass = 450;
        else if (obj.rcsSize === 'SMALL') targetMass = 80;
      }
    }

    if (!this.simActive) {
      this.simActive = true;
      document.getElementById('btn-toggle-sim')?.classList.add('sim-active');
    }

    // Destroy parent satellite on 3D globe so it vanishes upon explosion
    this.orbitRenderer.destroySatellite(index);

    const noradId = (obj && obj.NORAD_CAT_ID) ? obj.NORAD_CAT_ID : index;
    const rootId = `root_sat_${noradId}_${Date.now()}`;

    const createdCount = this.simulator.triggerExplosion(pos, vel, targetMass, fragmentCount, energyScale, rootId);
    this.vfx.triggerExplosion(pos, Math.min(2.5, energyScale));
    this.sound.playExplosion(Math.min(2.0, energyScale));
    this.uiManager.setStatus(`💥 TARGET DESTROYED! (${targetMass.toLocaleString()}kg) ${createdCount} fragments generated!`);
  }
}
