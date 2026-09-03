/**
 * SpaceDebris — Orbital Propagator (Keplerian + J2 Perturbation + Atmospheric Drag)
 * Used for dynamic particles created during physical simulations.
 * Integrates using 2nd-order Velocity Verlet (Symplectic Leapfrog) for superior
 * long-term energy conservation in Hamiltonian systems.
 *
 * Physical model:
 *   - Two-body Keplerian gravity:  a = -μ/r³ · r
 *   - J2 Earth oblateness perturbation (WGS84)
 *   - Exponential atmospheric drag with co-rotating atmosphere correction
 *
 * Coordinate system: Three.js (Y-up = ECI North Pole)
 */

// ── Physical Constants ──────────────────────────────────────────
const MU = 398600.4418;        // Earth gravitational parameter (km³/s²)
const J2 = 1.08263e-3;         // Earth J2 zonal harmonic (oblateness)
const RE = 6378.137;           // Earth equatorial radius, WGS84 (km)
const CD = 2.2;                // Standard satellite drag coefficient
const OMEGA_EARTH = 7.2921e-5; // Earth sidereal rotation rate (rad/s)

// Atmospheric Density Model (Exponential table: h (km), rho0 (kg/m³), H (km))
// Source: CIRA-72 / US Standard Atmosphere 1976
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
   * Drag uses relative wind velocity accounting for co-rotating atmosphere:
   *   v_rel = v_inertial - (ω_earth × r)
   *
   * @param {Object} pos - {x, y, z} in km (Three.js frame, Y=North)
   * @param {Object} vel - {vx, vy, vz} in km/s
   * @param {number} areaToMass - Area-to-mass ratio (m²/kg)
   * @returns {Object} {ax, ay, az} in km/s²
   */
  static getAcceleration(pos, vel, areaToMass = 0.01) {
    const r2 = pos.x * pos.x + pos.y * pos.y + pos.z * pos.z;
    const r = Math.sqrt(r2);
    const r3 = r2 * r;
    const r5 = r3 * r2;

    // 1. Central Two-body Gravity: a_grav = -μ/r³ · r
    let ax = -MU * pos.x / r3;
    let ay = -MU * pos.y / r3;
    let az = -MU * pos.z / r3;

    // 2. J2 Perturbation (Earth oblateness, Y = polar North in Three.js)
    const y2_r2 = (pos.y * pos.y) / r2;
    const j2Factor = (1.5 * J2 * MU * RE * RE) / r5;

    ax += j2Factor * pos.x * (5 * y2_r2 - 1);
    ay += j2Factor * pos.y * (5 * y2_r2 - 3);
    az += j2Factor * pos.z * (5 * y2_r2 - 1);

    // 3. Atmospheric Drag (altitude < 1000km) with co-rotating atmosphere
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
        // Compute relative wind velocity: v_rel = v - (ω × r)
        // In Three.js coords (Y=North), ω = (0, OMEGA_EARTH, 0)
        // ω × r = (ω_y * z, 0, -ω_y * x) → but need km/s: ω is rad/s, r is km
        const wxr_x =  OMEGA_EARTH * pos.z;  // ω_y * z
        const wxr_y =  0;                     // ω cross r has no Y component
        const wxr_z = -OMEGA_EARTH * pos.x;   // -ω_y * x

        const vrel_x = vel.vx - wxr_x;
        const vrel_y = vel.vy - wxr_y;
        const vrel_z = vel.vz - wxr_z;

        const vrel2 = vrel_x * vrel_x + vrel_y * vrel_y + vrel_z * vrel_z;
        const vrel = Math.sqrt(vrel2);

        // a_drag = -0.5 · ρ · |v_rel|² · (Cd·A/m) · v̂_rel
        // Unit conversion: ρ [kg/m³] → [kg/km³] (×1e9), A/m [m²/kg] → [km²/kg] (×1e-6)
        const dragCoeff = 0.5 * (rho * 1e9) * (CD * (areaToMass * 1e-6)) * vrel;

        ax -= dragCoeff * vrel_x;
        ay -= dragCoeff * vrel_y;
        az -= dragCoeff * vrel_z;
      }
    }

    return { ax, ay, az };
  }

  /**
   * Advances particle state by dt using Velocity Verlet (Symplectic 2nd-order)
   *
   * Algorithm:
   *   r_{n+1} = r_n + v_n·dt + ½·a_n·dt²
   *   a_{n+1} = f(r_{n+1}, v_n)
   *   v_{n+1} = v_n + ½·(a_n + a_{n+1})·dt
   *
   * @param {Object} particle - { position: {x,y,z}, velocity: {vx,vy,vz}, areaToMass }
   * @param {number} dtSec - Time step in seconds
   * @returns {boolean} True if particle reentered atmosphere (alt < 120km)
   */
  static step(particle, dtSec) {
    const pos = particle.position;
    const vel = particle.velocity;
    const am = particle.areaToMass || 0.01;

    // 1. Initial Acceleration a_n
    const a0 = this.getAcceleration(pos, vel, am);

    // 2. Position step: r_{n+1} = r_n + v_n·dt + ½·a_n·dt²
    pos.x += vel.vx * dtSec + 0.5 * a0.ax * dtSec * dtSec;
    pos.y += vel.vy * dtSec + 0.5 * a0.ay * dtSec * dtSec;
    pos.z += vel.vz * dtSec + 0.5 * a0.az * dtSec * dtSec;

    // Check Reentry Altitude (< 120km)
    const r = Math.sqrt(pos.x * pos.x + pos.y * pos.y + pos.z * pos.z);
    if (r - RE < 120) {
      return true; // Reentered / destroyed
    }

    // 3. Predictor velocity for velocity-dependent dissipative forces (atmospheric drag)
    const vPred = {
      vx: vel.vx + a0.ax * dtSec,
      vy: vel.vy + a0.ay * dtSec,
      vz: vel.vz + a0.az * dtSec
    };

    // New Acceleration a_{n+1} at updated position and predicted velocity
    const a1 = this.getAcceleration(pos, vPred, am);

    // 4. Velocity step: v_{n+1} = v_n + ½·(a_n + a_{n+1})·dt
    vel.vx += 0.5 * (a0.ax + a1.ax) * dtSec;
    vel.vy += 0.5 * (a0.ay + a1.ay) * dtSec;
    vel.vz += 0.5 * (a0.az + a1.az) * dtSec;

    return false;
  }
}
