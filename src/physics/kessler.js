/**
 * SpaceDebris — Kessler Syndrome Simulation Controller
 * Manages active physics particles, steps their orbits, detects collisions,
 * and triggers cascade breakup events.
 */

import { PhysicsPropagator } from './propagator.js';
import { BreakupModel } from './breakup.js';
import { SpatialHashGrid } from './collision.js';

export class KesslerSimulator {
  constructor() {
    this.particles = [];
    this.spatialHash = new SpatialHashGrid(60.0);
    this.eventListeners = {
      explosion: [],
      reentry: [],
      collision: []
    };
    this.maxParticles = 2000;
    this.maxCollisionsPerFrame = 4;
    this.maxSubSteps = 4;
    this.maxStepDt = 2.0; // Max 2 seconds per sub-step

    this.stats = {
      collisions: 0,
      destroyedSatellites: 0,
      totalFragments: 0
    };
  }

  on(event, callback) {
    if (this.eventListeners[event]) {
      this.eventListeners[event].push(callback);
    }
  }

  emit(event, data) {
    if (this.eventListeners[event]) {
      for (const cb of this.eventListeners[event]) cb(data);
    }
  }

  /**
   * Resets all particles and statistics
   */
  reset() {
    this.particles = [];
    this.stats.collisions = 0;
    this.stats.destroyedSatellites = 0;
    this.stats.totalFragments = 0;
  }

  /**
   * Adds a single debris particle to the simulation
   */
  addParticle(particle) {
    if (this.particles.length >= this.maxParticles) {
      this.particles.shift();
    }

    const p = {
      id: `p_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      position: { ...particle.position },
      velocity: { ...particle.velocity },
      mass: particle.mass ?? 20.0,
      size: particle.size ?? 0.2,
      areaToMass: particle.areaToMass ?? 0.02,
      category: particle.category || 'sim_debris',
      immuneTimer: particle.immuneTimer || 0 // seconds of collision immunity
    };

    this.particles.push(p);
    this.stats.totalFragments++;
    return p;
  }

  /**
   * Triggers an explosion on an existing object or position.
   */
  triggerExplosion(position, velocity, targetMass = 500, fragmentCount = 50, energyScale = 1.0) {
    const cappedCount = Math.min(fragmentCount, 200);

    const parentObj = {
      mass: targetMass,
      position: { ...position },
      velocity: { ...velocity }
    };

    const newFrags = BreakupModel.explode(parentObj, 1e8 * energyScale, cappedCount);

    for (const f of newFrags) {
      f.immuneTimer = 0.8; // 0.8s immunity allows brief expansion before colliding
      this.addParticle(f);
    }

    this.emit('explosion', { position, energyScale, count: newFrags.length });
    return newFrags.length;
  }

  /**
   * Steps all particles forward in time by dtSec.
   * Checks collisions among particles AND against catalog satellites.
   * @param {number} dtSec
   * @param {Function} catalogCollisionCheckFn - Optional (particle) => nearbySatellite
   */
  step(dtSec, catalogCollisionCheckFn = null) {
    const totalDt = Math.min(dtSec, this.maxSubSteps * this.maxStepDt);
    const numSubSteps = Math.ceil(totalDt / this.maxStepDt);
    const subDt = totalDt / numSubSteps;

    for (let s = 0; s < numSubSteps; s++) {
      this._substep(subDt, catalogCollisionCheckFn);
    }

    return {
      count: this.particles.length,
      collisions: this.stats.collisions,
      destroyedSatellites: this.stats.destroyedSatellites
    };
  }

  _substep(dtSec, catalogCollisionCheckFn) {
    const reenteredIndices = [];

    // 1. Tick immunity timers and propagate orbits
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];

      if (p.immuneTimer > 0) {
        p.immuneTimer -= dtSec;
      }

      const reentered = PhysicsPropagator.step(p, dtSec);
      if (reentered) {
        reenteredIndices.push(i);
        this.emit('reentry', { position: p.position, velocity: p.velocity });
      }
    }

    // Remove reentered (reverse order)
    for (let i = reenteredIndices.length - 1; i >= 0; i--) {
      this.particles.splice(reenteredIndices[i], 1);
    }

    // 2. Collision Detection among Simulation Particles
    this.spatialHash.clear();
    for (let i = 0; i < this.particles.length; i++) {
      if (this.particles[i].immuneTimer <= 0) {
        this.spatialHash.insert(i, this.particles[i].position);
      }
    }

    const positions = this.particles.map(p => p.position);
    const collisions = this.spatialHash.findCollisions(positions, 28.0);

    // 3. Process Particle-to-Particle Collisions
    const toRemove = new Set();
    let processedCount = 0;

    if (collisions.length > 0) {
      for (const [idxA, idxB] of collisions) {
        if (processedCount >= this.maxCollisionsPerFrame) break;
        if (toRemove.has(idxA) || toRemove.has(idxB)) continue;

        const pA = this.particles[idxA];
        const pB = this.particles[idxB];

        if (pA && pB) {
          toRemove.add(idxA);
          toRemove.add(idxB);

          const frags = BreakupModel.collide(pA, pB, 24);
          for (const f of frags) {
            f.immuneTimer = 0.8;
            this.addParticle(f);
          }

          this.stats.collisions++;

          this.emit('collision', {
            position: pA.position,
            objA: pA,
            objB: pB,
            newFragments: frags.length,
            totalCollisions: this.stats.collisions
          });

          processedCount++;
        }
      }
    }

    // 4. Process Particle-to-Catalog-Satellite Collisions
    if (catalogCollisionCheckFn && processedCount < this.maxCollisionsPerFrame) {
      for (let i = 0; i < this.particles.length; i++) {
        if (processedCount >= this.maxCollisionsPerFrame) break;
        if (toRemove.has(i)) continue;

        const p = this.particles[i];
        if (!p || p.immuneTimer > 0) continue;

        const struckSatellite = catalogCollisionCheckFn(p.position, 32.0);
        if (struckSatellite) {
          toRemove.add(i);

          const targetMass = struckSatellite.rcsSize === 'LARGE' ? 2000 : (struckSatellite.rcsSize === 'MEDIUM' ? 600 : 150);
          const satObj = {
            mass: targetMass,
            position: { ...p.position },
            velocity: struckSatellite.velocity || { vx: -p.velocity.vx * 0.8, vy: p.velocity.vy * 0.8, vz: -p.velocity.vz * 0.8 }
          };

          const frags = BreakupModel.collide(p, satObj, 28);
          for (const f of frags) {
            f.immuneTimer = 0.8;
            this.addParticle(f);
          }

          this.stats.collisions++;
          this.stats.destroyedSatellites++;

          this.emit('collision', {
            position: p.position,
            objA: p,
            objB: struckSatellite,
            satelliteName: struckSatellite.name || struckSatellite.OBJECT_NAME || `NORAD ${struckSatellite.NORAD_CAT_ID}`,
            newFragments: frags.length,
            totalCollisions: this.stats.collisions,
            destroyedSatellites: this.stats.destroyedSatellites
          });

          processedCount++;
        }
      }
    }

    // Remove collided parent particles
    if (toRemove.size > 0) {
      const removeSorted = Array.from(toRemove).sort((a, b) => b - a);
      for (const idx of removeSorted) {
        if (idx < this.particles.length) {
          this.particles.splice(idx, 1);
        }
      }
    }
  }

  getParticles() {
    return this.particles;
  }
}
