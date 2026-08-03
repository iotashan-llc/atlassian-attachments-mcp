# Attachments-only scope, Atlassian-wide name

> **Partly superseded by [ADR 0005](0005-scope-narrowed-to-bytes-and-jira-adf.md) (July 2026).** The "cannot touch attachments at all" premise below was true when written; Rovo MCP v2 preview has since added attachment operations, though they hand the client a curl command rather than moving bytes. The scope test has been re-drawn from "needs local file I/O" to "would the first-party path lose data or require a shell."

The official Atlassian MCP server is remote and therefore cannot touch attachments at all (no local filesystem access). This project fills exactly that gap and nothing else: attachment operations for Jira issues **and** Confluence pages, running locally via `npx atlassian-attachments-mcp`. Local file I/O is the differentiator; any capability that doesn't need it is out of scope — even ones genuinely missing from the official MCP.

## Considered Options

- **`jira-helper` (general Jira gap-filler)** — rejected by a three-way model panel (Codex, Gemini, Claude) unanimously: it implies general Jira coverage, invites duplicating the official MCP, and undersells the real differentiator.
- **`jira-attachments-helper` (Jira-only)** — truthful for the original scope, but Confluence attachments share the identical gap, the same site, and the same email+API-token auth, so they joined v1 and the name had to widen on the product axis (Atlassian), not the feature axis (helper).
- **Companion APIs evaluated and rejected**: agile/boards/sprints, watchers, issue comment edit/delete, project versions/components, user avatars. All are real gaps in the official MCP, but none need local file I/O. They belong upstream, not here.

## Consequences

- npm package and GitHub repo are both `atlassian-attachments-mcp`; npm names are effectively permanent, which is why this was decided before any code.
- Feature requests that don't involve binary content or local files get closed as out of scope, by design.
