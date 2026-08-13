/**
 * SpaceDebris — Kessler Syndrome Simulation Controller
 * Manages active physics particles, steps their orbits, detects collisions,
 * and triggers cascade breakup events.
 *
 * PERFORMANCE SAFEGUARDS:
 * - New fragments get a collision immunity timer (0.5s) so freshly exploded
 *   debris clouds don't instantly re-collide with each other in the same cell.
 * - Maximum collisions processed per frame is capped at 3.
 * - Step time is sub-stepped to prevent instability at high time warp.
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
    this.maxParticles = 2000; // Reduced from 5000 for performance
    this.maxCollisionsPerFrame = 3;
    this.maxSubSteps = 4;
    this.maxStepDt = 2.0; // Max 2 seconds per sub-step
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
      mass: particle.mass || 20.0,
      size: particle.size || 0.2,
      areaToMass: particle.areaToMass || 0.02,
      category: particle.category || 'sim_debris',
      immuneTimer: particle.immuneTimer || 0 // seconds of collision immunity
    };

    this.particles.push(p);
    return p;
  }

  /**
   * Triggers an explosion on an existing object or position.
   * Fragments are given a collision immunity timer so they don't
   * instantly re-collide with each other.
   */
  triggerExplosion(position, velocity, targetMass = 500, fragmentCount = 50, energyScale = 1.0) {
    // Cap fragment count to prevent performance issues
    const cappedCount = Math.min(fragmentCount, 200);

    const parentObj = {
      mass: targetMass,
      position: { ...position },
      velocity: { ...velocity }
    };

    const newFrags = BreakupModel.explode(parentObj, 1e8 * energyScale, cappedCount);

    for (const f of newFrags) {
      f.immuneTimer = 2.0; // 2 seconds of collision immunity
      this.addParticle(f);
    }

    this.emit('explosion', { position, energyScale, count: newFrags.length });
    return newFrags.length;
  }

  /**
   * Steps all particles forward in time by dtSec.
   * Uses sub-stepping for stability and caps collision processing per frame.
   */
  step(dtSec) {
    // Clamp total step time
    const totalDt = Math.min(dtSec, this.maxSubSteps * this.maxStepDt);
    
    // Determine sub-steps
    const numSubSteps = Math.ceil(totalDt / this.maxStepDt);
    const subDt = totalDt / numSubSteps;

    for (let s = 0; s < numSubSteps; s++) {
      this._substep(subDt);
    }

    return {
      count: this.particles.length,
      collisions: 0
    };
  }

  _substep(dtSec) {
    const reenteredIndices = [];

    // 1. Tick immunity timers and propagate orbits
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];

      // Decrease immunity timer
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

    // 2. Collision Detection (only among non-immune particles)
    this.spatialHash.clear();
    for (let i = 0; i < this.particles.length; i++) {
      // Only insert particles that are NOT immune
      if (this.particles[i].immuneTimer <= 0) {
        this.spatialHash.insert(i, this.particles[i].position);
      }
    }

    const positions = this.particles.map(p => p.position);
    const collisions = this.spatialHash.findCollisions(positions, 8.0);

    // 3. Process Collisions — CAPPED per frame to prevent cascade freeze
    if (collisions.length > 0) {
      const toRemove = new Set();
      let processedCount = 0;

      for (const [idxA, idxB] of collisions) {
        if (processedCount >= this.maxCollisionsPerFrame) break;
        if (toRemove.has(idxA) || toRemove.has(idxB)) continue;

        const pA = this.particles[idxA];
        const pB = this.particles[idxB];

        if (pA && pB) {
          toRemove.add(idxA);
          toRemove.add(idxB);

          // Cap cascade fragments — much lower than explosion
          const frags = BreakupModel.collide(pA, pB, 30);
          for (const f of frags) {
            f.immuneTimer = 2.0; // Immunity for cascade fragments too
            this.addParticle(f);
          }

          this.emit('collision', {
            position: pA.position,
            objA: pA,
            objB: pB,
            newFragments: frags.length
          });

          processedCount++;
        }
      }

      // Remove collided parents
      const removeSorted = Array.from(toRemove).sort((a, b) => b - a);
      for (const idx of removeSorted) {
        this.particles.splice(idx, 1);
      }
    }
  }

  getParticles() {
    return this.particles;
  }
}
