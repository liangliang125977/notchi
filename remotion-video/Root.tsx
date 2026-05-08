import { Composition } from "remotion";
import { ProductTeaser } from "./ProductTeaser";
import { SocialLoop } from "./SocialLoop";

export function RemotionRoot() {
  return (
    <>
      <Composition
        id="NotchiProductTeaser"
        component={ProductTeaser}
        durationInFrames={1260}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="NotchiSocialLoop"
        component={SocialLoop}
        durationInFrames={420}
        fps={30}
        width={1080}
        height={1920}
      />
    </>
  );
}
