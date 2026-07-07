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

/** A bare media-services file UUID (the resolved form of an ADF media id). */
const MEDIA_UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** True when the value is already a media UUID (so it needs no resolution). */
export function isMediaUuid(value: string): boolean {
  return MEDIA_UUID_RE.test(value);
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

/** Collect every media / mediaInline node in an ADF tree (depth-first). */
export function collectMediaNodes(node: AdfNode, out: AdfNode[] = []): AdfNode[] {
  if (node.type === "media" || node.type === "mediaInline") out.push(node);
  for (const child of node.content ?? []) collectMediaNodes(child, out);
  return out;
}

/** Parse a caller-supplied ADF body from a JSON string, validating it's a doc. */
export function parseAdfDoc(body: string): AdfNode {
  let doc: unknown;
  try {
    doc = JSON.parse(body);
  } catch (err) {
    throw new Error(
      `Jira body must be a JSON ADF document: ${(err as Error).message}`,
    );
  }
  if (!doc || typeof doc !== "object" || (doc as AdfNode).type !== "doc") {
    throw new Error('Jira body must be an ADF document (an object with type "doc").');
  }
  return doc as AdfNode;
}

/**
 * True when replacing `oldText` with `newText` looks like accidental content loss —
 * a non-trivial body shrinking by more than half. Guards set_body against the
 * "wrote back a truncated read" failure; the caller can override with allowShrink.
 */
export function bodyShrinkTooMuch(oldText: string, newText: string): boolean {
  return oldText.length > 200 && newText.length < oldText.length * 0.5;
}

// --- Anchored / batch placement (shared by embed_attachment + embed_attachments) ---

/**
 * Where to place an embed in a body. `position` is the append/prepend fallback;
 * the anchors insert relative to existing content. `afterBlock` is Jira-only
 * (Confluence storage has no reliable block index).
 */
export type Placement =
  | { position: "append" | "prepend" }
  | { afterHeading: string; occurrence?: number }
  | { afterBlock: number }
  | { replaceToken: string; occurrence?: number };

/** One Jira embed: the media node, where to place it, and an optional dedupe key. */
export interface AdfOp {
  node: AdfNode;
  placement: Placement;
  /** When set and an existing media node with this UUID is found, replace it in place. */
  dedupeUuid?: string;
}

/** One Confluence embed: the storage fragment, placement, and optional dedupe key. */
export interface StorageOp {
  fragment: string;
  placement: Placement;
  /** When set and an existing embed of this filename is found, replace it in place. */
  dedupeFilename?: string;
}

function regexEscape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeDoc(doc: AdfNode | null | undefined): AdfNode {
  return doc && doc.type === "doc"
    ? { ...doc, content: [...(doc.content ?? [])] }
    : { type: "doc", version: 1, content: [] };
}

/** Concatenated text of an ADF block's descendants (for heading/token matching). */
function adfBlockText(node: AdfNode): string {
  if (node.type === "text") return node.text ?? "";
  return (node.content ?? []).map(adfBlockText).join("");
}

function findBlockIndex(
  content: AdfNode[],
  type: string,
  text: string,
  occurrence: number,
): number {
  let seen = 0;
  for (let i = 0; i < content.length; i++) {
    if (content[i].type === type && adfBlockText(content[i]).trim() === text.trim()) {
      if (++seen === occurrence) return i;
    }
  }
  return -1;
}

/** Apply a list of embeds to a Jira ADF description, in order, returning a new doc. */
export function applyAdfOps(doc: AdfNode | null | undefined, ops: AdfOp[]): AdfNode {
  const base = normalizeDoc(doc);
  const content = base.content!;
  const cursor = new Map<string, number>();
  for (const op of ops) {
    if (op.dedupeUuid) {
      const di = content.findIndex((b) =>
        collectMediaNodes(b).some((m) => m.attrs?.id === op.dedupeUuid),
      );
      // Replace only a single-embed block (what this tool creates). If the UUID lives
      // in a multi-media block (e.g. a mediaGroup with siblings), don't clobber it —
      // fall through and place a fresh copy instead of destroying the neighbours.
      if (di >= 0 && collectMediaNodes(content[di]).length === 1) {
        content[di] = op.node;
        continue;
      }
    }
    const p = op.placement;
    if ("position" in p) {
      if (p.position === "prepend") content.unshift(op.node);
      else content.push(op.node);
      continue;
    }
    if ("replaceToken" in p) {
      const ti = findBlockIndex(content, "paragraph", p.replaceToken, p.occurrence ?? 1);
      if (ti < 0) {
        throw new Error(
          `Token "${p.replaceToken}" was not found as its own paragraph in the Jira description`,
        );
      }
      content[ti] = op.node;
      continue;
    }
    let baseIdx: number;
    if ("afterHeading" in p) {
      baseIdx = findBlockIndex(content, "heading", p.afterHeading, p.occurrence ?? 1);
      if (baseIdx < 0) {
        throw new Error(`No heading "${p.afterHeading}" in the Jira description`);
      }
    } else {
      if (p.afterBlock < 1 || p.afterBlock > content.length) {
        throw new Error(
          `afterBlock ${p.afterBlock} is out of range (1..${content.length})`,
        );
      }
      baseIdx = p.afterBlock - 1;
    }
    // Per-anchor cursor: repeated inserts at the same anchor keep their given order.
    const key = JSON.stringify(p);
    const c = cursor.get(key) ?? 0;
    content.splice(baseIdx + 1 + c, 0, op.node);
    cursor.set(key, c + 1);
  }
  return base;
}

/** Position just past the Nth plain `<hN>text</hN>` heading in DOCUMENT order, or -1. */
function storageHeadingEnd(body: string, text: string, occurrence: number): number {
  const esc = xmlEscapeText(text.trim());
  const ends: number[] = [];
  for (let n = 1; n <= 6; n++) {
    const needle = `<h${n}>${esc}</h${n}>`;
    let from = 0;
    let idx: number;
    while ((idx = body.indexOf(needle, from)) >= 0) {
      ends.push(idx + needle.length);
      from = idx + needle.length;
    }
  }
  // occurrence is 1-based over headings sorted by their position in the document.
  ends.sort((a, b) => a - b);
  return ends[occurrence - 1] ?? -1;
}

/** Matches an embed this tool generated for a given (already XML-escaped) filename. */
function storageEmbedRegex(escapedFilename: string): RegExp {
  const f = regexEscape(escapedFilename);
  // Tempered `(?:(?!</p>)[^])*?` cannot cross a </p>, so the match is confined to the
  // single generated paragraph holding this filename — never spanning an earlier embed.
  return new RegExp(
    `<p><ac:(?:image|link)\\b(?:(?!</p>)[^])*?ri:filename="${f}"(?:(?!</p>)[^])*?</ac:(?:image|link)></p>`,
  );
}

/** Apply a list of embeds to a Confluence storage body, in order, returning a new string. */
export function applyStorageOps(body: string, ops: StorageOp[]): string {
  let out = body;
  const cursor = new Map<string, number>();
  for (const op of ops) {
    if (op.dedupeFilename) {
      const re = storageEmbedRegex(xmlEscapeAttr(op.dedupeFilename));
      if (re.test(out)) {
        out = out.replace(re, () => op.fragment);
        continue;
      }
    }
    const p = op.placement;
    if ("position" in p) {
      out = p.position === "prepend" ? op.fragment + out : out + op.fragment;
      continue;
    }
    if ("afterBlock" in p) {
      throw new Error(
        "afterBlock is Jira-only — Confluence storage has no reliable block index. Use afterHeading, replaceToken, or set_body.",
      );
    }
    if ("replaceToken" in p) {
      out = replaceStorageToken(out, p.replaceToken, op.fragment, p.occurrence ?? 1);
      continue;
    }
    // afterHeading
    const key = JSON.stringify(p);
    const base = storageHeadingEnd(out, p.afterHeading, p.occurrence ?? 1);
    if (base < 0) {
      throw new Error(
        `No plain heading "${p.afterHeading}" in the Confluence page (headings with nested markup aren't matched — use replaceToken or set_body)`,
      );
    }
    const off = cursor.get(key) ?? 0;
    out = out.slice(0, base + off) + op.fragment + out.slice(base + off);
    cursor.set(key, off + op.fragment.length);
  }
  return out;
}

/** Replace the Nth `<p>token</p>` (preferred) or bare `token` with a fragment. */
function replaceStorageToken(
  body: string,
  token: string,
  fragment: string,
  occurrence: number,
): string {
  // Tokens are stored as escaped text (a filename's & becomes &amp;), so search the
  // escaped form; a literal token typed by the user is matched by its escaped bytes.
  const esc = xmlEscapeText(token);
  const wrapped = `<p>${esc}</p>`;
  const target = body.includes(wrapped) ? wrapped : body.includes(esc) ? esc : null;
  if (target === null) {
    throw new Error(`Token "${token}" was not found in the Confluence page`);
  }
  let from = 0;
  let seen = 0;
  let idx: number;
  while ((idx = body.indexOf(target, from)) >= 0) {
    if (++seen === occurrence) {
      return body.slice(0, idx) + fragment + body.slice(idx + target.length);
    }
    from = idx + target.length;
  }
  throw new Error(`Token "${token}" occurrence ${occurrence} was not found`);
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
