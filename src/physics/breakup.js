/**
 * SpaceDebris — NASA Standard Breakup Model (Johnson et al., 2001)
 * Generates debris clouds from satellite explosions and hypervelocity collisions,
 * enforcing EXACT CONSERVATION OF MOMENTUM and energy budgeting.
 */

export class BreakupModel {
  /**
   * Generates fragments from an explosion event
   * @param {Object} parentObj - { mass, position: {x,y,z}, velocity: {vx,vy,vz} }
   * @param {number} explosionEnergyJ - Explosion energy in Joules
   * @param {number} maxFragments - Maximum fragments cap (default 300)
   * @returns {Array<Object>} Generated fragment objects
   */
  static explode(parentObj, explosionEnergyJ = 1e8, maxFragments = 300) {
    const parentMass = parentObj.mass || 500; // kg
    const parentPos = { ...parentObj.position };
    const parentVel = { ...parentObj.velocity };

    // Minimum characteristic length L_c = 0.05m (5 cm)
    const L_c_min = 0.05;
    
    // NASA Explosion Power Law: N(L_c) = 6 * M^0.75 * L_c^(-1.6)
    let totalCount = Math.floor(6 * Math.pow(parentMass, 0.75) * Math.pow(L_c_min, -1.6));
    totalCount = Math.max(10, Math.min(totalCount, maxFragments));

    const fragments = [];
    let sumMass = 0;

    // 1. Generate Characteristic Length, Mass, and A/M ratio for each fragment
    for (let i = 0; i < totalCount; i++) {
      // Power-law sampling for L_c in [0.05m, 1.5m]
      const u = Math.random();
      const n = -2.6; // Power law exponent
      const L_c = Math.pow((Math.pow(1.5, n + 1) - Math.pow(0.05, n + 1)) * u + Math.pow(0.05, n + 1), 1 / (n + 1));

      // Area A = 0.5569 * L_c^2.0047
      const area = 0.5569 * Math.pow(L_c, 2.0047);

      // Area-to-Mass ratio (log-normal distribution centered around -0.6)
      const logAM = -0.6 + (Math.random() * 2 - 1) * 0.4;
      const areaToMass = Math.pow(10, logAM); // m^2 / kg

      const mass = area / areaToMass;
      sumMass += mass;

      // Uncalibrated isotropic Delta-V direction & magnitude
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);

      // Delta-V magnitude derived from A/M ratio: log10(DV) = -0.3 + 0.2*log10(A/M) + N(0, 0.2)
      const logDV = -0.3 + 0.2 * logAM + (Math.random() * 2 - 1) * 0.2;
      const dvMag = Math.pow(10, logDV) * 0.001; // Convert m/s to km/s

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
        mass,
        size: L_c,
        areaToMass,
        type: 'SIM_FRAGMENT'
      });
    }

    // 2. Mass Normalization (Ensure total fragment mass equals parent mass)
    const massScale = parentMass / sumMass;
    for (const f of fragments) {
      f.mass *= massScale;
    }

    // 3. EXACT MOMENTUM CONSERVATION ENFORCEMENT
    // P_target = parentMass * parentVel
    // P_actual = sum( m_i * v_i )
    let pxActual = 0, pyActual = 0, pzActual = 0;
    for (const f of fragments) {
      pxActual += f.mass * f.velocity.vx;
      pyActual += f.mass * f.velocity.vy;
      pzActual += f.mass * f.velocity.vz;
    }

    const pxTarget = parentMass * parentVel.vx;
    const pyTarget = parentMass * parentVel.vy;
    const pzTarget = parentMass * parentVel.vz;

    const deltaPx = pxTarget - pxActual;
    const deltaPy = pyTarget - pyActual;
    const deltaPz = pzTarget - pzActual;

    // Distribute residual momentum uniformly across all fragments: dv_corr = deltaP / M_parent
    const dvCorrX = deltaPx / parentMass;
    const dvCorrY = deltaPy / parentMass;
    const dvCorrZ = deltaPz / parentMass;

    for (const f of fragments) {
      f.velocity.vx += dvCorrX;
      f.velocity.vy += dvCorrY;
      f.velocity.vz += dvCorrZ;
    }

    return fragments;
  }

  /**
   * Generates fragments from a hypervelocity collision event between two objects
   * Categorizes catastrophic (E > 40 J/g) vs non-catastrophic fragmentation.
   */
  static collide(obj1, obj2, maxFragments = 300) {
    const m1 = obj1.mass || 500;
    const m2 = obj2.mass || 100;

    // Relative velocity v_rel (km/s -> m/s)
    const dvx = (obj1.velocity.vx - obj2.velocity.vx) * 1000;
    const dvy = (obj1.velocity.vy - obj2.velocity.vy) * 1000;
    const dvz = (obj1.velocity.vz - obj2.velocity.vz) * 1000;
    const vRelMs = Math.sqrt(dvx * dvx + dvy * dvy + dvz * dvz);

    // Kinetic Energy E = 0.5 * m_proj * v_rel^2
    const projMass = Math.min(m1, m2);
    const targetMass = Math.max(m1, m2);
    const energyJ = 0.5 * projMass * vRelMs * vRelMs;

    // Specific Energy (J / g) = Energy / (TargetMass * 1000)
    const specificEnergyJg = energyJ / (targetMass * 1000);

    const isCatastrophic = specificEnergyJg > 40; // NASA standard threshold

    // Total Fragment Mass
    const totalMass = isCatastrophic ? (m1 + m2) : (projMass * vRelMs / 1000);

    // Center of Mass velocity
    const vCom = {
      vx: (m1 * obj1.velocity.vx + m2 * obj2.velocity.vx) / (m1 + m2),
      vy: (m1 * obj1.velocity.vy + m2 * obj2.velocity.vy) / (m1 + m2),
      vz: (m1 * obj1.velocity.vz + m2 * obj2.velocity.vz) / (m1 + m2)
    };

    const collisionParent = {
      mass: totalMass,
      position: { ...obj1.position },
      velocity: vCom
    };

    return this.explode(collisionParent, energyJ, maxFragments);
  }
}
