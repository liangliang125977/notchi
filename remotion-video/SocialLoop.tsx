import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { GrowthBurst } from "./components/GrowthBurst";
import { L2CapsuleMock } from "./components/L2CapsuleMock";
import { MacFrame } from "./components/MacFrame";
import { PetSprite, type PetMood } from "./components/PetSprite";
import { SceneText } from "./components/SceneText";
import { SignalLines } from "./components/SignalLines";
import { social } from "./data";
import { colors, enter, exit, fontFamily } from "./styles";

export function SocialLoop() {
  const frame = useCurrentFrame();
  const signalProgress =
    enter(frame, social.activity, 42) * exit(frame, 318, 54);
  const capsuleProgress =
    enter(frame, social.capsule, 38) * exit(frame, 306, 50);
  const burstProgress = enter(frame, social.burst, 28) * exit(frame, 342, 42);
  const textProgress = loopTextProgress(frame);

  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at 50% 22%, rgba(90,200,250,0.24), transparent 34%), linear-gradient(180deg, ${colors.bgSoft}, ${colors.bg})`,
        color: colors.text,
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", sans-serif',
        overflow: "hidden",
      }}
    >
      <MacFrame variant="vertical" />
      <SignalLines progress={signalProgress} vertical />
      <PetSprite mood={moodFromFrame(frame)} progress={1} size={430} y={-520} />
      <L2CapsuleMock compact progress={capsuleProgress} y={118} />
      <GrowthBurst progress={burstProgress} y={-520} />
      <SceneText
        progress={textProgress}
        subtitle="A coding pet for your Mac notch"
        title="Notchi"
        y={1320}
      />
      <div
        style={{
          position: "absolute",
          bottom: 170,
          left: "50%",
          transform: "translateX(-50%)",
          color: colors.dim,
          fontFamily,
          fontSize: 30,
          fontWeight: 750,
          letterSpacing: 0,
          opacity: interpolate(frame, [150, 210, 330, 390], [0, 1, 1, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        Local-only token awareness
      </div>
    </AbsoluteFill>
  );
}

function moodFromFrame(frame: number): PetMood {
  if (frame >= 270 && frame < 360) return "done";
  if (frame >= 90 && frame < 270) return "coding";
  return "idle";
}

function loopTextProgress(frame: number) {
  if (frame < 45) return frame / 45;
  if (frame > 360) return Math.max(0, (420 - frame) / 60);
  return 1;
}
