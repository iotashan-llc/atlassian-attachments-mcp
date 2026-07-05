import path from "node:path";
import { openAsBlob } from "node:fs";
import type { AtlassianClient } from "./http.js";
import { AtlassianApiError } from "./errors.js";
import {
  appendToAdfDoc,
  jiraCommentDoc,
  parseMediaUuid,
  type AdfNode,
  type Position,
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
  ): Promise<AttachmentInfo[]> {
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
    return created.map(toInfo);
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

  private async description(issueKey: string): Promise<AdfNode | null> {
    const issue = await this.client.json<{
      fields?: { description?: AdfNode | null };
    }>(`/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=description`);
    return issue.fields?.description ?? null;
  }

  /** Append/prepend a media node to the issue description (v3 ADF), preserving existing content. */
  async embedInDescription(
    issueKey: string,
    node: AdfNode,
    position: Position,
  ): Promise<{ issueKey: string }> {
    for (let attempt = 0; ; attempt++) {
      try {
        const doc = appendToAdfDoc(await this.description(issueKey), node, position);
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
