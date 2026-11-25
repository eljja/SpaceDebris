/**
 * SpaceDebris — Main Application Entry Point
 * Coordinates 3D Scene, Data Loader, Orbit Renderer, LOD Controller,
 * PostProcessing, Simulation Engine, GMST Earth sync, Keyboard Shortcuts, and UI.
 */

import { SceneManager } from './scene.js';
import { Earth } from './earth.js';
import { DataLoader } from './data-loader.js';
import { OrbitRenderer } from './orbits.js';
import { LODController } from './lod.js';
import { UIManager } from './ui.js';
import { PostProcessingManager } from './graphics/postprocessing.js';
import { SimulationController } from './sim-controller.js';
import { gmstFromDate } from './physics/orbital-utils.js';

class SpaceDebrisApp {
  constructor() {
    this.sceneManager = null;
    this.earth = null;
    this.dataLoader = null;
    this.orbitRenderer = null;
    this.lodController = null;
    this.ui = null;
    this.postProcessing = null;
    this.simController = null;

    this.simDate = new Date();
    this.timeSpeed = 1;
    this.lastFrameTime = performance.now();
    this.lastUiSyncTime = 0;
    this.selectedIndex = -1;
    this.isPaused = false;
    this.isTracking = false;
    this.orbitCounts = { leo: 0, meo: 0, geo: 0 };

    this.init();
  }

  async init() {
    try {
      // ── 1. UI Manager ──────────────────────────────────────────
      this.ui = new UIManager();
      this.ui.setStatus('Initializing 3D Viewport...', true);

      // ── 2. 3D Scene ────────────────────────────────────────────
      const container = document.getElementById('viewport-container');
      this.sceneManager = new SceneManager(container);

      this.earth = new Earth();
      this.earth.setGMST(gmstFromDate(this.simDate));
      this.sceneManager.getScene().add(this.earth.getMesh());

      // ── 3. PostProcessing (HDR Bloom) ──────────────────────────
      this.postProcessing = new PostProcessingManager(
        this.sceneManager.getRenderer(),
        this.sceneManager.getScene(),
        this.sceneManager.getCamera()
      );

      // ── 4. Load Orbital Data ───────────────────────────────────
      this.dataLoader = new DataLoader();

      await this.dataLoader.loadAll((loaded, total, message) => {
        const progress = total > 0 ? loaded / total : 0;
        this.ui.updateLoading(progress * 0.8, message);
      });

      this.ui.updateLoading(0.85, 'Building SGP4 propagation records...');

      // ── 5. Orbit Renderer (SGP4) ───────────────────────────────
      this.orbitRenderer = new OrbitRenderer(
        this.sceneManager.getScene(),
        this.dataLoader
      );

      this.ui.updateLoading(0.92, 'Initializing LOD controller...');

      // ── 6. LOD Controller ──────────────────────────────────────
      this.lodController = new LODController(
        this.dataLoader,
        this.orbitRenderer
      );
      this.lodController.update(this.sceneManager.getCameraDistance());

      // ── 7. Simulation Engine ───────────────────────────────────
      this.simController = new SimulationController(
        this.sceneManager,
        this.orbitRenderer,
        this.ui
      );

      // ── 8. UI & Keyboard Bindings ──────────────────────────────
      this._bindUI();
      this._bindKeyboardShortcuts();

      // ── 9. Launch Render Loop ──────────────────────────────────
      this.ui.updateLoading(1.0, 'All systems go!');
      setTimeout(() => {
        this.ui.hideLoading();
        this.ui.setStatus('Tracking Live Orbits', true);
      }, 350);

      this._startRenderLoop();

    } catch (err) {
      console.error('[SpaceDebris Init Error]', err);
      if (this.ui) {
        this.ui.updateLoading(0, `Error: ${err.message}`);
      }
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  Public Helpers (Time / Camera)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  setTimeSpeed(speed) {
    this.timeSpeed = speed;
    if (this.ui?.setSpeedUI) {
      this.ui.setSpeedUI(speed);
    }
  }

  resetTimeToNow() {
    this.simDate = new Date();
    this.setTimeSpeed(1);
    if (this.isPaused) {
      this.isPaused = false;
      this.ui.setPlayPauseState(false);
    }
    this.earth.setGMST(gmstFromDate(this.simDate));
    this.ui.updateTime(this.simDate);
    this.ui.setStatus('⏱ Synced to real-time UTC (1x)', true);
  }

  resetCamera() {
    if (this.isTracking) {
      this.isTracking = false;
      this.ui.setTrackingState(false);
    }
    const cam = this.sceneManager.getCamera();
    const controls = this.sceneManager.getControls();
    controls.minDistance = 6500;
    controls.target.set(0, 0, 0);
    cam.position.set(0, 5000, 20000);
    controls.update();
    this.ui.setStatus('🧭 Camera view reset', !this.isPaused);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  UI Bindings
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  _bindUI() {
    const metadata = this.dataLoader.getMetadata();
    this.ui.setMetadataInfo(metadata);

    // Category counts
    const objects = this.dataLoader.getObjects();
    const counts = { active: 0, dead: 0, rocket: 0, debris: 0, unknown: 0 };
    objects.forEach(obj => {
      if (obj.category in counts) counts[obj.category]++;
    });
    this.ui.setObjectCounts(counts);

    // Count orbits by type for Telemetry HUD
    this.orbitCounts = {
      leo: this.dataLoader.getObjectsByOrbitType('LEO').length,
      meo: this.dataLoader.getObjectsByOrbitType('MEO').length,
      geo: this.dataLoader.getObjectsByOrbitType('GEO').length
    };

    // Filter change
    this.ui.onFilterChange = ({ categories, orbitTypes }) => {
      this.lodController.setFilter('category', categories);
      this.lodController.setFilter('orbitType', orbitTypes);
      this.lodController.update(this.sceneManager.getCameraDistance());
      this._updateMetrics();
    };

    // Speed
    this.ui.onSpeedChange = (speed) => { this.timeSpeed = speed; };

    // Play / Pause Time
    this.ui.onPlayPauseToggle = () => {
      this.isPaused = !this.isPaused;
      this.ui.setPlayPauseState(this.isPaused);
    };

    // Live Time Reset
    document.getElementById('btn-time-now')?.addEventListener('click', () => {
      this.resetTimeToNow();
    });

    // Camera Reset
    document.getElementById('btn-reset-cam')?.addEventListener('click', () => {
      this.resetCamera();
    });

    // Reset Simulation (Header + Left Panel)
    const handleResetSim = () => {
      this.simController.resetSimulation();
      this._updateMetrics();
    };
    document.getElementById('btn-reset-sim')?.addEventListener('click', handleResetSim);
    document.getElementById('btn-reset-sim-panel')?.addEventListener('click', handleResetSim);

    // Track Target Toggle
    this.ui.onTrackTargetToggle = () => {
      if (this.selectedIndex === -1) return;
      this.isTracking = !this.isTracking;
      this.ui.setTrackingState(this.isTracking);
      const controls = this.sceneManager.getControls();
      if (!this.isTracking) {
        controls.target.set(0, 0, 0);
        controls.minDistance = 6500;
      } else {
        controls.minDistance = 200;
      }
    };

    // Search with quick zoom (O(1) index lookup)
    this.ui.onSearchQuery = (query) => this.dataLoader.search(query);
    this.ui.onSearchSelect = (obj) => {
      const idx = this.dataLoader.getIndexByNoradId(obj.NORAD_CAT_ID);
      if (idx !== -1) {
        this._selectObject(idx);
        this._zoomToObject(idx);
      }
    };

    // Sim Engine toggle
    document.getElementById('btn-toggle-sim')?.addEventListener('click', () => {
      const active = this.simController.toggleSimMode();
      this.ui.setStatus(active ? 'Simulation Engine ACTIVE' : 'Tracking Live Orbits', true);
    });

    // Drag launch activation
    document.getElementById('btn-enable-drag')?.addEventListener('click', () => {
      this.simController.placer.setActive(true);
      this.ui.setStatus('🎯 Drag vector on Earth to launch debris (Esc to cancel)', true);
    });

    // Targeted explosion
    document.getElementById('btn-explode-target')?.addEventListener('click', () => {
      if (this.selectedIndex !== -1) {
        const countInput = document.getElementById('input-particle-count');
        const count = countInput ? parseInt(countInput.value, 10) || 50 : 50;
        this.simController.explodeObject(this.selectedIndex, count);
        this._selectObject(-1);
      }
    });

    // Prev / Next Object Navigation
    document.getElementById('btn-prev-object')?.addEventListener('click', () => {
      this._navigateObject(-1);
    });
    document.getElementById('btn-next-object')?.addEventListener('click', () => {
      this._navigateObject(1);
    });

    // Sound toggle
    document.getElementById('btn-toggle-sound')?.addEventListener('click', () => {
      const muted = this.simController.sound.toggleMute();
      const icon = document.getElementById('icon-sound');
      if (icon) {
        icon.setAttribute('data-lucide', muted ? 'volume-x' : 'volume-2');
        if (window.lucide) window.lucide.createIcons();
      }
    });

    // Raycaster click-selection
    const canvas = this.sceneManager.getRenderer().domElement;
    let pointerDown = null;
    canvas.addEventListener('pointerdown', (e) => {
      pointerDown = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener('pointerup', (e) => {
      if (!pointerDown) return;
      const dx = Math.abs(e.clientX - pointerDown.x);
      const dy = Math.abs(e.clientY - pointerDown.y);
      if (dx > 5 || dy > 5) return;

      if (this.simController?.placer?.active) return;

      const rect = canvas.getBoundingClientRect();
      const ndc = {
        x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
        y: -((e.clientY - rect.top) / rect.height) * 2 + 1
      };

      const hit = this.orbitRenderer.getObjectAtScreenPosition(
        ndc,
        this.sceneManager.getCamera(),
        rect.width,
        rect.height
      );
      if (hit !== null) {
        this._selectObject(hit);
      }
    });
  }

  _bindKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.code === 'Space') {
        e.preventDefault();
        this.isPaused = !this.isPaused;
        this.ui.setPlayPauseState(this.isPaused);
      } else if (e.key === 'Escape') {
        if (this.simController?.placer?.active) {
          this.simController.placer.cancel();
          if (this.simController.placer.onCancel) this.simController.placer.onCancel();
        } else if (this.simController?.inputPanel?.isVisible()) {
          this.simController.inputPanel.hide();
        } else if (this.selectedIndex !== -1) {
          this._selectObject(-1);
        }
      } else if (e.key === 'r' || e.key === 'R') {
        this.resetCamera();
      } else if (e.key === 's' || e.key === 'S') {
        this.simController?.toggleSimMode();
      } else if (e.key === 'ArrowLeft' && this.selectedIndex !== -1) {
        this._navigateObject(-1);
      } else if (e.key === 'ArrowRight' && this.selectedIndex !== -1) {
        this._navigateObject(1);
      }
    });
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  Selection & Navigation
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  _selectObject(index) {
    this.selectedIndex = index;
    const objects = this.dataLoader.getObjects();
    const obj = objects[index];

    const visibleIndices = this.lodController.getVisibleIndices();
    const currentPos = visibleIndices ? visibleIndices.indexOf(index) + 1 : 0;
    const totalCount = visibleIndices ? visibleIndices.length : 0;

    if (obj) {
      this.orbitRenderer.showOrbitPath(index, this.simDate);
      const pos = this.orbitRenderer.getObjectPosition(index, this.simDate);
      const vel = this.orbitRenderer.getObjectVelocity(index, this.simDate);
      this.ui.showObjectDetails(obj, pos, vel, this.simDate, true);
      this.ui.setNavCounter(currentPos > 0 ? currentPos : 1, totalCount);
    } else {
      if (this.isTracking) {
        this.isTracking = false;
        this.ui.setTrackingState(false);
        this.sceneManager.getControls().target.set(0, 0, 0);
        this.sceneManager.getControls().minDistance = 6500;
      }
      this.orbitRenderer.clearOrbitPath();
      this.ui.showObjectDetails(null, null, null, this.simDate, false);
    }
  }

  _zoomToObject(index) {
    const pos = this.orbitRenderer.getObjectPosition(index, this.simDate);
    if (!pos) return;
    const cam = this.sceneManager.getCamera();
    const controls = this.sceneManager.getControls();

    const dir = pos.clone().normalize();
    const targetCamPos = pos.clone().add(dir.multiplyScalar(1500));

    cam.position.copy(targetCamPos);
    controls.target.set(0, 0, 0);
    controls.update();
  }

  _navigateObject(step) {
    const visibleIndices = this.lodController.getVisibleIndices();
    if (!visibleIndices || visibleIndices.length === 0) return;

    let currentPosInList = visibleIndices.indexOf(this.selectedIndex);
    if (currentPosInList === -1) {
      currentPosInList = step > 0 ? 0 : visibleIndices.length - 1;
    } else {
      currentPosInList = (currentPosInList + step + visibleIndices.length) % visibleIndices.length;
    }

    const nextIndex = visibleIndices[currentPosInList];
    this._selectObject(nextIndex);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  Render Loop
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  _startRenderLoop() {
    const clock = this.sceneManager.clock;
    const controls = this.sceneManager.controls;
    const starField = this.sceneManager._starField;

    const loop = () => {
      requestAnimationFrame(loop);

      const delta = clock.getDelta();
      const elapsed = clock.getElapsedTime();

      if (starField?.material?.uniforms?.uTime) {
        starField.material.uniforms.uTime.value = elapsed;
      }

      this._update(delta);

      controls.update();
      this.postProcessing.render();
    };

    loop();
  }

  _update(delta) {
    const now = performance.now();
    const frameDelta = this.isPaused ? 0 : Math.min((now - this.lastFrameTime) / 1000, 0.1);
    this.lastFrameTime = now;

    // 1. Advance simulation time & sync Earth rotation directly to exact GMST
    if (!this.isPaused) {
      const simDeltaMs = frameDelta * 1000 * this.timeSpeed;
      this.simDate = new Date(this.simDate.getTime() + simDeltaMs);
      this.earth.setGMST(gmstFromDate(this.simDate));
    }

    // 2. Propagate orbits via SGP4 at exact simDate and update 3D target reticle
    this.orbitRenderer.update(this.simDate, this.sceneManager.getCamera());

    // 3. Step physics simulation (if active)
    if (this.simController && !this.isPaused) {
      const simDeltaSec = frameDelta * this.timeSpeed;
      this.simController.update(frameDelta, simDeltaSec, this.simDate);
    }

    // 4. Camera Tracking Mode (uses simDate!)
    if (this.isTracking && this.selectedIndex !== -1) {
      const pos = this.orbitRenderer.getObjectPosition(this.selectedIndex, this.simDate);
      if (pos) {
        const controls = this.sceneManager.getControls();
        const cam = this.sceneManager.getCamera();
        const deltaTarget = pos.clone().sub(controls.target);
        controls.target.copy(pos);
        cam.position.add(deltaTarget);
      }
    }

    // 5. LOD update
    const dist = this.sceneManager.getCameraDistance();
    this.lodController.update(dist);

    // 6. Throttle DOM updates (Time, Metrics, Telemetry, Selected Object Live Readout) to 10Hz
    if (now - this.lastUiSyncTime >= 100) {
      this.lastUiSyncTime = now;
      this.ui.updateTime(this.simDate);
      this._updateMetrics();

      if (this.selectedIndex !== -1) {
        const obj = this.dataLoader.getObjects()[this.selectedIndex];
        const pos = this.orbitRenderer.getObjectPosition(this.selectedIndex, this.simDate);
        const vel = this.orbitRenderer.getObjectVelocity(this.selectedIndex, this.simDate);
        if (obj && pos) {
          this.ui.showObjectDetails(obj, pos, vel, this.simDate, false);
        }
      }
    }
  }

  _updateMetrics() {
    const total = this.dataLoader.getObjects().length;
    const visible = this.lodController.getVisibleCount();
    const lodLevel = this.lodController.getCurrentLevel();
    const stats = this.simController?.simulator?.stats;
    const cascades = stats?.collisions || 0;
    const simFrags = this.simController?.simulator?.particles?.length || 0;
    const destroyed = stats?.destroyedSatellites || 0;

    this.ui.setMetrics(total, visible, lodLevel, cascades);
    this.ui.setTelemetryData(
      this.orbitCounts.leo,
      this.orbitCounts.meo,
      this.orbitCounts.geo,
      cascades,
      simFrags,
      destroyed
    );
  }
}

// Launch
window.addEventListener('DOMContentLoaded', () => {
  window.app = new SpaceDebrisApp();
});
