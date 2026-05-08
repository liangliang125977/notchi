import { demo } from "../data";
import { colors, fontFamily, lift } from "../styles";

interface L2CapsuleMockProps {
  compact?: boolean;
  progress: number;
  x?: number;
  y?: number;
}

export function L2CapsuleMock({
  compact = false,
  progress,
  x = 0,
  y = 0,
}: L2CapsuleMockProps) {
  const width = compact ? 620 : 560;
  const scale = 0.92 + progress * 0.08;

  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        top: "50%",
        width,
        padding: compact ? "24px 32px" : "18px 26px",
        borderRadius: compact ? 34 : 28,
        background: "rgba(18,22,29,0.82)",
        backdropFilter: "blur(28px)",
        border: `1px solid ${colors.strokeStrong}`,
        boxShadow: "0 26px 76px rgba(0,0,0,0.42)",
        color: colors.text,
        fontFamily,
        opacity: progress,
        transform: `translate3d(calc(-50% + ${x}px), calc(-50% + ${y}px), 0) ${lift(progress, 18)} scale(${scale})`,
        transformOrigin: "center",
      }}
    >
      <div
        style={{
          alignItems: "center",
          display: "flex",
          gap: compact ? 18 : 14,
          justifyContent: "space-between",
        }}
      >
        <span
          style={{
            alignItems: "center",
            display: "inline-flex",
            gap: 10,
            fontSize: compact ? 34 : 22,
            fontWeight: 700,
          }}
        >
          <span
            style={{
              width: compact ? 14 : 9,
              height: compact ? 14 : 9,
              borderRadius: 999,
              background: colors.cyan,
              boxShadow: "0 0 20px rgba(90,200,250,0.65)",
            }}
          />
          {demo.model}
        </span>
        <strong style={{ fontSize: compact ? 44 : 30 }}>{demo.tokens}</strong>
        <span
          style={{
            borderRadius: 999,
            background: "rgba(48,209,88,0.18)",
            color: colors.green,
            fontSize: compact ? 26 : 17,
            fontWeight: 800,
            padding: compact ? "8px 14px" : "5px 10px",
          }}
        >
          {demo.delta}
        </span>
      </div>
      {!compact ? (
        <div
          style={{
            color: colors.muted,
            display: "flex",
            fontSize: 18,
            justifyContent: "space-between",
            marginTop: 12,
          }}
        >
          <span>{demo.session}</span>
          <span>{demo.cost}</span>
        </div>
      ) : null}
    </div>
  );
}
