/**
 * SpaceDebris — NASA Standard Breakup Model (Johnson et al., 2001)
 * 
 * Generates realistic debris clouds from satellite explosions and hypervelocity collisions.
 * Enforces EXACT 3D spherical isotropic dispersion, momentum conservation, and mass conservation.
 *
 * Size thresholds:
 * ────────────────────────────────────────────────────────────────
 *   L_c ≥ 0.10 m (10 cm)  →  Tracked debris (radar-detectable, Space Surveillance Network)
 *   L_c ≥ 0.05 m (5 cm)   →  Chain-reaction capable (KE at 7.5 km/s > 40 J/g for ~1kg target)
 * ────────────────────────────────────────────────────────────────
 */

const MIN_SIZE_TRACK = 0.10;        // 10 cm — real radar tracking limit
const MIN_SIZE_CHAIN = 0.05;        // 5 cm — can cause catastrophic collision at LEO speeds
const ALUMINUM_DENSITY = 2700;      // kg/m³ — typical spacecraft material
const CATASTROPHIC_THRESHOLD = 40;  // J/g — NASA catastrophic collision energy threshold

export class BreakupModel {
  /**
   * Generates fragments from an explosion event.
   * Fragment count and size distribution depend on parent mass and requested fidelity.
   *
   * @param {Object} parentObj - { mass (kg), position: {x,y,z}, velocity: {vx,vy,vz} }
   * @param {number} explosionEnergyJ - Explosion energy in Joules
   * @param {number} maxFragments - Performance cap (e.g. 50, 120, 180)
   * @param {string} breakupType - 'explosion' or 'collision' (controls A/m distribution)
   * @returns {Array<Object>} Generated fragment objects with true 3D isotropic velocity dispersion
   */
  static explode(parentObj, explosionEnergyJ = 1e8, maxFragments = 150, breakupType = 'explosion') {
    const parentMass = parentObj.mass || 500;
    const parentPos = { ...parentObj.position };
    const parentVel = { ...parentObj.velocity };

    // ── 1. Determine target fragment count ───────────────────────
    // Scale count by parent mass and cap at maxFragments
    const L_c_min = MIN_SIZE_CHAIN; // 0.05m
    let rawCount = Math.floor(
      6 * Math.pow(parentMass, 0.75) * Math.pow(L_c_min, -1.6) * 0.25
    );
    const randomFactor = 0.8 + Math.random() * 0.4; // ±20% variation
    rawCount = Math.floor(rawCount * randomFactor);

    // Target count: respect user scenario requested count (e.g. 120, 180)
    const targetCount = Math.max(10, Math.min(rawCount, maxFragments));

    // ── 2. Maximum fragment size based on parent mass ────────────
    const parentVolume = parentMass / ALUMINUM_DENSITY;
    const maxLc = Math.max(
      L_c_min * 2,
      Math.min(2.5, Math.pow(parentVolume * 6 / Math.PI, 1/3) * 0.9)
    );

    const fragments = [];
    let totalGeneratedMass = 0;

    // ── 3. Generate 3D Isotropically Dispersed Fragments ────────
    for (let i = 0; i < targetCount; i++) {
      // Power-law sampling for L_c in [L_c_min, maxLc]
      const u = Math.random();
      const n = -2.6;
      const L_c = Math.pow(
        (Math.pow(maxLc, n + 1) - Math.pow(L_c_min, n + 1)) * u + Math.pow(L_c_min, n + 1),
        1 / (n + 1)
      );

      // Cross-sectional area: A = 0.5569 · L_c^2.0047
      const area = 0.5569 * Math.pow(L_c, 2.0047);

      // Area-to-Mass ratio: NASA bimodal log-normal distribution (Johnson et al., 2001)
      let logAM;
      if (breakupType === 'collision') {
        if (Math.random() < 0.6) {
          logAM = -0.45 + this._gaussianRandom() * 0.2;  // Mode 1
        } else {
          logAM = -1.5  + this._gaussianRandom() * 0.5;  // Mode 2
        }
      } else {
        if (Math.random() < 0.7) {
          logAM = -0.6 + this._gaussianRandom() * 0.15;  // Mode 1
        } else {
          logAM = -1.2 + this._gaussianRandom() * 0.3;   // Mode 2
        }
      }
      const areaToMass = Math.pow(10, logAM);
      const rawMass = area / areaToMass;
      totalGeneratedMass += rawMass;

      // ── 3D Isotropic Spherical Direction Sampling ────────────
      // Uniform distribution across the 4π steradian sphere
      const theta = Math.random() * Math.PI * 2;          // Azimuth [0, 2π)
      const phi = Math.acos(2 * Math.random() - 1);        // Polar angle [0, π]

      // ── Delta-V Magnitude in km/s ────────────────────────────
      // In real hypervelocity breakups, ejection speed ranges from 50 m/s to 600 m/s (0.05 to 0.6 km/s)
      // NASA model: log10(dv [km/s]) = -0.7 + 0.25 * log10(A/m) + Gaussian(0, 0.2)
      const energyMultiplier = Math.sqrt(Math.max(0.2, explosionEnergyJ / 1e8));
      const logDV = -0.75 + 0.25 * logAM + this._gaussianRandom() * 0.2;
      const dvMag = Math.max(0.04, Math.min(0.85, Math.pow(10, logDV) * energyMultiplier)); // km/s

      // 3D delta-V Cartesian components (expanding spherically in all directions)
      const dvx = dvMag * Math.sin(phi) * Math.cos(theta);
      const dvy = dvMag * Math.sin(phi) * Math.sin(theta);
      const dvz = dvMag * Math.cos(phi);

      fragments.push({
        position: { ...parentPos },
        velocity: {
          vx: parentVel.vx + dvx,
          vy: parentVel.vy + dvy,
          vz: parentVel.vz + dvz
        },
        mass: rawMass,
        size: L_c,
        areaToMass: areaToMass,
        category: L_c >= MIN_SIZE_TRACK ? 'sim_tracked' : 'sim_chain',
        type: 'SIM_FRAGMENT'
      });
    }

    // ── 4. Exact Mass Normalization ──────────────────────────────
    if (totalGeneratedMass > 0) {
      const massScale = parentMass / totalGeneratedMass;
      for (const f of fragments) {
        f.mass *= massScale;
      }
    }

    // ── 5. Exact Momentum Vector Conservation ────────────────────
    if (fragments.length > 0) {
      let pxA = 0, pyA = 0, pzA = 0;
      for (const f of fragments) {
        pxA += f.mass * f.velocity.vx;
        pyA += f.mass * f.velocity.vy;
        pzA += f.mass * f.velocity.vz;
      }

      const pxT = parentMass * parentVel.vx;
      const pyT = parentMass * parentVel.vy;
      const pzT = parentMass * parentVel.vz;

      const dpx = pxT - pxA;
      const dpy = pyT - pyA;
      const dpz = pzT - pzA;

      // Distribute residual delta-momentum uniformly across all fragments
      const dvCorrX = dpx / parentMass;
      const dvCorrY = dpy / parentMass;
      const dvCorrZ = dpz / parentMass;

      for (const f of fragments) {
        f.velocity.vx += dvCorrX;
        f.velocity.vy += dvCorrY;
        f.velocity.vz += dvCorrZ;
      }
    }

    return fragments;
  }

  /**
   * Generates fragments from a hypervelocity collision.
   * Fragment count scales with combined mass and relative velocity.
   */
  static collide(obj1, obj2, maxFragments = 100) {
    const m1 = obj1.mass || 500;
    const m2 = obj2.mass || 100;

    // Relative velocity (km/s → m/s)
    const dvx = (obj1.velocity.vx - obj2.velocity.vx) * 1000;
    const dvy = (obj1.velocity.vy - obj2.velocity.vy) * 1000;
    const dvz = (obj1.velocity.vz - obj2.velocity.vz) * 1000;
    const vRelMs = Math.sqrt(dvx * dvx + dvy * dvy + dvz * dvz);

    // Kinetic energy
    const projMass = Math.min(m1, m2);
    const targetMass = Math.max(m1, m2);
    const energyJ = 0.5 * projMass * vRelMs * vRelMs;

    // Specific energy (J/g)
    const specificEnergyJg = energyJ / (targetMass * 1000);
    const isCatastrophic = specificEnergyJg > CATASTROPHIC_THRESHOLD;

    let fragmentMass;
    if (isCatastrophic) {
      fragmentMass = m1 + m2;
    } else {
      fragmentMass = Math.min(m1 + m2, projMass * (vRelMs / 1000));
    }

    const velocityFactor = Math.max(1, vRelMs / 5000);
    const scaledMax = Math.min(
      maxFragments,
      Math.floor(maxFragments * velocityFactor * (fragmentMass / 500))
    );
    const effectiveMax = Math.max(15, Math.min(scaledMax, maxFragments));

    // Center-of-mass velocity
    const totalM = m1 + m2;
    const vCom = {
      vx: (m1 * obj1.velocity.vx + m2 * obj2.velocity.vx) / totalM,
      vy: (m1 * obj1.velocity.vy + m2 * obj2.velocity.vy) / totalM,
      vz: (m1 * obj1.velocity.vz + m2 * obj2.velocity.vz) / totalM
    };

    const collisionParent = {
      mass: fragmentMass,
      position: { ...obj1.position },
      velocity: vCom
    };

    return this.explode(collisionParent, energyJ, effectiveMax, 'collision');
  }

  /**
   * Approximate Gaussian random using Box-Muller transform (mean=0, std=1)
   */
  static _gaussianRandom() {
    let u1, u2;
    do { u1 = Math.random(); } while (u1 === 0);
    u2 = Math.random();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  static get MIN_SIZE_TRACK() { return MIN_SIZE_TRACK; }
  static get MIN_SIZE_CHAIN() { return MIN_SIZE_CHAIN; }
}
