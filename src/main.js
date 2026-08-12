/**
 * SpaceDebris — Main Application Entry Point
 * Coordinates 3D Scene, Data Loader, Orbit Renderer, LOD Controller, and UI.
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
    this.timeSpeed = 1; // 1x real-time
    this.lastFrameTime = performance.now();
    this.selectedIndex = -1;

    this.init();
  }

  async init() {
    try {
      // 1. Initialize UI
      this.ui = new UIManager();
      this.ui.setStatus('Initializing 3D Viewport...', true);

      // 2. Initialize 3D Scene
      const container = document.getElementById('viewport-container');
      this.sceneManager = new SceneManager(container);
      this.earth = new Earth();
      this.sceneManager.getScene().add(this.earth.getMesh());

      // Post Processing HDR Bloom
      this.postProcessing = new PostProcessingManager(
        this.sceneManager.getRenderer(),
        this.sceneManager.getScene(),
        this.sceneManager.getCamera()
      );

      // 3. Initialize Data Loader
      this.dataLoader = new DataLoader();
      
      // Load data with progress reporting
      await this.dataLoader.loadAll((loaded, total, message) => {
        const progress = total > 0 ? loaded / total : 0;
        this.ui.updateLoading(progress, message);
      });

      this.ui.updateLoading(0.9, 'Building 3D Orbital Instances...');

      // 4. Initialize Orbit Renderer
      this.orbitRenderer = new OrbitRenderer(
        this.sceneManager.getScene(),
        this.dataLoader
      );

      // 5. Initialize LOD Controller
      this.lodController = new LODController(
        this.dataLoader,
        this.orbitRenderer
      );

      // Initial LOD update
      const initialDist = this.sceneManager.getCameraDistance();
      this.lodController.update(initialDist);

      // 6. Initialize Simulation Engine & VFX
      this.simController = new SimulationController(
        this.sceneManager,
        this.orbitRenderer,
        this.ui
      );

      // Header Button Bindings
      document.getElementById('btn-toggle-sim')?.addEventListener('click', () => {
        const active = this.simController.toggleSimMode();
        this.ui.setStatus(active ? 'Simulation Engine ACTIVE' : 'Tracking Live Orbits', true);
      });

      document.getElementById('btn-enable-drag')?.addEventListener('click', () => {
        this.simController.placer.setActive(true);
        this.ui.setStatus('3D Drag Placer Active — Click on Globe to place', true);
      });

      document.getElementById('btn-toggle-sound')?.addEventListener('click', () => {
        const muted = this.simController.sound.toggleMute();
        const icon = document.getElementById('icon-sound');
        if (icon) {
          icon.setAttribute('data-lucide', muted ? 'volume-x' : 'volume-2');
          if (window.lucide) window.lucide.createIcons();
        }
      });

      // 7. Setup UI Info & Callbacks
      const metadata = this.dataLoader.getMetadata();
      this.ui.setMetadataInfo(metadata);

      // Category counts for filter UI
      const objects = this.dataLoader.getObjects();
      const counts = { active: 0, dead: 0, rocket: 0, debris: 0 };
      objects.forEach(obj => {
        if (counts[obj.category] !== undefined) counts[obj.category]++;
      });
      this.ui.setObjectCounts(counts);

      // Bind Filter Callbacks
      this.ui.onFilterChange = (filters) => {
        this.lodController.setFilter('category', filters.categories);
        this.lodController.setFilter('orbitType', filters.orbitTypes);
        this.lodController.update(this.sceneManager.getCameraDistance());
        this.updateMetrics();
      };

      // Bind Speed Callback
      this.ui.onSpeedChange = (speed) => {
        this.timeSpeed = speed;
      };

      // Bind Search Query Callback
      this.ui.onSearchQuery = (query) => {
        return this.dataLoader.search(query);
      };

      // Bind Search Selection
      this.ui.onSearchSelect = (obj) => {
        const idx = objects.indexOf(obj);
        if (idx !== -1) {
          this.selectObject(idx);
        }
      };

      // 8. Raycaster Click Selection
      const domElement = this.sceneManager.getRenderer().domElement;
      domElement.addEventListener('pointerdown', (e) => {
        this.pointerDownPos = { x: e.clientX, y: e.clientY };
      });

      domElement.addEventListener('pointerup', (e) => {
        if (!this.pointerDownPos) return;
        const dx = Math.abs(e.clientX - this.pointerDownPos.x);
        const dy = Math.abs(e.clientY - this.pointerDownPos.y);
        if (dx > 5 || dy > 5) return; // Ignore drag/pan

        if (this.simController.placer.active) return; // Ignore selection during drag launch

        const rect = domElement.getBoundingClientRect();
        const screenPos = {
          x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
          y: -((e.clientY - rect.top) / rect.height) * 2 + 1
        };

        const clickedIdx = this.orbitRenderer.getObjectAtScreenPosition(
          screenPos,
          this.sceneManager.getCamera()
        );

        if (clickedIdx !== null) {
          this.selectObject(clickedIdx);
        }
      });

      // 9. Add Main Render Loop Callback
      this.sceneManager.addToRenderLoop((delta) => {
        this.update(delta);
      });

      // Hide loading screen
      this.ui.updateLoading(1.0, 'Ready!');
      this.ui.hideLoading();
      this.ui.setStatus('Tracking Live Orbits', true);

      // Override scene animate with PostProcessing render
      this.sceneManager.animate = () => {
        requestAnimationFrame(() => this.sceneManager.animate());
        const delta = this.sceneManager.clock.getDelta();

        for (const cb of this.sceneManager.renderCallbacks) {
          cb(delta);
        }

        this.sceneManager.controls.update();
        this.postProcessing.render();
      };

      // Start Scene Loop
      this.sceneManager.animate();

    } catch (err) {
      console.error('[App Init Error]', err);
      this.ui.updateLoading(0, `Error: ${err.message}`);
    }
  }

  selectObject(index) {
    this.selectedIndex = index;
    const objects = this.dataLoader.getObjects();
    const obj = objects[index];

    if (obj) {
      this.orbitRenderer.showOrbitPath(index);
      const pos = this.orbitRenderer.getObjectPosition(index);
      this.ui.showObjectDetails(obj, pos, null);
    } else {
      this.orbitRenderer.clearOrbitPath();
      this.ui.showObjectDetails(null, null, null);
    }
  }

  update(delta) {
    // 1. Advance simulation time
    const now = performance.now();
    const frameDeltaSec = (now - this.lastFrameTime) / 1000;
    this.lastFrameTime = now;

    const simDeltaMs = frameDeltaSec * 1000 * this.timeSpeed;
    this.simDate = new Date(this.simDate.getTime() + simDeltaMs);
    this.ui.updateTime(this.simDate);

    // 2. Rotate Earth
    this.earth.update(frameDeltaSec);

    // 3. Propagate & Render Orbits
    this.orbitRenderer.update(this.simDate);

    // 4. Step Simulation Physics Controller
    if (this.simController) {
      this.simController.update(frameDeltaSec);
    }

    // 5. Update LOD on camera distance change
    const dist = this.sceneManager.getCameraDistance();
    this.lodController.update(dist);

    // 6. Update Metrics & Selected Object Real-time Position
    this.updateMetrics();

    if (this.selectedIndex !== -1) {
      const objects = this.dataLoader.getObjects();
      const obj = objects[this.selectedIndex];
      const pos = this.orbitRenderer.getObjectPosition(this.selectedIndex);
      if (obj && pos) {
        this.ui.showObjectDetails(obj, pos, null);
      }
    }
  }

  updateMetrics() {
    const total = this.dataLoader.getObjects().length;
    const visible = this.lodController.getVisibleCount();
    const lodLevel = this.lodController.getCurrentLevel();
    this.ui.setMetrics(total, visible, lodLevel);
  }
}

// Instantiate on DOM load
window.addEventListener('DOMContentLoaded', () => {
  window.app = new SpaceDebrisApp();
});
