# SpaceDebris — 3D Interactive Orbital Tracker & Kessler Syndrome Simulator

![License](https://img.shields.io/badge/License-CC%20BY--NC%204.0-orange.svg)
![Status](https://img.shields.io/badge/Status-Active%20%2F%20Live-brightgreen)
![Deployment](https://img.shields.io/badge/GitHub%20Pages-Live-blue)

**SpaceDebris** is a high-performance, real-time 3D web application for tracking active satellites, rocket bodies, and orbital debris, powered by SGP4 orbital propagation, NASA Standard Breakup Model physical simulation, and WebGL HDR bloom graphics.

🔗 **Live Web Application**: [https://eljja.github.io/SpaceDebris/](https://eljja.github.io/SpaceDebris/)

---

## 🌟 Key Features

### 📡 1. Real-Time 3D Orbital Tracker (Phase 1)
- **Real Satellite & Debris Catalog**: Tracks over **16,000+ active satellites**, **2,600+ debris fragments**, and **70,000+ SATCAT catalog objects** sourced from CelesTrak.
- **SGP4 Orbital Propagation**: Runs `satellite.js` SGP4 propagation in real-time inside the browser (with variable time acceleration up to 7 days/sec).
- **Level of Detail (LOD) Engine**: Dynamic camera-distance filtering to maintain smooth 60 FPS rendering using Three.js `InstancedMesh`.
- **Space Dark Glassmorphism UI**: Interactive filter panels by category (*Active Satellites, Dead Satellites, Rocket Bodies, Debris*) and orbit shell (*LEO, MEO, GEO, HEO*), real-time search, and detailed orbital element cards.

### 💥 2. Kessler Syndrome Physics Simulation Engine (Phase 2 & 3)
- **Orbital Physics Model (`PhysicsPropagator`)**: Integrates 2nd-order Velocity Verlet (Leapfrog) equations combining:
  - Central Keplerian Two-body Gravity
  - Earth $J_2$ Oblateness Perturbation
  - Altitude-dependent Atmospheric Drag ($\rho(h) = \rho_0 e^{-(h-h_0)/H}$)
  - Atmospheric Reentry Burn Detection ($h < 120\text{km}$)
- **NASA Standard Breakup Model (`BreakupModel`)**:
  - Power-law fragment size & $A/M$ ratio distributions (Johnson et al., 2001)
  - Hypervelocity catastrophic ($E > 40\text{J/g}$) vs non-catastrophic collision physics
  - **Exact Momentum Conservation Enforcement**: Guarantees $\sum m_i \vec{v}_i = M_{parent} \vec{v}_{parent}$ across all fragment ejections.
- **3D Spatial Hash Grid (`SpatialHashGrid`)**: O(N) spatial partitioning into $50\text{km} \times 50\text{km} \times 50\text{km}$ buckets for real-time collision detection.
- **Interactive Placement Tools**:
  - **3D Drag Placer**: Click anywhere on the 3D globe, drag velocity vector arrows, preview Keplerian trajectories, and launch custom debris.
  - **Numerical Input Panel**: Specify altitude, latitude, longitude, velocity magnitude, azimuth, and mass, with automatic circular velocity calculator.
  - **Explosion Trigger**: Select any object and trigger explosions with configurable energy ($10^6 \sim 10^{12}\text{J}$).
- **Procedural Web Audio Engine (`SoundEngine`)**: 100% procedural Web Audio synthesis for deep space ambient drones, sub-bass explosion shockwaves, debris launch chimes, and reentry crackles (0 external audio files).
- **HDR Bloom & Particle VFX**: Three.js `EffectComposer` + `UnrealBloomPass` + `OutputPass` and GPU particle explosion flares.

---

## 📅 Quarterly Data Update Protocol

Data is sourced from CelesTrak and archived as static JSON files in `./data/` to bypass CORS limitations:

```bash
# Run data update script quarterly
python scripts/fetch-data.py

# Commit updated data
git add data/
git commit -m "data: update quarterly CelesTrak catalog"
git push origin main
```

Last Updated Date & statistics are recorded in `data/metadata.json` and automatically displayed in the UI status bar.

---

## 🛠️ Technology Stack

- **3D Rendering**: Three.js v0.170.0 (CDN importmap)
- **Orbital Propagation**: satellite.js v5.0.0 (SGP4 / SDP4)
- **Post-Processing**: Three.js `EffectComposer`, `UnrealBloomPass`, `OutputPass`
- **Audio**: Web Audio API (Procedural Oscillator & Noise Nodes)
- **Icons**: Lucide Icons
- **Deployment**: Static GitHub Pages (`.github/workflows/deploy.yml`)

---

## 📄 License & Commercial Use

This project is licensed under **Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)**.

- **NonCommercial**: You may not use the material for commercial purposes.
- **Attribution**: You must give appropriate credit to the author ([https://github.com/eljja/SpaceDebris](https://github.com/eljja/SpaceDebris)).

See `LICENSE` file for full terms.
