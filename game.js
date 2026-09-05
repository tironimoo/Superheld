import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

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

// Enemy species: each has its own toughness and an elemental weakness/resistance,
// so picking the right power against the right monster actually matters. Every
// power is somebody's weakness and somebody else's resistance, so the six
// powers all stay useful across the roster. "attachment" adds a small extra
// bit of geometry in buildMonsterVisual/buildShadeVisual for a distinct silhouette.
const MONSTER_TYPES = [
  { id: 'wicht', name: 'Wicht', tint: 0x57d68d, hp: 2, weak: null, resist: null, model: 'fox', scale: 1, aura: null, attachment: null },
  { id: 'flammling', name: 'Flammling', tint: 0xff7043, hp: 2, weak: 'eis', resist: 'feuer', model: 'fox', scale: 1, aura: 0xff6b35, attachment: 'flame' },
  { id: 'frostling', name: 'Frostling', tint: 0x4fc3f7, hp: 2, weak: 'feuer', resist: 'eis', model: 'fox', scale: 1, aura: 0x8fdcff, attachment: 'spike' },
  { id: 'steinling', name: 'Steinling', tint: 0x8d6e63, hp: 3, weak: 'kraft', resist: 'blitz', model: 'fox', scale: 1.3, aura: 0xa1887f, attachment: 'rock' },
  { id: 'funkling', name: 'Funkling', tint: 0xfdd835, hp: 2, weak: 'schild', resist: 'flug', model: 'fox', scale: 0.9, aura: 0xfff2a8, attachment: 'spark' },
  { id: 'riesenwicht', name: 'Riesenwicht', tint: 0x6d8f6a, hp: 4, weak: null, resist: null, model: 'fox', scale: 1.6, aura: null, attachment: 'horns' },
  { id: 'schatten', name: 'Schattenschwinge', tint: 0xb085f5, hp: 2, weak: 'flug', resist: 'kraft', model: 'parrot', scale: 1, aura: 0x7e57c2, attachment: null, hover: true },
  { id: 'traumgeist', name: 'Traumgeist', tint: 0x5c4fd6, hp: 3, weak: 'blitz', resist: 'schild', model: 'flamingo', scale: 1, aura: 0x8a7cff, attachment: null, hover: true },
  { id: 'schattenross', name: 'Schattenross', tint: 0x2a1a45, hp: 7, weak: 'schild', resist: 'kraft', model: 'horse', scale: 1.8, aura: 0x7e57c2, attachment: null, boss: true },
];
const MAX_HEALTH = 5;

// Real animated glTF models beyond the fox, vendored from the three.js repo's
// classic low-poly bird/horse examples — self-contained .glb with a single
// looping morph-target animation each (no skeleton, so no per-clip switching).
const MODEL_DEFS = {
  fox: { url: 'assets/models/fox.glb', targetHeight: 1.05, multiClip: true },
  parrot: { url: 'assets/models/Parrot.glb', targetHeight: 0.85 },
  flamingo: { url: 'assets/models/Flamingo.glb', targetHeight: 1.5 },
  horse: { url: 'assets/models/Horse.glb', targetHeight: 3.0 },
};

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
    color: 0xff6b35, glow: 0xffb347, shape: 'sphere', size: 0.3, speed: 22, tex: 'cloud',
    trailColor: 0xff8c42, trailRate: 70,
    burst: { count: 12, speed: [3, 6], colors: [0xff6b35, 0xffb347, 0xffd54f], gravity: 4, spreadUp: 0.6 },
  },
  eis: {
    color: 0x4fc3f7, glow: 0xdcf6ff, shape: 'octahedron', size: 0.34, speed: 19, tex: 'snowflake',
    trailColor: 0xbfe9ff, trailRate: 80,
    burst: { count: 10, speed: [2, 4], colors: [0x4fc3f7, 0xb3e5fc, 0xffffff], gravity: 1.5, spreadUp: 0.3 },
  },
  blitz: {
    color: 0xfdd835, glow: 0xd9a6ff, shape: 'box', size: [0.16, 0.16, 0.55], speed: 34, tex: 'spark',
    trailColor: 0xfff2a8, trailRate: 40,
    burst: { count: 8, speed: [5, 9], colors: [0xfdd835, 0xab47bc, 0xffffff], gravity: 2, spreadUp: 0.4 },
  },
  kraft: {
    color: 0x8d6e63, glow: 0xffd54f, shape: 'box', size: [0.4, 0.4, 0.4], speed: 14,
    trailColor: null, trailRate: 0, hitRadius: 2.6, shake: 0.18,
    burst: { count: 10, speed: [2, 4.5], colors: [0x8d6e63, 0x6b4a2f, 0xffd54f], gravity: 9, spreadUp: 0.1 },
  },
  schild: {
    color: 0xec407a, glow: 0x7e57c2, shape: 'torus', size: [0.22, 0.09], speed: 18, tex: 'circle',
    trailColor: 0xec407a, rainbow: true, trailRate: 55,
    burst: { count: 14, speed: [2.5, 5], colors: [0xec407a, 0x7e57c2, 0x4fc3f7, 0xffd76a, 0x63e6a0], gravity: 3, spreadUp: 0.5 },
  },
  flug: {
    color: 0x81d4fa, glow: 0xffffff, shape: 'cone', size: [0.2, 0.5], speed: 20, tex: 'circle',
    trailColor: 0xe8f7ff, trailRate: 60,
    burst: { count: 12, speed: [1.5, 3.5], colors: [0xffffff, 0x81d4fa, 0xe0f7ff], gravity: 0.6, spreadUp: 0.8 },
  },
};

// First-person cast animations: how the viewmodel hands move for each power.
// hands: 'both' | 'right' | 'spread'. pos/rot are the peak offset from the
// resting pose, reached mid-swing and eased back out — a different silhouette
// of motion per power (throw, punch, jab, spread-summon, upward sweep).
const HAND_ANIMS = {
  feuer: { hands: 'both', duration: 380, pos: [0, 0.3, 0.28], rot: [0.4, 0, 0] },
  eis: { hands: 'spread', duration: 380, pos: [0.16, 0.24, 0.18], rot: [0.2, 0, 0.35] },
  blitz: { hands: 'right', duration: 260, pos: [0.1, 0.32, 0.22], rot: [0.6, 0, 0] },
  kraft: { hands: 'both', duration: 420, pos: [0, 0.22, 0.25], rot: [0.7, 0, 0] },
  schild: { hands: 'spread', duration: 420, pos: [0.18, 0.3, 0.12], rot: [-0.3, 0, 0.5] },
  flug: { hands: 'both', duration: 400, pos: [0, 0.48, 0.12], rot: [-0.7, 0, 0] },
};

const CRYSTAL_BURST = { count: 10, speed: [2, 4], colors: [0x9d7bff, 0xffffff, 0xb385ff], gravity: 2, spreadUp: 0.5 };
const TREASURE_BURST = { count: 26, speed: [3, 7], colors: [0xffd76a, 0xffb02e, 0xffffff, 0xff6b35], gravity: 5, spreadUp: 0.7 };
const GUARD_TYPE_IDS = ['riesenwicht', 'steinling', 'traumgeist', 'schatten'];
const STAR_MAGNET_RADIUS = 4.5;

// Deterministic-but-persistent treasure location: derived from a per-hero
// random seed (stored in the save) and the current quest level, so it's
// stable across reloads and moves farther out (with tougher guards) each
// time a treasure is claimed.
function questTargetFor(seed, level) {
  const rand = mulberry32((seed + level * 7919) >>> 0);
  const angle = rand() * Math.PI * 2;
  const dist = 55 + level * 40;
  return { x: Math.cos(angle) * dist, z: Math.sin(angle) * dist };
}

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
  bobPhase: 0, landDip: 0,
  health: MAX_HEALTH, lastHitAt: 0, lastRegenAt: 0, invulnUntil: 0, damageBoostUntil: 0,
  treeReady: false, pendingTrees: [], foxTemplate: null, foxClips: null,
  shakeTime: 0, shakeMag: 0, shakeDur: 0.25,
  _lastChunkX: null, _lastChunkZ: null,
  chunkQueue: [], _chunkQueueSet: new Set(),
  _particlePool: [], _maxParticles: 220,
  _v1: new THREE.Vector3(), _v2: new THREE.Vector3(),
  _burstOffset: new THREE.Vector3(0, 0.6, 0),
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

    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    // Bloom runs at half resolution — a big perf win on weaker/mobile GPUs
    // since the glow is a soft blur anyway and loses little visible detail.
    const bloom = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.45, 0.55, 0.74);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    this.composer = composer;
    this.bloom = bloom;

    // Loaded before buildSky so the sky can reuse the cloud texture.
    this.loadPowerTextures();
    this.buildSky();
    this.buildLights();
    this.buildTerrainMaterial();
    this.buildWater();
    this.buildDecorTemplates();
    this.buildProjectileGeometries();
    this.buildChargeOrb();
    this.loadTreeModel();
    this.models = {};
    Object.keys(MODEL_DEFS).forEach(key => this.loadGltfModel(key));

    this.buildHands();

    this.updateChunks(true);
    for (let i = 0; i < 8; i++) this.spawnMonsterSlot(1 + i * 0.35);
    for (let i = 0; i < 6; i++) this.spawnStar(0);
    this.setupQuest();

    this.setupInput();
    this.resize();
    return true;
  },

  /* ---------------- quest: an escalating treasure hunt with a compass ---------------- */

  setupQuest() {
    const state = ST.get();
    let t = questTargetFor(state.questSeed, state.questLevel);
    let y = this.heightAt(t.x, t.z);
    for (let tries = 0; y < WATER_LEVEL + 1.0 && tries < 20; tries++) {
      t = { x: t.x + Math.cos(tries * 2.4) * 8, z: t.z + Math.sin(tries * 2.4) * 8 };
      y = this.heightAt(t.x, t.z);
    }
    this.quest = { targetPos: new THREE.Vector3(t.x, y, t.z), level: state.questLevel, claimed: false, guards: [] };
    this.buildTreasure();
    this.buildRuins();
    this.spawnGuards();
    this.spawnBoss();
  },

  buildRuins() {
    if (this.ruinsGroup) { this.scene.remove(this.ruinsGroup); this.ruinsGroup = null; }
    const group = new THREE.Group();
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x4a4560, roughness: 0.85 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x2e1f47, roughness: 0.7 });
    const n = 6;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = 7.5;
      const broken = i % 3 === 0;
      const h = broken ? 2.2 : 4 + (i % 2) * 1.2;
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.65, h, 8), stoneMat);
      pillar.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r);
      pillar.rotation.z = broken ? 0.3 : 0;
      pillar.castShadow = true; pillar.receiveShadow = true;
      group.add(pillar);
      if (!broken) {
        const roof = new THREE.Mesh(new THREE.ConeGeometry(0.75, 1.2, 8), roofMat);
        roof.position.set(Math.cos(a) * r, h + 0.6, Math.sin(a) * r);
        roof.castShadow = true;
        group.add(roof);
      }
    }
    group.position.copy(this.quest.targetPos);
    this.scene.add(group);
    this.ruinsGroup = group;
  },

  spawnBoss() {
    const type = MONSTER_TYPES.find(t => t.boss);
    if (!type) return;
    const m = this.spawnMonsterSlot(1.6, { type, anchor: this.quest.targetPos });
    m.isBoss = true;
    m.hp += (this.quest.level - 1) * 2;
    m.maxHp = m.hp;
    this.quest.guards.push(m);
  },

  buildTreasure() {
    if (this.treasureGroup) { this.scene.remove(this.treasureGroup); this.treasureGroup = null; }
    const group = new THREE.Group();
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.7, metalness: 0.2 });
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xffd76a, emissive: 0xffb02e, emissiveIntensity: 0.5, roughness: 0.3, metalness: 0.6 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.7, 0.8), baseMat);
    base.position.y = 0.35; base.castShadow = true; base.receiveShadow = true;
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.8, 10, 1, false, 0, Math.PI), goldMat);
    lid.rotation.z = Math.PI / 2;
    lid.scale.set(1, 0.85, 1);
    lid.position.y = 0.72;
    lid.castShadow = true;
    group.add(base, lid);
    const glow = this.makeGlowSprite(0xffd76a, 3, 0.6);
    glow.position.y = 1.2;
    group.add(glow);
    const light = new THREE.PointLight(0xffd76a, 2, 14, 2);
    light.position.y = 1.0;
    group.add(light);
    const ringGeo = new THREE.RingGeometry(1.3, 1.7, 32);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd76a, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    group.add(ring);
    group.position.copy(this.quest.targetPos);
    this.scene.add(group);
    this.treasureGroup = group;
    this.treasureRing = ring;
  },

  spawnGuards() {
    const level = this.quest.level;
    const guardTypes = MONSTER_TYPES.filter(t => GUARD_TYPE_IDS.includes(t.id));
    const count = Math.min(3 + level, 8);
    for (let i = 0; i < count; i++) {
      const type = guardTypes[i % guardTypes.length];
      const m = this.spawnMonsterSlot(i * 0.3, { type, anchor: this.quest.targetPos });
      const bonus = Math.floor((level - 1) / 2);
      m.hp += bonus; m.maxHp = m.hp;
      this.quest.guards.push(m);
    }
  },

  claimTreasure() {
    this.quest.claimed = true;
    const state = ST.get();
    const reward = 20 + this.quest.level * 10;
    state.stars += reward;
    state.starsEarnedTotal += reward;
    state.treasuresFound = (state.treasuresFound || 0) + 1;
    state.questLevel += 1;
    ST.save();
    ST.sfx.success();
    window.G.ui.toast(`🏆 Schatz gehoben! +${reward} ⭐`);
    if (window.G.ui.showTreasureFound) window.G.ui.showTreasureFound();
    window.G.ui.updateHud();
    const newAch = ST.checkAchievements();
    if (newAch.length) window.G.ui.queueAchievements(newAch);
    this.spawnKillBurst(this.quest.targetPos, { burst: TREASURE_BURST });
    this.quest.guards.forEach(g => { g.alive = false; if (g.group) g.group.visible = false; });
    this.quest.guards = [];
    if (this.treasureGroup) { this.scene.remove(this.treasureGroup); this.treasureGroup = null; }
    if (this.ruinsGroup) { this.scene.remove(this.ruinsGroup); this.ruinsGroup = null; }
    this.quest.targetPos = null;
    setTimeout(() => this.setupQuest(), 3000);
  },

  computeCompass(target) {
    const p = this.player;
    const dx = target.x - p.pos.x, dz = target.z - p.pos.z;
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    const cross = fx * dz - fz * dx;
    const dot = fx * dx + fz * dz;
    const angle = Math.atan2(cross, dot);
    return { angleDeg: angle * 180 / Math.PI, dist: Math.hypot(dx, dz) };
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
  // Height + the river-noise sample used for both the height carve and the
  // riverbed color blend, computed once — buildChunk used to call fbm() for
  // the river band twice per vertex (once inside heightAt, once again for
  // color), which measurably added up over a whole chunk.
  heightAndRiver(x, z) {
    const macro = this.fbm(x * 0.006, z * 0.006, 5, 4.7);
    const detail = this.fbm(x * 0.05 + 500, z * 0.05 + 500, 4, 9.3);
    let h = 4.5 + macro * 6.5 + detail * 1.3;
    const rn = this.fbm(x * 0.014 + 3000, z * 0.014 + 3000, 3, 6.1);
    h -= (1 - smoothstep(0, 0.085, Math.abs(rn))) * 4.2;
    return { h, riverT: 1 - smoothstep(0, 0.1, Math.abs(rn)) };
  },
  heightAt(x, z) {
    return this.heightAndRiver(x, z).h;
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
      const { h, riverT } = this.heightAndRiver(wx, wz);
      pos.setY(i, h);
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

  // Crossing a chunk boundary can need up to a whole new row/column of chunks
  // (each with a heightmap + decor) at once. Building them all synchronously
  // in a single frame was the main cause of the reported stutter, so new
  // chunks are queued (nearest first) and drip-fed a few per frame instead —
  // see processChunkQueue(), called every frame from update().
  updateChunks(force) {
    const p = this.player.pos;
    const ccx = Math.round(p.x / CHUNK_SIZE), ccz = Math.round(p.z / CHUNK_SIZE);
    if (!force && ccx === this._lastChunkX && ccz === this._lastChunkZ) return;
    this._lastChunkX = ccx; this._lastChunkZ = ccz;
    const needed = [];
    for (let dz = -VIEW_RADIUS; dz <= VIEW_RADIUS; dz++) {
      for (let dx = -VIEW_RADIUS; dx <= VIEW_RADIUS; dx++) {
        const cx = ccx + dx, cz = ccz + dz, key = cx + ',' + cz;
        if (!this.chunks.has(key) && !this._chunkQueueSet.has(key)) needed.push({ cx, cz, key });
      }
    }
    needed.sort((a, b) => (Math.abs(a.cx - ccx) + Math.abs(a.cz - ccz)) - (Math.abs(b.cx - ccx) + Math.abs(b.cz - ccz)));
    needed.forEach(n => { this._chunkQueueSet.add(n.key); this.chunkQueue.push(n); });
    if (force) {
      while (this.chunkQueue.length) {
        const n = this.chunkQueue.shift();
        this._chunkQueueSet.delete(n.key);
        this.buildChunk(n.cx, n.cz);
      }
    }
    const keep = VIEW_RADIUS + 1;
    for (const [key, c] of this.chunks) {
      if (Math.abs(c.cx - ccx) > keep || Math.abs(c.cz - ccz) > keep) this.disposeChunk(key);
    }
    this.chunkQueue = this.chunkQueue.filter(n => {
      const inRange = Math.abs(n.cx - ccx) <= keep && Math.abs(n.cz - ccz) <= keep;
      if (!inRange) this._chunkQueueSet.delete(n.key);
      return inRange;
    });
  },

  processChunkQueue() {
    const budget = 2;
    for (let i = 0; i < budget && this.chunkQueue.length; i++) {
      const n = this.chunkQueue.shift();
      this._chunkQueueSet.delete(n.key);
      if (!this.chunks.has(n.key)) this.buildChunk(n.cx, n.cz);
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

    // A dusk sky with nothing in it reads as flat colour. A field of stars
    // gives it a ceiling for one extra draw call. (Drifting cloud sprites were
    // tried here too and dropped: at sky scale the texture's square edge was
    // visible and its core blew out under bloom.)
    const starCount = 240;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      // Spread over the upper dome only, kept off the horizon where the
      // terrain and fog would swallow them anyway.
      const theta = Math.random() * Math.PI * 2;
      const y = 0.18 + Math.random() * 0.8;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      starPos[i * 3] = Math.cos(theta) * r * 88;
      starPos[i * 3 + 1] = y * 76 + 4;
      starPos[i * 3 + 2] = Math.sin(theta) * r * 88;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    const starMat = new THREE.PointsMaterial({
      // Without a map, points rasterise as hard squares — the round sprite
      // texture is what makes them read as stars rather than grey pixels.
      map: this.powerTex && this.powerTex.circle,
      color: 0xfff4d6, size: 0.55, sizeAttenuation: true,
      transparent: true, opacity: 0.85, depthWrite: false, fog: false,
      blending: THREE.AdditiveBlending,
    });
    const starField = new THREE.Points(starGeo, starMat);
    starField.renderOrder = -9;
    skyGroup.add(starField);
    this.starField = starField;

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

  loadPowerTextures() {
    const loader = new THREE.TextureLoader();
    this.powerTex = {
      cloud: loader.load('assets/textures/cloud.png'),
      snowflake: loader.load('assets/textures/snowflake2.png'),
      spark: loader.load('assets/textures/spark1.png'),
      circle: loader.load('assets/textures/circle.png'),
    };
  },

  makeGlowSprite(color, size, opacity, tex) {
    const useTex = tex || this._glowTex || (this._glowTex = new THREE.TextureLoader().load('assets/glow.png'));
    const mat = new THREE.SpriteMaterial({ map: useTex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true, opacity: opacity ?? 0.7 });
    const s = new THREE.Sprite(mat);
    s.scale.set(size, size, 1);
    return s;
  },

  // Trail/impact particles are extremely short-lived and spawned in bursts
  // (up to 26 at once on a treasure claim), so creating a fresh Sprite +
  // SpriteMaterial for every single one caused GC-driven stutter right when
  // several enemies died close together. Pooled sprites stay in the scene
  // permanently and are just hidden/reconfigured for reuse instead.
  acquireSprite(color, size, opacity, tex) {
    let spr = this._particlePool.pop();
    if (!spr) {
      spr = this.makeGlowSprite(color, size, opacity, tex);
      this.scene.add(spr);
    } else {
      spr.material.map = tex || this._glowTex;
      spr.material.color.set(color);
      spr.material.opacity = opacity;
      spr.material.needsUpdate = true;
      spr.scale.set(size, size, 1);
      spr.visible = true;
    }
    return spr;
  },
  releaseSprite(spr) {
    spr.visible = false;
    this._particlePool.push(spr);
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

  /* ---------------- first-person hands + per-power cast animation ---------------- */

  buildHands() {
    const state = ST.get();
    const skin = ST.SKINS.find(s => s.id === state.skin) || ST.SKINS[0];
    this.handL = this.buildHandVariant(-1, skin.handStyle || 'robe', skin.color);
    this.handR = this.buildHandVariant(1, skin.handStyle || 'robe', skin.color);
    const handsGroup = new THREE.Group();
    handsGroup.add(this.handL, this.handR);
    handsGroup.renderOrder = 999;
    this.camera.add(handsGroup);
    this.scene.add(this.camera);
    this.handsGroup = handsGroup;
  },

  // Each avatar archetype gets a distinct viewmodel hand silhouette instead of
  // a single generic fist, so choosing Skelett/Oktopus/etc. actually shows.
  buildHandVariant(sign, style, color) {
    const g = new THREE.Group();
    const accentMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.6 });
    const skinToneMat = new THREE.MeshStandardMaterial({ color: 0xe8b98a, roughness: 0.55 });
    const boneMat = new THREE.MeshStandardMaterial({ color: 0xe8e4d8, roughness: 0.5 });

    if (style === 'oktopus') {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0, 0.15),
        new THREE.Vector3(0, -0.05, -0.05),
        new THREE.Vector3(sign * 0.07, -0.02, -0.28),
        new THREE.Vector3(sign * 0.16, 0.07, -0.48),
      ]);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 12, 0.065, 8, false), accentMat);
      g.add(tube);
      [0.25, 0.5, 0.75].forEach(t => {
        const p = curve.getPointAt(t);
        const sucker = new THREE.Mesh(new THREE.SphereGeometry(0.032, 6, 6), skinToneMat);
        sucker.position.copy(p);
        g.add(sucker);
      });
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), accentMat);
      tip.position.copy(curve.getPointAt(1));
      g.add(tip);
    } else if (style === 'skelett') {
      const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.34, 6), boneMat);
      forearm.position.set(0, -0.06, 0.2);
      forearm.rotation.x = Math.PI * 0.42;
      g.add(forearm);
      const knuckle = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), boneMat);
      knuckle.position.set(0, 0.02, 0.02);
      g.add(knuckle);
      for (let i = -1; i <= 1; i++) {
        const finger = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.14, 5), boneMat);
        finger.position.set(i * 0.045, 0.06, -0.06);
        finger.rotation.x = -0.3;
        g.add(finger);
      }
    } else if (style === 'monster') {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.3, 8), accentMat);
      arm.position.set(0, -0.08, 0.2);
      arm.rotation.x = Math.PI * 0.42;
      g.add(arm);
      const fist = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), accentMat);
      fist.position.set(0, 0.02, 0.02);
      g.add(fist);
      const clawMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.4 });
      for (let i = -1; i <= 1; i++) {
        const claw = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.09, 6), clawMat);
        claw.position.set(i * 0.05, 0.06, -0.08);
        claw.rotation.x = -Math.PI / 2.3;
        g.add(claw);
      }
    } else if (style === 'fee') {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, 0.32, 8), skinToneMat);
      arm.position.set(0, -0.06, 0.2);
      arm.rotation.x = Math.PI * 0.42;
      g.add(arm);
      const fist = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), skinToneMat);
      fist.position.set(0, 0.02, 0.02);
      g.add(fist);
      const sparkle = this.makeGlowSprite(new THREE.Color(color).getHex(), 0.3, 0.8);
      sparkle.position.set(0, 0.08, -0.02);
      g.add(sparkle);
    } else {
      // 'robe' — Zauberer/Hexe: a wide sleeve ending in a plain hand
      const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.36, 8), accentMat);
      sleeve.position.set(0, -0.06, 0.2);
      sleeve.rotation.x = Math.PI * 0.42;
      g.add(sleeve);
      const fist = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), skinToneMat);
      fist.position.set(0, 0.02, 0.02);
      g.add(fist);
    }
    g.traverse(c => { if (c.isMesh) c.castShadow = false; });
    g.position.set(sign * 0.26, -0.32, -0.55);
    g.rotation.z = sign * 0.25;
    return g;
  },

  setHandPose(hand, sign, swing, anim, mirrorX) {
    const baseX = sign * 0.26, baseY = -0.32, baseZ = -0.55;
    const mx = mirrorX === undefined ? 1 : mirrorX;
    const ox = anim ? anim.pos[0] * mx * swing : 0;
    const oy = anim ? anim.pos[1] * swing : 0;
    const oz = anim ? anim.pos[2] * swing : 0;
    hand.position.set(baseX + ox, baseY + oy, baseZ + oz);
    hand.rotation.set(anim ? anim.rot[0] * swing : 0, anim ? anim.rot[1] * swing : 0, sign * 0.25 + (anim ? anim.rot[2] * mx * swing : 0));
  },

  updateHandAnim(now) {
    if (!this.handAnim) return;
    const anim = HAND_ANIMS[this.handAnim.powerId] || HAND_ANIMS.feuer;
    const t = (now - this.handAnim.start) / anim.duration;
    if (t >= 1) {
      this.handAnim = null;
      this.setHandPose(this.handL, -1, 0);
      this.setHandPose(this.handR, 1, 0);
      return;
    }
    const swing = Math.sin(Math.min(Math.max(t, 0), 1) * Math.PI);
    if (anim.hands === 'right') {
      this.setHandPose(this.handL, -1, 0);
      this.setHandPose(this.handR, 1, swing, anim);
    } else if (anim.hands === 'spread') {
      this.setHandPose(this.handL, -1, swing, anim, -1);
      this.setHandPose(this.handR, 1, swing, anim, 1);
    } else {
      this.setHandPose(this.handL, -1, swing, anim);
      this.setHandPose(this.handR, 1, swing, anim);
    }
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
      if (this.crystalLightCount < 3) {
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

  loadGltfModel(key) {
    const def = MODEL_DEFS[key];
    new GLTFLoader().load(def.url, (gltf) => {
      const box = new THREE.Box3().setFromObject(gltf.scene);
      const height = box.max.y - box.min.y || 1;
      this.models[key] = {
        template: gltf.scene, clips: gltf.animations,
        scaleFactor: def.targetHeight / height, multiClip: !!def.multiClip,
      };
      this.monsters.forEach(m => { if (m.type.model === key && !m.built) this.buildMonsterVisual(m); });
    });
  },

  buildMonsterVisual(m) {
    if (m.type.model === 'shade') { this.buildShadeVisual(m); return; }
    this.buildGltfMonsterVisual(m);
  },

  buildGltfMonsterVisual(m) {
    const modelData = this.models[m.type.model];
    if (!modelData) return;
    const inst = cloneSkeleton(modelData.template);
    inst.scale.setScalar(modelData.scaleFactor * m.type.scale);
    const tint = m.type.tint;
    // Tinted materials are cached per monster type (not per instance): quest
    // guards especially tend to repeat the same 4 types several times over,
    // and sharing one tinted material per mesh-slot across all of them lets
    // the renderer batch those draw calls instead of treating each as unique.
    this._monsterMatCache = this._monsterMatCache || {};
    let cachedMats = this._monsterMatCache[m.type.id];
    if (!cachedMats) {
      cachedMats = [];
      inst.traverse(c => {
        if (c.isMesh) {
          const mat = c.material.clone();
          if (tint) mat.color.set(tint);
          cachedMats.push(mat);
        }
      });
      this._monsterMatCache[m.type.id] = cachedMats;
    }
    let matIdx = 0;
    inst.traverse(c => {
      if (c.isMesh) {
        c.material = cachedMats[matIdx++];
        c.castShadow = true;
      }
    });
    const group = new THREE.Group();
    group.add(inst);
    group.add(this.makeShadowBlob(1.5 * m.type.scale));
    const glow = this.makeGlowSprite(tint || 0xffffff, 1.3 * m.type.scale, 0.35);
    glow.position.y = 0.6 * m.type.scale;
    group.add(glow);
    if (m.type.boss) {
      const bossLight = new THREE.PointLight(m.type.aura || tint, 1.6, 11, 2);
      bossLight.position.y = 1.3 * m.type.scale;
      group.add(bossLight);
    }
    this.addTypeAura(m, group);
    this.addTypeAttachment(m, group);
    this.scene.add(group);

    const mixer = new THREE.AnimationMixer(inst);
    let actions = {}, idle;
    if (modelData.multiClip) {
      modelData.clips.forEach(clip => { actions[clip.name.toLowerCase()] = mixer.clipAction(clip); });
      Object.values(actions).forEach(a => { a.enabled = true; });
      idle = actions.survey || Object.values(actions)[0];
      idle.play();
    } else {
      const action = mixer.clipAction(modelData.clips[0]);
      action.play();
      actions = { survey: action, walk: action, run: action };
      idle = action;
    }

    m.group = group;
    m.mixer = mixer;
    m.actions = actions;
    m.currentAction = idle;
    m.built = true;
    m.group.visible = m.alive;
    m.hoverPhase = Math.random() * 10;
  },

  buildShadeVisual(m) {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x241633, emissive: m.type.tint, emissiveIntensity: 0.55, roughness: 0.55,
      transparent: true, opacity: 0.9,
    });
    const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), bodyMat);
    body.scale.set(1, 0.75, 1);
    body.castShadow = true;
    group.add(body);
    const wingGeo = new THREE.PlaneGeometry(0.75, 0.42);
    const wingMatL = new THREE.MeshBasicMaterial({ color: m.type.tint, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
    const wingL = new THREE.Mesh(wingGeo, wingMatL);
    wingL.position.set(-0.45, 0, 0); wingL.rotation.y = 0.5;
    const wingR = new THREE.Mesh(wingGeo, wingMatL.clone());
    wingR.position.set(0.45, 0, 0); wingR.rotation.y = -0.5;
    group.add(wingL, wingR);
    m.wings = [wingL, wingR];
    const glow = this.makeGlowSprite(m.type.tint, 1.3, 0.4);
    glow.position.y = 0.15;
    group.add(glow);
    this.addTypeAura(m, group);
    this.addTypeAttachment(m, group);
    this.scene.add(group);
    m.group = group;
    m.built = true;
    m.group.visible = m.alive;
    m.hoverPhase = Math.random() * 10;
  },

  // Geometries/materials here are cached and shared across every monster
  // instance that uses them — with up to ~17 monsters alive at once (roaming
  // pack + quest guards + boss), creating a fresh geometry and material per
  // instance for these small decorations added up in draw calls and GPU
  // state changes for no visual benefit, since each attachment kind is only
  // ever used by one fixed-scale monster type anyway.
  addTypeAura(m, group) {
    if (!m.type.aura) return;
    if (!this._auraGeo) this._auraGeo = new THREE.RingGeometry(0.55, 0.8, 20);
    this._auraMatCache = this._auraMatCache || {};
    let mat = this._auraMatCache[m.type.aura];
    if (!mat) {
      mat = new THREE.MeshBasicMaterial({ color: m.type.aura, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
      this._auraMatCache[m.type.aura] = mat;
    }
    const ring = new THREE.Mesh(this._auraGeo, mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.06;
    group.add(ring);
  },

  addTypeAttachment(m, group) {
    const kind = m.type.attachment;
    if (!kind) return;
    const s = m.type.scale;
    this._attachCache = this._attachCache || {};
    const cache = this._attachCache;
    if (kind === 'flame') {
      const flame = this.makeGlowSprite(0xff8c42, 0.7 * s, 0.8);
      flame.position.set(0, 1.05 * s, 0);
      group.add(flame);
      m.attachSprite = flame;
    } else if (kind === 'spike') {
      if (!cache.spike) cache.spike = { geo: new THREE.OctahedronGeometry(0.22 * s, 0), mat: new THREE.MeshStandardMaterial({ color: 0xdcf6ff, emissive: 0x4fc3f7, emissiveIntensity: 0.4, roughness: 0.2 }) };
      const spike = new THREE.Mesh(cache.spike.geo, cache.spike.mat);
      spike.scale.set(0.6, 1.6, 0.6);
      spike.position.set(0, 0.85 * s, -0.15 * s);
      spike.castShadow = true;
      group.add(spike);
    } else if (kind === 'rock') {
      if (!cache.rock) cache.rock = { geo: new THREE.DodecahedronGeometry(0.16 * s, 0), mat: new THREE.MeshStandardMaterial({ color: 0x5c5470, roughness: 0.9 }) };
      [[-0.18, 1], [0.18, -1]].forEach(([off, r]) => {
        const rock = new THREE.Mesh(cache.rock.geo, cache.rock.mat);
        rock.position.set(off * s, 0.95 * s, 0);
        rock.rotation.set(r, r * 0.5, 0);
        rock.castShadow = true;
        group.add(rock);
      });
    } else if (kind === 'spark') {
      const spark = this.makeGlowSprite(0xfff2a8, 0.35, 0.9);
      group.add(spark);
      m.attachSprite = spark;
    } else if (kind === 'horns') {
      if (!cache.horns) cache.horns = { geo: new THREE.ConeGeometry(0.08 * s, 0.34 * s, 6), mat: new THREE.MeshStandardMaterial({ color: 0x3d2b1f, roughness: 0.8 }) };
      [[-0.16, -0.3], [0.16, 0.3]].forEach(([x, rz]) => {
        const horn = new THREE.Mesh(cache.horns.geo, cache.horns.mat);
        horn.position.set(x * s, 1.25 * s, 0.05 * s);
        horn.rotation.z = rz;
        horn.castShadow = true;
        group.add(horn);
      });
    } else if (kind === 'eyes') {
      if (!cache.eyes) cache.eyes = { geo: new THREE.SphereGeometry(0.06 * s, 6, 6), mat: new THREE.MeshBasicMaterial({ color: 0xffe082 }) };
      m.eyeMeshes = [];
      [-0.16, 0.16].forEach(x => {
        const eye = new THREE.Mesh(cache.eyes.geo, cache.eyes.mat);
        eye.position.set(x * s, 0.1 * s, 0.4 * s);
        group.add(eye);
        m.eyeMeshes.push(eye);
      });
    }
  },

  crossfadeTo(m, name, duration) {
    const next = m.actions[name];
    if (!next || next === m.currentAction) return;
    next.reset().setEffectiveWeight(1).fadeIn(duration || 0.3).play();
    m.currentAction.fadeOut(duration || 0.3);
    m.currentAction = next;
  },

  /* ---------------- spawning (always relative to the player, since the world is endless) ---------------- */

  randomRingPosAround(center, minR, maxR) {
    for (let tries = 0; tries < 12; tries++) {
      const a = Math.random() * Math.PI * 2;
      const d = minR + Math.random() * (maxR - minR);
      const x = center.x + Math.cos(a) * d, z = center.z + Math.sin(a) * d;
      const h = this.heightAt(x, z);
      if (h > WATER_LEVEL + 0.3) return new THREE.Vector3(x, h, z);
    }
    const x = center.x + minR, z = center.z;
    return new THREE.Vector3(x, this.heightAt(x, z), z);
  },

  randomRingPosAroundPlayer(minR, maxR) {
    return this.randomRingPosAround(this.player.pos, minR, maxR);
  },

  spawnMonsterSlot(delay, opts) {
    opts = opts || {};
    const type = opts.type || MONSTER_TYPES[Math.floor(Math.random() * MONSTER_TYPES.length)];
    const anchor = opts.anchor || null;
    const pos = anchor ? this.randomRingPosAround(anchor, 3, 9) : this.randomRingPosAroundPlayer(9, 26);
    const m = {
      pos, type, anchor, hp: type.hp, maxHp: type.hp,
      alive: false, built: false, group: null,
      spawnAt: performance.now() + (delay || 0) * 1000,
      state: 'idle', facing: 0, wanderTarget: null,
      idleUntil: 0, lastAttackTick: 0,
      status: null, statusUntil: 0, statusLethal: false, statusStart: 0, statusDrift: null,
    };
    this.monsters.push(m);
    if (type.model === 'shade' || this.models[type.model]) this.buildMonsterVisual(m);
    return m;
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
    if (this.composer) {
      this.composer.setPixelRatio(dpr);
      this.composer.setSize(this.canvas.clientWidth, this.canvas.clientHeight);
    }
    if (this.bloom) this.bloom.resolution.set(this.canvas.clientWidth / 2, this.canvas.clientHeight / 2);
  },

  /* ---------------- combat ---------------- */

  fireProjectile(chargeFrac) {
    chargeFrac = chargeFrac || 0;
    const mega = chargeFrac > 0;
    if (this.castCooldown > performance.now()) return;
    const state = ST.get();
    const powerId = state.activePower;
    if (!(state.powerLevels[powerId] > 0)) return;
    const level = state.powerLevels[powerId];
    this.castCooldown = performance.now() + (mega ? 500 + chargeFrac * 500 : Math.max(280, 380 - (level - 1) * 25));
    ST.sfx.cast();
    // A touch of recoil so casting pushes back instead of just emitting.
    this.addShake(0.1, mega ? 0.10 + chargeFrac * 0.06 : 0.045);
    this.handAnim = { powerId, start: performance.now() };
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
    const scale = (1 + chargeFrac * 2.4) * (1 + (level - 1) * 0.06);
    const mat = new THREE.MeshBasicMaterial({ color: visual.color });
    const mesh = new THREE.Mesh(this.projGeo[powerId], mat);
    if (visual.shape === 'cone') mesh.rotation.x = Math.PI / 2;
    mesh.scale.setScalar(scale);
    const powerTex = visual.tex ? this.powerTex[visual.tex] : null;
    const glow = this.makeGlowSprite(visual.glow, (mega ? 1.8 : 1.1) * scale, 0.75, powerTex);
    mesh.add(glow);
    mesh.position.copy(this.player.pos);
    this.scene.add(mesh);
    this.projectiles.push({
      pos: mesh.position, dir, powerId, visual, level, life: mega ? 3.2 : 2.4, target, obj: mesh, trailTimer: 0,
      mega, hitRadiusMul: mega ? (1.6 + chargeFrac * 1.4) : 1,
    });
  },

  onMonsterKilled(m, visual) {
    const state = ST.get();
    state.kills += 1;
    const reward = 3 + Math.floor(Math.random() * 2) + (m.maxHp - 1) + (m.isBoss ? 15 : 0);
    state.stars += reward;
    state.starsEarnedTotal += reward;
    ST.save();
    ST.sfx.hit();
    window.G.ui.toast(m.isBoss ? `👹 Endgegner besiegt! +${reward} ⭐` : `+${reward} ⭐`);
    window.G.ui.updateHud();
    this.spawnKillBurst(m.pos, visual);
    if (visual.shake) this.addShake(0.25, visual.shake);
    const newAch = ST.checkAchievements();
    if (newAch.length) window.G.ui.queueAchievements(newAch);
    m.alive = false;
    if (m.group) m.group.visible = false;
    m.state = 'idle';
    m.status = null;
    if (m.statusSprite) m.statusSprite.visible = false;
    if (m.group) m.group.scale.setScalar(1);
    m.hp = m.maxHp;
    m.spawnAt = performance.now() + 3000 + Math.random() * 2200;
    m.pos = m.anchor ? this.randomRingPosAround(m.anchor, 3, 9) : this.randomRingPosAroundPlayer(9, 26);
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
    this.damageBoostUntil = now + 8000;
    if (window.G.ui.updateBoost) window.G.ui.updateBoost(true);
    const state = ST.get();
    const reward = 2 + Math.floor(Math.random() * 3);
    state.stars += reward;
    state.starsEarnedTotal += reward;
    ST.save();
    ST.sfx.pickup();
    window.G.ui.toast(`💎 +${reward} ⭐ Kraft-Boost aktiv! (8s doppelter Schaden)`);
    window.G.ui.updateHud();
    this.spawnKillBurst(entry.pos, { burst: CRYSTAL_BURST });
    const newAch = ST.checkAchievements();
    if (newAch.length) window.G.ui.queueAchievements(newAch);
  },

  typeMultiplier(type, powerId) {
    if (type.weak === powerId) return 2;
    if (type.resist === powerId) return 0.5;
    return 1;
  },

  applyStatus(m, powerId, lethal, duration) {
    if (!m.group) { if (lethal) this.onMonsterKilled(m, POWER_VISUALS[powerId]); return; }
    m.status = powerId;
    m.statusStart = performance.now();
    m.statusUntil = m.statusStart + duration * 1000;
    m.statusLethal = lethal;
    if (!m.statusSprite) {
      m.statusSprite = this.makeGlowSprite(0xffffff, 1.4, 0.85);
      m.statusSprite.position.y = 1.0;
      m.group.add(m.statusSprite);
    }
    const visual = POWER_VISUALS[powerId];
    m.statusSprite.material.color.set(visual.glow);
    m.statusSprite.visible = true;
  },

  hitMonster(m, pr) {
    const state = ST.get();
    const level = pr.level || state.powerLevels[pr.powerId] || 1;
    let dmg = (1 + Math.floor((level - 1) / 2)) * (pr.mega ? 2 : 1);
    dmg *= this.typeMultiplier(m.type, pr.powerId);
    if (performance.now() < this.damageBoostUntil) dmg *= 2;
    dmg = Math.max(1, Math.round(dmg));
    m.hp -= dmg;
    const lethal = m.hp <= 0;
    let duration = Math.max(0.7, 2.0 - (level - 1) * 0.32) * (pr.mega ? 0.6 : 1);
    if (!lethal) duration = 0.45;
    if (pr.powerId === 'flug') m.statusDrift = { x: (Math.random() - 0.5) * 3, z: (Math.random() - 0.5) * 3 };
    this.applyStatus(m, pr.powerId, lethal, duration);
    ST.sfx.hit();
    // Non-lethal hits previously only swapped the status glow, so chipping a
    // tough enemy down felt like nothing was landing. A small spray in the
    // power's own colours confirms every connect.
    if (!lethal && pr.visual && pr.visual.burst) {
      this.spawnKillBurst(m.pos, {
        burst: Object.assign({}, pr.visual.burst, { count: 5, speed: [1.4, 2.8] }),
        tex: pr.visual.tex,
      });
    }
    if (m.type.weak === pr.powerId) window.G.ui.toast('💥 Schwachpunkt getroffen!');
  },

  updateMonsterStatus(m, dt, now) {
    const elapsed = (now - m.statusStart) / 1000;
    if (m.status === 'eis') {
      m.statusSprite.scale.setScalar(1.2 + Math.sin(now * 0.01) * 0.1);
    } else if (m.status === 'feuer') {
      m.statusSprite.scale.setScalar(1.0 + Math.sin(now * 0.02) * 0.3);
      m._fireTick = (m._fireTick || 0) - dt;
      if (m._fireTick <= 0) {
        m._fireTick = 0.12;
        this.spawnTrailParticle(this._v1.copy(m.pos).add(this._v2.set(0, 0.8, 0)), 0xff8c42, this.powerTex ? this.powerTex.cloud : null);
      }
    } else if (m.status === 'flug') {
      m.pos.y += dt * 2.2;
      if (m.statusDrift) { m.pos.x += m.statusDrift.x * dt; m.pos.z += m.statusDrift.z * dt; }
      m.facing += dt * 8;
    } else if (m.status === 'blitz') {
      m.group.position.x = m.pos.x + (Math.random() - 0.5) * 0.12;
      m.group.position.z = m.pos.z + (Math.random() - 0.5) * 0.12;
    } else if (m.status === 'kraft') {
      const s = Math.max(0.3, 1 - elapsed * 0.5);
      m.group.scale.set(1.15, s, 1.15);
    } else if (m.status === 'schild') {
      m.facing += dt * 10;
    }
    if (now >= m.statusUntil) {
      if (m.statusLethal) {
        this.onMonsterKilled(m, POWER_VISUALS[m.status]);
      } else {
        m.status = null;
        if (m.statusSprite) m.statusSprite.visible = false;
        m.group.scale.setScalar(1);
      }
    }
  },

  spawnTrailParticle(pos, color, tex) {
    if (this.particles.length >= this._maxParticles) return;
    const sprite = this.acquireSprite(color, 0.45, 0.8, tex);
    sprite.position.copy(pos);
    this.particles.push({ obj: sprite, vel: new THREE.Vector3(0, 0.2, 0), life: 0.3, maxLife: 0.3, grav: 0.4 });
  },

  spawnKillBurst(pos, visual) {
    const b = visual.burst;
    const tex = visual.tex ? this.powerTex[visual.tex] : null;
    for (let i = 0; i < b.count; i++) {
      if (this.particles.length >= this._maxParticles) break;
      const a = Math.random() * Math.PI * 2;
      const el = Math.random() * Math.PI * b.spreadUp;
      const speed = b.speed[0] + Math.random() * (b.speed[1] - b.speed[0]);
      const color = b.colors[Math.floor(Math.random() * b.colors.length)];
      const sprite = this.acquireSprite(color, 0.5, 0.9, tex);
      sprite.position.copy(pos).add(this._burstOffset);
      this.particles.push({
        obj: sprite,
        vel: new THREE.Vector3(Math.cos(a) * Math.cos(el) * speed, Math.sin(el) * speed + 1.2, Math.sin(a) * Math.cos(el) * speed),
        life: 0.7, maxLife: 0.7, grav: b.gravity,
      });
    }
  },

  // shakeMag used to be left at its last value forever, so every later shake
  // inherited the strongest one ever triggered. Routing all of them through
  // here keeps the magnitude tied to the shake that is actually running.
  addShake(duration, magnitude) {
    if (magnitude >= this.shakeMag || this.shakeTime <= 0) {
      this.shakeMag = magnitude;
      this.shakeDur = duration;
      this.shakeTime = duration;
    }
  },

  onLanded(impact, pos) {
    const strength = Math.min(1, (impact - 2.5) / 6);
    this.landDip = 0.10 + strength * 0.16;
    ST.sfx.land();
    // Dust kicks outward along the ground rather than upward, so it reads as
    // scuffed earth instead of another magic burst.
    const count = 4 + Math.round(strength * 4);
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= this._maxParticles) break;
      const a = Math.random() * Math.PI * 2;
      const speed = 1.2 + Math.random() * 1.8 * (0.5 + strength);
      const sprite = this.acquireSprite(0xcbb9a0, 0.42, 0.5);
      sprite.position.set(pos.x, pos.y - 1.5, pos.z);
      this.particles.push({
        obj: sprite,
        vel: new THREE.Vector3(Math.cos(a) * speed, 0.5 + Math.random() * 0.5, Math.sin(a) * speed),
        life: 0.45, maxLife: 0.45, grav: 1.6,
      });
    }
  },

  takeDamage(now) {
    if (now < this.invulnUntil) return;
    this.health = Math.max(0, this.health - 1);
    this.lastHitAt = now;
    this.invulnUntil = now + 1000;
    ST.sfx.miss();
    this.addShake(0.3, 0.18);
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
    if (m.status) {
      this.updateMonsterStatus(m, dt, now);
      if (m.group && m.alive) { m.group.position.copy(m.pos); m.group.rotation.y = m.facing; }
      return;
    }
    const anchorPos = m.anchor || this.player.pos;
    const leash = m.anchor ? 16 : 38;
    if (m.pos.distanceTo(anchorPos) > leash) {
      m.pos.copy(this.randomRingPosAround(anchorPos, m.anchor ? 3 : 9, m.anchor ? 9 : 26));
      m.wanderTarget = null;
      m.idleUntil = 0;
    }

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

    const hover = (m.type.model === 'shade' || m.type.hover) ? 1.3 + Math.sin(now * 0.003 + m.hoverPhase) * 0.2 : 0;
    m.pos.y = this.heightAt(m.pos.x, m.pos.z) + hover;

    if (m.built) {
      if (m.mixer) { this.crossfadeTo(m, animName, 0.35); m.mixer.update(dt); }
      if (m.wings) {
        const f = Math.sin(now * 0.012 + m.hoverPhase) * 0.4;
        m.wings[0].rotation.z = f; m.wings[1].rotation.z = -f;
      }
      this.animateAttachment(m, now);
      m.group.position.copy(m.pos);
      m.group.rotation.y = m.facing;
    }
  },

  animateAttachment(m, now) {
    if (m.attachSprite) {
      if (m.type.attachment === 'spark') {
        const a = now * 0.006 + m.hoverPhase;
        m.attachSprite.position.set(Math.cos(a) * 0.5 * m.type.scale, 0.9 * m.type.scale + Math.sin(a * 2) * 0.1, Math.sin(a) * 0.5 * m.type.scale);
      } else {
        m.attachSprite.scale.setScalar(0.7 * m.type.scale * (1 + Math.sin(now * 0.02 + m.hoverPhase) * 0.25));
      }
    }
    if (m.eyeMeshes) {
      const b = 0.1 * m.type.scale + Math.sin(now * 0.004 + m.hoverPhase) * 0.03 * m.type.scale;
      m.eyeMeshes.forEach(e => { e.position.y = b; });
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
    if (this.jumpOffset <= 0) {
      // Landing used to be instant and silent, which made jumping feel
      // weightless. Catch the touchdown frame and answer it with a knee-bend
      // dip, a puff of dust and a thud scaled to how hard you came down.
      const impact = -this.vy;
      this.jumpOffset = 0;
      this.vy = 0;
      if (!this.grounded && impact > 2.5) this.onLanded(impact, p.pos);
      this.grounded = true;
    }
    if (this.landDip > 0) this.landDip = Math.max(0, this.landDip - dt * 1.4);

    const groundY = this.heightAt(p.pos.x, p.pos.z);
    p.pos.y = groundY + 1.6 + this.jumpOffset + (this.grounded ? Math.sin(this.bobPhase) * 0.04 : 0) - this.landDip;

    this.updateChunks(false);
    this.processChunkQueue();
    if (this.skyGroup) this.skyGroup.position.set(p.pos.x, 0, p.pos.z);
    if (this.starField) this.starField.material.opacity = 0.62 + Math.sin(this.clock.elapsedTime * 1.3) * 0.18;
    if (this.water) { this.water.position.x = p.pos.x; this.water.position.z = p.pos.z; }
    if (this.sun) {
      this.sun.position.set(p.pos.x + 14, p.pos.y + 22, p.pos.z + 10);
      this.sun.target.position.set(p.pos.x, p.pos.y, p.pos.z);
      this.sun.target.updateMatrixWorld();
    }

    this.camera.position.copy(p.pos);
    if (this.shakeTime > 0) {
      this.shakeTime -= dt;
      const s = this.shakeMag * Math.max(0, this.shakeTime / (this.shakeDur || 0.25));
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
      if (this.shakeTime <= 0) { this.shakeTime = 0; this.shakeMag = 0; }
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
        const dist = p.pos.distanceTo(s.pos);
        // Stars drift toward you once you are close. Walking onto an exact
        // spot is fiddly on a touch joystick, and the little swoop makes
        // collecting read as a reward rather than a near miss.
        if (dist < STAR_MAGNET_RADIUS && dist > 0.001) {
          const pull = Math.min(1, (1 - dist / STAR_MAGNET_RADIUS) * dt * 7);
          s.pos.x += (p.pos.x - s.pos.x) * pull;
          s.pos.z += (p.pos.z - s.pos.z) * pull;
          s.pos.y = this.heightAt(s.pos.x, s.pos.z);
          s.group.position.x = s.pos.x;
          s.group.position.z = s.pos.z;
        }
        s.group.position.y = s.pos.y + 1.0 + Math.sin(s.phase) * 0.2;
        s.group.rotation.y = s.phase * 1.4;
        if (dist < 2.1) this.onStarCollected(s);
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

    if (this.quest && this.quest.targetPos && !this.quest.claimed) {
      if (this.treasureGroup) this.treasureGroup.rotation.y += dt * 0.6;
      const c = this.computeCompass(this.quest.targetPos);
      if (window.G.ui.updateCompass) window.G.ui.updateCompass(c.angleDeg, c.dist);
      if (c.dist < 2.5) this.claimTreasure();
    }

    this.updateHandAnim(now);

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
          this.spawnTrailParticle(pr.pos, c, pr.visual.tex ? this.powerTex[pr.visual.tex] : null);
        }
      }

      let hit = false;
      const hitR = (pr.visual.hitRadius || 2.0) * pr.hitRadiusMul;
      this.monsters.forEach(m => {
        if (m.alive && !m.status && m.pos.distanceTo(pr.pos) < hitR && (pr.mega || !hit)) { this.hitMonster(m, pr); hit = true; }
      });
      if (hit && pr.mega) this.addShake(0.3, 0.22);
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
      if (pa.life <= 0) { this.releaseSprite(pa.obj); this.particles.splice(i, 1); }
    }
  },

  render() {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
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
