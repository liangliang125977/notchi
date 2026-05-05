#!/usr/bin/env node
// Generate fallback PNG assets for SPEC §4 S15.
//
// Why this script exists: Mao_Pro ships as a Live2D model atlas
// (parts pieces in a single 4096px texture), so cropping the texture
// directly does not yield a usable portrait. We instead draw
// stylised, Mao-themed SVG mascots and rasterise them to 480×480 PNG
// via Chrome headless (already installed on the user's macOS box).
// Output is deterministic and committed; this script only re-runs
// when the source SVGs change.
//
// Dependencies: just /Applications/Google Chrome.app and Node ≥ 20.
// Usage: `node scripts/generate-fallback-pngs.mjs`

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUT_DIR = join(ROOT, "public", "assets", "fallback");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SIZE = 480;

// Mao_Pro inspired palette — blue hair, peach skin, navy outfit,
// muted backgrounds. Values eyeballed from the model texture.
const PALETTE = {
  hair: "#7DC1E7",
  hairShadow: "#4A8FB5",
  skin: "#FFE3D1",
  skinShadow: "#F4BFA0",
  outfit: "#1F2E55",
  outfitAccent: "#FFB053",
  mouth: "#C24B6C",
  eyeWhite: "#FFFFFF",
  eyeIris: "#3B5BA8",
  cheek: "#F8A3A6",
  outline: "#1A1A24",
};

function head(label) {
  // Small "FALLBACK" tag at top so users instantly know this is the
  // degraded render mode (matches SPEC §4 S15 banner intent).
  return `
    <g font-family="-apple-system,BlinkMacSystemFont,'SF Pro Display',sans-serif"
       font-weight="600" text-anchor="middle">
      <rect x="160" y="22" width="160" height="26" rx="13"
            fill="rgba(0,0,0,0.55)" />
      <text x="240" y="40" font-size="13" fill="#fff"
            letter-spacing="1.5">FALLBACK · ${label.toUpperCase()}</text>
    </g>
  `;
}

function maoBody({ mouth, eyeShape, accent }) {
  // A simple front-facing chibi: round head with blue bob, two eyes,
  // small body in the navy outfit. Pose differences are encoded in the
  // mouth + eye + accent variations.
  return `
    <!-- soft drop shadow under the body -->
    <ellipse cx="240" cy="430" rx="120" ry="14"
             fill="rgba(0,0,0,0.18)" />

    <!-- body / outfit -->
    <path d="M 150 410
             Q 150 320 200 300
             L 280 300
             Q 330 320 330 410
             Z"
          fill="${PALETTE.outfit}" stroke="${PALETTE.outline}" stroke-width="3" />
    <!-- collar -->
    <path d="M 200 300 L 240 330 L 280 300"
          fill="#FFFFFF" stroke="${PALETTE.outline}" stroke-width="2.5" />
    <!-- accent badge -->
    ${accent}

    <!-- neck -->
    <rect x="225" y="280" width="30" height="28"
          fill="${PALETTE.skin}" stroke="${PALETTE.outline}" stroke-width="2.5" />

    <!-- head shape -->
    <ellipse cx="240" cy="200" rx="100" ry="105"
             fill="${PALETTE.skin}" stroke="${PALETTE.outline}" stroke-width="3" />

    <!-- cheek blush -->
    <ellipse cx="180" cy="225" rx="14" ry="8"
             fill="${PALETTE.cheek}" opacity="0.7" />
    <ellipse cx="300" cy="225" rx="14" ry="8"
             fill="${PALETTE.cheek}" opacity="0.7" />

    <!-- hair: front bangs over forehead -->
    <path d="M 145 175
             Q 150 110 240 100
             Q 330 110 335 175
             Q 320 145 290 155
             Q 280 145 260 158
             Q 245 145 225 158
             Q 205 145 195 158
             Q 165 148 145 175 Z"
          fill="${PALETTE.hair}" stroke="${PALETTE.outline}" stroke-width="3" />
    <!-- hair side tufts -->
    <path d="M 140 180 Q 130 230 145 270
             L 155 260 Q 152 220 158 185 Z"
          fill="${PALETTE.hair}" stroke="${PALETTE.outline}" stroke-width="2.5" />
    <path d="M 340 180 Q 350 230 335 270
             L 325 260 Q 328 220 322 185 Z"
          fill="${PALETTE.hair}" stroke="${PALETTE.outline}" stroke-width="2.5" />

    <!-- ribbon -->
    <g transform="translate(240,108)">
      <path d="M -30 -10 L -10 0 L -30 10 Z"
            fill="${PALETTE.outfitAccent}" stroke="${PALETTE.outline}" stroke-width="2" />
      <path d="M  30 -10 L  10 0 L  30 10 Z"
            fill="${PALETTE.outfitAccent}" stroke="${PALETTE.outline}" stroke-width="2" />
      <circle r="6" fill="${PALETTE.outfitAccent}" stroke="${PALETTE.outline}" stroke-width="2" />
    </g>

    <!-- eyes -->
    ${eyeShape}

    <!-- mouth -->
    ${mouth}
  `;
}

function eyesOpen() {
  return `
    <g>
      <ellipse cx="200" cy="210" rx="14" ry="18"
               fill="${PALETTE.eyeWhite}" stroke="${PALETTE.outline}" stroke-width="2.5" />
      <ellipse cx="280" cy="210" rx="14" ry="18"
               fill="${PALETTE.eyeWhite}" stroke="${PALETTE.outline}" stroke-width="2.5" />
      <circle cx="200" cy="212" r="8" fill="${PALETTE.eyeIris}" />
      <circle cx="280" cy="212" r="8" fill="${PALETTE.eyeIris}" />
      <circle cx="202" cy="208" r="3" fill="#fff" />
      <circle cx="282" cy="208" r="3" fill="#fff" />
    </g>
  `;
}

function eyesFocused() {
  // Half-lidded "concentrating" look for coding.
  return `
    <g stroke="${PALETTE.outline}" stroke-width="3" fill="none" stroke-linecap="round">
      <path d="M 184 212 Q 200 224 216 212" />
      <path d="M 264 212 Q 280 224 296 212" />
    </g>
    <g fill="${PALETTE.eyeIris}">
      <circle cx="200" cy="216" r="4" />
      <circle cx="280" cy="216" r="4" />
    </g>
  `;
}

function eyesHappy() {
  // Closed-eye "^_^" smile shape for done.
  return `
    <g stroke="${PALETTE.outline}" stroke-width="3.5" fill="none" stroke-linecap="round">
      <path d="M 184 214 Q 200 196 216 214" />
      <path d="M 264 214 Q 280 196 296 214" />
    </g>
  `;
}

function mouthSmall() {
  return `<path d="M 232 252 Q 240 258 248 252"
                stroke="${PALETTE.mouth}" stroke-width="3"
                fill="none" stroke-linecap="round" />`;
}

function mouthOpen() {
  return `<ellipse cx="240" cy="254" rx="6" ry="4"
                   fill="${PALETTE.mouth}"
                   stroke="${PALETTE.outline}" stroke-width="2" />`;
}

function mouthBigSmile() {
  return `<path d="M 220 250 Q 240 272 260 250 Q 240 260 220 250 Z"
                fill="${PALETTE.mouth}"
                stroke="${PALETTE.outline}" stroke-width="2" />`;
}

function badgeIdle() {
  return `<circle cx="240" cy="360" r="9"
                  fill="${PALETTE.outfitAccent}"
                  stroke="${PALETTE.outline}" stroke-width="2" />`;
}

function badgeCoding() {
  // Tiny laptop-ish glyph on the chest.
  return `
    <g transform="translate(240,360)">
      <rect x="-14" y="-7" width="28" height="14" rx="2"
            fill="#fff" stroke="${PALETTE.outline}" stroke-width="2" />
      <line x1="-10" y1="-3" x2="10" y2="-3"
            stroke="${PALETTE.outline}" stroke-width="1" />
      <line x1="-10" y1="0" x2="6" y2="0"
            stroke="${PALETTE.outline}" stroke-width="1" />
      <line x1="-10" y1="3" x2="8" y2="3"
            stroke="${PALETTE.outline}" stroke-width="1" />
    </g>
  `;
}

function badgeDone() {
  // Star for celebration.
  return `
    <g transform="translate(240,360)">
      <path d="M 0 -12 L 3.5 -3.7 L 12 -3.7 L 5.2 1.4 L 7.7 10
               L 0 4.6 L -7.7 10 L -5.2 1.4 L -12 -3.7 L -3.5 -3.7 Z"
            fill="${PALETTE.outfitAccent}"
            stroke="${PALETTE.outline}" stroke-width="2" />
    </g>
  `;
}

function buildSvg(label, eyeShape, mouth, accent) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 480"
     width="${SIZE}" height="${SIZE}">
  <g>
    ${maoBody({ eyeShape, mouth, accent })}
    ${head(label)}
  </g>
</svg>`;
}

const scenes = [
  {
    name: "idle",
    svg: buildSvg("idle", eyesOpen(), mouthSmall(), badgeIdle()),
  },
  {
    name: "coding",
    svg: buildSvg("coding", eyesFocused(), mouthOpen(), badgeCoding()),
  },
  {
    name: "done",
    svg: buildSvg("done", eyesHappy(), mouthBigSmile(), badgeDone()),
  },
];

mkdirSync(OUT_DIR, { recursive: true });
const work = mkdtempSync(join(tmpdir(), "notchi-fallback-"));

try {
  for (const { name, svg } of scenes) {
    const html = `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  html,body { margin:0; padding:0; background: transparent; }
  body { width:${SIZE}px; height:${SIZE}px; }
  svg { display:block; width:${SIZE}px; height:${SIZE}px; }
</style>
</head><body>${svg}</body></html>`;
    const htmlPath = join(work, `${name}.html`);
    writeFileSync(htmlPath, html);

    // Chrome's --screenshot lands on cwd as `screenshot.png`; we point
    // cwd at the work dir, then move the file to its final name.
    execFileSync(
      CHROME,
      [
        "--headless=new",
        "--no-sandbox",
        "--hide-scrollbars",
        "--default-background-color=00000000",
        `--window-size=${SIZE},${SIZE}`,
        `--screenshot=${join(work, `${name}.png`)}`,
        `file://${htmlPath}`,
      ],
      { stdio: ["ignore", "ignore", "inherit"], cwd: work },
    );

    const out = join(OUT_DIR, `${name}@2x.png`);
    execFileSync("/bin/cp", [join(work, `${name}.png`), out]);
    console.log(`wrote ${out}`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
