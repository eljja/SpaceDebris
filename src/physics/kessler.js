/**
 * SpaceDebris — Kessler Syndrome Simulation Controller
 * Manages active physics particles, steps their orbits, detects collisions,
 * and triggers cascade breakup events with smart root-lineage filtering and catalog-priority detection.
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
    this.maxParticles = 2500;
    this.maxCollisionsPerFrame = 3;
    this.maxSubSteps = 50;   // Increased to support up to 86400x time warp
    this.maxStepDt = 30.0;   // Verlet integration is stable up to 30s for LEO

    // Sector cooldowns to prevent localized re-explosion storms
    this.sectorCooldowns = new Map();
    this.lastCollisionTime = 0;
    this.minCollisionIntervalMs = 40;

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
   * Resets all particles, cooldowns and statistics
   */
  reset() {
    this.particles = [];
    this.sectorCooldowns.clear();
    this.stats.collisions = 0;
    this.stats.destroyedSatellites = 0;
    this.stats.totalFragments = 0;
  }

  /**
   * Adds a single debris particle to the simulation
   */
  addParticle(particle, sourceId = null, generation = 0, rootSourceId = null) {
    if (this.particles.length >= this.maxParticles) {
      this.particles.shift();
    }

    const assignedSourceId = particle.sourceId || sourceId || `src_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
    
    let assignedRootIds = [];
    if (particle.rootSourceIds) {
      assignedRootIds = particle.rootSourceIds;
    } else if (rootSourceId) {
      assignedRootIds = Array.isArray(rootSourceId) ? rootSourceId : [rootSourceId];
    } else {
      assignedRootIds = [assignedSourceId];
    }

    const p = {
      id: `p_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      sourceId: assignedSourceId,
      rootSourceIds: assignedRootIds, // Array of ancestor root IDs to prevent incestuous cascades
      generation: particle.generation !== undefined ? particle.generation : generation,
      position: { ...particle.position },
      velocity: { ...particle.velocity },
      mass: particle.mass ?? 20.0,
      size: particle.size ?? 0.2,
      areaToMass: particle.areaToMass ?? 0.02,
      category: particle.category || 'sim_debris',
      immuneTimer: particle.immuneTimer ?? 1.0
    };

    this.particles.push(p);
    this.stats.totalFragments++;
    return p;
  }

  /**
   * Triggers an explosion on an existing object or position.
   */
  triggerExplosion(position, velocity, targetMass = 500, fragmentCount = 50, energyScale = 1.0, rootId = null) {
    const cappedCount = Math.min(fragmentCount, 150);
    const explosionSourceId = rootId || `root_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;

    const parentObj = {
      mass: targetMass,
      position: { ...position },
      velocity: { ...velocity }
    };

    const newFrags = BreakupModel.explode(parentObj, 1e8 * energyScale, cappedCount, 'explosion');

    for (const f of newFrags) {
      f.immuneTimer = 1.0; // 1.0s expansion before hitting other objects
      this.addParticle(f, explosionSourceId, 1, explosionSourceId);
    }

    this.emit('explosion', { position, energyScale, count: newFrags.length });
    return newFrags.length;
  }

  /**
   * Steps all particles forward in time by dtSec.
   * Checks collisions among particles AND against catalog satellites.
   */
  step(dtSec, catalogCollisionCheckFn = null) {
    const totalDt = Math.min(dtSec, this.maxSubSteps * this.maxStepDt);
    const numSubSteps = Math.ceil(totalDt / this.maxStepDt);
    const subDt = totalDt / numSubSteps;

    // Clean up expired sector cooldowns periodically
    const nowTime = performance.now();
    if (this.sectorCooldowns.size > 200) {
      for (const [key, expires] of this.sectorCooldowns.entries()) {
        if (expires < nowTime) this.sectorCooldowns.delete(key);
      }
    }

    for (let s = 0; s < numSubSteps; s++) {
      this._substep(subDt, catalogCollisionCheckFn);
    }

    return {
      count: this.particles.length,
      collisions: this.stats.collisions,
      destroyedSatellites: this.stats.destroyedSatellites
    };
  }

  _getSectorKey(pos) {
    // 120 km sector grid
    const sx = Math.floor(pos.x / 120.0);
    const sy = Math.floor(pos.y / 120.0);
    const sz = Math.floor(pos.z / 120.0);
    return `${sx},${sy},${sz}`;
  }

  _substep(dtSec, catalogCollisionCheckFn) {
    const reenteredIndices = [];
    const nowTime = performance.now();

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

    const toRemove = new Set();
    let processedCount = 0;

    // ─────────────────────────────────────────────────────────────
    // 2. PRIORITIZED: Particle-to-Catalog-Satellite Collision Check
    // ─────────────────────────────────────────────────────────────
    if (catalogCollisionCheckFn) {
      for (let i = 0; i < this.particles.length; i++) {
        if (processedCount >= this.maxCollisionsPerFrame) break;
        if (toRemove.has(i)) continue;

        const p = this.particles[i];
        if (!p || p.immuneTimer > 0) continue;

        const sectorKey = this._getSectorKey(p.position);
        if (this.sectorCooldowns.get(sectorKey) > nowTime) continue;

        // Query real satellite in matching altitude shell within 45km
        const struckSatellite = catalogCollisionCheckFn(p.position, 45.0);
        if (struckSatellite) {
          toRemove.add(i);

          const struckRootId = `root_sat_${struckSatellite.NORAD_CAT_ID || struckSatellite.index}_${Date.now()}`;
          const targetMass = struckSatellite.rcsSize === 'LARGE' ? 1800 : (struckSatellite.rcsSize === 'MEDIUM' ? 500 : 120);

          // Use real orbital velocity of the struck satellite
          const satVel = struckSatellite.velocity || {
            vx: -p.velocity.vx * 0.7,
            vy: p.velocity.vy * 0.7,
            vz: -p.velocity.vz * 0.7
          };

          const satObj = {
            mass: targetMass,
            position: { ...p.position },
            velocity: satVel
          };

          // Generate hypervelocity collision breakup fragments
          const combinedRoots = Array.from(new Set([...(p.rootSourceIds || []), struckRootId])).slice(0, 5);
          const frags = BreakupModel.collide(p, satObj, 24);
          
          for (const f of frags) {
            f.immuneTimer = 0.8;
            // The newly created fragments inherit BOTH lineages
            this.addParticle(f, struckRootId, (p.generation || 1) + 1, combinedRoots);
          }

          this.stats.collisions++;
          this.stats.destroyedSatellites++;
          this.lastCollisionTime = nowTime;
          this.sectorCooldowns.set(sectorKey, nowTime + 300);

          this.emit('collision', {
            position: p.position,
            objA: p,
            objB: struckSatellite,
            satelliteIndex: struckSatellite.index,
            satelliteName: struckSatellite.name || struckSatellite.OBJECT_NAME || `NORAD ${struckSatellite.NORAD_CAT_ID}`,
            newFragments: frags.length,
            totalCollisions: this.stats.collisions,
            destroyedSatellites: this.stats.destroyedSatellites
          });

          processedCount++;
        }
      }
    }

    // ─────────────────────────────────────────────────────────────
    // 3. Multi-Source Inter-Debris Collision Detection (with CPA)
    // ─────────────────────────────────────────────────────────────
    this.spatialHash.clear();
    for (let i = 0; i < this.particles.length; i++) {
      if (!toRemove.has(i) && this.particles[i].immuneTimer <= 0) {
        this.spatialHash.insert(i, this.particles[i].position);
      }
    }

    const positions = this.particles.map(p => p.position);
    const velocities = this.particles.map(p => p.velocity);
    const collisions = this.spatialHash.findCollisions(positions, 36.0, velocities, dtSec);

    if (collisions.length > 0) {
      for (const [idxA, idxB] of collisions) {
        if (processedCount >= this.maxCollisionsPerFrame) break;
        if (toRemove.has(idxA) || toRemove.has(idxB)) continue;

        const pA = this.particles[idxA];
        const pB = this.particles[idxB];
        if (!pA || !pB) continue;

        // CRITICAL RULE: ROOT-SIBLING SKIP
        // Fragments derived from ANY common original parent satellite NEVER collide!
        let sharesRoot = false;
        if (pA.rootSourceIds && pB.rootSourceIds) {
          for (const rA of pA.rootSourceIds) {
            if (pB.rootSourceIds.includes(rA)) {
              sharesRoot = true;
              break;
            }
          }
        }
        if (sharesRoot) {
          continue;
        }

        // Sector Cooldown: Max 1 collision per 120km sector every 300ms
        const sectorKey = this._getSectorKey(pA.position);
        if (this.sectorCooldowns.get(sectorKey) > nowTime) {
          continue;
        }

        // Generation Cap: Up to 10 cascade generations
        const genA = pA.generation || 1;
        const genB = pB.generation || 1;
        if (genA > 10 || genB > 10) continue;

        toRemove.add(idxA);
        toRemove.add(idxB);

        // Merge root lineages (limit to 5 to prevent unbounded growth)
        const combinedRoots = Array.from(new Set([...(pA.rootSourceIds || []), ...(pB.rootSourceIds || [])])).slice(0, 5);
        const nextGen = Math.max(genA, genB) + 1;
        const frags = BreakupModel.collide(pA, pB, 18);

        for (const f of frags) {
          f.immuneTimer = 0.8;
          this.addParticle(f, null, nextGen, combinedRoots);
        }

        this.stats.collisions++;
        this.lastCollisionTime = nowTime;
        this.sectorCooldowns.set(sectorKey, nowTime + 300);

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

    // ─────────────────────────────────────────────────────────────
    // 4. Remove collided parent particles
    // ─────────────────────────────────────────────────────────────
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
