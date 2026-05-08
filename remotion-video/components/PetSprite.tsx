import { Img, interpolate, staticFile, useCurrentFrame } from "remotion";

export type PetMood = "idle" | "coding" | "done";

interface PetSpriteProps {
  mood: PetMood;
  progress: number;
  size: number;
  x?: number;
  y?: number;
}

const sources: Record<PetMood, string> = {
  idle: "assets/fallback/idle@2x.png",
  coding: "assets/fallback/coding@2x.png",
  done: "assets/fallback/done@2x.png",
};

export function PetSprite({
  mood,
  progress,
  size,
  x = 0,
  y = 0,
}: PetSpriteProps) {
  const frame = useCurrentFrame();
  const bob = Math.sin(frame / 18) * 8;
  const scale = interpolate(progress, [0, 1], [0.86, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const glow =
    mood === "done"
      ? "drop-shadow(0 0 34px rgba(255,209,102,0.62))"
      : mood === "coding"
        ? "drop-shadow(0 0 28px rgba(90,200,250,0.55))"
        : "drop-shadow(0 0 18px rgba(255,255,255,0.22))";

  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        top: "50%",
        width: size,
        height: size,
        opacity: progress,
        transform: `translate3d(calc(-50% + ${x}px), calc(-50% + ${y + bob}px), 0) scale(${scale})`,
        transformOrigin: "center",
        filter: glow,
      }}
    >
      <Img
        src={staticFile(sources[mood])}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
        }}
      />
    </div>
  );
}
