/**
 * SpaceDebris — UI Manager
 * Handles UI interactions, panel toggles, search, filters, detail card, and status updates.
 */

export class UIManager {
  constructor() {
    // UI Elements
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

    this.initEvents();
  }

  initEvents() {
    // Lucide icons re-render
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

    // Search Input Autocomplete
    let searchTimeout = null;
    this.elements.searchInput?.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      const query = e.target.value.trim();
      if (!query) {
        this.elements.searchResults.innerHTML = '';
        return;
      }
      searchTimeout = setTimeout(() => {
        if (this.onSearchQuery) {
          const results = this.onSearchQuery(query);
          this.renderSearchResults(results);
        }
      }, 150);
    });

    // Close search dropdown on click outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.search-box') && !e.target.closest('.search-results')) {
        if (this.elements.searchResults) this.elements.searchResults.innerHTML = '';
      }
    });
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
    if (this.elements.countActive) this.elements.countActive.textContent = (counts.active || 0).toLocaleString();
    if (this.elements.countDead) this.elements.countDead.textContent = (counts.dead || 0).toLocaleString();
    if (this.elements.countRocket) this.elements.countRocket.textContent = (counts.rocket || 0).toLocaleString();
    if (this.elements.countDebris) this.elements.countDebris.textContent = (counts.debris || 0).toLocaleString();
  }

  setMetrics(tracked, visible, lodLevel, cascades = 0) {
    if (this.elements.metricTracked) this.elements.metricTracked.textContent = tracked.toLocaleString();
    if (this.elements.metricVisible) this.elements.metricVisible.textContent = visible.toLocaleString();
    if (this.elements.metricLod) this.elements.metricLod.textContent = `L${lodLevel}`;
    if (this.elements.metricCascades) this.elements.metricCascades.textContent = cascades.toLocaleString();
  }

  setNavCounter(currentPos, totalCount) {
    const counter = document.getElementById('detail-nav-counter');
    if (counter) {
      counter.textContent = `${currentPos.toLocaleString()} / ${totalCount.toLocaleString()}`;
    }
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
    if (this.elements.statusMsg) this.elements.statusMsg.textContent = msg;
    if (this.elements.statusText) this.elements.statusText.textContent = live ? 'LIVE' : 'PAUSED';
  }

  updateTime(date) {
    if (this.elements.simTime) {
      this.elements.simTime.textContent = date.toUTCString();
    }
  }

  renderSearchResults(results) {
    const container = this.elements.searchResults;
    if (!container) return;
    container.innerHTML = '';

    if (!results || results.length === 0) {
      container.innerHTML = '<div class="search-result-item" style="color:var(--dim); font-size:0.75rem;">No matching objects</div>';
      return;
    }

    const tagColors = {
      active: '#00e5ff',
      dead: '#d500f9',
      rocket: '#ff9100',
      debris: '#ffffff'
    };

    results.slice(0, 10).forEach(obj => {
      const item = document.createElement('div');
      item.className = 'search-result-item';
      const catColor = tagColors[obj.category] || '#667788';
      item.innerHTML = `
        <span class="sr-name">${obj.OBJECT_NAME || 'UNKNOWN'}</span>
        <div class="sr-info">
          <span class="sr-tag" style="background: ${catColor}22; color: ${catColor}; border: 1px solid ${catColor}44;">${obj.category?.toUpperCase() || 'SAT'}</span>
          <span class="sr-id">#${obj.NORAD_CAT_ID}</span>
        </div>
      `;
      item.addEventListener('click', () => {
        if (this.onSearchSelect) this.onSearchSelect(obj);
        container.innerHTML = '';
        this.elements.searchInput.value = obj.OBJECT_NAME || '';
      });
      container.appendChild(item);
    });
  }

  setTelemetryData(leo, meo, geo, cascades = 0) {
    const elLeo = document.getElementById('hud-leo-count');
    const elMeo = document.getElementById('hud-meo-count');
    const elGeo = document.getElementById('hud-geo-count');
    const elCas = document.getElementById('hud-cascade-count');
    if (elLeo) elLeo.textContent = leo.toLocaleString();
    if (elMeo) elMeo.textContent = meo.toLocaleString();
    if (elGeo) elGeo.textContent = geo.toLocaleString();
    if (elCas) elCas.textContent = cascades.toLocaleString();
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

  showObjectDetails(obj, position, velocity) {
    if (!obj) {
      this.elements.detailPlaceholder.style.display = 'flex';
      this.elements.detailContent.style.display = 'none';
      return;
    }

    this.elements.detailPlaceholder.style.display = 'none';
    this.elements.detailContent.style.display = 'block';

    // Tag & Category
    const cat = obj.category || 'unknown';
    this.elements.detailTag.textContent = cat.toUpperCase();
    this.elements.detailTag.className = `detail-tag tag-${cat}`;

    // Basics
    this.elements.detailName.textContent = obj.OBJECT_NAME || 'Unnamed Object';
    this.elements.detailNorad.textContent = obj.NORAD_CAT_ID || 'N/A';
    this.elements.detailCospar.textContent = obj.OBJECT_ID || 'N/A';
    this.elements.detailOwner.textContent = obj.owner || 'Unknown';
    this.elements.detailLaunch.textContent = obj.launchDate || 'N/A';
    this.elements.detailRcs.textContent = obj.rcsSize || 'N/A';
    this.elements.detailStatus.textContent = obj.opsStatus === '+' ? 'Operational' : (obj.opsStatus === '-' ? 'Non-operational' : 'Unknown');

    // Orbit
    const inc = obj.INCLINATION ? `${Number(obj.INCLINATION).toFixed(2)}°` : 'N/A';
    const ecc = obj.ECCENTRICITY ? Number(obj.ECCENTRICITY).toFixed(5) : 'N/A';
    const mm = obj.MEAN_MOTION ? Number(obj.MEAN_MOTION).toFixed(4) : 0;
    const periodMin = mm > 0 ? (1440 / mm).toFixed(1) : 'N/A';
    
    // Apogee / Perigee calculation if not present in SATCAT
    let apo = obj.apo ? `${obj.apo} km` : 'N/A';
    let peri = obj.peri ? `${obj.peri} km` : 'N/A';
    if (!obj.apo && mm > 0) {
      const mu = 398600.4418;
      const n = (mm * 2 * Math.PI) / 86400;
      const a = Math.cbrt(mu / (n * n));
      const e = Number(ecc) || 0;
      apo = `${Math.round(a * (1 + e) - 6371)} km`;
      peri = `${Math.round(a * (1 - e) - 6371)} km`;
    }

    this.elements.detailInc.textContent = inc;
    this.elements.detailEcc.textContent = ecc;
    this.elements.detailPeriod.textContent = `${periodMin} min`;
    this.elements.detailApogee.textContent = apo;
    this.elements.detailPerigee.textContent = peri;
    this.elements.detailMm.textContent = `${mm} rev/day`;

    // Real-time Position
    if (position) {
      const r = Math.sqrt(position.x * position.x + position.y * position.y + position.z * position.z);
      const alt = Math.round(r - 6371);
      
      // Latitude / Longitude from Three.js ECEF
      const lat = (Math.asin(position.y / r) * (180 / Math.PI)).toFixed(2);
      const lon = (Math.atan2(position.z, position.x) * (180 / Math.PI)).toFixed(2);

      this.elements.detailAlt.textContent = `${alt} km`;
      this.elements.detailLat.textContent = `${lat}°`;
      this.elements.detailLon.textContent = `${lon}°`;
    } else {
      this.elements.detailAlt.textContent = 'N/A';
      this.elements.detailLat.textContent = 'N/A';
      this.elements.detailLon.textContent = 'N/A';
    }

    if (velocity) {
      const v = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y + velocity.z * velocity.z).toFixed(2);
      this.elements.detailVel.textContent = `${v} km/s`;
    } else {
      this.elements.detailVel.textContent = 'N/A';
    }

    // Auto-open right panel if closed
    if (this.elements.panelRight.classList.contains('hidden')) {
      this.elements.panelRight.classList.remove('hidden');
    }
  }
}
