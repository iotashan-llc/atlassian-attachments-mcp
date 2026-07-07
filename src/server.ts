import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { maxDownloadBytes, streamToFile } from "./download.js";
import { FileExistsError } from "./errors.js";
import type { AttachmentInfo, JiraAttachments } from "./jira.js";
import { toAttachmentInfo, type ConfluenceAttachments } from "./confluence.js";
import {
  confluenceImageFragment,
  confluenceLinkFragment,
  jiraFileCardNode,
  jiraInlineNode,
  jiraMediaNode,
  parseAdfDoc,
  type AdfOp,
  type Placement,
  type StorageOp,
} from "./embed.js";
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

const anchorSchema = z
  .object({
    afterHeading: z
      .string()
      .min(1)
      .optional()
      .describe("Insert just after the heading whose text is exactly this"),
    afterBlock: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Insert after the Nth top-level block (1-based). Jira only."),
    replaceToken: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Replace a placeholder — a paragraph whose only text is this token (e.g. "{{img:diagram.png}}")',
      ),
    occurrence: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Which match to use when there are several (1-based, default 1)"),
  })
  .optional()
  .describe(
    'Insert relative to existing body content instead of position. Set exactly ONE of afterHeading / afterBlock (Jira only) / replaceToken. Overrides position. Confluence afterHeading matches plain headings only (falls back to an error — use replaceToken or set_body for rich headings).',
  );

const dedupeSchema = z
  .enum(["none", "replace"])
  .optional()
  .describe(
    '"replace" updates an existing embed of the same file in place instead of adding another copy (default "none")',
  );

const INSTRUCTIONS = `This server manages Atlassian ATTACHMENTS (binaries) on Jira issues and Confluence pages. It complements the first-party Atlassian MCP: that one does issue/page text CRUD but CANNOT read attachment binaries or render a displayed image — this one can.

Recommended workflow when opening a ticket or page:
- Fetch the issue/page CONTENT with the first-party Atlassian MCP AND the attachment list (list_attachments) or downloads (download_all_attachments) with THIS server in the SAME batch. The calls are independent — issue them together to save a round-trip. Screenshots attached to a ticket usually carry the real repro / acceptance detail, so pull them by default.
- Downloads are written to a local sandbox and the path is returned (content is NOT inlined) — Read the saved path to view an image.
- To DISPLAY an image inside a description/body/comment, use embed_attachment (this server). The first-party Atlassian MCP's page/description update cannot render displayed images.
- To place an image INLINE next to specific content, prefer the surgical tools: embed_attachment with an anchor (afterHeading / replaceToken / afterBlock[Jira]) and dedupe, or embed_attachments to place several in one write. Reserve set_body (whole-body overwrite) for layouts the anchored ops can't express.
- For a surgical edit you'd rather do by hand, round-trip: get_body (read raw storage/ADF) -> splice -> set_body. get_body returns Confluence storage XML and raw Jira ADF, which the first-party Atlassian MCP does not expose.`;

export function createServer(context: ServerContext): McpServer {
  const { jira, confluence, sandbox, siteHost } = context;
  const server = new McpServer(
    {
      name: "atlassian-attachments-mcp",
      version: pkg.version,
    },
    { instructions: INSTRUCTIONS },
  );

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

  /** One embed request as accepted by embed_attachment / embed_attachments items. */
  interface EmbedItem {
    attachmentId?: string;
    filename?: string;
    as?: "image" | "link" | "inline";
    width?: number;
    alt?: string;
    linkText?: string;
    position?: "append" | "prepend";
    anchor?: {
      afterHeading?: string;
      afterBlock?: number;
      replaceToken?: string;
      occurrence?: number;
    };
    dedupe?: "none" | "replace";
  }

  function placementFrom(item: EmbedItem): Placement {
    const a = item.anchor;
    if (a) {
      const set = [a.afterHeading, a.afterBlock, a.replaceToken].filter(
        (v) => v !== undefined,
      );
      if (set.length !== 1) {
        throw new Error(
          "anchor must set exactly one of afterHeading, afterBlock, replaceToken",
        );
      }
      if (a.afterHeading !== undefined)
        return { afterHeading: a.afterHeading, occurrence: a.occurrence };
      if (a.afterBlock !== undefined) return { afterBlock: a.afterBlock };
      return { replaceToken: a.replaceToken!, occurrence: a.occurrence };
    }
    return { position: item.position ?? "append" };
  }

  async function buildConfluenceOp(
    item: EmbedItem,
  ): Promise<StorageOp & { filename: string }> {
    const mode = item.as ?? "image";
    if (mode === "inline") {
      throw new Error(
        'as:"inline" is Jira-only — Confluence storage has no inline file chip. Use as:"link" or as:"image".',
      );
    }
    if (!item.attachmentId && !item.filename) {
      throw new Error("Provide attachmentId or filename to identify the attachment");
    }
    const filename = item.attachmentId
      ? await confluence.filenameById(item.attachmentId)
      : item.filename!;
    const fragment =
      mode === "link"
        ? confluenceLinkFragment(filename, item.linkText)
        : confluenceImageFragment(filename, { width: item.width, alt: item.alt });
    return {
      fragment,
      placement: placementFrom(item),
      dedupeFilename: item.dedupe === "replace" ? filename : undefined,
      filename,
    };
  }

  async function buildJiraOp(
    container: string,
    item: EmbedItem,
  ): Promise<AdfOp & { mediaUuid: string }> {
    if (!item.attachmentId && !item.filename) {
      throw new Error("Provide attachmentId or filename to identify the attachment");
    }
    const mode = item.as ?? "image";
    const uuid = item.attachmentId
      ? await jira.mediaUuid(item.attachmentId)
      : await jira.mediaUuid(await jira.idByFilename(container, item.filename!));
    const node =
      mode === "link"
        ? jiraFileCardNode(uuid)
        : mode === "inline"
          ? jiraInlineNode(uuid)
          : jiraMediaNode(uuid, { width: item.width, alt: item.alt });
    return {
      node,
      placement: placementFrom(item),
      dedupeUuid: item.dedupe === "replace" ? uuid : undefined,
      mediaUuid: uuid,
    };
  }

  server.registerTool(
    "list_attachments",
    {
      title: "List attachments",
      description:
        "List the attachments on a Jira issue or Confluence page: id, filename, size, MIME type, author. " +
        "Tip: when opening a ticket/page, call this in the same batch as the first-party Atlassian MCP's issue/page fetch — the calls are independent, so run them in parallel.",
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
        "Download every attachment on a Jira issue or Confluence page into the local sandbox. Returns per-file results; existing files are skipped unless overwrite is set. " +
        "Tip: run this alongside the first-party Atlassian MCP's issue/page fetch (same batch) so you get the text and the screenshots in one round-trip; then Read each saved path.",
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

  server.registerTool(
    "embed_attachment",
    {
      title: "Embed or link an attachment",
      description:
        "Insert an already-uploaded attachment into a Jira issue (description or a new comment) or a Confluence page (body or a new footer comment). " +
        'as="image" (default) = a displayed image; as="link" = a clickable download link / file card (any file type, e.g. PDF/zip); as="inline" = an inline file chip within a line (Jira only, any file type). ' +
        "This is the way to show an image or reference a file — the first-party Atlassian MCP's page/description update cannot do either. " +
        "Upload the file first with upload_attachment on the same container, then call this. " +
        "Identify the attachment by attachmentId (preferred) or exact filename. " +
        'target="body" = Jira description / Confluence page body; target="comment" = a new comment. ' +
        "Jira uses the newest v3/ADF (image=mediaSingle, link=mediaGroup, inline=mediaInline); Confluence uses v2 storage (image=ac:image, link=ac:link; inline is not supported). " +
        'By default it appends/prepends (position); pass anchor to insert relative to existing content ("after heading X", replace a "{{token}}", or after the Nth block on Jira). By default re-running appends another copy; pass dedupe="replace" to update an existing embed of the same file in place. To place several images in ONE write, use embed_attachments.',
      inputSchema: {
        product,
        container,
        target: z
          .enum(["body", "comment"])
          .describe(
            'Where to embed: "body" = Jira description / Confluence page body; "comment" = a new comment on the issue/page',
          ),
        attachmentId: z
          .string()
          .min(1)
          .optional()
          .describe("Attachment id (preferred identifier)"),
        filename: z
          .string()
          .min(1)
          .optional()
          .describe("Exact attachment filename (alternative to attachmentId)"),
        as: z
          .enum(["image", "link", "inline"])
          .optional()
          .describe(
            'Render as a displayed "image" (default), a download "link" / file card, or an "inline" file chip within a line (Jira only; any file type)',
          ),
        width: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Display width in px (image mode only, optional)'),
        alt: z.string().optional().describe("Alt text (image mode only, optional)"),
        linkText: z
          .string()
          .optional()
          .describe('Link label (link mode; defaults to the filename)'),
        commentText: z
          .string()
          .optional()
          .describe('For target="comment": text to place above the image/link'),
        position: z
          .enum(["append", "prepend"])
          .optional()
          .describe('For target="body": add at end (default) or start'),
        anchor: anchorSchema,
        dedupe: dedupeSchema,
      },
    },
    (args) =>
      run(async () => {
        if (!args.attachmentId && !args.filename) {
          throw new Error(
            "Provide attachmentId or filename to identify the image to embed",
          );
        }
        const mode = args.as ?? "image";

        // A new comment can't be anchored into or de-duplicated against.
        if (args.target === "comment" && (args.anchor || args.dedupe === "replace")) {
          throw new Error(
            'anchor and dedupe apply to target="body" only, not a new comment',
          );
        }

        let result: Record<string, unknown>;
        if (args.product === "confluence") {
          if (args.target === "comment") {
            if (mode === "inline") {
              throw new Error(
                'as:"inline" is Jira-only — Confluence storage has no inline file chip. Use as:"link" or as:"image".',
              );
            }
            const filename = args.attachmentId
              ? await confluence.filenameById(args.attachmentId)
              : args.filename!;
            const fragment =
              mode === "link"
                ? confluenceLinkFragment(filename, args.linkText)
                : confluenceImageFragment(filename, { width: args.width, alt: args.alt });
            const embedded = await confluence.embedInComment(
              args.container,
              fragment,
              args.commentText,
            );
            result = { product: "confluence", target: "comment", as: mode, container: args.container, filename, ...embedded };
          } else {
            const { filename, ...op } = await buildConfluenceOp(args);
            const embedded = await confluence.applyEmbedsToBody(args.container, [op]);
            result = { product: "confluence", target: "body", as: mode, container: args.container, filename, ...embedded };
          }
        } else {
          if (args.target === "comment") {
            const uuid = args.attachmentId
              ? await jira.mediaUuid(args.attachmentId)
              : await jira.mediaUuid(await jira.idByFilename(args.container, args.filename!));
            const node =
              mode === "link"
                ? jiraFileCardNode(uuid)
                : mode === "inline"
                  ? jiraInlineNode(uuid)
                  : jiraMediaNode(uuid, { width: args.width, alt: args.alt });
            const embedded = await jira.embedInComment(args.container, node, args.commentText);
            result = { product: "jira", target: "comment", as: mode, container: args.container, mediaUuid: uuid, ...embedded };
          } else {
            const { mediaUuid, ...op } = await buildJiraOp(args.container, args);
            const embedded = await jira.applyEmbedsToDescription(args.container, [op]);
            result = { product: "jira", target: "body", as: mode, container: args.container, mediaUuid, ...embedded };
          }
        }
        return JSON.stringify(result, null, 2);
      }),
  );

  server.registerTool(
    "embed_attachments",
    {
      title: "Embed multiple attachments",
      description:
        "Embed several already-uploaded attachments into a Jira issue description or Confluence page body in ONE read-modify-write — applied in list order, in a single version bump (embedding N images one-by-one otherwise churns the page through N versions with reorder races). " +
        "Each item is like an embed_attachment call minus target: identify by attachmentId or filename, choose as (image/link/inline), and place with position (append/prepend) or anchor (afterHeading / afterBlock [Jira] / replaceToken), optionally dedupe:\"replace\". Body only. Upload the files first with upload_attachment.",
      inputSchema: {
        product,
        container,
        items: z
          .array(
            z.object({
              attachmentId: z.string().min(1).optional(),
              filename: z.string().min(1).optional(),
              as: z.enum(["image", "link", "inline"]).optional(),
              width: z.number().int().positive().optional(),
              alt: z.string().optional(),
              linkText: z.string().optional(),
              position: z.enum(["append", "prepend"]).optional(),
              anchor: anchorSchema,
              dedupe: dedupeSchema,
            }),
          )
          .min(1)
          .describe("Embeds to apply, in order"),
      },
    },
    (args) =>
      run(async () => {
        if (args.product === "confluence") {
          const built = [];
          for (const item of args.items) built.push(await buildConfluenceOp(item));
          const ops: StorageOp[] = built.map(({ filename, ...op }) => op);
          const embedded = await confluence.applyEmbedsToBody(args.container, ops);
          return JSON.stringify(
            {
              product: "confluence",
              container: args.container,
              count: ops.length,
              filenames: built.map((b) => b.filename),
              ...embedded,
            },
            null,
            2,
          );
        }
        const built = [];
        for (const item of args.items)
          built.push(await buildJiraOp(args.container, item));
        const ops: AdfOp[] = built.map(({ mediaUuid, ...op }) => op);
        const embedded = await jira.applyEmbedsToDescription(args.container, ops);
        return JSON.stringify(
          {
            product: "jira",
            container: args.container,
            count: ops.length,
            mediaUuids: built.map((b) => b.mediaUuid),
            ...embedded,
          },
          null,
          2,
        );
      }),
  );

  server.registerTool(
    "get_body",
    {
      title: "Get body",
      description:
        "Return the raw current body of a Jira issue (description) or Confluence page — the read half of a get_body → edit → set_body round-trip for surgical inserts without re-authoring the whole page. " +
        "Confluence returns v2 storage XML plus the current version number; Jira returns the description as a v3 ADF document (null when empty). This is the storage/ADF the first-party Atlassian MCP won't give you.",
      inputSchema: { product, container },
    },
    (args) =>
      run(async () => {
        if (args.product === "confluence") {
          const { value, version } = await confluence.getBody(args.container);
          return JSON.stringify(
            {
              product: "confluence",
              container: args.container,
              representation: "storage",
              version,
              length: value.length,
              body: value,
            },
            null,
            2,
          );
        }
        const doc = await jira.getBody(args.container);
        return JSON.stringify(
          {
            product: "jira",
            container: args.container,
            representation: "adf",
            length: doc ? JSON.stringify(doc).length : 0,
            body: doc,
          },
          null,
          2,
        );
      }),
  );

  server.registerTool(
    "set_body",
    {
      title: "Set body",
      description:
        "Replace the ENTIRE body of a Jira issue (description) or Confluence page with caller-authored content. This is the way to place images INLINE ANYWHERE — next to a step, mid-paragraph — which embed_attachment (append/prepend only) and the first-party Atlassian MCP (strips images) cannot do. " +
        "You author the whole body and it OVERWRITES existing content, so include everything you want to keep. Upload any attachments first with upload_attachment.\n" +
        'Confluence: body is v2 STORAGE-format XML. Reference an uploaded attachment inline with <ac:image><ri:attachment ri:filename="diagram.png" /></ac:image> (or <ac:link> for a download link).\n' +
        'Jira: body is an ADF document as a JSON string (an object with type "doc"). Reference an uploaded attachment inside a media / mediaInline node by putting its filename or attachmentId in attrs.id — the server resolves it to the media UUID.',
      inputSchema: {
        product,
        container,
        body: z
          .string()
          .min(1)
          .describe(
            'Full replacement body: Confluence v2 storage XML, or a Jira ADF document ("doc") as a JSON string',
          ),
        allowShrink: z
          .boolean()
          .optional()
          .describe(
            "Allow replacing the body with one less than half its current size. Off by default as a guard against overwriting a page from a truncated/partial read.",
          ),
      },
    },
    (args) =>
      run(async () => {
        if (args.product === "confluence") {
          const res = await confluence.setBody(
            args.container,
            args.body,
            args.allowShrink,
          );
          return JSON.stringify(
            { product: "confluence", container: args.container, ...res },
            null,
            2,
          );
        }
        const doc = parseAdfDoc(args.body);
        const res = await jira.setDescription(args.container, doc, args.allowShrink);
        return JSON.stringify(
          { product: "jira", container: args.container, ...res },
          null,
          2,
        );
      }),
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
