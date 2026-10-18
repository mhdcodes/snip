// Reading video files with ffprobe, and checking what the installed ffmpeg can do.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { number } from "./format.js";

const exec = promisify(execFile);

// DEFAULT_FPS is assumed when a file doesn't report a usable frame rate.
export const DEFAULT_FPS = 30;

// probe reads the format of a video file, see format.js.
// fallbackDuration is used for files without a duration, like browser screen recordings.
export async function probe(path, fallbackDuration = 0, signal) {
  let stdout;
  try {
    ({ stdout } = await exec(
      "ffprobe",
      ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", path],
      { maxBuffer: 64 << 20, windowsHide: true, signal },
    ));
  } catch (error) {
    throw new Error(`ffprobe: ${(error.stderr || error.message).trim()}`, { cause: error });
  }
  return parseProbe(stdout, fallbackDuration);
}

export function parseProbe(raw, fallbackDuration) {
  let p;
  try {
    p = JSON.parse(raw);
  } catch (error) {
    throw new Error(`parse ffprobe output: ${error.message}`, { cause: error });
  }

  const f = {
    container: { duration: number(p.format?.duration), start: 0 },
    video: null,
    audio: { codec: "none", sampleRate: 0, channelSetup: "none", bitrate: 0 },
  };
  let foundAudio = false;
  for (const s of p.streams ?? []) {
    if (s.codec_type === "video" && !f.video && !s.disposition?.attached_pic) {
      f.video = {
        original: true,
        codec: withProfile(s.codec_name, s.profile),
        color: s.pix_fmt ?? "",
        width: s.width ?? 0,
        height: s.height ?? 0,
        rotation: 0,
        bitrate: number(s.bit_rate) / 1000,
        fps: frameRate(s.avg_frame_rate, s.r_frame_rate),
      };
      if (f.container.duration === 0) f.container.duration = number(s.duration);

      // phones often store the video sideways with a rotation hint,
      // ffmpeg applies it automatically but reports the stored dimensions
      let rotation = 0;
      for (const sd of s.side_data_list ?? []) {
        if (typeof sd.rotation === "number") rotation = Math.round(sd.rotation);
      }
      if (rotation === 0 && s.tags?.rotate) {
        rotation = -Math.trunc(number(s.tags.rotate)); // the tag counts clockwise, the matrix counter-clockwise
      }
      rotation %= 360;
      if (rotation % 90 === 0 && rotation !== 0) {
        f.video.rotation = rotation;
        if (rotation % 180 !== 0) [f.video.width, f.video.height] = [f.video.height, f.video.width];
      }
    } else if (s.codec_type === "audio" && !foundAudio) {
      foundAudio = true;
      f.audio = {
        original: true,
        codec: withProfile(s.codec_name, s.profile),
        sampleRate: Math.trunc(number(s.sample_rate)),
        channelSetup: s.channel_layout || `${s.channels ?? 0} channels`,
        bitrate: number(s.bit_rate) / 1000,
      };
    }
  }

  if (!f.video) throw new Error("the file contains no video stream");
  if (f.video.width <= 0 || f.video.height <= 0) throw new Error("the video stream has no dimensions");
  if (f.container.duration <= 0) f.container.duration = fallbackDuration;
  if (f.container.duration <= 0) throw new Error("the video duration is unknown");
  return f;
}

function withProfile(codec = "", profile) {
  return !profile || profile === "unknown" ? codec : `${codec} (${profile})`;
}

// frameRate prefers the average frame rate and ignores absurd values,
// which variable frame rate recordings report as 1000 fps.
function frameRate(...rates) {
  for (const r of rates) {
    const [num, den] = String(r ?? "").split("/");
    let fps = number(num);
    if (den !== undefined) {
      const d = number(den);
      fps = d > 0 ? fps / d : 0;
    }
    if (fps > 0 && fps <= 240) return Math.round(fps * 1000) / 1000;
  }
  return DEFAULT_FPS;
}

// detectEncoders checks which optional encoders the installed ffmpeg has. It throws when
// ffmpeg is missing or can't encode h264.
export async function detectEncoders() {
  let stdout;
  try {
    ({ stdout } = await exec("ffmpeg", ["-hide_banner", "-encoders"], { maxBuffer: 16 << 20, windowsHide: true }));
  } catch (error) {
    const message =
      error.code === "ENOENT" ? "ffmpeg not found in PATH, install ffmpeg first" : `run ffmpeg: ${error.message}`;
    throw new Error(message, { cause: error });
  }
  const names = new Set(stdout.split("\n").map((line) => line.trim().split(/\s+/)[1]));
  if (!names.has("libx264")) throw new Error("ffmpeg was built without libx264");
  return { fdkAAC: names.has("libfdk_aac") };
}
