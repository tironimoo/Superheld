(() => {
  'use strict';
  window.G = window.G || {};
  const V3 = window.G.V3;

  function hexToRgb(hex) {
    const n = parseInt(hex.replace('#', ''), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  function faceNormal(a, b, c) {
    return V3.normalize(V3.cross(V3.sub(b, a), V3.sub(c, a)));
  }

  // Builds a flat-shaded (faceted) mesh from a triangle-soup vertex/face list.
  function buildFlat(rawVerts, faces, colorRgb, jitter) {
    const positions = [];
    const normals = [];
    const colors = [];
    faces.forEach(face => {
      const a = rawVerts[face[0]], b = rawVerts[face[1]], c = rawVerts[face[2]];
      const n = faceNormal(a, b, c);
      const f = jitter ? (0.82 + Math.sin(face[0] * 12.9898 + face[1] * 78.233 + face[2] * 37.719) * 0.5 + 0.5) * 0.3 + 0.82 : 1;
      const col = [colorRgb[0] * f, colorRgb[1] * f, colorRgb[2] * f];
      [a, b, c].forEach(v => positions.push(v[0], v[1], v[2]));
      for (let i = 0; i < 3; i++) { normals.push(n[0], n[1], n[2]); colors.push(col[0], col[1], col[2]); }
    });
    return { positions: new Float32Array(positions), normals: new Float32Array(normals), colors: new Float32Array(colors) };
  }

  function icosahedron(radius, color, jitter) {
    const t = (1 + Math.sqrt(5)) / 2;
    const raw = [
      [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
      [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
      [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
    ].map(v => V3.scale(V3.normalize(v), radius));
    const faces = [
      [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
      [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
      [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
      [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
    ];
    return buildFlat(raw, faces, hexToRgb(color), jitter);
  }

  function box(w, h, d, color, jitter) {
    const x = w / 2, y = h / 2, z = d / 2;
    const raw = [
      [-x, -y, -z], [x, -y, -z], [x, y, -z], [-x, y, -z], // back 0-3
      [-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z],     // front 4-7
    ];
    const faces = [
      [4, 5, 6], [4, 6, 7], // front
      [1, 0, 3], [1, 3, 2], // back
      [0, 4, 7], [0, 7, 3], // left
      [5, 1, 2], [5, 2, 6], // right
      [3, 7, 6], [3, 6, 2], // top
      [0, 1, 5], [0, 5, 4], // bottom
    ];
    return buildFlat(raw, faces, hexToRgb(color), jitter);
  }

  function cone(radiusBottom, height, segments, color, jitter) {
    const raw = [[0, height, 0]]; // apex = 0
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      raw.push([Math.cos(a) * radiusBottom, 0, Math.sin(a) * radiusBottom]);
    }
    raw.push([0, 0, 0]); // base center = segments+1
    const baseCenterIdx = segments + 1;
    const faces = [];
    for (let i = 0; i < segments; i++) {
      const cur = 1 + i, next = 1 + ((i + 1) % segments);
      faces.push([0, cur, next]);
      faces.push([baseCenterIdx, next, cur]);
    }
    return buildFlat(raw, faces, hexToRgb(color), jitter);
  }

  function cylinder(radius, height, segments, color, jitter) {
    const raw = [];
    const topCenterIdx = segments * 2;
    const bottomCenterIdx = segments * 2 + 1;
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      raw.push([Math.cos(a) * radius, height, Math.sin(a) * radius]);
    }
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      raw.push([Math.cos(a) * radius, 0, Math.sin(a) * radius]);
    }
    raw.push([0, height, 0]);
    raw.push([0, 0, 0]);
    const faces = [];
    for (let i = 0; i < segments; i++) {
      const ni = (i + 1) % segments;
      const t0 = i, t1 = ni, b0 = segments + i, b1 = segments + ni;
      faces.push([t0, b0, b1]);
      faces.push([t0, b1, t1]);
      faces.push([topCenterIdx, ni, i]);
      faces.push([bottomCenterIdx, segments + i, segments + ni]);
    }
    return buildFlat(raw, faces, hexToRgb(color), jitter);
  }

  // Smooth-shaded magic ground disc: concentric rings colored by distance, normals up.
  function groundDisc(radius, segments, rings, colorCenterHex, colorEdgeHex) {
    const cCenter = hexToRgb(colorCenterHex);
    const cEdge = hexToRgb(colorEdgeHex);
    const positions = [];
    const normals = [];
    const colors = [];
    const indices = [];
    const ringPositions = [[0, 0, 0]];
    positions.push(0, 0, 0);
    normals.push(0, 1, 0);
    colors.push(cCenter[0], cCenter[1], cCenter[2]);
    for (let r = 1; r <= rings; r++) {
      const dist = (r / rings) * radius;
      const t = r / rings;
      const ring = Math.max(0, Math.sin(t * Math.PI * 5)) * 0.12;
      for (let i = 0; i < segments; i++) {
        const a = (i / segments) * Math.PI * 2;
        const x = Math.cos(a) * dist, z = Math.sin(a) * dist;
        positions.push(x, 0, z);
        normals.push(0, 1, 0);
        const base = [
          cCenter[0] + (cEdge[0] - cCenter[0]) * t,
          cCenter[1] + (cEdge[1] - cCenter[1]) * t,
          cCenter[2] + (cEdge[2] - cCenter[2]) * t,
        ];
        colors.push(base[0] + ring, base[1] + ring * 0.6, base[2] + ring);
      }
    }
    // indices: center fan for ring 1 (wound so the normal faces +Y)
    const firstRingStart = 1;
    for (let i = 0; i < segments; i++) {
      const next = (i + 1) % segments;
      indices.push(0, firstRingStart + next, firstRingStart + i);
    }
    for (let r = 1; r < rings; r++) {
      const innerStart = 1 + (r - 1) * segments;
      const outerStart = 1 + r * segments;
      for (let i = 0; i < segments; i++) {
        const next = (i + 1) % segments;
        const i0 = innerStart + i, i1 = innerStart + next, o0 = outerStart + i, o1 = outerStart + next;
        indices.push(i0, o1, o0);
        indices.push(i0, i1, o1);
      }
    }
    return {
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      colors: new Float32Array(colors),
      indices: new Uint16Array(indices),
    };
  }

  // Full-screen sky gradient (two triangles in clip space, drawn without depth).
  function skyQuad(topHex, bottomHex) {
    const top = hexToRgb(topHex), bottom = hexToRgb(bottomHex);
    const positions = new Float32Array([
      -1, -1, 1, -1, 1, 1,
      -1, -1, 1, 1, -1, 1,
    ]);
    const colors = new Float32Array([
      bottom[0], bottom[1], bottom[2],
      bottom[0], bottom[1], bottom[2],
      top[0], top[1], top[2],
      bottom[0], bottom[1], bottom[2],
      top[0], top[1], top[2],
      top[0], top[1], top[2],
    ]);
    return { positions, colors };
  }

  window.G.geo = { icosahedron, box, cone, cylinder, groundDisc, skyQuad, hexToRgb };
})();
