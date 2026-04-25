import * as THREE from "three";
function parseFen(fen) {
  const pos = {};
  const ranks = fen.split(" ")[0].split("/");
  for (let rankIdx = 0; rankIdx < 8; rankIdx++) {
    let fileIdx = 0;
    for (const ch of ranks[rankIdx]) {
      if (ch >= "1" && ch <= "8") {
        fileIdx += parseInt(ch);
      } else {
        pos["abcdefgh"[fileIdx] + (8 - rankIdx)] = ch;
        fileIdx++;
      }
    }
  }
  return pos;
}
const INITIAL_PIECES = {
  a8: "r",
  b8: "n",
  c8: "b",
  d8: "q",
  e8: "k",
  f8: "b",
  g8: "n",
  h8: "r",
  a7: "p",
  b7: "p",
  c7: "p",
  d7: "p",
  e7: "p",
  f7: "p",
  g7: "p",
  h7: "p",
  a2: "P",
  b2: "P",
  c2: "P",
  d2: "P",
  e2: "P",
  f2: "P",
  g2: "P",
  h2: "P",
  a1: "R",
  b1: "N",
  c1: "B",
  d1: "Q",
  e1: "K",
  f1: "B",
  g1: "N",
  h1: "R"
};
const TILE = 1;
const LATHE_SEGMENTS = 48;
function typeOf(p) {
  return p.toLowerCase();
}
function colorOf(p) {
  return p === p.toUpperCase() ? "w" : "b";
}
function squareToWorld(sq) {
  const file = sq.charCodeAt(0) - 97;
  const rank = parseInt(sq[1], 10) - 1;
  return { x: (file - 3.5) * TILE, z: (3.5 - rank) * TILE };
}
function latheMesh(profile, mat, segments = LATHE_SEGMENTS) {
  const pts = profile.map(([x, y]) => new THREE.Vector2(x, y));
  const geo = new THREE.LatheGeometry(pts, segments);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, mat);
}
function buildPawn(mat) {
  const g = new THREE.Group();
  g.add(latheMesh([
    [1e-3, 0],
    [0.34, 0],
    [0.34, 0.05],
    [0.3, 0.08],
    [0.22, 0.11],
    [0.14, 0.16],
    [0.11, 0.26],
    [0.11, 0.38],
    [0.18, 0.44],
    [0.22, 0.52],
    [0.22, 0.6],
    [0.18, 0.66],
    [0.1, 0.7],
    [1e-3, 0.72]
  ], mat));
  return g;
}
function buildRook(mat) {
  const g = new THREE.Group();
  g.add(latheMesh([
    [1e-3, 0],
    [0.38, 0],
    [0.38, 0.05],
    [0.33, 0.08],
    [0.25, 0.1],
    [0.22, 0.18],
    [0.22, 0.6],
    [0.27, 0.63],
    [0.31, 0.66],
    [0.31, 0.72],
    [1e-3, 0.72]
  ], mat, 24));
  const crenGeo = new THREE.BoxGeometry(0.14, 0.12, 0.14);
  const R = 0.22;
  for (const [dx, dz] of [[R, 0], [-R, 0], [0, R], [0, -R]]) {
    const cren = new THREE.Mesh(crenGeo, mat);
    cren.position.set(dx, 0.78, dz);
    g.add(cren);
  }
  return g;
}
function buildBishop(mat) {
  const g = new THREE.Group();
  g.add(latheMesh([
    [1e-3, 0],
    [0.36, 0],
    [0.36, 0.05],
    [0.3, 0.08],
    [0.22, 0.11],
    [0.14, 0.15],
    [0.12, 0.28],
    [0.15, 0.42],
    [0.22, 0.54],
    [0.22, 0.64],
    [0.16, 0.78],
    [0.1, 0.9],
    [0.07, 0.98],
    [1e-3, 1.02]
  ], mat));
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), mat);
  ball.position.y = 1.05;
  g.add(ball);
  return g;
}
function buildKnight(mat) {
  const g = new THREE.Group();
  g.add(latheMesh([
    [1e-3, 0],
    [0.38, 0],
    [0.38, 0.05],
    [0.32, 0.08],
    [0.22, 0.11],
    [0.2, 0.16],
    [1e-3, 0.16]
  ], mat, 32));
  const s = new THREE.Shape();
  s.moveTo(-0.24, 0);
  s.lineTo(0.24, 0);
  s.lineTo(0.24, 0.05);
  s.lineTo(0.18, 0.11);
  s.lineTo(0.13, 0.19);
  s.bezierCurveTo(0.2, 0.28, 0.28, 0.38, 0.3, 0.55);
  s.bezierCurveTo(0.3, 0.66, 0.26, 0.74, 0.18, 0.8);
  s.lineTo(0.08, 0.84);
  s.lineTo(-0.02, 0.85);
  s.bezierCurveTo(-0.1, 0.8, -0.14, 0.7, -0.18, 0.55);
  s.bezierCurveTo(-0.22, 0.4, -0.24, 0.25, -0.24, 0.1);
  s.lineTo(-0.24, 0);
  const headGeo = new THREE.ExtrudeGeometry(s, {
    depth: 0.26,
    bevelEnabled: true,
    bevelThickness: 0.015,
    bevelSize: 0.015,
    bevelSegments: 3,
    curveSegments: 20
  });
  headGeo.translate(0, 0, -0.13);
  headGeo.rotateY(-Math.PI / 2);
  headGeo.translate(0, 0.16, 0);
  g.add(new THREE.Mesh(headGeo, mat));
  const eyeMat = new THREE.MeshStandardMaterial({
    color: 657413,
    roughness: 0.4,
    metalness: 0.05
  });
  for (const zOff of [0.14, -0.14]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), eyeMat);
    eye.position.set(0.12, 0.54, zOff);
    g.add(eye);
  }
  return g;
}
function buildQueen(mat) {
  const g = new THREE.Group();
  g.add(latheMesh([
    [1e-3, 0],
    [0.38, 0],
    [0.38, 0.05],
    [0.32, 0.08],
    [0.22, 0.11],
    [0.16, 0.22],
    [0.13, 0.4],
    [0.12, 0.56],
    [0.15, 0.72],
    [0.22, 0.85],
    [0.24, 0.92],
    [0.22, 0.98],
    [0.18, 1.03],
    [1e-3, 1.05]
  ], mat));
  const pointGeo = new THREE.SphereGeometry(0.045, 10, 8);
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2;
    const pt = new THREE.Mesh(pointGeo, mat);
    pt.position.set(Math.cos(a) * 0.22, 1, Math.sin(a) * 0.22);
    g.add(pt);
  }
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.06, 14, 10), mat);
  knob.position.y = 1.09;
  g.add(knob);
  return g;
}
function buildKing(mat) {
  const g = new THREE.Group();
  g.add(latheMesh([
    [1e-3, 0],
    [0.4, 0],
    [0.4, 0.05],
    [0.34, 0.08],
    [0.24, 0.11],
    [0.18, 0.22],
    [0.14, 0.42],
    [0.13, 0.6],
    [0.16, 0.76],
    [0.24, 0.9],
    [0.26, 0.98],
    [0.22, 1.05],
    [0.18, 1.1],
    [1e-3, 1.12]
  ], mat));
  const vert = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.22, 0.055), mat);
  vert.position.y = 1.24;
  g.add(vert);
  const horz = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.055, 0.055), mat);
  horz.position.y = 1.26;
  g.add(horz);
  return g;
}
function buildPiece(type, color, mats) {
  const mat = color === "w" ? mats.whitePiece : mats.blackPiece;
  let g;
  switch (type) {
    case "p":
      g = buildPawn(mat);
      break;
    case "r":
      g = buildRook(mat);
      break;
    case "n":
      g = buildKnight(mat);
      break;
    case "b":
      g = buildBishop(mat);
      break;
    case "q":
      g = buildQueen(mat);
      break;
    case "k":
      g = buildKing(mat);
      break;
  }
  if (color === "b") g.rotation.y = Math.PI;
  g.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });
  return g;
}
function makeMaterials(opts = {}) {
  function mat(def, over) {
    return new THREE.MeshStandardMaterial({
      color:     new THREE.Color(over?.color     ?? def.color),
      roughness: over?.roughness ?? def.roughness,
      metalness: over?.metalness ?? def.metalness,
    });
  }
  return {
    whitePiece: mat({ color: '#ead6ae', roughness: 0.42, metalness: 0.04 }, opts.whitePiece),
    blackPiece: mat({ color: '#1a120a', roughness: 0.38, metalness: 0.06 }, opts.blackPiece),
    lightSq:    mat({ color: '#d4b284', roughness: 0.55, metalness: 0.02 }, opts.lightSquare),
    darkSq:     mat({ color: '#5a3a20', roughness: 0.60, metalness: 0.02 }, opts.darkSquare),
    frame:      mat({ color: '#2a180c', roughness: 0.48, metalness: 0.04 }, opts.frame),
  };
}
function buildBoard(mats, tileElevation) {
  const group = new THREE.Group();
  const frameMesh = new THREE.Mesh(
    new THREE.BoxGeometry(8.07, 0.35, 8.07),
    mats.frame
  );
  frameMesh.position.y = -0.135;
  frameMesh.castShadow = true;
  frameMesh.receiveShadow = true;
  group.add(frameMesh);
  const squares = [];
  const tileH = Math.max(0.001, tileElevation);
  const tileGeo = new THREE.BoxGeometry(0.93, tileH, 0.93);
  const tileCenterY = 0.04 + tileH / 2 + 0.003;
  for (let file = 0; file < 8; file++) {
    for (let rank = 0; rank < 8; rank++) {
      const dark = (file + rank) % 2 === 1;
      const mat = dark ? mats.darkSq : mats.lightSq;
      const tile = new THREE.Mesh(tileGeo, mat);
      tile.position.set((file - 3.5) * TILE, tileCenterY, (3.5 - rank) * TILE);
      tile.receiveShadow = true;
      tile.userData = {
        square: String.fromCharCode(97 + file) + (rank + 1),
        baseMat: mat,
      };
      squares.push(tile);
      group.add(tile);
    }
  }
  return { group, squares };
}
function diffPositions(prev, curr) {
  const pureVacated = [];
  const pureFilled = [];
  const inPlaceCap = [];
  const allSq = /* @__PURE__ */ new Set([...Object.keys(prev), ...Object.keys(curr)]);
  for (const sq of allSq) {
    const a = prev[sq], b = curr[sq];
    if (a && !b) pureVacated.push(sq);
    else if (!a && b) pureFilled.push(sq);
    else if (a && b && a !== b) inPlaceCap.push(sq);
  }
  if (pureVacated.length === 1 && pureFilled.length === 1 && inPlaceCap.length === 0) {
    const from = pureVacated[0], to = pureFilled[0];
    return { movers: [{ from, to, landingPiece: curr[to] }], captured: null, kind: "move" };
  }
  if (pureVacated.length === 1 && pureFilled.length === 0 && inPlaceCap.length === 1) {
    const from = pureVacated[0], to = inPlaceCap[0];
    return {
      movers: [{ from, to, landingPiece: curr[to] }],
      captured: { square: to },
      kind: "capture"
    };
  }
  if (pureVacated.length === 2 && pureFilled.length === 2 && inPlaceCap.length === 0) {
    const movers = [];
    for (const t of pureFilled) {
      const f = pureVacated.find((v) => prev[v] === curr[t]);
      if (f) movers.push({ from: f, to: t, landingPiece: curr[t] });
    }
    return { movers, captured: null, kind: "castle" };
  }
  if (pureVacated.length === 2 && pureFilled.length === 1 && inPlaceCap.length === 0) {
    const to = pureFilled[0];
    const from = pureVacated.find((v) => prev[v] === curr[to]);
    const capSq = pureVacated.find((v) => v !== from);
    return {
      movers: [{ from, to, landingPiece: curr[to] }],
      captured: { square: capSq },
      kind: "enpassant"
    };
  }
  return { movers: [], captured: null, kind: "unknown" };
}
function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
class ChessScene {
  // Three.js core
  container;
  scene;
  camera;
  renderer;
  materials;
  squares;
  // Piece tracking. Each piece gets a stable id so meshes can follow it.
  pieceMeshes = /* @__PURE__ */ new Map();
  squareToId = /* @__PURE__ */ new Map();
  currentPosition = {};
  nextPieceId = 0;
  highlightedSquares = /* @__PURE__ */ new Set();
  moveLine = null;
  moveLineFade = null;
  // Camera state (custom orbit controls)
  camTheta = 0;
  camPhi = Math.PI * 0.25;
  camRadius = 14.5;
  camTarget = new THREE.Vector3(0, 0.2, 0);
  dragging = false;
  lastPointer = { x: 0, y: 0 };
  idleSince = performance.now();
  // Options
  animationDurationMs;
  autoRotateIdleMs;
  enableOrbit;
  // Loop
  rafId = 0;
  lastFrameTime = performance.now();
  disposed = false;
  // Lifecycle handles
  resizeObserver;
  listeners = [];
  constructor(container, options = {}) {
    this.container = container;
    this.animationDurationMs = options.animationDurationMs ?? 520;
    this.autoRotateIdleMs = options.autoRotateIdleMs ?? 3500;
    this.enableOrbit = options.enableOrbit ?? true;
    const _te = options.tileElevation ?? 0.08;
    const _tileH = Math.max(0.001, _te);
    this.yBase = 0.04 + _tileH + 0.005;
    if (options.camPhi    !== undefined) this.camPhi    = options.camPhi;
    if (options.camRadius !== undefined) this.camRadius = options.camRadius;
    if (options.camTheta  !== undefined) this.camTheta  = options.camTheta;
    if (options.camTargetZ !== undefined) this.camTarget.z = options.camTargetZ;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(options.backgroundColor ?? 788742);
    this.scene.fog = new THREE.Fog(
      this.scene.background.getHex(),
      35,
      60
    );
    const { w, h } = this.size();
    this.camera = new THREE.PerspectiveCamera(38, w / h, 0.1, 100);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    const anyRenderer = this.renderer;
    if ("outputColorSpace" in anyRenderer && "SRGBColorSpace" in THREE) {
      anyRenderer.outputColorSpace = THREE.SRGBColorSpace;
    } else if ("outputEncoding" in anyRenderer && "sRGBEncoding" in THREE) {
      anyRenderer.outputEncoding = THREE.sRGBEncoding;
    }
    container.appendChild(this.renderer.domElement);
    const key = new THREE.DirectionalLight(16773334, 2.4);
    key.position.set(-5, 11, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 30;
    key.shadow.camera.left = -7;
    key.shadow.camera.right = 7;
    key.shadow.camera.top = 7;
    key.shadow.camera.bottom = -7;
    key.shadow.bias = -2e-3;
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(7181506, 0.55);
    fill.position.set(6, 6, -4);
    this.scene.add(fill);
    const rim = new THREE.DirectionalLight(16760698, 0.45);
    rim.position.set(0, 3, -9);
    this.scene.add(rim);
    this.scene.add(new THREE.HemisphereLight(16770752, 1707784, 0.35));
    this.scene.add(new THREE.AmbientLight(16771276, 0.12));
    this.materials = makeMaterials(options.materials);
    const board = buildBoard(this.materials, options.tileElevation ?? 0.08);
    this.squares = board.squares;
    this.scene.add(board.group);
    if (options.logoUrl) {
      const logoMat = new THREE.MeshBasicMaterial({
        transparent: true, opacity: options.logoOpacity ?? 0.65, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      });
      const planeSize = options.logoSquare ? 0.82 : 8;
      const logoPos = options.logoSquare ? squareToWorld(options.logoSquare) : { x: 0, z: 0 };
      const logo = new THREE.Mesh(new THREE.PlaneGeometry(planeSize, planeSize), logoMat);
      logo.rotation.x = -Math.PI / 2;
      logo.position.set(logoPos.x, 0.04 + _tileH + 0.004, logoPos.z);
      this.scene.add(logo);

      const c = new THREE.Color(options.logoColor ?? 0xffffff);
      const [lr, lg, lb] = [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)];
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width; canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
        for (let i = 0; i < id.data.length; i += 4) {
          if (id.data[i + 3] > 0) { id.data[i] = lr; id.data[i + 1] = lg; id.data[i + 2] = lb; }
        }
        ctx.putImageData(id, 0, 0);
        logoMat.map = new THREE.CanvasTexture(canvas);
        logoMat.needsUpdate = true;
      };
      img.src = options.logoUrl;
    }
    this.instantiatePieces(options.initialPieces ?? INITIAL_PIECES);
    this.applyCamera();
    if (this.enableOrbit) this.attachOrbitHandlers();
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);
    this.loop();
  }
  /**
   * Animate the scene to the provided position. Returns a promise that
   * resolves when the animation completes. Calling `next()` while an
   * animation is in flight snaps any pending movers to their targets first.
   */
  next(state) {
    if (this.disposed) return Promise.resolve();
    this.flushPendingTweens();
    const pos = parseFen(state.fen);
    const diff = diffPositions(this.currentPosition, pos);
    if (diff.kind === "unknown") {
      this.reset(pos);
      return Promise.resolve();
    }
    const now = performance.now();
    const duration = this.animationDurationMs;
    const pending = [];
    const primary = diff.kind === "castle" ? diff.movers.find((m) => typeOf(this.currentPosition[m.from]) === "k") ?? diff.movers[0] : diff.movers[0];
    this.setMoveLine(primary?.from, primary?.to);
    if (diff.captured) {
      const capId = this.squareToId.get(diff.captured.square);
      if (capId) {
        const p = this.pieceMeshes.get(capId);
        if (p) {
          pending.push(new Promise((resolve) => {
            p.tween = {
              kind: "capture",
              startTime: now,
              duration,
              hideAt: 0.5,
              hidden: false,
              onComplete: resolve
            };
          }));
        }
        this.squareToId.delete(diff.captured.square);
      }
    }
    const resolved = diff.movers.map((m) => ({
      ...m,
      id: this.squareToId.get(m.from)
    }));
    for (const m of resolved) this.squareToId.delete(m.from);
    for (const m of resolved) {
      if (!m.id) continue;
      const p = this.pieceMeshes.get(m.id);
      if (!p) continue;
      const landingType = typeOf(m.landingPiece);
      if (landingType !== p.type) {
        this.replacePieceMesh(m.id, landingType, p.color);
      }
      const current = p.mesh.position;
      const dest = squareToWorld(m.to);
      const dist = Math.hypot(dest.x - current.x, dest.z - current.z);
      let lift = 0.2 + dist * 0.09;
      if (p.type === "n") lift += 0.25;
      pending.push(new Promise((resolve) => {
        p.mesh.visible = true;
        p.tween = {
          kind: "move",
          startPos: current.clone(),
          targetPos: new THREE.Vector3(dest.x, p.yBase, dest.z),
          startTime: now,
          duration,
          lift,
          onComplete: resolve
        };
      }));
      this.squareToId.set(m.to, m.id);
    }
    this.currentPosition = { ...pos };
    return Promise.all(pending).then(() => void 0);
  }
  /**
   * Jump to a position (or the starting position if omitted) with no
   * animation. Rebuilds meshes as needed so arbitrary positions work.
   */
  reset(pieces = INITIAL_PIECES) {
    if (this.disposed) return;
    for (const p of this.pieceMeshes.values()) {
      this.disposeMesh(p.mesh);
      this.scene.remove(p.mesh);
    }
    this.pieceMeshes.clear();
    this.squareToId.clear();
    this.nextPieceId = 0;
    this.instantiatePieces(pieces);
    this.setMoveLine(null, null);
  }
  /** Release GPU resources and detach from the DOM. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    this.resizeObserver.disconnect();
    for (const off of this.listeners) off();
    this.listeners.length = 0;
    this.scene.traverse((obj) => {
      const m = obj;
      if (m.geometry) m.geometry.dispose();
      if (m.material) {
        if (Array.isArray(m.material)) m.material.forEach((x) => x.dispose());
        else m.material.dispose();
      }
    });
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
  // ─── Internals ──────────────────────────────────────────────────────
  size() {
    const c = this.container;
    return {
      w: Math.max(1, c.clientWidth || c.offsetWidth || 800),
      h: Math.max(1, c.clientHeight || c.offsetHeight || 600)
    };
  }
  instantiatePieces(pieces) {
    this.currentPosition = { ...pieces };
    for (const [sq, glyph] of Object.entries(pieces)) {
      const id = "p" + this.nextPieceId++;
      const type = typeOf(glyph);
      const color = colorOf(glyph);
      const mesh = buildPiece(type, color, this.materials);
      const pos = squareToWorld(sq);
      mesh.position.set(pos.x, this.yBase, pos.z);
      this.scene.add(mesh);
      this.pieceMeshes.set(id, { mesh, type, color, yBase: this.yBase, tween: null });
      this.squareToId.set(sq, id);
    }
  }
  replacePieceMesh(id, newType, color) {
    const p = this.pieceMeshes.get(id);
    if (!p) return;
    const oldPos = p.mesh.position.clone();
    this.disposeMesh(p.mesh);
    this.scene.remove(p.mesh);
    const mesh = buildPiece(newType, color, this.materials);
    mesh.position.copy(oldPos);
    this.scene.add(mesh);
    this.pieceMeshes.set(id, { ...p, mesh, type: newType });
  }
  disposeMesh(obj) {
    obj.traverse((child) => {
      const m = child;
      if (m.geometry) m.geometry.dispose();
    });
  }
  setHighlights(squares) {
    const set = new Set(squares);
    const [from, to] = [...set];
    this.setMoveLine(from, to);
    this.highlightedSquares = set;
  }
  setMoveLine(fromSq, toSq) {
    if (this.moveLine) {
      this.scene.remove(this.moveLine);
      this.moveLine.geometry.dispose();
      this.moveLine.material.dispose();
      this.moveLine = null;
      this.moveLineFade = null;
    }
    if (!fromSq || !toSq) return;
    const a = squareToWorld(fromSq);
    const b = squareToWorld(toSq);
    const y = this.yBase + 0.01;
    const start = new THREE.Vector3(a.x, y, a.z);
    const end   = new THREE.Vector3(b.x, y, b.z);
    const dir    = new THREE.Vector3().subVectors(end, start);
    const length = dir.length();
    const mid    = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
    const geo = new THREE.CylinderGeometry(0.018, 0.018, length, 8, 1, true);
    const mat = new THREE.MeshBasicMaterial({ color: '#7f1010', transparent: true, opacity: 1.0, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(mid);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    this.scene.add(mesh);
    this.moveLine = mesh;
    this.moveLineFade = { startTime: performance.now(), duration: 1000 };
  }
  flushPendingTweens() {
    for (const p of this.pieceMeshes.values()) {
      if (!p.tween) continue;
      if (p.tween.kind === "move") {
        p.mesh.position.copy(p.tween.targetPos);
        p.mesh.visible = true;
        p.tween.onComplete?.();
      } else {
        p.mesh.visible = false;
        p.tween.onComplete?.();
      }
      p.tween = null;
    }
  }
  applyCamera() {
    const { camTheta: th, camPhi: ph, camRadius: r, camTarget: tg } = this;
    this.camera.position.x = tg.x + r * Math.cos(ph) * Math.sin(th);
    this.camera.position.y = tg.y + r * Math.sin(ph);
    this.camera.position.z = tg.z + r * Math.cos(ph) * Math.cos(th);
    this.camera.lookAt(tg);
  }
  attachOrbitHandlers() {
    const canvas = this.renderer.domElement;
    const onDown = (x, y) => {
      this.dragging = true;
      this.lastPointer = { x, y };
      this.idleSince = performance.now();
    };
    const onMove = (x, y) => {
      if (!this.dragging) return;
      const dx = x - this.lastPointer.x, dy = y - this.lastPointer.y;
      this.camTheta -= dx * 8e-3;
      this.camPhi = Math.max(0.12, Math.min(Math.PI / 2 - 0.05, this.camPhi - dy * 6e-3));
      this.lastPointer = { x, y };
      this.idleSince = performance.now();
    };
    const onUp = () => {
      this.dragging = false;
      this.idleSince = performance.now();
    };
    const onMouseDown = (e) => onDown(e.clientX, e.clientY);
    const onMouseMove = (e) => onMove(e.clientX, e.clientY);
    const onMouseUp = () => onUp();
    const onWheel = (e) => {
      e.preventDefault();
      this.camRadius = Math.max(7, Math.min(22, this.camRadius + e.deltaY * 0.012));
      this.idleSince = performance.now();
    };
    const onTouchStart = (e) => {
      if (e.touches.length === 1) onDown(e.touches[0].clientX, e.touches[0].clientY);
    };
    const onTouchMove = (e) => {
      if (e.touches.length === 1) {
        onMove(e.touches[0].clientX, e.touches[0].clientY);
        e.preventDefault();
      }
    };
    const onTouchEnd = () => onUp();
    canvas.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("touchstart", onTouchStart, { passive: true });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    canvas.addEventListener("touchend", onTouchEnd);
    this.listeners.push(
      () => canvas.removeEventListener("mousedown", onMouseDown),
      () => window.removeEventListener("mousemove", onMouseMove),
      () => window.removeEventListener("mouseup", onMouseUp),
      () => canvas.removeEventListener("wheel", onWheel),
      () => canvas.removeEventListener("touchstart", onTouchStart),
      () => canvas.removeEventListener("touchmove", onTouchMove),
      () => canvas.removeEventListener("touchend", onTouchEnd)
    );
  }
  handleResize() {
    const { w, h } = this.size();
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }
  loop = () => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = (now - this.lastFrameTime) / 1e3;
    this.lastFrameTime = now;
    if (this.autoRotateIdleMs > 0 && !this.dragging && now - this.idleSince > this.autoRotateIdleMs) {
      this.camTheta += 0.03 * dt;
    }
    this.applyCamera();
    let tweening = false;
    for (const p of this.pieceMeshes.values()) {
      if (!p.tween) continue;
      tweening = true;
      const tw = p.tween;
      const t = Math.min(1, (now - tw.startTime) / tw.duration);
      if (tw.kind === "move") {
        const e = easeInOutCubic(t);
        const sp = tw.startPos, tp = tw.targetPos;
        p.mesh.position.x = sp.x + (tp.x - sp.x) * e;
        p.mesh.position.z = sp.z + (tp.z - sp.z) * e;
        p.mesh.position.y = sp.y + (tp.y - sp.y) * e + tw.lift * Math.sin(Math.PI * t);
      } else {
        if (!tw.hidden && t >= tw.hideAt) {
          p.mesh.visible = false;
          tw.hidden = true;
        }
      }
      if (t >= 1) {
        tw.onComplete?.();
        p.tween = null;
      }
    }
    this.renderer.shadowMap.needsUpdate = tweening;
    if (this.moveLine && this.moveLineFade) {
      const fadeT = Math.min(1, (now - this.moveLineFade.startTime) / this.moveLineFade.duration);
      this.moveLine.material.opacity = 1 - fadeT;
      if (fadeT >= 1) {
        this.scene.remove(this.moveLine);
        this.moveLine.geometry.dispose();
        this.moveLine.material.dispose();
        this.moveLine = null;
        this.moveLineFade = null;
      }
    }
    this.renderer.render(this.scene, this.camera);
  };
}
var chess_scene_default = ChessScene;
export {
  ChessScene,
  chess_scene_default as default
};
