(() => {
  'use strict';
  window.G = window.G || {};

  const M4 = {
    identity() { return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]); },
    multiply(a, b) {
      const out = new Float32Array(16);
      for (let c = 0; c < 4; c++) {
        for (let r = 0; r < 4; r++) {
          let sum = 0;
          for (let k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k];
          out[c * 4 + r] = sum;
        }
      }
      return out;
    },
    perspective(fovy, aspect, near, far) {
      const f = 1 / Math.tan(fovy / 2);
      const out = new Float32Array(16);
      out[0] = f / aspect;
      out[5] = f;
      out[10] = (far + near) / (near - far);
      out[11] = -1;
      out[14] = (2 * far * near) / (near - far);
      return out;
    },
    translation(x, y, z) {
      const out = M4.identity();
      out[12] = x; out[13] = y; out[14] = z;
      return out;
    },
    rotationY(rad) {
      const c = Math.cos(rad), s = Math.sin(rad);
      const out = M4.identity();
      out[0] = c; out[2] = -s; out[8] = s; out[10] = c;
      return out;
    },
    rotationX(rad) {
      const c = Math.cos(rad), s = Math.sin(rad);
      const out = M4.identity();
      out[5] = c; out[6] = s; out[9] = -s; out[10] = c;
      return out;
    },
    rotationZ(rad) {
      const c = Math.cos(rad), s = Math.sin(rad);
      const out = M4.identity();
      out[0] = c; out[1] = s; out[4] = -s; out[5] = c;
      return out;
    },
    scaling(x, y, z) {
      const out = M4.identity();
      out[0] = x; out[5] = y; out[10] = z;
      return out;
    },
    compose(pos, rotY, scale) {
      let m = M4.translation(pos[0], pos[1], pos[2]);
      if (rotY) m = M4.multiply(m, M4.rotationY(rotY));
      if (scale) m = M4.multiply(m, M4.scaling(scale[0], scale[1], scale[2]));
      return m;
    },
    viewMatrix(pos, yaw, pitch) {
      const rx = M4.rotationX(-pitch);
      const ry = M4.rotationY(-yaw);
      const t = M4.translation(-pos[0], -pos[1], -pos[2]);
      return M4.multiply(rx, M4.multiply(ry, t));
    },
  };

  const V3 = {
    sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; },
    add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; },
    scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; },
    dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; },
    cross(a, b) {
      return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
      ];
    },
    length(a) { return Math.sqrt(V3.dot(a, a)); },
    normalize(a) {
      const l = V3.length(a) || 1;
      return [a[0] / l, a[1] / l, a[2] / l];
    },
    lerp(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; },
    distance(a, b) { return V3.length(V3.sub(a, b)); },
  };

  window.G.M4 = M4;
  window.G.V3 = V3;
})();
