/**
 * SpaceDebris Comprehensive Verification & Regression Test Suite
 * Covers: DB/DataLoader, LOD filtering, Orbital Prediction & TLE formatting,
 * Physics Propagator, Breakup Model, Swept SpatialHashGrid, and Kessler Anti-Duplicate Collision.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { DataLoader } from '../src/data-loader.js';
import { LODController } from '../src/lod.js';
import { PhysicsPropagator } from '../src/physics/propagator.js';
import { BreakupModel } from '../src/physics/breakup.js';
import { SpatialHashGrid } from '../src/physics/collision.js';
import { KesslerSimulator } from '../src/physics/kessler.js';

// =========================================================================
// 1. DB / DataLoader Tests
// =========================================================================
test('DataLoader populates numeric apo/peri for real GP satellites from SATCAT or orbital elements', () => {
  const loader = new DataLoader();
  const gpActive = [
    {
      NORAD_CAT_ID: 25544,
      OBJECT_NAME: 'ISS (ZARYA)',
      EPOCH: '2026-09-01T00:00:00.000000',
      MEAN_MOTION: 15.495,
      ECCENTRICITY: 0.0005,
      INCLINATION: 51.64,
      RA_OF_ASC_NODE: 100,
      ARG_OF_PERICENTER: 50,
      MEAN_ANOMALY: 10
    },
    {
      NORAD_CAT_ID: 26824,
      OBJECT_NAME: 'INTELSAT 901',
      EPOCH: '2026-09-01T00:00:00.000000',
      MEAN_MOTION: 1.0027,
      ECCENTRICITY: 0.0002,
      INCLINATION: 1.4,
      RA_OF_ASC_NODE: 10,
      ARG_OF_PERICENTER: 20,
      MEAN_ANOMALY: 30
    }
  ];
  const satcat = {
    '25544': { name: 'ISS (ZARYA)', type: 'PAY', ops: '+', owner: 'ISS', rcs: 'LARGE', apo: '422', peri: '418', decayDate: '' },
    '26824': { name: 'INTELSAT 901', type: 'PAY', ops: '+', owner: 'ITSO', rcs: 'LARGE', apo: '', peri: '', decayDate: '' }
  };

  loader.metadata = { lastUpdated: '2026-09-01T03:49:56.000000+00:00' };
  loader.processData(gpActive, [], satcat);

  const iss = loader.getByNoradId(25544);
  const geo = loader.getByNoradId(26824);

  // ISS should have real apo/peri (~422 / 418), NOT undefined (which previously defaulted to 600/500!)
  assert.equal(typeof iss.apo, 'number', 'ISS apo must be a number');
  assert.equal(typeof iss.peri, 'number', 'ISS peri must be a number');
  assert.ok(iss.apo >= 410 && iss.apo <= 430, `Expected ISS apo ~422, got ${iss.apo}`);
  assert.ok(iss.peri >= 410 && iss.peri <= 430, `Expected ISS peri ~418, got ${iss.peri}`);

  // GEO satellite without SATCAT apo/peri must compute ~35786 km from MEAN_MOTION + ECCENTRICITY
  assert.equal(typeof geo.apo, 'number', 'GEO apo must be derived when SATCAT apo is blank');
  assert.ok(geo.apo > 35000 && geo.apo < 36500, `Expected GEO apo ~35786, got ${geo.apo}`);
  assert.ok(geo.peri > 35000 && geo.peri < 36500, `Expected GEO peri ~35786, got ${geo.peri}`);
});

test('DataLoader uses metadata.lastUpdated for synthesized SATCAT objects and provides O(1) index lookup + ranked search', () => {
  const loader = new DataLoader();
  loader.metadata = { lastUpdated: '2026-11-01T00:00:00.000000+00:00' };
  const satcat = {
    '12345': { name: 'STARLINK-100', type: 'PAY', ops: '+', rcs: 'MEDIUM', period: '95.6', incl: '53.0', apo: '550', peri: '548', decayDate: '' },
    '12346': { name: 'MY-STARLINK-TEST', type: 'PAY', ops: '+', rcs: 'MEDIUM', period: '95.6', incl: '53.0', apo: '550', peri: '548', decayDate: '' }
  };
  loader.processData([], [], satcat);

  const obj = loader.getByNoradId(12345);
  assert.ok(obj.EPOCH.startsWith('2026-11-01'), `Expected metadata epoch, got ${obj.EPOCH}`);
  assert.equal(typeof loader.getIndexByNoradId, 'function', 'DataLoader should expose O(1) getIndexByNoradId');
  assert.equal(loader.getIndexByNoradId(12345), 0);

  // Prefix & partial NORAD search should work and rank exact/prefix matches first
  const byName = loader.search('STARLINK');
  assert.equal(byName[0].NORAD_CAT_ID, 12345, 'Prefix match should rank ahead of substring match');

  const byPartialNorad = loader.search('1234');
  assert.equal(byPartialNorad.length, 2, 'Partial NORAD ID search should match both 12345 and 12346');
});

// =========================================================================
// 2. LOD / UI Filter Tests
// =========================================================================
test('LODController returns 0 visible objects when user unchecks all categories (empty array != null)', () => {
  const mockLoader = {
    getObjects: () => [
      { category: 'active', orbitType: 'LEO', rcsSize: 'LARGE' },
      { category: 'debris', orbitType: 'LEO', rcsSize: 'LARGE' }
    ]
  };
  let lastVisible = null;
  const mockRenderer = { setVisibleObjects: (list) => { lastVisible = list; } };

  const lod = new LODController(mockLoader, mockRenderer);
  lod.update(10000);
  assert.equal(lod.getVisibleCount(), 2);

  // User unchecks all categories -> passes []
  lod.setFilter('category', []);
  assert.equal(lod.getVisibleCount(), 0, 'Unchecking all categories must show 0 objects, not all objects');
  assert.deepEqual(lastVisible, []);
});

// =========================================================================
// 3. SpatialHashGrid Swept Tunneling & Backward CPA Tests
// =========================================================================
test('SpatialHashGrid detects high-speed head-on crossing across multiple 60km cells during 30s substep (no tunneling)', () => {
  const grid = new SpatialHashGrid(60.0);
  const dtSec = 25.0;

  // Two particles moving at +/- 7.5 km/s along X: each moves 187.5 km (> 3 cells!)
  // Start at t0: A at (-90, 7000, 0), B at (+90, 7000, 0) -> cross at (0, 7000, 0) at t = 12s
  // End at t1 (after PhysicsPropagator.step): A at (+97.5, 7000, 0), B at (-97.5, 7000, 0)
  // Notice end distance is 195 km (> 3 cells apart!), so point-only spatial hash completely misses them!
  const positions = [
    { x: 97.5, y: 7000, z: 0 },
    { x: -97.5, y: 7000, z: 0 }
  ];
  const velocities = [
    { vx: 7.5, vy: 0, vz: 0 },
    { vx: -7.5, vy: 0, vz: 0 }
  ];

  // Swept insertion must cover the traversed trajectory [pos - v*dt, pos]
  assert.equal(typeof grid.insertSwept, 'function', 'SpatialHashGrid should provide insertSwept()');
  grid.insertSwept(0, positions[0], velocities[0], dtSec);
  grid.insertSwept(1, positions[1], velocities[1], dtSec);

  const collisions = grid.findCollisions(positions, 36.0, velocities, dtSec);
  assert.equal(collisions.length, 1, 'Swept spatial hash + backward CPA must detect head-on crossing across cells');
});

// =========================================================================
// 4. BreakupModel Physics Conservation & Anisotropy Tests
// =========================================================================
test('BreakupModel.collide conserves total momentum and preserves mass conservation', () => {
  const obj1 = {
    mass: 100,
    position: { x: 7000, y: 0, z: 0 },
    velocity: { vx: 0, vy: 7.5, vz: 0 }
  };
  const obj2 = {
    mass: 500,
    position: { x: 7000, y: 0, z: 0 },
    velocity: { vx: 0, vy: -7.5, vz: 0 }
  };

  const frags = BreakupModel.collide(obj1, obj2, 60);
  assert.ok(frags.length >= 15);

  const totalMass = frags.reduce((s, f) => s + f.mass, 0);
  const px = frags.reduce((s, f) => s + f.mass * f.velocity.vx, 0);
  const py = frags.reduce((s, f) => s + f.mass * f.velocity.vy, 0);
  const pz = frags.reduce((s, f) => s + f.mass * f.velocity.vz, 0);

  const expectedMass = obj1.mass + obj2.mass;
  const expectedPy = obj1.mass * obj1.velocity.vy + obj2.mass * obj2.velocity.vy;

  assert.ok(Math.abs(totalMass - expectedMass) < 1e-6, `Mass conservation violated: ${totalMass} vs ${expectedMass}`);
  assert.ok(Math.abs(px) < 1e-6, `Momentum X not conserved: ${px}`);
  assert.ok(Math.abs(py - expectedPy) < 1e-6, `Momentum Y not conserved: ${py} vs ${expectedPy}`);
  assert.ok(Math.abs(pz) < 1e-6, `Momentum Z not conserved: ${pz}`);
});

// =========================================================================
// 5. KesslerSimulator Anti-Duplicate Collision & Index Safety Tests
// =========================================================================
test('KesslerSimulator enforces per-frame collision cap across ALL substeps (not multiplied by 50 substeps)', () => {
  const sim = new KesslerSimulator();
  sim.maxCollisionsPerFrame = 3;

  // Create 20 independent pairs colliding at high relative velocity across distinct sectors
  for (let k = 0; k < 20; k++) {
    const angle = (k / 20) * Math.PI * 2;
    const x = 7000 * Math.cos(angle);
    const z = 7000 * Math.sin(angle);
    sim.addParticle({
      position: { x, y: 0, z },
      velocity: { vx: 0, vy: 7.5, vz: 0 },
      mass: 50,
      immuneTimer: 0
    }, `srcA_${k}`, 1, `rootA_${k}`);
    sim.addParticle({
      position: { x: x + 1, y: 0, z },
      velocity: { vx: 0, vy: -7.5, vz: 0 },
      mass: 50,
      immuneTimer: 0
    }, `srcB_${k}`, 1, `rootB_${k}`);
  }

  // Simulate a large time-warp frame (600s -> 20 substeps)
  sim.step(600, null);
  assert.ok(
    sim.stats.collisions <= sim.maxCollisionsPerFrame,
    `Expected at most ${sim.maxCollisionsPerFrame} collisions in a single frame, got ${sim.stats.collisions}`
  );
});

test('KesslerSimulator NEVER triggers collisions between low-relative-velocity co-orbital fragments (< 0.5 km/s)', () => {
  const sim = new KesslerSimulator();
  // Two particles from DIFFERENT roots flying side-by-side at almost identical velocity (vRel = 0.05 km/s)
  sim.addParticle({
    position: { x: 7000, y: 0, z: 0 },
    velocity: { vx: 0, vy: 7.5, vz: 0 },
    mass: 20,
    immuneTimer: 0
  }, 'src1', 1, 'root1');
  sim.addParticle({
    position: { x: 7001, y: 0, z: 0 },
    velocity: { vx: 0, vy: 7.55, vz: 0 },
    mass: 20,
    immuneTimer: 0
  }, 'src2', 1, 'root2');

  sim.step(10, null);
  assert.equal(sim.stats.collisions, 0, 'Co-orbital low relative velocity encounter must not trigger hypervelocity breakup');
});

test('KesslerSimulator maintains particle index integrity at maxParticles cap (no shift() index corruption or duplicate parent collision)', () => {
  const sim = new KesslerSimulator();
  sim.maxParticles = 40;
  sim.maxCollisionsPerFrame = 3;

  // Fill to cap with non-colliding distant particles from same root
  for (let i = 0; i < 38; i++) {
    const a = (i / 38) * Math.PI * 2;
    sim.addParticle({
      position: { x: 7500 * Math.cos(a), y: 1000, z: 7500 * Math.sin(a) },
      velocity: { vx: -7.2 * Math.sin(a), vy: 0, vz: 7.2 * Math.cos(a) },
      mass: 10,
      immuneTimer: 0
    }, 'bg', 1, 'root_bg');
  }

  // Add 2 colliding particles at indices 38 and 39 (right at maxParticles = 40!)
  const pA = sim.addParticle({
    position: { x: 7000, y: 0, z: 0 },
    velocity: { vx: 0, vy: 7.5, vz: 0 },
    mass: 100,
    immuneTimer: 0
  }, 'colA', 1, 'root_colA');
  const pB = sim.addParticle({
    position: { x: 7001, y: 0, z: 0 },
    velocity: { vx: 0, vy: -7.5, vz: 0 },
    mass: 100,
    immuneTimer: 0
  }, 'colB', 1, 'root_colB');

  sim.step(1.0, null);

  assert.equal(sim.stats.collisions, 1);
  // Neither collided parent may survive in sim.particles!
  const remainingIds = new Set(sim.particles.map(p => p.id));
  assert.ok(!remainingIds.has(pA.id), 'Collided parent pA must be removed even when maxParticles cap is reached');
  assert.ok(!remainingIds.has(pB.id), 'Collided parent pB must be removed even when maxParticles cap is reached');
  assert.ok(sim.particles.length <= sim.maxParticles, 'Particle count must stay <= maxParticles');
});

test('KesslerSimulator prevents duplicate catalog satellite hits and prevents newly spawned fragments from colliding in the same high-warp frame', () => {
  const sim = new KesslerSimulator();
  sim.maxCollisionsPerFrame = 5;

  // Trigger explosion of 50 fragments from root_parent
  sim.triggerExplosion(
    { x: 7000, y: 0, z: 0 },
    { vx: 0, vy: 7.5, vz: 0 },
    1000,
    50,
    1.0,
    'root_parent'
  );

  let satHits = 0;
  const mockCatalogCheck = (pos) => {
    // Return same catalog satellite unless simulator deduplicates it
    return {
      index: 999,
      NORAD_CAT_ID: 99999,
      OBJECT_NAME: 'TARGET-SAT',
      rcsSize: 'MEDIUM',
      velocity: { vx: 0, vy: -7.5, vz: 0 }
    };
  };

  // Step 600s (high time warp: 20 substeps of 30s)
  sim.step(600, mockCatalogCheck);

  // Even though mockCatalogCheck always returns sat #999, it MUST only be destroyed ONCE!
  assert.equal(sim.stats.destroyedSatellites, 1, 'Same catalog satellite must never be destroyed twice');
  // And NO sibling/incestuous inter-debris cascade should occur from this single cloud + single struck sat!
  assert.equal(sim.stats.collisions, 1, `Expected exactly 1 collision (no sibling/duplicate re-collisions), got ${sim.stats.collisions}`);
});

test('KesslerSimulator simulation-time cooldown prevents rapid repeated collisions in the same sector under high time-warp', () => {
  const sim = new KesslerSimulator();
  sim.maxCollisionsPerFrame = 10;

  // Place 3 distinct pairs in the EXACT same 120km sector
  for (let k = 0; k < 3; k++) {
    sim.addParticle({
      position: { x: 7000 + k * 2, y: 0, z: 0 },
      velocity: { vx: 0, vy: 7.5, vz: 0 },
      mass: 50,
      immuneTimer: 0
    }, `sA_${k}`, 1, `rA_${k}`);
    sim.addParticle({
      position: { x: 7000 + k * 2 + 1, y: 0, z: 0 },
      velocity: { vx: 0, vy: -7.5, vz: 0 },
      mass: 50,
      immuneTimer: 0
    }, `sB_${k}`, 1, `rB_${k}`);
  }

  // First step: only 1 collision allowed in this sector
  sim.step(1.0, null);
  assert.equal(sim.stats.collisions, 1, 'Sector cooldown must allow at most 1 collision per sector initially');

  // Immediate second step (sim time only +1s later): still blocked by sector cooldown
  sim.step(1.0, null);
  assert.equal(sim.stats.collisions, 1, 'Sector cooldown must block rapid repeat collision within short time');
});

// =========================================================================
// 6. Orbital Utilities (TLE formatting, GMST, ECI -> Geodetic Lat/Lon/Alt)
// =========================================================================
test('orbital-utils exports accurate ommToTLE (fixing 10x BSTAR exponent bug) and ECI-to-geodetic conversion', async () => {
  const utils = await import('../src/physics/orbital-utils.js');

  // BSTAR = 0.0001 = 0.10000e-3 -> TLE format must be " 10000-3" (NOT " 10000-4" which is 1e-5!)
  assert.equal(utils.formatTLESci(0.0001), ' 10000-3');
  assert.equal(utils.formatTLESci(-0.00012345), '-12345-3');
  assert.equal(utils.formatTLESci(0), ' 00000-0');
  // Very small exponent (< 1e-10) must not overflow 8-char TLE column width!
  const tiny = utils.formatTLESci(1e-12);
  assert.equal(tiny.length, 8, `TLE scientific string must always be 8 chars, got "${tiny}"`);

  // ECI to Geodetic at GMST = 0:
  // Three.js pos (6778.137, 0, 0) corresponds to ECI (6778.137, 0, 0) -> lat = 0, lon = 0, alt ~ 400 km
  const geo0 = utils.threePosToGeodetic({ x: 6778.137, y: 0, z: 0 }, 0);
  assert.ok(Math.abs(geo0.lat) < 0.01, `Expected lat 0, got ${geo0.lat}`);
  assert.ok(Math.abs(geo0.lon) < 0.01, `Expected lon 0, got ${geo0.lon}`);
  assert.ok(Math.abs(geo0.alt - 400) < 1.0, `Expected alt ~400, got ${geo0.alt}`);

  // When GMST = +90 deg (Earth rotated 90 deg east), fixed ECI +X is now at -90 deg (90W) longitude!
  const geo90 = utils.threePosToGeodetic({ x: 6778.137, y: 0, z: 0 }, Math.PI / 2);
  assert.ok(Math.abs(geo90.lon - (-90)) < 0.1, `Expected lon -90 when GMST=90deg, got ${geo90.lon}`);
});

// =========================================================================
// 7. Stress Test: High Time-Warp Cascade Invariants (Zero Self/Duplicate Collisions)
// =========================================================================
test('KesslerSimulator maintains zero sibling collisions & bounded per-frame rate over 60 high-warp frames', () => {
  const sim = new KesslerSimulator();
  sim.maxCollisionsPerFrame = 3;

  // Single explosion cloud of 120 fragments -> must NEVER self-collide over 60 frames of 3600x (60s/frame)
  sim.triggerExplosion(
    { x: 7150, y: 0, z: 0 },
    { vx: 0, vy: 7.46, vz: 0 },
    950,
    120,
    1.5,
    'root_single_cloud'
  );

  for (let frame = 0; frame < 60; frame++) {
    sim.step(60.0, null);
  }
  assert.equal(sim.stats.collisions, 0, 'Single debris cloud must produce 0 self-collisions over 1 hour of sim time');

  // Now inject a second independent opposing cloud on an intersecting orbit -> should trigger controlled cascades
  sim.triggerExplosion(
    { x: 7150, y: 0, z: 0 },
    { vx: 0, vy: -7.46, vz: 0 },
    950,
    60,
    1.5,
    'root_opposing_cloud'
  );

  let maxDeltaPerFrame = 0;
  for (let frame = 0; frame < 30; frame++) {
    const before = sim.stats.collisions;
    sim.step(20.0, null);
    const delta = sim.stats.collisions - before;
    if (delta > maxDeltaPerFrame) maxDeltaPerFrame = delta;
  }

  assert.ok(maxDeltaPerFrame <= sim.maxCollisionsPerFrame, `Frame collision cap exceeded: ${maxDeltaPerFrame}`);
  assert.ok(sim.particles.length <= sim.maxParticles, 'Particle count stayed within maxParticles cap');
});

