/**
 * SpaceDebris — Orbital Propagator (Keplerian + J2 Perturbation + Atmospheric Drag)
 * Used for dynamic particles created during physical simulations.
 * Integrates using 2nd-order Velocity Verlet (Leapfrog) for superior energy stability.
 */

// Constants
const MU = 398600.4418;        // Earth gravitational parameter (km^3 / s^2)
const J2 = 1.08263e-3;         // Earth 2nd zonal harmonic (oblateness)
const RE = 6378.137;           // Earth equatorial radius (km)
const CD = 2.2;                // Standard satellite drag coefficient

// Atmospheric Density Model (Exponential table: h (km), rho0 (kg/m^3), H (km))
const ATMOSPHERE_TABLE = [
  { altMin: 120, altMax: 200, rho0: 3.89e-9,  h0: 120, H: 18.2 },
  { altMin: 200, altMax: 300, rho0: 2.53e-10, h0: 200, H: 37.1 },
  { altMin: 300, altMax: 500, rho0: 6.97e-12, h0: 300, H: 53.6 },
  { altMin: 500, altMax: 750, rho0: 1.45e-13, h0: 500, H: 76.8 },
  { altMin: 750, altMax: 1000, rho0: 3.61e-15, h0: 750, H: 103.5 }
];

export class PhysicsPropagator {
  /**
   * Computes total acceleration = Gravity + J2 Oblateness + Atmospheric Drag
   * @param {Object} pos - {x, y, z} in km (ECI frame)
   * @param {Object} vel - {vx, vy, vz} in km/s (ECI frame)
   * @param {number} areaToMass - Area-to-mass ratio (m^2 / kg)
   * @returns {Object} {ax, ay, az} in km/s^2
   */
  static getAcceleration(pos, vel, areaToMass = 0.01) {
    const r2 = pos.x * pos.x + pos.y * pos.y + pos.z * pos.z;
    const r = Math.sqrt(r2);
    const r3 = r2 * r;
    const r5 = r3 * r2;

    // 1. Central Two-body Gravity: a_grav = -mu / r^3 * r
    let ax = -MU * pos.x / r3;
    let ay = -MU * pos.y / r3;
    let az = -MU * pos.z / r3;

    // 2. J2 Perturbation (Earth oblateness)
    const z2_r2 = (pos.z * pos.z) / r2;
    const j2Factor = (1.5 * J2 * MU * RE * RE) / r5;

    ax += j2Factor * pos.x * (5 * z2_r2 - 1);
    ay += j2Factor * pos.y * (5 * z2_r2 - 1);
    az += j2Factor * pos.z * (5 * z2_r2 - 3);

    // 3. Atmospheric Drag (for altitude < 1000km)
    const alt = r - RE;
    if (alt > 120 && alt < 1000 && areaToMass > 0) {
      let rho = 0;
      for (const layer of ATMOSPHERE_TABLE) {
        if (alt >= layer.altMin && alt <= layer.altMax) {
          rho = layer.rho0 * Math.exp(-(alt - layer.h0) / layer.H);
          break;
        }
      }

      if (rho > 0) {
        const v2 = vel.vx * vel.vx + vel.vy * vel.vy + vel.vz * vel.vz;
        const v = Math.sqrt(v2);

        // a_drag = -0.5 * rho * v^2 * (Cd * A/m) * v_hat (unit vector)
        // Convert rho from kg/m^3 to kg/km^3 (multiply by 1e9)
        // areaToMass is in m^2/kg. 
        // Resulting drag acceleration in km/s^2:
        const dragCoeff = 0.5 * (rho * 1e9) * (CD * (areaToMass * 1e-6)) * v;

        ax -= dragCoeff * vel.vx;
        ay -= dragCoeff * vel.vy;
        az -= dragCoeff * vel.vz;
      }
    }

    return { ax, ay, az };
  }

  /**
   * Advances particle state by dt using Velocity Verlet (Leapfrog) integration
   * @param {Object} particle - { position: {x,y,z}, velocity: {vx,vy,vz}, areaToMass, mass }
   * @param {number} dtSec - Time step in seconds
   * @returns {boolean} True if particle reentered atmosphere (alt < 120km)
   */
  static step(particle, dtSec) {
    const pos = particle.position;
    const vel = particle.velocity;
    const am = particle.areaToMass || 0.01;

    // 1. Initial Acceleration a_n
    const a0 = this.getAcceleration(pos, vel, am);

    // 2. Position step: r_{n+1} = r_n + v_n*dt + 0.5*a_0*dt^2
    pos.x += vel.vx * dtSec + 0.5 * a0.ax * dtSec * dtSec;
    pos.y += vel.vy * dtSec + 0.5 * a0.ay * dtSec * dtSec;
    pos.z += vel.vz * dtSec + 0.5 * a0.az * dtSec * dtSec;

    // Check Reentry Altitude (< 120km)
    const r = Math.sqrt(pos.x * pos.x + pos.y * pos.y + pos.z * pos.z);
    if (r - RE < 120) {
      return true; // Reentered / destroyed
    }

    // 3. New Acceleration a_{n+1}
    const a1 = this.getAcceleration(pos, vel, am);

    // 4. Velocity step: v_{n+1} = v_n + 0.5*(a_0 + a_{n+1})*dt
    vel.vx += 0.5 * (a0.ax + a1.ax) * dtSec;
    vel.vy += 0.5 * (a0.ay + a1.ay) * dtSec;
    vel.vz += 0.5 * (a0.az + a1.az) * dtSec;

    return false;
  }
}
