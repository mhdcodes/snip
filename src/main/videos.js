// The opened videos and their conversions. Thumbnails, preview copies and results live in
// a temporary directory that close removes.

import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { baseName, build } from "./media/commands.js";
import { clean, target } from "./media/format.js";
import { choose } from "./media/presets.js";
import { probe } from "./media/probe.js";
import { run } from "./media/run.js";
import { preview } from "./media/preview.js";
import { thumbCount, thumbInterval, thumbnails, thumbPath } from "./media/thumbs.js";

export class Videos {
  // encoders is from detectEncoders. send(channel, payload) tells the page about progress:
  // "job" with a job's state, "preview" with { id, percent }.
  constructor(root, encoders, send) {
    this.root = root;
    this.encoders = encoders;
    this.send = send;
    this.videos = new Map();
    this.jobs = new Map();
  }

  static async create(encoders, send) {
    return new Videos(await fs.mkdtemp(path.join(os.tmpdir(), "snip-")), encoders, send);
  }

  // close stops all work, waits for ffmpeg to exit and deletes every stored file.
  async close() {
    await Promise.all([...this.videos.keys()].map((id) => this.remove(id)));
    await fs.rm(this.root, { recursive: true, force: true });
  }

  // open reads the video at file and starts making its timeline thumbnails.
  // It returns what the page shows: { id, name, metadata, thumbs: { interval, count } }.
  async open(file) {
    if (typeof file !== "string" || file === "") throw new Error("no file given");
    const meta = await probe(file);
    const id = randomBytes(12).toString("hex");
    const dir = path.join(this.root, id);
    await fs.mkdir(path.join(dir, "thumbs"), { recursive: true, mode: 0o700 });

    const name = path.basename(file);
    const controller = new AbortController();
    const v = {
      id,
      name,
      base: baseName(name),
      dir,
      path: file,
      meta,
      controller,
      thumbs: null, // settles once ffmpeg has written every thumbnail
      preview: null, // the preview copy, see makePreview
    };
    v.thumbs = thumbnails(meta, file, path.join(dir, "thumbs"), controller.signal).catch((error) => {
      console.error(`thumbnails for ${id}: ${error.message}`);
    });
    this.videos.set(id, v);

    const length = meta.container.duration;
    return { id, name, metadata: meta, thumbs: { interval: thumbInterval(length), count: thumbCount(length) } };
  }

  // remove stops the video's work and deletes its files.
  async remove(id) {
    const v = this.videos.get(id);
    if (!v) return;
    this.videos.delete(id);
    const jobs = [...this.jobs.values()].filter((j) => j.video === v);
    for (const j of jobs) this.jobs.delete(j.state.id);
    v.controller.abort(); // stops thumbnails, the preview and running jobs
    await Promise.allSettled([v.thumbs, v.preview?.done, ...jobs.map((j) => j.done)]);
    await fs.rm(v.dir, { recursive: true, force: true });
  }

  // makePreview converts the video into a copy the page can play, see
  // media/preview.js, and resolves once it is ready. Asking again waits for the same copy.
  makePreview(id) {
    const v = this.video(id);
    if (!v.preview) {
      const file = path.join(v.dir, "preview.mp4");
      const done = preview(
        v.meta,
        v.path,
        file,
        ({ percent }) => this.send("preview", { id, percent }),
        v.controller.signal,
      );
      v.preview = { file, done };
      done.catch(() => {}); // the caller sees failures, removing the video must not
    }
    return v.preview.done;
  }

  // sourceFile is the file the page plays for a video: its preview copy when asked for one.
  sourceFile(id, wantPreview) {
    const v = this.video(id);
    return wantPreview && v.preview ? v.preview.file : v.path;
  }

  // thumbFile waits for thumbnail n, since they are produced while the user already
  // looks at the page. It returns null when there is no such thumbnail.
  async thumbFile(id, n) {
    const v = this.video(id);
    if (!Number.isInteger(n) || n < 1) throw new Error("bad thumbnail number");
    const dir = path.join(v.dir, "thumbs");
    let finished = false;
    v.thumbs.finally(() => (finished = true));
    const deadline = Date.now() + 30_000;
    while (!finished && !existsSync(thumbPath(dir, n + 1))) {
      if (Date.now() > deadline || !this.videos.has(id)) return null;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    return existsSync(thumbPath(dir, n)) ? thumbPath(dir, n) : null;
  }

  // plan shows what a conversion with the page's settings { modification, video, audio }
  // would do, so the page can update while the user edits.
  plan(id, settings) {
    const v = this.video(id);
    const { instructions, videoFormats, audioFormats } = this.choose(v, settings);
    const shown = { input: v.name, name: v.base };
    return {
      instructions,
      target: target(instructions),
      videoFormats,
      audioFormats,
      commands: build(v.meta, instructions, shown, this.encoders).map((c) => c.args), // for display, with plain file names
    };
  }

  // startJob converts the video with the page's settings and returns the job's state:
  // { id, status, progress, message?, error?, fileName, size?, type, target }.
  // Only one conversion per video runs at a time, a new start replaces the old one.
  async startJob(id, settings) {
    const v = this.video(id);
    const { instructions: ins } = this.choose(v, settings);
    if (ins.video.implausible || ins.audio.implausible) {
      throw new Error("the selected quality can't be reached for this video length");
    }

    const jobID = randomBytes(12).toString("hex");
    const dir = path.join(v.dir, `job-${jobID}`);
    await fs.mkdir(dir, { mode: 0o700 });
    const cmds = build(v.meta, ins, { input: v.path, dir, name: v.base }, this.encoders);

    const last = cmds.at(-1);
    const controller = new AbortController();
    const job = {
      video: v,
      dir,
      file: last.file,
      controller,
      state: {
        id: jobID,
        status: "running",
        progress: 0,
        fileName: path.basename(last.file),
        type: last.type,
        target: target(ins),
      },
    };
    for (const other of [...this.jobs.values()].filter((j) => j.video === v)) {
      this.jobs.delete(other.state.id);
      this.stop(other);
    }
    this.jobs.set(jobID, job);

    const signal = AbortSignal.any([v.controller.signal, controller.signal]);
    job.done = this.runJob(job, cmds, ins.modification.cut.duration, signal);
    return job.state;
  }

  async runJob(job, cmds, length, signal) {
    const update = (changes) => {
      job.state = { ...job.state, ...changes };
      if (!signal.aborted) this.send("job", job.state);
    };
    try {
      await run(cmds, length, ({ percent, message }) => update({ progress: percent, message }), signal);
      const { size } = await fs.stat(job.file).catch(() => {
        throw new Error("ffmpeg wrote no output");
      });
      update({ status: "done", progress: 100, size });
    } catch (error) {
      if (signal.aborted) job.state = { ...job.state, status: "canceled" };
      else {
        console.error(`job ${job.state.id}: ${error.message}`);
        update({ status: "failed", error: error.message });
      }
    }
  }

  // cancelJob stops a conversion and deletes its files.
  async cancelJob(jobID) {
    const job = this.jobs.get(jobID);
    if (!job) return;
    this.jobs.delete(jobID);
    await this.stop(job);
  }

  async stop(job) {
    job.controller.abort();
    await job.done;
    await fs.rm(job.dir, { recursive: true, force: true });
  }

  // result returns where a finished conversion is stored and the file name it suggests.
  result(jobID) {
    const job = this.jobs.get(jobID);
    if (!job) throw new Error("conversion not found");
    if (job.state.status !== "done") throw new Error("the conversion is not finished");
    return { file: job.file, name: job.state.fileName };
  }

  video(id) {
    const v = this.videos.get(id);
    if (!v) throw new Error("video not found, it may have been closed");
    return v;
  }

  choose(v, settings) {
    const mod = clean(settings?.modification, v.meta);
    return choose(v.meta, mod, this.encoders, settings?.video, settings?.audio);
  }
}
