import path from "node:path";
import { openAsBlob } from "node:fs";
import type { AtlassianClient } from "./http.js";
import type { AttachmentInfo } from "./jira.js";

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
