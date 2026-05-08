import { useCurrentFrame } from "remotion";
import { colors } from "../styles";

interface GrowthBurstProps {
  progress: number;
  x?: number;
  y?: number;
}

export function GrowthBurst({ progress, x = 0, y = 0 }: GrowthBurstProps) {
  const frame = useCurrentFrame();

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        opacity: progress,
        pointerEvents: "none",
      }}
    >
      {Array.from({ length: 14 }).map((_, i) => {
        const angle = (i / 14) * Math.PI * 2;
        const distance = 120 + progress * 170 + Math.sin(frame / 8 + i) * 12;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `calc(50% + ${x}px)`,
              top: `calc(50% + ${y}px)`,
              width: i % 3 === 0 ? 18 : 12,
              height: i % 3 === 0 ? 18 : 12,
              borderRadius: i % 2 === 0 ? 999 : 4,
              background: i % 2 === 0 ? colors.warm : colors.green,
              boxShadow: "0 0 22px rgba(255,209,102,0.46)",
              transform: `translate3d(${Math.cos(angle) * distance}px, ${Math.sin(angle) * distance}px, 0) rotate(${frame * 3 + i * 20}deg)`,
            }}
          />
        );
      })}
    </div>
  );
}
