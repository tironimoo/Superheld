(() => {
  'use strict';

  /* ============================== DATEN ============================== */

  const STORAGE_KEY = 'ueberheld-save-v1';

  const SKINS = [
    { id: 0, color: '#f6c294', emoji: '🦸‍♂️' },
    { id: 1, color: '#c98a5e', emoji: '🦸‍♀️' },
    { id: 2, color: '#8d5a3b', emoji: '🦸‍♂️' },
    { id: 3, color: '#e8b4d8', emoji: '🦸‍♀️' },
    { id: 4, color: '#9ad1f2', emoji: '🦸' },
  ];

  const POWERS = [
    { id: 'feuer', name: 'Feuerkraft', emoji: '🔥', c1: '#ff6b35', c2: '#ffb347', desc: 'Schleudere Feuerbälle!', unlockRank: 0 },
    { id: 'eis', name: 'Eiskraft', emoji: '❄️', c1: '#4fc3f7', c2: '#b3e5fc', desc: 'Friere Gegner ein!', unlockRank: 0 },
    { id: 'blitz', name: 'Blitzkraft', emoji: '⚡', c1: '#fdd835', c2: '#ab47bc', desc: 'Superschnell wie der Blitz!', unlockRank: 1 },
    { id: 'kraft', name: 'Superkraft', emoji: '💪', c1: '#8d6e63', c2: '#ffd54f', desc: 'Stark wie ein Bär!', unlockRank: 1 },
    { id: 'schild', name: 'Regenbogenschild', emoji: '🌈', c1: '#ec407a', c2: '#7e57c2', desc: 'Ein Schild aus buntem Licht!', unlockRank: 2 },
    { id: 'flug', name: 'Flugkraft', emoji: '🦋', c1: '#81d4fa', c2: '#ffffff', desc: 'Fliege hoch in den Himmel!', unlockRank: 3 },
  ];

  const MAX_LEVEL = 5;
  const UPGRADE_COST = { 1: 15, 2: 30, 3: 50, 4: 75 }; // cost to go FROM this level to next

  const RANKS = [
    { name: 'Anfänger', min: 0, emoji: '🌱' },
    { name: 'Kraftpaket', min: 3, emoji: '💥' },
    { name: 'Held', min: 8, emoji: '🛡️' },
    { name: 'Superheld', min: 14, emoji: '⭐' },
    { name: 'Meisterheld', min: 20, emoji: '👑' },
    { name: 'ÜBERHELD', min: 26, emoji: '🌟' },
  ];
  const MAX_POINTS = POWERS.length * MAX_LEVEL; // 30

  const MISSIONS = {
    monster: { title: 'Monster-Tippen', hint: 'Tippe schnell auf die Monster, bevor sie verschwinden!' },
    memory: { title: 'Farben-Zauber', hint: 'Merke dir die Reihenfolge und tippe sie nach!' },
    sterne: { title: 'Sternenregen', hint: 'Sammle so viele Sterne wie du kannst!' },
  };

  const ACHIEVEMENTS = [
    { id: 'first_mission', emoji: '🎯', name: 'Erster Einsatz', desc: 'Erste Mission geschafft', check: s => s.missionsCompleted >= 1 },
    { id: 'ten_missions', emoji: '🗺️', name: 'Vielgereist', desc: '10 Missionen geschafft', check: s => s.missionsCompleted >= 10 },
    { id: 'first_power', emoji: '✨', name: 'Erwachte Kraft', desc: 'Erste Superkraft erhalten', check: s => Object.values(s.powerLevels).some(l => l >= 1) },
    { id: 'all_unlocked', emoji: '🌈', name: 'Kraftvoll', desc: 'Alle Kräfte freigeschaltet', check: s => POWERS.every(p => (s.powerLevels[p.id] || 0) >= 1) },
    { id: 'one_maxed', emoji: '🔥', name: 'Meister einer Kraft', desc: 'Eine Kraft auf Stufe 5', check: s => Object.values(s.powerLevels).some(l => l >= MAX_LEVEL) },
    { id: 'all_maxed', emoji: '💎', name: 'Vollkommen', desc: 'Alle Kräfte auf Stufe 5', check: s => POWERS.every(p => (s.powerLevels[p.id] || 0) >= MAX_LEVEL) },
    { id: 'ueberheld', emoji: '👑', name: 'ÜBERHELD', desc: 'Den höchsten Rang erreicht', check: s => totalPoints(s) >= RANKS[RANKS.length - 1].min },
    { id: 'rich', emoji: '💰', name: 'Sternensammler', desc: '100 Sterne gesammelt', check: s => s.starsEarnedTotal >= 100 },
  ];

  /* ============================== STATE ============================== */

  function defaultState() {
    const powerLevels = {};
    POWERS.forEach(p => { powerLevels[p.id] = 0; });
    return {
      created: false,
      heroName: '',
      skin: 0,
      stars: 20,
      starsEarnedTotal: 20,
      powerLevels,
      achievements: [],
      missionsCompleted: 0,
      soundOn: true,
    };
  }

  let state = loadState();

  function loadState() {
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

  function saveState() {
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

  /* ============================== SOUND ============================== */

  let audioCtx = null;
  function tone(freq, dur, type = 'sine', vol = 0.15, delay = 0) {
    if (!state.soundOn) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const t0 = audioCtx.currentTime + delay;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(vol, t0);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t0);
      osc.stop(t0 + dur);
    } catch (e) { /* audio not available */ }
  }
  const sfx = {
    tap: () => tone(660, 0.12, 'triangle', 0.12),
    success: () => { tone(523, 0.15, 'triangle'); tone(659, 0.15, 'triangle', 0.15, 0.1); tone(784, 0.25, 'triangle', 0.15, 0.2); },
    levelup: () => { tone(392, 0.15, 'sawtooth', 0.12); tone(523, 0.15, 'sawtooth', 0.12, 0.12); tone(659, 0.15, 'sawtooth', 0.12, 0.24); tone(880, 0.35, 'sawtooth', 0.15, 0.36); },
    miss: () => tone(200, 0.1, 'sine', 0.08),
  };

  /* ============================== HELPERS ============================== */

  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  function showScreen(id) {
    $$('.screen').forEach(s => s.classList.add('hidden'));
    $('#' + id).classList.remove('hidden');
  }

  function setTab(tab) {
    $$('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    if (tab === 'hub') showScreen('screen-hub');
    if (tab === 'powers') { renderPowers(); showScreen('screen-powers'); }
    if (tab === 'achievements') { renderAchievements(); showScreen('screen-achievements'); }
  }

  /* ============================== RENDER: CREATE ============================== */

  function renderSkinPicker() {
    const wrap = $('#skin-picker');
    wrap.innerHTML = '';
    SKINS.forEach(skin => {
      const btn = document.createElement('button');
      btn.className = 'skin-option' + (state.skin === skin.id ? ' selected' : '');
      btn.style.setProperty('--swatch', skin.color);
      btn.textContent = skin.emoji;
      btn.addEventListener('click', () => {
        state.skin = skin.id;
        renderSkinPicker();
      });
      wrap.appendChild(btn);
    });
  }

  /* ============================== RENDER: HUB ============================== */

  function heroEmoji() {
    const skin = SKINS.find(s => s.id === state.skin) || SKINS[0];
    return skin.emoji;
  }

  function renderHub() {
    $('#hub-hero-name').textContent = state.heroName || 'Held';
    $('#hero-avatar').textContent = heroEmoji();
    const rankIdx = currentRankIndex(state);
    const rank = RANKS[rankIdx];
    $('#rank-title').textContent = `${rank.emoji} ${rank.name}`;
    const pts = totalPoints(state);
    const nextRank = RANKS[rankIdx + 1];
    let pct = 100;
    if (nextRank) {
      pct = Math.round(((pts - rank.min) / (nextRank.min - rank.min)) * 100);
    }
    $('#rank-bar-fill').style.width = pct + '%';
    $('#stars-count').textContent = state.stars;
    $('#stars-count-2').textContent = state.stars;

    const heroBadge = $('#hero-badge');
    if (rankIdx >= RANKS.length - 1) {
      heroBadge.style.boxShadow = '0 0 30px 8px rgba(255,215,106,0.9)';
    } else {
      heroBadge.style.boxShadow = '';
    }

    $$('.mission-node').forEach(n => n.classList.remove('hidden'));
  }

  /* ============================== RENDER: POWERS ============================== */

  function renderPowers() {
    const grid = $('#powers-grid');
    grid.innerHTML = '';
    const rankIdx = currentRankIndex(state);

    POWERS.forEach(p => {
      const level = state.powerLevels[p.id] || 0;
      const unlocked = rankIdx >= p.unlockRank;
      const card = document.createElement('div');
      card.className = 'power-card' + (!unlocked ? ' locked' : '');

      const emojiWrap = document.createElement('div');
      emojiWrap.className = 'power-emoji-wrap';
      emojiWrap.style.background = `radial-gradient(circle, ${p.c1}55, transparent 70%)`;
      const glow = document.createElement('div');
      glow.className = 'glow';
      const intensity = Math.min(level, MAX_LEVEL) / MAX_LEVEL;
      glow.style.background = `radial-gradient(circle, ${p.c2}, ${p.c1})`;
      glow.style.opacity = 0.25 + intensity * 0.55;
      emojiWrap.appendChild(glow);
      const emojiSpan = document.createElement('span');
      emojiSpan.textContent = p.emoji;
      emojiWrap.appendChild(emojiSpan);
      card.appendChild(emojiWrap);

      const name = document.createElement('div');
      name.className = 'power-name';
      name.textContent = p.name;
      card.appendChild(name);

      const desc = document.createElement('div');
      desc.className = 'power-desc';
      desc.textContent = p.desc;
      card.appendChild(desc);

      if (!unlocked) {
        const lock = document.createElement('div');
        lock.className = 'lock-label';
        lock.textContent = `🔒 Ab Rang "${RANKS[p.unlockRank].name}"`;
        card.appendChild(lock);
      } else {
        const lvl = document.createElement('div');
        lvl.className = 'power-level';
        lvl.textContent = level === 0 ? 'Noch nicht erlernt' : `Stufe ${level} / ${MAX_LEVEL}`;
        card.appendChild(lvl);

        const barTrack = document.createElement('div');
        barTrack.className = 'power-bar-track';
        const barFill = document.createElement('div');
        barFill.className = 'power-bar-fill';
        barFill.style.width = `${(level / MAX_LEVEL) * 100}%`;
        barTrack.appendChild(barFill);
        card.appendChild(barTrack);

        if (level >= MAX_LEVEL) {
          const badge = document.createElement('div');
          badge.className = 'max-badge';
          badge.textContent = '⭐ MAXIMAL';
          card.appendChild(badge);
        } else if (level === 0) {
          const btn = document.createElement('button');
          btn.className = 'btn-upgrade';
          btn.textContent = '✨ Kraft erlernen (kostenlos)';
          btn.addEventListener('click', () => learnPower(p.id));
          card.appendChild(btn);
        } else {
          const cost = UPGRADE_COST[level];
          const btn = document.createElement('button');
          btn.className = 'btn-upgrade';
          btn.textContent = `⬆️ Verbessern (${cost} ⭐)`;
          btn.disabled = state.stars < cost;
          btn.addEventListener('click', () => upgradePower(p.id));
          card.appendChild(btn);
        }
      }

      grid.appendChild(card);
    });
  }

  function learnPower(id) {
    if ((state.powerLevels[id] || 0) > 0) return;
    state.powerLevels[id] = 1;
    sfx.levelup();
    saveState();
    renderPowers();
    renderHub();
    checkProgressPopups();
  }

  function upgradePower(id) {
    const level = state.powerLevels[id] || 0;
    if (level <= 0 || level >= MAX_LEVEL) return;
    const cost = UPGRADE_COST[level];
    if (state.stars < cost) return;
    state.stars -= cost;
    state.powerLevels[id] = level + 1;
    sfx.levelup();
    saveState();
    renderPowers();
    renderHub();
    checkProgressPopups();
  }

  function checkProgressPopups() {
    const newRankIdx = currentRankIndex(state);
    if (newRankIdx > (state._lastRankIdx ?? newRankIdx)) {
      // handled elsewhere via compareRankAndCelebrate
    }
    state._lastRankIdx = newRankIdx;
    checkAchievements();
  }

  /* ============================== RENDER: ACHIEVEMENTS ============================== */

  function renderAchievements() {
    const grid = $('#achievements-grid');
    grid.innerHTML = '';
    ACHIEVEMENTS.forEach(a => {
      const unlocked = state.achievements.includes(a.id);
      const card = document.createElement('div');
      card.className = 'achievement-card' + (unlocked ? '' : ' locked');
      card.innerHTML = `
        <div class="ach-emoji">${unlocked ? a.emoji : '❓'}</div>
        <div class="ach-name">${a.name}</div>
        <div class="ach-desc">${a.desc}</div>
      `;
      grid.appendChild(card);
    });
  }

  function checkAchievements() {
    let newlyUnlocked = [];
    ACHIEVEMENTS.forEach(a => {
      if (!state.achievements.includes(a.id) && a.check(state)) {
        state.achievements.push(a.id);
        newlyUnlocked.push(a);
      }
    });
    if (newlyUnlocked.length) saveState();
    return newlyUnlocked;
  }

  /* ============================== OVERLAY / CONFETTI ============================== */

  function showOverlay(html, onClose) {
    $('#overlay-panel').innerHTML = html;
    $('#overlay').classList.remove('hidden');
    const btn = $('#overlay-panel').querySelector('.overlay-close');
    if (btn) btn.addEventListener('click', () => {
      $('#overlay').classList.add('hidden');
      if (onClose) onClose();
    });
  }

  function launchConfetti(count = 80) {
    const canvas = $('#confetti-canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const colors = ['#ffd76a', '#ff6b35', '#4fc3f7', '#ec407a', '#7e57c2', '#63e6a0'];
    const pieces = Array.from({ length: count }, () => ({
      x: Math.random() * canvas.width,
      y: -20 - Math.random() * canvas.height * 0.3,
      w: 6 + Math.random() * 6,
      h: 8 + Math.random() * 8,
      vy: 2 + Math.random() * 3,
      vx: -1.5 + Math.random() * 3,
      rot: Math.random() * Math.PI,
      vr: -0.2 + Math.random() * 0.4,
      color: colors[Math.floor(Math.random() * colors.length)],
    }));
    let frame = 0;
    function step() {
      frame++;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      pieces.forEach(p => {
        p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      });
      if (frame < 130) requestAnimationFrame(step);
      else ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    step();
  }

  /* ============================== MISSIONS ============================== */

  let missionState = null;

  function startMission(type) {
    missionState = { type, active: true, hits: 0, total: 0 };
    $('#mission-title').textContent = MISSIONS[type].title;
    $('#mission-hint').textContent = MISSIONS[type].hint;
    $('#mission-progress-text').textContent = '';
    $('#mission-arena').innerHTML = '';
    showScreen('screen-mission');

    if (type === 'monster') runMonsterMission();
    if (type === 'memory') runMemoryMission();
    if (type === 'sterne') runSterneMission();
  }

  function quitMission() {
    if (missionState) missionState.active = false;
    $('#mission-arena').innerHTML = '';
    setTab('hub');
  }

  function finishMission(starsEarned, perfect) {
    if (!missionState || !missionState.active) return;
    missionState.active = false;
    starsEarned = Math.max(8, Math.round(starsEarned));

    const prevRankIdx = currentRankIndex(state);

    state.stars += starsEarned;
    state.starsEarnedTotal += starsEarned;
    state.missionsCompleted += 1;
    const newAch = checkAchievements();
    saveState();

    sfx.success();
    launchConfetti(perfect ? 140 : 80);

    const newRankIdx = currentRankIndex(state);
    const rankedUp = newRankIdx > prevRankIdx;

    let html = `
      <div class="overlay-emoji">${perfect ? '🌟' : '🎉'}</div>
      <h2>${perfect ? 'Perfekt gemacht!' : 'Mission geschafft!'}</h2>
      <p>Du hast tolle Fortschritte gemacht.</p>
      <div class="reward-stars">+${starsEarned} ⭐</div>
      <button class="btn btn-primary btn-big overlay-close">Weiter</button>
    `;
    showOverlay(html, () => {
      renderHub();
      if (rankedUp) {
        showRankUp(newRankIdx, () => {
          if (newAch.length) showAchievementPopups(newAch, () => setTab('hub'));
          else setTab('hub');
        });
      } else if (newAch.length) {
        showAchievementPopups(newAch, () => setTab('hub'));
      } else {
        setTab('hub');
      }
    });
  }

  function showRankUp(rankIdx, onDone) {
    const rank = RANKS[rankIdx];
    sfx.levelup();
    launchConfetti(160);
    const html = `
      <div class="overlay-emoji">${rank.emoji}</div>
      <h2>Rang aufgestiegen!</h2>
      <p>Du bist jetzt: <strong style="color:var(--gold)">${rank.name}</strong></p>
      ${rankIdx === RANKS.length - 1 ? '<p>Du bist der mächtigste Held von allen – der ÜBERHELD! 🎊</p>' : '<p>Neue Kräfte könnten jetzt für dich bereitstehen!</p>'}
      <button class="btn btn-primary btn-big overlay-close">Super!</button>
    `;
    showOverlay(html, onDone);
  }

  function showAchievementPopups(list, onDone) {
    let i = 0;
    function next() {
      if (i >= list.length) { onDone(); return; }
      const a = list[i]; i++;
      sfx.levelup();
      const html = `
        <div class="overlay-emoji">${a.emoji}</div>
        <h2>Erfolg freigeschaltet!</h2>
        <p><strong style="color:var(--gold)">${a.name}</strong><br>${a.desc}</p>
        <button class="btn btn-primary btn-big overlay-close">Weiter</button>
      `;
      showOverlay(html, next);
    }
    next();
  }

  /* ---- Mission A: Monster-Tippen ---- */
  function runMonsterMission() {
    const arena = $('#mission-arena');
    const TOTAL = 10;
    missionState.total = TOTAL;
    let spawned = 0;
    let hits = 0;
    updateProgress(hits, TOTAL);

    function spawnOne() {
      if (!missionState.active) return;
      if (spawned >= TOTAL) {
        setTimeout(() => finishMission(10 + hits * 2, hits === TOTAL), 500);
        return;
      }
      spawned++;
      const el = document.createElement('div');
      el.className = 'tap-target';
      const emojis = ['👾', '🐲', '🧟', '🐙', '🦖'];
      el.textContent = emojis[Math.floor(Math.random() * emojis.length)];
      const arenaRect = arena.getBoundingClientRect();
      const maxX = Math.max(10, arenaRect.width - 90);
      const maxY = Math.max(10, arenaRect.height - 90);
      el.style.left = Math.random() * maxX + 'px';
      el.style.top = Math.random() * maxY + 'px';
      let resolved = false;
      const missTimer = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        el.classList.add('miss');
        sfx.miss();
        setTimeout(() => el.remove(), 400);
        spawnOne();
      }, 2400);
      el.addEventListener('pointerdown', () => {
        if (resolved) return;
        resolved = true;
        clearTimeout(missTimer);
        hits++;
        updateProgress(hits, TOTAL);
        sfx.tap();
        el.classList.add('hit');
        setTimeout(() => el.remove(), 250);
        spawnOne();
      });
      arena.appendChild(el);
    }
    spawnOne();
  }

  function updateProgress(a, b) {
    $('#mission-progress-text').textContent = `${a}/${b}`;
  }

  /* ---- Mission B: Farben-Zauber (memory) ---- */
  function runMemoryMission() {
    const arena = $('#mission-arena');
    arena.innerHTML = '';
    const gems = [
      { color: '#ff6b35', emoji: '🔥' },
      { color: '#4fc3f7', emoji: '❄️' },
      { color: '#fdd835', emoji: '⚡' },
      { color: '#7e57c2', emoji: '🔮' },
    ];
    const SEQ_LEN = 4;
    const sequence = Array.from({ length: SEQ_LEN }, () => Math.floor(Math.random() * gems.length));
    missionState.total = SEQ_LEN;
    updateProgress(0, SEQ_LEN);

    const seqDisplay = document.createElement('div');
    seqDisplay.className = 'memory-sequence-display';
    for (let i = 0; i < SEQ_LEN; i++) {
      const dot = document.createElement('div');
      dot.className = 'seq-dot';
      seqDisplay.appendChild(dot);
    }
    arena.appendChild(seqDisplay);

    const row = document.createElement('div');
    row.className = 'memory-gem-row';
    const gemEls = gems.map((g, idx) => {
      const el = document.createElement('div');
      el.className = 'memory-gem';
      el.style.background = g.color;
      el.style.color = g.color;
      el.textContent = g.emoji;
      row.appendChild(el);
      return el;
    });
    arena.appendChild(row);

    let playerIndex = 0;
    let inputLocked = true;

    function playSequence() {
      inputLocked = true;
      playerIndex = 0;
      Array.from(seqDisplay.children).forEach(d => d.classList.remove('done'));
      let i = 0;
      const interval = setInterval(() => {
        if (!missionState.active) { clearInterval(interval); return; }
        if (i > 0) gemEls[sequence[i - 1]].classList.remove('lit');
        if (i >= sequence.length) {
          clearInterval(interval);
          inputLocked = false;
          return;
        }
        gemEls[sequence[i]].classList.add('lit');
        tone(300 + sequence[i] * 120, 0.25, 'triangle', 0.15);
        i++;
      }, 650);
    }

    gemEls.forEach((el, idx) => {
      el.addEventListener('pointerdown', () => {
        if (inputLocked || !missionState.active) return;
        el.classList.add('lit');
        setTimeout(() => el.classList.remove('lit'), 200);
        if (idx === sequence[playerIndex]) {
          sfx.tap();
          seqDisplay.children[playerIndex].classList.add('done');
          playerIndex++;
          updateProgress(playerIndex, SEQ_LEN);
          if (playerIndex >= sequence.length) {
            inputLocked = true;
            setTimeout(() => finishMission(30, true), 500);
          }
        } else {
          sfx.miss();
          setTimeout(() => { if (missionState.active) playSequence(); }, 500);
        }
      });
    });

    setTimeout(playSequence, 700);
  }

  /* ---- Mission C: Sternenregen ---- */
  function runSterneMission() {
    const arena = $('#mission-arena');
    const DURATION = 9000;
    let hits = 0;
    missionState.total = 999;
    updateProgress(0, '');
    const startTime = Date.now();
    let spawnTimer, tickTimer;

    function spawnStar() {
      if (!missionState.active) return;
      const el = document.createElement('div');
      el.className = 'falling-star';
      el.textContent = Math.random() > 0.8 ? '🌟' : '⭐';
      const arenaRect = arena.getBoundingClientRect();
      const maxX = Math.max(10, arenaRect.width - 40);
      el.style.left = Math.random() * maxX + 'px';
      el.style.top = '-40px';
      arena.appendChild(el);
      const fallDuration = 2600 + Math.random() * 1200;
      const startTop = -40;
      const endTop = arenaRect.height;
      const animStart = performance.now();
      let removed = false;
      function animate(now) {
        if (removed) return;
        const t = (now - animStart) / fallDuration;
        if (t >= 1) { el.remove(); return; }
        el.style.top = (startTop + t * (endTop - startTop)) + 'px';
        requestAnimationFrame(animate);
      }
      requestAnimationFrame(animate);
      el.addEventListener('pointerdown', () => {
        if (removed) return;
        removed = true;
        hits++;
        sfx.tap();
        updateProgress(hits, '⭐');
        el.remove();
      });
    }

    spawnTimer = setInterval(spawnStar, 550);

    tickTimer = setInterval(() => {
      if (!missionState.active) { clearInterval(spawnTimer); clearInterval(tickTimer); return; }
      const elapsed = Date.now() - startTime;
      if (elapsed >= DURATION) {
        clearInterval(spawnTimer);
        clearInterval(tickTimer);
        arena.innerHTML = '';
        const stars = 10 + hits * 2;
        finishMission(stars, hits >= 12);
      }
    }, 200);
  }

  /* ============================== EVENTS ============================== */

  function init() {
    renderSkinPicker();

    if (state.created) {
      $('#hero-name').value = state.heroName;
      showScreen('screen-hub');
      renderHub();
    } else {
      showScreen('screen-create');
    }

    $('#btn-start-game').addEventListener('click', () => {
      const name = $('#hero-name').value.trim();
      state.heroName = name || 'Held';
      state.created = true;
      state._lastRankIdx = currentRankIndex(state);
      saveState();
      showScreen('screen-hub');
      renderHub();
      sfx.success();
    });

    $$('.mission-node').forEach(node => {
      node.addEventListener('click', () => startMission(node.dataset.mission));
    });

    $$('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => setTab(btn.dataset.tab));
    });

    $$('.btn-back').forEach(btn => {
      btn.addEventListener('click', () => setTab(btn.dataset.back || 'hub'));
    });

    $('#btn-quit-mission').addEventListener('click', quitMission);

    $('#btn-sound').addEventListener('click', () => {
      state.soundOn = !state.soundOn;
      $('#btn-sound').textContent = state.soundOn ? '🔊' : '🔇';
      saveState();
    });
    $('#btn-sound').textContent = state.soundOn ? '🔊' : '🔇';

    window.addEventListener('resize', () => {
      const canvas = $('#confetti-canvas');
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    });

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
