/**
 * SpaceDebris — OrbitRenderer
 * SGP4 orbital propagation using satellite.js with InstancedMesh rendering.
 * Builds TLE strings from CelesTrak OMM JSON for satellite.twoline2satrec().
 */

import * as THREE from 'three';
import * as satellite from 'satellite.js';

// Color constants
const COLOR_ACTIVE  = new THREE.Color(0x00e5ff); // Cyan
const COLOR_DEAD    = new THREE.Color(0xd500f9); // Purple
const COLOR_ROCKET  = new THREE.Color(0xff9100); // Amber
const COLOR_DEBRIS  = new THREE.Color(0xffffff); // Pure White (Real Space Debris)
const COLOR_DEBRIS_L = new THREE.Color(0xffffff); // Pure White (Large Real Debris)
const COLOR_UNKNOWN = new THREE.Color(0x94a3b8); // Dim Gray

export class OrbitRenderer {
  constructor(scene, dataLoader) {
    this.scene = scene;
    this.dataLoader = dataLoader;

    this.objects = this.dataLoader.getObjects() || [];
    this.satrecs = new Array(this.objects.length).fill(null);
    this.visibleSet = new Set();
    this.validMap = [];   // validMap[meshInstance] = originalIndex
    this.validColors = []; // Cached category colors for each instance
    this.indexToMesh = new Map(); // originalIndex -> meshInstanceIndex
    this.scales = [];

    this.dummy = new THREE.Object3D();
    this.mesh = null;
    this.orbitPath = null;
    this.selectedObjectIndex = -1;
    this.prevSelectedObjectIndex = -1;
    this.whiteColor = new THREE.Color(0xffffff);
    this.destroyedCatalogIndices = new Set(); // Registry of destroyed satellites

    this._buildSatrecs();
    this._buildMesh();
    this._initSelectionMarker();

    // Initially all valid objects visible
    for (let i = 0; i < this.validMap.length; i++) {
      this.visibleSet.add(this.validMap[i]);
    }
  }

  _buildSatrecs() {
    for (let i = 0; i < this.objects.length; i++) {
      const omm = this.objects[i];
      if (!omm || !omm.NORAD_CAT_ID) continue;
      if (omm.NORAD_CAT_ID > 99999) continue; // TLE 5-digit limit

      const tle = this._ommToTLE(omm);
      if (!tle) continue;

      try {
        const satrec = satellite.twoline2satrec(tle.line1, tle.line2);
        if (satrec && !satrec.error) {
          this.satrecs[i] = satrec;
        }
      } catch (e) {
        // Skip parse failures silently
      }
    }
  }

  _ommToTLE(omm) {
    try {
      const catId = String(omm.NORAD_CAT_ID).padStart(5, '0');
      const cls = (omm.CLASSIFICATION_TYPE || 'U').charAt(0);

      // International Designator from OBJECT_ID (e.g., "1998-067A")
      let intlDes = '        ';
      if (omm.OBJECT_ID) {
        const parts = omm.OBJECT_ID.match(/^(\d{4})-(\d{3})(.*)$/);
        if (parts) {
          const yr = parts[1].slice(2);
          const num = parts[2];
          const piece = (parts[3] || '').trim();
          intlDes = (yr + num + piece).padEnd(8, ' ');
        }
      }

      // Epoch
      const epochDate = new Date(omm.EPOCH || Date.now());
      const yr = epochDate.getUTCFullYear();
      const epochYr = String(yr % 100).padStart(2, '0');
      const startOfYear = Date.UTC(yr, 0, 1);
      const epochDay = ((epochDate.getTime() - startOfYear) / 86400000 + 1);
      const epochDayStr = epochDay.toFixed(8).padStart(12, '0');

      // Mean Motion Dot (ndot/2)
      const ndot = omm.MEAN_MOTION_DOT || 0;
      let ndotStr;
      if (ndot >= 0) {
        ndotStr = ' ' + Math.abs(ndot).toFixed(8).replace(/^0/, '');
      } else {
        ndotStr = '-' + Math.abs(ndot).toFixed(8).replace(/^0/, '');
      }
      ndotStr = ndotStr.substring(0, 10).padEnd(10, ' ');

      // Scientific notation formatter for nddot and BSTAR
      const fmtSci = (val) => {
        if (val === 0 || val == null) return ' 00000-0';
        const sign = val < 0 ? '-' : ' ';
        const abs = Math.abs(val);
        const exp = Math.floor(Math.log10(abs));
        const mantissa = abs / Math.pow(10, exp);
        const mantInt = Math.round(mantissa * 10000);
        const mantStr = String(mantInt).padStart(5, '0');
        const expSign = exp >= 0 ? '+' : '-';
        const expStr = String(Math.abs(exp));
        return `${sign}${mantStr}${expSign}${expStr}`;
      };

      const nddot = fmtSci(omm.MEAN_MOTION_DDOT);
      const bstar = fmtSci(omm.BSTAR);
      const elsetNo = String(omm.ELEMENT_SET_NO || 999).padStart(4, ' ');

      // Line 1 (69 chars + checksum not strictly needed by satellite.js)
      const line1 = `1 ${catId}${cls} ${intlDes} ${epochYr}${epochDayStr} ${ndotStr} ${nddot} ${bstar} 0 ${elsetNo}0`;

      // Line 2
      const inc = Number(omm.INCLINATION || 0).toFixed(4).padStart(8, ' ');
      const raan = Number(omm.RA_OF_ASC_NODE || 0).toFixed(4).padStart(8, ' ');
      const ecc = Number(omm.ECCENTRICITY || 0).toFixed(7).substring(2); // Remove "0."
      const argp = Number(omm.ARG_OF_PERICENTER || 0).toFixed(4).padStart(8, ' ');
      const ma = Number(omm.MEAN_ANOMALY || 0).toFixed(4).padStart(8, ' ');
      const mm = Number(omm.MEAN_MOTION || 0).toFixed(8).padStart(11, ' ');
      const revNum = String(omm.REV_AT_EPOCH || 0).padStart(5, ' ');

      const line2 = `2 ${catId} ${inc} ${raan} ${ecc} ${argp} ${ma} ${mm}${revNum}0`;

      return { line1, line2 };
    } catch (e) {
      return null;
    }
  }

  _buildMesh() {
    const validColors = [];
    this.validColors = validColors;
    this.validMap = [];
    this.scales = [];
    this.indexToMesh.clear();

    for (let i = 0; i < this.objects.length; i++) {
      if (!this.satrecs[i]) continue;

      const obj = this.objects[i];
      this.indexToMesh.set(i, this.validMap.length);
      this.validMap.push(i);

      // Color by category (set by DataLoader)
      let color;
      switch (obj.category) {
        case 'active':  color = COLOR_ACTIVE; break;
        case 'dead':    color = COLOR_DEAD; break;
        case 'rocket':  color = COLOR_ROCKET; break;
        case 'debris':  color = (obj.rcsSize === 'LARGE') ? COLOR_DEBRIS_L : COLOR_DEBRIS; break;
        default:        color = COLOR_UNKNOWN;
      }
      validColors.push(color);

      // Scale by RCS size (set by DataLoader as rcsSize) - halved as requested
      let scale = 7.5; // small
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

    // 1. Inner core pulsing sphere
    const coreGeo = new THREE.SphereGeometry(25, 16, 16);
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95
    });
    const coreMesh = new THREE.Mesh(coreGeo, coreMat);
    this.selectionMarkerGroup.add(coreMesh);

    // 2. Inner cyan halo ring
    const ringGeo = new THREE.RingGeometry(40, 52, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x00e5ff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85
    });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    this.selectionMarkerGroup.add(ringMesh);

    // 3. Outer yellow reticle crosshair (diamond ring)
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

    // If selected object changed, restore previous object's category color
    if (this.prevSelectedObjectIndex !== this.selectedObjectIndex) {
      if (this.prevSelectedObjectIndex !== -1) {
        const prevMi = this.indexToMesh.get(this.prevSelectedObjectIndex);
        if (prevMi !== undefined && this.validColors[prevMi]) {
          this.mesh.setColorAt(prevMi, this.validColors[prevMi]);
          if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
        }
      }
      this.prevSelectedObjectIndex = this.selectedObjectIndex;
    }

    const visibleList = this.visibleIndicesList || this.validMap;

    for (let vi = 0; vi < visibleList.length; vi++) {
      const origIdx = visibleList[vi];
      const mi = this.indexToMesh.get(origIdx);
      if (mi === undefined) continue;

      // If satellite was destroyed in simulation, keep it invisible
      if (this.destroyedCatalogIndices.has(origIdx)) {
        this.dummy.position.set(0, 0, 0);
        this.dummy.scale.set(0, 0, 0);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(mi, this.dummy.matrix);
        continue;
      }

      const satrec = this.satrecs[origIdx];
      if (!satrec) continue;

      const pv = satellite.propagate(satrec, now);
      const posEci = pv.position;

      if (posEci && typeof posEci.x === 'number' && isFinite(posEci.x)) {
        // ECI -> Three.js:  X=ECI.x, Y=ECI.z, Z=-ECI.y
        this.dummy.position.set(posEci.x, posEci.z, -posEci.y);
        
        let s = this.scales[mi];
        if (origIdx === this.selectedObjectIndex) {
          s *= 2.5; // Make selected object 2.5x larger and white
          this.mesh.setColorAt(mi, this.whiteColor);
        }
        
        this.dummy.scale.set(s, s, s);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(mi, this.dummy.matrix);
      }
    }

    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;

    // Update Selection Marker Halo
    if (this.selectedObjectIndex !== -1) {
      const selPos = this.getObjectPosition(this.selectedObjectIndex);
      if (selPos) {
        this.selectionMarkerGroup.position.copy(selPos);
        if (camera) {
          this.selectionMarkerGroup.lookAt(camera.position);
          const dist = camera.position.distanceTo(selPos);
          const scale = Math.max(0.5, Math.min(6.0, dist / 8000));
          this.selectionMarkerGroup.scale.set(scale, scale, scale);
        }
        if (this.reticleRing) {
          this.reticleRing.rotation.z += 0.02; // Rotate reticle ring
        }
        this.selectionMarkerGroup.visible = true;
      } else {
        this.selectionMarkerGroup.visible = false;
      }
    } else if (this.selectionMarkerGroup) {
      this.selectionMarkerGroup.visible = false;
    }
  }

  setVisibleObjects(objectIndices) {
    this.visibleSet = new Set(objectIndices);
    this.visibleIndicesList = objectIndices;

    if (!this.mesh) return;

    // Batch zero-out matrices for instances that became hidden
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

    // 1. Try standard geometric Raycaster first
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(screenPos, camera);
    const intersects = raycaster.intersectObject(this.mesh);
    if (intersects.length > 0) {
      const instanceId = intersects[0].instanceId;
      if (instanceId < this.validMap.length) {
        return this.validMap[instanceId];
      }
    }

    // 2. Fallback to 2D Screen-space Proximity picking (32px touch/click radius tolerance)
    const clickX = ((screenPos.x + 1) / 2) * canvasWidth;
    const clickY = ((1 - screenPos.y) / 2) * canvasHeight;

    let closestIdx = -1;
    let minDistanceSq = 32 * 32;

    const projPos = new THREE.Vector3();
    const tempMatrix = new THREE.Matrix4();
    const earthSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 6371);
    const ray = new THREE.Ray();
    const hitPoint = new THREE.Vector3();

    for (let mi = 0; mi < this.validMap.length; mi++) {
      const origIdx = this.validMap[mi];
      if (!this.visibleSet.has(origIdx)) continue;

      this.mesh.getMatrixAt(mi, tempMatrix);
      projPos.setFromMatrixPosition(tempMatrix);

      // Occlusion check: Don't pick objects behind Earth relative to camera
      const dir = projPos.clone().sub(camera.position);
      const distToObj = dir.length();
      dir.normalize();

      ray.set(camera.position, dir);
      if (ray.intersectSphere(earthSphere, hitPoint)) {
        if (hitPoint.distanceTo(camera.position) < distToObj - 50) {
          continue; // Hidden behind Earth
        }
      }

      projPos.project(camera); // Project to NDC [-1, 1]
      if (projPos.z > 1.0) continue; // Behind camera clipping plane

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

  getObjectPosition(index) {
    const satrec = this.satrecs[index];
    if (!satrec) return null;

    const pv = satellite.propagate(satrec, new Date());
    const p = pv.position;
    if (p && typeof p.x === 'number' && isFinite(p.x)) {
      return new THREE.Vector3(p.x, p.z, -p.y);
    }
    return null;
  }

  /**
   * Computes the actual orbital velocity vector via SGP4 numerical differentiation.
   * Uses central difference: v ≈ (r(t+dt) - r(t-dt)) / (2*dt)
   * This preserves the true orbital inclination and angular momentum direction.
   * Returns velocity in km/s in Three.js coordinate space.
   */
  getObjectVelocity(index) {
    const satrec = this.satrecs[index];
    if (!satrec) return null;

    const now = new Date();
    const dtMs = 500; // 0.5 second offset for central difference
    const dtSec = dtMs / 1000;

    const tBefore = new Date(now.getTime() - dtMs);
    const tAfter  = new Date(now.getTime() + dtMs);

    const pvBefore = satellite.propagate(satrec, tBefore);
    const pvAfter  = satellite.propagate(satrec, tAfter);

    if (!pvBefore.position || !pvAfter.position) return null;
    if (!isFinite(pvBefore.position.x) || !isFinite(pvAfter.position.x)) return null;

    // ECI -> Three.js: X=ECI.x, Y=ECI.z, Z=-ECI.y
    const dt2 = 2 * dtSec;
    const vx = (pvAfter.position.x - pvBefore.position.x) / dt2;
    const vy = (pvAfter.position.z - pvBefore.position.z) / dt2; // ECI.z -> Three.js Y
    const vz = -(pvAfter.position.y - pvBefore.position.y) / dt2; // -ECI.y -> Three.js Z

    return new THREE.Vector3(vx, vy, vz);
  }

  showOrbitPath(objectIndex) {
    this.selectedObjectIndex = objectIndex;
    this.clearOrbitPath();
    this.selectedObjectIndex = objectIndex; // Restore selected index after clear

    const satrec = this.satrecs[objectIndex];
    if (!satrec) return;

    const now = new Date();
    // Period in minutes = 1440 / mean_motion (rev/day)
    const mmRevDay = this.objects[objectIndex]?.MEAN_MOTION || 15;
    const periodMin = 1440 / mmRevDay;
    const periodMs = periodMin * 60 * 1000;

    const points = [];
    const segments = 150;

    for (let i = 0; i <= segments; i++) {
      const time = new Date(now.getTime() + (i / segments) * periodMs);
      const pv = satellite.propagate(satrec, time);
      if (pv.position && isFinite(pv.position.x)) {
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
      this.selectedObjectIndex = objectIndex;
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
   * Finds the first catalog satellite or debris object within radiusKm of a 3D position
   * Checks across the full catalog by filtering matching altitude shells.
   */
  findNearbySatellite(position, radiusKm = 45.0) {
    if (!position || !this.validMap || this.validMap.length === 0) return null;
    const thresholdSq = radiusKm * radiusKm;
    const pVec = new THREE.Vector3(position.x, position.y, position.z);
    const pDist = pVec.length();
    const pAlt = pDist - 6378.137;

    const targetPos = new THREE.Vector3();
    const mat = new THREE.Matrix4();
    const now = new Date();

    const allObjects = this.dataLoader.getObjects();
    const totalValid = this.validMap.length;

    for (let vi = 0; vi < totalValid; vi++) {
      const origIdx = this.validMap[vi];
      if (this.destroyedCatalogIndices.has(origIdx)) continue; // Skip already destroyed

      const obj = allObjects[origIdx];
      if (!obj) continue;

      // Fast altitude filter: skip if object orbit altitude range is far away (>60km)
      const apo = obj.apo || 600;
      const peri = obj.peri || 500;
      if (pAlt < (peri - 60) || pAlt > (apo + 60)) continue;

      // Check if current position in visible LOD mesh is active and currently rendered
      const mi = this.indexToMesh.get(origIdx);
      if (mi !== undefined && this.visibleSet && this.visibleSet.has(origIdx) && this.mesh) {
        this.mesh.getMatrixAt(mi, mat);
        targetPos.setFromMatrixPosition(mat);

        if (targetPos.lengthSq() > 1000) {
          const distSq = targetPos.distanceToSquared(pVec);
          if (distSq <= thresholdSq) {
            const vel = this.getObjectVelocity(origIdx);
            return {
              ...obj,
              index: origIdx,
              position: { x: targetPos.x, y: targetPos.y, z: targetPos.z },
              velocity: vel ? { vx: vel.x, vy: vel.y, vz: vel.z } : null
            };
          }
          continue;
        }
      }

      // If not in currently rendered mesh LOD, evaluate SGP4 on the fly for altitude-matched candidates
      const satrec = this.satrecs[origIdx];
      if (satrec) {
        const pv = satellite.propagate(satrec, now);
        if (pv.position && isFinite(pv.position.x)) {
          targetPos.set(pv.position.x, pv.position.z, -pv.position.y);
          const distSq = targetPos.distanceToSquared(pVec);
          if (distSq <= thresholdSq) {
            const vel = this.getObjectVelocity(origIdx);
            return {
              ...obj,
              index: origIdx,
              position: { x: targetPos.x, y: targetPos.y, z: targetPos.z },
              velocity: vel ? { vx: vel.x, vy: vel.y, vz: vel.z } : null
            };
          }
        }
      }
    }
    return null;
  }
}
