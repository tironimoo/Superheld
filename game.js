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

const MONSTER_TINTS = {
  green: 0x57d68d, blue: 0x4fc3f7, purple: 0xb085f5, orange: 0xffab5e,
};
const MAX_HEALTH = 5;
const PLAY_RADIUS = 17;

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

const World = {
  canvas: null, scene: null, camera: null, renderer: null,
  clock: new THREE.Clock(),
  decor: [], monsters: [], stars: [], projectiles: [], particles: [],
  player: { pos: new THREE.Vector3(0.3, 1.6, 6.4), yaw: Math.PI, pitch: 0 },
  running: false, paused: false,
  move: { x: 0, z: 0 },
  look: { active: false, pointerId: null, lastX: 0, lastY: 0 },
  joy: { active: false, pointerId: null, cx: 0, cy: 0 },
  castCooldown: 0,
  worldRadius: 40,
  bobPhase: 0,
  health: MAX_HEALTH, lastHitAt: 0, lastRegenAt: 0, invulnUntil: 0,
  foxTemplate: null, foxClips: null,
  shakeTime: 0, shakeMag: 0,
  _v1: new THREE.Vector3(), _v2: new THREE.Vector3(),
  _noise: new ImprovedNoise(),
  projGeo: {},

  init(canvas) {
    this.canvas = canvas;
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x5b3a8f, 16, this.worldRadius + 8);
    this.scene = scene;

    const camera = new THREE.PerspectiveCamera(69, canvas.clientWidth / canvas.clientHeight, 0.1, 110);
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
    this.buildTerrain();
    this.buildRiver();
    this.buildDecor();
    this.buildProjectileGeometries();
    this.loadTreeModel();
    this.loadFoxModel();

    for (let i = 0; i < 5; i++) this.spawnMonsterSlot(1 + i * 0.4);
    for (let i = 0; i < 6; i++) this.spawnStar(0);

    this.setupInput();
    this.resize();
    return true;
  },

  /* ---------------- terrain: layered noise, mountains at the rim, a carved river ---------------- */

  fbm(x, z, octaves) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += this._noise.noise(x * freq, z * freq, 4.7) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2.15;
    }
    return sum / norm;
  },
  riverCenterX(z) {
    return Math.sin(z * 0.05) * 9 + Math.sin(z * 0.011) * 6;
  },
  heightAt(x, z) {
    const r = Math.hypot(x, z);
    const mountainMask = smoothstep(PLAY_RADIUS, this.worldRadius * 0.92, r);
    const n = this.fbm(x * 0.045, z * 0.045, 5);
    let h = mountainMask * (n * 0.5 + 0.5) * 13;
    h += (1 - mountainMask) * Math.max(0, n) * 0.7;

    const halfWidth = 3.2;
    const dist = Math.abs(x - this.riverCenterX(z));
    const riverInfluence = 1 - smoothstep(0, halfWidth, dist);
    h -= riverInfluence * 1.8;
    return h;
  },

  buildTerrain() {
    const size = this.worldRadius * 2;
    const segs = 64;
    const geo = new THREE.PlaneGeometry(size, size, segs, segs);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const cLow = new THREE.Color(0x8a7ac0), cMid = new THREE.Color(0x8d9a68), cHigh = new THREE.Color(0xaeaeb8), cSnow = new THREE.Color(0xf0edf7), cRiverBed = new THREE.Color(0x4a3f7a);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = this.heightAt(x, z);
      pos.setY(i, h);

      const dist = Math.abs(x - this.riverCenterX(z));
      const riverT = 1 - smoothstep(0, 3.2, dist);
      let col;
      if (h < -0.6) col = cRiverBed.clone();
      else if (h < 1.2) col = cLow.clone().lerp(cMid, smoothstep(-0.6, 1.2, h));
      else if (h < 6) col = cMid.clone().lerp(cHigh, smoothstep(1.2, 6, h));
      else col = cHigh.clone().lerp(cSnow, smoothstep(6, 10.5, h));
      col.lerp(cRiverBed, riverT * 0.6);
      colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const tex = new THREE.TextureLoader().load('assets/ground_arcane.jpg');
    tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(size / 8, size / 8);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshStandardMaterial({ map: tex, vertexColors: true, roughness: 0.95, metalness: 0.04 });
    const ground = new THREE.Mesh(geo, mat);
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.terrain = ground;

    const ringGeo = new THREE.RingGeometry(2, 6, 40);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd76a, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = this.heightAt(0, 0) + 0.04;
    this.scene.add(ring);
  },

  buildRiver() {
    const halfWidth = 2.5;
    const steps = 64;
    const positions = [];
    const uvs = [];
    for (let i = 0; i <= steps; i++) {
      const z = -this.worldRadius + (i / steps) * this.worldRadius * 2;
      const cx = this.riverCenterX(z);
      const y = this.heightAt(cx, z) + 0.18;
      positions.push(cx - halfWidth, y, z, cx + halfWidth, y, z);
      uvs.push(0, i / 4, 1, i / 4);
    }
    const indices = [];
    for (let i = 0; i < steps; i++) {
      const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
      indices.push(a, c, b, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const tex = new THREE.TextureLoader().load('assets/glow.png');
    tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 8);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x2f7bb0, transparent: true, opacity: 0.75, roughness: 0.25, metalness: 0.1,
      emissive: 0x0e3a55, emissiveIntensity: 0.4, alphaMap: tex,
    });
    const river = new THREE.Mesh(geo, mat);
    this.scene.add(river);
    this.riverTex = tex;
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
    this.scene.add(sky);

    const moon = this.makeGlowSprite(0xffe0c2, 9, 1);
    moon.position.set(-22, 16, -58);
    this.scene.add(moon);
  },

  buildLights() {
    const hemi = new THREE.HemisphereLight(0xd9b6ff, 0x2a1050, 0.9);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffe3c2, 1.4);
    sun.position.set(14, 22, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(768, 768);
    const d = PLAY_RADIUS + 8;
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

  /* ---------------- decor ---------------- */

  buildDecor() {
    const rand = mulberry32(1337);
    for (let i = 0; i < 16; i++) {
      const a = rand() * Math.PI * 2;
      const d = 12 + rand() * (this.worldRadius - 16);
      const pos = new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d);
      pos.y = this.heightAt(pos.x, pos.z);
      const kind = rand() > 0.5 ? 'crystal' : 'tree';
      this.decor.push({ kind, pos, rotY: rand() * Math.PI * 2, scale: 0.8 + rand() * 0.7, obj: null });
    }
    for (let i = 0; i < 10; i++) {
      const a = rand() * Math.PI * 2;
      const d = 9 + rand() * (this.worldRadius - 13);
      const pos = new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d);
      pos.y = this.heightAt(pos.x, pos.z);
      this.decor.push({ kind: 'rock', pos, rotY: rand() * Math.PI * 2, scale: 0.6 + rand() * 0.9, obj: null });
    }

    const crystalMat = new THREE.MeshStandardMaterial({ color: 0x9d7bff, emissive: 0x4a2f8f, emissiveIntensity: 0.6, roughness: 0.25, metalness: 0.3 });
    const crystalBaseMat = new THREE.MeshStandardMaterial({ color: 0x5b3a8f, roughness: 0.7 });
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x5c5470, roughness: 0.85 });
    let crystalLights = 0;
    this.decor.forEach(d => {
      if (d.kind === 'crystal') {
        const group = new THREE.Group();
        const base = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.4, 0.7), crystalBaseMat);
        base.position.y = 0.2; base.castShadow = true; base.receiveShadow = true;
        const gem = new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.8, 6), crystalMat);
        gem.position.y = 0.4 + 0.9; gem.castShadow = true;
        group.add(base, gem);
        const glow = this.makeGlowSprite(0xb385ff, 1.6 * d.scale, 0.4);
        glow.position.y = 1.5;
        group.add(glow);
        if (crystalLights < 4) {
          const pl = new THREE.PointLight(0x9d7bff, 1.2, 6, 2);
          pl.position.y = 1.2;
          group.add(pl);
          crystalLights++;
        }
        group.position.copy(d.pos);
        group.rotation.y = d.rotY;
        group.scale.setScalar(d.scale);
        group.add(this.makeShadowBlob(d.scale * 1.8));
        this.scene.add(group);
        d.obj = group;
      } else if (d.kind === 'rock') {
        const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.7, 0), rockMat);
        rock.position.copy(d.pos); rock.position.y += 0.35 * d.scale;
        rock.rotation.set(d.rotY * 0.3, d.rotY, d.rotY * 0.6);
        rock.scale.set(d.scale, d.scale * 0.8, d.scale);
        rock.castShadow = true; rock.receiveShadow = true;
        this.scene.add(rock);
        d.obj = rock;
      }
    });
  },

  loadTreeModel() {
    new OBJLoader().load('assets/tree.obj', (obj) => {
      const mat = new THREE.MeshStandardMaterial({ color: 0x4a3050, roughness: 0.85 });
      obj.traverse(c => { if (c.isMesh) { c.material = mat; c.castShadow = true; c.receiveShadow = true; } });
      const box = new THREE.Box3().setFromObject(obj);
      const height = box.max.y - box.min.y || 1;
      const targetHeight = 3.6;
      const scaleFactor = targetHeight / height;

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

      this.decor.forEach(d => {
        if (d.kind !== 'tree') return;
        const inst = obj.clone(true);
        inst.position.copy(d.pos);
        inst.rotation.y = d.rotY;
        inst.scale.setScalar(scaleFactor * d.scale);
        inst.add(this.makeShadowBlob(1.6 * d.scale));
        this.scene.add(inst);
        d.obj = inst;
        if (blossomLocalPoints) {
          const colors = [0xffb3e6, 0xc9a8ff, 0xffd9a0];
          blossomLocalPoints.forEach((p, i) => {
            const glow = this.makeGlowSprite(colors[i % colors.length], 0.5, 0.85);
            glow.position.copy(p).multiplyScalar(scaleFactor * d.scale);
            inst.add(glow);
          });
        }
      });
    });
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

  /* ---------------- spawning ---------------- */

  randomRingPos(minR, maxR) {
    const a = Math.random() * Math.PI * 2;
    const d = minR + Math.random() * (maxR - minR);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    return new THREE.Vector3(x, this.heightAt(x, z), z);
  },

  randomMonsterSpawnPos() {
    for (let tries = 0; tries < 12; tries++) {
      const pos = this.randomRingPos(6, PLAY_RADIUS + 2);
      if (pos.distanceTo(this.player.pos) > 11) return pos;
    }
    return this.randomRingPos(6, PLAY_RADIUS + 2);
  },

  spawnMonsterSlot(delay) {
    const colors = ['green', 'blue', 'purple', 'orange'];
    const pos = this.randomMonsterSpawnPos();
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
    const pos = this.randomRingPos(5, PLAY_RADIUS);
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
    let castInterval = null;
    const startCast = (e) => {
      if (this.paused) return;
      this.fireProjectile();
      castInterval = setInterval(() => this.fireProjectile(), 420);
      e.preventDefault();
    };
    const stopCast = () => { if (castInterval) { clearInterval(castInterval); castInterval = null; } };
    castBtn.addEventListener('pointerdown', startCast);
    castBtn.addEventListener('pointerup', stopCast);
    castBtn.addEventListener('pointercancel', stopCast);
    castBtn.addEventListener('pointerleave', stopCast);

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

  fireProjectile() {
    if (this.castCooldown > performance.now()) return;
    this.castCooldown = performance.now() + 380;
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
    const mat = new THREE.MeshBasicMaterial({ color: visual.color });
    const mesh = new THREE.Mesh(this.projGeo[powerId], mat);
    if (visual.shape === 'cone') mesh.rotation.x = Math.PI / 2;
    const glow = this.makeGlowSprite(visual.glow, 1.1, 0.75);
    mesh.add(glow);
    mesh.position.copy(this.player.pos);
    this.scene.add(mesh);
    this.projectiles.push({ pos: mesh.position, dir, powerId, visual, life: 2.4, target, obj: mesh, trailTimer: 0 });
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
    m.pos = this.randomMonsterSpawnPos();
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
    s.pos = this.randomRingPos(5, PLAY_RADIUS);
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
      const backHome = this.player.pos.clone().normalize().multiplyScalar(6);
      if (!isFinite(backHome.x)) backHome.set(0, 0, 6);
      this.player.pos.x = backHome.x; this.player.pos.z = backHome.z;
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
            const target = this._v2.set(m.pos.x + Math.cos(a) * d, 0, m.pos.z + Math.sin(a) * d);
            const r = Math.hypot(target.x, target.z);
            if (r > PLAY_RADIUS + 1) { target.x *= (PLAY_RADIUS + 1) / r; target.z *= (PLAY_RADIUS + 1) / r; }
            m.wanderTarget = new THREE.Vector3(target.x, 0, target.z);
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
    const distFromCenter = Math.hypot(p.pos.x, p.pos.z);
    if (distFromCenter > this.worldRadius - 1.5) {
      const s = (this.worldRadius - 1.5) / distFromCenter;
      p.pos.x *= s; p.pos.z *= s;
    }
    const groundY = this.heightAt(p.pos.x, p.pos.z);
    p.pos.y = groundY + 1.6 + Math.sin(this.bobPhase) * 0.04;

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

    if (this.riverTex) this.riverTex.offset.y -= dt * 0.35;

    const now = performance.now();
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
      const hitR = pr.visual.hitRadius || 2.0;
      this.monsters.forEach(m => {
        if (!hit && m.alive && m.pos.distanceTo(pr.pos) < hitR) { this.onMonsterKilled(m, pr.visual); hit = true; }
      });
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
