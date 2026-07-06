# Embed with hand-built nodes, not @atlaskit/adf-utils

`embed_attachment` writes attachment references directly into container bodies and comments: Confluence via v2 storage XML (`<ac:image>` / `<ac:link>` with `<ri:attachment>`), Jira via v3 ADF nodes (`mediaSingle` / `mediaGroup` / `mediaInline`). These fragments are hand-built in `embed.ts` as plain strings and objects — no Atlassian authoring library.

We deliberately did **not** adopt `@atlaskit/adf-utils`. For three trivial media nodes it drags `@atlaskit/adf-schema`, platform feature-flags, and editor telemetry (`tmp-editor-statsig`) into a headless MCP — dependencies built for the browser editor, not a server. The hand-built nodes are live-verified against a real site across all four targets (Jira description/comment, Confluence body/comment) × three modes, and the write APIs are the validator: a malformed node is rejected on `PUT`/`POST`. The pure builders carry unit tests; the tool handler and embed methods carry integration tests.

## The media-UUID mechanic

A Jira ADF media node's `id` is the media-services file UUID — which the upload and list responses never expose. The server resolves it on demand from the attachment content endpoint: `GET /rest/api/3/attachment/content/{id}` returns a `302` to `https://api.media.atlassian.com/file/<UUID>/binary`, so a no-follow request (`redirectLocation()` on the HTTP client) reads the UUID off the `Location` header without downloading the file. Confluence references attachments by filename, so it needs no UUID.

## Whole-body authoring (set_body)

`embed_attachment` only inserts a reference at the start or end of a body. To place images inline anywhere (next to a step, mid-paragraph), `set_body` lets the caller author the entire body: Confluence storage XML written straight through (attachments referenced by filename, no resolution needed), or a Jira ADF `doc` whose `media`/`mediaInline` nodes carry a filename or attachmentId in `attrs.id`. Before the PUT, the server walks the ADF tree (`collectMediaNodes`), resolves each non-UUID `id` to a media UUID (numeric id = attachmentId, otherwise a filename lookup), and stamps `collection: ""`. This reuses the same UUID mechanic below rather than asking the caller — an LLM — to know UUIDs it can't see. The body is overwritten wholesale, so the caller owns the complete content.

## Consequences

- Confluence storage and Jira ADF shapes are pinned to what those APIs accept today; an API change means updating the builders in `embed.ts`, not bumping a dependency.
- `as: "inline"` is Jira-only — Confluence storage has no inline file chip, so that combination throws with a pointer to `as: "link"`.
- Body embeds are a read-modify-write (retried once on a `409` version conflict) and append without dedupe; re-embedding the same file adds another copy.
