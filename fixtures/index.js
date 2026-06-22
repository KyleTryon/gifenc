export const BENCH_FORMATS = ["rgb444", "rgb565", "rgba4444"];

export const BENCH_IMAGE_FIXTURES = [
  {
    id: "high-color",
    name: "High-color PNG",
    repoPath: "fixtures/images/baboon.png",
    quantizeIterations: 8,
    applyIterations: 25,
    encodeIterations: 50,
  },
  {
    id: "low-color",
    name: "Low-color PNG",
    repoPath: "fixtures/images/007.png",
    quantizeIterations: 25,
    applyIterations: 50,
    encodeIterations: 100,
  },
  {
    id: "transparent",
    name: "Transparent PNG",
    repoPath: "fixtures/images/007-transparent.png",
    quantizeIterations: 25,
    applyIterations: 50,
    encodeIterations: 100,
  },
];

export const BENCH_VIDEO_FIXTURES = {
  basketball: {
    id: "basketball",
    name: "Basketball 5s 320p MP4",
    repoPath: "fixtures/video/basketball_5s_320p.mp4",
    fps: 24,
  },
};

export function fixtureUrl(fixture) {
  return `/${fixture.repoPath}`;
}
