// snip is a desktop app for cutting, cropping and compressing videos with ffmpeg.
//
// The window shows src/renderer from the snip:// scheme, which also serves the videos,
// thumbnails and results it plays. Everything else, like opening a video or starting a
// conversion, goes through the IPC handlers below; src/preload/index.cjs gives them to the
// page as window.snip.

import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, net, protocol } from "electron";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { detectEncoders } from "./media/probe.js";
import { Videos } from "./videos.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const pageDir = path.join(here, "..", "renderer");
const ORIGIN = "snip://app";

// the downloads ship ffmpeg with snip, see the release workflow, so look there before PATH
const bundled = path.join(process.resourcesPath, "ffmpeg", "bin");
if (app.isPackaged && existsSync(bundled)) {
  process.env.PATH = bundled + path.delimiter + process.env.PATH;
}

protocol.registerSchemesAsPrivileged([
  { scheme: "snip", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

let videos = null;
let win = null;
let dir = ""; // the folder of the last opened video, where Save starts

app.whenReady().then(async () => {
  try {
    const send = (channel, payload) => win && !win.isDestroyed() && win.webContents.send(channel, payload);
    videos = await Videos.create(await detectEncoders(), send);
  } catch (error) {
    dialog.showErrorBox("snip can't start", error.message);
    app.exit(1);
    return;
  }

  protocol.handle("snip", serve);
  handleIPC();
  if (app.isPackaged) Menu.setApplicationMenu(null); // keeps Reload and DevTools while developing

  win = new BrowserWindow({
    width: 1200,
    height: 760,
    title: "snip",
    backgroundColor: "#0b0b0b", // the page's --bg, so the window doesn't flash white before it loads
    webPreferences: { preload: path.join(here, "..", "preload", "index.cjs") },
  });
  // the page never leaves snip://; a dropped file must not replace it either
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.loadURL(`${ORIGIN}/index.html`);
});

app.on("window-all-closed", () => app.quit());

// quitting waits for ffmpeg to stop, so the temporary files get removed, but not forever
let quitting = false;
app.on("will-quit", (event) => {
  if (quitting || !videos) return;
  event.preventDefault();
  quitting = true;
  const timeout = new Promise((resolve) => setTimeout(resolve, 5000));
  Promise.race([videos.close(), timeout]).finally(() => app.quit());
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => app.quit());

// serve answers snip:// requests: the page's own files, and below /api/ the media it shows.
async function serve(request) {
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean);
  try {
    if (parts[0] === "api") {
      const file = await mediaFile(parts.slice(1), url.searchParams);
      // net.fetch answers range requests, so the player can seek
      return file
        ? net.fetch(pathToFileURL(file).href, { headers: request.headers })
        : new Response("not found", { status: 404 });
    }
    const file = path.join(pageDir, ...parts.map(decodeURIComponent));
    if (!file.startsWith(pageDir + path.sep)) return new Response("not found", { status: 404 });
    return net.fetch(pathToFileURL(file).href);
  } catch (error) {
    return new Response(error.message, { status: 404 });
  }
}

// mediaFile finds the file behind a media path, see sourceURL, thumbURL and resultURL in api.js.
async function mediaFile([kind, id, what, n], query) {
  if (kind === "videos" && what === "source") return videos.sourceFile(id, query.has("preview"));
  if (kind === "videos" && what === "thumbs") return videos.thumbFile(id, Number(n));
  if (kind === "jobs" && what === "result") return videos.result(id).file;
  return null;
}

function handleIPC() {
  const open = async (file) => {
    const video = await videos.open(file);
    dir = path.dirname(file);
    return video;
  };

  handle("open-video", async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: "Select video",
      properties: ["openFile"],
      filters: [
        {
          name: "Videos",
          extensions: "mp4 m4v mov mkv webm avi wmv flv mpg mpeg ts mts m2ts 3gp ogv gif".split(" "),
        },
        { name: "All files", extensions: ["*"] },
      ],
    });
    return canceled || !filePaths.length ? null : open(filePaths[0]);
  });
  handle("open-path", open);
  handle("delete-video", (id) => videos.remove(id));
  handle("make-preview", async (id) => {
    await videos.makePreview(id);
  });
  handle("plan", (id, settings) => videos.plan(id, settings));
  handle("start-job", (id, settings) => videos.startJob(id, settings));
  handle("cancel-job", (id) => videos.cancelJob(id));
  handle("save-result", async (jobID) => {
    const { file, name } = videos.result(jobID);
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: "Save result",
      defaultPath: path.join(dir, name),
    });
    if (canceled || !filePath) return "";
    await fs.copyFile(file, filePath);
    return filePath;
  });
  handle("copy-text", (text) => clipboard.writeText(String(text)));
}

// handle answers an IPC call from the page with { value } or { error }, since a thrown
// error reaches the page wrapped in Electron's own message.
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    // Node's URL gives custom schemes no origin, so compare the start
    if (!event.senderFrame?.url.startsWith(`${ORIGIN}/`)) return { error: "not allowed" };
    try {
      return { value: await fn(...args) };
    } catch (error) {
      return { error: error.message ?? String(error) };
    }
  });
}
