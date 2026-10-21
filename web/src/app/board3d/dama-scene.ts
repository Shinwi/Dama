import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { TeapotGeometry } from 'three/examples/jsm/geometries/TeapotGeometry.js';
import { BoardArray, DARK, LIGHT, Move, Side } from '../../engine/types';
import {
  BOARD_HEIGHT,
  DISC_HEIGHT,
  FRAME_HALF,
  TRAY_Y,
  capturedDiscs,
  easeInOutCubic,
  easeOutBack,
  cameraTilt,
  fitDistance,
  hopDurations,
  hopHeight,
  pileSlot,
  shortestTurn,
  squareDistance,
  squareToWorld,
  worldToSquare,
} from './geometry';
import { Particles } from './particles';
import {
  brassTexture,
  frameTexture,
  glowTexture,
  latticeTexture,
  petalTexture,
  pieceMotifTexture,
  skyTexture,
  squaresTexture,
  woodTexture,
} from './textures';

/** What the board highlights, all as square indexes (see `Board`'s inputs of the same names). */
export interface Markers {
  selected: number | null;
  path: number[];
  dots: number[];
  rings: number[];
  compulsory: number[];
  lastMove: number[];
}

/** How the game ended, for the scene to react to: petals for a win, a guttering lantern for a loss. */
export type Mood = 'win' | 'loss' | 'neutral' | null;

interface Piece {
  side: Side;
  square: number;
  king: boolean;
  /** Where the piece is: moved around the board by hops. */
  root: THREE.Group;
  /** Leans, squashes and spins under `root`. Holds the disc(s) and the king's star. */
  body: THREE.Group;
  star: THREE.Object3D | null;
  /** Being moved by an animation, so the idle hover and bob leave it alone. */
  busy: boolean;
}

interface Tween {
  /** Set on the first frame that runs it, so a slow first frame (shaders compiling) skips nothing. */
  start: number | null;
  duration: number;
  step: (t: number) => void;
  resolve: () => void;
  /** A camera sweep: not about the position on the board, so a snap leaves it running. */
  camera: boolean;
}

/** A multi-jump being tapped out hop by hop: drawn as far as it has been tapped. */
interface Partial {
  piece: Piece;
  shown: number[];
  ghosts: Piece[];
}

interface Petal {
  position: THREE.Vector3;
  velocity: number;
  sway: number;
  phase: number;
  spin: THREE.Euler;
  rotation: THREE.Euler;
  delay: number;
  landed: boolean;
}

const LANTERN = new THREE.Vector3(-7.4, 5.4, -1.2);
const CAMERA_FOV = 38;
const TARGET = new THREE.Vector3(0, -0.35, 0);
const PETAL_COUNT = 240;
/** In low-power mode, how often to draw a frame while nothing is moving. */
const LOW_POWER_IDLE_MS = 400;
/** In low-power mode, the most pixels drawn per frame. */
const LOW_POWER_PIXELS = 520_000;
const COLORS = {
  light: '#f3e9d2',
  dark: '#1a2a78',
  gold: '#d8ab48',
  cobalt: '#2546a3',
  saffron: '#ffc54d',
  ember: '#ff6a3d',
  focus: '#a99cff',
};

/**
 * The whole 3D board as a plain class, with no Angular in it: Three.js scene, render loop,
 * camera, animations, picking. `Board3d` drives it the way `Board` drives the DOM: snap to a
 * position, play a move hop by hop, show what's selected.
 *
 * Animations are promises driven by the render loop (`tween()`), so a move reads as a script:
 * lift, arc, land, knock the jumped piece off, crown. `snap()` bumps `epoch`, which makes any
 * animation still running give up at its next step.
 */
export class DamaScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly clock = new THREE.Clock();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pickPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.12);
  private readonly resizeObserver: ResizeObserver;
  private readonly reducedMotionQuery =
    typeof matchMedia === 'undefined' ? null : matchMedia('(prefers-reduced-motion: reduce)');

  private pieces: Piece[] = [];
  private readonly piles = { 1: [], '-1': [] } as Record<Side, (THREE.Object3D | null)[]>;
  private tweens: Tween[] = [];
  private epoch = 0;
  private partial: Partial | null = null;
  private partialChain: Promise<void> = Promise.resolve();
  private markers: Markers = { selected: null, path: [], dots: [], rings: [], compulsory: [], lastMove: [] };

  private readonly markerGroup = new THREE.Group();
  private readonly hoverTile: THREE.Mesh;
  private readonly focusFrame: THREE.Mesh;
  private readonly sparks = new Particles(1400);
  private readonly dust = Particles.soft(900);
  private readonly lanternLight: THREE.PointLight;
  private readonly spot: THREE.SpotLight;
  private readonly lantern = new THREE.Group();
  private readonly teapotSpout = new THREE.Vector3();
  private petals: THREE.InstancedMesh | null = null;
  private petalState: Petal[] = [];

  private viewSide: Side = LIGHT;
  private sweeping = false;
  private sweepId = 0;
  /** Where the running sweep is heading: updated by a resize part-way through. */
  private sweepTarget: { phi: number; radius: number } | null = null;
  private shake = 0;
  private lanternLevel = 1;
  private lanternTarget = 1;
  private elapsed = 0;
  private pointerDown: { x: number; y: number; time: number } | null = null;
  private disposed = false;
  private readonly lowPower: boolean;
  private lastRender = 0;

  private readonly geo: Record<string, THREE.BufferGeometry> = {};
  private readonly mat: Record<string, THREE.Material> = {};
  private readonly ghostOf = new Map<THREE.Material, THREE.Material>();
  private readonly textures: THREE.Texture[] = [];

  constructor(
    private readonly container: HTMLElement,
    private readonly onTap: (square: number) => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    // Without a GPU (WebGL on the CPU, as on CI runners and some old phones) every frame is
    // expensive: draw fewer pixels, no shadows, and fewer frames while nothing is moving.
    this.lowPower = isSoftwareRenderer(this.renderer);
    this.renderer.setPixelRatio(this.lowPower ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = !this.lowPower;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    const canvas = this.renderer.domElement;
    canvas.setAttribute('data-testid', 'board-3d-canvas');
    canvas.setAttribute('aria-hidden', 'true');
    // Styled here, not in board3d.css: the canvas is created at runtime, so Angular's
    // component-scoped selectors never match it.
    Object.assign(canvas.style, { display: 'block', width: '100%', height: '100%' });
    container.appendChild(canvas);

    this.camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 200);
    this.camera.position.set(0, 14, 13);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.copy(TARGET);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.minPolarAngle = 0.2;
    this.controls.maxPolarAngle = 1.22;
    this.controls.rotateSpeed = 0.6;

    this.buildMaterials();
    this.buildWorld();
    const { light, spot } = this.buildLights();
    this.lanternLight = light;
    this.spot = spot;
    if (this.lowPower) this.simplify();

    this.hoverTile = new THREE.Mesh(this.geo['tile'], this.mat['hover']);
    this.hoverTile.visible = false;
    this.focusFrame = new THREE.Mesh(this.geo['frame'], this.mat['focus']);
    this.focusFrame.visible = false;
    this.scene.add(this.markerGroup, this.hoverTile, this.focusFrame, this.sparks.points, this.dust.points);

    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ---------------------------------------------------------------------------------------
  // Public API, used by Board3d.

  /**
   * Shows `board` straight away, with no animation, and drops any piece animation still
   * playing. A camera sweep carries on (New game during the intro mustn't freeze the camera
   * half-way down).
   */
  snap(board: BoardArray): void {
    this.epoch++;
    for (const tween of this.tweens) if (!tween.camera) tween.resolve();
    this.tweens = this.tweens.filter((tween) => tween.camera);
    this.partial = null;
    this.partialChain = Promise.resolve();
    for (const piece of this.pieces) this.scene.remove(piece.root);
    this.pieces = [];
    for (const side of [LIGHT, DARK] as Side[]) {
      for (const disc of this.piles[side]) if (disc) this.scene.remove(disc);
      this.piles[side] = [];
    }
    for (let square = 0; square < board.length; square++) {
      const cell = board[square];
      if (cell !== 0) this.addPiece(Math.sign(cell) as Side, square, Math.abs(cell) === 2);
    }
    this.syncPiles(board);
  }

  /**
   * Plays `move` out: the piece lifts and arcs from square to square, every piece it jumps
   * is knocked off onto the pile beside the board, and a promotion crowns it. Resolves once
   * the moving piece has landed (and been crowned); `board` is the position after the move.
   */
  async playMove(move: Move, board: BoardArray): Promise<void> {
    const epoch = this.epoch;
    const stale = () => epoch !== this.epoch || this.disposed;
    await this.partialChain;
    if (stale()) return;

    const partial = this.partial;
    this.partial = null;
    let mover: Piece | undefined;
    let hopsShown = 0;
    if (partial && partial.shown.every((square, i) => move.path[i] === square)) {
      mover = partial.piece;
      hopsShown = partial.shown.length - 1;
      for (const ghost of partial.ghosts) this.setGhost(ghost, false);
    } else {
      if (partial) this.undoPartialNow(partial);
      mover = this.pieceAt(move.from);
    }
    if (!mover) {
      this.snap(board);
      return;
    }

    const isCapture = move.captures.length > 0;
    const victims = move.captures.map((square) => this.pieceAt(square, mover));
    const durations = hopDurations(move.path, isCapture);
    mover.busy = true;

    // Pieces already jumped while the multi-jump was tapped out go now, one after another.
    victims.slice(0, hopsShown).forEach((victim, i) => {
      if (victim) void this.wait(i * 110).then(() => {
          if (!stale()) void this.knockOff(victim);
        });
    });

    for (let i = hopsShown + 1; i < move.path.length; i++) {
      const duration = durations[i - 1];
      const victim = victims[i - 1];
      if (isCapture && victim) {
        void this.wait(duration * 0.52).then(() => {
          if (!stale()) void this.knockOff(victim);
        });
      }
      const distance = squareDistance(move.path[i - 1], move.path[i]);
      await this.hop(mover, move.path[i], duration, hopHeight(distance, isCapture));
      if (stale()) return;
      mover.square = move.path[i];
    }

    if (move.promotes && !mover.king) await this.crown(mover);
    if (stale()) return;
    mover.busy = false;
    this.verify(board);
    // Let the pieces knocked off finish landing before squaring up the piles.
    void this.wait(900).then(() => {
      if (!stale()) this.syncPiles(board);
    });
  }

  /**
   * Shows a multi-jump being tapped out: the piece hops to each square as it's tapped and
   * the pieces it has jumped turn to glass. A shorter (or empty) path takes it back.
   */
  showPartial(path: number[], captured: number[]): void {
    const epoch = this.epoch;
    this.partialChain = this.partialChain.then(() =>
      epoch === this.epoch && !this.disposed ? this.stepPartial(path, captured) : undefined,
    );
  }

  setMarkers(markers: Markers): void {
    this.markers = markers;
    this.markerGroup.clear();
    const tile = (square: number, material: THREE.Material) => {
      const mesh = new THREE.Mesh(this.geo['tile'], material);
      const { x, z } = squareToWorld(square);
      mesh.position.set(x, 0.006, z);
      this.markerGroup.add(mesh);
    };
    for (const square of markers.lastMove) tile(square, this.mat['lastMove']);
    for (const square of markers.path.slice(1)) tile(square, this.mat['path']);
    if (markers.selected !== null) tile(markers.selected, this.mat['selected']);

    markers.dots.forEach((square, i) => {
      const { x, z } = squareToWorld(square);
      const dot = new THREE.Group();
      dot.position.set(x, 0.2, z);
      dot.userData = { kind: 'dot', phase: i * 0.7 };
      dot.add(new THREE.Mesh(this.geo['dot'], this.mat['dot']));
      const glow = new THREE.Sprite(this.mat['dotGlow'] as THREE.SpriteMaterial);
      glow.scale.setScalar(0.75);
      dot.add(glow);
      this.markerGroup.add(dot);
    });
    markers.rings.forEach((square, i) => {
      const { x, z } = squareToWorld(square);
      const ring = new THREE.Mesh(this.geo['ring'], this.mat['captureRing']);
      ring.position.set(x, 0.05, z);
      ring.userData = { kind: 'ring', phase: i * 0.9 };
      this.markerGroup.add(ring);
      const glow = new THREE.Sprite(this.mat['ringGlow'] as THREE.SpriteMaterial);
      glow.position.set(x, 0.2, z);
      glow.scale.setScalar(1.1);
      this.markerGroup.add(glow);
    });
    for (const square of markers.compulsory) {
      const { x, z } = squareToWorld(square);
      const ring = new THREE.Mesh(this.geo['bigRing'], this.mat['compulsory']);
      ring.position.set(x, 0.03, z);
      ring.userData = { kind: 'pulse', phase: square };
      this.markerGroup.add(ring);
    }
  }

  /** The keyboard's square (from the hidden square buttons), or null when the board isn't focused. */
  setFocus(square: number | null): void {
    this.focusFrame.visible = square !== null;
    if (square !== null) {
      const { x, z } = squareToWorld(square);
      this.focusFrame.position.set(x, 0.012, z);
    }
  }

  /** Which side of the table to look from. Sweeps the camera round. */
  setViewSide(side: Side, animate = true): void {
    if (side === this.viewSide && animate) return;
    this.viewSide = side;
    void this.sweep({ theta: this.restTheta() }, animate ? 1500 : 0);
  }

  /** Back to the view from the current side, after the player has orbited or zoomed. */
  resetView(): void {
    void this.sweep({ theta: this.restTheta(), phi: this.tilt(), radius: this.fit() }, 900);
  }

  /** The camera swoops down onto the table from high above. */
  intro(): void {
    const theta = this.restTheta();
    this.placeCamera(theta - 1.25, 0.12, this.fit() * 1.75);
    void this.sweep({ theta, phi: this.tilt(), radius: this.fit() }, 2600);
  }

  setMood(mood: Mood): void {
    this.lanternTarget = mood === 'loss' ? 0.18 : mood === 'win' ? 1.35 : 1;
    if (mood === 'win') this.startPetals();
    if (mood === null) this.clearPetals();
  }

  /** Nothing is moving: no piece, no camera sweep. A testability hook for e2e tests to wait on. */
  idle(): boolean {
    return this.tweens.length === 0;
  }

  /** Where a square appears on screen, in client coordinates. A testability hook for e2e tests. */
  project(square: number): { x: number; y: number } {
    const { x, z } = squareToWorld(square);
    const point = new THREE.Vector3(x, 0.12, z).project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + ((point.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - point.y) / 2) * rect.height,
    };
  }

  dispose(): void {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerleave', this.onPointerLeave);
    this.controls.dispose();
    for (const tween of this.tweens) tween.resolve();
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.Sprite) {
        object.geometry.dispose();
      }
    });
    for (const material of [...Object.values(this.mat), ...this.ghostOf.values()]) material.dispose();
    for (const texture of this.textures) texture.dispose();
    this.scene.environment?.dispose();
    this.sparks.dispose();
    this.dust.dispose();
    this.renderer.dispose();
    canvas.remove();
  }

  // ---------------------------------------------------------------------------------------
  // Building the scene.

  private keep<T extends THREE.Texture>(texture: T): T {
    this.textures.push(texture);
    return texture;
  }

  private buildMaterials(): void {
    const disc = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(0.34, 0),
      new THREE.Vector2(0.385, 0.018),
      new THREE.Vector2(0.4, 0.06),
      new THREE.Vector2(0.4, 0.17),
      new THREE.Vector2(0.386, 0.212),
      new THREE.Vector2(0.352, 0.238),
      new THREE.Vector2(0.31, DISC_HEIGHT),
      new THREE.Vector2(0.292, 0.236),
      new THREE.Vector2(0.272, DISC_HEIGHT),
      new THREE.Vector2(0, DISC_HEIGHT),
    ];
    this.geo['disc'] = new THREE.LatheGeometry(disc, 48);
    this.geo['rim'] = new THREE.TorusGeometry(0.352, 0.013, 8, 48).rotateX(Math.PI / 2).translate(0, 0.236, 0);
    this.geo['motif'] = new THREE.CircleGeometry(0.27, 48).rotateX(-Math.PI / 2).translate(0, DISC_HEIGHT + 0.0015, 0);
    this.geo['star'] = starGeometry();
    this.geo['tile'] = new THREE.PlaneGeometry(0.96, 0.96).rotateX(-Math.PI / 2);
    this.geo['frame'] = new THREE.RingGeometry(0.47, 0.56, 4, 1, Math.PI / 4).rotateX(-Math.PI / 2);
    this.geo['dot'] = new THREE.SphereGeometry(0.085, 16, 12);
    this.geo['ring'] = new THREE.TorusGeometry(0.36, 0.035, 10, 48).rotateX(Math.PI / 2);
    this.geo['bigRing'] = new THREE.TorusGeometry(0.46, 0.028, 8, 48).rotateX(Math.PI / 2);

    const glow = this.keep(glowTexture());
    const glaze = { roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1 };
    this.mat['lightBody'] = new THREE.MeshPhysicalMaterial({ color: COLORS.light, ...glaze });
    this.mat['darkBody'] = new THREE.MeshPhysicalMaterial({ color: COLORS.dark, ...glaze, roughness: 0.26 });
    this.mat['gold'] = new THREE.MeshStandardMaterial({ color: COLORS.gold, metalness: 1, roughness: 0.25 });
    this.mat['cobalt'] = new THREE.MeshStandardMaterial({ color: COLORS.cobalt, roughness: 0.35 });
    const motif = (color: string) =>
      new THREE.MeshStandardMaterial({
        map: this.keep(pieceMotifTexture(color)),
        transparent: true,
        depthWrite: false,
        roughness: 0.3,
        metalness: color === COLORS.gold ? 0.8 : 0,
      });
    this.mat['lightMotif'] = motif(COLORS.cobalt);
    this.mat['darkMotif'] = motif(COLORS.gold);
    this.mat['star'] = new THREE.MeshStandardMaterial({
      color: '#f2c75c',
      metalness: 1,
      roughness: 0.2,
      emissive: '#8a5200',
      emissiveIntensity: 0.7,
    });
    this.mat['starGlow'] = new THREE.SpriteMaterial({
      map: glow,
      color: '#ffcf6a',
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.55,
    });

    const flat = (color: string, opacity: number) =>
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
    this.mat['lastMove'] = flat('#ffb43a', 0.2);
    this.mat['path'] = flat(COLORS.saffron, 0.35);
    this.mat['selected'] = flat('#ffd36b', 0.42);
    this.mat['hover'] = flat('#ffffff', 0.12);
    this.mat['focus'] = flat(COLORS.focus, 0.95);
    this.mat['dot'] = new THREE.MeshBasicMaterial({ color: '#ffd97a' });
    this.mat['captureRing'] = new THREE.MeshBasicMaterial({ color: COLORS.ember });
    this.mat['compulsory'] = flat(COLORS.saffron, 0.9);
    const sprite = (color: string, opacity: number) =>
      new THREE.SpriteMaterial({ map: glow, color, blending: THREE.AdditiveBlending, depthWrite: false, opacity });
    this.mat['dotGlow'] = sprite('#ffb020', 0.9);
    this.mat['ringGlow'] = sprite(COLORS.ember, 0.6);
    this.mat['lanternGlow'] = sprite('#ff9d3a', 0.75);
  }

  private buildWorld(): void {
    this.scene.background = this.keep(skyTexture());
    this.scene.fog = new THREE.Fog('#0a0716', 30, 62);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.32;
    pmrem.dispose();

    // The floor, a carpet of deep red fading into the night.
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(60, 64).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: '#2a0d10', roughness: 0.95 }),
    );
    floor.position.y = TRAY_Y - 0.45;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // The brass tea tray the board stands on, on a low cedar table.
    const brass = new THREE.MeshStandardMaterial({ map: this.keep(brassTexture()), metalness: 0.85, roughness: 0.36 });
    const tray = new THREE.Mesh(new THREE.CircleGeometry(12.5, 96).rotateX(-Math.PI / 2), brass);
    tray.position.y = TRAY_Y;
    tray.receiveShadow = true;
    const lip = new THREE.Mesh(
      new THREE.TorusGeometry(12.5, 0.14, 12, 128).rotateX(Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: '#b98a3c', metalness: 0.9, roughness: 0.3 }),
    );
    lip.position.y = TRAY_Y;
    const table = new THREE.Mesh(
      new THREE.CylinderGeometry(12.7, 12.2, 0.45, 64),
      new THREE.MeshStandardMaterial({ map: this.keep(woodTexture()), roughness: 0.7 }),
    );
    table.position.y = TRAY_Y - 0.23;
    table.receiveShadow = true;
    this.scene.add(tray, lip, table);

    // The board: a cedar box, its zellige-and-cedar top, and the squares on that.
    const wood = this.keep(woodTexture());
    wood.repeat.set(3, 1);
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(FRAME_HALF * 2, BOARD_HEIGHT, FRAME_HALF * 2),
      new THREE.MeshStandardMaterial({ map: wood, roughness: 0.6 }),
    );
    box.position.y = -BOARD_HEIGHT / 2;
    box.castShadow = true;
    box.receiveShadow = true;
    const top = new THREE.Mesh(
      new THREE.PlaneGeometry(FRAME_HALF * 2, FRAME_HALF * 2).rotateX(-Math.PI / 2),
      new THREE.MeshPhysicalMaterial({ map: this.keep(frameTexture()), roughness: 0.5, clearcoat: 0.6 }),
    );
    top.position.y = 0.001;
    top.receiveShadow = true;
    const squares = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 10).rotateX(-Math.PI / 2),
      new THREE.MeshPhysicalMaterial({
        map: this.keep(squaresTexture()),
        roughness: 0.42,
        clearcoat: 0.8,
        clearcoatRoughness: 0.2,
      }),
    );
    squares.position.y = 0.003;
    squares.receiveShadow = true;
    this.scene.add(box, top, squares);

    this.buildTeaSet();
    this.buildLantern();
    this.buildStars();
  }

  /** A silver teapot, steaming, and three glasses of mint tea on the tray. */
  private buildTeaSet(): void {
    const size = 0.62;
    const teapotGeometry = new TeapotGeometry(size, 12);
    teapotGeometry.computeBoundingBox();
    const bottom = teapotGeometry.boundingBox?.min.y ?? -size;
    const teapot = new THREE.Mesh(
      teapotGeometry,
      new THREE.MeshStandardMaterial({ color: '#d9d9e2', metalness: 1, roughness: 0.18 }),
    );
    teapot.position.set(8.4, TRAY_Y - bottom, -5.8);
    teapot.rotation.y = -2.4;
    teapot.castShadow = true;
    this.scene.add(teapot);
    // The spout's tip, where the steam comes from: +x in the teapot's own frame.
    this.teapotSpout.set(size * 1.75, size * 0.55, 0).applyEuler(teapot.rotation).add(teapot.position);

    const glassProfile = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(0.17, 0),
      new THREE.Vector2(0.18, 0.04),
      new THREE.Vector2(0.2, 0.3),
      new THREE.Vector2(0.235, 0.62),
      new THREE.Vector2(0.225, 0.63),
      new THREE.Vector2(0.19, 0.31),
      new THREE.Vector2(0.165, 0.05),
      new THREE.Vector2(0, 0.05),
    ];
    const glassGeometry = new THREE.LatheGeometry(glassProfile, 32);
    const glass = new THREE.MeshPhysicalMaterial({
      color: '#ffffff',
      roughness: 0.05,
      metalness: 0,
      transparent: true,
      opacity: 0.28,
      clearcoat: 1,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const teaGeometry = new THREE.CylinderGeometry(0.205, 0.165, 0.42, 24).translate(0, 0.26, 0);
    const tea = new THREE.MeshStandardMaterial({ color: '#b3661c', roughness: 0.15, transparent: true, opacity: 0.88 });
    const band = new THREE.TorusGeometry(0.218, 0.012, 6, 32).rotateX(Math.PI / 2).translate(0, 0.46, 0);
    const leaf = new THREE.SphereGeometry(0.07, 8, 6).scale(1, 0.5, 1.6);
    const mint = new THREE.MeshStandardMaterial({ color: '#2f7a3a', roughness: 0.6 });
    for (const [x, z] of [
      [7.2, -7.6],
      [9.4, -4.4],
      [6.6, -6.4],
    ]) {
      const cup = new THREE.Group();
      cup.add(new THREE.Mesh(teaGeometry, tea));
      cup.add(new THREE.Mesh(glassGeometry, glass));
      cup.add(new THREE.Mesh(band, this.mat['gold']));
      const sprig = new THREE.Mesh(leaf, mint);
      sprig.position.set(0.06, 0.5, 0.02);
      sprig.rotation.set(0.4, x, 0.3);
      cup.add(sprig);
      cup.position.set(x, TRAY_Y, z);
      cup.children[0].castShadow = true;
      this.scene.add(cup);
    }
  }

  /** A hanging brass lantern, its glass glowing through a cut-out star lattice. */
  private buildLantern(): void {
    const lattice = this.keep(latticeTexture());
    lattice.wrapS = THREE.RepeatWrapping;
    lattice.repeat.set(2, 1);
    const brass = new THREE.MeshStandardMaterial({ color: '#b58a3e', metalness: 0.9, roughness: 0.35 });
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.42, 1.1, 8, 1, true),
      new THREE.MeshStandardMaterial({
        color: '#2b1c0b',
        emissive: '#ffa64a',
        emissiveMap: lattice,
        emissiveIntensity: 2.4,
        metalness: 0.6,
        roughness: 0.4,
        side: THREE.DoubleSide,
      }),
    );
    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.62, 0.6, 8), brass);
    roof.position.y = 0.85;
    const finial = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), brass);
    finial.position.y = 1.2;
    const base = new THREE.Mesh(new THREE.ConeGeometry(0.44, 0.38, 8).rotateX(Math.PI), brass);
    base.position.y = -0.74;
    const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 9, 6), brass);
    chain.position.y = 5.7;
    const glow = new THREE.Sprite(this.mat['lanternGlow'] as THREE.SpriteMaterial);
    glow.scale.setScalar(3.4);
    this.lantern.add(body, roof, finial, base, chain, glow);
    this.lantern.position.copy(LANTERN);
    this.scene.add(this.lantern);
  }

  private buildStars(): void {
    const count = 700;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 0.92);
      positions[i * 3] = 80 * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = 80 * Math.cos(phi) - 6;
      positions[i * 3 + 2] = 80 * Math.sin(phi) * Math.sin(theta);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const stars = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({ color: '#fff6dd', size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85 }),
    );
    this.scene.add(stars);
  }

  private buildLights(): { light: THREE.PointLight; spot: THREE.SpotLight } {
    this.scene.add(new THREE.HemisphereLight('#6f6cc0', '#3a2414', 0.55));

    const moon = new THREE.DirectionalLight('#c8d2ff', 1.15);
    moon.position.set(6, 15, 9);
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    const range = 9.5;
    Object.assign(moon.shadow.camera, { left: -range, right: range, top: range, bottom: -range, near: 1, far: 40 });
    moon.shadow.bias = -0.0004;
    moon.shadow.normalBias = 0.02;
    this.scene.add(moon);

    const light = new THREE.PointLight('#ffb05a', 42, 28, 2);
    light.position.copy(LANTERN);
    this.scene.add(light);

    // Light through the lantern's lattice: stars of light scattered over the table.
    const spot = new THREE.SpotLight('#ffbf73', 150, 30, 0.72, 0.55, 2);
    spot.position.copy(LANTERN).add(new THREE.Vector3(0, -0.3, 0));
    spot.target.position.set(1.8, 0, 0.4);
    spot.map = this.keep(latticeTexture());
    spot.castShadow = true;
    spot.shadow.mapSize.set(1024, 1024);
    spot.shadow.bias = -0.0005;
    this.scene.add(spot, spot.target);
    return { light, spot };
  }

  /**
   * Low-power mode: glazes, metals and clearcoats become plain matte materials, and the
   * lantern's lattice light goes (its spotlight is the costliest light in the scene).
   */
  private simplify(): void {
    const cheap = new Map<THREE.Material, THREE.Material>();
    const swap = (material: THREE.Material): THREE.Material => {
      if (!(material instanceof THREE.MeshStandardMaterial)) return material;
      let simple = cheap.get(material);
      if (!simple) {
        simple = new THREE.MeshLambertMaterial({
          color: material.color,
          map: material.map,
          emissive: material.emissive,
          emissiveMap: material.emissiveMap,
          emissiveIntensity: material.emissiveIntensity,
          transparent: material.transparent,
          opacity: material.opacity,
          depthWrite: material.depthWrite,
          side: material.side,
        });
        cheap.set(material, simple);
      }
      return simple;
    };
    for (const key of Object.keys(this.mat)) this.mat[key] = swap(this.mat[key]);
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) object.material = swap(object.material as THREE.Material);
      // Without reflections of the environment, the hemisphere light has to fill in for it.
      if (object instanceof THREE.HemisphereLight) {
        object.color.set('#c9c3e6');
        object.intensity = 1.6;
      }
    });
    this.scene.environment = null;
    this.spot.visible = false;
  }

  // ---------------------------------------------------------------------------------------
  // Pieces.

  private disc(side: Side): THREE.Group {
    const group = new THREE.Group();
    const body = new THREE.Mesh(this.geo['disc'], this.mat[side === LIGHT ? 'lightBody' : 'darkBody']);
    body.castShadow = true;
    body.receiveShadow = true;
    const rim = new THREE.Mesh(this.geo['rim'], this.mat[side === LIGHT ? 'cobalt' : 'gold']);
    const motif = new THREE.Mesh(this.geo['motif'], this.mat[side === LIGHT ? 'lightMotif' : 'darkMotif']);
    group.add(body, rim, motif);
    return group;
  }

  private addPiece(side: Side, square: number, king: boolean): Piece {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    body.add(this.disc(side));
    const { x, z } = squareToWorld(square);
    root.position.set(x, 0, z);
    const piece: Piece = { side, square, king: false, root, body, star: null, busy: false };
    if (king) this.makeKing(piece, this.disc(side));
    this.scene.add(root);
    this.pieces.push(piece);
    return piece;
  }

  /** Puts `crown` (a second disc) on the piece and stands the king's gold star on top. */
  private makeKing(piece: Piece, crown: THREE.Object3D): THREE.Object3D {
    crown.position.set(0, DISC_HEIGHT, 0);
    crown.rotation.set(0, 0, 0);
    crown.scale.setScalar(1);
    piece.body.add(crown);
    const star = new THREE.Group();
    const mesh = new THREE.Mesh(this.geo['star'], this.mat['star']);
    mesh.castShadow = true;
    const glow = new THREE.Sprite(this.mat['starGlow'] as THREE.SpriteMaterial);
    glow.scale.setScalar(0.9);
    star.add(mesh, glow);
    star.position.set(0, DISC_HEIGHT * 2 + 0.26, 0);
    piece.body.add(star);
    piece.star = star;
    piece.king = true;
    return star;
  }

  private pieceAt(square: number, except?: Piece): Piece | undefined {
    return this.pieces.find((p) => p.square === square && p !== except);
  }

  private setGhost(piece: Piece, ghost: boolean): void {
    piece.root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const base = (object.userData['base'] as THREE.Material | undefined) ?? (object.material as THREE.Material);
      object.userData['base'] = base;
      object.material = ghost ? this.ghostMaterial(base) : base;
      object.castShadow = !ghost && object.geometry === this.geo['disc'];
    });
  }

  private ghostMaterial(base: THREE.Material): THREE.Material {
    let ghost = this.ghostOf.get(base);
    if (!ghost) {
      ghost = base.clone();
      ghost.transparent = true;
      ghost.opacity = 0.25;
      ghost.depthWrite = false;
      this.ghostOf.set(base, ghost);
    }
    return ghost;
  }

  /** The discs on the piles must match the position: add or take away any that don't. */
  private syncPiles(board: BoardArray): void {
    for (const side of [LIGHT, DARK] as Side[]) {
      const pile = this.piles[side];
      const wanted = capturedDiscs(board, side);
      while (pile.length > wanted) {
        const disc = pile.pop();
        if (disc) this.scene.remove(disc);
      }
      while (pile.length < wanted) {
        const disc = this.disc(side);
        placeOnPile(disc, side, pile.length);
        this.scene.add(disc);
        pile.push(disc);
      }
      pile.forEach((disc, i) => {
        if (disc === null) {
          const fresh = this.disc(side);
          placeOnPile(fresh, side, i);
          this.scene.add(fresh);
          pile[i] = fresh;
        }
      });
    }
  }

  /** If the pieces drawn don't match the real position (they always should), snap to it. */
  private verify(board: BoardArray): void {
    const shown = this.pieces.map((p) => `${p.square}:${p.side}:${p.king}`).sort().join();
    const real: string[] = [];
    board.forEach((cell, square) => {
      if (cell !== 0) real.push(`${square}:${Math.sign(cell)}:${Math.abs(cell) === 2}`);
    });
    if (shown !== real.sort().join()) this.snap(board);
  }

  // ---------------------------------------------------------------------------------------
  // Animations.

  private reducedMotion(): boolean {
    return this.reducedMotionQuery?.matches ?? false;
  }

  /** Runs `step(t)` every frame for `duration` ms, t from 0 to 1. Resolves at the end. */
  private tween(duration: number, step: (t: number) => void, camera = false): Promise<void> {
    if (duration <= 0 || this.reducedMotion()) {
      step(1);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.tweens.push({ start: null, duration, step, resolve, camera });
    });
  }

  private wait(ms: number): Promise<void> {
    return this.tween(ms, () => undefined);
  }

  /**
   * One hop: the piece leans into the direction it's going, arcs up and over, and lands with
   * a little squash and a puff of dust.
   */
  private async hop(piece: Piece, square: number, duration: number, height: number): Promise<void> {
    const epoch = this.epoch;
    const from = piece.root.position.clone();
    const to = squareToWorld(square);
    const axis = new THREE.Vector3(to.z - from.z, 0, -(to.x - from.x)).normalize();
    const flight = duration * 0.78;
    await this.tween(flight, (t) => {
      const e = easeInOutCubic(t);
      const arc = Math.sin(Math.PI * t);
      piece.root.position.set(
        from.x + (to.x - from.x) * e,
        from.y * (1 - e) + height * 4 * t * (1 - t),
        from.z + (to.z - from.z) * e,
      );
      piece.body.quaternion.setFromAxisAngle(axis, 0.34 * Math.sin(Math.PI * Math.min(1, t * 1.15)));
      piece.body.scale.set(1 - 0.05 * arc, 1 + 0.1 * arc, 1 - 0.05 * arc);
    });
    if (epoch !== this.epoch) return;
    piece.body.quaternion.identity();
    this.dust.emit({
      count: 16,
      x: to.x,
      y: 0.04,
      z: to.z,
      speed: 1.3,
      flat: 1,
      spread: 0.55,
      drag: 0.02,
      life: 0.7,
      size: 0.22,
      colors: ['#d8c19a', '#a88c62', '#efe1c4'],
      alpha: 0.5,
    });
    await this.tween(duration - flight, (t) => {
      const squash = Math.sin(Math.PI * t);
      piece.body.scale.set(1 + 0.12 * squash, 1 - 0.2 * squash, 1 + 0.12 * squash);
    });
  }

  /**
   * A jumped piece is knocked off the board: a burst of shards, a jolt of the camera, and it
   * tumbles through the air onto its colour's pile beside the board.
   */
  private async knockOff(victim: Piece): Promise<void> {
    const epoch = this.epoch;
    this.pieces = this.pieces.filter((p) => p !== victim);
    this.setGhost(victim, false);
    victim.busy = true;
    const from = victim.root.position.clone();
    const discs = victim.king ? 2 : 1;
    const pile = this.piles[victim.side];
    const index = pile.length;
    for (let i = 0; i < discs; i++) pile.push(null);
    const slot = pileSlot(victim.side, index);

    const shards = victim.side === LIGHT ? [COLORS.light, '#ffffff', COLORS.cobalt] : [COLORS.dark, '#5b74e0', COLORS.gold];
    this.sparks.emit({ count: 46, x: from.x, y: 0.2, z: from.z, speed: 3.4, lift: 1.6, gravity: 7, drag: 0.4, life: 0.85, size: 0.12, colors: [...shards, '#ffd27a'] });
    this.dust.emit({ count: 22, x: from.x, y: 0.1, z: from.z, speed: 1.8, flat: 0.7, drag: 0.03, life: 0.9, size: 0.3, colors: ['#d8c19a', '#bfa47c'], alpha: 0.45 });
    this.shake = Math.max(this.shake, victim.king ? 0.2 : 0.11);

    const spinX = (Math.random() > 0.5 ? 1 : -1) * Math.PI * 4;
    const spinZ = (Math.random() - 0.5) * Math.PI * 2;
    const peak = 2.4 + Math.random() * 0.8;
    await this.tween(780, (t) => {
      const e = easeInOutCubic(t);
      victim.root.position.set(
        from.x + (slot.x - from.x) * e,
        from.y + (slot.y - from.y) * t + peak * 4 * t * (1 - t),
        from.z + (slot.z - from.z) * e,
      );
      victim.body.rotation.set(spinX * e, slot.turn * e, spinZ * e);
    });
    this.scene.remove(victim.root);
    if (epoch !== this.epoch) return;

    // On the pile it's just discs: a captured king is two.
    for (let i = 0; i < discs; i++) {
      if (pile[index + i] !== null) continue;
      const disc = this.disc(victim.side);
      placeOnPile(disc, victim.side, index + i);
      this.scene.add(disc);
      pile[index + i] = disc;
    }
    this.dust.emit({ count: 10, x: slot.x, y: slot.y + 0.05, z: slot.z, speed: 0.9, flat: 1, drag: 0.02, life: 0.5, size: 0.18, colors: ['#e8d3a8'], alpha: 0.4 });
  }

  /**
   * Promotion, done the way it's done at a real board: one of the player's own captured
   * pieces is taken off the pile and put on top. (If none has been captured yet, a crown
   * disc drops from above.) Then the star rises out of it in a shower of gold.
   */
  private async crown(piece: Piece): Promise<void> {
    const epoch = this.epoch;
    const pile = this.piles[piece.side];
    let disc: THREE.Object3D;
    const from = new THREE.Vector3();
    const top = pile[pile.length - 1];
    if (top) {
      pile.pop();
      disc = top;
      from.copy(disc.position);
    } else {
      disc = this.disc(piece.side);
      from.set(piece.root.position.x, 4, piece.root.position.z);
      this.scene.add(disc);
    }
    const to = piece.root.position.clone().add(new THREE.Vector3(0, DISC_HEIGHT, 0));
    const startTurn = disc.rotation.y;
    await this.tween(700, (t) => {
      const e = easeInOutCubic(t);
      disc.position.set(
        from.x + (to.x - from.x) * e,
        from.y + (to.y - from.y) * e + 1.8 * Math.sin(Math.PI * t),
        from.z + (to.z - from.z) * e,
      );
      disc.rotation.set((1 - e) * Math.PI * 2, startTurn * (1 - e), 0);
    });
    this.scene.remove(disc);
    if (epoch !== this.epoch) return;

    const star = this.makeKing(piece, disc);
    star.scale.setScalar(0.001);
    this.sparks.emit({ count: 70, x: to.x, y: 0.6, z: to.z, speed: 2.4, lift: 2.6, gravity: 3, drag: 0.35, life: 1.3, size: 0.12, colors: ['#ffd65c', '#ffb02e', '#fff2b8'] });
    this.sparks.emit({ count: 40, x: to.x, y: 0.05, z: to.z, speed: 2.2, flat: 1, drag: 0.1, life: 0.8, size: 0.1, colors: ['#ffd65c'] });
    await this.tween(650, (t) => {
      star.scale.setScalar(Math.max(0.001, easeOutBack(t)));
      piece.body.rotation.y = easeInOutCubic(t) * Math.PI * 2;
      piece.root.position.y = 0.35 * Math.sin(Math.PI * t);
    });
    piece.body.rotation.y = 0;
    piece.root.position.y = 0;
  }

  private async stepPartial(path: number[], captured: number[]): Promise<void> {
    let partial = this.partial;
    const consistent = partial !== null && partial.shown.every((square, i) => path[i] === square);
    if (partial && (path.length <= 1 || !consistent)) {
      await this.undoPartial(partial);
      partial = null;
    }
    if (path.length <= 1) return;
    if (!partial) {
      const piece = this.pieceAt(path[0]);
      if (!piece) return;
      partial = { piece, shown: [path[0]], ghosts: [] };
      this.partial = partial;
    }
    const epoch = this.epoch;
    const { piece } = partial;
    piece.busy = true;
    for (let i = partial.shown.length; i < path.length; i++) {
      const victim = this.pieceAt(captured[i - 1], piece);
      const [duration] = hopDurations([path[i - 1], path[i]], true);
      if (victim) {
        partial.ghosts.push(victim);
        void this.wait(duration * 0.5).then(() => {
          if (epoch === this.epoch) this.setGhost(victim, true);
        });
      }
      await this.hop(piece, path[i], duration, hopHeight(squareDistance(path[i - 1], path[i]), true));
      if (epoch !== this.epoch) return;
      piece.square = path[i];
      partial.shown.push(path[i]);
    }
    piece.busy = false;
  }

  /** The multi-jump tapped so far was abandoned: hop the piece back, and the jumped pieces return. */
  private async undoPartial(partial: Partial): Promise<void> {
    this.partial = null;
    const origin = partial.shown[0];
    partial.piece.busy = true;
    await this.hop(partial.piece, origin, 420, 0.7);
    partial.piece.square = origin;
    partial.piece.busy = false;
    for (const ghost of partial.ghosts) this.setGhost(ghost, false);
  }

  private undoPartialNow(partial: Partial): void {
    const { x, z } = squareToWorld(partial.shown[0]);
    partial.piece.root.position.set(x, 0, z);
    partial.piece.square = partial.shown[0];
    partial.piece.busy = false;
    for (const ghost of partial.ghosts) this.setGhost(ghost, false);
  }

  // ---------------------------------------------------------------------------------------
  // Petals, for the winner.

  private startPetals(): void {
    if (this.reducedMotion()) return;
    this.clearPetals();
    const texture = this.keep(petalTexture());
    const geometry = new THREE.PlaneGeometry(0.24, 0.24);
    const material = new THREE.MeshStandardMaterial({ map: texture, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.7 });
    const petals = new THREE.InstancedMesh(geometry, material, PETAL_COUNT);
    petals.castShadow = true;
    petals.frustumCulled = false;
    const color = new THREE.Color();
    this.petalState = [];
    for (let i = 0; i < PETAL_COUNT; i++) {
      color.setHSL(0.95 + Math.random() * 0.06, 0.65 + Math.random() * 0.25, 0.42 + Math.random() * 0.25);
      petals.setColorAt(i, color);
      this.petalState.push({
        position: new THREE.Vector3((Math.random() - 0.5) * 17, 9 + Math.random() * 6, (Math.random() - 0.5) * 17),
        velocity: 0.9 + Math.random() * 0.7,
        sway: 0.4 + Math.random() * 0.8,
        phase: Math.random() * Math.PI * 2,
        spin: new THREE.Euler(Math.random() * 3, Math.random() * 3, Math.random() * 3),
        rotation: new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6),
        delay: Math.random() * 3.5,
        landed: false,
      });
    }
    this.petals = petals;
    this.updatePetals(0);
    this.scene.add(petals);
  }

  private clearPetals(): void {
    if (!this.petals) return;
    this.scene.remove(this.petals);
    this.petals.geometry.dispose();
    (this.petals.material as THREE.Material).dispose();
    this.petals.dispose();
    this.petals = null;
    this.petalState = [];
  }

  private updatePetals(dt: number): void {
    const petals = this.petals;
    if (!petals) return;
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);
    this.petalState.forEach((petal, i) => {
      if (petal.delay > 0) {
        petal.delay -= dt;
        scale.setScalar(petal.delay > 0 ? 0 : 1);
      } else if (!petal.landed) {
        scale.setScalar(1);
        petal.position.y -= petal.velocity * dt;
        petal.position.x += Math.sin(this.elapsed * petal.sway * 2 + petal.phase) * dt * 0.6;
        petal.position.z += Math.cos(this.elapsed * petal.sway * 1.6 + petal.phase) * dt * 0.4;
        petal.rotation.x += petal.spin.x * dt;
        petal.rotation.y += petal.spin.y * dt;
        petal.rotation.z += petal.spin.z * dt;
        const ground = groundHeight(petal.position.x, petal.position.z);
        if (petal.position.y <= ground) {
          petal.position.y = ground + 0.012;
          petal.rotation.set(-Math.PI / 2, 0, petal.phase);
          petal.landed = true;
        }
      } else {
        scale.setScalar(1);
      }
      quaternion.setFromEuler(petal.rotation);
      matrix.compose(petal.position, quaternion, scale);
      petals.setMatrixAt(i, matrix);
    });
    petals.instanceMatrix.needsUpdate = true;
  }

  // ---------------------------------------------------------------------------------------
  // Camera.

  private restTheta(): number {
    return this.viewSide === LIGHT ? 0 : Math.PI;
  }

  private fit(): number {
    return fitDistance(CAMERA_FOV, Math.max(0.5, this.camera.aspect));
  }

  private tilt(): number {
    return cameraTilt(this.camera.aspect);
  }

  private placeCamera(theta: number, phi: number, radius: number): void {
    const offset = new THREE.Vector3().setFromSphericalCoords(radius, phi, theta);
    this.camera.position.copy(TARGET).add(offset);
    this.camera.lookAt(TARGET);
  }

  /**
   * Swings the camera round to `to`. A newer sweep takes over from one still running, and a
   * resize part-way through (entering full screen, turning a phone) re-aims it at the rest
   * framing for the new shape, rather than ending at the framing for the old one.
   */
  private async sweep(to: { theta: number; phi?: number; radius?: number }, duration: number): Promise<void> {
    const start = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(TARGET));
    const turn = shortestTurn(start.theta, to.theta);
    const target = { phi: to.phi ?? start.phi, radius: to.radius ?? start.radius };
    const id = ++this.sweepId;
    this.sweepTarget = target;
    this.sweeping = true;
    this.controls.enabled = false;
    await this.tween(duration, (t) => {
      if (id !== this.sweepId) return;
      const e = easeInOutCubic(t);
      this.placeCamera(
        start.theta + turn * e,
        start.phi + (target.phi - start.phi) * e,
        start.radius + (target.radius - start.radius) * e,
      );
    }, true);
    if (this.disposed || id !== this.sweepId) return;
    this.sweeping = false;
    this.sweepTarget = null;
    this.controls.enabled = true;
    this.controls.update();
  }

  private resize(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width === 0 || height === 0) return;
    // Low-power mode draws at most about half a megapixel (a full-screen board would be
    // twice that) and lets the browser scale it up.
    if (this.lowPower) this.renderer.setPixelRatio(Math.min(1, Math.sqrt(LOW_POWER_PIXELS / (width * height))));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    const fit = this.fit();
    this.controls.minDistance = fit * 0.55;
    this.controls.maxDistance = fit * 1.4;
    if (this.sweepTarget) Object.assign(this.sweepTarget, { phi: this.tilt(), radius: fit });
    else this.placeCamera(new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(TARGET)).theta, this.tilt(), fit);
    const scale = this.renderer.getDrawingBufferSize(new THREE.Vector2()).y / (2 * Math.tan((CAMERA_FOV * Math.PI) / 360));
    this.sparks.setScale(scale);
    this.dust.setScale(scale);
  }

  // ---------------------------------------------------------------------------------------
  // Input.

  private squareAt(clientX: number, clientY: number): number | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.ray.intersectPlane(this.pickPlane, new THREE.Vector3());
    return hit ? worldToSquare(hit.x, hit.z) : null;
  }

  private readonly onPointerDown = (event: PointerEvent) => {
    this.pointerDown = { x: event.clientX, y: event.clientY, time: performance.now() };
  };

  /** A tap is a press that hardly moved: anything more was the player turning the camera. */
  private readonly onPointerUp = (event: PointerEvent) => {
    const down = this.pointerDown;
    this.pointerDown = null;
    if (!down) return;
    const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
    if (moved > 8 || performance.now() - down.time > 700) return;
    const square = this.squareAt(event.clientX, event.clientY);
    if (square !== null) this.onTap(square);
  };

  private readonly onPointerMove = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return;
    const square = this.squareAt(event.clientX, event.clientY);
    this.hoverTile.visible = square !== null;
    this.renderer.domElement.style.cursor = square !== null ? 'pointer' : 'grab';
    if (square !== null) {
      const { x, z } = squareToWorld(square);
      this.hoverTile.position.set(x, 0.008, z);
    }
  };

  private readonly onPointerLeave = () => {
    this.hoverTile.visible = false;
  };

  // ---------------------------------------------------------------------------------------
  // The render loop.

  private frame(): void {
    const now = performance.now();
    const idle = this.tweens.length === 0 && !this.petals && this.shake <= 0.002;
    if (this.lowPower && idle && now - this.lastRender < LOW_POWER_IDLE_MS) return;
    this.lastRender = now;
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.elapsed += dt;
    const time = this.elapsed;

    const tweens = this.tweens;
    for (const tween of [...tweens]) {
      tween.start ??= now;
      const t = Math.min(1, (now - tween.start) / tween.duration);
      tween.step(t);
      if (t >= 1) {
        this.tweens.splice(this.tweens.indexOf(tween), 1);
        tween.resolve();
      }
    }

    // The selected piece (or the one part-way through a multi-jump) floats and bobs.
    const lifted = this.partial?.piece ?? (this.markers.selected === null ? undefined : this.pieceAt(this.markers.selected));
    for (const piece of this.pieces) {
      if (piece.star) piece.star.rotation.y += dt * 1.4;
      if (piece.busy) continue;
      const target = piece === lifted ? 0.3 + Math.sin(time * 3.2) * 0.04 : 0;
      piece.root.position.y += (target - piece.root.position.y) * Math.min(1, dt * 9);
    }

    for (const marker of this.markerGroup.children) {
      const { kind, phase } = marker.userData as { kind?: string; phase?: number };
      const p = (phase ?? 0) + time;
      if (kind === 'dot') marker.position.y = 0.2 + Math.sin(p * 3.5) * 0.05;
      else if (kind === 'ring') {
        marker.scale.setScalar(1 + Math.sin(p * 5) * 0.07);
        marker.rotation.y = p;
      } else if (kind === 'pulse') marker.scale.setScalar(1 + Math.sin(p * 4) * 0.05);
    }
    (this.mat['compulsory'] as THREE.MeshBasicMaterial).opacity = 0.55 + Math.sin(time * 4) * 0.35;

    // The lantern sways a little and its flame flickers. On a loss it gutters almost out.
    this.lanternLevel += (this.lanternTarget - this.lanternLevel) * Math.min(1, dt * 1.5);
    const flicker = 1 + Math.sin(time * 11) * 0.03 + Math.sin(time * 23.7) * 0.025 + (Math.random() - 0.5) * 0.05;
    const level = this.lanternLevel * flicker;
    this.lanternLight.intensity = 42 * level;
    this.spot.intensity = 150 * level;
    (this.mat['lanternGlow'] as THREE.SpriteMaterial).opacity = 0.75 * Math.min(1.2, level);
    this.lantern.rotation.z = Math.sin(time * 0.7) * 0.035;
    this.lantern.rotation.x = Math.sin(time * 0.53) * 0.025;

    // Steam from the teapot, motes drifting in the lantern light.
    if (Math.random() < dt * 9) {
      this.dust.emit({ count: 1, x: this.teapotSpout.x, y: this.teapotSpout.y, z: this.teapotSpout.z, speed: 0.12, lift: 0.45, spread: 0.08, drag: 0.6, life: 2.6, size: 0.45, colors: ['#ffffff'], alpha: 0.13 });
    }
    if (Math.random() < dt * 3 * this.lanternLevel) {
      this.sparks.emit({ count: 1, x: (Math.random() - 0.5) * 12, y: 0.6 + Math.random() * 4, z: (Math.random() - 0.5) * 12, speed: 0.08, drag: 1, life: 6, size: 0.05, colors: ['#ffd38a', '#ffe9c4'], alpha: 0.7 });
    }
    this.sparks.update(dt);
    this.dust.update(dt);
    this.updatePetals(dt);

    if (!this.sweeping) this.controls.update();
    const shake = new THREE.Vector3();
    if (this.shake > 0.002) {
      shake.set((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
      this.shake *= Math.exp(-dt * 14);
    }
    this.camera.position.add(shake);
    this.renderer.render(this.scene, this.camera);
    this.camera.position.sub(shake);
  }
}

function placeOnPile(disc: THREE.Object3D, side: Side, index: number): void {
  const slot = pileSlot(side, index);
  disc.position.set(slot.x, slot.y, slot.z);
  disc.rotation.set(0, slot.turn, 0);
}

/** Where a falling petal comes to rest: the board, the tray, or the carpet. */
function groundHeight(x: number, z: number): number {
  if (Math.abs(x) < FRAME_HALF && Math.abs(z) < FRAME_HALF) return 0.004;
  if (Math.hypot(x, z) < 12.5) return TRAY_Y;
  return TRAY_Y - 0.45;
}

/** The king's star: an eight-pointed khatam, standing upright, centred on its middle. */
function starGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  for (let i = 0; i < 16; i++) {
    const radius = i % 2 === 0 ? 0.2 : 0.115;
    const angle = (i * Math.PI) / 8 + Math.PI / 2;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.045,
    bevelEnabled: true,
    bevelThickness: 0.014,
    bevelSize: 0.012,
    bevelSegments: 2,
  });
  geometry.center();
  return geometry;
}

/** WebGL running on the CPU rather than a GPU. */
function isSoftwareRenderer(renderer: THREE.WebGLRenderer): boolean {
  const gl = renderer.getContext();
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
}
