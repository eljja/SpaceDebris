/**
 * SpaceDebris — Numerical Debris Placement & Kessler Scenario Engine
 * Features 10 historical & high-density satellite cascade scenarios 
 * and 5 tactical numerical launch presets.
 */

export class DebrisInputPanel {
  constructor(containerId = 'app') {
    this.container = document.getElementById(containerId);
    this.modalEl = null;
    this.onLaunchNumerical = null;
    this.onExplodeTarget = null;
    this.onExecuteScenario = null;

    this.scenarios = [
      {
        id: 'cosmos-iridium',
        title: '2009 코스모스-이리듐 충돌 재현',
        subtitle: 'Cosmos 2251 / Iridium 33 Collision',
        norad: '22675',
        name: 'COSMOS 2251',
        alt: '780 km',
        incl: '74.0°',
        mass: 900,
        frags: 120,
        desc: '2009년 인류 역사상 최초의 위성 간 초고속 정면 충돌. 극궤도 780km 밀집대에서 폭발하여 수백 개의 연쇄 파편 고리를 형성합니다.'
      },
      {
        id: 'envisat',
        title: '엔비샛 8.2톤 메가 데브리스 재앙',
        subtitle: 'ENVISAT Mega-Debris Disaster',
        norad: '27386',
        name: 'ENVISAT',
        alt: '765 km',
        incl: '98.4°',
        mass: 8200,
        frags: 180,
        desc: '유럽우주국(ESA)의 8.2톤짜리 초대형 폐위성. 98.4° 태양동기궤도(SSO) 중심부에서 폭발 시 전 세계 지구관측 위성망에 연쇄 충돌을 유발합니다.'
      },
      {
        id: 'fengyun',
        title: '2007 펑윈-1C ASAT 미사일 요격',
        subtitle: 'Fengyun-1C ASAT Strike',
        norad: '25730',
        name: 'FENGYUN 1C',
        alt: '850 km',
        incl: '98.9°',
        mass: 950,
        frags: 140,
        desc: '2007년 중국의 위성 요격 시험 재현. LEO 최다 파편 밀집 고도대(850km)에서 광범위한 연쇄 파편 구름을 생성합니다.'
      },
      {
        id: 'starlink-cascade',
        title: '스타링크 550km 쉘 연쇄 충돌',
        subtitle: 'Starlink Mega-Constellation Shell',
        norad: '44714',
        name: 'STARLINK-1008',
        alt: '550 km',
        incl: '53.0°',
        mass: 260,
        frags: 110,
        desc: '6,000기 이상이 밀집된 550km 고도(53° 경사각) 스타링크 쉘에서 폭발 발생 시 인접 위성들로 번져나가는 도미노 연쇄 반응입니다.'
      },
      {
        id: 'cosmos-1408',
        title: '2021 코스모스-1408 요격 파편 폭풍',
        subtitle: 'Cosmos 1408 ASAT Debris Storm',
        norad: '13552',
        name: 'COSMOS 1408',
        alt: '480 km',
        incl: '82.5°',
        mass: 1750,
        frags: 130,
        desc: '2021년 러시아 ASAT 미사일 폭발 재현. 저궤도 480km에서 폭발하여 아래쪽 ISS(420km) 궤도선으로 비처럼 쏟아지는 파편 폭풍을 재현합니다.'
      },
      {
        id: 'sl16-rocket',
        title: 'SL-16 거대 로켓 9톤 상단부 폭발',
        subtitle: 'SL-16 Zenit-2 Rocket Body Blast',
        norad: '22220',
        name: 'SL-16 R/B',
        alt: '840 km',
        incl: '71.0°',
        mass: 9000,
        frags: 160,
        desc: '소련 시절 버려진 9톤 중량의 거대 2단 로켓 동체. 잔여 연료 유증기 폭발로 수백 개의 거대 고속 파편을 방출합니다.'
      },
      {
        id: 'oneweb',
        title: '원웹 극궤도 통신망 글로벌 교란',
        subtitle: 'OneWeb Polar Constellation Blast',
        norad: '44057',
        name: 'ONEWEB-0012',
        alt: '1,200 km',
        incl: '87.9°',
        mass: 150,
        frags: 90,
        desc: '87.9° 고위도 극궤도 1,200km에서 운용 중인 글로벌 광대역 위성망의 연쇄 붕괴 시나리오입니다.'
      },
      {
        id: 'iss-crossfire',
        title: 'ISS 국제우주정거장 궤도 참사',
        subtitle: 'ISS Orbital Breakup Catastrophe',
        norad: '25544',
        name: 'ISS (ZARYA)',
        alt: '420 km',
        incl: '51.6°',
        mass: 420000,
        frags: 200,
        desc: '420톤급 유인 우주정거장 420km 고도에서 발생하는 catastrophic breakup 극단적 시나리오입니다.'
      },
      {
        id: 'intelsat-geo',
        title: '인텔샛 정지궤도 하이웨이 폭발',
        subtitle: 'Intelsat GEO Highway Explosion',
        norad: '26824',
        name: 'INTELSAT 901',
        alt: '35,786 km',
        incl: '1.4°',
        mass: 4700,
        frags: 120,
        desc: '전 세계 방송/통신 위성들이 한 줄로 늘어선 정지궤도(GEO) 적도 벨트에서의 폭발로 인한 고속도로 연쇄 폐쇄를 시뮬레이션합니다.'
      },
      {
        id: 'iridium-constellation',
        title: '이리듐 극궤도 군집망 연쇄 타격',
        subtitle: 'Iridium Constellation Chain Reaction',
        norad: '24946',
        name: 'IRIDIUM 33',
        alt: '775 km',
        incl: '86.4°',
        mass: 680,
        frags: 110,
        desc: '남북극을 가로지르는 6개 궤도면 66기의 이리듐 위성망 교차점에서 발생하는 연쇄 충돌 시나리오입니다.'
      }
    ];

    this.numericalPresets = [
      {
        name: '⚡ Retrograde Starlink Killer',
        tag: '역행 정면충돌',
        alt: 550,
        lat: 0,
        lon: 120,
        speed: 7.6,
        azimuth: 270, // Westward (Retrograde opposing Starlink east direction)
        mass: 50,
        desc: '순행(동쪽)으로 도는 6,000기의 스타링크 위성들과 상대속도 15.2 km/s로 정면충돌 유발'
      },
      {
        name: '⚡ Polar Ring Cutter',
        tag: '극궤도 수직절단',
        alt: 800,
        lat: 0,
        lon: 0,
        speed: 7.45,
        azimuth: 0, // Due North (Polar crossing)
        mass: 80,
        desc: '지구를 남북으로 종단하며 지구관측 위성 밀집대(SSO)를 수직으로 관통'
      },
      {
        name: '⚡ LEO Shotgun Sweeper',
        tag: '고타원 빗자루',
        alt: 250,
        lat: 20,
        lon: 60,
        speed: 9.8, // Highly eccentric orbit crossing 250km to 15,000km
        azimuth: 45,
        mass: 120,
        desc: '근지점 250km~원지점 15,000km 고타원 궤도로 모든 LEO 궤도층을 주기적으로 휩쓸며 충돌 유도'
      },
      {
        name: '⚡ SSO Cluster Strike',
        tag: '태양동기 요격',
        alt: 850,
        lat: 10,
        lon: 140,
        speed: 7.42,
        azimuth: 190, // 98 deg inclination SSO intercept
        mass: 60,
        desc: '전 세계 기상/정찰위성이 가장 밀집된 850km 고도대에 98° 경사각으로 진입'
      },
      {
        name: '⚡ GEO Highway Penetrator',
        tag: '정지궤도 횡단',
        alt: 35786,
        lat: 0,
        lon: 80,
        speed: 3.07,
        azimuth: 90,
        mass: 200,
        desc: '정지궤도(35,786km) 적도 벨트에 진입하여 수십 기의 고가 통신위성을 차례로 교란'
      }
    ];

    this.initUI();
  }

  initUI() {
    const panel = document.createElement('div');
    panel.id = 'sim-controls-overlay';
    panel.className = 'sim-overlay glass-card hidden';

    // Render Scenario Cards HTML
    const scenarioCardsHTML = this.scenarios.map((sc, i) => `
      <div class="scenario-card" data-norad="${sc.norad}" data-frags="${sc.frags}" data-mass="${sc.mass}">
        <div class="sc-header">
          <span class="sc-num">#${i + 1}</span>
          <div class="sc-titles">
            <h4 class="sc-title">${sc.title}</h4>
            <span class="sc-sub">${sc.subtitle}</span>
          </div>
        </div>
        <div class="sc-chips">
          <span class="sc-chip chip-cyan">🎯 ${sc.name} (#${sc.norad})</span>
          <span class="sc-chip chip-amber">📡 ${sc.alt} | ${sc.incl}</span>
          <span class="sc-chip chip-purple">⚖️ ${sc.mass.toLocaleString()} kg</span>
        </div>
        <p class="sc-desc">${sc.desc}</p>
        <button class="btn btn-sm btn-danger btn-run-scenario" data-norad="${sc.norad}" data-frags="${sc.frags}" data-mass="${sc.mass}">
          💥 시나리오 실행 (Execute Scenario)
        </button>
      </div>
    `).join('');

    // Render Numerical Preset Buttons HTML
    const presetButtonsHTML = this.numericalPresets.map((pr, i) => `
      <button class="btn-preset-chip" data-idx="${i}">
        <span class="pr-name">${pr.name}</span>
        <span class="pr-tag">${pr.tag}</span>
      </button>
    `).join('');

    panel.innerHTML = `
      <div class="sim-panel-header">
        <span class="sim-panel-title"><i data-lucide="zap"></i> KESSLER SIMULATION ENGINE</span>
        <div class="sim-panel-header-right" style="display:flex; align-items:center; gap:10px;">
          <div class="sim-live-badge" style="background:rgba(255,23,68,0.15); border:1px solid rgba(255,23,68,0.35); padding:2px 8px; border-radius:4px; font-size:0.7rem; font-family:var(--font-mono); color:var(--white);">
            <span>💥 Cascades: </span>
            <strong id="sim-hud-collisions" style="color:#ff5252; font-weight:700;">0</strong>
          </div>
          <button id="btn-close-sim" class="btn-close">&times;</button>
        </div>
      </div>

      <!-- Mode Tabs -->
      <div class="sim-tabs">
        <button class="sim-tab active" data-tab="scenarios">📚 케슬러 시나리오 10선</button>
        <button class="sim-tab" data-tab="numerical">🚀 수치 발사 &amp; 프리셋</button>
        <button class="sim-tab" data-tab="drag">🎯 마우스 드래그 발사</button>
        <button class="sim-tab" data-tab="explode">💥 수동 위성 폭발</button>
      </div>

      <!-- Tab 1: 10 Curated Kessler Scenarios -->
      <div id="tab-content-scenarios" class="sim-tab-content active">
        <p class="sim-help-text">연쇄 폭발(Cascade Collision)이 발생하는 역사적/고밀도 궤도 시나리오를 원클릭으로 실행합니다.</p>
        <div class="scenarios-grid">
          ${scenarioCardsHTML}
        </div>
      </div>

      <!-- Tab 2: Numerical Form & 5 Tactical Presets -->
      <div id="tab-content-numerical" class="sim-tab-content">
        <label class="control-label" style="margin-bottom:6px;">⚡ Tactical Launch Presets (전술 발사 프리셋)</label>
        <div class="presets-row">
          ${presetButtonsHTML}
        </div>
        <p id="preset-desc-text" class="preset-desc-box">프리셋을 선택하면 궤도 역학 파라미터가 자동으로 입력됩니다.</p>

        <div class="form-grid" style="margin-top:12px;">
          <div class="form-group">
            <label>Altitude (고도, km)</label>
            <input type="number" id="num-alt" value="550" min="150" max="40000" />
          </div>
          <div class="form-group">
            <label>Latitude (위도, °)</label>
            <input type="number" id="num-lat" value="0" min="-90" max="90" />
          </div>
          <div class="form-group">
            <label>Longitude (경도, °)</label>
            <input type="number" id="num-lon" value="120" min="-180" max="180" />
          </div>
          <div class="form-group">
            <label>Speed (속도, km/s)</label>
            <input type="number" id="num-speed" value="7.60" step="0.01" />
          </div>
          <div class="form-group">
            <label>Azimuth (방위각, ° 0=북, 90=동, 270=서)</label>
            <input type="number" id="num-azimuth" value="270" min="0" max="360" />
          </div>
          <div class="form-group">
            <label>Mass (질량, kg)</label>
            <input type="number" id="num-mass" value="50" min="1" max="10000" />
          </div>
        </div>
        <div class="form-actions">
          <button id="btn-auto-circ" class="btn btn-outline">Set Circular Speed</button>
          <button id="btn-submit-numerical" class="btn btn-primary glow-cyan-btn">🚀 Launch Particle (발사)</button>
        </div>
      </div>

      <!-- Tab 3: Drag Instructions -->
      <div id="tab-content-drag" class="sim-tab-content">
        <p class="sim-help-text">지구 표면을 클릭하여 발사 지점을 지정한 후, 화살표를 드래그하여 발사 속도와 각도를 조정하세요.</p>
        <button id="btn-enable-drag-modal" class="btn btn-primary glow-cyan-btn" style="width:100%;">
          <i data-lucide="crosshair"></i> Activate 3D Drag Placer (드래그 발사 모드 활성화)
        </button>
      </div>

      <!-- Tab 4: Manual Explosion -->
      <div id="tab-content-explode" class="sim-tab-content">
        <p class="sim-help-text">지구상에서 위성을 선택한 후 원하는 폭발 에너지로 NASA 표준 분쇄 이벤트를 실행합니다.</p>
        <div class="form-group" style="margin-bottom:12px;">
          <label>Explosion Energy (폭발 에너지)</label>
          <input type="range" id="exp-energy-slider" min="6" max="11" step="0.1" value="8.5" class="range-slider" />
          <span id="exp-energy-label" class="range-val">3.2 × 10⁸ J (High)</span>
        </div>
        <button id="btn-trigger-explosion-modal" class="btn btn-danger glow-red-btn">
          💥 Trigger Explosion at Selected Object (선택 위성 폭발)
        </button>
      </div>
    `;

    this.container.appendChild(panel);
    this.modalEl = panel;

    this.bindPanelEvents();
    if (window.lucide) window.lucide.createIcons();
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

    // Scenario Run Buttons
    this.modalEl.querySelectorAll('.btn-run-scenario').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const norad = btn.dataset.norad;
        const frags = parseInt(btn.dataset.frags, 10) || 100;
        const mass = parseFloat(btn.dataset.mass) || 500;
        if (this.onExecuteScenario) {
          this.onExecuteScenario({ norad, frags, mass });
        }
      });
    });

    // Numerical Preset Buttons
    this.modalEl.querySelectorAll('.btn-preset-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const idx = parseInt(chip.dataset.idx, 10);
        const preset = this.numericalPresets[idx];
        if (!preset) return;

        document.getElementById('num-alt').value = preset.alt;
        document.getElementById('num-lat').value = preset.lat;
        document.getElementById('num-lon').value = preset.lon;
        document.getElementById('num-speed').value = preset.speed;
        document.getElementById('num-azimuth').value = preset.azimuth;
        document.getElementById('num-mass').value = preset.mass;

        const descEl = document.getElementById('preset-desc-text');
        if (descEl) {
          descEl.textContent = `🎯 [${preset.name}]: ${preset.desc}`;
          descEl.classList.add('highlight');
          setTimeout(() => descEl.classList.remove('highlight'), 800);
        }
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

      // Spherical ECI position (Three.js coords: Y is North, X-Z is equatorial plane)
      const cosLat = Math.cos(lat);
      const sinLat = Math.sin(lat);
      const cosLon = Math.cos(lon);
      const sinLon = Math.sin(lon);

      const px = r * cosLat * cosLon;
      const py = r * sinLat;
      const pz = r * cosLat * sinLon;

      // Local tangent unit vectors:
      // uNorth: points along meridian towards North (+Y)
      // uEast: points along parallel towards East (+lon, in Three.js: -X*sinLon + Z*cosLon)
      const cosAz = Math.cos(az);
      const sinAz = Math.sin(az);

      const uNorthX = -sinLat * cosLon;
      const uNorthY =  cosLat;
      const uNorthZ = -sinLat * sinLon;

      const uEastX = -sinLon;
      const uEastY =  0;
      const uEastZ =  cosLon;

      // Tangent velocity vector = speed * (cos(az) * uNorth + sin(az) * uEast)
      const vx = speed * (cosAz * uNorthX + sinAz * uEastX);
      const vy = speed * (cosAz * uNorthY + sinAz * uEastY);
      const vz = speed * (cosAz * uNorthZ + sinAz * uEastZ);

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

    // Drag Placer button in modal
    document.getElementById('btn-enable-drag-modal')?.addEventListener('click', () => {
      const dragBtn = document.getElementById('btn-enable-drag');
      if (dragBtn) dragBtn.click();
      this.hide();
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
    document.getElementById('btn-trigger-explosion-modal')?.addEventListener('click', () => {
      const expVal = parseFloat(energySlider.value);
      const energyJ = Math.pow(10, expVal);

      if (this.onExplodeTarget) {
        this.onExplodeTarget(energyJ);
      }
    });
  }

  updateLiveStats(stats, activeCount) {
    const elCol = document.getElementById('sim-hud-collisions');
    if (elCol && stats) {
      elCol.textContent = (stats.collisions || 0).toLocaleString();
    }
  }

  show() {
    this.modalEl.classList.remove('hidden');
    if (window.lucide) window.lucide.createIcons();
  }

  hide() {
    this.modalEl.classList.add('hidden');
  }

  toggle() {
    this.modalEl.classList.toggle('hidden');
    if (window.lucide) window.lucide.createIcons();
  }
}
