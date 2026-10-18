import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { baseName, build, concatList, num } from "../src/main/media/commands.js";
import { clean, cropIsZero } from "../src/main/media/format.js";
import { DEFAULT_FPS, parseProbe } from "../src/main/media/probe.js";
import { audioFormats, choose, fitResolution, videoFormats } from "../src/main/media/presets.js";

const noCrop = { top: 0, right: 0, bottom: 0, left: 0 };

function source(width, height, fps, duration, bitrate) {
  return {
    container: { duration, start: 0 },
    video: { original: true, codec: "h264 (High)", color: "yuv420p", width, height, rotation: 0, fps, bitrate },
    audio: { original: true, codec: "aac (LC)", sampleRate: 48000, channelSetup: "stereo", bitrate: 128 },
  };
}

const presets = (formats) => formats.map((f) => f.preset);

test("video presets come in display order", () => {
  assert.deepEqual(presets(videoFormats(source(1920, 1080, 30, 30, 8000))), [
    "size_8mb", "size_16mb", "size_25mb", "gif_600p", "crf_480p", "crf_720p", "crf_1080p",
  ]);
});

test("fitResolution keeps the orientation and never upscales", () => {
  const portrait = fitResolution({ width: 1080, height: 1920 }, 1280, 720, 30);
  assert.equal(`${portrait.width}x${portrait.height}`, "720x1280");
  const small = fitResolution({ width: 320, height: 240 }, 1920, 1080, 30);
  assert.equal(`${small.width}x${small.height}`, "320x240");
  const odd = fitResolution({ width: 1000, height: 563 }, 640, 360, 30);
  assert.ok(odd.width % 2 === 0 && odd.height % 2 === 0, `odd fit = ${odd.width}x${odd.height}, want even dimensions`);
});

test("a size target that is too long is implausible", () => {
  const formats = videoFormats(source(1920, 1080, 30, 3600, 8000)); // an hour can't fit in 8 MB
  assert.ok(formats[0].implausible, JSON.stringify(formats[0]));
});

test("a size target copies a small original", () => {
  const formats = videoFormats(source(1280, 720, 30, 10, 800)); // 10 s at 800 kbit/s is about 1 MB
  assert.ok(formats[0].original, JSON.stringify(formats[0]));
  assert.equal(formats[0].preset, "size_8mb");
});

test("a size target leaves room for the audio", () => {
  const bitrate = videoFormats(source(1920, 1080, 30, 60, 20000))[0].bitrate;
  assert.equal(bitrate, Math.floor((8000 * 0.88 * 8) / 60 - 128));
});

test("duplicate resolutions collapse", () => {
  // 1080p@60 keeps a different frame rate, 720p and 480p both end up at 640x360@30
  assert.deepEqual(presets(videoFormats(source(640, 360, 30, 10, 0))), [
    "size_8mb", "size_16mb", "size_25mb", "gif_600p", "crf_480p", "crf_1080p",
  ]);
});

test("choose drops the audio for a GIF and falls back to the defaults", () => {
  const src = source(1280, 720, 30, 10, 3000);
  const mod = { cuts: [{ start: 0, duration: 5 }], crop: noCrop };
  assert.equal(choose(src, mod, {}, "gif_600p", "bitrate_high").instructions.audio.codec, "none");
  const { video, audio } = choose(src, mod, {}, "does-not-exist", "").instructions;
  assert.equal(`${video.preset}/${audio.preset}`, "size_8mb/bitrate_high");
});

test("the low audio preset depends on the encoder", () => {
  const src = source(1280, 720, 30, 10, 3000);
  const fdk = audioFormats(src, { fdkAAC: true })[1];
  assert.equal(`${fdk.codec} ${fdk.bitrate}`, "aac (HE-AACv2) 32");
  const builtin = audioFormats(src, {})[1];
  assert.equal(`${builtin.codec} ${builtin.bitrate}`, "aac (LC) 64");
  assert.ok(audioFormats(src, {})[2].original, "high quality should keep a 128 kbit/s aac original");
});

test("build a single cut", () => {
  const src = source(1920, 1080, 30, 60, 20000);
  const mod = { cuts: [{ start: 5, duration: 10 }], crop: { ...noCrop, left: 0.25, right: 0.25 } };
  const { instructions } = choose(src, mod, {}, "crf_720p", "bitrate_high");
  const args = build(src, instructions, { input: "in.mp4", name: "in" }, {})[0].args.join(" ");
  for (const want of ["-ss 5.000 -t 10.000 -i in.mp4", "crop=960:1080:480:0", "-c:v libx264", "-crf:v 21", "-c:a copy", "in.clip.mp4"]) {
    assert.ok(args.includes(want), `args missing ${want}:\n${args}`);
  }
});

test("a GIF takes two passes", () => {
  const src = source(1280, 720, 30, 10, 3000);
  const { instructions } = choose(src, { cuts: [{ start: 0, duration: 10 }], crop: noCrop }, {}, "gif_600p", "");
  const cmds = build(src, instructions, { input: "in.mp4", dir: "/tmp/x", name: "in" }, {});
  assert.deepEqual(cmds.map((c) => c.file), [path.join("/tmp/x", "in.palette.png"), path.join("/tmp/x", "in.clip.gif")]);
  assert.ok(!cmds[0].args.includes("-ss"), `full length cut should not seek: ${cmds[0].args}`);
});

test("concatList quotes paths", () => {
  const got = concatList("/videos/it's.mp4", [{ start: 1, duration: 2 }, { start: 5, duration: 1.5 }]);
  const want =
    "ffconcat version 1.0\n\nfile '/videos/it'\\''s.mp4'\ninpoint 1.000\noutpoint 3.000\n\nfile '/videos/it'\\''s.mp4'\ninpoint 5.000\noutpoint 6.500\n";
  assert.equal(got, want);
});

test("clean trims and checks the modification", () => {
  const src = source(1280, 720, 30, 10, 3000);
  const mod = clean({ cuts: [{ start: 8, duration: 5 }], crop: { ...noCrop, top: 1e-12 } }, src);
  assert.equal(mod.cuts[0].duration, 2);
  assert.ok(cropIsZero(mod.crop));
  assert.throws(() => clean({ cuts: [{ start: 1, duration: 5 }, { start: 3, duration: 1 }] }, src), /overlap/);
  assert.throws(() => clean({}, src), /at least one part/);
  assert.throws(() => clean({ cuts: [{ start: 0, duration: 1 }], crop: { left: 0.5, right: 0.5 } }, src), /too small/);
});

test("parseProbe applies the rotation", () => {
  const raw = `{"streams":[
    {"codec_type":"video","codec_name":"h264","profile":"High","pix_fmt":"yuv420p","width":1920,"height":1080,
     "avg_frame_rate":"30000/1001","r_frame_rate":"30000/1001","bit_rate":"8000000",
     "side_data_list":[{"side_data_type":"Display Matrix","rotation":-90}]},
    {"codec_type":"audio","codec_name":"aac","profile":"LC","sample_rate":"44100","channels":2,"channel_layout":"stereo","bit_rate":"128000"}],
    "format":{"duration":"12.5"}}`;
  const f = parseProbe(raw, 0);
  assert.equal(`${f.video.width}x${f.video.height} ${f.video.rotation}`, "1080x1920 -90");
  assert.equal(`${f.video.codec} ${f.video.fps} ${f.video.bitrate}`, "h264 (High) 29.97 8000");
  assert.equal(`${f.audio.codec} ${f.audio.bitrate} ${f.container.duration}`, "aac (LC) 128 12.5");
});

test("parseProbe falls back for browser recordings", () => {
  // no duration, absurd frame rate, no audio
  const raw = `{"streams":[{"codec_type":"video","codec_name":"vp8","pix_fmt":"yuv420p","width":1280,"height":720,
    "avg_frame_rate":"0/0","r_frame_rate":"1000/1"}],"format":{}}`;
  const f = parseProbe(raw, 7);
  assert.equal(f.video.fps, DEFAULT_FPS);
  assert.equal(f.container.duration, 7);
  assert.equal(f.audio.codec, "none");
  assert.throws(() => parseProbe(`{"streams":[{"codec_type":"audio"}],"format":{"duration":"3"}}`, 0), /no video stream/);
});

test("baseName makes safe output names", () => {
  const cases = {
    "holiday.mp4": "holiday",
    "C:\\Users\\me\\clip 1.mov": "clip 1",
    "../../etc/passwd": "passwd",
    "weird'\"name$.mkv": "weird_name_",
    ".mp4": "video",
  };
  for (const [input, want] of Object.entries(cases)) assert.equal(baseName(input), want, input);
});

test("num trims trailing zeros", () => {
  assert.equal(num(100 / 6), "16.6667");
  assert.equal(num(30), "30");
});
