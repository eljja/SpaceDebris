/**
 * SpaceDebris — Post-Processing Pipeline
 * Uses Three.js EffectComposer, RenderPass, UnrealBloomPass, and OutputPass
 * to deliver HDR glow and space aesthetics.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export class PostProcessingManager {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.enabled = true;

    // Set linear color space & ACES Filmic tone mapping on base renderer
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.85;

    // Create Composer with HalfFloatType for HDR color depth
    const renderTarget = new THREE.WebGLRenderTarget(
      window.innerWidth,
      window.innerHeight,
      {
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        colorSpace: THREE.SRGBColorSpace
      }
    );

    this.composer = new EffectComposer(this.renderer, renderTarget);

    // 1. Render Pass
    const renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(renderPass);

    // 2. Unreal Bloom Pass (Glowing neon satellites & explosion flares)
    const resolution = new THREE.Vector2(window.innerWidth, window.innerHeight);
    this.bloomPass = new UnrealBloomPass(
      resolution,
      0.35, // Strength — subtle glow
      0.25, // Radius
      0.85  // Threshold — avoids blowing out Earth limb and specular
    );
    this.composer.addPass(this.bloomPass);

    // 3. Output Pass (Applies tone mapping and color space conversion)
    const outputPass = new OutputPass();
    this.composer.addPass(outputPass);

    this.onResize = this.onResize.bind(this);
    window.addEventListener('resize', this.onResize);
  }

  onResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.composer.setSize(width, height);
    this.bloomPass.resolution.set(width, height);
  }

  render() {
    if (this.enabled) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  setBloomParams(strength, radius, threshold) {
    if (strength !== undefined) this.bloomPass.strength = strength;
    if (radius !== undefined) this.bloomPass.radius = radius;
    if (threshold !== undefined) this.bloomPass.threshold = threshold;
  }
}
