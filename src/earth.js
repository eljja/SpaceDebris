/**
 * SpaceDebris — Earth Globe Renderer
 * Creates Earth sphere, lat/lon grid, Fresnel atmosphere glow, and lighting.
 */

import * as THREE from 'three';

export class Earth {
  constructor() {
    this.radius = 6371; // km
    this.angularVelocity = (2 * Math.PI) / (23 * 3600 + 56 * 60 + 4); // Sidereal day

    // Root group containing earth mesh, grid, atmosphere, and lights
    this.group = new THREE.Group();

    this._initEarth();
    this._initGrid();
    this._initAtmosphere();
    this._initLights();
  }

  _initEarth() {
    const geo = new THREE.SphereGeometry(this.radius, 64, 64);
    
    const textureLoader = new THREE.TextureLoader();
    const mat = new THREE.MeshPhongMaterial({
      map: textureLoader.load('./data/textures/earth-blue-marble.jpg'),
      specularMap: textureLoader.load('./data/textures/earth-water.png'),
      bumpMap: textureLoader.load('./data/textures/earth-topology.png'),
      bumpScale: 3,
      specular: new THREE.Color(0x222222), // Soft, non-blinding specular
      shininess: 15,
      emissiveMap: textureLoader.load('./data/textures/earth-night.png'),
      emissive: new THREE.Color(0xffd580), // Warm golden city lights
      emissiveIntensity: 0.8
    });
    
    this._earthMesh = new THREE.Mesh(geo, mat);
    
    // Tilt the Earth slightly (axial tilt ~23.5 degrees)
    this._earthMesh.rotation.z = 23.5 * Math.PI / 180;
    
    this.group.add(this._earthMesh);
  }

  _initGrid() {
    const mat = new THREE.LineBasicMaterial({
      color: 0x5588bb,
      transparent: true,
      opacity: 0.2
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
      color: 0x00e5ff, transparent: true, opacity: 0.25
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
    const atmoRadius = 6480; // Closer fit to earth surface
    const geo = new THREE.SphereGeometry(atmoRadius, 64, 64);

    const mat = new THREE.ShaderMaterial({
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vViewDir;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vViewDir = normalize(cameraPosition - worldPos.xyz);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vNormal;
        varying vec3 vViewDir;
        void main() {
          float fresnel = 1.0 - max(0.0, dot(vNormal, vViewDir));
          fresnel = pow(fresnel, 4.5); // Tight rim, eliminates wide limb glare
          vec3 color = mix(vec3(0.05, 0.2, 0.45), vec3(0.0, 0.55, 0.85), fresnel);
          gl_FragColor = vec4(color, fresnel * 0.3); // Soft, subtle haze
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

  _initLights() {
    // 1. Sun directional light — gentle daytime illumination, not blinding
    this._sunLight = new THREE.DirectionalLight(0xffffff, 0.7);
    this._sunLight.position.set(1, 0.3, 0.8).normalize();
    this.group.add(this._sunLight);

    // 2. Soft opposite fill light so night side map is clearly visible
    this._nightFillLight = new THREE.DirectionalLight(0x7799cc, 0.5);
    this._nightFillLight.position.set(-1, -0.3, -0.8).normalize();
    this.group.add(this._nightFillLight);

    // 3. Hemisphere light — rich sky & ground fill across the entire sphere
    this._hemiLight = new THREE.HemisphereLight(0x99bbdd, 0x557799, 0.85);
    this.group.add(this._hemiLight);

    // 4. Ambient light — overall baseline brightness
    this._ambientLight = new THREE.AmbientLight(0x6688aa, 0.45);
    this.group.add(this._ambientLight);
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
