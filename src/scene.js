/**
 * SpaceDebris — Three.js Scene Manager
 * Manages Scene, Camera, Renderer, OrbitControls, Star Field, and the render loop.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class SceneManager {
  constructor(containerElement) {
    // Accept either a DOM element or an ID string
    if (typeof containerElement === 'string') {
      this.container = document.getElementById(containerElement);
    } else {
      this.container = containerElement;
    }

    if (!this.container) {
      throw new Error('SceneManager: container element not found.');
    }

    this.clock = new THREE.Clock();

    // Scene
    this.scene = new THREE.Scene();

    // Camera
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 200000);
    this.camera.position.set(0, 5000, 20000);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      logarithmicDepthBuffer: true,
      alpha: false
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x020408);
    this.container.appendChild(this.renderer.domElement);

    // OrbitControls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.minDistance = 6500;
    this.controls.maxDistance = 100000;
    this.controls.rotateSpeed = 0.5;
    this.controls.zoomSpeed = 1.2;

    // Render loop callbacks
    this.renderCallbacks = [];

    // Star field
    this._initStarField();

    // Resize handler
    this._onResize = this._onResize.bind(this);
    window.addEventListener('resize', this._onResize, false);
  }

  _initStarField() {
    const count = 6000;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const randoms = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const r = 55000 + Math.random() * 45000;
      const theta = Math.PI * 2 * Math.random();
      const phi = Math.acos(2 * Math.random() - 1);

      positions[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);

      sizes[i] = 0.5 + Math.random() * 2.5;
      randoms[i] = Math.random();
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0.0 }
      },
      vertexShader: `
        uniform float uTime;
        attribute float size;
        attribute float aRandom;
        varying float vAlpha;
        void main() {
          vAlpha = 0.4 + 0.6 * sin(uTime * 1.5 + aRandom * 12.0);
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (8000.0 / -mvPosition.z);
          gl_PointSize = clamp(gl_PointSize, 0.5, 4.0);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying float vAlpha;
        void main() {
          vec2 uv = gl_PointCoord - vec2(0.5);
          float d = length(uv);
          if (d > 0.5) discard;
          float alpha = vAlpha * smoothstep(0.5, 0.1, d);
          gl_FragColor = vec4(1.0, 1.0, 1.0, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    this._starField = new THREE.Points(geometry, material);
    this.scene.add(this._starField);
  }

  _onResize() {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  addToRenderLoop(callback) {
    if (typeof callback === 'function') {
      this.renderCallbacks.push(callback);
    }
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    const delta = this.clock.getDelta();
    const elapsed = this.clock.getElapsedTime();

    // Twinkle stars
    if (this._starField) {
      this._starField.material.uniforms.uTime.value = elapsed;
    }

    // Execute registered callbacks with delta time
    for (const cb of this.renderCallbacks) {
      cb(delta);
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  // Accessors
  getCamera()   { return this.camera; }
  getScene()    { return this.scene; }
  getRenderer() { return this.renderer; }
  getControls() { return this.controls; }

  getCameraDistance() {
    return this.camera.position.length();
  }
}
