import type { CSSProperties, ReactNode } from "react";
import { colors } from "../styles";

interface MacFrameProps {
  variant: "wide" | "vertical";
  children?: ReactNode;
}

export function MacFrame({ variant, children }: MacFrameProps) {
  const isVertical = variant === "vertical";
  const notchWidth = isVertical ? 280 : 320;
  const notchHeight = isVertical ? 58 : 64;
  const frameStyle: CSSProperties = {
    position: "absolute",
    inset: isVertical ? "112px 70px" : "58px 86px",
    borderRadius: isVertical ? 56 : 46,
    background:
      "linear-gradient(180deg, rgba(255,255,255,0.10), rgba(255,255,255,0.045))",
    border: `1px solid ${colors.stroke}`,
    boxShadow: "0 42px 120px rgba(0,0,0,0.42)",
    overflow: "hidden",
  };

  return (
    <div style={frameStyle}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(circle at 50% 0%, rgba(90,200,250,0.22), transparent 34%), linear-gradient(180deg, #151b24, #0b0f14 70%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 0,
          left: "50%",
          width: notchWidth,
          height: notchHeight,
          transform: "translateX(-50%)",
          borderRadius: `0 0 ${notchHeight / 2}px ${notchHeight / 2}px`,
          background: colors.black,
          boxShadow: "0 10px 30px rgba(0,0,0,0.48)",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: isVertical ? 86 : 92,
          left: "50%",
          width: isVertical ? 450 : 720,
          height: isVertical ? 450 : 420,
          transform: "translateX(-50%)",
          borderRadius: "999px",
          background:
            "radial-gradient(circle, rgba(90,200,250,0.24), rgba(48,209,88,0.08) 48%, transparent 70%)",
          filter: "blur(18px)",
        }}
      />
      {children}
    </div>
  );
}
