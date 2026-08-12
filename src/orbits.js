import * as THREE from 'three';
import * as satellite from 'satellite.js';

export class OrbitRenderer {
    constructor(scene, dataLoader) {
        this.scene = scene;
        this.dataLoader = dataLoader;
        
        this.objects = this.dataLoader.getObjects() || [];
        this.satrecs = [];
        this.visibleIndices = new Set(this.objects.map((_, i) => i));
        
        this.mesh = null;
        this.dummy = new THREE.Object3D();
        this.colors = [];
        this.scales = [];
        this.validIndices = []; // indices of objects that successfully generated a satrec
        
        this.orbitPath = null;
        this.selectedObjectIndex = -1;
        
        this.init();
    }
    
    init() {
        const geometry = new THREE.SphereGeometry(1, 6, 6);
        const material = new THREE.MeshBasicMaterial({ 
            color: 0xffffff,
            // Use vertex colors for InstancedMesh
        });
        
        // We might not render all objects if they exceed NORAD_CAT_ID 99999 or are invalid
        const validObjects = [];
        const validColors = [];
        const validScales = [];
        
        const colorCyan = new THREE.Color(0x00e5ff);
        const colorPurple = new THREE.Color(0xd500f9);
        const colorAmber = new THREE.Color(0xff9100);
        const colorGray = new THREE.Color(0x94a3b8);
        const colorRed = new THREE.Color(0xff1744);
        const colorWhite = new THREE.Color(0x667788);

        for (let i = 0; i < this.objects.length; i++) {
            const omm = this.objects[i];
            
            const tle = this.buildTLE(omm);
            if (!tle) {
                this.satrecs.push(null);
                continue;
            }
            
            let satrec = null;
            try {
                satrec = satellite.twoline2satrec(tle.line1, tle.line2);
            } catch (e) {
                // Ignore parse errors
            }
            
            if (satrec) {
                this.satrecs.push(satrec);
                this.validIndices.push(i);
                
                let objColor = colorWhite;
                if (omm.OBJECT_TYPE === 'PAYLOAD') {
                    // Check for active/dead if possible, assume active by default
                    if (omm.OPS_STATUS === '-' || omm.OPS_STATUS === 'D') {
                        objColor = colorPurple;
                    } else {
                        objColor = colorCyan;
                    }
                } else if (omm.OBJECT_TYPE === 'ROCKET BODY') {
                    objColor = colorAmber;
                } else if (omm.OBJECT_TYPE === 'DEBRIS') {
                    if (omm.RCS_SIZE === 'LARGE') {
                        objColor = colorRed;
                    } else {
                        objColor = colorGray;
                    }
                }
                validColors.push(objColor);
                
                let scale = 15;
                if (omm.RCS_SIZE === 'LARGE') scale = 40;
                else if (omm.RCS_SIZE === 'MEDIUM') scale = 25;
                
                validScales.push(scale);
            } else {
                this.satrecs.push(null);
            }
        }
        
        this.mesh = new THREE.InstancedMesh(geometry, material, this.validIndices.length);
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        
        for (let i = 0; i < this.validIndices.length; i++) {
            this.mesh.setColorAt(i, validColors[i]);
            this.scales.push(validScales[i]);
        }
        
        this.mesh.instanceColor.needsUpdate = true;
        this.scene.add(this.mesh);
        
        // Setup raycaster target mapping
        this.mesh.userData = { isOrbitRenderer: true };
    }
    
    buildTLE(omm) {
        if (!omm || !omm.NORAD_CAT_ID || omm.NORAD_CAT_ID > 99999) return null;

        const pad = (str, len, char = ' ', right = false) => {
            str = String(str);
            return right ? str.padEnd(len, char) : str.padStart(len, char);
        };

        const satnum = pad(omm.NORAD_CAT_ID, 5, '0');
        const classification = omm.CLASSIFICATION_TYPE || 'U';
        const intldes = pad(omm.INTLDES || '', 8, ' ', true);

        const epoch = new Date(omm.EPOCH || Date.now());
        const year = epoch.getUTCFullYear();
        const epochyr = pad(String(year).slice(-2), 2, '0');
        
        const startOfYear = new Date(Date.UTC(year, 0, 1));
        const epochdays = (epoch - startOfYear) / 86400000 + 1;
        const epochdaysStr = pad(epochdays.toFixed(8), 12, '0');

        let ndot = (omm.MEAN_MOTION_DOT || 0).toFixed(8).replace('0.', '.');
        if (ndot.charAt(0) !== '-') ndot = ' ' + ndot;
        ndot = pad(ndot.substring(0, 10), 10, ' ');

        const formatSci = (val) => {
            if (!val || val === 0) return ' 00000-0';
            let str = parseFloat(val).toExponential(4);
            let [m, e] = str.split('e');
            m = parseFloat(m) / 10;
            let eNum = parseInt(e) + 1;
            let sign = m < 0 ? '-' : ' ';
            let mStr = pad(Math.round(Math.abs(m) * 100000), 5, '0');
            let eSign = eNum < 0 ? '-' : '+';
            let eStr = String(Math.abs(eNum)).charAt(0);
            return `${sign}${mStr}${eSign}${eStr}`;
        };

        const nddot = formatSci(omm.MEAN_MOTION_DDOT);
        const bstar = formatSci(omm.BSTAR);
        const elset = pad(omm.ELEMENT_SET_NO || 1, 4, ' ');

        const line1 = `1 ${satnum}${classification} ${intldes} ${epochyr}${epochdaysStr} ${ndot} ${nddot} ${bstar} 0 ${elset}0`;

        const inclo = pad(parseFloat(omm.INCLINATION || 0).toFixed(4), 8, ' ');
        const nodeo = pad(parseFloat(omm.RA_OF_ASC_NODE || 0).toFixed(4), 8, ' ');
        const eccoStr = parseFloat(omm.ECCENTRICITY || 0).toFixed(7).substring(2);
        const ecco = pad(eccoStr, 7, '0');
        const argpo = pad(parseFloat(omm.ARG_OF_PERICENTER || 0).toFixed(4), 8, ' ');
        const mo = pad(parseFloat(omm.MEAN_ANOMALY || 0).toFixed(4), 8, ' ');
        const no = pad(parseFloat(omm.MEAN_MOTION || 0).toFixed(8), 11, ' ');
        const revnum = pad(omm.REV_AT_EPOCH || 0, 5, ' ');

        const line2 = `2 ${satnum} ${inclo} ${nodeo} ${ecco} ${argpo} ${mo} ${no}${revnum}0`;

        return { line1, line2 };
    }
    
    update(now) {
        if (!this.mesh) return;
        
        let displayCount = 0;
        
        for (let i = 0; i < this.validIndices.length; i++) {
            const originalIndex = this.validIndices[i];
            
            // Skip if not visible by LOD/Filters
            if (!this.visibleIndices.has(originalIndex)) {
                // Set matrix to zero scale to hide
                this.dummy.scale.set(0, 0, 0);
                this.dummy.updateMatrix();
                this.mesh.setMatrixAt(i, this.dummy.matrix);
                continue;
            }
            
            const satrec = this.satrecs[originalIndex];
            if (!satrec) continue;
            
            const positionAndVelocity = satellite.propagate(satrec, now);
            const positionEci = positionAndVelocity.position;
            
            if (positionEci && typeof positionEci.x === 'number') {
                // ECI coordinates in km
                // Three.js maps: X = ECI X, Y = ECI Z, Z = -ECI Y
                this.dummy.position.set(
                    positionEci.x,
                    positionEci.z,
                    -positionEci.y
                );
                
                const s = this.scales[i];
                this.dummy.scale.set(s, s, s);
                this.dummy.updateMatrix();
                this.mesh.setMatrixAt(i, this.dummy.matrix);
                displayCount++;
            } else {
                // Propagation failed, hide
                this.dummy.scale.set(0, 0, 0);
                this.dummy.updateMatrix();
                this.mesh.setMatrixAt(i, this.dummy.matrix);
            }
        }
        
        this.mesh.instanceMatrix.needsUpdate = true;
    }
    
    setVisibleObjects(objectIndices) {
        this.visibleIndices = new Set(objectIndices);
    }
    
    getObjectAtScreenPosition(screenPos, camera) {
        if (!this.mesh) return -1;
        
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(screenPos, camera);
        
        const intersects = raycaster.intersectObject(this.mesh);
        
        if (intersects.length > 0) {
            const instanceId = intersects[0].instanceId;
            return this.validIndices[instanceId];
        }
        
        return -1;
    }
    
    getObjectPosition(index) {
        const satrec = this.satrecs[index];
        if (!satrec) return null;
        
        const positionAndVelocity = satellite.propagate(satrec, new Date());
        const positionEci = positionAndVelocity.position;
        
        if (positionEci && typeof positionEci.x === 'number') {
            return new THREE.Vector3(
                positionEci.x,
                positionEci.z,
                -positionEci.y
            );
        }
        return null;
    }
    
    showOrbitPath(objectIndex) {
        this.clearOrbitPath();
        
        const satrec = this.satrecs[objectIndex];
        if (!satrec) return;
        
        const now = new Date();
        const periodMinutes = (24 * 60) / (satrec.no_kozai * (180 * 24 * 60) / Math.PI || 1); // rough period estimation
        const periodMs = periodMinutes * 60 * 1000;
        
        const points = [];
        const segments = 120;
        
        for (let i = 0; i <= segments; i++) {
            const time = new Date(now.getTime() + (i / segments) * periodMs);
            const pv = satellite.propagate(satrec, time);
            
            if (pv.position && typeof pv.position.x === 'number') {
                points.push(new THREE.Vector3(
                    pv.position.x,
                    pv.position.z,
                    -pv.position.y
                ));
            }
        }
        
        if (points.length > 1) {
            const geometry = new THREE.BufferGeometry().setFromPoints(points);
            const material = new THREE.LineBasicMaterial({ 
                color: 0xffffff,
                transparent: true,
                opacity: 0.5
            });
            this.orbitPath = new THREE.Line(geometry, material);
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
