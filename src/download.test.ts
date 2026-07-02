import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { maxDownloadBytes, streamToFile } from "./download.js";

describe("maxDownloadBytes", () => {
  it("defaults to 512MB", () => {
    expect(maxDownloadBytes({})).toBe(512 * 1024 * 1024);
  });

  it("honors ATTACHMENT_MCP_MAX_DOWNLOAD_MB", () => {
    expect(maxDownloadBytes({ ATTACHMENT_MCP_MAX_DOWNLOAD_MB: "10" })).toBe(
      10 * 1024 * 1024,
    );
  });

  it("ignores garbage values", () => {
    expect(maxDownloadBytes({ ATTACHMENT_MCP_MAX_DOWNLOAD_MB: "lots" })).toBe(
      512 * 1024 * 1024,
    );
  });
});

describe("streamToFile", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "download-test-"));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("writes the body and returns the byte count", async () => {
    const target = path.join(dir, "file.txt");
    const size = await streamToFile(new Response("hello"), target);
    expect(size).toBe(5);
    expect(await fs.readFile(target, "utf8")).toBe("hello");
  });

  it("rejects oversized bodies declared via content-length", async () => {
    const res = new Response("xx", {
      headers: { "content-length": "999" },
    });
    await expect(
      streamToFile(res, path.join(dir, "f"), { maxBytes: 100 }),
    ).rejects.toThrow(/download limit/);
  });

  it("aborts mid-stream when the body exceeds the limit", async () => {
    const res = new Response("x".repeat(200));
    await expect(
      streamToFile(res, path.join(dir, "f"), { maxBytes: 100 }),
    ).rejects.toThrow(/exceeded/);
  });

  it("removes the partial file when the stream exceeds the limit", async () => {
    const target = path.join(dir, "partial.bin");
    await expect(
      streamToFile(new Response("x".repeat(200)), target, { maxBytes: 100 }),
    ).rejects.toThrow(/exceeded/);
    await expect(fs.access(target)).rejects.toThrow();
  });

  it("refuses to overwrite at the syscall level", async () => {
    const target = path.join(dir, "file.txt");
    await fs.writeFile(target, "original");
    await expect(streamToFile(new Response("new"), target)).rejects.toThrow();
    // The EEXIST failure must NOT delete the pre-existing file.
    expect(await fs.readFile(target, "utf8")).toBe("original");
  });

  it("overwrites when asked", async () => {
    const target = path.join(dir, "file.txt");
    await fs.writeFile(target, "original");
    await streamToFile(new Response("new"), target, { overwrite: true });
    expect(await fs.readFile(target, "utf8")).toBe("new");
  });
});
