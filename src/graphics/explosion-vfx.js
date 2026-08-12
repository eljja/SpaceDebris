/**
 * SpaceDebris — GPU Particle Explosion & Reentry Visual Effects
 * Renders high-performance particle flares, expand rings, and atmospheric reentry burn trails.
 */

import * as THREE from 'three';

export class VisualEffectsManager {
  constructor(scene) {
    this.scene = scene;
    this.explosions = [];
    this.reentries = [];

    // Shared geometry for explosion particles
    this.particleGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(300 * 3);
    for (let i = 0; i < 300 * 3; i++) positions[i] = 0;
    this.particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  }

  /**
   * Triggers a 3D explosion effect at position
   * @param {THREE.Vector3|Object} position - {x, y, z} in Three.js coordinates
   * @param {number} energyScale - Relative explosion power (1.0 = normal)
   */
  triggerExplosion(position, energyScale = 1.0) {
    const particleCount = Math.min(600, Math.floor(150 * energyScale));
    const geo = new THREE.BufferGeometry();

    const positions = new Float32Array(particleCount * 3);
    const velocities = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    const sizes = new Float32Array(particleCount);

    const baseColor = new THREE.Color();

    for (let i = 0; i < particleCount; i++) {
      // Start at explosion center
      positions[i * 3] = position.x;
      positions[i * 3 + 1] = position.y;
      positions[i * 3 + 2] = position.z;

      // Isotropic spherical velocity spread
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const speed = (20 + Math.random() * 80) * Math.cbrt(energyScale);

      velocities[i * 3] = speed * Math.sin(phi) * Math.cos(theta);
      velocities[i * 3 + 1] = speed * Math.sin(phi) * Math.sin(theta);
      velocities[i * 3 + 2] = speed * Math.cos(phi);

      // Fire colors: Cyan/White core -> Orange -> Red
      const colorRatio = Math.random();
      if (colorRatio > 0.6) {
        baseColor.setHex(0x00e5ff); // Cyan high energy
      } else if (colorRatio > 0.2) {
        baseColor.setHex(0xff9100); // Amber flame
      } else {
        baseColor.setHex(0xff1744); // Red heat
      }

      colors[i * 3] = baseColor.r;
      colors[i * 3 + 1] = baseColor.g;
      colors[i * 3 + 2] = baseColor.b;

      sizes[i] = (15 + Math.random() * 25) * Math.sqrt(energyScale);
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const mat = new THREE.PointsMaterial({
      size: 30,
      vertexColors: true,
      transparent: true,
      opacity: 1.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    const pSystem = new THREE.Points(geo, mat);
    this.scene.add(pSystem);

    // Shockwave Ring mesh
    const ringGeo = new THREE.RingGeometry(1, 10, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x00e5ff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.position.set(position.x, position.y, position.z);
    ringMesh.lookAt(0, 0, 0); // Orient towards center or random
    this.scene.add(ringMesh);

    this.explosions.push({
      pSystem,
      ringMesh,
      maxAge: 2.5, // seconds
      age: 0,
      energyScale
    });
  }

  /**
   * Triggers an atmospheric reentry burn streak
   */
  triggerReentry(position, velocity) {
    const geo = new THREE.BufferGeometry();
    const posArr = new Float32Array([
      position.x, position.y, position.z,
      position.x - velocity.x * 5, position.y - velocity.y * 5, position.z - velocity.z * 5
    ]);
    geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));

    const mat = new THREE.LineBasicMaterial({
      color: 0xff3d00,
      transparent: true,
      opacity: 1.0,
      blending: THREE.AdditiveBlending,
      linewidth: 2
    });

    const line = new THREE.Line(geo, mat);
    this.scene.add(line);

    this.reentries.push({ line, age: 0, maxAge: 1.5 });
  }

  update(deltaTimeSec) {
    // Update Explosions
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const exp = this.explosions[i];
      exp.age += deltaTimeSec;
      const progress = exp.age / exp.maxAge;

      if (progress >= 1.0) {
        this.scene.remove(exp.pSystem);
        this.scene.remove(exp.ringMesh);
        exp.pSystem.geometry.dispose();
        exp.pSystem.material.dispose();
        exp.ringMesh.geometry.dispose();
        exp.ringMesh.material.dispose();
        this.explosions.splice(i, 1);
        continue;
      }

      // Update particle positions
      const posAttr = exp.pSystem.geometry.attributes.position;
      const velAttr = exp.pSystem.geometry.attributes.velocity;
      const count = posAttr.count;

      for (let k = 0; k < count; k++) {
        posAttr.setXYZ(
          k,
          posAttr.getX(k) + velAttr.getX(k) * deltaTimeSec,
          posAttr.getY(k) + velAttr.getY(k) * deltaTimeSec,
          posAttr.getZ(k) + velAttr.getZ(k) * deltaTimeSec
        );
      }
      posAttr.needsUpdate = true;

      // Fade opacity
      exp.pSystem.material.opacity = Math.pow(1.0 - progress, 1.5);

      // Expand ring
      const ringScale = 1.0 + progress * 800 * Math.sqrt(exp.energyScale);
      exp.ringMesh.scale.set(ringScale, ringScale, ringScale);
      exp.ringMesh.material.opacity = Math.pow(1.0 - progress, 2.0) * 0.7;
    }

    // Update Reentries
    for (let i = this.reentries.length - 1; i >= 0; i--) {
      const re = this.reentries[i];
      re.age += deltaTimeSec;
      const progress = re.age / re.maxAge;

      if (progress >= 1.0) {
        this.scene.remove(re.line);
        re.line.geometry.dispose();
        re.line.material.dispose();
        this.reentries.splice(i, 1);
        continue;
      }
      re.line.material.opacity = 1.0 - progress;
    }
  }
}
