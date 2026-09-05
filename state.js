(() => {
  'use strict';
  window.G = window.G || {};

  const STORAGE_KEY = 'ueberheld-save-v2';

  const SKINS = [
    { id: 0, color: '#f6c294', emoji: '🦸‍♂️' },
    { id: 1, color: '#c98a5e', emoji: '🦸‍♀️' },
    { id: 2, color: '#8d5a3b', emoji: '🦸‍♂️' },
    { id: 3, color: '#e8b4d8', emoji: '🦸‍♀️' },
    { id: 4, color: '#9ad1f2', emoji: '🦸' },
  ];

  const POWERS = [
    { id: 'feuer', name: 'Feuerkraft', emoji: '🔥', color: '#ff6b35', color2: '#ffb347', desc: 'Lodernde Feuerbälle setzen Gegner in Brand – besonders wirkungsvoll gegen Frostlinge!', unlockRank: 0 },
    { id: 'eis', name: 'Eiskraft', emoji: '❄️', color: '#4fc3f7', color2: '#b3e5fc', desc: 'Gleißende Eiskristalle frieren Gegner ein – besonders wirkungsvoll gegen Flammlinge!', unlockRank: 0 },
    { id: 'blitz', name: 'Blitzkraft', emoji: '⚡', color: '#fdd835', color2: '#ab47bc', desc: 'Ein greller Blitzpfeil lässt Gegner zucken – schneller als jeder andere Zauber!', unlockRank: 1 },
    { id: 'kraft', name: 'Superkraft', emoji: '💪', color: '#8d6e63', color2: '#ffd54f', desc: 'Ein wuchtiger Kraftbrocken zerquetscht Gegner – besonders wirkungsvoll gegen Steinlinge!', unlockRank: 1 },
    { id: 'schild', name: 'Regenbogenschild', emoji: '🌈', color: '#ec407a', color2: '#7e57c2', desc: 'Ein wirbelnder Ring aus buntem Licht macht Gegner ganz schwindelig!', unlockRank: 2 },
    { id: 'flug', name: 'Flugkraft', emoji: '🦋', color: '#81d4fa', color2: '#ffffff', desc: 'Ein Wirbelwind aus Federn wirbelt Gegner in die Luft – besonders wirkungsvoll gegen Schattenschwingen!', unlockRank: 3 },
  ];

  const MAX_LEVEL = 5;
  const UPGRADE_COST = { 1: 15, 2: 30, 3: 50, 4: 75 };

  const RANKS = [
    { name: 'Anfänger', min: 0, emoji: '🌱' },
    { name: 'Kraftpaket', min: 3, emoji: '💥' },
    { name: 'Held', min: 8, emoji: '🛡️' },
    { name: 'Superheld', min: 14, emoji: '⭐' },
    { name: 'Meisterheld', min: 20, emoji: '👑' },
    { name: 'ÜBERHELD', min: 26, emoji: '🌟' },
  ];

  const ACHIEVEMENTS = [
    { id: 'first_kill', emoji: '🎯', name: 'Erster Sieg', desc: 'Ersten Wicht besiegt', check: s => s.kills >= 1 },
    { id: 'ten_kills', emoji: '🗡️', name: 'Wichtjäger', desc: '25 Wichte besiegt', check: s => s.kills >= 25 },
    { id: 'hundred_kills', emoji: '⚔️', name: 'Heldenlegende', desc: '100 Wichte besiegt', check: s => s.kills >= 100 },
    { id: 'first_power', emoji: '✨', name: 'Erwachte Kraft', desc: 'Erste Superkraft erhalten', check: s => Object.values(s.powerLevels).some(l => l >= 1) },
    { id: 'all_unlocked', emoji: '🌈', name: 'Kraftvoll', desc: 'Alle Kräfte freigeschaltet', check: s => POWERS.every(p => (s.powerLevels[p.id] || 0) >= 1) },
    { id: 'one_maxed', emoji: '🔥', name: 'Meister einer Kraft', desc: 'Eine Kraft auf Stufe 5', check: s => Object.values(s.powerLevels).some(l => l >= MAX_LEVEL) },
    { id: 'all_maxed', emoji: '💎', name: 'Vollkommen', desc: 'Alle Kräfte auf Stufe 5', check: s => POWERS.every(p => (s.powerLevels[p.id] || 0) >= MAX_LEVEL) },
    { id: 'ueberheld', emoji: '👑', name: 'ÜBERHELD', desc: 'Den höchsten Rang erreicht', check: s => totalPoints(s) >= RANKS[RANKS.length - 1].min },
    { id: 'rich', emoji: '💰', name: 'Sternensammler', desc: '150 Sterne gesammelt', check: s => s.starsEarnedTotal >= 150 },
    { id: 'treasure_1', emoji: '🏆', name: 'Schatzsucher', desc: 'Den ersten bewachten Schatz gehoben', check: s => (s.treasuresFound || 0) >= 1 },
    { id: 'treasure_5', emoji: '👑', name: 'Schatzmeister', desc: '5 bewachte Schätze gehoben', check: s => (s.treasuresFound || 0) >= 5 },
  ];

  function defaultState() {
    const powerLevels = {};
    POWERS.forEach(p => { powerLevels[p.id] = 0; });
    powerLevels.feuer = 1;
    return {
      created: false,
      heroName: '',
      skin: 0,
      stars: 20,
      starsEarnedTotal: 20,
      kills: 0,
      powerLevels,
      activePower: 'feuer',
      achievements: [],
      soundOn: true,
      questSeed: Math.floor(Math.random() * 1e9),
      questLevel: 1,
      treasuresFound: 0,
    };
  }

  let state = load();

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      const base = defaultState();
      return Object.assign(base, parsed, { powerLevels: Object.assign(base.powerLevels, parsed.powerLevels || {}) });
    } catch (e) {
      return defaultState();
    }
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* storage unavailable */ }
  }

  function totalPoints(s) {
    return Object.values(s.powerLevels).reduce((a, b) => a + b, 0);
  }

  function currentRankIndex(s) {
    const pts = totalPoints(s);
    let idx = 0;
    RANKS.forEach((r, i) => { if (pts >= r.min) idx = i; });
    return idx;
  }

  function checkAchievements() {
    const newlyUnlocked = [];
    ACHIEVEMENTS.forEach(a => {
      if (!state.achievements.includes(a.id) && a.check(state)) {
        state.achievements.push(a.id);
        newlyUnlocked.push(a);
      }
    });
    if (newlyUnlocked.length) save();
    return newlyUnlocked;
  }

  function unlockedPowers() {
    const rankIdx = currentRankIndex(state);
    return POWERS.filter(p => rankIdx >= p.unlockRank);
  }

  function learnedPowers() {
    return POWERS.filter(p => (state.powerLevels[p.id] || 0) > 0);
  }

  // ---- sound ----
  let audioCtx = null;
  function tone(freq, dur, type, vol, delay) {
    if (!state.soundOn) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const t0 = audioCtx.currentTime + (delay || 0);
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(vol || 0.15, t0);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t0);
      osc.stop(t0 + dur);
    } catch (e) { /* audio not available */ }
  }
  const sfx = {
    tap: () => tone(660, 0.1, 'triangle', 0.1),
    hit: () => tone(880, 0.08, 'square', 0.08),
    cast: () => tone(440, 0.1, 'sawtooth', 0.08),
    pickup: () => tone(1046, 0.12, 'triangle', 0.12),
    success: () => { tone(523, 0.15, 'triangle'); tone(659, 0.15, 'triangle', 0.15, 0.1); tone(784, 0.25, 'triangle', 0.15, 0.2); },
    levelup: () => { tone(392, 0.15, 'sawtooth', 0.12); tone(523, 0.15, 'sawtooth', 0.12, 0.12); tone(659, 0.15, 'sawtooth', 0.12, 0.24); tone(880, 0.35, 'sawtooth', 0.15, 0.36); },
    miss: () => tone(200, 0.1, 'sine', 0.08),
  };

  window.G.state = {
    STORAGE_KEY, SKINS, POWERS, RANKS, ACHIEVEMENTS, MAX_LEVEL, UPGRADE_COST,
    get: () => state,
    save, totalPoints, currentRankIndex, checkAchievements, unlockedPowers, learnedPowers,
    sfx,
  };
})();
