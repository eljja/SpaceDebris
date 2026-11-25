/**
 * SpaceDebris — OrbitRenderer
 * SGP4 orbital propagation using satellite.js with InstancedMesh rendering,
 * simulation-time-locked queries, direct SGP4 velocities, and an
 * altitude-bucketed 3D Spatial Hash Grid for O(1) catalog collision checks.
 */

import * as THREE from 'three';
import * as satellite from 'satellite.js';
import { ommToTLE, RE_WGS84 } from './physics/orbital-utils.js';
import { SpatialHashGrid } from './physics/collision.js';

// Color constants
const COLOR_ACTIVE   = new THREE.Color(0x00e5ff); // Cyan
const COLOR_DEAD     = new THREE.Color(0xd500f9); // Purple
const COLOR_ROCKET   = new THREE.Color(0xff9100); // Amber
const COLOR_DEBRIS   = new THREE.Color(0xffffff); // Pure White (Real Space Debris)
const COLOR_DEBRIS_L = new THREE.Color(0xffffff); // Pure White (Large Real Debris)
const COLOR_UNKNOWN  = new THREE.Color(0x94a3b8); // Dim Gray

const ALT_BUCKET_KM = 100;

export class OrbitRenderer {
  constructor(scene, dataLoader) {
    this.scene = scene;
    this.dataLoader = dataLoader;

    this.objects = this.dataLoader.getObjects() || [];
    this.satrecs = new Array(this.objects.length).fill(null);
    this.visibleSet = new Set();
    this.validMap = [];    // validMap[meshInstance] = originalIndex
    this.validColors = []; // Cached category colors for each instance
    this.indexToMesh = new Map(); // originalIndex -> meshInstanceIndex
    this.scales = [];

    // Fast catalog collision spatial structures
    this.catalogPositions = new Float32Array(this.objects.length * 3);
    this.catalogPropagatedMs = new Float64Array(this.objects.length);
    this.catalogGrid = new SpatialHashGrid(80.0);
    this.altBuckets = new Map(); // bucketIdx -> number[] (origIdx)
    this.eccentricCatalogIndices = [];
    this._catalogGridReadyMs = -1;

    this.currentSimDate = new Date();
    this.dummy = new THREE.Object3D();
    this.mesh = null;
    this.orbitPath = null;
    this.selectedObjectIndex = -1;
    this.prevSelectedObjectIndex = -1;
    this.whiteColor = new THREE.Color(0xffffff);
    this.destroyedCatalogIndices = new Set();

    // Reusable scratch vectors/matrices (zero GC in hot paths)
    this._tmpVec = new THREE.Vector3();
    this._tmpMat = new THREE.Matrix4();
    this._raycaster = new THREE.Raycaster();
    this._earthSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 6371);
    this._tmpRay = new THREE.Ray();
    this._tmpHit = new THREE.Vector3();
    this._tmpDir = new THREE.Vector3();

    this._buildSatrecs();
    this._buildMesh();
    this._initSelectionMarker();

    for (let i = 0; i < this.validMap.length; i++) {
      this.visibleSet.add(this.validMap[i]);
    }
  }

  _buildSatrecs() {
    for (let i = 0; i < this.objects.length; i++) {
      const omm = this.objects[i];
      if (!omm || !omm.NORAD_CAT_ID) continue;
      if (omm.NORAD_CAT_ID > 99999) continue;

      const tle = ommToTLE(omm);
      if (!tle) continue;

      try {
        const satrec = satellite.twoline2satrec(tle.line1, tle.line2);
        if (satrec && !satrec.error) {
          this.satrecs[i] = satrec;
        }
      } catch {
        // Skip parse failures silently
      }
    }
  }

  _buildMesh() {
    const validColors = [];
    this.validColors = validColors;
    this.validMap = [];
    this.scales = [];
    this.indexToMesh.clear();
    this.altBuckets.clear();
    this.eccentricCatalogIndices = [];

    for (let i = 0; i < this.objects.length; i++) {
      if (!this.satrecs[i]) continue;

      const obj = this.objects[i];
      this.indexToMesh.set(i, this.validMap.length);
      this.validMap.push(i);

      // Index into 100 km altitude buckets for O(1) simulation collision prep
      const peri = Number.isFinite(obj.peri) ? obj.peri : 400;
      const apo = Number.isFinite(obj.apo) ? obj.apo : 800;
      if (apo - peri > 3000) {
        this.eccentricCatalogIndices.push(i);
      } else {
        const minB = Math.max(0, Math.floor((peri - 60) / ALT_BUCKET_KM));
        const maxB = Math.max(minB, Math.floor((apo + 60) / ALT_BUCKET_KM));
        for (let b = minB; b <= maxB; b++) {
          let list = this.altBuckets.get(b);
          if (!list) {
            list = [];
            this.altBuckets.set(b, list);
          }
          list.push(i);
        }
      }

      // Color by category
      let color;
      switch (obj.category) {
        case 'active':  color = COLOR_ACTIVE; break;
        case 'dead':    color = COLOR_DEAD; break;
        case 'rocket':  color = COLOR_ROCKET; break;
        case 'debris':  color = (obj.rcsSize === 'LARGE') ? COLOR_DEBRIS_L : COLOR_DEBRIS; break;
        default:        color = COLOR_UNKNOWN;
      }
      validColors.push(color);

      // Scale by RCS size
      let scale = 7.5;
      if (obj.rcsSize === 'LARGE') scale = 20;
      else if (obj.rcsSize === 'MEDIUM') scale = 12.5;
      this.scales.push(scale);
    }

    const geo = new THREE.SphereGeometry(1, 6, 6);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });

    this.mesh = new THREE.InstancedMesh(geo, mat, this.validMap.length);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    for (let i = 0; i < this.validMap.length; i++) {
      this.mesh.setColorAt(i, validColors[i]);
    }
    if (this.mesh.instanceColor) {
      this.mesh.instanceColor.needsUpdate = true;
    }

    this.scene.add(this.mesh);
  }

  _initSelectionMarker() {
    this.selectionMarkerGroup = new THREE.Group();

    const coreGeo = new THREE.SphereGeometry(25, 16, 16);
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95
    });
    this.selectionMarkerGroup.add(new THREE.Mesh(coreGeo, coreMat));

    const ringGeo = new THREE.RingGeometry(40, 52, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x00e5ff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85
    });
    this.selectionMarkerGroup.add(new THREE.Mesh(ringGeo, ringMat));

    const reticleGeo = new THREE.RingGeometry(65, 80, 4);
    const reticleMat = new THREE.MeshBasicMaterial({
      color: 0xffea00,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85
    });
    this.reticleRing = new THREE.Mesh(reticleGeo, reticleMat);
    this.selectionMarkerGroup.add(this.reticleRing);

    this.selectionMarkerGroup.visible = false;
    this.scene.add(this.selectionMarkerGroup);
  }

  update(now, camera = null) {
    if (!this.mesh) return;

    this.currentSimDate = now instanceof Date ? now : new Date(now);
    const simTimeMs = this.currentSimDate.getTime();
    let colorDirty = false;

    // Restore previous selected object's category color on selection change
    if (this.prevSelectedObjectIndex !== this.selectedObjectIndex) {
      if (this.prevSelectedObjectIndex !== -1) {
        const prevMi = this.indexToMesh.get(this.prevSelectedObjectIndex);
        if (prevMi !== undefined && this.validColors[prevMi]) {
          this.mesh.setColorAt(prevMi, this.validColors[prevMi]);
          colorDirty = true;
        }
      }
      if (this.selectedObjectIndex !== -1) {
        const nextMi = this.indexToMesh.get(this.selectedObjectIndex);
        if (nextMi !== undefined) {
          this.mesh.setColorAt(nextMi, this.whiteColor);
          colorDirty = true;
        }
      }
      this.prevSelectedObjectIndex = this.selectedObjectIndex;
    }

    const visibleList = this.visibleIndicesList || this.validMap;

    for (let vi = 0; vi < visibleList.length; vi++) {
      const origIdx = visibleList[vi];
      const mi = this.indexToMesh.get(origIdx);
      if (mi === undefined) continue;

      if (this.destroyedCatalogIndices.has(origIdx)) {
        this.dummy.position.set(0, 0, 0);
        this.dummy.scale.set(0, 0, 0);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(mi, this.dummy.matrix);
        continue;
      }

      const satrec = this.satrecs[origIdx];
      if (!satrec) continue;

      const pv = satellite.propagate(satrec, this.currentSimDate);
      const posEci = pv.position;

      if (posEci && typeof posEci.x === 'number' && Number.isFinite(posEci.x)) {
        // ECI -> Three.js:  X=ECI.x, Y=ECI.z, Z=-ECI.y
        const tx = posEci.x;
        const ty = posEci.z;
        const tz = -posEci.y;

        const base = origIdx * 3;
        this.catalogPositions[base]     = tx;
        this.catalogPositions[base + 1] = ty;
        this.catalogPositions[base + 2] = tz;
        this.catalogPropagatedMs[origIdx] = simTimeMs;

        this.dummy.position.set(tx, ty, tz);
        let s = this.scales[mi];
        if (origIdx === this.selectedObjectIndex) {
          s *= 2.5;
        }
        this.dummy.scale.set(s, s, s);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(mi, this.dummy.matrix);
      }
    }

    this.mesh.instanceMatrix.needsUpdate = true;
    if (colorDirty && this.mesh.instanceColor) {
      this.mesh.instanceColor.needsUpdate = true;
    }

    // Update Selection Marker Halo using currentSimDate
    if (this.selectedObjectIndex !== -1 && !this.destroyedCatalogIndices.has(this.selectedObjectIndex)) {
      const selPos = this.getObjectPosition(this.selectedObjectIndex, this.currentSimDate);
      if (selPos) {
        this.selectionMarkerGroup.position.copy(selPos);
        if (camera) {
          this.selectionMarkerGroup.lookAt(camera.position);
          const dist = camera.position.distanceTo(selPos);
          const scale = Math.max(0.5, Math.min(6.0, dist / 8000));
          this.selectionMarkerGroup.scale.set(scale, scale, scale);
        }
        if (this.reticleRing) {
          this.reticleRing.rotation.z += 0.02;
        }
        this.selectionMarkerGroup.visible = true;
      } else {
        this.selectionMarkerGroup.visible = false;
      }
    } else if (this.selectionMarkerGroup) {
      this.selectionMarkerGroup.visible = false;
    }
  }

  /**
   * Builds a fast 3D spatial hash index ONCE per frame for catalog satellites
   * residing in the altitude shells currently occupied by simulation particles.
   * Reduces catalog collision queries from O(N_particles * N_catalog) to O(1).
   */
  prepareSimulationFrame(simDate, simParticles) {
    this.catalogGrid.clear();
    if (!simParticles || simParticles.length === 0) {
      this._catalogGridReadyMs = -1;
      return;
    }

    const date = simDate instanceof Date ? simDate : this.currentSimDate;
    const simTimeMs = date.getTime();
    this._catalogGridReadyMs = simTimeMs;

    // 1. Identify active 100 km altitude buckets spanned by simulation particles
    const activeBuckets = new Set();
    for (let i = 0; i < simParticles.length; i++) {
      const p = simParticles[i].position;
      const r = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
      const alt = Math.max(0, r - RE_WGS84);
      const b = Math.floor(alt / ALT_BUCKET_KM);
      activeBuckets.add(b);
      if (b > 0) activeBuckets.add(b - 1);
      activeBuckets.add(b + 1);
    }

    // 2. Collect unique candidate catalog indices in those altitude shells + eccentric orbits
    const inserted = new Set();
    const indexCandidate = (origIdx) => {
      if (inserted.has(origIdx) || this.destroyedCatalogIndices.has(origIdx)) return;
      inserted.add(origIdx);

      const base = origIdx * 3;
      if (this.catalogPropagatedMs[origIdx] !== simTimeMs) {
        const satrec = this.satrecs[origIdx];
        if (!satrec) return;
        const pv = satellite.propagate(satrec, date);
        const posEci = pv.position;
        if (!posEci || !Number.isFinite(posEci.x)) return;

        this.catalogPositions[base]     = posEci.x;
        this.catalogPositions[base + 1] = posEci.z;
        this.catalogPositions[base + 2] = -posEci.y;
        this.catalogPropagatedMs[origIdx] = simTimeMs;
      }

      this.catalogGrid.insert(origIdx, {
        x: this.catalogPositions[base],
        y: this.catalogPositions[base + 1],
        z: this.catalogPositions[base + 2]
      });
    };

    for (const b of activeBuckets) {
      const list = this.altBuckets.get(b);
      if (!list) continue;
      for (let k = 0; k < list.length; k++) {
        indexCandidate(list[k]);
      }
    }

    for (let k = 0; k < this.eccentricCatalogIndices.length; k++) {
      indexCandidate(this.eccentricCatalogIndices[k]);
    }
  }

  setVisibleObjects(objectIndices) {
    this.visibleSet = new Set(objectIndices);
    this.visibleIndicesList = objectIndices;

    if (!this.mesh) return;

    this.dummy.scale.set(0, 0, 0);
    this.dummy.position.set(0, 0, 0);
    this.dummy.updateMatrix();

    for (let mi = 0; mi < this.validMap.length; mi++) {
      const origIdx = this.validMap[mi];
      if (!this.visibleSet.has(origIdx)) {
        this.mesh.setMatrixAt(mi, this.dummy.matrix);
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  getObjectAtScreenPosition(screenPos, camera, canvasWidth = window.innerWidth, canvasHeight = window.innerHeight) {
    if (!this.mesh) return null;

    // 1. Standard geometric Raycaster first
    this._raycaster.setFromCamera(screenPos, camera);
    const intersects = this._raycaster.intersectObject(this.mesh);
    for (let i = 0; i < intersects.length; i++) {
      const instanceId = intersects[i].instanceId;
      if (instanceId < this.validMap.length) {
        const origIdx = this.validMap[instanceId];
        if (!this.destroyedCatalogIndices.has(origIdx) && this.visibleSet.has(origIdx)) {
          return origIdx;
        }
      }
    }

    // 2. Fallback to 2D Screen-space Proximity picking (32px tolerance)
    const clickX = ((screenPos.x + 1) / 2) * canvasWidth;
    const clickY = ((1 - screenPos.y) / 2) * canvasHeight;

    let closestIdx = -1;
    let minDistanceSq = 32 * 32;

    const projPos = this._tmpVec;
    const tempMatrix = this._tmpMat;
    const visibleList = this.visibleIndicesList || this.validMap;

    for (let vi = 0; vi < visibleList.length; vi++) {
      const origIdx = visibleList[vi];
      if (this.destroyedCatalogIndices.has(origIdx)) continue;
      const mi = this.indexToMesh.get(origIdx);
      if (mi === undefined) continue;

      this.mesh.getMatrixAt(mi, tempMatrix);
      projPos.setFromMatrixPosition(tempMatrix);
      if (projPos.lengthSq() < 1000) continue;

      // Occlusion check: Don't pick objects hidden behind Earth
      this._tmpDir.copy(projPos).sub(camera.position);
      const distToObj = this._tmpDir.length();
      this._tmpDir.divideScalar(distToObj || 1);

      this._tmpRay.set(camera.position, this._tmpDir);
      if (this._tmpRay.intersectSphere(this._earthSphere, this._tmpHit)) {
        if (this._tmpHit.distanceTo(camera.position) < distToObj - 50) {
          continue;
        }
      }

      projPos.project(camera);
      if (projPos.z > 1.0) continue;

      const px = ((projPos.x + 1) / 2) * canvasWidth;
      const py = ((1 - projPos.y) / 2) * canvasHeight;

      const dx = px - clickX;
      const dy = py - clickY;
      const distSq = dx * dx + dy * dy;

      if (distSq < minDistanceSq) {
        minDistanceSq = distSq;
        closestIdx = origIdx;
      }
    }

    return closestIdx !== -1 ? closestIdx : null;
  }

  /**
   * Returns object 3D position in Three.js coordinates at simulation date (defaults to currentSimDate).
   */
  getObjectPosition(index, date = this.currentSimDate) {
    const satrec = this.satrecs[index];
    if (!satrec) return null;

    const targetDate = date instanceof Date ? date : this.currentSimDate;
    const targetMs = targetDate.getTime();

    // Fast path: reuse cached position propagated this frame
    if (this.catalogPropagatedMs[index] === targetMs) {
      const base = index * 3;
      const x = this.catalogPositions[base];
      const y = this.catalogPositions[base + 1];
      const z = this.catalogPositions[base + 2];
      if (x * x + y * y + z * z > 1000) {
        return new THREE.Vector3(x, y, z);
      }
    }

    const pv = satellite.propagate(satrec, targetDate);
    const p = pv.position;
    if (p && typeof p.x === 'number' && Number.isFinite(p.x)) {
      return new THREE.Vector3(p.x, p.z, -p.y);
    }
    return null;
  }

  /**
   * Computes orbital velocity vector in km/s (Three.js frame) at simulation date.
   * Uses exact SGP4 pv.velocity directly, with central-difference fallback.
   */
  getObjectVelocity(index, date = this.currentSimDate) {
    const satrec = this.satrecs[index];
    if (!satrec) return null;

    const targetDate = date instanceof Date ? date : this.currentSimDate;
    const pv = satellite.propagate(satrec, targetDate);

    // Direct exact SGP4 velocity (ECI km/s -> Three.js X=ECI.x, Y=ECI.z, Z=-ECI.y)
    if (pv.velocity && typeof pv.velocity.x === 'number' && Number.isFinite(pv.velocity.x)) {
      return new THREE.Vector3(pv.velocity.x, pv.velocity.z, -pv.velocity.y);
    }

    // Fallback: central numerical difference around targetDate
    const dtMs = 500;
    const dt2 = 1.0;
    const pvBefore = satellite.propagate(satrec, new Date(targetDate.getTime() - dtMs));
    const pvAfter  = satellite.propagate(satrec, new Date(targetDate.getTime() + dtMs));

    if (!pvBefore.position || !pvAfter.position) return null;
    if (!Number.isFinite(pvBefore.position.x) || !Number.isFinite(pvAfter.position.x)) return null;

    return new THREE.Vector3(
      (pvAfter.position.x - pvBefore.position.x) / dt2,
      (pvAfter.position.z - pvBefore.position.z) / dt2,
      -(pvAfter.position.y - pvBefore.position.y) / dt2
    );
  }

  showOrbitPath(objectIndex, date = this.currentSimDate) {
    this.clearOrbitPath();
    this.selectedObjectIndex = objectIndex;

    const satrec = this.satrecs[objectIndex];
    if (!satrec) return;

    const startDate = date instanceof Date ? date : this.currentSimDate;
    const mmRevDay = this.objects[objectIndex]?.MEAN_MOTION || 15;
    const periodMin = 1440 / mmRevDay;
    const periodMs = periodMin * 60 * 1000;

    const points = [];
    const segments = 150;

    for (let i = 0; i <= segments; i++) {
      const time = new Date(startDate.getTime() + (i / segments) * periodMs);
      const pv = satellite.propagate(satrec, time);
      if (pv.position && Number.isFinite(pv.position.x)) {
        points.push(new THREE.Vector3(
          pv.position.x, pv.position.z, -pv.position.y
        ));
      }
    }

    if (points.length > 2) {
      const geo = new THREE.BufferGeometry().setFromPoints(points);
      const mat = new THREE.LineBasicMaterial({
        color: 0x00e5ff,
        transparent: true,
        opacity: 0.45
      });
      this.orbitPath = new THREE.Line(geo, mat);
      this.scene.add(this.orbitPath);
    }
  }

  clearOrbitPath() {
    if (this.selectedObjectIndex !== -1) {
      const mi = this.indexToMesh.get(this.selectedObjectIndex);
      if (mi !== undefined && this.validColors[mi]) {
        this.mesh.setColorAt(mi, this.validColors[mi]);
        if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
      }
    }
    this.selectedObjectIndex = -1;
    this.prevSelectedObjectIndex = -1;
    if (this.selectionMarkerGroup) {
      this.selectionMarkerGroup.visible = false;
    }
    if (this.orbitPath) {
      this.scene.remove(this.orbitPath);
      this.orbitPath.geometry.dispose();
      this.orbitPath.material.dispose();
      this.orbitPath = null;
    }
  }

  destroySatellite(origIdx) {
    this.destroyedCatalogIndices.add(origIdx);
    if (this.selectedObjectIndex === origIdx) {
      this.clearOrbitPath();
    }
    const mi = this.indexToMesh.get(origIdx);
    if (mi !== undefined && this.mesh) {
      this.dummy.position.set(0, 0, 0);
      this.dummy.scale.set(0, 0, 0);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(mi, this.dummy.matrix);
      this.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * Restores all destroyed catalog satellites when simulation is reset
   */
  restoreAllSatellites() {
    this.destroyedCatalogIndices.clear();
    this.catalogGrid.clear();
    this._catalogGridReadyMs = -1;
  }

  /**
   * Finds the first catalog satellite within radiusKm of a 3D position using the
   * O(1) spatial hash index prepared by prepareSimulationFrame().
   */
  findNearbySatellite(position, radiusKm = 45.0, date = this.currentSimDate) {
    if (!position) return null;

    const targetDate = date instanceof Date ? date : this.currentSimDate;

    // Fast O(1) lookup via pre-indexed catalog spatial hash grid
    if (this._catalogGridReadyMs === targetDate.getTime()) {
      const hits = this.catalogGrid.queryNearby(position, this.catalogPositions, radiusKm);
      for (let i = 0; i < hits.length; i++) {
        const origIdx = hits[i];
        if (this.destroyedCatalogIndices.has(origIdx)) continue;
        const obj = this.objects[origIdx];
        if (!obj) continue;

        const base = origIdx * 3;
        const vel = this.getObjectVelocity(origIdx, targetDate);
        return {
          ...obj,
          index: origIdx,
          position: {
            x: this.catalogPositions[base],
            y: this.catalogPositions[base + 1],
            z: this.catalogPositions[base + 2]
          },
          velocity: vel ? { vx: vel.x, vy: vel.y, vz: vel.z } : null
        };
      }
      return null;
    }

    // Fallback if called outside prepareSimulationFrame: check only matching altitude bucket
    const r = Math.sqrt(position.x * position.x + position.y * position.y + position.z * position.z);
    const alt = Math.max(0, r - RE_WGS84);
    const b = Math.floor(alt / ALT_BUCKET_KM);
    const thresholdSq = radiusKm * radiusKm;

    const bucketList = this.altBuckets.get(b) || [];
    for (let i = 0; i < bucketList.length; i++) {
      const origIdx = bucketList[i];
      if (this.destroyedCatalogIndices.has(origIdx)) continue;

      const pos = this.getObjectPosition(origIdx, targetDate);
      if (!pos) continue;
      const dx = position.x - pos.x;
      const dy = position.y - pos.y;
      const dz = position.z - pos.z;
      if (dx * dx + dy * dy + dz * dz <= thresholdSq) {
        const obj = this.objects[origIdx];
        const vel = this.getObjectVelocity(origIdx, targetDate);
        return {
          ...obj,
          index: origIdx,
          position: { x: pos.x, y: pos.y, z: pos.z },
          velocity: vel ? { vx: vel.x, vy: vel.y, vz: vel.z } : null
        };
      }
    }

    return null;
  }
}
