# Files move via the filesystem, not the protocol

Download and bulk-download tools stream attachment bodies to disk and return only the sandbox-relative path plus metadata (size, MIME type, original filename); file bytes never flow through MCP messages into model context. This avoids Node memory bloat on large binaries, context-window blowups, and duplicating the file-read tools every agent host already has.

The one deliberate exception: the Thumbnail tool returns an MCP image content block inline. Thumbnails are small by design, and letting a vision model literally look at a screenshot on a bug — no filesystem hop — is the entire value of the tool.

## Consequences

- `returnContent`-style options on download tools are out of scope by design; agents read downloaded files with their own tools.
- Downloads are streamed (request body piped to a file handle), never buffered whole in memory.
