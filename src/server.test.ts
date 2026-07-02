import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { AtlassianClient } from "./http.js";
import { JiraAttachments } from "./jira.js";
import { ConfluenceAttachments } from "./confluence.js";
import { Sandbox } from "./sandbox.js";
import { createServer } from "./server.js";

const CONFIG = {
  siteUrl: "https://example.atlassian.net",
  email: "me@example.com",
  apiToken: "tok",
};

const JIRA_BEAN = {
  id: 10001,
  filename: "report.pdf",
  size: 8,
  mimeType: "application/pdf",
  author: { displayName: "Someone" },
};

/** Route mocked fetch by URL substring. */
function routeFetch(routes: Array<[string, () => Response]>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      for (const [needle, make] of routes) {
        if (url.includes(needle)) return make();
      }
      return new Response("no route: " + url, { status: 404 });
    }),
  );
}

describe("MCP server end-to-end (in-memory transport)", () => {
  let dir: string;
  let client: Client;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "server-test-"));
    const sandbox = new Sandbox(path.join(dir, "root"));
    await sandbox.init();

    const http = new AtlassianClient(CONFIG);
    const server = createServer({
      jira: new JiraAttachments(http),
      confluence: new ConfluenceAttachments(http),
      sandbox,
      siteHost: "example.atlassian.net",
    });

    client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("exposes all eight tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "delete_attachment",
      "download_all_attachments",
      "download_attachment",
      "get_attachment_limits",
      "get_attachment_thumbnail",
      "list_attachments",
      "peek_archive_attachment",
      "upload_attachment",
    ]);
  });

  it("lists Jira attachments", async () => {
    routeFetch([
      [
        "/rest/api/3/issue/PROJ-1",
        () => Response.json({ fields: { attachment: [JIRA_BEAN] } }),
      ],
    ]);
    const result = await client.callTool({
      name: "list_attachments",
      arguments: { product: "jira", container: "PROJ-1" },
    });
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(JSON.parse(text)).toEqual([
      {
        id: "10001",
        filename: "report.pdf",
        size: 8,
        mimeType: "application/pdf",
        author: "Someone",
      },
    ]);
  });

  it("downloads a Jira attachment into the sandbox", async () => {
    routeFetch([
      ["/rest/api/3/attachment/content/10001", () => new Response("PDFDATA!")],
      ["/rest/api/3/attachment/10001", () => Response.json(JIRA_BEAN)],
    ]);
    const result = await client.callTool({
      name: "download_attachment",
      arguments: { product: "jira", attachmentId: "10001", container: "PROJ-1" },
    });
    const saved = JSON.parse(
      (result.content as Array<{ text: string }>)[0].text,
    ) as { path: string; size: number };
    expect(saved.path).toContain(
      path.join("example.atlassian.net", "PROJ-1", "10001-report.pdf"),
    );
    expect(saved.size).toBe(8);
    expect(await fs.readFile(saved.path, "utf8")).toBe("PDFDATA!");
  });

  it("reports a collision with a suggested path instead of overwriting", async () => {
    routeFetch([
      ["/rest/api/3/attachment/content/10001", () => new Response("PDFDATA!")],
      ["/rest/api/3/attachment/10001", () => Response.json(JIRA_BEAN)],
    ]);
    const args = {
      name: "download_attachment",
      arguments: { product: "jira", attachmentId: "10001", container: "PROJ-1" },
    };
    await client.callTool(args);
    const second = await client.callTool(args);
    expect(second.isError).toBe(true);
    const text = (second.content as Array<{ text: string }>)[0].text;
    expect(text).toMatch(/already exists/);
    expect(text).toMatch(/10001-report-2\.pdf/);
  });

  it("downloads a Confluence attachment via its downloadLink", async () => {
    routeFetch([
      [
        "/wiki/api/v2/attachments/att42",
        () =>
          Response.json({
            id: "att42",
            title: "diagram.png",
            mediaType: "image/png",
            fileSize: 3,
            pageId: "9000",
            downloadLink: "/download/attachments/9000/diagram.png",
          }),
      ],
      ["/wiki/download/attachments/9000/diagram.png", () => new Response("img")],
    ]);
    const result = await client.callTool({
      name: "download_attachment",
      arguments: { product: "confluence", attachmentId: "att42" },
    });
    const saved = JSON.parse(
      (result.content as Array<{ text: string }>)[0].text,
    ) as { path: string };
    expect(saved.path).toContain(path.join("9000", "att42-diagram.png"));
  });

  it("returns thumbnails as inline image content", async () => {
    routeFetch([
      [
        "/rest/api/3/attachment/thumbnail/10001",
        () =>
          new Response(Buffer.from("fakepng"), {
            headers: { "content-type": "image/png" },
          }),
      ],
    ]);
    const result = await client.callTool({
      name: "get_attachment_thumbnail",
      arguments: { attachmentId: "10001" },
    });
    const item = (
      result.content as Array<{ type: string; data: string; mimeType: string }>
    )[0];
    expect(item.type).toBe("image");
    expect(item.mimeType).toBe("image/png");
    expect(Buffer.from(item.data, "base64").toString()).toBe("fakepng");
  });

  it("bulk-downloads with per-file results and skips existing files on rerun", async () => {
    routeFetch([
      [
        "/rest/api/3/issue/PROJ-1",
        () =>
          Response.json({
            fields: {
              attachment: [
                JIRA_BEAN,
                { ...JIRA_BEAN, id: 10002, filename: "other.txt" },
              ],
            },
          }),
      ],
      ["/rest/api/3/attachment/content/", () => new Response("PDFDATA!")],
    ]);
    const args = {
      name: "download_all_attachments",
      arguments: { product: "jira", container: "PROJ-1" },
    };
    const first = JSON.parse(
      ((await client.callTool(args)).content as Array<{ text: string }>)[0].text,
    ) as Array<{ status: string }>;
    expect(first.map((r) => r.status)).toEqual(["downloaded", "downloaded"]);

    const second = JSON.parse(
      ((await client.callTool(args)).content as Array<{ text: string }>)[0].text,
    ) as Array<{ status: string }>;
    expect(second.map((r) => r.status)).toEqual([
      "skipped-exists",
      "skipped-exists",
    ]);
  });

  it("follows Confluence list pagination", async () => {
    routeFetch([
      [
        "cursor=next123",
        () =>
          Response.json({
            results: [{ id: "att2", title: "b.txt" }],
            _links: {},
          }),
      ],
      [
        "/wiki/api/v2/pages/9000/attachments",
        () =>
          Response.json({
            results: [{ id: "att1", title: "a.txt" }],
            _links: { next: "/api/v2/pages/9000/attachments?cursor=next123" },
          }),
      ],
    ]);
    const result = await client.callTool({
      name: "list_attachments",
      arguments: { product: "confluence", container: "9000" },
    });
    const items = JSON.parse(
      (result.content as Array<{ text: string }>)[0].text,
    ) as Array<{ id: string }>;
    expect(items.map((i) => i.id)).toEqual(["att1", "att2"]);
  });

  it("uploads a local file to Jira", async () => {
    const source = path.join(dir, "notes.txt");
    await fs.writeFile(source, "hello");
    routeFetch([
      [
        "/rest/api/3/issue/PROJ-1/attachments",
        () => Response.json([JIRA_BEAN]),
      ],
    ]);
    const result = await client.callTool({
      name: "upload_attachment",
      arguments: { product: "jira", container: "PROJ-1", filePath: source },
    });
    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(JSON.parse(text)[0].id).toBe("10001");
  });

  it("surfaces API errors as isError results, not crashes", async () => {
    routeFetch([
      ["/rest/api/3/issue/NOPE-1", () => new Response("", { status: 404 })],
    ]);
    const result = await client.callTool({
      name: "list_attachments",
      arguments: { product: "jira", container: "NOPE-1" },
    });
    expect(result.isError).toBe(true);
  });
});
