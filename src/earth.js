/**
 * SpaceDebris — Photorealistic Earth Globe Renderer
 * High-fidelity 4K Earth shader with crisp day/night terminator, 
 * soft night-side continent visibility, golden city lights, and Rayleigh atmosphere scattering.
 */

import * as THREE from 'three';

export class Earth {
  constructor() {
    this.radius = 6371; // km
    this.angularVelocity = (2 * Math.PI) / (23 * 3600 + 56 * 60 + 4); // Sidereal day
    this.sunDirection = new THREE.Vector3(1.0, 0.35, 0.8).normalize();

    // Root group containing earth mesh, grid, atmosphere
    this.group = new THREE.Group();

    this._initEarth();
    this._initGrid();
    this._initAtmosphere();
  }

  _initEarth() {
    const geo = new THREE.SphereGeometry(this.radius, 64, 64);
    const textureLoader = new THREE.TextureLoader();

    // Load textures with sRGB color space & 16x anisotropic filtering for maximum 4K crispness
    const loadTexture = (path) => {
      const tex = textureLoader.load(path);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 16;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = true;
      return tex;
    };

    const dayTex = loadTexture('./data/textures/earth-blue-marble.jpg');
    const nightTex = loadTexture('./data/textures/earth-night.png');
    const waterTex = loadTexture('./data/textures/earth-water.png');

    this.earthUniforms = {
      uDayMap: { value: dayTex },
      uNightMap: { value: nightTex },
      uWaterMap: { value: waterTex },
      uSunDir: { value: this.sunDirection }
    };

    const mat = new THREE.ShaderMaterial({
      uniforms: this.earthUniforms,
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vWorldPos;

        void main() {
          vUv = uv;
          // Transform normal and position to world coordinates
          vNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPos = worldPos.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        uniform sampler2D uDayMap;
        uniform sampler2D uNightMap;
        uniform sampler2D uWaterMap;
        uniform vec3 uSunDir;

        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vWorldPos;

        void main() {
          vec3 normal = normalize(vNormal);
          vec3 viewDir = normalize(cameraPosition - vWorldPos);
          vec3 sunDir = normalize(uSunDir);

          float sunDot = dot(normal, sunDir);

          // 1. Day / Night transition weight across terminator
          float dayWeight = smoothstep(-0.15, 0.25, sunDot);

          // 2. Daytime Color (Sunlit satellite imagery with realistic contrast)
          vec4 dayTexColor = texture2D(uDayMap, vUv);
          float diffuse = max(0.0, sunDot) * 0.9 + 0.1;
          vec3 dayColor = dayTexColor.rgb * diffuse;

          // Ocean Specular Glint (sun reflection only on water surface during daytime)
          float waterMask = texture2D(uWaterMap, vUv).r;
          vec3 halfVector = normalize(sunDir + viewDir);
          float specAngle = max(0.0, dot(normal, halfVector));
          float specular = pow(specAngle, 28.0) * waterMask * dayWeight * 0.55;
          dayColor += vec3(specular * 0.9, specular * 0.95, specular * 1.0);

          // 3. Nighttime Color (Deep space night with recognizable geography & city lights)
          // Soft ambient illumination so continents and oceans remain distinct without being washed out
          vec3 nightBase = dayTexColor.rgb * vec3(0.09, 0.14, 0.22);

          // Golden City Lights
          vec4 nightTexColor = texture2D(uNightMap, vUv);
          vec3 cityLights = nightTexColor.rgb * vec3(1.3, 1.1, 0.8) * 1.6;

          vec3 nightColor = nightBase + cityLights;

          // 4. Smooth Composite
          vec3 finalColor = mix(nightColor, dayColor, dayWeight);

          gl_FragColor = vec4(finalColor, 1.0);
        }
      `
    });

    this._earthMesh = new THREE.Mesh(geo, mat);
    
    // In ECI frame, Earth's rotational axis is the polar axis (Three.js Y-axis).
    // Equatorial plane is X-Z plane, matching satellite orbit coordinate definitions.

    this.group.add(this._earthMesh);
  }

  _initGrid() {
    const mat = new THREE.LineBasicMaterial({
      color: 0x4477aa,
      transparent: true,
      opacity: 0.16
    });
    const r = this.radius * 1.002;
    const gridGroup = new THREE.Group();

    // Latitude lines (every 30°)
    for (let lat = -60; lat <= 60; lat += 30) {
      const points = [];
      const phi = (90 - lat) * (Math.PI / 180);
      for (let lng = 0; lng <= 360; lng += 4) {
        const theta = lng * (Math.PI / 180);
        points.push(new THREE.Vector3(
          r * Math.sin(phi) * Math.cos(theta),
          r * Math.cos(phi),
          r * Math.sin(phi) * Math.sin(theta)
        ));
      }
      gridGroup.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points), mat
      ));
    }

    // Longitude lines (every 30°)
    for (let lng = 0; lng < 360; lng += 30) {
      const points = [];
      const theta = lng * (Math.PI / 180);
      for (let lat = -90; lat <= 90; lat += 4) {
        const phi = (90 - lat) * (Math.PI / 180);
        points.push(new THREE.Vector3(
          r * Math.sin(phi) * Math.cos(theta),
          r * Math.cos(phi),
          r * Math.sin(phi) * Math.sin(theta)
        ));
      }
      gridGroup.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points), mat
      ));
    }

    // Equator highlight
    const eqPoints = [];
    const eqMat = new THREE.LineBasicMaterial({
      color: 0x00e5ff, transparent: true, opacity: 0.22
    });
    for (let lng = 0; lng <= 360; lng += 2) {
      const theta = lng * (Math.PI / 180);
      eqPoints.push(new THREE.Vector3(
        r * Math.cos(theta), 0, r * Math.sin(theta)
      ));
    }
    gridGroup.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(eqPoints), eqMat
    ));

    this.group.add(gridGroup);
  }

  _initAtmosphere() {
    const atmoRadius = 6460;
    const geo = new THREE.SphereGeometry(atmoRadius, 64, 64);

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uSunDir: { value: this.sunDirection }
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vViewDir;
        varying vec3 vWorldNormal;

        void main() {
          vNormal = normalize(normalMatrix * normal);
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
          vViewDir = normalize(cameraPosition - worldPos.xyz);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uSunDir;
        varying vec3 vNormal;
        varying vec3 vViewDir;
        varying vec3 vWorldNormal;

        void main() {
          vec3 sunDir = normalize(uSunDir);
          float fresnel = 1.0 - max(0.0, dot(vNormal, vViewDir));
          fresnel = pow(fresnel, 3.8);

          // Atmosphere scatter is illuminated on sun-facing side and fades on dark side
          float sunFacing = max(0.0, dot(vWorldNormal, sunDir) * 0.6 + 0.4);

          vec3 atmoColor = mix(vec3(0.08, 0.35, 0.75), vec3(0.2, 0.65, 1.0), fresnel);
          gl_FragColor = vec4(atmoColor, fresnel * sunFacing * 0.38);
        }
      `,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false
    });

    this._atmosphereMesh = new THREE.Mesh(geo, mat);
    this.group.add(this._atmosphereMesh);
  }

  update(deltaTimeSec) {
    if (deltaTimeSec > 0) {
      this.group.rotation.y += this.angularVelocity * deltaTimeSec;
    }
  }

  /**
   * Returns the root group. Add this to the scene via scene.add(earth.getMesh()).
   * Contains earth sphere, grid, atmosphere, and lights.
   */
  getMesh() {
    return this.group;
  }

  /**
   * Returns just the earth sphere for raycasting purposes.
   */
  getEarthSphere() {
    return this._earthMesh;
  }
}
