// Gives the page window.snip, the calls into the main process. See handleIPC in main.js.

const { contextBridge, ipcRenderer, webUtils } = require("electron");

async function call(channel, ...args) {
  const { value, error } = await ipcRenderer.invoke(channel, ...args);
  if (error !== undefined) throw new Error(error);
  return value;
}

function listen(channel, callback) {
  ipcRenderer.on(channel, (_event, payload) => callback(payload));
}

contextBridge.exposeInMainWorld("snip", {
  openVideo: () => call("open-video"),
  openPath: (path) => call("open-path", path),
  deleteVideo: (id) => call("delete-video", id),
  makePreview: (id) => call("make-preview", id),
  plan: (id, settings) => call("plan", id, settings),
  startJob: (id, settings) => call("start-job", id, settings),
  cancelJob: (id) => call("cancel-job", id),
  saveResult: (jobID) => call("save-result", jobID),
  copyText: (text) => call("copy-text", text),
  pathForFile: (file) => webUtils.getPathForFile(file),
  onJob: (callback) => listen("job", callback),
  onPreview: (callback) => listen("preview", callback),
});
