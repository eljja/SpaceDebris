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
const COLOR_DEBRIS  = new THREE.Color(0x94a3b8); // Gray
const COLOR_DEBRIS_L = new THREE.Color(0xff1744); // Red (large debris)
const COLOR_UNKNOWN = new THREE.Color(0x667788); // Dim

export class OrbitRenderer {
  constructor(scene, dataLoader) {
    this.scene = scene;
    this.dataLoader = dataLoader;

    this.objects = this.dataLoader.getObjects() || [];
    this.satrecs = new Array(this.objects.length).fill(null);
    this.visibleSet = new Set();
    this.validMap = [];   // validMap[meshInstance] = originalIndex
    this.indexToMesh = new Map(); // originalIndex -> meshInstanceIndex
    this.scales = [];

    this.dummy = new THREE.Object3D();
    this.mesh = null;
    this.orbitPath = null;
    this.selectedObjectIndex = -1;

    this._buildSatrecs();
    this._buildMesh();

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

      // Scale by RCS size (set by DataLoader as rcsSize)
      let scale = 15;
      if (obj.rcsSize === 'LARGE') scale = 40;
      else if (obj.rcsSize === 'MEDIUM') scale = 25;
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

  update(now) {
    if (!this.mesh) return;

    for (let mi = 0; mi < this.validMap.length; mi++) {
      const origIdx = this.validMap[mi];

      // Check LOD/Filter visibility
      if (!this.visibleSet.has(origIdx)) {
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
        const s = this.scales[mi];
        this.dummy.scale.set(s, s, s);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(mi, this.dummy.matrix);
      } else {
        this.dummy.scale.set(0, 0, 0);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(mi, this.dummy.matrix);
      }
    }

    this.mesh.instanceMatrix.needsUpdate = true;
  }

  setVisibleObjects(objectIndices) {
    this.visibleSet = new Set(objectIndices);
  }

  getObjectAtScreenPosition(screenPos, camera) {
    if (!this.mesh) return null;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(screenPos, camera);

    const intersects = raycaster.intersectObject(this.mesh);
    if (intersects.length > 0) {
      const instanceId = intersects[0].instanceId;
      if (instanceId < this.validMap.length) {
        return this.validMap[instanceId]; // return original object index
      }
    }
    return null;
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

  showOrbitPath(objectIndex) {
    this.clearOrbitPath();

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
    if (this.orbitPath) {
      this.scene.remove(this.orbitPath);
      this.orbitPath.geometry.dispose();
      this.orbitPath.material.dispose();
      this.orbitPath = null;
    }
    this.selectedObjectIndex = -1;
  }
}
