// Turning instructions into ffmpeg commands.
//
// A command is { args, file, type }: the arguments after "ffmpeg", the file it writes and
// that file's mime type.
//
// paths tells the builder where files live: { input, concat, dir, name }. concat is the
// concat list, only used with several cuts, dir is where outputs go and name is the base
// name for outputs, without extension. For commands shown to the user, plain file names
// keep the output readable.

import path from "node:path";
import { cropIsZero, duration } from "./format.js";
import { estimateH264Size } from "./presets.js";

// build creates the ffmpeg commands that turn the source into the target.
// They have to run in order; the last one writes the result.
export function build(source, ins, paths, encoders) {
  if (ins.modification.cuts.length === 0) throw new Error("no cuts selected");
  const out = (ext) => path.join(paths.dir ?? "", paths.name + ext);

  if (ins.video.codec.startsWith("h264")) {
    const args = [...inputArgs(source, ins, paths), "-sn", "-dn", ...h264Args(source, ins)]; // mp4 can't hold most subtitle and data streams
    if (ins.audio.codec === "none") {
      args.push("-an");
    } else if (ins.audio.codec.startsWith("aac")) {
      args.push(...aacArgs(ins, encoders));
    } else {
      throw new Error(`unsupported audio codec: ${ins.audio.codec}`);
    }
    const file = out(".clip.mp4");
    args.push(
      "-f", "mp4", // mp4 is the most compatible container for h264 and aac
      "-movflags", "+faststart+use_metadata_tags", // metadata first for streaming, keep tags like hdr10
      file,
    );
    return [{ args, file, type: "video/mp4" }];
  }

  if (ins.video.codec.startsWith("gif")) {
    const palette = out(".palette.png");
    const filters = cropScaleFilters(source, ins);

    // pass 1: build a color palette, keyframes are enough for that
    const pass1 = [
      "-skip_frame", "nokey",
      ...inputArgs(source, ins, paths),
      "-an", "-sn", "-dn",
      "-vf", [...filters, "palettegen=stats_mode=diff"].join(","),
      "-frames:v", "1", "-update", "1", palette,
    ];

    // pass 2: render the gif with that palette
    const chain = ["fps=100/6", ...filters, "mpdecimate=lo=64:frac=0.1"];
    const gif = out(".clip.gif");
    const pass2 = [
      ...inputArgs(source, ins, paths),
      "-i", palette, "-an", "-sn", "-dn",
      "-filter_complex", `[0:v]${chain.join(",")}[v];[v][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`,
      gif,
    ];

    return [
      { args: pass1, file: palette, type: "image/png" },
      { args: pass2, file: gif, type: "image/gif" },
    ];
  }

  throw new Error(`unsupported video codec: ${ins.video.codec}`);
}

// concatList is the ffconcat file that joins several cuts.
export function concatList(input, cuts) {
  const quoted = `'${input.replaceAll("'", "'\\''")}'`;
  const lines = ["ffconcat version 1.0"];
  for (const c of cuts) {
    lines.push("", `file ${quoted}`, `inpoint ${secs(c.start)}`, `outpoint ${secs(c.start + c.duration)}`);
  }
  return lines.join("\n") + "\n";
}

function inputArgs(source, ins, paths) {
  const cuts = ins.modification.cuts;
  if (cuts.length > 1) return ["-safe", "0", "-f", "concat", "-i", paths.concat];
  const c = cuts[0];
  const args = [];
  if (c.start > source.container.start) args.push("-ss", secs(c.start));
  if (c.duration < source.container.duration - c.start) args.push("-t", secs(c.duration));
  return [...args, "-i", paths.input];
}

function cropScaleFilters(source, ins) {
  // ffmpeg applies the display rotation before the filters (for concat inputs too since
  // ffmpeg 6), so crop and scale work on the video as it is displayed
  const filters = [];
  const c = ins.modification.crop;
  if (!cropIsZero(c)) {
    const { width: w, height: h } = source.video;
    filters.push(
      `crop=${Math.round(w * (1 - c.left - c.right))}:${Math.round(h * (1 - c.top - c.bottom))}:${Math.round(w * c.left)}:${Math.round(h * c.top)}`,
    );
  }
  filters.push(`scale=${Math.trunc(ins.video.width)}:${Math.trunc(ins.video.height)}:flags=bilinear`);
  return filters;
}

function h264Args(source, ins) {
  if (ins.video.original) return ["-c:v", "copy"];

  const v = ins.video;
  const filters = [`fps=${num(v.fps)}`, ...cropScaleFilters(source, ins), `format=${v.color}`];
  const args = [
    "-vf", filters.join(","),
    "-c:v", "libx264",
    "-preset:v", v.width * v.height > 500_000 ? "fast" : "medium",
    "-profile:v", "high",
  ];

  // cap the bitrate over a short window so file size targets hold
  const buffer = Math.min(10, duration(ins.modification) / 4);
  let crf = 18;
  let maxrate = v.bitrate;
  if (v.crf > 0) {
    crf = v.crf;
    maxrate = estimateH264Size(v.width, v.height, v.fps, v.crf, 8);
  }
  return [
    ...args,
    "-crf:v", String(crf),
    "-maxrate:v", `${Math.trunc(maxrate)}k`,
    "-bufsize:v", `${Math.trunc(maxrate * buffer)}k`,
  ];
}

function aacArgs(ins, encoders) {
  const a = ins.audio;
  if (a.original) return ["-c:a", "copy"];

  // aresample=async fills gaps and trims overlaps, like the old -async 1 option
  const args = ["-af", `aresample=async=1,aformat=sample_rates=${a.sampleRate}:channel_layouts=${a.channelSetup}`];
  const bitrate = `${Math.trunc(a.bitrate)}k`;
  if (!encoders.fdkAAC) return [...args, "-c:a", "aac", "-b:a", bitrate];
  args.push("-c:a", "libfdk_aac", "-b:a", bitrate);
  if (a.bitrate <= 48) args.push("-profile:a", "aac_he_v2");
  else if (a.bitrate <= 72) args.push("-profile:a", "aac_he");
  return args;
}

// secs formats a time in seconds with millisecond precision.
function secs(f) {
  return f.toFixed(3);
}

// num formats with up to 4 decimals and no trailing zeros.
export function num(f) {
  return f.toFixed(4).replace(/\.?0+$/, "");
}

const UNSAFE_NAME = /[^\p{L}\p{N}._ -]+/gu;

// baseName turns a video file name into a safe output base name.
export function baseName(name) {
  let base = path.posix.basename(name.replaceAll("\\", "/"));
  const dot = base.lastIndexOf(".");
  if (dot >= 0) base = base.slice(0, dot);
  base = base.replace(UNSAFE_NAME, "_").trim();
  return base === "" || base === "." ? "video" : base;
}
