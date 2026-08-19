/**
 * SpaceDebris — NASA Standard Breakup Model (Johnson et al., 2001)
 * 
 * Generates debris clouds from satellite explosions and hypervelocity collisions.
 * Enforces EXACT conservation of momentum and total mass.
 *
 * Size thresholds:
 * ────────────────────────────────────────────────────────────────
 *   L_c ≥ 0.10 m (10 cm)  →  Tracked debris (radar-detectable, Space Surveillance Network)
 *   L_c ≥ 0.05 m (5 cm)   →  Chain-reaction capable (KE at 7.5 km/s > 40 J/g for ~1kg target)
 *   L_c <  0.05 m          →  Sub-lethal: mass redistributed to tracked fragments
 * ────────────────────────────────────────────────────────────────
 *
 * Fragment count scales with parent mass via NASA power law:
 *   N(≥L_c) = 6 · M^0.75 · L_c^(-1.6)
 * with ±30% randomness applied, then capped by maxFragments for performance.
 *
 * After generation, sub-threshold fragments are culled and their mass is
 * redistributed proportionally to the surviving fragments, preserving total mass.
 */

// ── Physical Constants ──────────────────────────────────────────
const MIN_SIZE_TRACK = 0.10;        // 10 cm — real radar tracking limit
const MIN_SIZE_CHAIN = 0.05;        // 5 cm — can cause catastrophic collision at LEO speeds
const ALUMINUM_DENSITY = 2700;      // kg/m³ — typical spacecraft material
const LEO_ORBITAL_SPEED = 7.5;      // km/s — typical LEO relative collision speed
const CATASTROPHIC_THRESHOLD = 40;  // J/g — NASA catastrophic collision energy threshold

export class BreakupModel {
  /**
   * Generates fragments from an explosion event.
   * Fragment count and size distribution depend on parent mass.
   *
   * @param {Object} parentObj - { mass (kg), position: {x,y,z}, velocity: {vx,vy,vz} }
   * @param {number} explosionEnergyJ - Explosion energy in Joules
   * @param {number} maxFragments - Performance cap (default 200)
   * @param {string} breakupType - 'explosion' or 'collision' (controls A/m distribution)
   * @returns {Array<Object>} Generated fragment objects (only trackable/chain-reaction size)
   */
  static explode(parentObj, explosionEnergyJ = 1e8, maxFragments = 200, breakupType = 'explosion') {
    const parentMass = parentObj.mass || 500;
    const parentPos = { ...parentObj.position };
    const parentVel = { ...parentObj.velocity };

    // ── 1. Determine fragment count from NASA power law ──────────
    // N(≥L_c) = 6 · M^0.75 · L_c^(-1.6)
    // Using L_c_min = 0.01m to generate the full distribution, then filter
    const L_c_generation = 0.01; // Generate fragments down to 1cm internally
    let rawCount = Math.floor(
      6 * Math.pow(parentMass, 0.75) * Math.pow(L_c_generation, -1.6)
    );

    // Apply ±30% randomness
    const randomFactor = 0.7 + Math.random() * 0.6; // [0.7, 1.3]
    rawCount = Math.floor(rawCount * randomFactor);
    rawCount = Math.max(5, Math.min(rawCount, maxFragments));

    // ── 2. Generate raw fragment distribution ────────────────────
    const allFragments = [];
    let totalGeneratedMass = 0;

    // Maximum fragment size scales with parent mass (strictly > lcMin)
    const parentVolume = parentMass / ALUMINUM_DENSITY;
    const maxLc = Math.max(
      L_c_generation * 2, // Must be greater than L_c_generation (0.01m)
      Math.min(2.0, Math.pow(parentVolume * 6 / Math.PI, 1/3) * 0.8)
    );

    for (let i = 0; i < rawCount; i++) {
      // Power-law sampling for L_c
      const u = Math.random();
      const n = -2.6;
      const lcMin = L_c_generation;
      const lcMax = maxLc;
      const L_c = Math.pow(
        (Math.pow(lcMax, n + 1) - Math.pow(lcMin, n + 1)) * u + Math.pow(lcMin, n + 1),
        1 / (n + 1)
      );

      // Cross-sectional area: A = 0.5569 · L_c^2.0047
      const area = 0.5569 * Math.pow(L_c, 2.0047);

      // Area-to-Mass ratio: NASA bimodal log-normal distribution
      // Explosions and collisions have distinct A/m distributions (Johnson et al., 2001)
      let logAM;
      if (breakupType === 'collision') {
        // Collision: wider bimodal spread
        if (Math.random() < 0.6) {
          logAM = -0.45 + this._gaussianRandom() * 0.2;  // Mode 1: larger, lighter fragments
        } else {
          logAM = -1.5  + this._gaussianRandom() * 0.5;  // Mode 2: denser, heavier fragments
        }
      } else {
        // Explosion: tighter bimodal
        if (Math.random() < 0.7) {
          logAM = -0.6 + this._gaussianRandom() * 0.1;   // Mode 1: standard spacecraft panels
        } else {
          logAM = -1.2 + this._gaussianRandom() * 0.3;   // Mode 2: structural members
        }
      }
      const areaToMass = Math.pow(10, logAM);

      const mass = area / areaToMass;
      totalGeneratedMass += mass;

      // Delta-V direction (isotropic spherical)
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);

      // Delta-V magnitude from A/M ratio
      const logDV = -0.3 + 0.2 * logAM + this._gaussianRandom() * 0.2;
      const dvMag = Math.pow(10, logDV) * 0.001; // m/s → km/s

      allFragments.push({
        L_c,
        mass,
        area,
        areaToMass,
        dv: {
          x: dvMag * Math.sin(phi) * Math.cos(theta),
          y: dvMag * Math.sin(phi) * Math.sin(theta),
          z: dvMag * Math.cos(phi)
        }
      });
    }

    // ── 3. Filter: keep only chain-reaction-capable fragments ────
    // Fragments ≥ MIN_SIZE_CHAIN (5cm) are kept.
    // Fragments < 5cm are culled; their mass redistributed.
    const kept = [];
    let culledMass = 0;

    for (const f of allFragments) {
      if (f.L_c >= MIN_SIZE_CHAIN) {
        kept.push(f);
      } else {
        culledMass += f.mass;
      }
    }

    // If all fragments were culled (very small parent), keep at least 3
    if (kept.length === 0 && allFragments.length > 0) {
      // Sort by size descending and keep top 3
      allFragments.sort((a, b) => b.L_c - a.L_c);
      const toKeep = Math.min(3, allFragments.length);
      for (let i = 0; i < toKeep; i++) {
        kept.push(allFragments[i]);
        culledMass -= allFragments[i].mass;
      }
      culledMass = Math.max(0, culledMass);
    }

    // ── 4. Mass normalization ────────────────────────────────────
    // Total mass of kept fragments should equal parentMass.
    // First, scale kept fragments to their proportional mass,
    // then add the culled mass proportionally.
    const keptMassSum = kept.reduce((s, f) => s + f.mass, 0);
    if (keptMassSum > 0) {
      const scale = parentMass / keptMassSum;
      for (const f of kept) {
        f.mass *= scale;
      }
    }

    // ── 5. Build output fragment objects ─────────────────────────
    const fragments = [];
    for (const f of kept) {
      fragments.push({
        position: { ...parentPos },
        velocity: {
          vx: parentVel.vx + f.dv.x,
          vy: parentVel.vy + f.dv.y,
          vz: parentVel.vz + f.dv.z
        },
        mass: f.mass,
        size: f.L_c,
        areaToMass: f.areaToMass,
        category: f.L_c >= MIN_SIZE_TRACK ? 'sim_tracked' : 'sim_chain',
        type: 'SIM_FRAGMENT'
      });
    }

    // ── 6. EXACT MOMENTUM CONSERVATION ──────────────────────────
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

      // Uniform momentum correction delta-V: dv = deltaP / parentMass
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
   *
   * Categorizes:
   *   Catastrophic:     specific energy > 40 J/g → both objects fully fragment
   *   Non-catastrophic: specific energy ≤ 40 J/g → only ejecta mass fragments
   */
  static collide(obj1, obj2, maxFragments = 150) {
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

    // Fragment mass budget
    let fragmentMass;
    if (isCatastrophic) {
      // Both objects fully disintegrate
      fragmentMass = m1 + m2;
    } else {
      // Only ejecta: M_ejecta ∝ m_proj · v_rel (km/s)
      fragmentMass = Math.min(
        m1 + m2,
        projMass * (vRelMs / 1000) // vRelMs back to km/s
      );
    }

    // Fragment count scales with fragment mass AND relative velocity
    // Higher velocity → more, smaller fragments
    const velocityFactor = Math.max(1, vRelMs / 5000); // normalize to 5 km/s
    const scaledMax = Math.min(
      maxFragments,
      Math.floor(maxFragments * velocityFactor * (fragmentMass / 500))
    );
    const effectiveMax = Math.max(5, Math.min(scaledMax, maxFragments));

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

  /**
   * Returns minimum trackable size (10cm) for external reference
   */
  static get MIN_SIZE_TRACK() { return MIN_SIZE_TRACK; }

  /**
   * Returns minimum chain-reaction size (5cm) for external reference
   */
  static get MIN_SIZE_CHAIN() { return MIN_SIZE_CHAIN; }
}
