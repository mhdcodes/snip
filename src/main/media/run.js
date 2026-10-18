// Running ffmpeg and following its progress.

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

// run executes the commands in order and reports progress across all of them as
// onProgress({ percent, message }). length is the output duration in seconds, used to
// turn ffmpeg's timestamps into percentages. Aborting signal stops ffmpeg; run then
// rejects with the abort reason once it has exited.
export async function run(cmds, length, onProgress, signal) {
  for (const [i, c] of cmds.entries()) {
    await runOne(c.args, signal, (seconds, message) => {
      const part = Math.min(Math.max(seconds / length, 0), 1);
      onProgress({ percent: ((i + part) / cmds.length) * 100, message });
    });
  }
}

function runOne(args, signal, report) {
  signal?.throwIfAborted();
  const ffmpeg = spawn(
    "ffmpeg",
    ["-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-progress", "pipe:1", "-nostats", ...args],
    { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );
  const stop = () => ffmpeg.kill();
  signal?.addEventListener("abort", stop);

  const stderr = new Tail(20);
  ffmpeg.stderr.setEncoding("utf8").on("data", (text) => stderr.write(text));

  // -progress writes key=value blocks, each closed by a "progress=" line
  let block = {};
  createInterface({ input: ffmpeg.stdout }).on("line", (line) => {
    const eq = line.indexOf("=");
    const key = line.slice(0, eq);
    block[key] = line.slice(eq + 1).trim();
    if (key !== "progress") return;
    const b = block;
    report(
      Number(b.out_time_us) / 1e6 || 0,
      `frame=${b.frame} fps=${b.fps} size=${b.total_size} time=${b.out_time} bitrate=${b.bitrate} speed=${b.speed}`,
    );
    block = {};
  });

  return new Promise((resolve, reject) => {
    let failure = null;
    ffmpeg.on("error", (error) => {
      failure = new Error(error.code === "ENOENT" ? "ffmpeg not found" : `start ffmpeg: ${error.message}`);
    });
    ffmpeg.on("close", (code) => {
      signal?.removeEventListener("abort", stop);
      if (signal?.aborted) reject(signal.reason);
      else if (failure) reject(failure);
      else if (code !== 0) reject(new Error(`ffmpeg failed: exit code ${code}\n${stderr}`));
      else resolve();
    });
  });
}

// Tail keeps the last lines written to it, enough to explain a failure.
class Tail {
  constructor(max) {
    this.max = max;
    this.lines = [];
    this.part = "";
  }

  write(text) {
    const lines = (this.part + text).split("\n");
    this.part = lines.pop();
    this.lines.push(...lines);
    this.lines.splice(0, Math.max(0, this.lines.length - this.max));
  }

  toString() {
    return [...this.lines, this.part].join("\n").trim();
  }
}
