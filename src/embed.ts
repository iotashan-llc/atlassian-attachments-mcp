/**
 * Pure, dependency-free helpers for building embed payloads.
 *
 * Embedding a *displayed* image is something the first-party Atlassian MCP
 * cannot do: its Confluence body update rejects media-single / img data-attrs /
 * storage ac:image, and its Jira description update needs a media UUID it never
 * exposes. So this server writes the embed directly — Confluence via v2 storage
 * (<ac:image><ri:attachment/>), Jira via v3 ADF (a media node whose id is the
 * media-services UUID parsed from the attachment content-redirect).
 */

export type Position = "append" | "prepend";

/** Extract the media-services file UUID from an attachment content-redirect Location. */
export function parseMediaUuid(location: string): string {
  const m = location.match(
    /\/file\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(?:\/|$)/,
  );
  if (!m) {
    throw new Error(
      `Could not parse a media file UUID from the attachment redirect Location: ${location}`,
    );
  }
  return m[1];
}

/** Escape a string for use inside an XML attribute value (storage format). */
export function xmlEscapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escape a string for use as XML text content (storage format). */
export function xmlEscapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Confluence storage-format paragraph embedding an attached image by filename. */
export function confluenceImageFragment(
  filename: string,
  opts: { width?: number; alt?: string } = {},
): string {
  const attrs: string[] = [];
  if (opts.width !== undefined) attrs.push(`ac:width="${Math.round(opts.width)}"`);
  if (opts.alt) attrs.push(`ac:alt="${xmlEscapeAttr(opts.alt)}"`);
  const open = attrs.length ? `<ac:image ${attrs.join(" ")}>` : "<ac:image>";
  return `<p>${open}<ri:attachment ri:filename="${xmlEscapeAttr(
    filename,
  )}" /></ac:image></p>`;
}

/** Confluence storage-format paragraph linking to an attachment by filename. */
export function confluenceLinkFragment(filename: string, text?: string): string {
  const label = text ?? filename;
  // CDATA can't contain a literal "]]>" — split it if present.
  const cdata = label.replace(/]]>/g, "]]]]><![CDATA[>");
  return `<p><ac:link><ri:attachment ri:filename="${xmlEscapeAttr(
    filename,
  )}" /><ac:plain-text-link-body><![CDATA[${cdata}]]></ac:plain-text-link-body></ac:link></p>`;
}

/** Insert a storage fragment at the start or end of an existing storage body. */
export function insertIntoStorage(
  body: string,
  fragment: string,
  position: Position,
): string {
  return position === "prepend" ? fragment + body : body + fragment;
}

// --- Jira ADF ---

export interface AdfNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
  version?: number;
  text?: string;
}

/** ADF mediaSingle node for an issue attachment (collection is "" for Jira). */
export function jiraMediaNode(
  uuid: string,
  opts: { width?: number; alt?: string } = {},
): AdfNode {
  const attrs: Record<string, unknown> = {
    type: "file",
    id: uuid,
    collection: "",
  };
  if (opts.width !== undefined) attrs.width = Math.round(opts.width);
  if (opts.alt) attrs.alt = opts.alt;
  return {
    type: "mediaSingle",
    attrs: { layout: "center" },
    content: [{ type: "media", attrs }],
  };
}

/** ADF mediaGroup node — a downloadable file card, the native way to link any attachment type. */
export function jiraFileCardNode(uuid: string): AdfNode {
  return {
    type: "mediaGroup",
    content: [{ type: "media", attrs: { type: "file", id: uuid, collection: "" } }],
  };
}

/**
 * ADF paragraph wrapping a mediaInline chip — an inline file reference that
 * works for ANY attachment type (not just images), Jira only. mediaInline is an
 * inline node, so it must live inside a paragraph.
 */
export function jiraInlineNode(uuid: string): AdfNode {
  return {
    type: "paragraph",
    content: [
      { type: "mediaInline", attrs: { type: "file", id: uuid, collection: "" } },
    ],
  };
}

/** Normalize a possibly-null ADF description and insert a node at start/end. */
export function appendToAdfDoc(
  doc: AdfNode | null | undefined,
  node: AdfNode,
  position: Position,
): AdfNode {
  const base: AdfNode =
    doc && doc.type === "doc"
      ? { ...doc, content: [...(doc.content ?? [])] }
      : { type: "doc", version: 1, content: [] };
  const content = base.content ?? (base.content = []);
  if (position === "prepend") content.unshift(node);
  else content.push(node);
  return base;
}

/** ADF doc for a new comment: optional text paragraph + the media node. */
export function jiraCommentDoc(node: AdfNode, text?: string): AdfNode {
  const content: AdfNode[] = [];
  if (text) {
    content.push({ type: "paragraph", content: [{ type: "text", text }] });
  }
  content.push(node);
  return { type: "doc", version: 1, content };
}
