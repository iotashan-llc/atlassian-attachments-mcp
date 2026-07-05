import { describe, it, expect } from "vitest";
import {
  parseMediaUuid,
  xmlEscapeAttr,
  xmlEscapeText,
  confluenceImageFragment,
  confluenceLinkFragment,
  insertIntoStorage,
  jiraMediaNode,
  jiraFileCardNode,
  jiraInlineNode,
  appendToAdfDoc,
  jiraCommentDoc,
  type AdfNode,
} from "./embed.js";

describe("parseMediaUuid", () => {
  it("extracts the UUID from a media content-redirect Location", () => {
    const loc =
      "https://api.media.atlassian.com/file/d40d93f0-d8d3-4699-a0d4-5b13bf9005f8/binary?token=abc&client=x&dl=true&name=a.png";
    expect(parseMediaUuid(loc)).toBe("d40d93f0-d8d3-4699-a0d4-5b13bf9005f8");
  });

  it("throws when no UUID is present", () => {
    expect(() => parseMediaUuid("https://example.com/nope")).toThrow(/media file UUID/);
  });
});

describe("xml escaping", () => {
  it("escapes attribute-hostile characters", () => {
    expect(xmlEscapeAttr(`a&b<c>"d'e`)).toBe("a&amp;b&lt;c&gt;&quot;d&#39;e");
  });
  it("escapes text content (no quote escaping needed)", () => {
    expect(xmlEscapeText("a & b < c > d")).toBe("a &amp; b &lt; c &gt; d");
  });
});

describe("confluenceImageFragment", () => {
  it("renders a bare image referencing the attachment by filename", () => {
    expect(confluenceImageFragment("shot.png")).toBe(
      '<p><ac:image><ri:attachment ri:filename="shot.png" /></ac:image></p>',
    );
  });
  it("includes width and escaped alt when provided", () => {
    expect(confluenceImageFragment("a b&.png", { width: 900.6, alt: 'x"y' })).toBe(
      '<p><ac:image ac:width="901" ac:alt="x&quot;y"><ri:attachment ri:filename="a b&amp;.png" /></ac:image></p>',
    );
  });
});

describe("confluenceLinkFragment", () => {
  it("links to the attachment, defaulting the label to the filename", () => {
    expect(confluenceLinkFragment("doc.pdf")).toBe(
      '<p><ac:link><ri:attachment ri:filename="doc.pdf" /><ac:plain-text-link-body><![CDATA[doc.pdf]]></ac:plain-text-link-body></ac:link></p>',
    );
  });
  it("uses a custom label and escapes the filename attribute", () => {
    expect(confluenceLinkFragment('a&b.pdf', "Read me")).toBe(
      '<p><ac:link><ri:attachment ri:filename="a&amp;b.pdf" /><ac:plain-text-link-body><![CDATA[Read me]]></ac:plain-text-link-body></ac:link></p>',
    );
  });
  it("splits a literal ]]> in the label so CDATA stays valid", () => {
    expect(confluenceLinkFragment("f.pdf", "x]]>y")).toContain(
      "<![CDATA[x]]]]><![CDATA[>y]]>",
    );
  });
});

describe("jiraFileCardNode", () => {
  it("builds a mediaGroup file card with empty collection", () => {
    expect(jiraFileCardNode("u")).toEqual({
      type: "mediaGroup",
      content: [{ type: "media", attrs: { type: "file", id: "u", collection: "" } }],
    });
  });
});

describe("insertIntoStorage", () => {
  it("appends by default and prepends when asked", () => {
    expect(insertIntoStorage("<p>x</p>", "<img>", "append")).toBe("<p>x</p><img>");
    expect(insertIntoStorage("<p>x</p>", "<img>", "prepend")).toBe("<img><p>x</p>");
  });
});

describe("jiraMediaNode", () => {
  it("builds a mediaSingle with empty collection", () => {
    expect(jiraMediaNode("uuid-1")).toEqual({
      type: "mediaSingle",
      attrs: { layout: "center" },
      content: [{ type: "media", attrs: { type: "file", id: "uuid-1", collection: "" } }],
    });
  });
  it("adds width/alt when provided", () => {
    const n = jiraMediaNode("uuid-1", { width: 800.4, alt: "cap" });
    expect(n.content?.[0].attrs).toMatchObject({ width: 800, alt: "cap" });
  });
});

describe("jiraInlineNode", () => {
  it("wraps a mediaInline chip in a paragraph (inline node must be inline)", () => {
    expect(jiraInlineNode("u")).toEqual({
      type: "paragraph",
      content: [
        { type: "mediaInline", attrs: { type: "file", id: "u", collection: "" } },
      ],
    });
  });
});

describe("appendToAdfDoc", () => {
  const node = jiraMediaNode("u");
  it("creates a fresh doc from null", () => {
    const doc = appendToAdfDoc(null, node, "append");
    expect(doc).toEqual({ type: "doc", version: 1, content: [node] });
  });
  it("appends to and prepends into existing content without mutating the input", () => {
    const existing: AdfNode = {
      type: "doc",
      version: 1,
      content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }],
    };
    const appended = appendToAdfDoc(existing, node, "append");
    expect(appended.content?.at(-1)).toBe(node);
    expect(appended.content).toHaveLength(2);
    const prepended = appendToAdfDoc(existing, node, "prepend");
    expect(prepended.content?.[0]).toBe(node);
    // input untouched
    expect(existing.content).toHaveLength(1);
  });
});

describe("jiraCommentDoc", () => {
  it("wraps just the media node when no text", () => {
    const node = jiraMediaNode("u");
    expect(jiraCommentDoc(node)).toEqual({ type: "doc", version: 1, content: [node] });
  });
  it("puts an optional text paragraph before the image", () => {
    const node = jiraMediaNode("u");
    const doc = jiraCommentDoc(node, "see below");
    expect(doc.content?.[0]).toEqual({
      type: "paragraph",
      content: [{ type: "text", text: "see below" }],
    });
    expect(doc.content?.[1]).toBe(node);
  });
});
