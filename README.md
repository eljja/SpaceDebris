# SpaceDebris 🛰️ 3D Interactive Orbital Tracker & Kessler Syndrome Simulator

![License](https://img.shields.io/badge/License-CC%20BY--NC%204.0-orange.svg)
![Status](https://img.shields.io/badge/Status-Active%20%2F%20Live-brightgreen)
![Deployment](https://img.shields.io/badge/GitHub%20Pages-Live-blue)
![SEO](https://img.shields.io/badge/SEO-Optimized-blueviolet)

**SpaceDebris** is a high-performance, real-time 3D web application for tracking active satellites, rocket bodies, and orbital debris, powered by SGP4 orbital propagation, NASA Standard Breakup Model physical simulation, and WebGL HDR bloom graphics.

🔗 **Live Web Application**: [https://eljja.github.io/SpaceDebris/](https://eljja.github.io/SpaceDebris/)

---

## ✨ Key Features

### 📡 1. Real-Time 3D Orbital Tracker
- **Real Satellite & Debris Catalog**: Tracks over **16,000+ active satellites**, **2,600+ debris fragments**, and **70,000+ SATCAT catalog objects** sourced from CelesTrak.
- **SGP4 Orbital Propagation**: Runs `satellite.js` SGP4 propagation in real-time inside the browser (with variable time warp acceleration up to **86,400x** - 1 day/sec).
- **Level of Detail (LOD) Engine**: Dynamic camera-distance filtering to maintain smooth 60 FPS rendering using Three.js `InstancedMesh`.
- **Space Dark Glassmorphism UI**: Interactive filter panels by category (*Active Satellites, Dead Satellites, Rocket Bodies, Debris*) and orbit shell (*LEO, MEO, GEO, HEO*), real-time search, and detailed orbital element cards.

### 💥 2. Kessler Syndrome Physics Simulation Engine
- **Historical Scenarios**: Trigger real-world events like the **Cosmos 2251 vs Iridium 33 Collision (2009)** or **ASAT Missile Tests** to watch the Kessler Syndrome unfold in real-time.
- **NASA Standard Breakup Model (`BreakupModel`)**:
  - Power-law fragment size & $A/M$ ratio distributions (Johnson et al., 2001)
  - Hypervelocity catastrophic ($E > 40\text{J/g}$) vs non-catastrophic collision physics.
  - **Exact Momentum Conservation Enforcement**: Guarantees $\sum m_i \vec{v}_i = M_{parent} \vec{v}_{parent}$ across all fragment ejections.
- **Advanced Collision Engine (`SpatialHashGrid`)**: 
  - Continuous Collision Detection (CCD) using CPA (Closest Point of Approach) to prevent high-speed tunneling.
  - O(N) spatial partitioning into $60\text{km} \times 60\text{km} \times 60\text{km}$ buckets.
  - **Smart Lineage Tracking**: Tracks parent-child fragment relations up to 5 generations, effectively preventing unnatural incestuous intra-cloud chain reactions while accurately computing strikes against other independent satellites.
- **Orbital Physics Integrator (`PhysicsPropagator`)**: 
  - Synchronized high-time-warp Verlet integration (stable up to 30s dt for LEO) matching SGP4 accelerated background time.
  - Central Keplerian Two-body Gravity + Earth $J_2$ Oblateness Perturbation.
  - Atmospheric Drag and Reentry Burn Detection ($h < 120\text{km}$).

### 🛠️ 3. Interactive Tools & VFX
- **Interactive Placement Tools**:
  - **3D Drag Placer**: Click anywhere on the 3D globe, drag velocity vector arrows, preview Keplerian trajectories, and launch custom debris.
  - **Numerical Input Panel**: Specify altitude, latitude, longitude, velocity magnitude, azimuth, and mass, with automatic circular velocity calculator.
  - **Explosion Trigger**: Select any object and trigger explosions with configurable energy ($10^6 \sim 10^{12}\text{J}$).
- **Procedural Web Audio Engine (`SoundEngine`)**: 100% procedural Web Audio synthesis for deep space ambient drones, sub-bass explosion shockwaves, debris launch chimes, and reentry crackles (0 external audio files).
- **HDR Bloom & Particle VFX**: Three.js `EffectComposer` + `UnrealBloomPass` + GPU particle explosion flares and shockwave rings.

---

## 📈 Search Engine Optimization (SEO)
The application is fully SEO-ready for indexation on search engines:
- Pre-configured `sitemap.xml` and `robots.txt`
- Open Graph (`og:`) and Twitter Card metadata for rich social sharing (add a `preview.jpg` to the root for the thumbnail)
- Google Search Console Verification and `application/ld+json` WebApp Structured Data.

---

## 🔄 Quarterly Data Update Protocol

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

## 💻 Technology Stack

- **3D Rendering**: Three.js v0.170.0 (CDN importmap)
- **Orbital Propagation**: satellite.js v5.0.0 (SGP4 / SDP4)
- **Post-Processing**: Three.js `EffectComposer`, `UnrealBloomPass`, `OutputPass`
- **Audio**: Web Audio API (Procedural Oscillator & Noise Nodes)
- **Icons**: Lucide Icons
- **Deployment**: Static GitHub Pages

---

## 📄 License & Commercial Use

This project is licensed under **Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)**.

- **NonCommercial**: You may not use the material for commercial purposes.
- **Attribution**: You must give appropriate credit to the author ([https://github.com/eljja/SpaceDebris](https://github.com/eljja/SpaceDebris)).

See `LICENSE` file for full terms.
