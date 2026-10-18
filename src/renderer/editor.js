// The editing bench: video preview, crop box and film strip timeline.
//
// Times are in seconds. A "cut" is a part of the video that ends up in the result:
// { start, duration }. Cuts are kept in order and never overlap.
// The crop removes a fraction (0-1) of the frame on each side: { top, right, bottom, left }.

import { sourceURL, thumbURL } from "./api.js";
import { formatTime, parseTime } from "./format.js";

const PLAY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>';
const MIN_CUT = 0.05; // shortest selection, in seconds

const $ = (id) => document.getElementById(id);

// openEditor wires up the convert screen for one video.
// onChange(modification, done) is called on every edit; done is false while dragging.
// It returns { setMuted, close }.
export function openEditor(video, modification, onChange) {
  const meta = video.metadata;
  const duration = meta.container.duration;
  const frame = 1 / meta.video.fps;
  const mod = structuredClone(modification);

  const stage = $("stage");
  const player = $("preview");
  const fallback = $("preview-fallback");
  const film = $("film");

  let cursor = mod.cuts[0].start;
  let paused = true;
  let dragging = false;
  let canPlayVideo = true;
  let thumbs = [];
  let closed = false;
  let frameRequest = 0;

  // ---------- preview ----------

  const ratio = meta.video.width / meta.video.height;
  stage.style.aspectRatio = `${meta.video.width} / ${meta.video.height}`;
  // fill the space around it, see .stage-box
  stage.style.width = `min(100cqw, calc(100cqh * ${ratio}))`;

  player.hidden = false;
  fallback.hidden = true;
  $("preview-empty").hidden = true;
  player.onerror = () => {
    // the browser can't decode this format, show thumbnails instead
    canPlayVideo = false;
    player.hidden = true;
    player.removeAttribute("src");
    showFallbackFrame();
  };
  if (video.unplayable) player.onerror();
  else player.src = sourceURL(video);

  function showFallbackFrame() {
    if (canPlayVideo) return;
    const index = Math.min(Math.floor(cursor / video.thumbs.interval), thumbs.length - 1);
    fallback.hidden = thumbs.length === 0;
    $("preview-empty").hidden = thumbs.length > 0;
    if (index >= 0 && fallback.src !== thumbs[index]) {
      fallback.src = thumbs[index];
    }
  }

  // ---------- playback ----------

  function isPlaying() {
    const c = mod.cuts[0];
    return !paused && !dragging && cursor >= c.start - frame && cursor <= c.start + c.duration - frame;
  }

  function setCursor(time, fromPlayer = false) {
    cursor = clamp(time, 0, duration);
    if (!fromPlayer && canPlayVideo && Math.abs(player.currentTime - cursor) > frame) {
      player.currentTime = cursor;
    }
    drawCursor();
    syncPlayback();
  }

  // followPlayback moves the cursor while playing and keeps it inside the selection.
  function followPlayback(time) {
    const c = mod.cuts[0];
    if (time < c.start) {
      setCursor(c.start);
    } else if (time < c.start + c.duration - frame) {
      setCursor(time, true);
    } else {
      setCursor(c.start + c.duration);
    }
  }

  function togglePlay() {
    if (isPlaying()) {
      paused = true;
    } else {
      paused = false;
      const c = mod.cuts[0];
      if (cursor < c.start || cursor > c.start + c.duration - Math.min(1, c.duration / 2)) {
        setCursor(c.start);
      }
    }
    syncPlayback();
  }

  function syncPlayback() {
    const playing = isPlaying();
    // only redraw on a change: this runs every frame while playing, and replacing the
    // icon between mouse down and up makes the browser drop the click
    const label = playing ? "Pause" : "Play";
    if ($("play").getAttribute("aria-label") !== label) {
      $("play").innerHTML = playing ? PAUSE_ICON : PLAY_ICON;
      $("play").setAttribute("aria-label", label);
    }

    if (canPlayVideo) {
      if (playing && player.paused) {
        player.play().catch(() => {
          paused = true;
          syncPlayback();
        });
      }
      if (!playing && !player.paused) {
        player.pause();
      }
    }
    if (playing && !frameRequest) {
      let last = performance.now();
      // frameRequest stays set while the loop runs: followPlayback calls back into
      // syncPlayback, which would otherwise start another loop on every frame.
      const tick = (now) => {
        if (closed || !isPlaying()) {
          frameRequest = 0;
          syncPlayback();
          return;
        }
        // without a playable video the cursor runs on the clock over the thumbnails
        followPlayback(canPlayVideo ? player.currentTime : cursor + (now - last) / 1000);
        last = now;
        frameRequest = requestAnimationFrame(tick);
      };
      frameRequest = requestAnimationFrame(tick);
    }
  }

  function drawCursor() {
    const percent = (cursor / duration) * 100;
    $("cursor").style.left = percent + "%";
    const stamp = $("stamp");
    stamp.textContent = formatTime(cursor);
    // keep the stamp inside the frame at both ends
    stamp.style.left = percent + "%";
    stamp.style.transform = `translateX(-${percent}%)`;
    showFallbackFrame();
  }

  $("play").onclick = togglePlay;

  function onKey(event) {
    const tag = event.target.tagName;
    if (event.key === " " && !["INPUT", "SELECT", "TEXTAREA", "BUTTON", "SUMMARY"].includes(tag)) {
      event.preventDefault();
      togglePlay();
    }
  }
  document.addEventListener("keydown", onKey);

  // ---------- dragging ----------

  // drag follows the pointer until it is released. move gets the start position and
  // the distance moved, both as fractions of the box element (0-1).
  function drag(event, box, move, end) {
    event.preventDefault();
    const rect = box.getBoundingClientRect();
    const x0 = (event.clientX - rect.left) / rect.width;
    const y0 = (event.clientY - rect.top) / rect.height;
    const step = (e) => {
      move({
        x0,
        y0,
        dx: (e.clientX - rect.left) / rect.width - x0,
        dy: (e.clientY - rect.top) / rect.height - y0,
        pointerType: event.pointerType,
      });
    };
    const stop = () => {
      document.removeEventListener("pointermove", step);
      document.removeEventListener("pointerup", stop);
      document.removeEventListener("pointercancel", stop);
      end();
    };
    document.addEventListener("pointermove", step);
    document.addEventListener("pointerup", stop);
    document.addEventListener("pointercancel", stop);
    step(event);
  }

  // ---------- timeline ----------

  function emit(done) {
    onChange(structuredClone(mod), done);
  }

  // setSelection replaces the part of the video that is kept.
  function setSelection(cut, done) {
    mod.cuts = [cut];
    drawCuts();
    drawParts();
    emit(done);
  }

  // dragTimeline edits the selection while dragging. update gets the pointer data and the
  // selection as it was when the drag started, and returns the new selection.
  function dragTimeline(event, update) {
    const before = { ...mod.cuts[0] };
    let latest = before;
    dragging = true;
    syncPlayback();
    drag(
      event,
      film,
      (pointer) => {
        latest = update(pointer, before);
        setSelection(latest, false);
      },
      () => {
        dragging = false;
        setSelection(latest, true);
        syncPlayback();
      },
    );
  }

  function timeAt(event) {
    const rect = film.getBoundingClientRect();
    return clamp(((event.clientX - rect.left) / rect.width) * duration, 0, duration);
  }

  function scrub(event) {
    if (!dragging && !isPlaying() && event.pointerType === "mouse") {
      setCursor(timeAt(event));
    }
  }

  function drawCuts() {
    const box = $("cuts");
    box.innerHTML = "";
    const cut = mod.cuts[0];
    const pct = (time) => (time / duration) * 100 + "%";

    // dimmed film on both sides; dragging on it selects a new part
    for (const [from, to] of [[0, cut.start], [cut.start + cut.duration, duration]]) {
      if (to - from <= 0) continue;
      const gap = document.createElement("div");
      gap.className = "gap";
      gap.style.left = pct(from);
      gap.style.width = pct(to - from);
      gap.onpointermove = scrub;
      gap.onpointerdown = (event) =>
        dragTimeline(event, ({ x0, dx }, before) => {
          const start = x0 * duration;
          const end = clamp(start + dx * duration, 0, duration);
          if (Math.abs(end - start) < MIN_CUT) return before; // a click, not a drag
          setCursor(end);
          return { start: Math.min(start, end), duration: Math.abs(end - start) };
        });
      box.append(gap);
    }

    // the taped body: drag to move it
    const body = document.createElement("div");
    body.className = "cut";
    body.style.left = pct(cut.start);
    body.style.width = pct(cut.duration);
    body.onpointermove = scrub;
    body.onpointerdown = (event) => {
      if (event.pointerType !== "mouse") {
        // on touch screens dragging the body scrubs instead, moving it is too fiddly
        const start = cursor;
        drag(event, film, ({ dx }) => setCursor(clamp(start + dx * duration, 0, duration)), () => {});
        return;
      }
      dragTimeline(event, ({ dx }, before) => {
        const move = clamp(dx * duration, -before.start, duration - before.duration - before.start);
        setCursor(before.start + move);
        return { start: before.start + move, duration: before.duration };
      });
    };
    box.append(body);

    // handles at both ends resize the selection
    for (const side of ["start", "end"]) {
      const handle = document.createElement("div");
      handle.className = "handle";
      handle.tabIndex = 0;
      handle.setAttribute("role", "slider");
      handle.setAttribute("aria-label", `Selection ${side}`);
      handle.setAttribute("aria-valuetext", formatTime(side === "start" ? cut.start : cut.start + cut.duration));
      handle.style.left = pct(side === "start" ? cut.start : cut.start + cut.duration);

      const resize = (c, change) => {
        if (side === "start") {
          const d = clamp(change, -c.start, c.duration - MIN_CUT);
          setCursor(c.start + d);
          return { start: c.start + d, duration: c.duration - d };
        }
        const d = clamp(change, MIN_CUT - c.duration, duration - c.start - c.duration);
        setCursor(c.start + c.duration + d);
        return { start: c.start, duration: c.duration + d };
      };
      handle.onpointerenter = () => !dragging && !isPlaying() && setCursor(side === "start" ? cut.start : cut.start + cut.duration);
      handle.onpointerdown = (event) => dragTimeline(event, ({ dx }, before) => resize(before, dx * duration));
      handle.onkeydown = (event) => {
        const step = event.shiftKey ? 1 : frame;
        const change = { ArrowLeft: -step, ArrowRight: step }[event.key];
        if (change) {
          event.preventDefault();
          setSelection(resize({ ...mod.cuts[0] }, change), true);
          box.querySelectorAll(".handle")[side === "start" ? 0 : 1]?.focus();
        }
      };
      box.append(handle);
    }
  }

  // drawParts shows start, length and end of the selection as editable fields.
  function drawParts() {
    const box = $("parts");
    if (box.contains(document.activeElement)) {
      return; // don't replace the field someone is typing in
    }
    box.innerHTML = "";
    const cut = mod.cuts[0];
    const row = document.createElement("div");
    row.className = "part";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = "Selection";
    row.append(name);

    const field = (label, value, focusTime, apply) => {
      const wrap = document.createElement("label");
      wrap.textContent = label;
      const input = document.createElement("input");
      input.className = "timecode";
      input.inputMode = "decimal";
      input.value = formatTime(value);
      input.onfocus = () => {
        input.select();
        setCursor(focusTime);
      };
      input.onchange = () => {
        const time = parseTime(input.value);
        const changed = isNaN(time) ? { ...cut } : apply(time);
        input.blur();
        setSelection(changed, true);
        setCursor(changed.start);
      };
      input.onkeydown = (event) => event.key === "Enter" && (event.preventDefault(), input.onchange());
      wrap.append(input);
      row.append(wrap);
    };

    const end = cut.start + cut.duration;
    field("Start", cut.start, cut.start, (v) => ({ start: clamp(v, 0, duration - cut.duration), duration: cut.duration }));
    field("Length", cut.duration, end, (v) => ({ start: cut.start, duration: clamp(v, MIN_CUT, duration - cut.start) }));
    field("End", end, end, (v) => ({ start: cut.start, duration: clamp(v, cut.start + MIN_CUT, duration) - cut.start }));
    box.append(row);
  }

  // drawTicks puts time labels under the film at a readable spacing.
  function drawTicks() {
    const box = $("ticks");
    box.innerHTML = "";
    const step = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600].find((s) => duration / s <= 6) ?? 3600;
    for (let time = step; time < duration - step / 3; time += step) {
      const label = document.createElement("span");
      // the ticks row spans the play key too, so skip past it
      label.style.left = `calc(var(--tick-inset) + (100% - var(--tick-inset)) * ${time / duration})`;
      label.textContent = formatTime(time).replace(/\.00$/, "");
      box.append(label);
    }
  }

  // loadThumbs fetches the film strip frames one at a time, so they don't block other requests.
  async function loadThumbs() {
    const strip = $("strip");
    strip.innerHTML = "";
    const width = (video.thumbs.interval / duration) * 100 + "%";
    for (let n = 1; n <= video.thumbs.count && !closed; n++) {
      const img = new Image();
      img.alt = "";
      img.style.width = width;
      img.src = thumbURL(video.id, n);
      const ok = await new Promise((resolve) => {
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
      });
      if (!ok || closed) break;
      strip.append(img);
      thumbs.push(img.src);
      if (n === 1) player.poster = img.src;
      showFallbackFrame();
    }
  }

  // ---------- crop ----------

  const cropBox = $("crop");

  function drawCrop() {
    const c = mod.crop;
    cropBox.style.top = c.top * 100 + "%";
    cropBox.style.right = c.right * 100 + "%";
    cropBox.style.bottom = c.bottom * 100 + "%";
    cropBox.style.left = c.left * 100 + "%";
    const full = c.top === 0 && c.right === 0 && c.bottom === 0 && c.left === 0;
    cropBox.classList.toggle("full", full);

    const current = ((1 - c.left - c.right) / (1 - c.top - c.bottom)) * ratio;
    for (const button of stage.querySelectorAll("[data-aspect]")) {
      const aspect = Number(button.dataset.aspect);
      const pressed = aspect === 0 ? full : !full && Math.abs(current - aspect) < 0.01;
      button.setAttribute("aria-pressed", String(pressed));
    }
  }

  function setCrop(crop, done) {
    mod.crop = crop;
    drawCrop();
    emit(done);
  }

  // dragCrop works like dragTimeline, but for the crop box over the preview.
  function dragCrop(event, update) {
    event.stopPropagation();
    const before = { ...mod.crop };
    drag(
      event,
      stage,
      (pointer) => setCrop(update(pointer, before), false),
      () => setCrop(mod.crop, true),
    );
  }

  cropBox.onpointerdown = (event) =>
    dragCrop(event, ({ dx, dy }, c) => {
      // move the whole box, keeping its size
      const x = clamp(dx, -c.left, c.right);
      const y = clamp(dy, -c.top, c.bottom);
      return { top: c.top + y, right: c.right - x, bottom: c.bottom - y, left: c.left + x };
    });

  for (const corner of cropBox.querySelectorAll("[data-corner]")) {
    const which = corner.dataset.corner;
    corner.onpointerdown = (event) =>
      dragCrop(event, ({ dx, dy }, c) => {
        const next = { ...c };
        if (which.includes("t")) next.top = clamp(c.top + dy, 0, 0.95 - c.bottom);
        if (which.includes("b")) next.bottom = clamp(c.bottom - dy, 0, 0.95 - c.top);
        if (which.includes("l")) next.left = clamp(c.left + dx, 0, 0.95 - c.right);
        if (which.includes("r")) next.right = clamp(c.right - dx, 0, 0.95 - c.left);
        return next;
      });
  }

  // a click on the preview (not a drag) plays and pauses. The pointer is recorded in the
  // capture phase because the crop box handles pointerdown itself.
  let downAt = null;
  const recordDown = (event) => (downAt = [event.clientX, event.clientY]);
  stage.addEventListener("pointerdown", recordDown, true);
  stage.onclick = (event) => {
    if (event.target.closest("button") || !downAt) return;
    if (Math.hypot(event.clientX - downAt[0], event.clientY - downAt[1]) < 4) togglePlay();
  };

  for (const button of stage.querySelectorAll("[data-aspect]")) {
    button.onclick = () => {
      const aspect = Number(button.dataset.aspect);
      if (aspect === 0) {
        setCrop({ top: 0, right: 0, bottom: 0, left: 0 }, true);
        return;
      }
      // center the largest box with this aspect ratio
      const relative = aspect / ratio;
      const x = (1 - Math.min(1, relative)) / 2;
      const y = (1 - Math.min(1, 1 / relative)) / 2;
      setCrop({ top: y, right: x, bottom: y, left: x }, true);
    };
  }

  // ---------- start ----------

  drawCuts();
  drawParts();
  drawTicks();
  drawCrop();
  setCursor(cursor);
  loadThumbs();

  return {
    setMuted(muted) {
      player.muted = muted;
    },
    close() {
      closed = true;
      paused = true;
      cancelAnimationFrame(frameRequest);
      frameRequest = 0;
      document.removeEventListener("keydown", onKey);
      stage.removeEventListener("pointerdown", recordDown, true);
      player.pause();
      player.removeAttribute("src");
      player.removeAttribute("poster");
      player.load();
    },
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
