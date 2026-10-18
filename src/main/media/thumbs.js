// The timeline thumbnails of a video.

import { spawn } from "node:child_process";
import path from "node:path";
import { num } from "./commands.js";
import { DEFAULT_FPS } from "./probe.js";
import { fitResolution } from "./presets.js";

// thumbInterval is the time between timeline thumbnails, giving about 30 of them.
export function thumbInterval(length) {
  return Math.max(length / 30, 0.5);
}

// thumbCount is how many thumbnails thumbnails writes.
export function thumbCount(length) {
  return Math.ceil(length / thumbInterval(length));
}

// thumbPath is where thumbnail n (starting at 1) ends up.
export function thumbPath(dir, n) {
  return path.join(dir, `thumb_${n}.jpg`);
}

// thumbnails writes preview frames into dir and resolves once ffmpeg exits. They appear
// one by one, so a frame is complete once the next one exists or the promise has settled.
export function thumbnails(source, input, dir, signal) {
  const interval = thumbInterval(source.container.duration);
  const res = fitResolution(source.video, 640, 360, DEFAULT_FPS);

  const args = [];
  if (interval >= 2) args.push("-skip_frame", "nokey"); // keyframes are close enough and much faster to decode
  args.push(
    "-hide_banner", "-nostdin", "-loglevel", "error",
    "-flags2", "fast",
    "-i", input,
    "-an", "-sn", "-dn",
    "-vf", `fps=1/${num(interval)},scale=${res.width}:${res.height}:flags=bilinear`,
    "-q:v", "5",
    "-f", "image2",
    path.join(dir, "thumb_%d.jpg"),
  );

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", args, { stdio: "ignore", windowsHide: true, signal });
    ffmpeg.on("error", (error) => error.name !== "AbortError" && reject(error));
    ffmpeg.on("close", (code) => (code === 0 || signal?.aborted ? resolve() : reject(new Error(`ffmpeg exit code ${code}`))));
  });
}
