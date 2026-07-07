# Changelog

All notable changes to `atlassian-attachments-mcp`. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); each entry records **what** changed
and **why**. The project complements the first-party (remote) Atlassian MCP, which
cannot touch attachment binaries or render/place images — so the "why" here is
almost always "close a gap that MCP structurally can't."

## [1.2.0] — 2026-07-06

Field-feedback release: authoring multi-image Confluence docs with 1.1.0 surfaced
real friction. Everything here comes from that feedback.

### Added
- **`get_body`** — returns the raw current body (Confluence v2 storage XML + version,
  or the Jira description as v3 ADF), with a `length` field.
  *Why:* `set_body` was write-only, so every edit meant re-authoring the whole page.
  A `get_body` → splice → `set_body` round-trip makes surgical edits possible — and
  the first-party `getConfluencePage` won't return storage at all (its storage enum
  is rejected), so there was previously no way to round-trip.
- **`embed_attachments`** — embeds several attachments into a body in one
  read-modify-write, in list order.
  *Why:* embedding six images one-by-one churned the page through six versions
  (v7→v13) with reorder races. One call = one version bump, deterministic order.
- **Anchored placement** on `embed_attachment` — `anchor` with `afterHeading`,
  `replaceToken` (a `{{token}}` placeholder), or `afterBlock` (Jira only), plus
  `occurrence`.
  *Why:* append/prepend-only forced users into full-body re-authoring just to put an
  image next to a specific step. Anchors also insert **without reading the whole body
  back**, sidestepping the first-party page-read token limit on large pages.
- **`dedupe: "replace"`** on `embed_attachment` / `embed_attachments` — updates an
  existing embed of the same file in place.
  *Why:* re-running previously always appended another copy (accidental duplicates).
- **`upload_attachment` (Jira)** now also returns each attachment's `mediaId` (media
  UUID) + `collection`.
  *Why:* without the UUID you could only reference images via storage
  `ri:attachment`-by-filename; now callers can author ADF/HTML media nodes directly.
- **`set_body` shrink-guard** — refuses to replace a body over 200 chars with one
  less than half its size unless `allowShrink: true`.
  *Why:* guards against overwriting a page from a truncated/partial read (the
  "published half a doc" failure), which a harness `cat` truncation can cause.

### Changed
- Body embeds now flow through a shared pure reducer (`applyAdfOps` /
  `applyStorageOps`); Jira uses clean ADF tree ops, Confluence uses bounded,
  fail-closed string edits with no XML/DOM dependency (rich headings error toward
  `replaceToken`/`set_body`; `afterBlock` is Jira-only).
- Docs: `set_body` is documented as storage/ADF only — never markdown (the
  first-party markdown importer is lossy: strips images, collapses nested lists).

### Process
- Design drafted independently by two peer models (Codex + Gemini) to consensus; the
  implementation diff was adversarially reviewed (Codex `xhigh`), which caught and
  fixed five real bugs before release: a Confluence dedupe regex that could delete
  content spanning two embeds, out-of-document-order heading `occurrence`, an
  unescaped token search, clobbering a multi-media block on dedupe, and stale
  server instructions.

## [1.1.0] — 2026-07-06

### Added
- **`set_body`** — replaces the whole body with caller-authored content, placing
  images inline anywhere. Confluence takes storage XML directly; Jira takes an ADF
  doc whose media nodes reference attachments by filename/id (resolved to media
  UUIDs server-side).
  *Why:* `embed_attachment` could only append/prepend, so there was no way to put an
  image next to a specific step; the first-party page/description update strips
  images entirely.

### Changed
- README reworked for non-developers: UI clients (Claude Desktop, Cursor, VS Code)
  before CLI clients, plain-language intro, one-click install paths (Cursor deeplink,
  `code --add-mcp`), and an Updating section.
  *Why:* a non-dev coworker found the previous, developer-oriented README confusing.
- Documented an honest caveat that the ChatGPT and Claude.ai **web** apps can't run a
  local stdio server (remote MCP only).

## [1.0.0] — 2026-07-06

Initial public release on npm (`npx -y atlassian-attachments-mcp`).

### Added
- Nine tools for Jira + Confluence Cloud attachments — the file operations the
  first-party remote Atlassian MCP structurally can't do: `list_attachments`,
  `upload_attachment`, `download_attachment`, `download_all_attachments`,
  `delete_attachment`, `peek_archive_attachment` (Jira), `get_attachment_thumbnail`
  (Jira), `get_attachment_limits` (Jira), and `embed_attachment`.
  *Why:* the official Atlassian MCP runs in Atlassian's cloud with no filesystem
  access, so it cannot upload, download, or render attachment binaries.
- **Sandboxed downloads** — the server only ever writes inside one gitignored root;
  filenames sanitized, containment realpath-verified, symlinks refused, no overwrite
  without `overwrite: true`.
  *Why:* attachment filenames/bodies are untrusted input and prompt injection in
  ticket text can steer an auto-approved agent.
- Media-services UUID resolution for Jira ADF embeds, read from the attachment
  content endpoint's redirect (the upload/list APIs never expose it).

[1.2.0]: https://github.com/iotashan-llc/atlassian-attachments-mcp/releases/tag/v1.2.0
[1.1.0]: https://github.com/iotashan-llc/atlassian-attachments-mcp/releases/tag/v1.1.0
[1.0.0]: https://github.com/iotashan-llc/atlassian-attachments-mcp/releases/tag/v1.0.0
