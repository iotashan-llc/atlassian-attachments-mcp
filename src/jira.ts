import path from "node:path";
import { openAsBlob } from "node:fs";
import type { AtlassianClient } from "./http.js";

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
}
