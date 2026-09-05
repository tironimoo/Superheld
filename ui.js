(() => {
  'use strict';
  const ST = window.G.state;
  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));
  const state = ST.get();

  function showScreen(id) {
    $$('.screen').forEach(s => s.classList.add('hidden'));
    $('#' + id).classList.remove('hidden');
  }

  /* ---------- Hero creation ---------- */
  function renderSkinPicker() {
    const wrap = $('#skin-picker');
    wrap.innerHTML = '';
    ST.SKINS.forEach(skin => {
      const btn = document.createElement('button');
      btn.className = 'skin-option' + (state.skin === skin.id ? ' selected' : '');
      btn.style.setProperty('--swatch', skin.color);
      btn.textContent = skin.emoji;
      btn.addEventListener('click', () => { state.skin = skin.id; renderSkinPicker(); });
      wrap.appendChild(btn);
    });
  }

  function heroEmoji() {
    const skin = ST.SKINS.find(s => s.id === state.skin) || ST.SKINS[0];
    return skin.emoji;
  }

  /* ---------- HUD ---------- */
  function updateHud() {
    $('#hud-hero-name').textContent = state.heroName || 'Held';
    $('#hud-avatar').textContent = heroEmoji();
    const rankIdx = ST.currentRankIndex(state);
    const rank = ST.RANKS[rankIdx];
    $('#hud-rank-title').textContent = `${rank.emoji} ${rank.name}`;
    const pts = ST.totalPoints(state);
    const next = ST.RANKS[rankIdx + 1];
    const pct = next ? Math.round(((pts - rank.min) / (next.min - rank.min)) * 100) : 100;
    $('#hud-rank-bar').style.width = pct + '%';
    $('#hud-stars').textContent = state.stars;
    $('#stars-count-2').textContent = state.stars;
    renderPowerRow();
  }

  function renderPowerRow() {
    const row = $('#power-select-row');
    row.innerHTML = '';
    const learned = ST.learnedPowers();
    learned.forEach(p => {
      const btn = document.createElement('button');
      btn.className = 'power-chip' + (state.activePower === p.id ? ' active' : '');
      btn.textContent = p.emoji;
      btn.style.setProperty('--glow', p.color);
      btn.addEventListener('click', () => {
        state.activePower = p.id;
        ST.save();
        renderPowerRow();
        updateCastButton();
      });
      row.appendChild(btn);
    });
    updateCastButton();
  }

  function updateCastButton() {
    const p = ST.POWERS.find(p => p.id === state.activePower);
    if (p) {
      $('#btn-cast').textContent = p.emoji;
      $('#btn-cast').style.setProperty('--glow', p.color);
    }
  }

  /* ---------- Health hearts ---------- */
  let lastHp = null;
  function updateHealth(hp, maxHp, hit) {
    const row = $('#hud-hearts');
    if (row.children.length !== maxHp) {
      row.innerHTML = '';
      for (let i = 0; i < maxHp; i++) {
        const span = document.createElement('span');
        span.textContent = '❤️';
        row.appendChild(span);
      }
    }
    Array.from(row.children).forEach((el, i) => {
      el.classList.toggle('heart-lost', i >= hp);
      el.textContent = i >= hp ? '🖤' : '❤️';
    });
    if (hit) {
      const flash = $('#damage-flash');
      flash.classList.add('active');
      setTimeout(() => flash.classList.remove('active'), 220);
      if (lastHp !== null && hp < lastHp && row.children[hp]) {
        row.children[hp].classList.add('heart-hit');
        setTimeout(() => row.children[hp] && row.children[hp].classList.remove('heart-hit'), 400);
      }
    }
    lastHp = hp;
  }

  /* ---------- Toasts (lightweight, non-blocking) ---------- */
  function toast(text) {
    const el = document.createElement('div');
    el.className = 'reward-toast';
    el.textContent = text;
    el.style.left = (44 + Math.random() * 12) + '%';
    $('#toast-layer').appendChild(el);
    setTimeout(() => el.remove(), 1300);
  }

  /* ---------- Overlay / confetti (rank up, achievements) ---------- */
  function showOverlay(html, onClose) {
    $('#overlay-panel').innerHTML = html;
    $('#overlay').classList.remove('hidden');
    const btn = $('#overlay-panel').querySelector('.overlay-close');
    if (btn) btn.addEventListener('click', () => {
      $('#overlay').classList.add('hidden');
      if (onClose) onClose();
    });
  }

  function launchConfetti(count) {
    const canvas = $('#confetti-canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const colors = ['#ffd76a', '#ff6b35', '#4fc3f7', '#ec407a', '#7e57c2', '#63e6a0'];
    const pieces = Array.from({ length: count || 100 }, () => ({
      x: Math.random() * canvas.width, y: -20 - Math.random() * canvas.height * 0.3,
      w: 6 + Math.random() * 6, h: 8 + Math.random() * 8,
      vy: 2 + Math.random() * 3, vx: -1.5 + Math.random() * 3,
      rot: Math.random() * Math.PI, vr: -0.2 + Math.random() * 0.4,
      color: colors[Math.floor(Math.random() * colors.length)],
    }));
    let frame = 0;
    function step() {
      frame++;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      pieces.forEach(p => {
        p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.color; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      });
      if (frame < 130) requestAnimationFrame(step); else ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    step();
  }

  function showRankUp(rankIdx, onDone) {
    const rank = ST.RANKS[rankIdx];
    ST.sfx.levelup();
    launchConfetti(160);
    const html = `
      <div class="overlay-emoji">${rank.emoji}</div>
      <h2>Rang aufgestiegen!</h2>
      <p>Du bist jetzt: <strong style="color:var(--gold)">${rank.name}</strong></p>
      ${rankIdx === ST.RANKS.length - 1 ? '<p>Du bist der mächtigste Held von allen – der ÜBERHELD! 🎊</p>' : '<p>Neue Kräfte könnten jetzt für dich bereitstehen!</p>'}
      <button class="btn btn-primary btn-big overlay-close">Super!</button>
    `;
    showOverlay(html, onDone);
  }

  function queueAchievements(list, onDone) {
    let i = 0;
    function next() {
      if (i >= list.length) { if (onDone) onDone(); return; }
      const a = list[i]; i++;
      ST.sfx.levelup();
      launchConfetti(90);
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

  /* ---------- Pause menu ---------- */
  function openPauseMenu() {
    window.G.world.pause();
    $('#screen-pause').classList.remove('hidden');
  }
  function closePauseMenu() {
    $('#screen-pause').classList.add('hidden');
    window.G.world.resume();
  }

  /* ---------- Powers screen ---------- */
  function renderPowers() {
    const grid = $('#powers-grid');
    grid.innerHTML = '';
    const rankIdx = ST.currentRankIndex(state);
    ST.POWERS.forEach(p => {
      const level = state.powerLevels[p.id] || 0;
      const unlocked = rankIdx >= p.unlockRank;
      const card = document.createElement('div');
      card.className = 'power-card' + (!unlocked ? ' locked' : '');

      const emojiWrap = document.createElement('div');
      emojiWrap.className = 'power-emoji-wrap';
      emojiWrap.style.background = `radial-gradient(circle, ${p.color}55, transparent 70%)`;
      const glow = document.createElement('div');
      glow.className = 'glow';
      const intensity = Math.min(level, ST.MAX_LEVEL) / ST.MAX_LEVEL;
      glow.style.background = `radial-gradient(circle, ${p.color2}, ${p.color})`;
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
        lock.textContent = `🔒 Ab Rang "${ST.RANKS[p.unlockRank].name}"`;
        card.appendChild(lock);
      } else {
        const lvl = document.createElement('div');
        lvl.className = 'power-level';
        lvl.textContent = level === 0 ? 'Noch nicht erlernt' : `Stufe ${level} / ${ST.MAX_LEVEL}`;
        card.appendChild(lvl);

        const barTrack = document.createElement('div');
        barTrack.className = 'power-bar-track';
        const barFill = document.createElement('div');
        barFill.className = 'power-bar-fill';
        barFill.style.width = `${(level / ST.MAX_LEVEL) * 100}%`;
        barTrack.appendChild(barFill);
        card.appendChild(barTrack);

        if (level >= ST.MAX_LEVEL) {
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
          const cost = ST.UPGRADE_COST[level];
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

  function afterPowerChange() {
    const prevRankIdx = state._lastRankIdx ?? ST.currentRankIndex(state);
    const newRankIdx = ST.currentRankIndex(state);
    ST.save();
    renderPowers();
    updateHud();
    const newAch = ST.checkAchievements();
    if (newRankIdx > prevRankIdx) {
      state._lastRankIdx = newRankIdx;
      showRankUp(newRankIdx, () => { if (newAch.length) queueAchievements(newAch); });
    } else {
      state._lastRankIdx = newRankIdx;
      if (newAch.length) queueAchievements(newAch);
    }
  }

  function learnPower(id) {
    if ((state.powerLevels[id] || 0) > 0) return;
    state.powerLevels[id] = 1;
    ST.sfx.levelup();
    afterPowerChange();
  }
  function upgradePower(id) {
    const level = state.powerLevels[id] || 0;
    if (level <= 0 || level >= ST.MAX_LEVEL) return;
    const cost = ST.UPGRADE_COST[level];
    if (state.stars < cost) return;
    state.stars -= cost;
    state.powerLevels[id] = level + 1;
    ST.sfx.levelup();
    afterPowerChange();
  }

  /* ---------- Achievements screen ---------- */
  function renderAchievements() {
    const grid = $('#achievements-grid');
    grid.innerHTML = '';
    ST.ACHIEVEMENTS.forEach(a => {
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

  /* ---------- Bootstrap ---------- */
  function enterWorld() {
    showScreen('screen-world');
    if (!window.G.world.canvas) {
      const ok = window.G.world.init(document.getElementById('game-canvas'));
      if (!ok) {
        showOverlay(`<div class="overlay-emoji">😕</div><h2>WebGL fehlt</h2><p>Dein Browser unterstützt leider kein WebGL, das für die 3D-Welt gebraucht wird.</p><button class="btn btn-primary btn-big overlay-close">OK</button>`);
        return;
      }
    }
    updateHud();
    window.G.world.start();
    window.G.world.resume();
  }

  function init() {
    renderSkinPicker();
    state._lastRankIdx = ST.currentRankIndex(state);

    if (state.created) {
      enterWorld();
    } else {
      showScreen('screen-create');
    }

    $('#btn-start-game').addEventListener('click', () => {
      const name = $('#hero-name').value.trim();
      state.heroName = name || 'Held';
      state.created = true;
      ST.save();
      ST.sfx.success();
      enterWorld();
    });

    $('#btn-pause').addEventListener('click', openPauseMenu);
    $('#btn-resume').addEventListener('click', closePauseMenu);
    $('#btn-pause-powers').addEventListener('click', () => {
      $('#screen-pause').classList.add('hidden');
      renderPowers();
      showScreen('screen-powers');
    });
    $('#btn-pause-achievements').addEventListener('click', () => {
      $('#screen-pause').classList.add('hidden');
      renderAchievements();
      showScreen('screen-achievements');
    });
    $$('.btn-back').forEach(btn => btn.addEventListener('click', () => { showScreen('screen-world'); openPauseMenu(); }));

    $('#btn-sound').addEventListener('click', () => {
      state.soundOn = !state.soundOn;
      $('#btn-sound').textContent = state.soundOn ? '🔊 Ton an' : '🔇 Ton aus';
      ST.save();
    });
    $('#btn-sound').textContent = state.soundOn ? '🔊 Ton an' : '🔇 Ton aus';

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  window.G.ui = { toast, queueAchievements, updateHud, updateHealth };
  document.addEventListener('DOMContentLoaded', init);
})();
