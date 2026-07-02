import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { maxDownloadBytes, streamToFile } from "./download.js";
import { FileExistsError } from "./errors.js";
import type { AttachmentInfo, JiraAttachments } from "./jira.js";
import { toAttachmentInfo, type ConfluenceAttachments } from "./confluence.js";
import type { Sandbox } from "./sandbox.js";

const pkg = createRequire(import.meta.url)("../package.json") as {
  version: string;
};

export interface ServerContext {
  jira: JiraAttachments;
  confluence: ConfluenceAttachments;
  sandbox: Sandbox;
  /** e.g. "example.atlassian.net" — first level of the sandbox layout. */
  siteHost: string;
}

const product = z
  .enum(["jira", "confluence"])
  .describe("Which product the container belongs to");
const container = z
  .string()
  .min(1)
  .describe('Jira issue key (e.g. "PROJ-123") or Confluence page id');
const attachmentId = z.string().min(1).describe("Attachment id");
const overwrite = z
  .boolean()
  .optional()
  .describe("Replace an existing local file (default false)");

export function createServer(context: ServerContext): McpServer {
  const { jira, confluence, sandbox, siteHost } = context;
  const server = new McpServer({
    name: "atlassian-attachments-mcp",
    version: pkg.version,
  });

  /**
   * Order matters: reserve the sandbox path BEFORE opening the network
   * stream, so a FileExistsError never leaves a response body dangling.
   */
  async function persist(
    info: AttachmentInfo,
    folder: string,
    open: () => Promise<Response>,
    overwrite?: boolean,
  ): Promise<Record<string, unknown>> {
    const target = await sandbox.prepareWrite(
      [siteHost, folder, `${info.id}-${info.filename}`],
      { overwrite },
    );
    const size = await streamToFile(await open(), target, { overwrite });
    return {
      path: target,
      size,
      mimeType: info.mimeType,
      originalFilename: info.filename,
      attachmentId: info.id,
    };
  }

  server.registerTool(
    "list_attachments",
    {
      title: "List attachments",
      description:
        "List the attachments on a Jira issue or Confluence page: id, filename, size, MIME type, author.",
      inputSchema: { product, container },
    },
    (args) =>
      run(async () => {
        const items =
          args.product === "jira"
            ? await jira.list(args.container)
            : (await confluence.list(args.container)).map(toAttachmentInfo);
        return JSON.stringify(items, null, 2);
      }),
  );

  server.registerTool(
    "upload_attachment",
    {
      title: "Upload attachment",
      description:
        "Attach a local file to a Jira issue or Confluence page. Reads any path the server process can read.",
      inputSchema: {
        product,
        container,
        filePath: z.string().min(1).describe("Path to the local file to attach"),
        filename: z
          .string()
          .optional()
          .describe("Name to give the attachment (default: the file's name)"),
      },
    },
    (args) =>
      run(async () => {
        const created =
          args.product === "jira"
            ? await jira.upload(args.container, args.filePath, args.filename)
            : await confluence.upload(
                args.container,
                args.filePath,
                args.filename,
              );
        return JSON.stringify(created, null, 2);
      }),
  );

  server.registerTool(
    "download_attachment",
    {
      title: "Download attachment",
      description:
        "Download one attachment into the local sandbox and return its path and metadata (file content is not returned).",
      inputSchema: {
        product,
        attachmentId,
        container: z
          .string()
          .optional()
          .describe("Folder label for the local layout (e.g. the issue key)"),
        overwrite,
      },
    },
    (args) =>
      run(async () => {
        let saved: Record<string, unknown>;
        if (args.product === "jira") {
          const info = await jira.metadata(args.attachmentId);
          saved = await persist(
            info,
            args.container ?? "attachments",
            () => jira.download(args.attachmentId),
            args.overwrite,
          );
        } else {
          const meta = await confluence.metadata(args.attachmentId);
          saved = await persist(
            toAttachmentInfo(meta),
            args.container ?? meta.pageId ?? "attachments",
            () => confluence.open(meta),
            args.overwrite,
          );
        }
        return JSON.stringify(saved, null, 2);
      }),
  );

  server.registerTool(
    "download_all_attachments",
    {
      title: "Download all attachments",
      description:
        "Download every attachment on a Jira issue or Confluence page into the local sandbox. Returns per-file results; existing files are skipped unless overwrite is set.",
      inputSchema: { product, container, overwrite },
    },
    (args) =>
      run(async () => {
        // Reuse list metadata — no per-file metadata refetch.
        const jobs: Array<{ info: AttachmentInfo; open: () => Promise<Response> }> =
          args.product === "jira"
            ? (await jira.list(args.container)).map((info) => ({
                info,
                open: () => jira.download(info.id),
              }))
            : (await confluence.list(args.container)).map((meta) => ({
                info: toAttachmentInfo(meta),
                open: () => confluence.open(meta),
              }));
        const results = [];
        for (const { info, open } of jobs) {
          try {
            results.push({
              status: "downloaded",
              ...(await persist(info, args.container, open, args.overwrite)),
            });
          } catch (err) {
            results.push({
              status: err instanceof FileExistsError ? "skipped-exists" : "failed",
              attachmentId: info.id,
              originalFilename: info.filename,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
        return JSON.stringify(results, null, 2);
      }),
  );

  server.registerTool(
    "delete_attachment",
    {
      title: "Delete attachment",
      description:
        "Permanently delete an attachment from a Jira issue or Confluence page.",
      inputSchema: { product, attachmentId },
    },
    (args) =>
      run(async () => {
        if (args.product === "jira") await jira.remove(args.attachmentId);
        else await confluence.remove(args.attachmentId);
        return `Deleted ${args.product} attachment ${args.attachmentId}`;
      }),
  );

  server.registerTool(
    "peek_archive_attachment",
    {
      title: "Peek inside archive attachment",
      description:
        "List the contents of a zip/archive attachment without downloading it. Jira only.",
      inputSchema: { attachmentId },
    },
    (args) =>
      run(async () => JSON.stringify(await jira.peek(args.attachmentId), null, 2)),
  );

  server.registerTool(
    "get_attachment_thumbnail",
    {
      title: "Get attachment thumbnail",
      description:
        "Return the thumbnail of an image attachment inline, so it can be viewed directly. Jira only.",
      inputSchema: { attachmentId },
    },
    async (args): Promise<CallToolResult> => {
      try {
        const limit = Math.min(maxDownloadBytes(), 8 * 1024 * 1024);
        const res = await jira.thumbnail(args.attachmentId);
        const declared = Number(res.headers.get("content-length"));
        if (Number.isFinite(declared) && declared > limit) {
          throw new Error(`Thumbnail is ${declared} bytes — too large to inline`);
        }
        const bytes = Buffer.from(await res.arrayBuffer());
        if (bytes.length > limit) {
          throw new Error(`Thumbnail is ${bytes.length} bytes — too large to inline`);
        }
        const mimeType =
          res.headers.get("content-type")?.split(";")[0].trim() || "image/png";
        return {
          content: [
            { type: "image", data: bytes.toString("base64"), mimeType },
          ],
        };
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.registerTool(
    "get_attachment_limits",
    {
      title: "Get attachment limits",
      description:
        "Report whether attachments are enabled on the Jira site and the maximum upload size in bytes. Jira only.",
      inputSchema: {},
    },
    () => run(async () => JSON.stringify(await jira.limits())),
  );

  return server;
}

/** Uniform tool-result envelope: errors become isError text, never throws. */
async function run(fn: () => Promise<string>): Promise<CallToolResult> {
  try {
    return { content: [{ type: "text", text: await fn() }] };
  } catch (err) {
    return toolError(err);
  }
}

function toolError(err: unknown): CallToolResult {
  const message = err instanceof Error ? err.message : String(err);
  return { isError: true, content: [{ type: "text", text: message }] };
}
