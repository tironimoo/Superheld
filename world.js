(() => {
  'use strict';
  window.G = window.G || {};
  const { M4, V3 } = window.G;
  const geo = window.G.geo;
  const ST = window.G.state;

  const VERT_SRC = `
    attribute vec3 aPosition;
    attribute vec3 aNormal;
    attribute vec3 aColor;
    uniform mat4 uModel;
    uniform mat4 uViewProj;
    uniform vec3 uCameraPos;
    uniform float uFogNear;
    uniform float uFogFar;
    varying vec3 vColor;
    varying vec3 vNormal;
    varying float vFog;
    void main() {
      vec4 worldPos = uModel * vec4(aPosition, 1.0);
      gl_Position = uViewProj * worldPos;
      vNormal = mat3(uModel) * aNormal;
      vColor = aColor;
      float dist = distance(worldPos.xyz, uCameraPos);
      vFog = clamp((dist - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
    }
  `;
  const FRAG_SRC = `
    precision mediump float;
    varying vec3 vColor;
    varying vec3 vNormal;
    varying float vFog;
    uniform vec3 uLightDir;
    uniform vec3 uFogColor;
    uniform float uEmissive;
    void main() {
      vec3 n = normalize(vNormal);
      float diff = max(dot(n, uLightDir), 0.0);
      vec3 lit = vColor * (0.5 + 0.55 * diff);
      vec3 finalColor = mix(lit, vColor * 1.25, uEmissive);
      finalColor = mix(finalColor, uFogColor, vFog);
      gl_FragColor = vec4(finalColor, 1.0);
    }
  `;
  const SKY_VERT = `
    attribute vec2 aPosition;
    attribute vec3 aColor;
    varying vec3 vColor;
    void main() { vColor = aColor; gl_Position = vec4(aPosition, 0.9999, 1.0); }
  `;
  const SKY_FRAG = `
    precision mediump float;
    varying vec3 vColor;
    void main() { gl_FragColor = vec4(vColor, 1.0); }
  `;

  function compileShader(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.error('Shader error:', gl.getShaderInfoLog(sh));
    }
    return sh;
  }
  function linkProgram(gl, vsSrc, fsSrc) {
    const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('Program link error:', gl.getProgramInfoLog(prog));
    }
    return prog;
  }

  class Mesh {
    constructor(gl, data) {
      this.gl = gl;
      this.count = data.indices ? data.indices.length : data.positions.length / 3;
      this.hasIndex = !!data.indices;
      this.posBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
      gl.bufferData(gl.ARRAY_BUFFER, data.positions, gl.STATIC_DRAW);
      this.normBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.normBuf);
      gl.bufferData(gl.ARRAY_BUFFER, data.normals, gl.STATIC_DRAW);
      this.colBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.colBuf);
      gl.bufferData(gl.ARRAY_BUFFER, data.colors, gl.STATIC_DRAW);
      if (this.hasIndex) {
        this.idxBuf = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idxBuf);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data.indices, gl.STATIC_DRAW);
      }
    }
    draw(gl, attribs) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
      gl.vertexAttribPointer(attribs.aPosition, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.normBuf);
      gl.vertexAttribPointer(attribs.aNormal, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.colBuf);
      gl.vertexAttribPointer(attribs.aColor, 3, gl.FLOAT, false, 0, 0);
      if (this.hasIndex) {
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idxBuf);
        gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_SHORT, 0);
      } else {
        gl.drawArrays(gl.TRIANGLES, 0, this.count);
      }
    }
  }

  const SKY_TOP = '#2a1458';
  const SKY_BOTTOM = '#ff9d5c';
  const FOG_COLOR = geo.hexToRgb('#5b3a8f');

  const World = {
    canvas: null, gl: null, prog: null, skyProg: null,
    attribs: {}, uniforms: {}, skyAttribs: {}, skyUniforms: {},
    meshes: {}, decor: [], monsters: [], stars: [], projectiles: [], particles: [],
    player: { pos: [0, 1.6, 8], yaw: Math.PI, pitch: 0 },
    running: false, paused: false, lastT: 0,
    move: { x: 0, z: 0 },
    look: { active: false, pointerId: null, lastX: 0, lastY: 0 },
    joy: { active: false, pointerId: null, cx: 0, cy: 0 },
    castCooldown: 0,
    worldRadius: 40,
    bobPhase: 0,

    init(canvas) {
      this.canvas = canvas;
      const gl = canvas.getContext('webgl', { antialias: true, alpha: false }) || canvas.getContext('experimental-webgl');
      if (!gl) { console.error('WebGL not supported'); return false; }
      this.gl = gl;
      gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      gl.clearColor(0.16, 0.08, 0.34, 1);

      this.prog = linkProgram(gl, VERT_SRC, FRAG_SRC);
      this.attribs = {
        aPosition: gl.getAttribLocation(this.prog, 'aPosition'),
        aNormal: gl.getAttribLocation(this.prog, 'aNormal'),
        aColor: gl.getAttribLocation(this.prog, 'aColor'),
      };
      this.uniforms = {
        uModel: gl.getUniformLocation(this.prog, 'uModel'),
        uViewProj: gl.getUniformLocation(this.prog, 'uViewProj'),
        uCameraPos: gl.getUniformLocation(this.prog, 'uCameraPos'),
        uFogNear: gl.getUniformLocation(this.prog, 'uFogNear'),
        uFogFar: gl.getUniformLocation(this.prog, 'uFogFar'),
        uLightDir: gl.getUniformLocation(this.prog, 'uLightDir'),
        uFogColor: gl.getUniformLocation(this.prog, 'uFogColor'),
        uEmissive: gl.getUniformLocation(this.prog, 'uEmissive'),
      };

      this.skyProg = linkProgram(gl, SKY_VERT, SKY_FRAG);
      this.skyAttribs = {
        aPosition: gl.getAttribLocation(this.skyProg, 'aPosition'),
        aColor: gl.getAttribLocation(this.skyProg, 'aColor'),
      };
      const skyData = geo.skyQuad(SKY_TOP, SKY_BOTTOM);
      this.skyPosBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.skyPosBuf);
      gl.bufferData(gl.ARRAY_BUFFER, skyData.positions, gl.STATIC_DRAW);
      this.skyColBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.skyColBuf);
      gl.bufferData(gl.ARRAY_BUFFER, skyData.colors, gl.STATIC_DRAW);

      this.buildMeshes();
      this.buildDecor();
      for (let i = 0; i < 5; i++) this.spawnMonster(0);
      for (let i = 0; i < 6; i++) this.spawnStar(0);
      this.setupInput();
      this.resize();
      return true;
    },

    buildMeshes() {
      const gl = this.gl;
      this.meshes.ground = new Mesh(gl, geo.groundDisc(this.worldRadius, 40, 5, '#3a2470', '#150a2e'));
      this.meshes.monster = {
        green: new Mesh(gl, geo.icosahedron(1, '#57d68d', true)),
        blue: new Mesh(gl, geo.icosahedron(1, '#4fc3f7', true)),
        purple: new Mesh(gl, geo.icosahedron(1, '#b085f5', true)),
        orange: new Mesh(gl, geo.icosahedron(1, '#ffab5e', true)),
      };
      this.meshes.eyeWhite = new Mesh(gl, geo.icosahedron(0.22, '#ffffff', false));
      this.meshes.eyeBlack = new Mesh(gl, geo.icosahedron(0.11, '#1a0b3d', false));
      this.meshes.star = new Mesh(gl, geo.icosahedron(0.5, '#ffd76a', true));
      this.meshes.crystal = new Mesh(gl, geo.cone(0.6, 1.8, 6, '#9d7bff', true));
      this.meshes.crystalBase = new Mesh(gl, geo.box(0.7, 0.4, 0.7, '#5b3a8f', true));
      this.meshes.treeTop = new Mesh(gl, geo.cone(1.3, 2.4, 8, '#3aa66b', true));
      this.meshes.treeTrunk = new Mesh(gl, geo.cylinder(0.25, 1.4, 6, '#6b4a2f', true));
      this.meshes.rock = new Mesh(gl, geo.box(1, 0.8, 1, '#5c5470', true));
      this.meshes.projectile = {};
      this.meshes.particle = {};
      ST.POWERS.forEach(p => {
        this.meshes.projectile[p.id] = new Mesh(gl, geo.icosahedron(0.35, p.color, false));
        this.meshes.particle[p.id] = new Mesh(gl, geo.icosahedron(0.16, p.color, false));
      });
    },

    buildDecor() {
      const rand = mulberry32(1337);
      for (let i = 0; i < 16; i++) {
        const a = rand() * Math.PI * 2;
        const d = 14 + rand() * (this.worldRadius - 18);
        const pos = [Math.cos(a) * d, 0, Math.sin(a) * d];
        const kind = rand() > 0.5 ? 'crystal' : 'tree';
        this.decor.push({ kind, pos, rotY: rand() * Math.PI * 2, scale: 0.8 + rand() * 0.7 });
      }
      for (let i = 0; i < 8; i++) {
        const a = rand() * Math.PI * 2;
        const d = 10 + rand() * (this.worldRadius - 14);
        this.decor.push({ kind: 'rock', pos: [Math.cos(a) * d, 0.3, Math.sin(a) * d], rotY: rand() * Math.PI * 2, scale: 0.6 + rand() * 0.8 });
      }
    },

    randomRingPos(minR, maxR) {
      const a = Math.random() * Math.PI * 2;
      const d = minR + Math.random() * (maxR - minR);
      return [Math.cos(a) * d, 0, Math.sin(a) * d];
    },

    spawnMonster(delay) {
      const colors = ['green', 'blue', 'purple', 'orange'];
      const m = {
        pos: this.randomRingPos(7, this.worldRadius - 6),
        colorKey: colors[Math.floor(Math.random() * colors.length)],
        phase: Math.random() * Math.PI * 2,
        alive: false,
        spawnAt: performance.now() + (delay || 0) * 1000,
      };
      this.monsters.push(m);
    },

    spawnStar(delay) {
      const s = {
        pos: this.randomRingPos(5, this.worldRadius - 6),
        phase: Math.random() * Math.PI * 2,
        alive: false,
        spawnAt: performance.now() + (delay || 0) * 1000,
      };
      this.stars.push(s);
    },

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
      const gl = this.gl;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.floor(this.canvas.clientWidth * dpr);
      const h = Math.floor(this.canvas.clientHeight * dpr);
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w;
        this.canvas.height = h;
      }
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    },

    fireProjectile() {
      if (this.castCooldown > performance.now()) return;
      this.castCooldown = performance.now() + 380;
      const state = ST.get();
      const powerId = state.activePower;
      if (!(state.powerLevels[powerId] > 0)) return;
      ST.sfx.cast();
      const yaw = this.player.yaw, pitch = this.player.pitch;
      const dir = [
        -Math.sin(yaw) * Math.cos(pitch),
        Math.sin(pitch),
        -Math.cos(yaw) * Math.cos(pitch),
      ];
      // soft auto-aim: lock onto nearest living monster within a forward cone
      let target = null, bestDot = 0.82;
      this.monsters.forEach(m => {
        if (!m.alive) return;
        const toM = V3.normalize(V3.sub(m.pos, this.player.pos));
        const d = V3.dot(dir, toM);
        if (d > bestDot) { bestDot = d; target = m; }
      });
      this.projectiles.push({
        pos: [...this.player.pos],
        dir,
        powerId,
        life: 2.2,
        target,
      });
    },

    onMonsterKilled(m) {
      const state = ST.get();
      state.kills += 1;
      const reward = 3 + Math.floor(Math.random() * 2);
      state.stars += reward;
      state.starsEarnedTotal += reward;
      ST.save();
      ST.sfx.hit();
      window.G.ui.toast(`+${reward} ⭐`, m.pos, this);
      window.G.ui.updateHud();
      this.spawnKillBurst(m.pos, m.colorKey);
      const newAch = ST.checkAchievements();
      if (newAch.length) window.G.ui.queueAchievements(newAch);
      m.alive = false;
      m.spawnAt = performance.now() + 2500 + Math.random() * 2000;
      m.pos = this.randomRingPos(7, this.worldRadius - 6);
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
      s.spawnAt = performance.now() + 4000 + Math.random() * 4000;
      s.pos = this.randomRingPos(5, this.worldRadius - 6);
    },

    spawnKillBurst(pos, colorKey) {
      for (let i = 0; i < 8; i++) {
        const a = Math.random() * Math.PI * 2;
        const el = Math.random() * Math.PI - Math.PI / 2;
        const speed = 2 + Math.random() * 2;
        this.particles.push({
          pos: [...pos],
          vel: [Math.cos(a) * Math.cos(el) * speed, Math.sin(el) * speed + 1.5, Math.sin(a) * Math.cos(el) * speed],
          life: 0.7,
          maxLife: 0.7,
          colorKey,
        });
      }
    },

    update(dt) {
      if (this.paused) return;
      const p = this.player;
      const speed = 6.2;
      if (Math.abs(this.move.x) > 0.05 || Math.abs(this.move.z) > 0.05) {
        const forward = [-Math.sin(p.yaw), 0, -Math.cos(p.yaw)];
        const right = [Math.cos(p.yaw), 0, -Math.sin(p.yaw)];
        const mx = this.move.x, mz = this.move.z;
        const moveVec = [
          right[0] * mx - forward[0] * mz,
          0,
          right[2] * mx - forward[2] * mz,
        ];
        const len = Math.hypot(moveVec[0], moveVec[2]) || 1;
        p.pos[0] += (moveVec[0] / len) * speed * dt;
        p.pos[2] += (moveVec[2] / len) * speed * dt;
        this.bobPhase += dt * 9;
      }
      const distFromCenter = Math.hypot(p.pos[0], p.pos[2]);
      if (distFromCenter > this.worldRadius - 1.5) {
        const s = (this.worldRadius - 1.5) / distFromCenter;
        p.pos[0] *= s; p.pos[2] *= s;
      }
      p.pos[1] = 1.6 + Math.sin(this.bobPhase) * 0.04;

      const now = performance.now();
      this.monsters.forEach(m => {
        if (!m.alive && now >= m.spawnAt) m.alive = true;
        if (m.alive) m.phase += dt * 2;
      });
      this.stars.forEach(s => {
        if (!s.alive && now >= s.spawnAt) s.alive = true;
        if (s.alive) {
          s.phase += dt * 2.4;
          if (V3.distance(s.pos, p.pos) < 2.1) this.onStarCollected(s);
        }
      });

      for (let i = this.projectiles.length - 1; i >= 0; i--) {
        const pr = this.projectiles[i];
        if (pr.target && pr.target.alive) {
          const toT = V3.normalize(V3.sub(pr.target.pos, pr.pos));
          pr.dir = V3.normalize(V3.lerp(pr.dir, toT, 0.14));
        }
        pr.pos = V3.add(pr.pos, V3.scale(pr.dir, 24 * dt));
        pr.life -= dt;
        let hit = false;
        this.monsters.forEach(m => {
          if (m.alive && V3.distance(m.pos, pr.pos) < 2.0) { this.onMonsterKilled(m); hit = true; }
        });
        if (hit || pr.life <= 0) this.projectiles.splice(i, 1);
      }

      for (let i = this.particles.length - 1; i >= 0; i--) {
        const pa = this.particles[i];
        pa.pos = V3.add(pa.pos, V3.scale(pa.vel, dt));
        pa.vel[1] -= 6 * dt;
        pa.life -= dt;
        if (pa.life <= 0) this.particles.splice(i, 1);
      }
    },

    drawMesh(mesh, model, emissive) {
      const gl = this.gl;
      gl.uniformMatrix4fv(this.uniforms.uModel, false, model);
      gl.uniform1f(this.uniforms.uEmissive, emissive || 0);
      mesh.draw(gl, this.attribs);
    },

    render() {
      const gl = this.gl;
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(this.skyProg);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.skyPosBuf);
      gl.enableVertexAttribArray(this.skyAttribs.aPosition);
      gl.vertexAttribPointer(this.skyAttribs.aPosition, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.skyColBuf);
      gl.enableVertexAttribArray(this.skyAttribs.aColor);
      gl.vertexAttribPointer(this.skyAttribs.aColor, 3, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.enable(gl.DEPTH_TEST);

      const gl2 = gl;
      gl2.clear(gl2.DEPTH_BUFFER_BIT);
      gl2.useProgram(this.prog);
      gl2.enableVertexAttribArray(this.attribs.aPosition);
      gl2.enableVertexAttribArray(this.attribs.aNormal);
      gl2.enableVertexAttribArray(this.attribs.aColor);

      const aspect = this.canvas.width / this.canvas.height;
      const proj = M4.perspective(Math.PI / 2.6, aspect, 0.1, 90);
      const view = M4.viewMatrix(this.player.pos, this.player.yaw, this.player.pitch);
      const viewProj = M4.multiply(proj, view);
      gl2.uniformMatrix4fv(this.uniforms.uViewProj, false, viewProj);
      gl2.uniform3fv(this.uniforms.uCameraPos, this.player.pos);
      gl2.uniform1f(this.uniforms.uFogNear, 18);
      gl2.uniform1f(this.uniforms.uFogFar, this.worldRadius + 4);
      gl2.uniform3fv(this.uniforms.uLightDir, V3.normalize([0.4, 0.85, 0.3]));
      gl2.uniform3fv(this.uniforms.uFogColor, FOG_COLOR);

      this.drawMesh(this.meshes.ground, M4.identity(), 0.05);

      this.decor.forEach(d => {
        if (d.kind === 'crystal') {
          this.drawMesh(this.meshes.crystalBase, M4.compose(d.pos, d.rotY, [d.scale, d.scale, d.scale]), 0.1);
          this.drawMesh(this.meshes.crystal, M4.compose([d.pos[0], d.pos[1] + 0.4 * d.scale, d.pos[2]], d.rotY, [d.scale, d.scale, d.scale]), 0.35);
        } else if (d.kind === 'tree') {
          this.drawMesh(this.meshes.treeTrunk, M4.compose(d.pos, d.rotY, [d.scale, d.scale, d.scale]), 0);
          this.drawMesh(this.meshes.treeTop, M4.compose([d.pos[0], d.pos[1] + 1.3 * d.scale, d.pos[2]], d.rotY, [d.scale, d.scale, d.scale]), 0);
        } else {
          this.drawMesh(this.meshes.rock, M4.compose(d.pos, d.rotY, [d.scale, d.scale * 0.8, d.scale]), 0);
        }
      });

      this.monsters.forEach(m => {
        if (!m.alive) return;
        const bob = Math.sin(m.phase) * 0.15;
        const pos = [m.pos[0], 0.9 + bob, m.pos[2]];
        this.drawMesh(this.meshes.monster[m.colorKey], M4.compose(pos, m.phase * 0.3, [0.85, 0.85, 0.85]), 0.25);
        const eyeYaw = m.phase * 0.3;
        const fwd = [Math.sin(eyeYaw) * 0.55, 0.15, Math.cos(eyeYaw) * 0.55];
        const leftEye = V3.add(pos, [fwd[0] - fwd[2] * 0.4, fwd[1], fwd[2] + fwd[0] * 0.4]);
        const rightEye = V3.add(pos, [fwd[0] + fwd[2] * 0.4, fwd[1], fwd[2] - fwd[0] * 0.4]);
        this.drawMesh(this.meshes.eyeWhite, M4.translation(leftEye[0], leftEye[1], leftEye[2]), 0.4);
        this.drawMesh(this.meshes.eyeWhite, M4.translation(rightEye[0], rightEye[1], rightEye[2]), 0.4);
      });

      this.stars.forEach(s => {
        if (!s.alive) return;
        const bob = Math.sin(s.phase) * 0.2;
        const pos = [s.pos[0], 1.1 + bob, s.pos[2]];
        this.drawMesh(this.meshes.star, M4.compose(pos, s.phase * 1.5, [0.7, 0.7, 0.7]), 0.7);
      });

      this.projectiles.forEach(pr => {
        this.drawMesh(this.meshes.projectile[pr.powerId], M4.translation(pr.pos[0], pr.pos[1], pr.pos[2]), 0.85);
      });

      this.particles.forEach(pa => {
        const s = Math.max(0.05, pa.life / pa.maxLife);
        this.drawMesh(this.meshes.particle[activeParticlePower(pa.colorKey)] || this.meshes.star, M4.compose(pa.pos, 0, [s, s, s]), 0.8);
      });
    },

    loop(t) {
      if (!this.running) return;
      const dt = Math.min(0.05, (t - this.lastT) / 1000 || 0);
      this.lastT = t;
      this.update(dt);
      this.render();
      requestAnimationFrame(this.loop.bind(this));
    },

    start() {
      this.running = true;
      this.paused = false;
      this.lastT = performance.now();
      requestAnimationFrame(this.loop.bind(this));
    },
    pause() { this.paused = true; },
    resume() { this.paused = false; },
  };

  function activeParticlePower(colorKey) {
    const map = { green: 'eis', blue: 'eis', purple: 'schild', orange: 'feuer' };
    return map[colorKey] || 'feuer';
  }

  function mulberry32(seed) {
    let a = seed;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  window.G.world = World;
})();
