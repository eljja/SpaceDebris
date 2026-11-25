/**
 * SpaceDebris — NASA Standard Breakup Model (Johnson et al., 2001)
 *
 * Generates realistic debris clouds from satellite explosions and hypervelocity collisions.
 * Enforces EXACT mass conservation, EXACT 3D momentum vector conservation,
 * and anisotropic cone-biased dispersion for hypervelocity impacts.
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
   * Generates fragments from an explosion or collision event.
   * Fragment count and size distribution depend on parent mass and requested fidelity.
   *
   * @param {Object} parentObj - { mass (kg), position: {x,y,z}, velocity: {vx,vy,vz} }
   * @param {number} explosionEnergyJ - Explosion/collision energy in Joules
   * @param {number} maxFragments - Performance cap (e.g. 50, 120, 180)
   * @param {string} breakupType - 'explosion' or 'collision' (controls A/m & dispersion)
   * @param {Object|null} impactAxis - Optional unit vector {x,y,z} along relative impact velocity for anisotropic scatter
   * @returns {Array<Object>} Generated fragment objects with exact mass & momentum conservation
   */
  static explode(parentObj, explosionEnergyJ = 1e8, maxFragments = 150, breakupType = 'explosion', impactAxis = null) {
    const parentMass = parentObj.mass || 500;
    const parentPos = { ...parentObj.position };
    const parentVel = { ...parentObj.velocity };

    // ── 1. Determine target fragment count ───────────────────────
    const L_c_min = MIN_SIZE_CHAIN; // 0.05m
    let rawCount = Math.floor(
      6 * Math.pow(parentMass, 0.75) * Math.pow(L_c_min, -1.6) * 0.25
    );
    const randomFactor = 0.8 + Math.random() * 0.4; // ±20% variation
    rawCount = Math.floor(rawCount * randomFactor);

    const targetCount = Math.max(10, Math.min(rawCount, maxFragments));

    // ── 2. Maximum fragment size based on parent mass ────────────
    const parentVolume = parentMass / ALUMINUM_DENSITY;
    const maxLc = Math.max(
      L_c_min * 2,
      Math.min(2.5, Math.pow(parentVolume * 6 / Math.PI, 1 / 3) * 0.9)
    );

    const fragments = [];
    let totalGeneratedMass = 0;

    // ── 3. Generate 3D Dispersed Fragments ───────────────────────
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
          logAM = -0.45 + this._gaussianRandom() * 0.2;
        } else {
          logAM = -1.5 + this._gaussianRandom() * 0.5;
        }
      } else {
        if (Math.random() < 0.7) {
          logAM = -0.6 + this._gaussianRandom() * 0.15;
        } else {
          logAM = -1.2 + this._gaussianRandom() * 0.3;
        }
      }
      const areaToMass = Math.pow(10, logAM);
      const rawMass = area / areaToMass;
      totalGeneratedMass += rawMass;

      // Uniform 4π steradian spherical unit direction
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      let ux = Math.sin(phi) * Math.cos(theta);
      let uy = Math.sin(phi) * Math.sin(theta);
      let uz = Math.cos(phi);

      // For hypervelocity collisions, bias dispersion into a bipolar momentum cone along impactAxis
      if (breakupType === 'collision' && impactAxis) {
        const polarity = (i % 2 === 0) ? 1 : -1;
        const coneWeight = 0.45;
        ux = ux * (1 - coneWeight) + impactAxis.x * polarity * coneWeight;
        uy = uy * (1 - coneWeight) + impactAxis.y * polarity * coneWeight;
        uz = uz * (1 - coneWeight) + impactAxis.z * polarity * coneWeight;
        const uLen = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1;
        ux /= uLen;
        uy /= uLen;
        uz /= uLen;
      }

      // Delta-V Magnitude in km/s (NASA model: 0.04 to 0.85 km/s)
      const energyMultiplier = Math.sqrt(Math.max(0.2, explosionEnergyJ / 1e8));
      const logDV = -0.75 + 0.25 * logAM + this._gaussianRandom() * 0.2;
      const dvMag = Math.max(0.04, Math.min(0.85, Math.pow(10, logDV) * energyMultiplier));

      const dvx = dvMag * ux;
      const dvy = dvMag * uy;
      const dvz = dvMag * uz;

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

      const dvCorrX = (pxT - pxA) / parentMass;
      const dvCorrY = (pyT - pyA) / parentMass;
      const dvCorrZ = (pzT - pzA) / parentMass;

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
   * Conserves total mass and center-of-mass momentum vector.
   */
  static collide(obj1, obj2, maxFragments = 100) {
    const m1 = obj1.mass || 500;
    const m2 = obj2.mass || 100;

    // Relative velocity (km/s → m/s)
    const dvxKm = obj1.velocity.vx - obj2.velocity.vx;
    const dvyKm = obj1.velocity.vy - obj2.velocity.vy;
    const dvzKm = obj1.velocity.vz - obj2.velocity.vz;
    const vRelKm = Math.sqrt(dvxKm * dvxKm + dvyKm * dvyKm + dvzKm * dvzKm);
    const vRelMs = vRelKm * 1000;

    // Normalized relative impact axis for anisotropic hypervelocity cone scatter
    const impactAxis = vRelKm > 1e-4
      ? { x: dvxKm / vRelKm, y: dvyKm / vRelKm, z: dvzKm / vRelKm }
      : null;

    // Kinetic energy
    const projMass = Math.min(m1, m2);
    const targetMass = Math.max(m1, m2);
    const energyJ = 0.5 * projMass * vRelMs * vRelMs;

    // Specific energy (J/g)
    const specificEnergyJg = energyJ / (targetMass * 1000);
    const isCatastrophic = specificEnergyJg > CATASTROPHIC_THRESHOLD;

    // Total system mass is conserved across fragments (non-catastrophic impacts yield fewer fragments)
    const totalM = m1 + m2;
    const ejectedMassEstimate = isCatastrophic
      ? totalM
      : Math.min(totalM, projMass * Math.max(1, vRelKm));

    const velocityFactor = Math.max(1, vRelMs / 5000);
    const scaledMax = Math.min(
      maxFragments,
      Math.floor(maxFragments * velocityFactor * (ejectedMassEstimate / 500))
    );
    const effectiveMax = Math.max(isCatastrophic ? 15 : 10, Math.min(scaledMax, maxFragments));

    // Center-of-mass velocity
    const vCom = {
      vx: (m1 * obj1.velocity.vx + m2 * obj2.velocity.vx) / totalM,
      vy: (m1 * obj1.velocity.vy + m2 * obj2.velocity.vy) / totalM,
      vz: (m1 * obj1.velocity.vz + m2 * obj2.velocity.vz) / totalM
    };

    const collisionParent = {
      mass: totalM,
      position: { ...obj1.position },
      velocity: vCom
    };

    return this.explode(collisionParent, energyJ, effectiveMax, 'collision', impactAxis);
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
