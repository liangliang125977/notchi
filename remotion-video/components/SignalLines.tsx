import { useCurrentFrame } from "remotion";
import { colors } from "../styles";

interface SignalLinesProps {
  progress: number;
  vertical?: boolean;
}

export function SignalLines({ progress, vertical = false }: SignalLinesProps) {
  const frame = useCurrentFrame();
  const rows = vertical ? 8 : 10;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        opacity: progress,
        pointerEvents: "none",
      }}
    >
      {Array.from({ length: rows }).map((_, i) => {
        const side = i % 2 === 0 ? -1 : 1;
        const lane = Math.floor(i / 2);
        const travel = ((frame * (1.8 + lane * 0.16) + i * 48) % 420) - 210;
        const top = vertical ? 420 + lane * 90 : 230 + lane * 58;
        const length = vertical ? 210 - lane * 8 : 260 - lane * 10;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              top,
              left: "50%",
              width: length,
              height: 3,
              borderRadius: 999,
              background: `linear-gradient(90deg, transparent, ${side < 0 ? colors.cyan : colors.green}, transparent)`,
              boxShadow: `0 0 20px ${side < 0 ? "rgba(90,200,250,0.35)" : "rgba(48,209,88,0.32)"}`,
              transform: `translateX(${side * (vertical ? 310 : 520) - travel * side}px)`,
            }}
          />
        );
      })}
    </div>
  );
}
