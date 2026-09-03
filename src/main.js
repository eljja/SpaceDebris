/**
 * SpaceDebris — Main Application Entry Point
 * Coordinates 3D Scene, Data Loader, Orbit Renderer, LOD Controller,
 * PostProcessing, Simulation Engine, and UI.
 */

import { SceneManager } from './scene.js';
import { Earth } from './earth.js';
import { DataLoader } from './data-loader.js';
import { OrbitRenderer } from './orbits.js';
import { LODController } from './lod.js';
import { UIManager } from './ui.js';
import { PostProcessingManager } from './graphics/postprocessing.js';
import { SimulationController } from './sim-controller.js';

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
        this.ui.updateLoading(progress, message);
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

      // ── 8. UI Bindings ─────────────────────────────────────────
      this._bindUI();

      // ── 9. Launch Render Loop ──────────────────────────────────
      this.ui.updateLoading(1.0, 'All systems go!');
      setTimeout(() => {
        this.ui.hideLoading();
        this.ui.setStatus('Tracking Live Orbits', true);
      }, 400);

      this._startRenderLoop();

    } catch (err) {
      console.error('[SpaceDebris Init Error]', err);
      if (this.ui) {
        this.ui.updateLoading(0, `Error: ${err.message}`);
      }
    }
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

    // Search with quick zoom
    this.ui.onSearchQuery = (query) => this.dataLoader.search(query);
    this.ui.onSearchSelect = (obj) => {
      const idx = objects.indexOf(obj);
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

    // Drag launch activation (inside sim panel)
    document.getElementById('btn-enable-drag')?.addEventListener('click', () => {
      this.simController.placer.setActive(true);
      this.ui.setStatus('🎯 Drag vector on Earth to launch debris', true);
    });

    // Targeted explosion
    document.getElementById('btn-explode-target')?.addEventListener('click', () => {
      if (this.selectedIndex !== -1) {
        const countInput = document.getElementById('input-particle-count');
        const count = countInput ? parseInt(countInput.value, 10) || 50 : 50;
        this.simController.explodeObject(this.selectedIndex, count);
        // Clear selection since object is "destroyed"
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
      if (dx > 5 || dy > 5) return; // was a drag

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
      this.orbitRenderer.showOrbitPath(index);
      const pos = this.orbitRenderer.getObjectPosition(index);
      this.ui.showObjectDetails(obj, pos, null);
      this.ui.setNavCounter(currentPos > 0 ? currentPos : 1, totalCount);

      // Automatically open the details panel when an object is selected
      if (this.ui.elements.panelRight) {
        this.ui.elements.panelRight.classList.remove('hidden');
      }
    } else {
      if (this.isTracking) {
        this.isTracking = false;
        this.ui.setTrackingState(false);
        this.sceneManager.getControls().target.set(0, 0, 0);
        this.sceneManager.getControls().minDistance = 6500;
      }
      this.orbitRenderer.clearOrbitPath();
      this.ui.showObjectDetails(null, null, null);
    }
  }

  _zoomToObject(index) {
    const pos = this.orbitRenderer.getObjectPosition(index);
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

      // Star twinkle
      if (starField?.material?.uniforms?.uTime) {
        starField.material.uniforms.uTime.value = elapsed;
      }

      // App update (orbits, physics, UI)
      this._update(delta);

      controls.update();

      // Render with HDR Bloom post-processing
      this.postProcessing.render();
    };

    loop();
  }

  _update(delta) {
    const now = performance.now();
    const frameDelta = this.isPaused ? 0 : Math.min((now - this.lastFrameTime) / 1000, 0.1);
    this.lastFrameTime = now;

    // 1. Advance simulation time
    if (!this.isPaused) {
      const simDeltaMs = frameDelta * 1000 * this.timeSpeed;
      const simDeltaSec = simDeltaMs / 1000;
      this.simDate = new Date(this.simDate.getTime() + simDeltaMs);
      this.ui.updateTime(this.simDate);

      // 2. Rotate Earth synchronized with simulation speed (keeps GEO satellites stationary)
      this.earth.update(simDeltaSec);
    }

    // 3. Propagate orbits via SGP4 and update 3D target reticle
    this.orbitRenderer.update(this.simDate, this.sceneManager.getCamera());

    // 4. Step physics simulation (if active)
    if (this.simController && !this.isPaused) {
      const simDeltaSec = (frameDelta * 1000 * this.timeSpeed) / 1000;
      this.simController.update(frameDelta, simDeltaSec);
    }

    // 5. Camera Tracking Mode
    if (this.isTracking && this.selectedIndex !== -1) {
      const pos = this.orbitRenderer.getObjectPosition(this.selectedIndex);
      if (pos) {
        const controls = this.sceneManager.getControls();
        const cam = this.sceneManager.getCamera();
        const deltaTarget = pos.clone().sub(controls.target);
        controls.target.copy(pos);
        cam.position.add(deltaTarget);
      }
    }

    // 6. LOD update
    const dist = this.sceneManager.getCameraDistance();
    this.lodController.update(dist);

    // 7. Metrics & Telemetry
    this._updateMetrics();

    // 8. Update selected object's live position
    if (this.selectedIndex !== -1) {
      const obj = this.dataLoader.getObjects()[this.selectedIndex];
      const pos = this.orbitRenderer.getObjectPosition(this.selectedIndex);
      if (obj && pos) {
        this.ui.showObjectDetails(obj, pos, null);
      }
    }
  }

  _updateMetrics() {
    const total = this.dataLoader.getObjects().length;
    const visible = this.lodController.getVisibleCount();
    const lodLevel = this.lodController.getCurrentLevel();
    const cascades = this.simController?.simulator?.stats?.collisions || 0;

    this.ui.setMetrics(total, visible, lodLevel, cascades);
    this.ui.setTelemetryData(
      this.orbitCounts.leo,
      this.orbitCounts.meo,
      this.orbitCounts.geo,
      cascades
    );
  }
}

// Launch
window.addEventListener('DOMContentLoaded', () => {
  window.app = new SpaceDebrisApp();
});
