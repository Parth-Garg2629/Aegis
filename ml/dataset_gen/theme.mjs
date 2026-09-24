import { pick, randInt } from './rng.mjs';

const FONTS = [
  'Arial, sans-serif',
  "'Segoe UI', sans-serif",
  'Georgia, serif',
  "'Courier New', monospace",
  'Verdana, sans-serif',
  'Tahoma, sans-serif',
];

const PALETTES = [
  { bg: '#ffffff', fg: '#1a1a1a', accent: '#2563eb' },
  { bg: '#0f172a', fg: '#e2e8f0', accent: '#38bdf8' },
  { bg: '#f8fafc', fg: '#0f172a', accent: '#16a34a' },
  { bg: '#fffbeb', fg: '#451a03', accent: '#d97706' },
  { bg: '#1a1a2e', fg: '#eaeaea', accent: '#e94560' },
  { bg: '#f0fdf4', fg: '#052e16', accent: '#059669' },
];

const DENSITIES = ['compact', 'comfortable', 'spacious'];

export function randomTheme(rng) {
  const palette = pick(rng, PALETTES);
  const font = pick(rng, FONTS);
  const baseFontSize = randInt(rng, 13, 18);
  const density = pick(rng, DENSITIES);
  const padding = density === 'compact' ? 6 : density === 'comfortable' ? 12 : 20;
  const borderRadius = randInt(rng, 2, 10);
  return { palette, font, baseFontSize, padding, borderRadius, density };
}

export function themeStyleBlock(theme) {
  const { palette, font, baseFontSize, padding, borderRadius } = theme;
  return `
    * { box-sizing: border-box; }
    body { background:${palette.bg}; color:${palette.fg}; font-family:${font}; font-size:${baseFontSize}px; margin:0; padding:20px; }
    h1, h2 { font-family:${font}; }
    button, .btn { background:${palette.accent}; color:#fff; border:none; border-radius:${borderRadius}px; padding:${padding}px ${padding * 1.5}px; font-size:1em; cursor:pointer; }
    input[type=text], input[type=email], input[type=password], input[type=tel], input[type=search], select, textarea {
      padding:${padding}px; border:1px solid #94a3b8; border-radius:${borderRadius}px; font-size:1em; display:block; width:100%; margin-bottom:${padding}px;
    }
    label { display:block; margin-bottom:4px; }
    a { color:${palette.accent}; text-decoration:none; }
    .icon { display:inline-flex; align-items:center; justify-content:center; width:28px; height:28px; border-radius:50%; background:${palette.accent}33; cursor:pointer; font-size:14px; margin-right:8px; }
    .card { border:1px solid ${palette.accent}44; border-radius:${borderRadius}px; padding:${padding}px; margin-bottom:${padding}px; }
    .placeholder-img { background: linear-gradient(135deg, ${palette.accent}66, ${palette.accent}11); border-radius:${borderRadius}px; display:flex; align-items:center; justify-content:center; color:${palette.fg}; font-size:0.8em; }
    nav { display:flex; gap:16px; padding:12px; align-items:center; }
  `;
}

export function wrapPage(theme, bodyHtml) {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>${themeStyleBlock(theme)}</style></head>
<body>${bodyHtml}</body></html>`;
}
