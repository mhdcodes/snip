// Calls into snip's main process, see preload.cjs. Every function returns a promise.

const snip = window.snip;

// The dialogs resolve to null or "" when cancelled.
export const openVideo = () => snip.openVideo();
export const openPath = (path) => snip.openPath(path);
export const saveResult = (jobId) => snip.saveResult(jobId);
export const copyText = (text) => snip.copyText(text);

// pathForFile is the path of a dropped file, or "" when it isn't one on disk.
export const pathForFile = (file) => snip.pathForFile(file);

export const deleteVideo = (id) => snip.deleteVideo(id);

// makePreview resolves once the video has a copy the page can play, see sourceURL.
// onPreview reports its progress as { id, percent }.
export const makePreview = (id) => snip.makePreview(id);
export const onPreview = (callback) => snip.onPreview(callback);

// plan asks which presets fit and which ffmpeg commands would run.
export const plan = (id, settings) => snip.plan(id, settings);

// startJob starts a conversion and resolves to its first state; onJob reports the
// following ones until its status is "done", "failed" or "canceled".
export const startJob = (id, settings) => snip.startJob(id, settings);
export const onJob = (callback) => snip.onJob(callback);
export const cancelJob = (id) => snip.cancelJob(id);

// sourceURL plays the video itself, or its preview copy once the video has one.
export function sourceURL(video) {
  return `/api/videos/${video.id}/source${video.preview ? "?preview" : ""}`;
}

export function thumbURL(id, n) {
  return `/api/videos/${id}/thumbs/${n}`;
}

export function resultURL(jobId) {
  return `/api/jobs/${jobId}/result`;
}
