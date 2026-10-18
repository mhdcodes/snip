// Descriptions of video files and of what the user changes about them.
//
// A format is { container, video, audio }:
//   container: { duration, start } in seconds
//   video: { preset?, original?, implausible?, codec, color, width, height, rotation, bitrate?, crf?, fps }
//     codec is like "h264 (High)", color like "yuv420p", bitrate in kbit/s (0 if unknown),
//     rotation is the display rotation in degrees, original means the stream is copied
//     from the source and implausible that the target can't be reached with it
//   audio: { preset?, original?, implausible?, codec, sampleRate, channelSetup, bitrate }
//     codec is like "aac (LC)" or "none"
//
// A modification is { cuts: [{ start, duration }], crop: { top, right, bottom, left } }.
// Cuts are the parts of the source that end up in the output; crop removes a fraction
// (0.0-1.0) of the frame from each side.

// NO_AUDIO is the audio format of a file without an audio track.
export const NO_AUDIO = Object.freeze({ preset: "none", codec: "none", sampleRate: 0, channelSetup: "none", bitrate: 0 });

export function cropIsZero(c) {
  return c.top === 0 && c.right === 0 && c.bottom === 0 && c.left === 0;
}

// duration is the length of the output.
export function duration(mod) {
  return mod.cuts.reduce((sum, c) => sum + c.duration, 0);
}

// container is the container format the output will have.
export function container(mod) {
  const start = mod.cuts.length ? Math.min(...mod.cuts.map((c) => c.start)) : 0;
  return { duration: duration(mod), start };
}

// croppedVideo is the source video as it looks after cropping.
export function croppedVideo(mod, v) {
  if (cropIsZero(mod.crop)) return v;
  return {
    ...v,
    width: v.width * (1 - mod.crop.left - mod.crop.right),
    height: v.height * (1 - mod.crop.top - mod.crop.bottom),
    original: false,
  };
}

// clean checks a modification from the page against the source and fixes rounding noise
// from the browser. Cuts must be ordered and must not overlap. It throws when the
// modification can't be used.
export function clean(mod, source) {
  const length = source.container.duration;
  const cuts = [];
  let end = 0;
  for (const raw of Array.isArray(mod?.cuts) ? mod.cuts : []) {
    const start = Math.max(number(raw?.start), 0);
    const c = { start, duration: Math.min(number(raw?.duration), length - start) };
    if (c.duration < 0.01) continue;
    if (c.start < end - 0.001) throw new Error("cuts overlap or are out of order");
    end = c.start + c.duration;
    cuts.push(c);
  }
  if (cuts.length === 0) throw new Error("select at least one part of the video");

  const crop = {};
  for (const side of ["top", "right", "bottom", "left"]) {
    crop[side] = Math.min(Math.max(Math.round(number(mod?.crop?.[side]) * 10000) / 10000, 0), 0.95);
  }
  if (crop.left + crop.right > 0.95 || crop.top + crop.bottom > 0.95) {
    throw new Error("the crop area is too small");
  }
  return { cuts, crop };
}

// target is the format of the file that instructions { modification, video, audio } produce.
export function target(ins) {
  return { container: container(ins.modification), video: ins.video, audio: ins.audio };
}

// number reads a number from ffprobe or the page, 0 when it isn't one.
export function number(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
