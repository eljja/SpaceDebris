/**
 * SpaceDebris — UI Manager
 * Handles UI interactions, panel toggles, safe ranked search, filters,
 * WGS84 geodetic object details, and throttled/diff-checked telemetry HUD updates.
 */

import { computeApogeePerigee, gmstFromDate, threePosToGeodetic } from './physics/orbital-utils.js';

export class UIManager {
  constructor() {
    this.elements = {
      // Header
      metricTracked: document.getElementById('metric-tracked'),
      metricVisible: document.getElementById('metric-visible'),
      metricLod: document.getElementById('metric-lod'),
      metricCascades: document.getElementById('metric-cascades'),
      statusText: document.getElementById('status-text'),
      btnToggleLeft: document.getElementById('btn-toggle-left'),
      btnToggleRight: document.getElementById('btn-toggle-right'),

      // Left Panel
      panelLeft: document.getElementById('panel-left'),
      searchInput: document.getElementById('search-input'),
      searchResults: document.getElementById('search-results'),
      speedSlider: document.getElementById('speed-slider'),
      speedLabel: document.getElementById('speed-label'),
      infoUpdated: document.getElementById('info-updated'),
      infoTotal: document.getElementById('info-total'),

      // Counts
      countActive: document.getElementById('count-active'),
      countDead: document.getElementById('count-dead'),
      countRocket: document.getElementById('count-rocket'),
      countDebris: document.getElementById('count-debris'),

      // Right Panel
      panelRight: document.getElementById('panel-right'),
      detailPlaceholder: document.getElementById('detail-placeholder'),
      detailContent: document.getElementById('detail-content'),
      detailTag: document.getElementById('detail-tag'),
      detailName: document.getElementById('detail-name'),
      detailNorad: document.getElementById('detail-norad'),
      detailCospar: document.getElementById('detail-cospar'),
      detailOwner: document.getElementById('detail-owner'),
      detailLaunch: document.getElementById('detail-launch'),
      detailRcs: document.getElementById('detail-rcs'),
      detailStatus: document.getElementById('detail-status'),
      detailInc: document.getElementById('detail-inc'),
      detailEcc: document.getElementById('detail-ecc'),
      detailPeriod: document.getElementById('detail-period'),
      detailApogee: document.getElementById('detail-apogee'),
      detailPerigee: document.getElementById('detail-perigee'),
      detailMm: document.getElementById('detail-mm'),
      detailAlt: document.getElementById('detail-alt'),
      detailLat: document.getElementById('detail-lat'),
      detailLon: document.getElementById('detail-lon'),
      detailVel: document.getElementById('detail-vel'),

      // Telemetry HUD
      hudLeo: document.getElementById('hud-leo-count'),
      hudMeo: document.getElementById('hud-meo-count'),
      hudGeo: document.getElementById('hud-geo-count'),
      hudCascade: document.getElementById('hud-cascade-count'),
      hudSimFrags: document.getElementById('hud-sim-frags'),
      hudDestroyed: document.getElementById('hud-destroyed-sats'),

      // Footer
      simTime: document.getElementById('sim-time'),
      statusMsg: document.getElementById('status-msg'),
      statusUpdate: document.getElementById('status-update'),

      // Loading
      loadingScreen: document.getElementById('loading-screen'),
      loadingProgress: document.getElementById('loading-progress'),
      loadingStats: document.getElementById('loading-stats')
    };

    // Event Callbacks
    this.onFilterChange = null;
    this.onSearchSelect = null;
    this.onSearchQuery = null;
    this.onSpeedChange = null;
    this.onPlayPauseToggle = null;
    this.onTrackTargetToggle = null;

    // Time speeds: 1x, 10x, 60x, 600x, 3600x, 1day/s, 7day/s
    this.speedValues = [1, 10, 60, 600, 3600, 86400, 604800];
    this.speedLabels = ['1x Real-time', '10x', '60x (1min/s)', '600x', '3600x (1hr/s)', '86400x (1day/s)', '604800x (7day/s)'];

    // Cache last displayed values to avoid redundant DOM writes
    this._lastRendered = new Map();
    this._lastSearchResults = [];

    this.initEvents();
  }

  _setText(el, key, value) {
    if (!el) return;
    if (this._lastRendered.get(key) === value) return;
    this._lastRendered.set(key, value);
    el.textContent = value;
  }

  initEvents() {
    if (window.lucide) {
      window.lucide.createIcons();
    }

    // Auto-hide panels on mobile load for unobstructed view
    if (window.innerWidth <= 768) {
      this.elements.panelLeft?.classList.add('hidden');
      this.elements.panelRight?.classList.add('hidden');
    }

    // Toggle Left Panel
    this.elements.btnToggleLeft?.addEventListener('click', () => {
      this.elements.panelLeft?.classList.toggle('hidden');
    });
    document.getElementById('btn-close-left')?.addEventListener('click', () => {
      this.elements.panelLeft?.classList.add('hidden');
    });

    // Toggle Right Panel
    this.elements.btnToggleRight?.addEventListener('click', () => {
      this.elements.panelRight?.classList.toggle('hidden');
    });
    document.getElementById('btn-close-right')?.addEventListener('click', () => {
      this.elements.panelRight?.classList.add('hidden');
    });

    // Status Bar Collapse / Expand
    const statusBar = document.getElementById('status-bar');
    document.getElementById('btn-collapse-bottom')?.addEventListener('click', () => {
      statusBar?.classList.add('collapsed');
    });
    document.getElementById('btn-expand-bottom')?.addEventListener('click', () => {
      statusBar?.classList.remove('collapsed');
    });

    // Telemetry HUD toggle
    document.getElementById('btn-toggle-hud')?.addEventListener('click', () => {
      const hud = document.getElementById('telemetry-hud');
      const icon = document.getElementById('icon-hud-chevron');
      if (hud) {
        hud.classList.toggle('minimized');
        if (icon) {
          icon.setAttribute('data-lucide', hud.classList.contains('minimized') ? 'chevron-up' : 'chevron-down');
          if (window.lucide) window.lucide.createIcons();
        }
      }
    });

    // Play / Pause Button
    document.getElementById('btn-play-pause')?.addEventListener('click', () => {
      if (this.onPlayPauseToggle) this.onPlayPauseToggle();
    });

    // Track Target Button
    document.getElementById('btn-track-target')?.addEventListener('click', () => {
      if (this.onTrackTargetToggle) this.onTrackTargetToggle();
    });

    // Filter checkboxes
    document.querySelectorAll('[data-filter]').forEach(input => {
      input.addEventListener('change', () => {
        if (this.onFilterChange) {
          const categoryFilters = Array.from(document.querySelectorAll('[data-filter="category"]:checked')).map(el => el.dataset.value);
          const orbitTypeFilters = Array.from(document.querySelectorAll('[data-filter="orbitType"]:checked')).map(el => el.dataset.value);
          this.onFilterChange({ categories: categoryFilters, orbitTypes: orbitTypeFilters });
        }
      });
    });

    // Speed Slider
    this.elements.speedSlider?.addEventListener('input', (e) => {
      const idx = parseInt(e.target.value, 10);
      const speed = this.speedValues[idx] || 1;
      const label = this.speedLabels[idx] || '1x';
      if (this.elements.speedLabel) this.elements.speedLabel.textContent = label;
      if (this.onSpeedChange) this.onSpeedChange(speed);
    });

    // Search Input Autocomplete + Enter-to-select top result
    let searchTimeout = null;
    this.elements.searchInput?.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      const query = e.target.value.trim();
      if (!query) {
        this._lastSearchResults = [];
        this.elements.searchResults.innerHTML = '';
        return;
      }
      searchTimeout = setTimeout(() => {
        if (this.onSearchQuery) {
          const results = this.onSearchQuery(query);
          this._lastSearchResults = results || [];
          this.renderSearchResults(this._lastSearchResults);
        }
      }, 120);
    });

    this.elements.searchInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && this._lastSearchResults.length > 0) {
        e.preventDefault();
        const top = this._lastSearchResults[0];
        if (this.onSearchSelect) this.onSearchSelect(top);
        this.elements.searchResults.innerHTML = '';
        this.elements.searchInput.value = top.OBJECT_NAME || '';
      } else if (e.key === 'Escape') {
        this.elements.searchResults.innerHTML = '';
        this.elements.searchInput.blur();
      }
    });

    // Close search dropdown on click outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.search-box') && !e.target.closest('.search-results')) {
        if (this.elements.searchResults) this.elements.searchResults.innerHTML = '';
      }
    });
  }

  /**
   * Programmatically syncs the UI speed slider & label with a speed value
   */
  setSpeedUI(speed) {
    let bestIdx = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < this.speedValues.length; i++) {
      const diff = Math.abs(this.speedValues[i] - speed);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIdx = i;
      }
    }
    if (this.elements.speedSlider) this.elements.speedSlider.value = String(bestIdx);
    if (this.elements.speedLabel) this.elements.speedLabel.textContent = this.speedLabels[bestIdx];
  }

  updateLoading(progress, message) {
    if (this.elements.loadingProgress) {
      this.elements.loadingProgress.style.width = `${Math.min(100, progress * 100)}%`;
    }
    if (this.elements.loadingStats) {
      this.elements.loadingStats.textContent = message;
    }
  }

  hideLoading() {
    if (this.elements.loadingScreen) {
      this.elements.loadingScreen.classList.add('fade-out');
      setTimeout(() => {
        this.elements.loadingScreen.style.display = 'none';
      }, 800);
    }
  }

  setObjectCounts(counts) {
    this._setText(this.elements.countActive, 'countActive', (counts.active || 0).toLocaleString());
    this._setText(this.elements.countDead, 'countDead', (counts.dead || 0).toLocaleString());
    this._setText(this.elements.countRocket, 'countRocket', (counts.rocket || 0).toLocaleString());
    this._setText(this.elements.countDebris, 'countDebris', (counts.debris || 0).toLocaleString());
  }

  setMetrics(tracked, visible, lodLevel, cascades = 0) {
    this._setText(this.elements.metricTracked, 'metricTracked', tracked.toLocaleString());
    this._setText(this.elements.metricVisible, 'metricVisible', visible.toLocaleString());
    this._setText(this.elements.metricLod, 'metricLod', `L${lodLevel}`);
    this._setText(this.elements.metricCascades, 'metricCascades', cascades.toLocaleString());
  }

  setNavCounter(currentPos, totalCount) {
    const counter = document.getElementById('detail-nav-counter');
    this._setText(counter, 'navCounter', `${currentPos.toLocaleString()} / ${totalCount.toLocaleString()}`);
  }

  setMetadataInfo(metadata) {
    if (!metadata) return;
    if (this.elements.infoUpdated) {
      const dateStr = metadata.lastUpdated ? new Date(metadata.lastUpdated).toLocaleDateString() : 'Unknown';
      this.elements.infoUpdated.textContent = dateStr;
      if (this.elements.statusUpdate) this.elements.statusUpdate.textContent = `Data: ${dateStr}`;
    }
    if (this.elements.infoTotal && metadata.objectCounts) {
      this.elements.infoTotal.textContent = (metadata.objectCounts.satcatTotal || 0).toLocaleString();
    }
  }

  setStatus(msg, live = true) {
    this._setText(this.elements.statusMsg, 'statusMsg', msg);
    this._setText(this.elements.statusText, 'statusText', live ? 'LIVE' : 'PAUSED');
  }

  updateTime(date) {
    this._setText(this.elements.simTime, 'simTime', date.toUTCString());
  }

  renderSearchResults(results) {
    const container = this.elements.searchResults;
    if (!container) return;
    container.innerHTML = '';

    if (!results || results.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'search-result-item';
      empty.style.color = 'var(--dim)';
      empty.style.fontSize = '0.75rem';
      empty.textContent = 'No matching objects';
      container.appendChild(empty);
      return;
    }

    const tagColors = {
      active: '#00e5ff',
      dead: '#d500f9',
      rocket: '#ff9100',
      debris: '#ffffff'
    };

    const frag = document.createDocumentFragment();
    results.slice(0, 15).forEach(obj => {
      const item = document.createElement('div');
      item.className = 'search-result-item';
      const catColor = tagColors[obj.category] || '#667788';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'sr-name';
      nameSpan.textContent = obj.OBJECT_NAME || 'UNKNOWN';

      const infoDiv = document.createElement('div');
      infoDiv.className = 'sr-info';

      const tagSpan = document.createElement('span');
      tagSpan.className = 'sr-tag';
      tagSpan.style.background = `${catColor}22`;
      tagSpan.style.color = catColor;
      tagSpan.style.border = `1px solid ${catColor}44`;
      tagSpan.textContent = (obj.category || 'SAT').toUpperCase();

      const idSpan = document.createElement('span');
      idSpan.className = 'sr-id';
      idSpan.textContent = `#${obj.NORAD_CAT_ID}`;

      infoDiv.appendChild(tagSpan);
      infoDiv.appendChild(idSpan);
      item.appendChild(nameSpan);
      item.appendChild(infoDiv);

      item.addEventListener('click', () => {
        if (this.onSearchSelect) this.onSearchSelect(obj);
        container.innerHTML = '';
        this.elements.searchInput.value = obj.OBJECT_NAME || '';
      });
      frag.appendChild(item);
    });

    container.appendChild(frag);
  }

  setTelemetryData(leo, meo, geo, cascades = 0, simFrags = 0, destroyedSats = 0) {
    this._setText(this.elements.hudLeo, 'hudLeo', leo.toLocaleString());
    this._setText(this.elements.hudMeo, 'hudMeo', meo.toLocaleString());
    this._setText(this.elements.hudGeo, 'hudGeo', geo.toLocaleString());
    this._setText(this.elements.hudCascade, 'hudCascade', cascades.toLocaleString());
    this._setText(this.elements.hudSimFrags, 'hudSimFrags', simFrags.toLocaleString());
    this._setText(this.elements.hudDestroyed, 'hudDestroyed', destroyedSats.toLocaleString());
  }

  setTrackingState(isTracking) {
    const btn = document.getElementById('btn-track-target');
    if (btn) {
      if (isTracking) {
        btn.classList.add('tracking-active');
        btn.innerHTML = '<i data-lucide="crosshair"></i> 🛑 Stop Track';
      } else {
        btn.classList.remove('tracking-active');
        btn.innerHTML = '<i data-lucide="crosshair"></i> 🎯 Track Target';
      }
      if (window.lucide) window.lucide.createIcons();
    }
  }

  setPlayPauseState(isPaused) {
    const btn = document.getElementById('btn-play-pause');
    if (btn) {
      btn.innerHTML = isPaused
        ? '<i data-lucide="play" id="icon-play-pause"></i> Play'
        : '<i data-lucide="pause" id="icon-play-pause"></i> Pause';
      if (window.lucide) window.lucide.createIcons();
    }
    this.setStatus(isPaused ? 'Simulation time paused' : 'Live tracking active', !isPaused);
  }

  /**
   * Renders selected object details.
   * Only auto-opens the right panel when `autoOpen === true` (user explicitly selected an object),
   * preventing per-frame telemetry refreshes from hijacking a panel the user closed.
   */
  showObjectDetails(obj, position, velocity, simDate = new Date(), autoOpen = false) {
    if (!obj) {
      this.elements.detailPlaceholder.style.display = 'flex';
      this.elements.detailContent.style.display = 'none';
      return;
    }

    this.elements.detailPlaceholder.style.display = 'none';
    this.elements.detailContent.style.display = 'block';

    // Tag & Category
    const cat = obj.category || 'unknown';
    this._setText(this.elements.detailTag, 'detailTag', cat.toUpperCase());
    this.elements.detailTag.className = `detail-tag tag-${cat}`;

    // Basics
    this._setText(this.elements.detailName, 'detailName', obj.OBJECT_NAME || 'Unnamed Object');
    this._setText(this.elements.detailNorad, 'detailNorad', String(obj.NORAD_CAT_ID || 'N/A'));
    this._setText(this.elements.detailCospar, 'detailCospar', obj.OBJECT_ID || 'N/A');
    this._setText(this.elements.detailOwner, 'detailOwner', obj.owner || 'Unknown');
    this._setText(this.elements.detailLaunch, 'detailLaunch', obj.launchDate || 'N/A');
    this._setText(this.elements.detailRcs, 'detailRcs', obj.rcsSize || 'N/A');
    const opsLabel = obj.opsStatus === '+' ? 'Operational'
      : (obj.opsStatus === '-' ? 'Non-operational'
      : (obj.opsStatus === 'P' ? 'Partially Op' : 'Unknown'));
    this._setText(this.elements.detailStatus, 'detailStatus', opsLabel);

    // Orbit
    const inc = obj.INCLINATION !== undefined ? `${Number(obj.INCLINATION).toFixed(2)}°` : 'N/A';
    const ecc = obj.ECCENTRICITY !== undefined ? Number(obj.ECCENTRICITY).toFixed(5) : 'N/A';
    const mmNum = Number(obj.MEAN_MOTION || 0);
    const mm = mmNum > 0 ? mmNum.toFixed(4) : '0';
    const periodMin = mmNum > 0 ? (1440 / mmNum).toFixed(1) : 'N/A';

    let apoVal = obj.apo;
    let periVal = obj.peri;
    if ((!Number.isFinite(apoVal) || !Number.isFinite(periVal)) && mmNum > 0) {
      const derived = computeApogeePerigee(mmNum, obj.ECCENTRICITY);
      apoVal = derived.apo;
      periVal = derived.peri;
    }

    this._setText(this.elements.detailInc, 'detailInc', inc);
    this._setText(this.elements.detailEcc, 'detailEcc', ecc);
    this._setText(this.elements.detailPeriod, 'detailPeriod', `${periodMin} min`);
    this._setText(this.elements.detailApogee, 'detailApogee', Number.isFinite(apoVal) ? `${Math.round(apoVal).toLocaleString()} km` : 'N/A');
    this._setText(this.elements.detailPerigee, 'detailPerigee', Number.isFinite(periVal) ? `${Math.round(periVal).toLocaleString()} km` : 'N/A');
    this._setText(this.elements.detailMm, 'detailMm', `${mm} rev/day`);

    // Real-time WGS84 Geodetic Position (accounting for GMST Earth rotation!)
    if (position) {
      const gmst = gmstFromDate(simDate);
      const geo = threePosToGeodetic(position, gmst);
      this._setText(this.elements.detailAlt, 'detailAlt', `${Math.round(geo.alt).toLocaleString()} km`);
      this._setText(this.elements.detailLat, 'detailLat', `${geo.lat.toFixed(2)}°`);
      this._setText(this.elements.detailLon, 'detailLon', `${geo.lon.toFixed(2)}°`);
    } else {
      this._setText(this.elements.detailAlt, 'detailAlt', 'N/A');
      this._setText(this.elements.detailLat, 'detailLat', 'N/A');
      this._setText(this.elements.detailLon, 'detailLon', 'N/A');
    }

    // Real-time Orbital Velocity (supports both {x,y,z} Vector3 and {vx,vy,vz})
    if (velocity) {
      const vx = velocity.vx ?? velocity.x ?? 0;
      const vy = velocity.vy ?? velocity.y ?? 0;
      const vz = velocity.vz ?? velocity.z ?? 0;
      const v = Math.sqrt(vx * vx + vy * vy + vz * vz);
      this._setText(this.elements.detailVel, 'detailVel', Number.isFinite(v) ? `${v.toFixed(2)} km/s` : 'N/A');
    } else {
      this._setText(this.elements.detailVel, 'detailVel', 'N/A');
    }

    if (autoOpen && this.elements.panelRight?.classList.contains('hidden')) {
      this.elements.panelRight.classList.remove('hidden');
    }
  }
}
