import { AbsoluteFill, Sequence, interpolate, useCurrentFrame } from "remotion";
import { DashboardMock } from "./components/DashboardMock";
import { L2CapsuleMock } from "./components/L2CapsuleMock";
import { MacFrame } from "./components/MacFrame";
import { PetSprite, type PetMood } from "./components/PetSprite";
import { SceneText } from "./components/SceneText";
import { SignalLines } from "./components/SignalLines";
import { demo, teaser, teaserBeats } from "./data";
import { colors, enter, exit, fontFamily } from "./styles";

export function ProductTeaser() {
  const frame = useCurrentFrame();
  const petProgress = enter(frame, teaser.notchReveal, 72);
  const signalProgress =
    enter(frame, teaser.activity, 80) * exit(frame, 900, 90);
  const capsuleProgress =
    enter(frame, teaser.capsule, 52) * exit(frame, teaser.dashboard + 10, 50);
  const dashboardProgress =
    enter(frame, teaser.dashboard, 76) * exit(frame, teaser.privacy + 30, 70);

  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at 48% 18%, rgba(90,200,250,0.20), transparent 34%), linear-gradient(180deg, ${colors.bgSoft}, ${colors.bg})`,
        color: colors.text,
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", sans-serif',
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(180deg, rgba(255,255,255,0.03) 1px, transparent 1px)",
          backgroundSize: "80px 80px",
          opacity: 0.26,
        }}
      />
      <MacFrame variant="wide" />
      <SignalLines progress={signalProgress} />
      <PetSprite
        mood={moodFromFrame(frame)}
        progress={petProgress}
        size={275}
        y={-210}
      />
      <L2CapsuleMock progress={capsuleProgress} y={70} />
      <DashboardMock progress={dashboardProgress} />
      <Sequence from={0} layout="none">
        {teaserBeats.map((beat) => (
          <SceneText
            key={beat.title}
            align={beat.start >= teaser.privacy ? "center" : "left"}
            progress={enter(frame, beat.start, 38) * exit(frame, beat.end, 38)}
            subtitle={beat.subtitle}
            title={beat.title}
            x={0}
            y={beat.start >= teaser.privacy ? 775 : 760}
          />
        ))}
      </Sequence>
      <div
        style={{
          position: "absolute",
          bottom: 58,
          left: "50%",
          transform: "translateX(-50%)",
          color: colors.dim,
          fontFamily,
          fontSize: 20,
          fontWeight: 700,
          letterSpacing: 0,
          opacity: interpolate(frame, [980, 1060], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        {demo.privacy}
      </div>
    </AbsoluteFill>
  );
}

function moodFromFrame(frame: number): PetMood {
  if (frame >= 870) return "done";
  if (frame >= 210) return "coding";
  return "idle";
}
