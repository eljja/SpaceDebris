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

    this.initSimMesh();
    this.bindEvents();
  }

  initSimMesh() {
    // Dedicated InstancedMesh for physics simulation debris particles (Max 2,500)
    const geo = new THREE.SphereGeometry(1, 6, 6);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff }); // White base for proper instance coloring
    this.simMesh = new THREE.InstancedMesh(geo, mat, 2500);
    
    // Pre-initialize instance colors so the shader compiles with instancing support
    const defaultColor = new THREE.Color(0xff1744);
    for (let i = 0; i < 2500; i++) {
      this.simMesh.setColorAt(i, defaultColor);
    }
    
    this.simMesh.count = 0;
    this.sceneManager.getScene().add(this.simMesh);
  }

  bindEvents() {
    // 1. Placer Drag Launch Callback
    this.placer.onLaunch = (particleData) => {
      const countInput = document.getElementById('input-particle-count');
      const count = countInput ? parseInt(countInput.value, 10) || 1 : 1;
      
      const sharedRootId = `root_user_${Date.now()}`; // Prevent injected siblings from colliding
      
      for (let i = 0; i < count; i++) {
        // Slight random variation in velocity for multiple particles
        const vvx = particleData.velocity.vx + (Math.random() - 0.5) * 0.5;
        const vvy = particleData.velocity.vy + (Math.random() - 0.5) * 0.5;
        const vvz = particleData.velocity.vz + (Math.random() - 0.5) * 0.5;
        
        this.simulator.addParticle({
          position: { ...particleData.position },
          velocity: { vx: vvx, vy: vvy, vz: vvz },
          mass: particleData.mass || 10,
          category: 'user_injected' // Tag as user-added particle
        }, null, 0, sharedRootId);
      }
      
      this.sound.playDebrisLaunch();
      this.uiManager.setStatus(`🚀 Launched ${count} user-injected debris particles (Red)!`);
    };

    // 2. Numerical Launch Callback
    this.inputPanel.onLaunchNumerical = (particleData) => {
      this.simulator.addParticle({
        ...particleData,
        category: 'user_injected'
      });
      this.sound.playDebrisLaunch();
      this.uiManager.setStatus(`🚀 Launched numerical particle (Red)`);
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

    // 4. Scenario Execution Callback
    this.inputPanel.onExecuteScenario = (scenarioData) => {
      const { norad, frags, mass } = scenarioData;
      if (!window.app || !window.app.dataLoader) return;

      const objects = window.app.dataLoader.getObjects();
      const targetIdx = objects.findIndex(o => String(o.NORAD_CAT_ID) === String(norad));

      if (targetIdx !== -1) {
        // Select & Zoom to target
        window.app._selectObject(targetIdx);
        window.app._zoomToObject(targetIdx);

        // Explode target with realistic fragment count
        setTimeout(() => {
          this.explodeObject(targetIdx, frags);
          this.inputPanel.hide();
        }, 400);
      } else {
        // Fallback if specific object is decayed/unindexed
        if (!this.simActive) this.setSimActive(true);
        const pos = { x: 0, y: 7150, z: 0 };
        const vel = { vx: 0, vy: 7.5, vz: 0 };
        const createdCount = this.simulator.triggerExplosion(pos, vel, mass, frags, 1.5);
        this.vfx.triggerExplosion(pos, 1.5);
        this.sound.playExplosion(1.5);
        this.inputPanel.hide();
        this.uiManager.setStatus(`💥 SCENARIO TRIGGERED! ${createdCount} fragments generated!`);
      }
    };

    // 5. Listen to Physics Simulator Events
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

  update(realDeltaSec, simDeltaSec = realDeltaSec) {
    if (!this.simActive) return;

    // 1. Step physics loop with real-time catalog satellite collision check
    const catalogCheckFn = (pos, radius) => this.orbitRenderer ? this.orbitRenderer.findNearbySatellite(pos, radius) : null;
    
    // Physics engine runs on SIMULATION time
    const result = this.simulator.step(simDeltaSec, catalogCheckFn);

    // Update simulation overlay modal live counters
    if (this.inputPanel?.updateLiveStats) {
      this.inputPanel.updateLiveStats(this.simulator.stats, this.simulator.particles.length);
    }

    // 2. Update VFX (runs on REAL time so animations don't instantly finish if time is accelerated)
    this.vfx.update(realDeltaSec);

    // 3. Update Simulation Particles InstancedMesh
    const particles = this.simulator.getParticles();
    const count = particles.length;
    this.simMesh.count = count;

    const dummy = new THREE.Object3D();
    const colorUser = new THREE.Color(0xff1744);    // Vibrant Crimson Red (User-Injected Debris)
    const colorExplode = new THREE.Color(0xff3d00); // Bright Orange-Red (Explosion Debris)
    const colorCascade = new THREE.Color(0xff0055); // Neon Red-Pink (Cascade Debris)

    for (let i = 0; i < count; i++) {
      const p = particles[i];
      dummy.position.set(p.position.x, p.position.y, p.position.z);
      // High-visibility instance scale (20~30km equivalent) matching catalog satellites
      const sizeScale = 22;
      dummy.scale.set(sizeScale, sizeScale, sizeScale);
      dummy.updateMatrix();
      this.simMesh.setMatrixAt(i, dummy.matrix);

      // Color instance per particle origin category
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

  explodeObject(index, fragmentCount = 50) {
    if (!this.orbitRenderer) return;
    
    // Get position of the satellite from SGP4
    const posVector = this.orbitRenderer.getObjectPosition(index);
    if (!posVector) return;

    // Compute REAL orbital velocity via SGP4 numerical differentiation
    // This preserves the actual orbital inclination and angular momentum
    const velVector = this.orbitRenderer.getObjectVelocity(index);
    
    let vel;
    if (velVector && velVector.lengthSq() > 1) {
      vel = { vx: velVector.x, vy: velVector.y, vz: velVector.z };
    } else {
      // Fallback: compute circular orbit velocity preserving position direction
      const r = posVector.length();
      const vMag = Math.sqrt(398600.4418 / r); // km/s
      // Use position cross angular momentum direction for tangent
      const posNorm = posVector.clone().normalize();
      // Use a perpendicular axis that is NOT aligned with position
      const refAxis = Math.abs(posNorm.y) < 0.9
        ? new THREE.Vector3(0, 1, 0)
        : new THREE.Vector3(1, 0, 0);
      const tangent = new THREE.Vector3().crossVectors(posNorm, refAxis).normalize();
      tangent.multiplyScalar(vMag);
      vel = { vx: tangent.x, vy: tangent.y, vz: tangent.z };
    }

    const pos = { x: posVector.x, y: posVector.y, z: posVector.z };

    // Get object metadata if available to estimate parent mass and NORAD ID
    let targetMass = 500;
    let obj = null;
    if (window.app && window.app.dataLoader) {
      obj = window.app.dataLoader.getObjects()[index];
      if (obj) {
        if (obj.rcsSize === 'LARGE') targetMass = 1800;
        else if (obj.rcsSize === 'MEDIUM') targetMass = 450;
        else if (obj.rcsSize === 'SMALL') targetMass = 80;
      }
    }

    // Enable simulation mode cleanly
    if (!this.simActive) {
      this.setSimActive(true);
    }

    // Destroy parent satellite on 3D globe so it vanishes upon explosion
    this.orbitRenderer.destroySatellite(index);

    const noradId = (obj && obj.NORAD_CAT_ID) ? obj.NORAD_CAT_ID : index;
    const rootId = `root_sat_${noradId}_${Date.now()}`;

    // Trigger fragmentation with estimated mass and clean rootId
    const createdCount = this.simulator.triggerExplosion(pos, vel, targetMass, fragmentCount, 1.5, rootId);
    this.vfx.triggerExplosion(pos, 1.5);
    this.sound.playExplosion(1.5);
    this.uiManager.setStatus(`💥 TARGET DESTROYED! (${targetMass}kg) ${createdCount} fragments generated!`);
  }
}
