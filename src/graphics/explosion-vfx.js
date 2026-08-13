/**
 * SpaceDebris — GPU Particle Explosion & Reentry Visual Effects
 * Renders high-performance particle flares, expand rings, and atmospheric reentry burn trails.
 * Brightness is kept subtle to complement the subdued bloom pipeline.
 */

import * as THREE from 'three';

export class VisualEffectsManager {
  constructor(scene) {
    this.scene = scene;
    this.explosions = [];
    this.reentries = [];
  }

  /**
   * Triggers a 3D explosion effect at position
   * @param {THREE.Vector3|Object} position - {x, y, z} in Three.js coordinates
   * @param {number} energyScale - Relative explosion power (1.0 = normal)
   */
  triggerExplosion(position, energyScale = 1.0) {
    // Cap particles to keep VFX lightweight
    const particleCount = Math.min(200, Math.floor(80 * energyScale));
    const geo = new THREE.BufferGeometry();

    const positions = new Float32Array(particleCount * 3);
    const velocities = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);

    const baseColor = new THREE.Color();

    for (let i = 0; i < particleCount; i++) {
      positions[i * 3]     = position.x;
      positions[i * 3 + 1] = position.y;
      positions[i * 3 + 2] = position.z;

      // Isotropic spherical velocity spread
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const speed = (10 + Math.random() * 40) * Math.cbrt(energyScale);

      velocities[i * 3]     = speed * Math.sin(phi) * Math.cos(theta);
      velocities[i * 3 + 1] = speed * Math.sin(phi) * Math.sin(theta);
      velocities[i * 3 + 2] = speed * Math.cos(phi);

      // Muted fire colors
      const colorRatio = Math.random();
      if (colorRatio > 0.7) {
        baseColor.setHex(0x00aacc); // Teal
      } else if (colorRatio > 0.3) {
        baseColor.setHex(0xcc7700); // Dim amber
      } else {
        baseColor.setHex(0xcc2200); // Dim red
      }

      colors[i * 3]     = baseColor.r;
      colors[i * 3 + 1] = baseColor.g;
      colors[i * 3 + 2] = baseColor.b;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
      size: 8,          // Much smaller than before (was 30)
      vertexColors: true,
      transparent: true,
      opacity: 0.6,     // Start dimmer (was 1.0)
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    const pSystem = new THREE.Points(geo, mat);
    this.scene.add(pSystem);

    // Shockwave Ring — also much dimmer
    const ringGeo = new THREE.RingGeometry(1, 5, 24);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x0088aa,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.25,     // Was 0.8
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.position.set(position.x, position.y, position.z);
    ringMesh.lookAt(0, 0, 0);
    this.scene.add(ringMesh);

    this.explosions.push({
      pSystem,
      ringMesh,
      maxAge: 2.0,
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
      opacity: 0.6,
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
      exp.pSystem.material.opacity = 0.6 * Math.pow(1.0 - progress, 2.0);

      // Expand ring — much smaller expansion (was 800x)
      const ringScale = 1.0 + progress * 150 * Math.sqrt(exp.energyScale);
      exp.ringMesh.scale.set(ringScale, ringScale, ringScale);
      exp.ringMesh.material.opacity = 0.25 * Math.pow(1.0 - progress, 2.0);
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
      re.line.material.opacity = 0.6 * (1.0 - progress);
    }
  }
}
