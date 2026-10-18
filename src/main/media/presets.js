// The quality presets offered for a source, and the choice between them.
//
// encoders is { fdkAAC }: libfdk_aac supports HE-AAC for low bitrates.

import { NO_AUDIO, container, croppedVideo } from "./format.js";

// GIF_FPS is the gif frame rate. GIF delays are in 1/100 s, so 6/100 s per frame is exact.
export const GIF_FPS = 100 / 6;

// fitResolution scales the source to fit a width x height box without upscaling.
// Orientation is ignored, so a portrait video fits a landscape box too.
export function fitResolution(v, width, height, fps) {
  const scale = Math.min(
    Math.min(width, height) / Math.min(v.width, v.height),
    Math.max(width, height) / Math.max(v.width, v.height),
    1,
  );
  return {
    // yuv420p needs dimensions divisible by 2
    width: Math.round((v.width * scale) / 2) * 2,
    height: Math.round((v.height * scale) / 2) * 2,
    fps,
    expectedWidth: width,
    expectedHeight: height,
  };
}

// dedupe drops a resolution when the next one in the list is identical.
function dedupe(list) {
  return list.filter((r, i) => {
    const next = list[i + 1];
    return !(next && next.width === r.width && next.height === r.height && next.fps === r.fps);
  });
}

// videoFormats lists the video presets for a source, in display order.
export function videoFormats(source) {
  const v = source.video;
  const rough = dedupe([
    fitResolution(v, 1920, 1080, 60),
    fitResolution(v, 1280, 720, 30),
    fitResolution(v, 640, 480, 30),
  ]);
  const fine = dedupe([
    fitResolution(v, 1280, 720, 30),
    fitResolution(v, 854, 480, 30),
    fitResolution(v, 640, 360, 30),
    fitResolution(v, 426, 240, 30),
  ]);
  const gif = [fitResolution(v, 600, 600, 30)];
  return [...sizeTargets(source, fine), ...gifTargets(gif), ...resolutionTargets(source, rough)];
}

// audioFormats lists the audio presets for a source.
export function audioFormats(source, encoders) {
  const out = [NO_AUDIO];
  const a = source.audio;
  if (a.codec === "none") return out;

  const sampleRate = a.sampleRate === 44100 ? 44100 : 48000;
  const stereo = { codec: "aac (LC)", sampleRate, channelSetup: "stereo" };
  out.push(
    encoders.fdkAAC
      ? { preset: "bitrate_low", ...stereo, codec: "aac (HE-AACv2)", bitrate: 32 }
      : // ffmpeg's built-in aac encoder only does AAC-LC, which needs more bits for usable speech
        { preset: "bitrate_low", ...stereo, bitrate: 64 },
  );

  if (a.original && a.codec.startsWith("aac") && a.bitrate > 0 && a.bitrate < 260) {
    out.push({ ...a, preset: "bitrate_high" });
  } else {
    out.push({ preset: "bitrate_high", ...stereo, bitrate: 192 });
  }
  return out;
}

// targetFPS picks the source fps divided by the smallest integer that lands at or below max,
// so frames are dropped evenly.
function targetFPS(sourceFPS, max) {
  return sourceFPS / Math.ceil(sourceFPS / max);
}

// sizeTargets builds presets that aim for a file size. resolutions must be in descending order.
function sizeTargets(source, resolutions) {
  const out = [];
  const length = source.container.duration;
  for (const total of [8000, 16000, 25000]) {
    // kB
    const preset = `size_${total / 1000}mb`;

    // undershoot the target to leave room for container overhead and bitrate variance
    let sizeTarget = total * 0.88;
    let bitrateTarget = (sizeTarget * 8) / length - source.audio.bitrate;

    const res = resolutions.find((r) => sizeTarget >= estimateH264Size(r.width, r.height, r.fps, 28, length));
    if (!res || bitrateTarget < 100) {
      const worst = resolutions.at(-1);
      out.push({
        preset,
        implausible: true,
        codec: "h264 (High)",
        color: "yuv420p",
        width: worst.width,
        height: worst.height,
        rotation: 0,
        bitrate: Math.floor(bitrateTarget),
        fps: targetFPS(source.video.fps, worst.fps),
      });
      continue;
    }

    // don't spend more bits than a high quality encode would need
    const maxSize = estimateH264Size(res.width, res.height, res.fps, 18, length);
    const maxBitrate = (maxSize * 8) / length;
    if (maxBitrate < bitrateTarget) {
      sizeTarget = maxSize;
      bitrateTarget = maxBitrate;
    }

    // only the average bitrate is known, so divide by 6 instead of 8 for headroom
    const v = source.video;
    if (v.original && h264Level42Compatible(v) && v.bitrate > 0 && (v.bitrate * length) / 6 <= sizeTarget) {
      out.push({ ...v, preset });
      continue;
    }

    out.push({
      preset,
      codec: "h264 (High)",
      color: "yuv420p",
      width: res.width,
      height: res.height,
      rotation: 0,
      bitrate: Math.floor(bitrateTarget),
      fps: targetFPS(source.video.fps, res.fps),
    });
  }
  return out;
}

// resolutionTargets builds constant quality presets. resolutions must be in descending order.
function resolutionTargets(source, resolutions) {
  const length = source.container.duration;
  return resolutions.toReversed().map((res) => {
    const preset = `crf_${res.expectedHeight}p`;
    const v = source.video;

    // allow 50% leeway, so the 720p target accepts a 1080p original
    if (
      v.original &&
      h264Level42Compatible(v) &&
      v.width <= res.expectedWidth * 1.5 &&
      v.height <= res.expectedHeight * 1.5 &&
      v.bitrate > 0 &&
      (v.bitrate * length) / 8 <= estimateH264Size(res.width, res.height, res.fps, 18, length)
    ) {
      return { ...v, preset };
    }
    return {
      preset,
      codec: "h264 (High)",
      color: "yuv420p",
      width: res.width,
      height: res.height,
      rotation: 0,
      crf: res.expectedHeight === 1080 ? 18 : 21,
      fps: targetFPS(source.video.fps, res.fps),
    };
  });
}

function gifTargets(resolutions) {
  return resolutions.toReversed().map((res) => ({
    preset: `gif_${res.expectedHeight}p`,
    codec: "gif",
    color: "bgra",
    width: res.width,
    height: res.height,
    rotation: 0,
    fps: GIF_FPS,
  }));
}

// h264Level42Compatible reports whether a stream can be copied into a widely playable mp4.
function h264Level42Compatible(v) {
  // level 4.2 allows 8704 macroblocks of 16x16 pixels
  const macroblocks = Math.ceil(v.width / 16) * Math.ceil(v.height / 16);
  return v.codec.startsWith("h264") && v.color === "yuv420p" && macroblocks <= 8704 && v.fps <= 60;
}

// estimateH264Size guesses the size in kB of an h264 stream. Real sizes vary a lot with
// content, so this is only good for sanity checks. CRF 18 is good quality, 28 is poor.
// With a duration of 8 seconds the result equals kbit/s.
export function estimateH264Size(width, height, fps, crf, length) {
  return Math.floor((width * height * length * Math.log2(fps)) / 20 / (crf * crf));
}

// choose picks the presets the user asked for, falling back to the defaults. It returns
// the instructions { modification, video, audio } and the presets to choose from.
// GIFs have no audio, so the audio is dropped for them.
export function choose(source, mod, encoders, videoPreset, audioPreset) {
  const audios = audioFormats(source, encoders);
  let audio = pick(audios, audioPreset, "bitrate_high");

  const videos = videoFormats({
    container: container(mod), // presets depend on the output length
    video: croppedVideo(mod, source.video),
    audio, // size targets leave room for the audio
  });
  const video = pick(videos, videoPreset, "size_8mb");
  if (video.codec.startsWith("gif")) audio = NO_AUDIO;

  return { instructions: { modification: mod, video, audio }, videoFormats: videos, audioFormats: audios };
}

// pick returns the format named want, else the one named fallback, else the first.
function pick(list, want, fallback) {
  return list.find((f) => f.preset === want) ?? list.find((f) => f.preset === fallback) ?? list[0];
}
