import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { byteRange, serveFile } from "../src/main/files.js";

test("byteRange", () => {
  assert.equal(byteRange(null, 100), undefined);
  assert.equal(byteRange("bytes=0-1,5-6", 100), undefined);
  assert.equal(byteRange("bytes=-", 100), undefined);
  assert.deepEqual(byteRange("bytes=0-", 100), { start: 0, end: 99 });
  assert.deepEqual(byteRange("bytes=10-19", 100), { start: 10, end: 19 });
  assert.deepEqual(byteRange("bytes=90-500", 100), { start: 90, end: 99 });
  assert.deepEqual(byteRange("bytes=-10", 100), { start: 90, end: 99 });
  assert.deepEqual(byteRange("bytes=-500", 100), { start: 0, end: 99 });
  assert.equal(byteRange("bytes=100-", 100), null);
  assert.equal(byteRange("bytes=20-10", 100), null);
  assert.equal(byteRange("bytes=-0", 100), null);
  assert.equal(byteRange("bytes=0-", 0), null);
});

test("serveFile", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "snip-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "clip.mp4");
  await fs.writeFile(file, "0123456789");
  const get = (range) => serveFile(file, new Request("snip://app/x", { headers: range ? { range } : {} }));

  let res = await get();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-length"), "10");
  assert.equal(res.headers.get("accept-ranges"), "bytes");
  assert.equal(res.headers.get("content-type"), "video/mp4");
  assert.equal(await res.text(), "0123456789");

  res = await get("bytes=3-5");
  assert.equal(res.status, 206);
  assert.equal(res.headers.get("content-range"), "bytes 3-5/10");
  assert.equal(res.headers.get("content-length"), "3");
  assert.equal(await res.text(), "345");

  res = await get("bytes=7-");
  assert.equal(res.status, 206);
  assert.equal(await res.text(), "789");

  res = await get("bytes=10-");
  assert.equal(res.status, 416);
  assert.equal(res.headers.get("content-range"), "bytes */10");
});
