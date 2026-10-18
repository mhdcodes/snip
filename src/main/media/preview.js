// Playable copies of formats the preview can't show.

import { DEFAULT_FPS } from "./probe.js";
import { fitResolution } from "./presets.js";
import { run } from "./run.js";

// preview converts the source into an h264 copy that Chromium can play, for formats it
// can't, like HEVC or WMV. The copy is small and has a keyframe every second, so seeking
// stays quick; conversions still read the original. onProgress gets { percent }.
export function preview(source, input, file, onProgress, signal) {
  const res = fitResolution(source.video, 960, 540, DEFAULT_FPS);
  const args = [
    "-i", input,
    "-map", "0:v:0", "-map", "0:a:0?", "-sn", "-dn",
    "-vf", `scale=${res.width}:${res.height}:flags=bilinear,format=yuv420p`,
    "-c:v", "libx264", "-preset:v", "ultrafast", "-crf:v", "26",
    "-g", String(Math.max(1, Math.round(source.video.fps))),
    "-c:a", "aac", "-b:a", "128k", "-ac", "2",
    "-f", "mp4", "-movflags", "+faststart",
    file,
  ];
  return run([{ args, file, type: "video/mp4" }], source.container.duration, ({ percent }) => onProgress({ percent }), signal);
}
