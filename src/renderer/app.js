// The app: moves between the screens in index.html and talks to the main process.

import * as api from "./api.js";
import { openEditor } from "./editor.js";
import { formatCommand, num } from "./format.js";

const $ = (id) => document.getElementById(id);

let video = null; // the opened video: { id, name, metadata, thumbs, preview?, unplayable? }
let settings = null; // what the user picked: { modification, video, audio }
let editor = null; // the open editing bench, see editor.js
let currentPlan = null; // the main process's answer to settings, see api.plan
let planTicket = 0; // only the newest plan request may update the page
let job = null; // the running or finished conversion

// ---------- screens ----------

function show(view) {
  for (const section of document.querySelectorAll("section[data-view]")) {
    section.hidden = section.dataset.view !== view;
  }
  document.body.dataset.screen = view;
  if (view !== "convert" && editor) {
    editor.close();
    editor = null;
  }
  window.scrollTo({ top: 0 });
}

function showStart() {
  show("start");
  document.title = "snip";
}

// openVideo switches to the video that pick resolves to: one from the open dialog or a
// dropped file. pick resolves to null when the dialog was cancelled.
async function openVideo(pick) {
  if (document.body.dataset.screen === "converting") return;
  let opened;
  try {
    opened = await pick();
  } catch (error) {
    showBroken(String(error.message ?? error));
    return;
  }
  if (!opened) return;
  if (video) api.deleteVideo(video.id).catch(() => {});
  video = opened;
  currentPlan = null;

  settings = {
    modification: {
      cuts: [{ start: 0, duration: Math.min(video.metadata.container.duration, 60) }],
      crop: { top: 0, right: 0, bottom: 0, left: 0 },
    },
    video: remembered("video.preset") || "size_8mb",
    audio: "bitrate_high",
  };

  if (!(await canPlay(api.sourceURL(opened)))) {
    showPreparing();
    try {
      await api.makePreview(opened.id);
      opened.preview = true;
    } catch {
      opened.unplayable = true; // the editor shows thumbnails instead
    }
    if (video !== opened) return; // another video was opened, or this one closed, meanwhile
  }
  showConvert();
}

// canPlay loads the start of a video and tells whether Chromium shows it. Chromium plays
// fewer formats than ffmpeg reads: some fail outright, others, like HEVC without a
// hardware decoder, play their sound but have no picture.
function canPlay(url) {
  return new Promise((resolve) => {
    const probe = document.createElement("video");
    probe.muted = true;
    const done = (ok) => {
      clearTimeout(timer);
      probe.onloadeddata = probe.onerror = null;
      probe.removeAttribute("src");
      probe.load();
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), 8000);
    probe.onloadeddata = () => done(probe.videoWidth > 0);
    probe.onerror = () => done(false);
    probe.src = url;
  });
}

function showPreparing() {
  show("preparing");
  $("preparing-title").textContent = `Preparing ${video.name}`;
  drawPreparing(0);
}

function drawPreparing(percent) {
  $("preparing-bar").style.width = percent + "%";
  $("preparing-percent").textContent = num(percent, 1) + " %";
}

api.onPreview(({ id, percent }) => {
  if (video?.id === id && document.body.dataset.screen === "preparing") drawPreparing(percent);
});

function showBroken(message) {
  show("broken");
  $("broken-message").textContent = message;
}

// ---------- convert screen ----------

function showConvert() {
  show("convert");
  if (editor) editor.close();
  document.title = video.name;
  $("convert-title").textContent = `Convert ${video.name}`;

  editor = openEditor(video, settings.modification, (modification, done) => {
    settings.modification = modification;
    if (done) refreshPlan();
  });
  if (currentPlan) drawSettings(currentPlan);
  refreshPlan();
}

async function refreshPlan() {
  const ticket = ++planTicket;
  $("convert-button").disabled = true;
  try {
    const plan = await api.plan(video.id, settings);
    if (ticket !== planTicket) return;
    currentPlan = plan;
    $("plan-error").textContent = "";
    drawSettings(plan);
  } catch (error) {
    if (ticket !== planTicket) return;
    $("plan-error").textContent = error.message;
  }
}

function drawSettings(plan) {
  const chosenVideo = plan.instructions.video;
  const chosenAudio = plan.instructions.audio;
  const isGif = chosenVideo.codec.startsWith("gif");

  // quality, grouped like the presets are meant
  const groups = [
    ["File size", (f) => f.preset.startsWith("size")],
    ["Resolution", (f) => f.preset.startsWith("crf")],
    ["Special", (f) => !f.preset.startsWith("size") && !f.preset.startsWith("crf")],
  ];
  const videoSelect = $("video-select");
  videoSelect.innerHTML = "";
  for (const [label, belongs] of groups) {
    const group = document.createElement("optgroup");
    group.label = label;
    for (const format of plan.videoFormats.filter(belongs)) {
      group.append(new Option(PRESET_NAMES[format.preset], format.preset, false, format.preset === chosenVideo.preset));
    }
    if (group.children.length) videoSelect.append(group);
  }
  setDetail($("video-detail"), videoDetail(chosenVideo));

  const audioSelect = $("audio-select");
  audioSelect.innerHTML = "";
  for (const format of plan.audioFormats) {
    audioSelect.append(new Option(PRESET_NAMES[format.preset], format.preset, false, format.preset === chosenAudio.preset));
  }
  setDetail($("audio-detail"), audioDetail(chosenAudio));
  $("audio-field").hidden = isGif; // gifs have no sound

  $("convert-button").disabled = chosenVideo.implausible || chosenAudio.implausible;
  editor?.setMuted(chosenAudio.codec === "none");

  drawDetails(video.metadata, plan.target);
  drawCommands(plan);
}

const PRESET_NAMES = {
  size_8mb: "8 MB file (e.g. for email)",
  size_16mb: "16 MB file (e.g. for WhatsApp)",
  size_25mb: "25 MB file (e.g. for Discord)",
  crf_480p: "SD resolution (for animated images)",
  crf_720p: "HD resolution (for sharing online)",
  crf_1080p: "Best quality (for YouTube and similar)",
  gif_600p: "Animated GIF",
  none: "No audio",
  bitrate_low: "Low quality (speech and sound effects)",
  bitrate_high: "High quality",
};

function setDetail(element, [text, kind]) {
  element.textContent = text;
  element.className = "detail" + (kind ? " " + kind : "");
}

function videoDetail(v) {
  const size = `${num(v.width)}×${num(v.height)}`;
  const bitrate = num(Math.round(v.bitrate || 0));
  if (v.implausible) return [`Too long for this size: only ${bitrate} kbit/s would be left. Shorten the selection or pick a bigger size.`, "bad"];
  if (v.original) return [`Keeps the original ${size} stream at ~${bitrate} kbit/s`, "good"];
  if (v.preset.startsWith("crf")) return [`${size} at ${num(v.fps)} fps, CRF ${v.crf}`, ""];
  if (v.preset.startsWith("gif")) return [`${size} at ${num(v.fps)} fps`, ""];
  return [`${size} at ${num(v.fps)} fps, ~${bitrate} kbit/s`, ""];
}

function audioDetail(a) {
  const bitrate = num(Math.round(a.bitrate));
  if (a.codec === "none") return ["Removes the audio track", ""];
  if (a.original) return [`Keeps the original ${a.codec} track at ${bitrate} kbit/s`, "good"];
  return [`${a.codec} at ${bitrate} kbit/s`, ""];
}

$("video-select").onchange = (event) => {
  settings.video = event.target.value;
  remember("video.preset", settings.video);
  refreshPlan();
};

$("audio-select").onchange = (event) => {
  settings.audio = event.target.value;
  refreshPlan();
};

// ---------- details: what changes and which commands run ----------

function drawDetails(source, target) {
  const kbit = (value) => (value > 0 ? `~${num(value, 0)} kbit/s` : "unknown");
  const rows = [
    ["Duration", `${num(source.container.duration, 2, 2)} s`, `${num(target.container.duration, 2, 2)} s`],
    ["Video"],
    ["Codec", source.video.codec, target.video.codec],
    ["Resolution", `${source.video.width}×${source.video.height}`, `${target.video.width}×${target.video.height}`],
    ["Frame rate", `${num(source.video.fps)} fps`, `${num(target.video.fps)} fps`],
    ["Color format", source.video.color, target.video.color],
    ["Bitrate", kbit(source.video.bitrate), target.video.crf ? `< ${num(estimateBitrate(target.video), 0)} kbit/s` : kbit(target.video.bitrate)],
  ];
  if (source.audio.codec !== "none") {
    const none = target.audio.codec === "none";
    rows.push(
      ["Audio"],
      ["Codec", source.audio.codec, target.audio.codec],
      ["Sample rate", `${num(source.audio.sampleRate)} Hz`, none ? "–" : `${num(target.audio.sampleRate)} Hz`],
      ["Channels", source.audio.channelSetup, none ? "–" : target.audio.channelSetup],
      ["Bitrate", kbit(source.audio.bitrate), none ? "–" : kbit(target.audio.bitrate)],
    );
  }

  const table = $("details-table");
  table.innerHTML = "<thead><tr><th></th><th>Source</th><th>Result</th></tr></thead>";
  const body = document.createElement("tbody");
  for (const [label, from, to] of rows) {
    const row = body.insertRow();
    if (from === undefined) {
      row.className = "group";
      row.innerHTML = `<th colspan="3">${esc(label)}</th>`;
      continue;
    }
    const changed = from !== to ? ' class="changed"' : "";
    row.innerHTML = `<th>${esc(label)}</th><td>${esc(from)}</td><td${changed}>${esc(to)}</td>`;
  }
  table.append(body);
}

// estimateBitrate matches estimateH264Size in src/main/media/presets.js for 8 seconds, which gives kbit/s.
function estimateBitrate(v) {
  return Math.floor((v.width * v.height * 8 * Math.log2(v.fps)) / 20 / v.crf ** 2);
}

function drawCommands(plan) {
  const box = $("commands");
  box.innerHTML = "";
  const blocks = [];
  if (plan.concat) {
    blocks.push(`cat > concat.txt << 'EOF'\n${plan.concat}EOF`);
  }
  for (const args of plan.commands) {
    blocks.push(formatCommand(args));
  }
  for (const text of blocks) {
    const pre = document.createElement("pre");
    pre.textContent = text;
    box.append(pre);
  }
}

// ---------- converting ----------

$("settings").onsubmit = async (event) => {
  event.preventDefault();
  $("convert-button").disabled = true;
  try {
    job = await api.startJob(video.id, settings);
  } catch (error) {
    $("plan-error").textContent = error.message;
    $("convert-button").disabled = false;
    return;
  }
  showProgress();
};

function showProgress() {
  show("converting");
  $("progress-title").textContent = `Converting ${video.name}`;
  drawProgress(job);
}

function drawProgress(state) {
  const percent = Math.max(0, Math.min(100, state.progress || 0));
  $("progress-bar").style.width = percent + "%";
  $("progress-percent").textContent = num(percent, 1) + " %";
  $("progress-stats").textContent = state.message || "";
  document.title = `${num(percent, 0)} % · ${video.name}`;
}

api.onJob((state) => {
  if (job?.id !== state.id) return; // canceled meanwhile
  job = state;
  if (state.status === "running") drawProgress(state);
  if (state.status === "done") showDone(state);
  if (state.status === "failed") showFailed(state.error);
});

$("cancel-button").onclick = async () => {
  const id = job?.id;
  job = null;
  if (id) await api.cancelJob(id).catch(() => {});
  showConvert();
};

function showFailed(message) {
  show("failed");
  $("failed-title").textContent = `Converting ${video.name} failed`;
  $("failed-message").textContent = message;
  $("copy-report").textContent = "Copy error report";
  $("copy-report").classList.remove("copied");
  $("copy-report").onclick = async () => {
    const report = [
      "snip conversion failed",
      "",
      message,
      "",
      "Source:",
      JSON.stringify(video.metadata, null, 2),
      "",
      "Settings:",
      JSON.stringify(settings, null, 2),
    ].join("\n");
    await api.copyText(report);
    $("copy-report").textContent = "Copied";
    $("copy-report").classList.add("copied");
  };
}

function showDone(state) {
  show("done");
  const url = api.resultURL(state.id);
  const result = $("result");
  result.innerHTML = "";
  const isImage = state.type.startsWith("image/");
  const preview = document.createElement(isImage ? "img" : "video");
  preview.src = url;
  if (isImage) {
    preview.alt = state.fileName;
  } else {
    preview.controls = true;
    preview.autoplay = true;
    preview.playsInline = true;
  }
  result.append(preview);

  $("done-title").textContent = `Finished: ${state.fileName}`;
  $("save-button").textContent = `Save ${isImage ? "GIF" : "video"} (${num(Math.ceil(state.size / 1000))} kB)`;
  document.title = state.fileName;
  $("saved").hidden = true;
  $("save-button").onclick = async () => {
    $("save-button").disabled = true;
    try {
      const path = await api.saveResult(state.id);
      if (path) {
        $("saved").textContent = `Saved to ${path}`;
        $("saved").hidden = false;
      }
    } catch (error) {
      $("saved").textContent = String(error.message ?? error);
      $("saved").hidden = false;
    }
    $("save-button").disabled = false;
  };
}

// ---------- buttons shared by several screens ----------

document.addEventListener("click", (event) => {
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (action === "change") {
    if (video) api.deleteVideo(video.id).catch(() => {});
    video = null;
    job = null;
    currentPlan = null;
    showStart();
  }
  if (action === "retry") {
    if (job) api.cancelJob(job.id).catch(() => {}); // also deletes the old result
    job = null;
    showConvert();
  }
});

$("open-button").onclick = () => openVideo(api.openVideo);

// ---------- drop a file anywhere ----------

let dragDepth = 0;
const hasFiles = (event) => event.dataTransfer?.types.includes("Files");

window.addEventListener("dragenter", (event) => {
  if (!hasFiles(event)) return;
  dragDepth++;
  $("drop").hidden = false;
});
window.addEventListener("dragleave", () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) $("drop").hidden = true;
});
// without preventDefault the window would open the file itself
window.addEventListener("dragover", (event) => {
  if (hasFiles(event)) event.preventDefault();
});
window.addEventListener("drop", (event) => {
  event.preventDefault();
  dragDepth = 0;
  $("drop").hidden = true;
  const file = event.dataTransfer?.files[0];
  if (file) openVideo(() => api.openPath(api.pathForFile(file)));
});

// ---------- small helpers ----------

function esc(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

function remember(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

function remembered(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

showStart();
