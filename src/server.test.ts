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

const MEDIA_UUID = "12345678-1234-1234-1234-1234567890ab";

/** 302 like the Jira content endpoint gives, carrying the media-services UUID. */
function mediaRedirect(): Response {
  return new Response(null, {
    status: 302,
    headers: {
      location: `https://api.media.atlassian.com/file/${MEDIA_UUID}/binary`,
    },
  });
}

/** Route mocked fetch by URL substring. */
function routeFetch(
  routes: Array<[string, (url: string, init?: RequestInit) => Response]>,
): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      for (const [needle, make] of routes) {
        if (url.includes(needle)) return make(url, init);
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

  it("exposes all eleven tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "delete_attachment",
      "download_all_attachments",
      "download_attachment",
      "embed_attachment",
      "get_attachment_limits",
      "get_attachment_thumbnail",
      "get_body",
      "list_attachments",
      "peek_archive_attachment",
      "set_body",
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
      ["/rest/api/3/attachment/content/10001", mediaRedirect],
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
    // upload also resolves the media UUID so callers can author ADF media nodes.
    expect(JSON.parse(text)[0]).toMatchObject({
      id: "10001",
      mediaId: MEDIA_UUID,
      collection: "",
    });
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

  it("embeds a Jira image into the description (resolves media UUID, PUTs ADF)", async () => {
    let put: { fields: { description: { content: unknown[] } } } | undefined;
    routeFetch([
      ["/rest/api/3/attachment/content/10001", mediaRedirect],
      [
        "/rest/api/3/issue/PROJ-1",
        (url, init) => {
          if (init?.method === "PUT") {
            put = JSON.parse(init.body as string);
            return new Response(null, { status: 204 });
          }
          return Response.json({ fields: { description: null } });
        },
      ],
    ]);
    const result = await client.callTool({
      name: "embed_attachment",
      arguments: {
        product: "jira",
        container: "PROJ-1",
        target: "body",
        attachmentId: "10001",
      },
    });
    expect(result.isError).toBeFalsy();
    const out = JSON.parse((result.content as Array<{ text: string }>)[0].text);
    expect(out).toMatchObject({ as: "image", mediaUuid: MEDIA_UUID, issueKey: "PROJ-1" });
    const media = put!.fields.description.content[0] as {
      type: string;
      content: Array<{ attrs: { id: string } }>;
    };
    expect(media.type).toBe("mediaSingle");
    expect(media.content[0].attrs.id).toBe(MEDIA_UUID);
  });

  it("embeds a Jira file card into a new comment, identified by filename", async () => {
    routeFetch([
      // Order matters: the comment path also contains "/rest/api/3/issue/PROJ-1".
      ["/rest/api/3/issue/PROJ-1/comment", () => Response.json({ id: "c1" })],
      ["/rest/api/3/attachment/content/10001", mediaRedirect],
      [
        "/rest/api/3/issue/PROJ-1",
        () => Response.json({ fields: { attachment: [JIRA_BEAN] } }),
      ],
    ]);
    const result = await client.callTool({
      name: "embed_attachment",
      arguments: {
        product: "jira",
        container: "PROJ-1",
        target: "comment",
        as: "link",
        filename: "report.pdf",
      },
    });
    expect(result.isError).toBeFalsy();
    const out = JSON.parse((result.content as Array<{ text: string }>)[0].text);
    expect(out).toMatchObject({ as: "link", commentId: "c1", mediaUuid: MEDIA_UUID });
  });

  it("embeds a Confluence image into the page body (read-modify-write, version+1)", async () => {
    let putValue = "";
    routeFetch([
      [
        "/wiki/api/v2/pages/9000",
        (url, init) => {
          if (init?.method === "PUT") {
            putValue = JSON.parse(init.body as string).body.value;
            return new Response(null, { status: 204 });
          }
          return Response.json({
            id: "9000",
            status: "current",
            title: "My Page",
            version: { number: 3 },
            body: { storage: { value: "<p>existing</p>" } },
          });
        },
      ],
    ]);
    const result = await client.callTool({
      name: "embed_attachment",
      arguments: {
        product: "confluence",
        container: "9000",
        target: "body",
        filename: "diagram.png",
      },
    });
    expect(result.isError).toBeFalsy();
    const out = JSON.parse((result.content as Array<{ text: string }>)[0].text);
    expect(out).toMatchObject({ as: "image", version: 4, filename: "diagram.png" });
    expect(putValue).toContain("<p>existing</p>");
    expect(putValue).toContain('<ri:attachment ri:filename="diagram.png"');
  });

  it("rejects as:inline on Confluence with a helpful error", async () => {
    const result = await client.callTool({
      name: "embed_attachment",
      arguments: {
        product: "confluence",
        container: "9000",
        target: "body",
        as: "inline",
        filename: "diagram.png",
      },
    });
    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0].text).toMatch(/Jira-only/);
  });

  it("set_body places a Jira image inline, resolving a filename ref to a media UUID", async () => {
    let put: { fields: { description: AdfNode } } | undefined;
    routeFetch([
      ["/rest/api/3/attachment/content/10001", mediaRedirect],
      [
        "/rest/api/3/issue/PROJ-1",
        (url, init) => {
          if (init?.method === "PUT") {
            put = JSON.parse(init.body as string);
            return new Response(null, { status: 204 });
          }
          return Response.json({ fields: { attachment: [JIRA_BEAN] } });
        },
      ],
    ]);
    const body = JSON.stringify({
      type: "doc",
      version: 1,
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Step 1" }] },
        {
          type: "mediaSingle",
          attrs: { layout: "center" },
          content: [{ type: "media", attrs: { type: "file", id: "report.pdf" } }],
        },
      ],
    });
    const result = await client.callTool({
      name: "set_body",
      arguments: { product: "jira", container: "PROJ-1", body },
    });
    expect(result.isError).toBeFalsy();
    const out = JSON.parse((result.content as Array<{ text: string }>)[0].text);
    expect(out).toMatchObject({ issueKey: "PROJ-1", mediaResolved: 1 });
    const media = put!.fields.description.content![1].content![0];
    expect(media.attrs).toMatchObject({ id: MEDIA_UUID, collection: "" });
    // text kept in place, image stays second (inline where the caller put it)
    expect(put!.fields.description.content![0].content![0].text).toBe("Step 1");
  });

  it("set_body replaces the whole Confluence body (version+1)", async () => {
    let putValue = "";
    routeFetch([
      [
        "/wiki/api/v2/pages/9001",
        (url, init) => {
          if (init?.method === "PUT") {
            putValue = JSON.parse(init.body as string).body.value;
            return new Response(null, { status: 204 });
          }
          return Response.json({
            id: "9001",
            status: "current",
            title: "Guide",
            version: { number: 5 },
            body: { storage: { value: "<p>old</p>" } },
          });
        },
      ],
    ]);
    const body =
      '<h2>Step 1</h2><ac:image><ri:attachment ri:filename="a.png" /></ac:image><h2>Step 2</h2>';
    const result = await client.callTool({
      name: "set_body",
      arguments: { product: "confluence", container: "9001", body },
    });
    expect(result.isError).toBeFalsy();
    const out = JSON.parse((result.content as Array<{ text: string }>)[0].text);
    expect(out).toMatchObject({ version: 6 });
    expect(putValue).toBe(body);
    expect(putValue).not.toContain("<p>old</p>");
  });

  it("get_body returns raw Confluence storage + version", async () => {
    routeFetch([
      [
        "/wiki/api/v2/pages/9001",
        () =>
          Response.json({
            id: "9001",
            status: "current",
            title: "Guide",
            version: { number: 7 },
            body: { storage: { value: "<p>hello</p>" } },
          }),
      ],
    ]);
    const result = await client.callTool({
      name: "get_body",
      arguments: { product: "confluence", container: "9001" },
    });
    expect(result.isError).toBeFalsy();
    const out = JSON.parse((result.content as Array<{ text: string }>)[0].text);
    expect(out).toMatchObject({
      representation: "storage",
      version: 7,
      body: "<p>hello</p>",
    });
  });

  it("get_body returns the Jira description as raw ADF", async () => {
    const doc = {
      type: "doc",
      version: 1,
      content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }],
    };
    routeFetch([
      ["/rest/api/3/issue/PROJ-1", () => Response.json({ fields: { description: doc } })],
    ]);
    const result = await client.callTool({
      name: "get_body",
      arguments: { product: "jira", container: "PROJ-1" },
    });
    expect(result.isError).toBeFalsy();
    const out = JSON.parse((result.content as Array<{ text: string }>)[0].text);
    expect(out).toMatchObject({ representation: "adf", body: doc });
  });
});
