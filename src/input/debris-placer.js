/**
 * SpaceDebris — 3D Drag-to-Place Debris Placement Interface
 * Allows users to click on the 3D globe to pick an orbit location,
 * drag a vector arrow to specify launch velocity and direction,
 * view a real-time orbital trajectory preview, and launch the particle.
 */

import * as THREE from 'three';

export class DebrisPlacer {
  constructor(scene, camera, domElement) {
    this.scene = scene;
    this.camera = camera;
    this.domElement = domElement;

    this.active = false;
    this.isDragging = false;

    this.startPos = null; // {x, y, z} on Earth surface or altitude
    this.velocityVec = new THREE.Vector3();
    this.targetAltitudeKm = 400; // default 400km LEO

    // Visual Helpers
    this.markerMesh = null;
    this.arrowHelper = null;
    this.orbitPreviewLine = null;

    this.onLaunch = null; // Callback: (particleData) => {}

    this.initHelpers();
    this.bindEvents();
  }

  initHelpers() {
    // 1. Placement sphere marker
    const markerGeo = new THREE.SphereGeometry(30, 16, 16); // 30km size visual
    const markerMat = new THREE.MeshBasicMaterial({
      color: 0x00e5ff,
      wireframe: true,
      transparent: true,
      opacity: 0.8
    });
    this.markerMesh = new THREE.Mesh(markerGeo, markerMat);
    this.markerMesh.visible = false;
    this.scene.add(this.markerMesh);

    // 2. Velocity Arrow Helper
    this.arrowHelper = new THREE.ArrowHelper(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, 0),
      1,
      0xff9100,
      100,
      50
    );
    this.arrowHelper.visible = false;
    this.scene.add(this.arrowHelper);

    // 3. Orbit Trajectory Preview Line
    const previewGeo = new THREE.BufferGeometry();
    const points = new Float32Array(100 * 3);
    previewGeo.setAttribute('position', new THREE.BufferAttribute(points, 3));

    const previewMat = new THREE.LineDashedMaterial({
      color: 0x00e5ff,
      dashSize: 100,
      gapSize: 50,
      linewidth: 2,
      transparent: true,
      opacity: 0.7
    });

    this.orbitPreviewLine = new THREE.LineLoop(previewGeo, previewMat);
    this.orbitPreviewLine.visible = false;
    this.scene.add(this.orbitPreviewLine);
  }

  setActive(active) {
    this.active = active;
    if (!active) {
      this.cancel();
    }
  }

  cancel() {
    this.isDragging = false;
    this.markerMesh.visible = false;
    this.arrowHelper.visible = false;
    this.orbitPreviewLine.visible = false;
  }

  bindEvents() {
    this.domElement.addEventListener('pointerdown', (e) => {
      if (!this.active || e.button !== 0) return;

      const rect = this.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );

      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, this.camera);

      // Raycast against Earth sphere (r = 6371km)
      const earthSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 6371 + this.targetAltitudeKm);
      const intersectPoint = new THREE.Vector3();

      if (raycaster.ray.intersectSphere(earthSphere, intersectPoint)) {
        this.isDragging = true;
        this.startPos = intersectPoint.clone();

        this.markerMesh.position.copy(this.startPos);
        this.markerMesh.visible = true;

        // Default prograde circular velocity direction (tangent to position)
        // v_circ = sqrt(mu / r) ~ 7.67 km/s
        const r = this.startPos.length();
        const vMag = Math.sqrt(398600.4418 / r);

        // Compute tangent vector (cross product with north pole or arbitrary vector)
        const up = new THREE.Vector3(0, 1, 0);
        const tangent = new THREE.Vector3().crossVectors(this.startPos, up).normalize();
        if (tangent.lengthSq() < 0.1) {
          tangent.crossVectors(this.startPos, new THREE.Vector3(1, 0, 0)).normalize();
        }

        this.velocityVec.copy(tangent).multiplyScalar(vMag);
        this.updateHelpers();
      }
    });

    this.domElement.addEventListener('pointermove', (e) => {
      if (!this.active || !this.isDragging) return;

      const rect = this.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );

      // Map mouse drag vector to velocity direction & magnitude adjustment
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, this.camera);

      const dragPlane = new THREE.Plane(this.startPos.clone().normalize(), -this.startPos.length());
      const dragPoint = new THREE.Vector3();

      if (raycaster.ray.intersectPlane(dragPlane, dragPoint)) {
        const dragDir = new THREE.Vector3().subVectors(dragPoint, this.startPos);
        const dragDist = dragDir.length();

        if (dragDist > 10) {
          // Adjust velocity vector based on drag length and direction
          const vScale = Math.min(12.0, Math.max(3.0, dragDist / 50.0));
          this.velocityVec.copy(dragDir.normalize()).multiplyScalar(vScale);
          this.updateHelpers();
        }
      }
    });

    this.domElement.addEventListener('pointerup', () => {
      if (!this.active || !this.isDragging) return;

      this.isDragging = false;

      if (this.onLaunch && this.startPos) {
        this.onLaunch({
          position: { x: this.startPos.x, y: this.startPos.y, z: this.startPos.z },
          velocity: { vx: this.velocityVec.x, vy: this.velocityVec.y, vz: this.velocityVec.z },
          mass: 20.0,
          size: 0.3,
          areaToMass: 0.02
        });
      }

      this.cancel();
    });
  }

  updateHelpers() {
    if (!this.startPos) return;

    const vMag = this.velocityVec.length();
    const vDir = this.velocityVec.clone().normalize();

    // Arrow length proportional to velocity magnitude
    const arrowLen = vMag * 100;
    this.arrowHelper.setDirection(vDir);
    this.arrowHelper.setLength(arrowLen, 80, 40);
    this.arrowHelper.position.copy(this.startPos);
    this.arrowHelper.visible = true;

    // Orbit Preview Line (100 Keplerian points)
    const points = [];
    let r = this.startPos.clone();
    let v = this.velocityVec.clone();
    const dt = 100; // 100s time step for preview loop

    for (let i = 0; i < 100; i++) {
      points.push(r.x, r.y, r.z);

      // Keplerian step
      const rMag = r.length();
      const a = r.clone().multiplyScalar(-398600.4418 / (rMag * rMag * rMag));
      v.addScaledVector(a, dt);
      r.addScaledVector(v, dt);
    }

    const posAttr = this.orbitPreviewLine.geometry.attributes.position;
    for (let i = 0; i < 100; i++) {
      posAttr.setXYZ(i, points[i * 3], points[i * 3 + 1], points[i * 3 + 2]);
    }
    posAttr.needsUpdate = true;
    this.orbitPreviewLine.computeLineDistances();
    this.orbitPreviewLine.visible = true;
  }
}
