/**
 * SpaceDebris — Kessler Syndrome Simulation Controller
 * Manages active physics particles, steps their orbits, detects collisions,
 * and triggers cascade breakup events with:
 *   - Multi-generation root-lineage deduplication (zero incestuous self-collisions)
 *   - Proximity-based hybrid real-time + sim-time cooldown (zero grid-boundary leaks)
 *   - Per-frame collision budget enforced across ALL substeps
 *   - Minimum relative-velocity gate (no co-orbital grazing false explosions)
 *   - Deferred spawn queue (zero array-shift index corruption at maxParticles cap)
 *   - Destroyed catalog satellite deduplication (a catalog satellite can never be hit twice)
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
    this.maxSubSteps = 50;   // Supports up to 86400x time warp
    this.maxStepDt = 30.0;   // Verlet integration is stable up to 30s for LEO

    // Anti-duplicate collision parameters
    this.minRelativeVelocityKmS = 0.5;   // Minimum 500 m/s relative speed for hypervelocity breakup
    this.cooldownRadiusKm = 150.0;       // Euclidean 3D exclusion sphere around recent collisions
    this.cooldownRealMs = 350;           // Real-time cooldown (ms)
    this.cooldownSimSec = 15.0;          // Simulation-time cooldown (sim seconds)

    this.simTimeSec = 0;
    this.substepCounter = 0;
    this.recentCollisions = [];          // [{ x, y, z, simTime, realTime }]
    this.destroyedSatelliteIds = new Set(); // Deduplicates catalog strikes

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
   * Resets all particles, cooldowns, destroyed-satellite ledger, and statistics
   */
  reset() {
    this.particles = [];
    this.spatialHash.clear();
    this.recentCollisions = [];
    this.destroyedSatelliteIds.clear();
    this.simTimeSec = 0;
    this.substepCounter = 0;
    this.stats.collisions = 0;
    this.stats.destroyedSatellites = 0;
    this.stats.totalFragments = 0;
  }

  /**
   * Creates a normalized particle object without mutating `this.particles` directly
   */
  _createParticle(particle, sourceId = null, generation = 0, rootSourceId = null) {
    const assignedSourceId = particle.sourceId || sourceId || `src_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    let assignedRootIds;
    if (particle.rootSourceIds) {
      assignedRootIds = Array.isArray(particle.rootSourceIds) ? particle.rootSourceIds : [particle.rootSourceIds];
    } else if (rootSourceId) {
      assignedRootIds = Array.isArray(rootSourceId) ? rootSourceId : [rootSourceId];
    } else {
      assignedRootIds = [assignedSourceId];
    }

    return {
      id: `p_${this.stats.totalFragments}_${Math.random().toString(36).slice(2, 6)}`,
      sourceId: assignedSourceId,
      rootSourceIds: assignedRootIds,
      generation: particle.generation !== undefined ? particle.generation : generation,
      position: { ...particle.position },
      velocity: { ...particle.velocity },
      mass: particle.mass ?? 20.0,
      size: particle.size ?? 0.2,
      areaToMass: particle.areaToMass ?? 0.02,
      category: particle.category || 'sim_debris',
      immuneTimer: particle.immuneTimer ?? 1.0,
      bornSubstep: this.substepCounter
    };
  }

  /**
   * Adds a single debris particle to the simulation (safe outside substep index loops)
   */
  addParticle(particle, sourceId = null, generation = 0, rootSourceId = null) {
    const p = this._createParticle(particle, sourceId, generation, rootSourceId);
    if (this.particles.length >= this.maxParticles) {
      this.particles.shift();
    }
    this.particles.push(p);
    this.stats.totalFragments++;
    return p;
  }

  /**
   * Triggers an explosion on an existing object or position.
   */
  triggerExplosion(position, velocity, targetMass = 500, fragmentCount = 50, energyScale = 1.0, rootId = null) {
    const cappedCount = Math.max(10, Math.min(Math.round(fragmentCount) || 50, 200));
    const explosionSourceId = rootId || `root_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    const parentObj = {
      mass: targetMass,
      position: { ...position },
      velocity: { ...velocity }
    };

    const newFrags = BreakupModel.explode(parentObj, 1e8 * energyScale, cappedCount, 'explosion');

    for (const f of newFrags) {
      f.immuneTimer = 2.0; // Initial expansion grace before external strikes
      this.addParticle(f, explosionSourceId, 1, explosionSourceId);
    }

    this.emit('explosion', { position, energyScale, count: newFrags.length });
    return newFrags.length;
  }

  /**
   * Checks whether a candidate collision position is inside the exclusion sphere
   * of any recent collision (using BOTH real-time and simulation-time windows).
   */
  _isInCollisionCooldown(pos, nowRealMs) {
    const rSq = this.cooldownRadiusKm * this.cooldownRadiusKm;
    for (let i = this.recentCollisions.length - 1; i >= 0; i--) {
      const rc = this.recentCollisions[i];
      const realExpired = (nowRealMs - rc.realTime) >= this.cooldownRealMs;
      const simExpired = (this.simTimeSec - rc.simTime) >= this.cooldownSimSec;
      if (realExpired && simExpired) {
        this.recentCollisions.splice(i, 1);
        continue;
      }
      const dx = pos.x - rc.x;
      const dy = pos.y - rc.y;
      const dz = pos.z - rc.z;
      if (dx * dx + dy * dy + dz * dz <= rSq) {
        return true;
      }
    }
    return false;
  }

  _recordCollisionCooldown(pos, nowRealMs) {
    this.recentCollisions.push({
      x: pos.x,
      y: pos.y,
      z: pos.z,
      simTime: this.simTimeSec,
      realTime: nowRealMs
    });
    if (this.recentCollisions.length > 100) {
      this.recentCollisions.splice(0, this.recentCollisions.length - 100);
    }
  }

  _sharesRootLineage(pA, pB) {
    const rootsA = pA.rootSourceIds;
    const rootsB = pB.rootSourceIds;
    if (!rootsA || !rootsB) return false;
    for (let i = 0; i < rootsA.length; i++) {
      if (rootsB.includes(rootsA[i])) return true;
    }
    return false;
  }

  _relativeSpeedSq(vA, vB) {
    const dvx = vA.vx - vB.vx;
    const dvy = vA.vy - vB.vy;
    const dvz = vA.vz - vB.vz;
    return dvx * dvx + dvy * dvy + dvz * dvz;
  }

  /**
   * Steps all particles forward in time by dtSec.
   * Enforces maxCollisionsPerFrame across ALL substeps in this frame.
   */
  step(dtSec, catalogCollisionCheckFn = null) {
    if (!Number.isFinite(dtSec) || dtSec <= 0) {
      return {
        count: this.particles.length,
        collisions: this.stats.collisions,
        destroyedSatellites: this.stats.destroyedSatellites
      };
    }

    const totalDt = Math.min(dtSec, this.maxSubSteps * this.maxStepDt);
    const numSubSteps = Math.max(1, Math.ceil(totalDt / this.maxStepDt));
    const subDt = totalDt / numSubSteps;

    // Shared collision budget across all substeps in this animation frame
    const frameBudget = { count: 0 };

    for (let s = 0; s < numSubSteps; s++) {
      this.substepCounter++;
      this._substep(subDt, catalogCollisionCheckFn, frameBudget);
    }

    return {
      count: this.particles.length,
      collisions: this.stats.collisions,
      destroyedSatellites: this.stats.destroyedSatellites
    };
  }

  _substep(dtSec, catalogCollisionCheckFn, frameBudget) {
    this.simTimeSec += dtSec;
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

    // Skip collision checks completely if frame collision budget is already exhausted
    if (frameBudget.count >= this.maxCollisionsPerFrame) {
      return;
    }

    const toRemove = new Set();
    const spawnQueue = [];
    const minRelSpeedSq = this.minRelativeVelocityKmS * this.minRelativeVelocityKmS;
    // Immunity lasts at least 12 sim seconds AND > 1 full substep so newly spawned clouds disperse first
    const spawnImmunitySec = Math.max(12.0, dtSec * 1.5);

    // ─────────────────────────────────────────────────────────────
    // 2. PRIORITIZED: Particle-to-Catalog-Satellite Collision Check
    // ─────────────────────────────────────────────────────────────
    if (catalogCollisionCheckFn) {
      for (let i = 0; i < this.particles.length; i++) {
        if (frameBudget.count >= this.maxCollisionsPerFrame) break;
        if (toRemove.has(i)) continue;

        const p = this.particles[i];
        if (!p || p.immuneTimer > 0 || p.bornSubstep === this.substepCounter) continue;

        if (this._isInCollisionCooldown(p.position, nowTime)) continue;

        // Query real satellite within 45km
        const struckSatellite = catalogCollisionCheckFn(p.position, 45.0);
        if (!struckSatellite) continue;

        // Deduplicate catalog strikes: a satellite can NEVER be destroyed twice
        const satUniqueKey = struckSatellite.NORAD_CAT_ID != null
          ? `norad_${struckSatellite.NORAD_CAT_ID}`
          : `idx_${struckSatellite.index}`;
        if (this.destroyedSatelliteIds.has(satUniqueKey)) continue;

        // Use real orbital velocity of the struck satellite
        const satVel = struckSatellite.velocity || {
          vx: -p.velocity.vx * 0.7,
          vy: p.velocity.vy * 0.7,
          vz: -p.velocity.vz * 0.7
        };

        // Require genuine hypervelocity relative speed
        if (this._relativeSpeedSq(p.velocity, satVel) < minRelSpeedSq) continue;

        this.destroyedSatelliteIds.add(satUniqueKey);
        toRemove.add(i);

        const struckRootId = `root_sat_${struckSatellite.NORAD_CAT_ID || struckSatellite.index}`;
        const targetMass = struckSatellite.rcsSize === 'LARGE' ? 1800 : (struckSatellite.rcsSize === 'MEDIUM' ? 500 : 120);

        const satObj = {
          mass: targetMass,
          position: { ...p.position },
          velocity: satVel
        };

        // Inherit BOTH projectile lineage and struck satellite lineage (up to 12 ancestors)
        const combinedRoots = Array.from(new Set([...(p.rootSourceIds || []), struckRootId])).slice(0, 12);
        const frags = BreakupModel.collide(p, satObj, 24);
        const nextGen = (p.generation || 1) + 1;

        for (const f of frags) {
          f.immuneTimer = spawnImmunitySec;
          spawnQueue.push(this._createParticle(f, struckRootId, nextGen, combinedRoots));
        }

        this.stats.collisions++;
        this.stats.destroyedSatellites++;
        this._recordCollisionCooldown(p.position, nowTime);
        frameBudget.count++;

        this.emit('collision', {
          position: { ...p.position },
          objA: p,
          objB: struckSatellite,
          satelliteIndex: struckSatellite.index,
          satelliteName: struckSatellite.name || struckSatellite.OBJECT_NAME || `NORAD ${struckSatellite.NORAD_CAT_ID}`,
          newFragments: frags.length,
          totalCollisions: this.stats.collisions,
          destroyedSatellites: this.stats.destroyedSatellites
        });
      }
    }

    // ─────────────────────────────────────────────────────────────
    // 3. Multi-Source Inter-Debris Collision Detection (Swept + Backward CPA)
    // ─────────────────────────────────────────────────────────────
    if (frameBudget.count < this.maxCollisionsPerFrame && this.particles.length >= 2) {
      this.spatialHash.clear();
      for (let i = 0; i < this.particles.length; i++) {
        const p = this.particles[i];
        if (!toRemove.has(i) && p.immuneTimer <= 0 && p.bornSubstep !== this.substepCounter) {
          this.spatialHash.insertSwept(i, p.position, p.velocity, dtSec);
        }
      }

      const positions = this.particles.map(p => p.position);
      const velocities = this.particles.map(p => p.velocity);
      const collisions = this.spatialHash.findCollisions(positions, 36.0, velocities, dtSec);

      for (let c = 0; c < collisions.length; c++) {
        if (frameBudget.count >= this.maxCollisionsPerFrame) break;
        const [idxA, idxB] = collisions[c];
        if (toRemove.has(idxA) || toRemove.has(idxB)) continue;

        const pA = this.particles[idxA];
        const pB = this.particles[idxB];
        if (!pA || !pB) continue;

        // CRITICAL RULE 1: ROOT-SIBLING SKIP (never collide if sharing ANY common ancestor)
        if (this._sharesRootLineage(pA, pB)) continue;

        // CRITICAL RULE 2: HYPERVELOCITY RELATIVE SPEED GATE (no low-speed grazing self-explosions)
        if (this._relativeSpeedSq(pA.velocity, pB.velocity) < minRelSpeedSq) continue;

        // CRITICAL RULE 3: PROXIMITY HYBRID COOLDOWN (both real-time and sim-time, zero grid-edge leaks)
        if (this._isInCollisionCooldown(pA.position, nowTime)) continue;

        // Generation Cap: Up to 10 cascade generations
        const genA = pA.generation || 1;
        const genB = pB.generation || 1;
        if (genA > 10 || genB > 10) continue;

        toRemove.add(idxA);
        toRemove.add(idxB);

        const combinedRoots = Array.from(new Set([...(pA.rootSourceIds || []), ...(pB.rootSourceIds || [])])).slice(0, 12);
        const nextGen = Math.max(genA, genB) + 1;
        const frags = BreakupModel.collide(pA, pB, 18);

        for (const f of frags) {
          f.immuneTimer = spawnImmunitySec;
          spawnQueue.push(this._createParticle(f, null, nextGen, combinedRoots));
        }

        this.stats.collisions++;
        this._recordCollisionCooldown(pA.position, nowTime);
        frameBudget.count++;

        this.emit('collision', {
          position: { ...pA.position },
          objA: pA,
          objB: pB,
          newFragments: frags.length,
          totalCollisions: this.stats.collisions
        });
      }
    }

    // ─────────────────────────────────────────────────────────────
    // 4. Remove collided parent particles FIRST, then flush spawnQueue cleanly
    //    (Guarantees ZERO index shifting corruption!)
    // ─────────────────────────────────────────────────────────────
    if (toRemove.size > 0) {
      const removeSorted = Array.from(toRemove).sort((a, b) => b - a);
      for (let i = 0; i < removeSorted.length; i++) {
        const idx = removeSorted[i];
        if (idx < this.particles.length) {
          this.particles.splice(idx, 1);
        }
      }
    }

    if (spawnQueue.length > 0) {
      for (let i = 0; i < spawnQueue.length; i++) {
        this.particles.push(spawnQueue[i]);
        this.stats.totalFragments++;
      }
      if (this.particles.length > this.maxParticles) {
        this.particles.splice(0, this.particles.length - this.maxParticles);
      }
    }
  }

  getParticles() {
    return this.particles;
  }
}
