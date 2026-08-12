import * as THREE from 'three';

export class Earth {
    constructor(scene) {
        this.scene = scene;
        this.radius = 6371;
        this.angularVelocity = (2 * Math.PI) / (24 * 60 * 60); // rad/sec
        
        this.earthGroup = new THREE.Group();
        this.scene.add(this.earthGroup);

        this.initEarth();
        this.initAtmosphere();
        this.initGrid();
        this.initLights();
    }

    initEarth() {
        const geometry = new THREE.SphereGeometry(this.radius, 64, 64);
        const material = new THREE.MeshPhongMaterial({
            color: 0x1a3a5c,
            emissive: 0x0a1628,
            shininess: 15
        });
        this.earthMesh = new THREE.Mesh(geometry, material);
        this.earthGroup.add(this.earthMesh);
    }

    initGrid() {
        const material = new THREE.LineBasicMaterial({ color: 0x446688, transparent: true, opacity: 0.2 });
        const radius = this.radius * 1.001;
        
        const gridGroup = new THREE.Group();

        // Latitudes
        for (let lat = -90; lat <= 90; lat += 30) {
            const points = [];
            const phi = (90 - lat) * (Math.PI / 180);
            for (let lng = 0; lng <= 360; lng += 5) {
                const theta = lng * (Math.PI / 180);
                const x = radius * Math.sin(phi) * Math.cos(theta);
                const y = radius * Math.cos(phi);
                const z = radius * Math.sin(phi) * Math.sin(theta);
                points.push(new THREE.Vector3(x, y, z));
            }
            const geometry = new THREE.BufferGeometry().setFromPoints(points);
            gridGroup.add(new THREE.Line(geometry, material));
        }

        // Longitudes
        for (let lng = 0; lng < 360; lng += 30) {
            const points = [];
            const theta = lng * (Math.PI / 180);
            for (let lat = -90; lat <= 90; lat += 5) {
                const phi = (90 - lat) * (Math.PI / 180);
                const x = radius * Math.sin(phi) * Math.cos(theta);
                const y = radius * Math.cos(phi);
                const z = radius * Math.sin(phi) * Math.sin(theta);
                points.push(new THREE.Vector3(x, y, z));
            }
            const geometry = new THREE.BufferGeometry().setFromPoints(points);
            gridGroup.add(new THREE.Line(geometry, material));
        }

        this.earthGroup.add(gridGroup);
    }

    initAtmosphere() {
        const atmoRadius = 6500;
        const geometry = new THREE.SphereGeometry(atmoRadius, 64, 64);
        
        const vertexShader = `
            varying vec3 vNormal;
            void main() {
                vNormal = normalize(normalMatrix * normal);
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `;
        
        const fragmentShader = `
            varying vec3 vNormal;
            void main() {
                float intensity = pow(0.6 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 4.0);
                gl_FragColor = vec4(0.3, 0.6, 1.0, 1.0) * intensity;
            }
        `;

        const material = new THREE.ShaderMaterial({
            vertexShader,
            fragmentShader,
            blending: THREE.AdditiveBlending,
            side: THREE.BackSide,
            transparent: true,
            depthWrite: false
        });

        this.atmosphereMesh = new THREE.Mesh(geometry, material);
        this.earthGroup.add(this.atmosphereMesh);
    }

    initLights() {
        this.sunLight = new THREE.DirectionalLight(0xffffff, 2.0);
        this.sunLight.position.set(1, 0, 1).normalize();
        this.scene.add(this.sunLight);

        this.ambientLight = new THREE.AmbientLight(0x222244);
        this.scene.add(this.ambientLight);
    }

    update(deltaTime) {
        if (deltaTime) {
             this.earthGroup.rotation.y += this.angularVelocity * deltaTime;
        }
    }

    getMesh() {
        return this.earthMesh;
    }
}
