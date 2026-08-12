import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class SceneManager {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        if (!this.container) {
            throw new Error(`Container with id '${containerId}' not found.`);
        }

        this.scene = new THREE.Scene();
        
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;

        this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 200000);
        this.camera.position.set(0, 0, 15000);

        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            logarithmicDepthBuffer: true,
            alpha: false
        });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setClearColor(0x020408);
        this.container.appendChild(this.renderer.domElement);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.minDistance = 6500;
        this.controls.maxDistance = 100000;

        this.renderCallbacks = [];

        this.initStarField();

        window.addEventListener('resize', this.onResize.bind(this), false);
        
        this.animate = this.animate.bind(this);
        this.animate();
    }

    initStarField() {
        const particleCount = 5000;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const sizes = new Float32Array(particleCount);
        const randoms = new Float32Array(particleCount);

        for (let i = 0; i < particleCount; i++) {
            const r = 50000 + Math.random() * 50000;
            const theta = 2 * Math.PI * Math.random();
            const phi = Math.acos(2 * Math.random() - 1);
            
            positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
            positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
            positions[i * 3 + 2] = r * Math.cos(phi);

            sizes[i] = Math.random() * 2 + 0.5;
            randoms[i] = Math.random();
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                time: { value: 0 },
                color: { value: new THREE.Color(0xffffff) }
            },
            vertexShader: `
                uniform float time;
                attribute float size;
                attribute float aRandom;
                varying float vAlpha;
                void main() {
                    vAlpha = 0.5 + 0.5 * sin(time * 2.0 + aRandom * 10.0);
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    gl_PointSize = size * (10000.0 / -mvPosition.z);
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                uniform vec3 color;
                varying float vAlpha;
                void main() {
                    vec2 xy = gl_PointCoord.xy - vec2(0.5);
                    float ll = length(xy);
                    if (ll > 0.5) discard;
                    gl_FragColor = vec4(color, vAlpha * (1.0 - ll * 2.0));
                }
            `,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });

        this.starField = new THREE.Points(geometry, material);
        this.scene.add(this.starField);
    }

    onResize() {
        if (!this.container) return;
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;
        
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        
        this.renderer.setSize(width, height);
    }

    addToRenderLoop(callback) {
        if (typeof callback === 'function') {
            this.renderCallbacks.push(callback);
        }
    }

    animate(time) {
        requestAnimationFrame(this.animate);
        
        this.controls.update();

        if (this.starField && this.starField.material.uniforms) {
            this.starField.material.uniforms.time.value = time * 0.001;
        }

        for (const callback of this.renderCallbacks) {
            callback(time);
        }

        this.renderer.render(this.scene, this.camera);
    }

    getCamera() { return this.camera; }
    getScene() { return this.scene; }
    getRenderer() { return this.renderer; }
    getControls() { return this.controls; }

    getCameraDistance() {
        return this.camera.position.length();
    }
}
