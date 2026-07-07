import path from "node:path";
import { openAsBlob } from "node:fs";
import type { AtlassianClient } from "./http.js";
import type { AttachmentInfo } from "./jira.js";
import { AtlassianApiError } from "./errors.js";
import { applyStorageOps, xmlEscapeText, type StorageOp } from "./embed.js";

/**
 * Confluence Cloud straddles two API generations: list/get/delete live on
 * v2 (/wiki/api/v2), upload only exists on v1 (/wiki/rest/api). Download
 * goes through the attachment's downloadLink under /wiki.
 */
export interface ConfluenceAttachment {
  id: string;
  title: string;
  mediaType?: string;
  fileSize?: number;
  pageId?: string;
  createdAt?: string;
  downloadLink?: string;
}

interface ConfluenceV1Result {
  id: string;
  title: string;
  extensions?: { mediaType?: string; fileSize?: number };
}

export function toAttachmentInfo(att: ConfluenceAttachment): AttachmentInfo {
  return {
    id: att.id,
    filename: att.title,
    size: att.fileSize ?? 0,
    mimeType: att.mediaType ?? "application/octet-stream",
    created: att.createdAt,
  };
}

const MAX_PAGES = 40;

export class ConfluenceAttachments {
  constructor(private readonly client: AtlassianClient) {}

  /** Raw v2 attachment objects (they carry downloadLink), all pages. */
  async list(pageId: string): Promise<ConfluenceAttachment[]> {
    const all: ConfluenceAttachment[] = [];
    let next: string | undefined =
      `/wiki/api/v2/pages/${encodeURIComponent(pageId)}/attachments?limit=250`;
    for (let page = 0; next && page < MAX_PAGES; page++) {
      const res: {
        results: ConfluenceAttachment[];
        _links?: { next?: string };
      } = await this.client.json(next);
      all.push(...res.results);
      next = res._links?.next
        ? wikiPath(res._links.next)
        : undefined;
    }
    return all;
  }

  async upload(
    pageId: string,
    filePath: string,
    filename?: string,
  ): Promise<AttachmentInfo[]> {
    const form = new FormData();
    form.append(
      "file",
      await openAsBlob(filePath),
      filename ?? path.basename(filePath),
    );
    const res = await this.client.uploadMultipart<{
      results: ConfluenceV1Result[];
    }>(
      `/wiki/rest/api/content/${encodeURIComponent(pageId)}/child/attachment`,
      form,
    );
    return res.results.map((r) => ({
      id: r.id,
      filename: r.title,
      size: r.extensions?.fileSize ?? 0,
      mimeType: r.extensions?.mediaType ?? "application/octet-stream",
    }));
  }

  metadata(id: string): Promise<ConfluenceAttachment> {
    return this.client.json(
      `/wiki/api/v2/attachments/${encodeURIComponent(id)}`,
    );
  }

  /** Open the binary stream for an already-fetched attachment object. */
  open(meta: ConfluenceAttachment): Promise<Response> {
    if (!meta.downloadLink) {
      throw new Error(`Attachment ${meta.id} has no download link`);
    }
    return this.client.download(wikiPath(meta.downloadLink));
  }

  async remove(id: string): Promise<void> {
    await this.client.json<void>(
      `/wiki/api/v2/attachments/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    );
  }

  /** Confluence embeds reference an attachment by filename; resolve it from an id. */
  async filenameById(attachmentId: string): Promise<string> {
    return (await this.metadata(attachmentId)).title;
  }

  /** The page body as raw v2 storage XML + current version — read side of set_body. */
  async getBody(pageId: string): Promise<{ value: string; version: number }> {
    const page = await this.client.json<{
      version: { number: number };
      body: { storage: { value: string } };
    }>(`/wiki/api/v2/pages/${encodeURIComponent(pageId)}?body-format=storage`);
    return {
      value: page.body.storage.value ?? "",
      version: page.version.number,
    };
  }

  /**
   * Replace the whole page body with caller-authored v2 storage XML (version+1).
   * The way to place images inline anywhere — reference an uploaded attachment
   * with <ac:image><ri:attachment ri:filename="..."/></ac:image>. Overwrites
   * existing content, so the caller must supply the complete body.
   */
  async setBody(pageId: string, value: string): Promise<{ version: number }> {
    for (let attempt = 0; ; attempt++) {
      try {
        const page = await this.client.json<{
          id: string;
          status: string;
          title: string;
          version: { number: number };
        }>(`/wiki/api/v2/pages/${encodeURIComponent(pageId)}?body-format=storage`);
        const number = page.version.number + 1;
        await this.client.json<void>(
          `/wiki/api/v2/pages/${encodeURIComponent(pageId)}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: pageId,
              status: page.status,
              title: page.title,
              body: { representation: "storage", value },
              version: { number, message: "Set body" },
            }),
          },
        );
        return { version: number };
      } catch (err) {
        if (attempt === 0 && err instanceof AtlassianApiError && err.status === 409)
          continue;
        throw err;
      }
    }
  }

  /**
   * Apply one or more placed embeds to the page body (v2 storage) in a single
   * read-modify-write (version+1). Supports anchors and replace.
   */
  async applyEmbedsToBody(
    pageId: string,
    ops: StorageOp[],
  ): Promise<{ version: number }> {
    for (let attempt = 0; ; attempt++) {
      try {
        const page = await this.client.json<{
          id: string;
          status: string;
          title: string;
          version: { number: number };
          body: { storage: { value: string } };
        }>(`/wiki/api/v2/pages/${encodeURIComponent(pageId)}?body-format=storage`);
        const value = applyStorageOps(page.body.storage.value ?? "", ops);
        const number = page.version.number + 1;
        await this.client.json<void>(
          `/wiki/api/v2/pages/${encodeURIComponent(pageId)}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: pageId,
              status: page.status,
              title: page.title,
              body: { representation: "storage", value },
              version: { number, message: "Embed attachments" },
            }),
          },
        );
        return { version: number };
      } catch (err) {
        if (attempt === 0 && err instanceof AtlassianApiError && err.status === 409)
          continue;
        throw err;
      }
    }
  }

  /** Add a footer comment (v2) containing a prebuilt fragment and optional text. */
  async embedInComment(
    pageId: string,
    fragment: string,
    text?: string,
  ): Promise<{ commentId: string }> {
    const textHtml = text ? `<p>${xmlEscapeText(text)}</p>` : "";
    const value = textHtml + fragment;
    const res = await this.client.json<{ id: string }>(
      "/wiki/api/v2/footer-comments",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pageId,
          body: { representation: "storage", value },
        }),
      },
    );
    return { commentId: res.id };
  }
}

/** Normalize a v2 link (relative or same-origin absolute) to a /wiki path. */
function wikiPath(link: string): string {
  let p = link;
  if (p.startsWith("http")) {
    const url = new URL(p);
    p = url.pathname + url.search;
  }
  return p.startsWith("/wiki") ? p : "/wiki" + p;
}
