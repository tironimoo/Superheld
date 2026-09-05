import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';

const ST = window.G.state;

function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
function angleDiff(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
function chunkHash(cx, cz) {
  return (((cx * 374761393) ^ (cz * 668265263)) >>> 0);
}

const MONSTER_TINTS = {
  green: 0x57d68d, blue: 0x4fc3f7, purple: 0xb085f5, orange: 0xffab5e,
};
const MAX_HEALTH = 5;

// World streaming: the terrain/decor is generated in square chunks around the
// player and old chunks are disposed as the player wanders off — this is what
// makes the world effectively infinite instead of a fixed bounded island.
const CHUNK_SIZE = 24;
const CHUNK_SEGS = 12;
const VIEW_RADIUS = 2; // chunks in every direction kept loaded (5x5 grid)
const WATER_LEVEL = -0.6;
const GRAVITY = 22;
const JUMP_SPEED = 7.6;
const CHARGE_MIN_MS = 180;
const CHARGE_MAX_MS = 1200;

// Distinct look & feel per superpower: projectile shape/color, trail sprites
// and an impact burst profile (particle count/speed/colors/gravity).
const POWER_VISUALS = {
  feuer: {
    color: 0xff6b35, glow: 0xffb347, shape: 'sphere', size: 0.3, speed: 22,
    trailColor: 0xff8c42, trailRate: 70,
    burst: { count: 12, speed: [3, 6], colors: [0xff6b35, 0xffb347, 0xffd54f], gravity: 4, spreadUp: 0.6 },
  },
  eis: {
    color: 0x4fc3f7, glow: 0xdcf6ff, shape: 'octahedron', size: 0.34, speed: 19,
    trailColor: 0xbfe9ff, trailRate: 80,
    burst: { count: 10, speed: [2, 4], colors: [0x4fc3f7, 0xb3e5fc, 0xffffff], gravity: 1.5, spreadUp: 0.3 },
  },
  blitz: {
    color: 0xfdd835, glow: 0xd9a6ff, shape: 'box', size: [0.16, 0.16, 0.55], speed: 34,
    trailColor: 0xfff2a8, trailRate: 40,
    burst: { count: 8, speed: [5, 9], colors: [0xfdd835, 0xab47bc, 0xffffff], gravity: 2, spreadUp: 0.4 },
  },
  kraft: {
    color: 0x8d6e63, glow: 0xffd54f, shape: 'box', size: [0.4, 0.4, 0.4], speed: 14,
    trailColor: null, trailRate: 0, hitRadius: 2.6, shake: 0.18,
    burst: { count: 10, speed: [2, 4.5], colors: [0x8d6e63, 0x6b4a2f, 0xffd54f], gravity: 9, spreadUp: 0.1 },
  },
  schild: {
    color: 0xec407a, glow: 0x7e57c2, shape: 'torus', size: [0.22, 0.09], speed: 18,
    trailColor: 0xec407a, rainbow: true, trailRate: 55,
    burst: { count: 14, speed: [2.5, 5], colors: [0xec407a, 0x7e57c2, 0x4fc3f7, 0xffd76a, 0x63e6a0], gravity: 3, spreadUp: 0.5 },
  },
  flug: {
    color: 0x81d4fa, glow: 0xffffff, shape: 'cone', size: [0.2, 0.5], speed: 20,
    trailColor: 0xe8f7ff, trailRate: 60,
    burst: { count: 12, speed: [1.5, 3.5], colors: [0xffffff, 0x81d4fa, 0xe0f7ff], gravity: 0.6, spreadUp: 0.8 },
  },
};

const CRYSTAL_BURST = { count: 10, speed: [2, 4], colors: [0x9d7bff, 0xffffff, 0xb385ff], gravity: 2, spreadUp: 0.5 };

const World = {
  canvas: null, scene: null, camera: null, renderer: null,
  clock: new THREE.Clock(),
  chunks: new Map(), interactiveDecor: [],
  monsters: [], stars: [], projectiles: [], particles: [],
  player: { pos: new THREE.Vector3(0.3, 1.6, 6.4), yaw: Math.PI, pitch: 0 },
  running: false, paused: false,
  move: { x: 0, z: 0 },
  look: { active: false, pointerId: null, lastX: 0, lastY: 0 },
  joy: { active: false, pointerId: null, cx: 0, cy: 0 },
  castCooldown: 0, charging: false, chargeStart: 0,
  vy: 0, grounded: true, jumpOffset: 0, jumpRequested: false,
  bobPhase: 0,
  health: MAX_HEALTH, lastHitAt: 0, lastRegenAt: 0, invulnUntil: 0,
  treeReady: false, pendingTrees: [], foxTemplate: null, foxClips: null,
  shakeTime: 0, shakeMag: 0,
  _lastChunkX: null, _lastChunkZ: null,
  _v1: new THREE.Vector3(), _v2: new THREE.Vector3(),
  _noise: new ImprovedNoise(),
  projGeo: {},

  init(canvas) {
    this.canvas = canvas;
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x5b3a8f, 16, VIEW_RADIUS * CHUNK_SIZE + 26);
    this.scene = scene;

    const camera = new THREE.PerspectiveCamera(69, canvas.clientWidth / canvas.clientHeight, 0.1, VIEW_RADIUS * CHUNK_SIZE + 46);
    this.camera = camera;

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    } catch (e) { console.error('WebGL init failed', e); return false; }
    renderer.setClearColor(0x2a1458, 1);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    if (THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = renderer;

    this.buildSky();
    this.buildLights();
    this.buildTerrainMaterial();
    this.buildWater();
    this.buildDecorTemplates();
    this.buildProjectileGeometries();
    this.buildChargeOrb();
    this.loadTreeModel();
    this.loadFoxModel();

    this.updateChunks(true);
    for (let i = 0; i < 6; i++) this.spawnMonsterSlot(1 + i * 0.4);
    for (let i = 0; i < 6; i++) this.spawnStar(0);

    this.setupInput();
    this.resize();
    return true;
  },

  /* ---------------- terrain: layered noise, infinite rolling hills, veins of rivers/lakes ---------------- */

  fbm(x, z, octaves, seed) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    const s = seed || 4.7;
    for (let o = 0; o < octaves; o++) {
      sum += this._noise.noise(x * freq, z * freq, s) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2.15;
    }
    return sum / norm;
  },
  heightAt(x, z) {
    const macro = this.fbm(x * 0.006, z * 0.006, 5, 4.7);
    const detail = this.fbm(x * 0.05 + 500, z * 0.05 + 500, 4, 9.3);
    let h = 4.5 + macro * 6.5 + detail * 1.3;
    const rn = this.fbm(x * 0.014 + 3000, z * 0.014 + 3000, 3, 6.1);
    const riverBand = 1 - smoothstep(0, 0.085, Math.abs(rn));
    h -= riverBand * 4.2;
    return h;
  },
  biomeColor(h, riverT, out) {
    const cLow = World._cLow, cMid = World._cMid, cHigh = World._cHigh, cSnow = World._cSnow, cRiverBed = World._cRiverBed;
    let col;
    if (h < -0.6) col = cRiverBed.clone();
    else if (h < 1.2) col = cLow.clone().lerp(cMid, smoothstep(-0.6, 1.2, h));
    else if (h < 6) col = cMid.clone().lerp(cHigh, smoothstep(1.2, 6, h));
    else col = cHigh.clone().lerp(cSnow, smoothstep(6, 10.5, h));
    col.lerp(cRiverBed, riverT * 0.6);
    return col;
  },

  buildTerrainMaterial() {
    this._cLow = new THREE.Color(0x8a7ac0);
    this._cMid = new THREE.Color(0x8d9a68);
    this._cHigh = new THREE.Color(0xaeaeb8);
    this._cSnow = new THREE.Color(0xf0edf7);
    this._cRiverBed = new THREE.Color(0x4a3f7a);
    const tex = new THREE.TextureLoader().load('assets/ground_arcane.jpg');
    tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(CHUNK_SIZE / 8, CHUNK_SIZE / 8);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.terrainMat = new THREE.MeshStandardMaterial({ map: tex, vertexColors: true, roughness: 0.95, metalness: 0.04 });
  },

  buildWater() {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x4fa8dd, transparent: true, opacity: 0.72, roughness: 0.1, metalness: 0.05,
      emissive: 0x3f8ecf, emissiveIntensity: 0.55, depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.scale.set(420, 1, 420);
    mesh.position.y = WATER_LEVEL;
    mesh.renderOrder = 1;
    this.scene.add(mesh);
    this.water = mesh;
  },

  buildChunk(cx, cz) {
    const key = cx + ',' + cz;
    if (this.chunks.has(key)) return;
    const originX = cx * CHUNK_SIZE, originZ = cz * CHUNK_SIZE;
    const geo = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, CHUNK_SEGS, CHUNK_SEGS);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const tmpColor = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const lx = pos.getX(i), lz = pos.getZ(i);
      const wx = originX + lx, wz = originZ + lz;
      const h = this.heightAt(wx, wz);
      pos.setY(i, h);
      const rn = this.fbm(wx * 0.014 + 3000, wz * 0.014 + 3000, 3, 6.1);
      const riverT = 1 - smoothstep(0, 0.1, Math.abs(rn));
      tmpColor.copy(this.biomeColor(h, riverT));
      colors[i * 3] = tmpColor.r; colors[i * 3 + 1] = tmpColor.g; colors[i * 3 + 2] = tmpColor.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, this.terrainMat);
    mesh.position.set(originX, 0, originZ);
    mesh.receiveShadow = true;
    this.scene.add(mesh);

    const decorGroup = new THREE.Group();
    this.scene.add(decorGroup);
    this.chunks.set(key, { mesh, decorGroup, cx, cz });
    this.populateChunkDecor(cx, cz, decorGroup, originX, originZ, key);
  },

  disposeChunk(key) {
    const c = this.chunks.get(key);
    if (!c) return;
    this.scene.remove(c.mesh);
    c.mesh.geometry.dispose();
    this.scene.remove(c.decorGroup);
    this.chunks.delete(key);
    this.interactiveDecor = this.interactiveDecor.filter(e => e.chunkKey !== key);
  },

  updateChunks(force) {
    const p = this.player.pos;
    const ccx = Math.round(p.x / CHUNK_SIZE), ccz = Math.round(p.z / CHUNK_SIZE);
    if (!force && ccx === this._lastChunkX && ccz === this._lastChunkZ) return;
    this._lastChunkX = ccx; this._lastChunkZ = ccz;
    for (let dz = -VIEW_RADIUS; dz <= VIEW_RADIUS; dz++) {
      for (let dx = -VIEW_RADIUS; dx <= VIEW_RADIUS; dx++) {
        this.buildChunk(ccx + dx, ccz + dz);
      }
    }
    const keep = VIEW_RADIUS + 1;
    for (const [key, c] of this.chunks) {
      if (Math.abs(c.cx - ccx) > keep || Math.abs(c.cz - ccz) > keep) this.disposeChunk(key);
    }
  },

  /* ---------------- sky / lights ---------------- */

  buildSky() {
    const geo = new THREE.SphereGeometry(95, 24, 16);
    const colorTop = new THREE.Color(0x2a1458);
    const colorBottom = new THREE.Color(0xff9d5c);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 95;
      const t = Math.max(0, Math.min(1, y * 0.5 + 0.5));
      const c = colorBottom.clone().lerp(colorTop, t);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false });
    const sky = new THREE.Mesh(geo, mat);
    sky.renderOrder = -10;

    const skyGroup = new THREE.Group();
    skyGroup.add(sky);
    const moon = this.makeGlowSprite(0xffe0c2, 9, 1);
    moon.position.set(-22, 16, -58);
    skyGroup.add(moon);
    this.scene.add(skyGroup);
    this.skyGroup = skyGroup;
  },

  buildLights() {
    const hemi = new THREE.HemisphereLight(0xe8d4ff, 0x5c3f8f, 1.25);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffe3c2, 1.4);
    sun.position.set(14, 22, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(768, 768);
    const d = 26;
    sun.shadow.camera.left = -d; sun.shadow.camera.right = d;
    sun.shadow.camera.top = d; sun.shadow.camera.bottom = -d;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 55;
    sun.shadow.bias = -0.003;
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;
  },

  /* ---------------- shared helpers ---------------- */

  makeGlowSprite(color, size, opacity) {
    const tex = this._glowTex || (this._glowTex = new THREE.TextureLoader().load('assets/glow.png'));
    const mat = new THREE.SpriteMaterial({ map: tex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true, opacity: opacity ?? 0.7 });
    const s = new THREE.Sprite(mat);
    s.scale.set(size, size, 1);
    return s;
  },
  makeShadowBlob(size) {
    const tex = this._glowTex || (this._glowTex = new THREE.TextureLoader().load('assets/glow.png'));
    const mat = new THREE.MeshBasicMaterial({ map: tex, color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false });
    const geo = new THREE.PlaneGeometry(size, size);
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    return m;
  },

  buildProjectileGeometries() {
    Object.entries(POWER_VISUALS).forEach(([id, v]) => {
      let geo;
      if (v.shape === 'sphere') geo = new THREE.SphereGeometry(v.size, 10, 8);
      else if (v.shape === 'octahedron') geo = new THREE.OctahedronGeometry(v.size, 0);
      else if (v.shape === 'box') geo = new THREE.BoxGeometry(v.size[0], v.size[1], v.size[2]);
      else if (v.shape === 'torus') geo = new THREE.TorusGeometry(v.size[0], v.size[1], 8, 16);
      else if (v.shape === 'cone') geo = new THREE.ConeGeometry(v.size[0], v.size[1], 8);
      else geo = new THREE.SphereGeometry(0.28, 8, 6);
      this.projGeo[id] = geo;
    });
  },

  buildChargeOrb() {
    this.chargeOrb = this.makeGlowSprite(0xffffff, 0.4, 0);
    this.chargeOrb.visible = false;
    this.scene.add(this.chargeOrb);
  },

  /* ---------------- decor: trees, bushes, rocks, interactive crystals ---------------- */

  buildDecorTemplates() {
    this.crystalGemGeo = new THREE.IcosahedronGeometry(0.5, 0);
    this.crystalBaseGeo = new THREE.BoxGeometry(0.7, 0.4, 0.7);
    this.crystalMat = new THREE.MeshStandardMaterial({ color: 0x9d7bff, emissive: 0x4a2f8f, emissiveIntensity: 0.6, roughness: 0.25, metalness: 0.3 });
    this.crystalBaseMat = new THREE.MeshStandardMaterial({ color: 0x5b3a8f, roughness: 0.7 });
    this.crystalLightCount = 0;

    this.rockGeo = new THREE.DodecahedronGeometry(0.7, 0);
    this.rockMat = new THREE.MeshStandardMaterial({ color: 0x5c5470, roughness: 0.85 });

    const bushRand = mulberry32(77);
    const bushPalettes = [0x4f8f5a, 0x5a7a3f, 0x6a5a9a];
    this.bushTemplates = bushPalettes.map(color => {
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
      const group = new THREE.Group();
      const clumps = 3 + Math.floor(bushRand() * 2);
      for (let i = 0; i < clumps; i++) {
        const s = 0.28 + bushRand() * 0.2;
        const geo = new THREE.IcosahedronGeometry(s, 0);
        const m = new THREE.Mesh(geo, mat);
        m.position.set((bushRand() - 0.5) * 0.5, s * 0.7 + bushRand() * 0.1, (bushRand() - 0.5) * 0.5);
        m.castShadow = true; m.receiveShadow = true;
        group.add(m);
      }
      return group;
    });
  },

  populateChunkDecor(cx, cz, group, originX, originZ, key) {
    const rand = mulberry32(chunkHash(cx, cz));
    const count = 2 + Math.floor(rand() * 3);
    for (let i = 0; i < count; i++) {
      const lx = (rand() - 0.5) * CHUNK_SIZE;
      const lz = (rand() - 0.5) * CHUNK_SIZE;
      const wx = originX + lx, wz = originZ + lz;
      const h = this.heightAt(wx, wz);
      if (h < WATER_LEVEL + 0.5) continue;
      const roll = rand();
      const kind = roll < 0.32 ? 'tree' : roll < 0.58 ? 'bush' : roll < 0.82 ? 'rock' : 'crystal';
      const posVec = new THREE.Vector3(wx, h, wz);
      const rotY = rand() * Math.PI * 2;
      const scale = 0.7 + rand() * 0.8;
      this.spawnDecor(kind, posVec, rotY, scale, group, key);
    }
  },

  spawnDecor(kind, pos, rotY, scale, group, key) {
    if (kind === 'tree') {
      if (this.treeReady) this.instantiateTree(pos, rotY, scale, group);
      else this.pendingTrees.push({ pos, rotY, scale, group });
    } else if (kind === 'bush') {
      const idx = Math.floor(Math.random() * this.bushTemplates.length);
      const inst = this.bushTemplates[idx].clone(true);
      inst.position.copy(pos);
      inst.rotation.y = rotY;
      inst.scale.setScalar(scale);
      inst.add(this.makeShadowBlob(1.1 * scale));
      group.add(inst);
    } else if (kind === 'rock') {
      const rock = new THREE.Mesh(this.rockGeo, this.rockMat);
      rock.position.copy(pos); rock.position.y += 0.35 * scale;
      rock.rotation.set(rotY * 0.3, rotY, rotY * 0.6);
      rock.scale.set(scale, scale * 0.8, scale);
      rock.castShadow = true; rock.receiveShadow = true;
      group.add(rock);
    } else if (kind === 'crystal') {
      const crystalGroup = new THREE.Group();
      const base = new THREE.Mesh(this.crystalBaseGeo, this.crystalBaseMat);
      base.position.y = 0.2; base.castShadow = true; base.receiveShadow = true;
      const gem = new THREE.Mesh(this.crystalGemGeo, this.crystalMat);
      gem.position.y = 0.2 + 0.65; gem.scale.set(1, 1.9, 1); gem.castShadow = true;
      crystalGroup.add(base, gem);
      const glow = this.makeGlowSprite(0xb385ff, 1.6 * scale, 0.45);
      glow.position.y = 1.3;
      crystalGroup.add(glow);
      let light = null;
      if (this.crystalLightCount < 5) {
        light = new THREE.PointLight(0x9d7bff, 1.2, 6, 2);
        light.position.y = 1.1;
        crystalGroup.add(light);
        this.crystalLightCount++;
      }
      crystalGroup.position.copy(pos);
      crystalGroup.rotation.y = rotY;
      crystalGroup.scale.setScalar(scale);
      crystalGroup.add(this.makeShadowBlob(scale * 1.8));
      group.add(crystalGroup);
      this.interactiveDecor.push({ kind: 'crystal', pos: pos.clone(), cooldownUntil: 0, glow, chunkKey: key });
    }
  },

  loadTreeModel() {
    new OBJLoader().load('assets/tree.obj', (obj) => {
      const mat = new THREE.MeshStandardMaterial({ color: 0x4a3050, roughness: 0.85 });
      obj.traverse(c => { if (c.isMesh) { c.material = mat; c.castShadow = true; c.receiveShadow = true; } });
      const box = new THREE.Box3().setFromObject(obj);
      const height = box.max.y - box.min.y || 1;
      const targetHeight = 3.6;
      this.treeScaleFactor = targetHeight / height;

      let blossomLocalPoints = null;
      obj.traverse(c => {
        if (c.isMesh && !blossomLocalPoints) {
          const pos = c.geometry.attributes.position;
          const pts = [];
          for (let i = 0; i < pos.count; i++) pts.push(new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)));
          pts.sort((a, b) => b.y - a.y);
          blossomLocalPoints = [];
          for (let i = 0; i < pts.length && blossomLocalPoints.length < 7; i += 11) blossomLocalPoints.push(pts[i]);
        }
      });

      this.treeTemplate = obj;
      this.treeBlossomPoints = blossomLocalPoints;
      this.treeReady = true;
      this.pendingTrees.forEach(t => this.instantiateTree(t.pos, t.rotY, t.scale, t.group));
      this.pendingTrees = [];
    });
  },

  instantiateTree(pos, rotY, scale, group) {
    const inst = this.treeTemplate.clone(true);
    inst.position.copy(pos);
    inst.rotation.y = rotY;
    inst.scale.setScalar(this.treeScaleFactor * scale);
    inst.add(this.makeShadowBlob(1.6 * scale));
    group.add(inst);
    if (this.treeBlossomPoints) {
      const colors = [0xffb3e6, 0xc9a8ff, 0xffd9a0];
      this.treeBlossomPoints.forEach((p, i) => {
        const glow = this.makeGlowSprite(colors[i % colors.length], 0.5, 0.85);
        glow.position.copy(p).multiplyScalar(this.treeScaleFactor * scale);
        inst.add(glow);
      });
    }
  },

  loadFoxModel() {
    new GLTFLoader().load('assets/models/fox.glb', (gltf) => {
      const box = new THREE.Box3().setFromObject(gltf.scene);
      const height = box.max.y - box.min.y || 1;
      this.foxScale = 1.05 / height;
      this.foxTemplate = gltf.scene;
      this.foxClips = gltf.animations;
      this.monsters.forEach(m => { if (!m.built) this.buildMonsterVisual(m); });
    });
  },

  buildMonsterVisual(m) {
    if (!this.foxTemplate) return;
    const inst = cloneSkeleton(this.foxTemplate);
    inst.scale.setScalar(this.foxScale);
    const tint = MONSTER_TINTS[m.colorKey];
    inst.traverse(c => {
      if (c.isMesh) {
        c.material = c.material.clone();
        c.material.color.set(tint);
        c.castShadow = true;
      }
    });
    const group = new THREE.Group();
    group.add(inst);
    group.add(this.makeShadowBlob(1.5));
    const glow = this.makeGlowSprite(tint, 1.3, 0.35);
    glow.position.y = 0.6;
    group.add(glow);
    this.scene.add(group);

    const mixer = new THREE.AnimationMixer(inst);
    const actions = {};
    this.foxClips.forEach(clip => { actions[clip.name.toLowerCase()] = mixer.clipAction(clip); });
    Object.values(actions).forEach(a => { a.enabled = true; });
    const idle = actions.survey || Object.values(actions)[0];
    idle.play();

    m.group = group;
    m.mixer = mixer;
    m.actions = actions;
    m.currentAction = idle;
    m.built = true;
    m.group.visible = m.alive;
  },

  crossfadeTo(m, name, duration) {
    const next = m.actions[name];
    if (!next || next === m.currentAction) return;
    next.reset().setEffectiveWeight(1).fadeIn(duration || 0.3).play();
    m.currentAction.fadeOut(duration || 0.3);
    m.currentAction = next;
  },

  /* ---------------- spawning (always relative to the player, since the world is endless) ---------------- */

  randomRingPosAroundPlayer(minR, maxR) {
    for (let tries = 0; tries < 12; tries++) {
      const a = Math.random() * Math.PI * 2;
      const d = minR + Math.random() * (maxR - minR);
      const x = this.player.pos.x + Math.cos(a) * d, z = this.player.pos.z + Math.sin(a) * d;
      const h = this.heightAt(x, z);
      if (h > WATER_LEVEL + 0.3) return new THREE.Vector3(x, h, z);
    }
    const x = this.player.pos.x + minR, z = this.player.pos.z;
    return new THREE.Vector3(x, this.heightAt(x, z), z);
  },

  spawnMonsterSlot(delay) {
    const colors = ['green', 'blue', 'purple', 'orange'];
    const pos = this.randomRingPosAroundPlayer(9, 26);
    const m = {
      pos, colorKey: colors[Math.floor(Math.random() * colors.length)],
      alive: false, built: false, group: null,
      spawnAt: performance.now() + (delay || 0) * 1000,
      state: 'idle', facing: 0, wanderTarget: null,
      idleUntil: 0, lastAttackTick: 0,
    };
    this.monsters.push(m);
    if (this.foxTemplate) this.buildMonsterVisual(m);
  },

  spawnStar(delay) {
    const pos = this.randomRingPosAroundPlayer(6, 22);
    const glow = this.makeGlowSprite(0xffe08a, 1.7, 0.55);
    const core = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.4, 0),
      new THREE.MeshStandardMaterial({ color: 0xffd76a, emissive: 0xffb02e, emissiveIntensity: 0.8, roughness: 0.3 }),
    );
    core.castShadow = true;
    const group = new THREE.Group();
    group.add(core, glow);
    group.position.copy(pos);
    group.visible = false;
    this.scene.add(group);
    this.stars.push({ pos, group, core, phase: Math.random() * Math.PI * 2, alive: false, spawnAt: performance.now() + (delay || 0) * 1000 });
  },

  /* ---------------- input ---------------- */

  setupInput() {
    const joyBase = document.getElementById('joystick-base');
    const joyKnob = document.getElementById('joystick-knob');
    const maxR = 42;

    const onJoyDown = (e) => {
      if (this.paused) return;
      this.joy.active = true;
      this.joy.pointerId = e.pointerId;
      const rect = joyBase.getBoundingClientRect();
      this.joy.cx = rect.left + rect.width / 2;
      this.joy.cy = rect.top + rect.height / 2;
      joyBase.setPointerCapture(e.pointerId);
      updateJoy(e);
      e.preventDefault();
    };
    const updateJoy = (e) => {
      let dx = e.clientX - this.joy.cx;
      let dy = e.clientY - this.joy.cy;
      const len = Math.hypot(dx, dy);
      if (len > maxR) { dx = (dx / len) * maxR; dy = (dy / len) * maxR; }
      joyKnob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.move.x = dx / maxR;
      this.move.z = dy / maxR;
    };
    const onJoyMove = (e) => { if (this.joy.active && e.pointerId === this.joy.pointerId) { updateJoy(e); e.preventDefault(); } };
    const endJoy = (e) => {
      if (e.pointerId !== this.joy.pointerId) return;
      this.joy.active = false;
      this.move.x = 0; this.move.z = 0;
      joyKnob.style.transform = 'translate(0px, 0px)';
    };
    joyBase.addEventListener('pointerdown', onJoyDown);
    joyBase.addEventListener('pointermove', onJoyMove);
    joyBase.addEventListener('pointerup', endJoy);
    joyBase.addEventListener('pointercancel', endJoy);

    const onLookDown = (e) => {
      if (this.paused) return;
      this.look.active = true;
      this.look.pointerId = e.pointerId;
      this.look.lastX = e.clientX;
      this.look.lastY = e.clientY;
      this.canvas.setPointerCapture(e.pointerId);
    };
    const onLookMove = (e) => {
      if (!this.look.active || e.pointerId !== this.look.pointerId) return;
      const dx = e.clientX - this.look.lastX;
      const dy = e.clientY - this.look.lastY;
      this.look.lastX = e.clientX;
      this.look.lastY = e.clientY;
      this.player.yaw -= dx * 0.0045;
      this.player.pitch = Math.max(-1.0, Math.min(1.1, this.player.pitch - dy * 0.0045));
    };
    const endLook = (e) => { if (e.pointerId === this.look.pointerId) this.look.active = false; };
    this.canvas.addEventListener('pointerdown', onLookDown);
    this.canvas.addEventListener('pointermove', onLookMove);
    this.canvas.addEventListener('pointerup', endLook);
    this.canvas.addEventListener('pointercancel', endLook);

    const castBtn = document.getElementById('btn-cast');
    const startCast = (e) => {
      if (this.paused) return;
      this.charging = true;
      this.chargeStart = performance.now();
      e.preventDefault();
    };
    const stopCast = () => {
      if (!this.charging) return;
      this.charging = false;
      if (window.G.ui.updateCharge) window.G.ui.updateCharge(0);
      const held = performance.now() - this.chargeStart;
      if (held < CHARGE_MIN_MS) this.fireProjectile(0);
      else this.fireProjectile(Math.min(1, (held - CHARGE_MIN_MS) / (CHARGE_MAX_MS - CHARGE_MIN_MS)));
    };
    castBtn.addEventListener('pointerdown', startCast);
    castBtn.addEventListener('pointerup', stopCast);
    castBtn.addEventListener('pointercancel', stopCast);
    castBtn.addEventListener('pointerleave', stopCast);

    const jumpBtn = document.getElementById('btn-jump');
    if (jumpBtn) {
      jumpBtn.addEventListener('pointerdown', (e) => { if (!this.paused) this.jumpRequested = true; e.preventDefault(); });
    }
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !this.paused) this.jumpRequested = true;
    });

    window.addEventListener('resize', () => this.resize());
  },

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight, false);
    this.camera.aspect = this.canvas.clientWidth / this.canvas.clientHeight;
    this.camera.updateProjectionMatrix();
  },

  /* ---------------- combat ---------------- */

  fireProjectile(chargeFrac) {
    chargeFrac = chargeFrac || 0;
    const mega = chargeFrac > 0;
    if (this.castCooldown > performance.now()) return;
    this.castCooldown = performance.now() + (mega ? 500 + chargeFrac * 500 : 380);
    const state = ST.get();
    const powerId = state.activePower;
    if (!(state.powerLevels[powerId] > 0)) return;
    ST.sfx.cast();
    const yaw = this.player.yaw, pitch = this.player.pitch;
    const dir = new THREE.Vector3(
      -Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      -Math.cos(yaw) * Math.cos(pitch),
    );
    let target = null, bestDot = 0.82;
    this.monsters.forEach(m => {
      if (!m.alive) return;
      const toM = this._v1.copy(m.pos).sub(this.player.pos).normalize();
      const d = dir.dot(toM);
      if (d > bestDot) { bestDot = d; target = m; }
    });
    const visual = POWER_VISUALS[powerId];
    const scale = 1 + chargeFrac * 2.4;
    const mat = new THREE.MeshBasicMaterial({ color: visual.color });
    const mesh = new THREE.Mesh(this.projGeo[powerId], mat);
    if (visual.shape === 'cone') mesh.rotation.x = Math.PI / 2;
    mesh.scale.setScalar(scale);
    const glow = this.makeGlowSprite(visual.glow, (mega ? 1.8 : 1.1) * scale, 0.75);
    mesh.add(glow);
    mesh.position.copy(this.player.pos);
    this.scene.add(mesh);
    this.projectiles.push({
      pos: mesh.position, dir, powerId, visual, life: mega ? 3.2 : 2.4, target, obj: mesh, trailTimer: 0,
      mega, hitRadiusMul: mega ? (1.6 + chargeFrac * 1.4) : 1,
    });
  },

  onMonsterKilled(m, visual) {
    const state = ST.get();
    state.kills += 1;
    const reward = 3 + Math.floor(Math.random() * 2);
    state.stars += reward;
    state.starsEarnedTotal += reward;
    ST.save();
    ST.sfx.hit();
    window.G.ui.toast(`+${reward} ⭐`);
    window.G.ui.updateHud();
    this.spawnKillBurst(m.pos, visual);
    if (visual.shake) { this.shakeTime = 0.25; this.shakeMag = visual.shake; }
    const newAch = ST.checkAchievements();
    if (newAch.length) window.G.ui.queueAchievements(newAch);
    m.alive = false;
    if (m.group) m.group.visible = false;
    m.state = 'idle';
    m.spawnAt = performance.now() + 3000 + Math.random() * 2200;
    m.pos = this.randomRingPosAroundPlayer(9, 26);
  },

  onStarCollected(s) {
    const state = ST.get();
    state.stars += 1;
    state.starsEarnedTotal += 1;
    ST.save();
    ST.sfx.pickup();
    window.G.ui.updateHud();
    const newAch = ST.checkAchievements();
    if (newAch.length) window.G.ui.queueAchievements(newAch);
    s.alive = false;
    s.group.visible = false;
    s.spawnAt = performance.now() + 4000 + Math.random() * 4000;
    s.pos = this.randomRingPosAroundPlayer(6, 22);
  },

  onCrystalCollected(entry, now) {
    entry.cooldownUntil = now + 20000;
    const state = ST.get();
    const reward = 2 + Math.floor(Math.random() * 3);
    state.stars += reward;
    state.starsEarnedTotal += reward;
    ST.save();
    ST.sfx.pickup();
    window.G.ui.toast(`💎 +${reward} ⭐`);
    window.G.ui.updateHud();
    this.spawnKillBurst(entry.pos, { burst: CRYSTAL_BURST });
    const newAch = ST.checkAchievements();
    if (newAch.length) window.G.ui.queueAchievements(newAch);
  },

  spawnTrailParticle(pos, color) {
    const sprite = this.makeGlowSprite(color, 0.45, 0.8);
    sprite.position.copy(pos);
    this.scene.add(sprite);
    this.particles.push({ obj: sprite, vel: new THREE.Vector3(0, 0.2, 0), life: 0.3, maxLife: 0.3, grav: 0.4 });
  },

  spawnKillBurst(pos, visual) {
    const b = visual.burst;
    for (let i = 0; i < b.count; i++) {
      const a = Math.random() * Math.PI * 2;
      const el = Math.random() * Math.PI * b.spreadUp;
      const speed = b.speed[0] + Math.random() * (b.speed[1] - b.speed[0]);
      const color = b.colors[Math.floor(Math.random() * b.colors.length)];
      const sprite = this.makeGlowSprite(color, 0.5, 0.9);
      sprite.position.copy(pos).add(new THREE.Vector3(0, 0.6, 0));
      this.scene.add(sprite);
      this.particles.push({
        obj: sprite,
        vel: new THREE.Vector3(Math.cos(a) * Math.cos(el) * speed, Math.sin(el) * speed + 1.2, Math.sin(a) * Math.cos(el) * speed),
        life: 0.7, maxLife: 0.7, grav: b.gravity,
      });
    }
  },

  takeDamage(now) {
    if (now < this.invulnUntil) return;
    this.health = Math.max(0, this.health - 1);
    this.lastHitAt = now;
    this.invulnUntil = now + 1000;
    ST.sfx.miss();
    window.G.ui.updateHealth(this.health, MAX_HEALTH, true);
    if (this.health <= 0) {
      this.health = MAX_HEALTH;
      this.invulnUntil = now + 2200;
      window.G.ui.toast('Kurz verschnauft! 💫');
      window.G.ui.updateHealth(this.health, MAX_HEALTH, false);
    }
  },

  /* ---------------- monster AI ---------------- */

  updateMonsterAI(m, dt, now) {
    if (!m.alive) return;
    const toPlayer = this._v1.copy(this.player.pos).sub(m.pos);
    toPlayer.y = 0;
    const dist = toPlayer.length();
    let animName = 'survey';

    if (dist < 2.2) {
      m.state = 'attack';
      animName = 'survey';
      if (now - m.lastAttackTick > 2200) {
        m.lastAttackTick = now;
        this.takeDamage(now);
      }
      const angle = Math.atan2(toPlayer.x, toPlayer.z);
      m.facing += angleDiff(m.facing, angle) * Math.min(1, dt * 5);
    } else if (dist < 11) {
      m.state = 'chase';
      animName = 'run';
      const dir = toPlayer.normalize();
      m.pos.addScaledVector(dir, 4.0 * dt);
      const angle = Math.atan2(dir.x, dir.z);
      m.facing += angleDiff(m.facing, angle) * Math.min(1, dt * 6);
    } else {
      m.state = 'wander';
      if (!m.wanderTarget || m.pos.distanceTo(m.wanderTarget) < 0.6) {
        if (now > m.idleUntil) {
          if (Math.random() < 0.3) {
            m.idleUntil = now + 1200 + Math.random() * 1200;
            m.wanderTarget = m.pos.clone();
          } else {
            const a = Math.random() * Math.PI * 2;
            const d = 3 + Math.random() * 4;
            m.wanderTarget = this._v2.set(m.pos.x + Math.cos(a) * d, 0, m.pos.z + Math.sin(a) * d).clone();
          }
        }
      }
      if (m.wanderTarget && now > m.idleUntil) {
        const dir = this._v2.copy(m.wanderTarget).sub(m.pos);
        dir.y = 0;
        if (dir.lengthSq() > 0.0001) {
          animName = 'walk';
          dir.normalize();
          m.pos.addScaledVector(dir, 1.5 * dt);
          const angle = Math.atan2(dir.x, dir.z);
          m.facing += angleDiff(m.facing, angle) * Math.min(1, dt * 4);
        }
      } else {
        animName = 'survey';
      }
    }

    m.pos.y = this.heightAt(m.pos.x, m.pos.z);

    if (m.built) {
      this.crossfadeTo(m, animName, 0.35);
      m.group.position.copy(m.pos);
      m.group.rotation.y = m.facing;
      m.mixer.update(dt);
    }
  },

  /* ---------------- main loop ---------------- */

  update(dt) {
    if (this.paused) return;
    const p = this.player;
    const speed = 6.2;
    if (Math.abs(this.move.x) > 0.05 || Math.abs(this.move.z) > 0.05) {
      const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
      const mx = this.move.x, mz = this.move.z;
      const moveX = cy * mx + sy * mz;
      const moveZ = -sy * mx + cy * mz;
      const len = Math.hypot(moveX, moveZ) || 1;
      p.pos.x += (moveX / len) * speed * dt;
      p.pos.z += (moveZ / len) * speed * dt;
      this.bobPhase += dt * 9;
    }

    if (this.jumpRequested && this.grounded) {
      this.vy = JUMP_SPEED;
      this.grounded = false;
      this.jumpRequested = false;
      ST.sfx.tap();
    }
    this.jumpRequested = false;
    this.vy -= GRAVITY * dt;
    this.jumpOffset += this.vy * dt;
    if (this.jumpOffset <= 0) { this.jumpOffset = 0; this.vy = 0; this.grounded = true; }

    const groundY = this.heightAt(p.pos.x, p.pos.z);
    p.pos.y = groundY + 1.6 + this.jumpOffset + (this.grounded ? Math.sin(this.bobPhase) * 0.04 : 0);

    this.updateChunks(false);
    if (this.skyGroup) this.skyGroup.position.set(p.pos.x, 0, p.pos.z);
    if (this.water) { this.water.position.x = p.pos.x; this.water.position.z = p.pos.z; }
    if (this.sun) {
      this.sun.position.set(p.pos.x + 14, p.pos.y + 22, p.pos.z + 10);
      this.sun.target.position.set(p.pos.x, p.pos.y, p.pos.z);
      this.sun.target.updateMatrixWorld();
    }

    this.camera.position.copy(p.pos);
    if (this.shakeTime > 0) {
      this.shakeTime -= dt;
      const s = this.shakeMag * (this.shakeTime / 0.25);
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
    }
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = p.yaw;
    this.camera.rotation.x = p.pitch;

    const now = performance.now();

    if (this.charging) {
      const held = now - this.chargeStart;
      const frac = held < CHARGE_MIN_MS ? 0 : Math.min(1, (held - CHARGE_MIN_MS) / (CHARGE_MAX_MS - CHARGE_MIN_MS));
      if (window.G.ui.updateCharge) window.G.ui.updateCharge(frac);
      const dir2 = this._v1.set(-Math.sin(p.yaw) * Math.cos(p.pitch), Math.sin(p.pitch), -Math.cos(p.yaw) * Math.cos(p.pitch));
      this.chargeOrb.position.copy(p.pos).addScaledVector(dir2, 1.1);
      this.chargeOrb.visible = frac > 0;
      const visual = POWER_VISUALS[ST.get().activePower];
      this.chargeOrb.material.color.set(visual.glow);
      this.chargeOrb.material.opacity = 0.5 + frac * 0.4;
      this.chargeOrb.scale.setScalar(0.3 + frac * 0.9);
    } else if (this.chargeOrb.visible) {
      this.chargeOrb.visible = false;
    }

    if (now - this.lastHitAt > 3500 && this.health < MAX_HEALTH && now - this.lastRegenAt > 1800) {
      this.health++;
      this.lastRegenAt = now;
      window.G.ui.updateHealth(this.health, MAX_HEALTH, false);
    }

    this.monsters.forEach(m => {
      if (!m.alive && now >= m.spawnAt) {
        m.alive = true;
        m.wanderTarget = null;
        m.idleUntil = 0;
        if (m.group) m.group.visible = true;
      }
      this.updateMonsterAI(m, dt, now);
    });

    this.stars.forEach(s => {
      if (!s.alive && now >= s.spawnAt) { s.alive = true; s.group.visible = true; }
      if (s.alive) {
        s.phase += dt * 2.4;
        s.group.position.y = s.pos.y + 1.0 + Math.sin(s.phase) * 0.2;
        s.group.rotation.y = s.phase * 1.4;
        if (p.pos.distanceTo(s.pos) < 2.1) this.onStarCollected(s);
      }
    });

    this.interactiveDecor.forEach(entry => {
      if (now < entry.cooldownUntil) {
        if (entry.glow && entry.glow.visible) entry.glow.visible = false;
        return;
      }
      if (entry.glow && !entry.glow.visible) entry.glow.visible = true;
      if (p.pos.distanceTo(entry.pos) < 1.9) this.onCrystalCollected(entry, now);
    });

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      if (pr.target && pr.target.alive) {
        const toT = this._v1.copy(pr.target.pos).sub(pr.pos).normalize();
        pr.dir.lerp(toT, 0.14).normalize();
      }
      pr.pos.addScaledVector(pr.dir, pr.visual.speed * dt);
      pr.life -= dt;

      if (pr.visual.rainbow) {
        pr.obj.material.color.setHSL((now * 0.0006) % 1, 0.85, 0.6);
      }
      if (pr.visual.trailColor && pr.visual.trailRate) {
        pr.trailTimer -= dt * 1000;
        if (pr.trailTimer <= 0) {
          pr.trailTimer = pr.visual.trailRate;
          const c = pr.visual.rainbow ? new THREE.Color().setHSL((now * 0.0006) % 1, 0.85, 0.6).getHex() : pr.visual.trailColor;
          this.spawnTrailParticle(pr.pos, c);
        }
      }

      let hit = false;
      const hitR = (pr.visual.hitRadius || 2.0) * pr.hitRadiusMul;
      this.monsters.forEach(m => {
        if (m.alive && m.pos.distanceTo(pr.pos) < hitR && (pr.mega || !hit)) { this.onMonsterKilled(m, pr.visual); hit = true; }
      });
      if (hit && pr.mega) { this.shakeTime = 0.3; this.shakeMag = Math.max(this.shakeMag || 0, 0.22); }
      if (hit || pr.life <= 0) { this.scene.remove(pr.obj); this.projectiles.splice(i, 1); }
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pa = this.particles[i];
      pa.obj.position.addScaledVector(pa.vel, dt);
      pa.vel.y -= (pa.grav ?? 6) * dt;
      pa.life -= dt;
      const s = Math.max(0.05, pa.life / pa.maxLife);
      pa.obj.material.opacity = 0.9 * s;
      pa.obj.scale.setScalar(0.5 * (0.4 + s));
      if (pa.life <= 0) { this.scene.remove(pa.obj); this.particles.splice(i, 1); }
    }
  },

  render() {
    this.renderer.render(this.scene, this.camera);
  },

  loop() {
    if (!this.running) return;
    const dt = Math.min(0.05, this.clock.getDelta());
    this.update(dt);
    this.render();
    requestAnimationFrame(this.loop.bind(this));
  },

  start() {
    this.running = true;
    this.paused = false;
    this.clock.getDelta();
    this.invulnUntil = performance.now() + 2500;
    window.G.ui.updateHealth(this.health, MAX_HEALTH, false);
    requestAnimationFrame(this.loop.bind(this));
  },
  pause() { this.paused = true; },
  resume() { this.paused = false; },
};

window.G = window.G || {};
window.G.world = World;
