// Serving files from disk to the page, with the byte ranges a video player asks for.
//
// net.fetch could read them too, but for file:// URLs it ignores the Range header and
// sends no Content-Length. Chromium then treats a video as a stream it can't seek in,
// unless it happens to read the whole file first: the timeline moved, the video didn't.

import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

const TYPES = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".ogv": "video/ogg",
  ".gif": "image/gif",
  ".jpg": "image/jpeg",
  ".png": "image/png",
};

// serveFile answers request with file: all of it, or the range the request asks for.
export async function serveFile(file, request) {
  const { size } = await fs.stat(file);
  const headers = { "Accept-Ranges": "bytes" };
  const type = TYPES[path.extname(file).toLowerCase()];
  if (type) headers["Content-Type"] = type; // otherwise Chromium sniffs it

  const range = byteRange(request.headers.get("range"), size);
  if (range === null) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  }
  const { start, end } = range ?? { start: 0, end: size - 1 };
  if (range) headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
  headers["Content-Length"] = String(end - start + 1);
  const body = end < start ? null : Readable.toWeb(createReadStream(file, { start, end }));
  return new Response(body, { status: range ? 206 : 200, headers });
}

// byteRange reads a Range header into the inclusive { start, end } it asks for. It returns
// undefined for the whole file, when there is no header or one it doesn't understand, and
// null when the range lies outside the file.
export function byteRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header?.trim() ?? "");
  if (!m || (m[1] === "" && m[2] === "")) return undefined; // several ranges, or none
  let start, end;
  if (m[1] === "") {
    // the last n bytes
    if (Number(m[2]) === 0) return null;
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  return start >= size || start > end ? null : { start, end };
}
