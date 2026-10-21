import { CanvasTexture, RepeatWrapping, SRGBColorSpace, Texture } from 'three';

/**
 * Every texture in the scene is drawn here on a canvas at start-up, so the 3D board needs no
 * image files: zellige tiles, cedar and walnut grain, the engraved brass tray, and the star
 * lattice the lantern throws on the table.
 */

const ZELLIGE = ['#1d6b4f', '#1f3f94', '#c4862b', '#f1e8d6', '#8f2d2a'];

function canvas(width: number, height = width): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const element = document.createElement('canvas');
  element.width = width;
  element.height = height;
  const context = element.getContext('2d');
  if (!context) throw new Error('2D canvas unavailable');
  return [element, context];
}

function texture(element: HTMLCanvasElement, color = true): Texture {
  const result = new CanvasTexture(element);
  if (color) result.colorSpace = SRGBColorSpace;
  result.anisotropy = 8;
  return result;
}

/** A small seeded random generator, so the textures look the same every time. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

/** An eight-pointed star (khatam) centred on (x, y): two squares turned 45° to each other. */
function starPath(ctx: CanvasRenderingContext2D, x: number, y: number, outer: number, inner: number): void {
  ctx.beginPath();
  for (let i = 0; i < 16; i++) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = (i * Math.PI) / 8 - Math.PI / 2;
    const px = x + Math.cos(angle) * radius;
    const py = y + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function grain(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, base: string, line: string, rnd: () => number): void {
  ctx.fillStyle = base;
  ctx.fillRect(x, y, w, h);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.strokeStyle = line;
  const lines = Math.max(6, Math.round(h / 7));
  for (let i = 0; i < lines; i++) {
    ctx.globalAlpha = 0.15 + rnd() * 0.3;
    ctx.lineWidth = 0.6 + rnd() * 1.8;
    const offset = y + (i / lines) * h + rnd() * 4;
    const wave = 1 + rnd() * 3;
    const phase = rnd() * 10;
    ctx.beginPath();
    for (let px = x; px <= x + w; px += 6) {
      const py = offset + Math.sin(px / (18 + wave * 6) + phase) * wave;
      if (px === x) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

function speckle(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, colors: string[], count: number, rnd: () => number): void {
  for (let i = 0; i < count; i++) {
    ctx.globalAlpha = 0.1 + rnd() * 0.25;
    ctx.fillStyle = colors[Math.floor(rnd() * colors.length)];
    ctx.fillRect(x + rnd() * w, y + rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  ctx.globalAlpha = 1;
}

/**
 * The 10×10 playing surface, 100 px a square: limestone light squares, walnut dark
 * (playable) squares, with a thin brass inlay between them. Canvas top = the far side
 * (rank 10), so it maps straight onto a plane laid flat.
 */
export function squaresTexture(): Texture {
  const size = 100;
  const [element, ctx] = canvas(size * 10);
  const rnd = random(7);
  for (let py = 0; py < 10; py++) {
    for (let px = 0; px < 10; px++) {
      const row = 9 - py;
      const playable = (row + px) % 2 === 0;
      const x = px * size;
      const y = py * size;
      if (playable) {
        const shade = 30 + Math.floor(rnd() * 10);
        grain(ctx, x, y, size, size, `hsl(22 46% ${shade - 6}%)`, '#2a140a', rnd);
      } else {
        ctx.fillStyle = `hsl(38 ${40 + rnd() * 8}% ${72 + rnd() * 4}%)`;
        ctx.fillRect(x, y, size, size);
        speckle(ctx, x, y, size, size, ['#b59a6e', '#fff7e6', '#9c8460'], 220, rnd);
      }
    }
  }
  ctx.strokeStyle = '#c9a24a';
  ctx.lineWidth = 2;
  for (let i = 0; i <= 10; i++) {
    ctx.beginPath();
    ctx.moveTo(i * size, 0);
    ctx.lineTo(i * size, size * 10);
    ctx.moveTo(0, i * size);
    ctx.lineTo(size * 10, i * size);
    ctx.stroke();
  }
  return texture(element);
}

/**
 * The top of the frame around the squares, 100 px a world unit, 11.6 units across: a cedar
 * rim, a band of zellige stars, a brass line, and a cedar strip with the coordinates carved
 * in on all four sides (so they read from either side of the table).
 */
export function frameTexture(): Texture {
  const scale = 100;
  const full = 1160;
  const [element, ctx] = canvas(full);
  const rnd = random(11);
  grain(ctx, 0, 0, full, full, '#6a3d20', '#2b160a', rnd);

  // Zellige band: stars on a cream grout, with small cross tiles where four stars meet.
  const band = [10, 50];
  ctx.save();
  ctx.beginPath();
  ctx.rect(band[0], band[0], full - 2 * band[0], full - 2 * band[0]);
  ctx.rect(band[1], band[1], full - 2 * band[1], full - 2 * band[1]);
  ctx.clip('evenodd');
  ctx.fillStyle = '#efe6d2';
  ctx.fillRect(0, 0, full, full);
  const tile = 40;
  for (let ty = 0; ty * tile < full + tile; ty++) {
    for (let tx = 0; tx * tile < full + tile; tx++) {
      const cx = band[0] + tx * tile;
      const cy = band[0] + ty * tile;
      ctx.fillStyle = ZELLIGE[(tx + 2 * ty) % 3];
      starPath(ctx, cx + tile / 2, cy + tile / 2, tile * 0.46, tile * 0.3);
      ctx.fill();
      ctx.fillStyle = ZELLIGE[3];
      starPath(ctx, cx + tile / 2, cy + tile / 2, tile * 0.16, tile * 0.1);
      ctx.fill();
      ctx.fillStyle = ZELLIGE[4];
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-tile * 0.09, -tile * 0.09, tile * 0.18, tile * 0.18);
      ctx.restore();
    }
  }
  ctx.restore();

  ctx.strokeStyle = '#d6ad55';
  ctx.lineWidth = 3;
  ctx.strokeRect(band[1] + 1.5, band[1] + 1.5, full - 2 * band[1] - 3, full - 2 * band[1] - 3);
  ctx.strokeRect(band[0] - 1.5, band[0] - 1.5, full - 2 * band[0] + 3, full - 2 * band[0] + 3);

  // Carved coordinates: gold leaf with a dark cut below it.
  const files = 'abcdefghij';
  const edge = 80;
  const label = (text: string, x: number, y: number, turn: number) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(turn);
    ctx.font = 'bold 21px Georgia, "Times New Roman", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(20, 8, 2, 0.8)';
    ctx.fillText(text, 0, 1.5);
    ctx.fillStyle = '#e2bd68';
    ctx.fillText(text, 0, 0);
    ctx.restore();
  };
  for (let i = 0; i < 10; i++) {
    const along = edge + (i + 0.5) * scale;
    label(files[i], along, full - 65, 0);
    label(files[i], along, 65, Math.PI);
    label(String(10 - i), 65, along, 0);
    label(String(10 - i), full - 65, along, Math.PI);
  }
  return texture(element);
}

/** Cedar for the sides of the board. */
export function woodTexture(): Texture {
  const [element, ctx] = canvas(512, 128);
  grain(ctx, 0, 0, 512, 128, '#5d331a', '#26120a', random(3));
  const result = texture(element);
  result.wrapS = RepeatWrapping;
  result.wrapT = RepeatWrapping;
  return result;
}

/** A round engraved brass tea tray: rings, a band of arabesque petals, a dotted rim. */
export function brassTexture(): Texture {
  const size = 1024;
  const [element, ctx] = canvas(size);
  const c = size / 2;
  const gradient = ctx.createRadialGradient(c, c, 0, c, c, c);
  gradient.addColorStop(0, '#c99a48');
  gradient.addColorStop(0.7, '#b0823a');
  gradient.addColorStop(0.95, '#8a5f22');
  gradient.addColorStop(1, '#5c3c12');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const rnd = random(5);
  for (let i = 0; i < 1600; i++) {
    const angle = rnd() * Math.PI * 2;
    const radius = rnd() * c;
    ctx.strokeStyle = `rgba(${rnd() > 0.5 ? '255,230,170' : '60,35,10'}, 0.08)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(c, c, radius, angle, angle + 0.05 + rnd() * 0.25);
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(70, 40, 10, 0.55)';
  for (const r of [0.52, 0.55, 0.78, 0.8, 0.93, 0.95]) {
    ctx.lineWidth = r > 0.9 ? 3 : 2;
    ctx.beginPath();
    ctx.arc(c, c, r * c, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Petals between the rings at 0.55 and 0.78, and stars between them.
  const petals = 32;
  for (let i = 0; i < petals; i++) {
    const angle = (i / petals) * Math.PI * 2;
    ctx.save();
    ctx.translate(c + Math.cos(angle) * 0.665 * c, c + Math.sin(angle) * 0.665 * c);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.ellipse(0, 0, 0.1 * c, 0.035 * c, 0, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, 0, 0.06 * c, 0.015 * c, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    const between = angle + Math.PI / petals;
    starPath(ctx, c + Math.cos(between) * 0.73 * c, c + Math.sin(between) * 0.73 * c, 0.022 * c, 0.012 * c);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(70, 40, 10, 0.6)';
  for (let i = 0; i < 120; i++) {
    const angle = (i / 120) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(c + Math.cos(angle) * 0.865 * c, c + Math.sin(angle) * 0.865 * c, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  return texture(element);
}

/**
 * What the lantern's light shines through: a lattice of star-shaped holes. Projected by a
 * spotlight, it scatters stars of light over the board and the tray.
 */
export function latticeTexture(): Texture {
  const size = 512;
  const [element, ctx] = canvas(size);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#fff';
  const cells = 7;
  const step = size / cells;
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      starPath(ctx, (x + 0.5) * step, (y + 0.5) * step, step * 0.36, step * 0.2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x * step, y * step, step * 0.07, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return texture(element);
}

/** The motif glazed onto the top of each piece. */
export function pieceMotifTexture(color: string): Texture {
  const size = 256;
  const [element, ctx] = canvas(size);
  const c = size / 2;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 7;
  starPath(ctx, c, c, c * 0.62, c * 0.42);
  ctx.stroke();
  starPath(ctx, c, c, c * 0.2, c * 0.12);
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(c, c, c * 0.86, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(c + Math.cos(angle) * c * 0.74, c + Math.sin(angle) * c * 0.74, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  return texture(element);
}

/** A soft round glow, for markers and light halos. */
export function glowTexture(): Texture {
  const size = 128;
  const [element, ctx] = canvas(size);
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return texture(element);
}

/** A rose petal, white so each one can be tinted its own shade of rose. */
export function petalTexture(): Texture {
  const size = 64;
  const [element, ctx] = canvas(size);
  const gradient = ctx.createRadialGradient(size * 0.5, size * 0.75, 2, size * 0.5, size * 0.5, size * 0.55);
  gradient.addColorStop(0, '#ffffff');
  gradient.addColorStop(1, '#d9d9d9');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(size * 0.5, size * 0.95);
  ctx.bezierCurveTo(size * 0.05, size * 0.6, size * 0.1, size * 0.05, size * 0.5, size * 0.12);
  ctx.bezierCurveTo(size * 0.9, size * 0.05, size * 0.95, size * 0.6, size * 0.5, size * 0.95);
  ctx.fill();
  return texture(element);
}

/** The night sky: deep indigo at the top fading to near black at the horizon. */
export function skyTexture(): Texture {
  const [element, ctx] = canvas(4, 256);
  const gradient = ctx.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, '#1a1446');
  gradient.addColorStop(0.45, '#120d2c');
  gradient.addColorStop(1, '#07050f');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 4, 256);
  return texture(element);
}
