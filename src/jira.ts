import path from "node:path";
import { openAsBlob } from "node:fs";
import type { AtlassianClient } from "./http.js";
import { AtlassianApiError } from "./errors.js";
import {
  applyAdfOps,
  collectMediaNodes,
  isMediaUuid,
  jiraCommentDoc,
  parseMediaUuid,
  type AdfNode,
  type AdfOp,
} from "./embed.js";

/** Product-neutral attachment summary shared by both clients. */
export interface AttachmentInfo {
  id: string;
  filename: string;
  size: number;
  mimeType: string;
  created?: string;
  author?: string;
}

interface JiraAttachmentBean {
  id: string | number;
  filename: string;
  size: number;
  mimeType: string;
  created?: string;
  author?: { displayName?: string };
}

export interface ArchiveEntry {
  path?: string;
  label?: string;
  size?: number;
  mediaType?: string;
  index?: number;
}

function toInfo(bean: JiraAttachmentBean): AttachmentInfo {
  return {
    id: String(bean.id),
    filename: bean.filename,
    size: bean.size,
    mimeType: bean.mimeType,
    created: bean.created,
    author: bean.author?.displayName,
  };
}

export class JiraAttachments {
  constructor(private readonly client: AtlassianClient) {}

  async list(issueKey: string): Promise<AttachmentInfo[]> {
    const issue = await this.client.json<{
      fields?: { attachment?: JiraAttachmentBean[] };
    }>(`/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=attachment`);
    return (issue.fields?.attachment ?? []).map(toInfo);
  }

  async upload(
    issueKey: string,
    filePath: string,
    filename?: string,
  ): Promise<Array<AttachmentInfo & { mediaId: string; collection: string }>> {
    const form = new FormData();
    form.append(
      "file",
      await openAsBlob(filePath),
      filename ?? path.basename(filePath),
    );
    const created = await this.client.uploadMultipart<JiraAttachmentBean[]>(
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}/attachments`,
      form,
    );
    // Resolve the media UUID so callers can author ADF/HTML media nodes directly,
    // not just storage ri:attachment-by-filename. collection is "" for issue media.
    const out = [];
    for (const bean of created) {
      const info = toInfo(bean);
      out.push({ ...info, mediaId: await this.mediaUuid(info.id), collection: "" });
    }
    return out;
  }

  async metadata(id: string): Promise<AttachmentInfo> {
    return toInfo(
      await this.client.json<JiraAttachmentBean>(
        `/rest/api/3/attachment/${encodeURIComponent(id)}`,
      ),
    );
  }

  download(id: string): Promise<Response> {
    return this.client.download(
      `/rest/api/3/attachment/content/${encodeURIComponent(id)}`,
    );
  }

  thumbnail(id: string): Promise<Response> {
    return this.client.download(
      `/rest/api/3/attachment/thumbnail/${encodeURIComponent(id)}`,
    );
  }

  async remove(id: string): Promise<void> {
    await this.client.json<void>(
      `/rest/api/3/attachment/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    );
  }

  peek(id: string): Promise<{
    entries?: ArchiveEntry[];
    totalEntryCount?: number;
    name?: string;
  }> {
    return this.client.json(
      `/rest/api/3/attachment/${encodeURIComponent(id)}/expand/human`,
    );
  }

  limits(): Promise<{ enabled: boolean; uploadLimit: number }> {
    return this.client.json("/rest/api/3/attachment/meta");
  }

  /**
   * Resolve the media-services file UUID for an attachment — the id an ADF
   * media node needs. The upload/list responses don't carry it; the content
   * endpoint 302s to api.media.atlassian.com/file/<UUID>/binary, so we read it
   * off the Location header without downloading the file.
   */
  async mediaUuid(attachmentId: string): Promise<string> {
    const location = await this.client.redirectLocation(
      `/rest/api/3/attachment/content/${encodeURIComponent(attachmentId)}`,
    );
    return parseMediaUuid(location);
  }

  /** Find a single attachment id by exact filename on an issue. */
  async idByFilename(issueKey: string, filename: string): Promise<string> {
    const matches = (await this.list(issueKey)).filter(
      (a) => a.filename === filename,
    );
    if (matches.length === 0) {
      throw new Error(`No attachment named "${filename}" on ${issueKey}`);
    }
    if (matches.length > 1) {
      throw new Error(
        `Multiple attachments named "${filename}" on ${issueKey} — pass attachmentId instead`,
      );
    }
    return matches[0].id;
  }

  /** The issue description as raw v3 ADF (null when empty) — read side of set_body. */
  async getBody(issueKey: string): Promise<AdfNode | null> {
    const issue = await this.client.json<{
      fields?: { description?: AdfNode | null };
    }>(`/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=description`);
    return issue.fields?.description ?? null;
  }

  /** Resolve one ADF media id (UUID passthrough, else attachmentId/filename) to a media UUID. */
  private async resolveMediaRef(issueKey: string, ref: string): Promise<string> {
    if (isMediaUuid(ref)) return ref;
    // ponytail: all-digits = attachmentId, otherwise treat as a filename.
    const id = /^\d+$/.test(ref) ? ref : await this.idByFilename(issueKey, ref);
    return this.mediaUuid(id);
  }

  /**
   * Replace the whole issue description with a caller-authored ADF doc,
   * resolving any media nodes whose id is an attachmentId/filename to its
   * media UUID. This is the way to place images inline anywhere (embed only
   * appends/prepends). Overwrites existing content — the caller owns the doc.
   */
  async setDescription(
    issueKey: string,
    doc: AdfNode,
  ): Promise<{ issueKey: string; mediaResolved: number }> {
    const medias = collectMediaNodes(doc);
    const refs = new Set<string>();
    for (const m of medias) {
      const id = m.attrs?.id;
      if (typeof id === "string" && id && !isMediaUuid(id)) refs.add(id);
    }
    const resolved = new Map<string, string>();
    for (const ref of refs) {
      resolved.set(ref, await this.resolveMediaRef(issueKey, ref));
    }
    for (const m of medias) {
      const id = m.attrs?.id;
      if (typeof id === "string" && resolved.has(id)) {
        m.attrs!.id = resolved.get(id);
        if (m.attrs!.collection === undefined) m.attrs!.collection = "";
      }
    }
    await this.client.json<void>(
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: { description: doc } }),
      },
    );
    return { issueKey, mediaResolved: refs.size };
  }

  /**
   * Apply one or more placed embeds to the issue description (v3 ADF) in a single
   * read-modify-write, preserving existing content. Supports anchors and replace.
   */
  async applyEmbedsToDescription(
    issueKey: string,
    ops: AdfOp[],
  ): Promise<{ issueKey: string }> {
    for (let attempt = 0; ; attempt++) {
      try {
        const doc = applyAdfOps(await this.getBody(issueKey), ops);
        await this.client.json<void>(
          `/rest/api/3/issue/${encodeURIComponent(issueKey)}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fields: { description: doc } }),
          },
        );
        return { issueKey };
      } catch (err) {
        if (attempt === 0 && err instanceof AtlassianApiError && err.status === 409)
          continue;
        throw err;
      }
    }
  }

  /** Add a new comment (v3 ADF) containing the media node and optional text. */
  async embedInComment(
    issueKey: string,
    node: AdfNode,
    text?: string,
  ): Promise<{ commentId: string }> {
    const res = await this.client.json<{ id: string }>(
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: jiraCommentDoc(node, text) }),
      },
    );
    return { commentId: res.id };
  }
}
