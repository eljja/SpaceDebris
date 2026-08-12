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
    this.spatialHash = new SpatialHashGrid(60.0); // 60 km cell grid
    this.eventListeners = {
      explosion: [],
      reentry: [],
      collision: []
    };
    this.maxParticles = 5000;
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
   * @param {Object} particle - { position: {x,y,z}, velocity: {vx,vy,vz}, mass, size, areaToMass, category }
   */
  addParticle(particle) {
    if (this.particles.length >= this.maxParticles) {
      this.particles.shift(); // Evict oldest if max limit reached
    }

    const p = {
      id: `p_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      position: { ...particle.position },
      velocity: { ...particle.velocity },
      mass: particle.mass || 20.0,
      size: particle.size || 0.2,
      areaToMass: particle.areaToMass || 0.02,
      category: particle.category || 'sim_debris'
    };

    this.particles.push(p);
    return p;
  }

  /**
   * Triggers an explosion on an existing object or position
   */
  triggerExplosion(position, velocity, mass = 500, energyScale = 1.0) {
    const parentObj = {
      mass,
      position: { ...position },
      velocity: { ...velocity }
    };

    const newFrags = BreakupModel.explode(parentObj, 1e8 * energyScale, 150);

    for (const f of newFrags) {
      this.addParticle(f);
    }

    this.emit('explosion', { position, energyScale, count: newFrags.length });
    return newFrags.length;
  }

  /**
   * Steps all particles forward in time by dtSec
   * @param {number} dtSec - Time step in seconds
   * @returns {Object} { particles, events }
   */
  step(dtSec) {
    const reenteredIndices = [];
    const positions = [];

    // 1. Orbit Propagation & Reentry check
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      const reentered = PhysicsPropagator.step(p, dtSec);
      if (reentered) {
        reenteredIndices.push(i);
        this.emit('reentry', { position: p.position, velocity: p.velocity });
      } else {
        positions.push(p.position);
      }
    }

    // Remove reentered particles (reverse order to preserve indices)
    for (let i = reenteredIndices.length - 1; i >= 0; i--) {
      this.particles.splice(reenteredIndices[i], 1);
    }

    // 2. Collision Detection via Spatial Hash Grid
    this.spatialHash.clear();
    for (let i = 0; i < this.particles.length; i++) {
      this.spatialHash.insert(i, this.particles[i].position);
    }

    const collisions = this.spatialHash.findCollisions(
      this.particles.map(p => p.position),
      8.0 // 8 km collision threshold
    );

    // 3. Process Collisions & Cascades
    if (collisions.length > 0) {
      const toRemove = new Set();
      for (const [idxA, idxB] of collisions) {
        if (toRemove.has(idxA) || toRemove.has(idxB)) continue;

        const pA = this.particles[idxA];
        const pB = this.particles[idxB];

        if (pA && pB) {
          toRemove.add(idxA);
          toRemove.add(idxB);

          const frags = BreakupModel.collide(pA, pB, 80);
          for (const f of frags) {
            this.addParticle(f);
          }

          this.emit('collision', {
            position: pA.position,
            objA: pA,
            objB: pB,
            newFragments: frags.length
          });
        }
      }

      // Remove collided parent particles
      const removeSorted = Array.from(toRemove).sort((a, b) => b - a);
      for (const idx of removeSorted) {
        this.particles.splice(idx, 1);
      }
    }

    return {
      count: this.particles.length,
      collisions: collisions.length
    };
  }

  getParticles() {
    return this.particles;
  }
}
