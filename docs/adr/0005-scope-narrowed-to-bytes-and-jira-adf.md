# Scope narrowed to bytes and Jira ADF

[ADR 0001](0001-attachments-only-scope-atlassian-wide-name.md) drew the boundary at "needs local file I/O." That test still holds for transfers, but it no longer explains the body tools, because the first-party server moved: `getConfluencePage` / `updateConfluencePage` with `contentFormat: "html"` now round-trip Confluence bodies losslessly, media nodes included, and the schema documents the format as round-trip safe. Verified live, July 2026.

The sharper test is **"would going through the first-party server lose data or require a shell?"** By that test:

- **Bytes** — still ours. The first-party server is remote; Rovo MCP v2's preview attachment tools mostly return a curl command for the client to execute, so they need shell access, expose signed URLs to shell history, and never make the file visible to the model.
- **Jira bodies** — still ours, and this is now the strongest claim in the project. `getJiraIssue(responseContentFormat: "adf")` returns markdown regardless, collapsing `mediaSingle` to a `blob:` URL with a null `localId` and empty `collection`. Writing that back destroys the embed.
- **Confluence bodies** — no longer ours. Kept, not promoted: the tools still accept Confluence, and the one thing they do that HTML+ can't is reference an attachment by `ri:filename`, which is what a just-uploaded file needs (no first-party Confluence tool exposes its media UUID).

Two tools were removed outright. Neither was made redundant by Atlassian — both failed on their own merits, judged by value per schema token, since every tool's schema is re-sent in every session of every client:

- **`get_attachment_limits`** — a one-shot Jira diagnostic returning an enabled flag and a byte cap.
- **`peek_archive_attachment`** — Jira-only zip listing; `download_attachment` covers the same need with one extra step.

Rovo v2 sharpened this: its dozens of operations sit behind `discover`/`execute` and cost nothing until used, while a pre-declared tool here is a permanent tax. Adopting a discovery layer for ten tools would be over-engineering, but the accounting it implies is correct.

## Considered Options

- **Remove the Confluence half of `get_body` / `set_body` / `embed_attachment(s)`** — rejected. The filename-referencing path is genuinely unavailable first-party, and splitting one tool into Jira-only and Confluence-only variants would raise the tool count to cut capability.
- **Deprecate on Rovo v2's arrival** — rejected. v2 is preview, on separate OAuth infrastructure, and its transfer tools hand back shell commands rather than bytes. Nothing there replaces a local process.
- **Keep all twelve tools and only fix the docs** — rejected. It was the recommendation of both peer models consulted, but both reasoned from published docs rather than the live API, and neither weighed permanent schema cost against how rarely the two dropped tools are reached for.
- **Adopt a `discover`/`execute` indirection** — rejected as premature for ten tools.

## Consequences

- Breaking change, released as 2.0.0: two tools disappear from the surface.
- The README's competitive claims now carry a verification date and must be re-checked periodically. Atlassian closed the Confluence gap without announcement; it can close the Jira one the same way, and that would obsolete four more tools.
- The remaining pitch is narrower and more defensible: bytes, and Jira ADF fidelity.
