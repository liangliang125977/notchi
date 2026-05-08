export const demo = {
  model: "Sonnet 4",
  tokens: "509K",
  delta: "↑12%",
  session: "ai-coding/notchi",
  cost: "$4.21",
  privacy: "Local-only. Nothing leaves your Mac.",
};

export const teaser = {
  notchReveal: 0,
  activity: 180,
  capsule: 360,
  dashboard: 570,
  privacy: 960,
};

export const social = {
  intro: 0,
  activity: 90,
  capsule: 150,
  burst: 270,
};

export const teaserBeats = [
  {
    start: 48,
    end: 240,
    title: "A coding companion for your Mac notch",
    subtitle: "Notchi lives quietly above your work.",
  },
  {
    start: 330,
    end: 570,
    title: "Token awareness without breaking focus",
    subtitle: "Glanceable model, token, and session state.",
  },
  {
    start: 900,
    end: 1210,
    title: "Local-only by design",
    subtitle: demo.privacy,
  },
] as const;
