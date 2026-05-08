import { Easing, interpolate } from "remotion";

export const colors = {
  bg: "#0b0f14",
  bgSoft: "#121821",
  panel: "rgba(255,255,255,0.08)",
  panelStrong: "rgba(255,255,255,0.13)",
  stroke: "rgba(255,255,255,0.16)",
  strokeStrong: "rgba(255,255,255,0.28)",
  text: "rgba(255,255,255,0.94)",
  muted: "rgba(255,255,255,0.62)",
  dim: "rgba(255,255,255,0.42)",
  cyan: "#5ac8fa",
  green: "#30d158",
  warm: "#ffd166",
  red: "#ff6b6b",
  black: "#030507",
};

export const fontFamily =
  '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", Arial, sans-serif';

export function enter(frame: number, start: number, duration: number) {
  return interpolate(frame, [start, start + duration], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
}

export function exit(frame: number, start: number, duration: number) {
  return interpolate(frame, [start, start + duration], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.7, 0, 0.84, 0),
  });
}

export function lift(progress: number, distance: number) {
  return `translate3d(0, ${(1 - progress) * distance}px, 0)`;
}

export function fade(progress: number) {
  return Math.max(0, Math.min(1, progress));
}

export function px(n: number) {
  return `${n}px`;
}
