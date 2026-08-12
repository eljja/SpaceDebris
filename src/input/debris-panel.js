/**
 * SpaceDebris — Numerical Debris Placement & Explosion Config Panels
 * Renders modal UI controls for precise input parameters (Altitude, Velocity, Mass, Energy).
 */

export class DebrisInputPanel {
  constructor(containerId = 'app') {
    this.container = document.getElementById(containerId);
    this.modalEl = null;
    this.onLaunchNumerical = null;
    this.onExplodeTarget = null;

    this.initUI();
  }

  initUI() {
    // Create floating simulation control panel overlay
    const panel = document.createElement('div');
    panel.id = 'sim-controls-overlay';
    panel.className = 'sim-overlay glass-card hidden';

    panel.innerHTML = `
      <div class="sim-panel-header">
        <span class="sim-panel-title">SIMULATION ENGINE</span>
        <button id="btn-close-sim" class="btn-close">&times;</button>
      </div>

      <!-- Mode Tabs -->
      <div class="sim-tabs">
        <button class="sim-tab active" data-tab="drag">3D Drag Launch</button>
        <button class="sim-tab" data-tab="numerical">Numerical Launch</button>
        <button class="sim-tab" data-tab="explode">Explosion Trigger</button>
      </div>

      <!-- Tab 1: Drag Instructions -->
      <div id="tab-content-drag" class="sim-tab-content active">
        <p class="sim-help-text">Click anywhere on the 3D Globe to select launch location, then drag the vector arrow to adjust speed &amp; direction.</p>
        <button id="btn-enable-drag" class="btn btn-primary glow-cyan-btn">
          <i data-lucide="crosshair"></i> Activate 3D Drag Placer
        </button>
      </div>

      <!-- Tab 2: Numerical Form -->
      <div id="tab-content-numerical" class="sim-tab-content">
        <div class="form-grid">
          <div class="form-group">
            <label>Altitude (km)</label>
            <input type="number" id="num-alt" value="400" min="150" max="2000" />
          </div>
          <div class="form-group">
            <label>Latitude (°)</label>
            <input type="number" id="num-lat" value="0" min="-90" max="90" />
          </div>
          <div class="form-group">
            <label>Longitude (°)</label>
            <input type="number" id="num-lon" value="120" min="-180" max="180" />
          </div>
          <div class="form-group">
            <label>Speed (km/s)</label>
            <input type="number" id="num-speed" value="7.67" step="0.01" />
          </div>
          <div class="form-group">
            <label>Azimuth (°)</label>
            <input type="number" id="num-azimuth" value="90" min="0" max="360" />
          </div>
          <div class="form-group">
            <label>Mass (kg)</label>
            <input type="number" id="num-mass" value="25" min="1" max="10000" />
          </div>
        </div>
        <div class="form-actions">
          <button id="btn-auto-circ" class="btn btn-outline">Set Circular Speed</button>
          <button id="btn-submit-numerical" class="btn btn-primary">Launch Particle</button>
        </div>
      </div>

      <!-- Tab 3: Explosion Trigger -->
      <div id="tab-content-explode" class="sim-tab-content">
        <p class="sim-help-text">Select a satellite in 3D or set explosion parameters to trigger a NASA Standard Breakup event.</p>
        <div class="form-group">
          <label>Explosion Energy (Joules)</label>
          <input type="range" id="exp-energy-slider" min="6" max="11" step="0.1" value="8" class="range-slider" />
          <span id="exp-energy-label" class="range-val">1.0 × 10⁸ J (Medium)</span>
        </div>
        <div class="form-group">
          <label class="custom-checkbox">
            <input type="checkbox" id="exp-momentum-chk" checked />
            <span class="checkmark"></span>
            <span class="chk-text">Enforce Exact Momentum Conservation</span>
          </label>
        </div>
        <button id="btn-trigger-explosion" class="btn btn-danger glow-red-btn">
          💥 Trigger Explosion at Selected Object
        </button>
      </div>
    `;

    this.container.appendChild(panel);
    this.modalEl = panel;

    this.bindPanelEvents();
  }

  bindPanelEvents() {
    // Close button
    document.getElementById('btn-close-sim')?.addEventListener('click', () => {
      this.hide();
    });

    // Tab switching
    const tabs = this.modalEl.querySelectorAll('.sim-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        const targetTab = tab.dataset.tab;
        this.modalEl.querySelectorAll('.sim-tab-content').forEach(content => {
          content.classList.toggle('active', content.id === `tab-content-${targetTab}`);
        });
      });
    });

    // Auto circular speed calculation button
    document.getElementById('btn-auto-circ')?.addEventListener('click', () => {
      const alt = parseFloat(document.getElementById('num-alt').value) || 400;
      const r = 6371 + alt;
      const vCirc = Math.sqrt(398600.4418 / r);
      document.getElementById('num-speed').value = vCirc.toFixed(3);
    });

    // Numerical form submission
    document.getElementById('btn-submit-numerical')?.addEventListener('click', () => {
      const alt = parseFloat(document.getElementById('num-alt').value) || 400;
      const lat = (parseFloat(document.getElementById('num-lat').value) || 0) * (Math.PI / 180);
      const lon = (parseFloat(document.getElementById('num-lon').value) || 0) * (Math.PI / 180);
      const speed = parseFloat(document.getElementById('num-speed').value) || 7.67;
      const az = (parseFloat(document.getElementById('num-azimuth').value) || 90) * (Math.PI / 180);
      const mass = parseFloat(document.getElementById('num-mass').value) || 25;

      const r = 6371 + alt;

      // Spherical ECI position
      const px = r * Math.cos(lat) * Math.cos(lon);
      const py = r * Math.sin(lat);
      const pz = r * Math.cos(lat) * Math.sin(lon);

      // Tangent velocity direction
      const vx = -speed * Math.sin(lon) * Math.sin(az);
      const vy = speed * Math.cos(az);
      const vz = speed * Math.cos(lon) * Math.sin(az);

      if (this.onLaunchNumerical) {
        this.onLaunchNumerical({
          position: { x: px, y: py, z: pz },
          velocity: { vx, vy, vz },
          mass,
          size: 0.3,
          areaToMass: 0.02
        });
      }
    });

    // Energy slider label
    const energySlider = document.getElementById('exp-energy-slider');
    const energyLabel = document.getElementById('exp-energy-label');
    energySlider?.addEventListener('input', (e) => {
      const expVal = parseFloat(e.target.value);
      const energyJ = Math.pow(10, expVal);
      energyLabel.textContent = `${energyJ.toExponential(1)} J`;
    });

    // Explosion button
    document.getElementById('btn-trigger-explosion')?.addEventListener('click', () => {
      const expVal = parseFloat(energySlider.value);
      const energyJ = Math.pow(10, expVal);

      if (this.onExplodeTarget) {
        this.onExplodeTarget(energyJ);
      }
    });
  }

  show() {
    this.modalEl.classList.remove('hidden');
  }

  hide() {
    this.modalEl.classList.add('hidden');
  }

  toggle() {
    this.modalEl.classList.toggle('hidden');
  }
}
