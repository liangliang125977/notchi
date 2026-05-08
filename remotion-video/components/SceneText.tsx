import { colors, fontFamily, lift } from "../styles";

interface SceneTextProps {
  align?: "left" | "center";
  progress: number;
  subtitle: string;
  title: string;
  x?: number;
  y?: number;
}

export function SceneText({
  align = "center",
  progress,
  subtitle,
  title,
  x = 0,
  y = 0,
}: SceneTextProps) {
  return (
    <div
      style={{
        position: "absolute",
        left: align === "center" ? "50%" : 150 + x,
        top: y,
        width: align === "center" ? 980 : 650,
        color: colors.text,
        fontFamily,
        opacity: progress,
        textAlign: align,
        transform:
          align === "center"
            ? `translateX(-50%) ${lift(progress, 24)}`
            : lift(progress, 24),
      }}
    >
      <div
        style={{
          fontSize: align === "center" ? 66 : 58,
          fontWeight: 880,
          letterSpacing: 0,
          lineHeight: 1.02,
        }}
      >
        {title}
      </div>
      <div
        style={{
          color: colors.muted,
          fontSize: align === "center" ? 28 : 25,
          fontWeight: 650,
          lineHeight: 1.28,
          marginTop: 18,
        }}
      >
        {subtitle}
      </div>
    </div>
  );
}
