import { describe, it, expect } from "vitest";
import {
  parseMediaUuid,
  isMediaUuid,
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
  collectMediaNodes,
  parseAdfDoc,
  applyAdfOps,
  applyStorageOps,
  type AdfNode,
} from "./embed.js";

const heading = (text: string): AdfNode => ({
  type: "heading",
  attrs: { level: 2 },
  content: [{ type: "text", text }],
});
const para = (text: string): AdfNode => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

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

describe("isMediaUuid", () => {
  it("accepts a bare UUID and rejects filenames / ids", () => {
    expect(isMediaUuid("d40d93f0-d8d3-4699-a0d4-5b13bf9005f8")).toBe(true);
    expect(isMediaUuid("diagram.png")).toBe(false);
    expect(isMediaUuid("10001")).toBe(false);
  });
});

describe("collectMediaNodes", () => {
  it("finds media and mediaInline nodes at any depth", () => {
    const doc: AdfNode = {
      type: "doc",
      version: 1,
      content: [
        { type: "paragraph", content: [{ type: "text", text: "hi" }] },
        jiraMediaNode("a.png"),
        {
          type: "paragraph",
          content: [{ type: "mediaInline", attrs: { id: "b.pdf" } }],
        },
      ],
    };
    const ids = collectMediaNodes(doc).map((n) => n.attrs?.id);
    expect(ids).toEqual(["a.png", "b.pdf"]);
  });
});

describe("parseAdfDoc", () => {
  it("parses a valid doc", () => {
    expect(parseAdfDoc('{"type":"doc","version":1,"content":[]}')).toEqual({
      type: "doc",
      version: 1,
      content: [],
    });
  });
  it("rejects invalid JSON", () => {
    expect(() => parseAdfDoc("{not json")).toThrow(/JSON ADF document/);
  });
  it("rejects a non-doc object", () => {
    expect(() => parseAdfDoc('{"type":"paragraph"}')).toThrow(/type "doc"/);
  });
});

describe("applyAdfOps", () => {
  const img = (id: string) => jiraMediaNode(id);

  it("appends and prepends", () => {
    const doc: AdfNode = { type: "doc", version: 1, content: [para("x")] };
    const out = applyAdfOps(doc, [
      { node: img("a"), placement: { position: "append" } },
      { node: img("b"), placement: { position: "prepend" } },
    ]);
    expect(out.content!.map((n) => n.type)).toEqual([
      "mediaSingle",
      "paragraph",
      "mediaSingle",
    ]);
  });

  it("inserts after a heading by text", () => {
    const doc: AdfNode = {
      type: "doc",
      version: 1,
      content: [heading("Step 1"), para("do it"), heading("Step 2")],
    };
    const out = applyAdfOps(doc, [
      { node: img("a"), placement: { afterHeading: "Step 1" } },
    ]);
    expect(out.content![1]).toEqual(img("a"));
    expect(out.content!.map((n) => n.type)).toEqual([
      "heading",
      "mediaSingle",
      "paragraph",
      "heading",
    ]);
  });

  it("keeps order for repeated inserts at the same anchor", () => {
    const doc: AdfNode = { type: "doc", version: 1, content: [heading("H")] };
    const out = applyAdfOps(doc, [
      { node: img("first"), placement: { afterHeading: "H" } },
      { node: img("second"), placement: { afterHeading: "H" } },
    ]);
    expect(out.content![1].content![0].attrs!.id).toBe("first");
    expect(out.content![2].content![0].attrs!.id).toBe("second");
  });

  it("inserts after the Nth block", () => {
    const doc: AdfNode = { type: "doc", version: 1, content: [para("1"), para("2")] };
    const out = applyAdfOps(doc, [{ node: img("a"), placement: { afterBlock: 1 } }]);
    expect(out.content!.map((n) => n.type)).toEqual([
      "paragraph",
      "mediaSingle",
      "paragraph",
    ]);
  });

  it("replaces a token paragraph", () => {
    const doc: AdfNode = {
      type: "doc",
      version: 1,
      content: [para("before"), para("{{img:a.png}}"), para("after")],
    };
    const out = applyAdfOps(doc, [
      { node: img("a"), placement: { replaceToken: "{{img:a.png}}" } },
    ]);
    expect(out.content!.map((n) => n.type)).toEqual([
      "paragraph",
      "mediaSingle",
      "paragraph",
    ]);
  });

  it("dedupe does NOT clobber a multi-media block; places a fresh copy instead", () => {
    const doc: AdfNode = {
      type: "doc",
      version: 1,
      content: [
        {
          type: "mediaGroup",
          content: [
            { type: "media", attrs: { type: "file", id: "uuid-1", collection: "" } },
            { type: "media", attrs: { type: "file", id: "uuid-2", collection: "" } },
          ],
        },
      ],
    };
    const out = applyAdfOps(doc, [
      {
        node: jiraMediaNode("uuid-1"),
        placement: { position: "append" },
        dedupeUuid: "uuid-1",
      },
    ]);
    // group left intact (both media survive), new copy appended
    expect(out.content).toHaveLength(2);
    expect(out.content![0].content).toHaveLength(2);
    expect(out.content![1].type).toBe("mediaSingle");
  });

  it("dedupe replaces an existing media node with the same uuid in place", () => {
    const doc: AdfNode = {
      type: "doc",
      version: 1,
      content: [para("top"), jiraMediaNode("uuid-1", { width: 100 }), para("end")],
    };
    const out = applyAdfOps(doc, [
      {
        node: jiraMediaNode("uuid-1", { width: 500 }),
        placement: { position: "append" },
        dedupeUuid: "uuid-1",
      },
    ]);
    // replaced in place (index 1), not appended
    expect(out.content).toHaveLength(3);
    expect(out.content![1].content![0].attrs!.width).toBe(500);
  });

  it("throws when the heading anchor is missing", () => {
    const doc: AdfNode = { type: "doc", version: 1, content: [para("x")] };
    expect(() =>
      applyAdfOps(doc, [{ node: img("a"), placement: { afterHeading: "Nope" } }]),
    ).toThrow(/No heading "Nope"/);
  });
});

describe("applyStorageOps", () => {
  const frag = (name: string) => confluenceImageFragment(name);

  it("appends and prepends", () => {
    expect(
      applyStorageOps("<p>x</p>", [
        { fragment: "<A/>", placement: { position: "append" } },
        { fragment: "<B/>", placement: { position: "prepend" } },
      ]),
    ).toBe("<B/><p>x</p><A/>");
  });

  it("inserts after a plain heading", () => {
    const out = applyStorageOps("<h2>Step 1</h2><p>body</p>", [
      { fragment: "<IMG/>", placement: { afterHeading: "Step 1" } },
    ]);
    expect(out).toBe("<h2>Step 1</h2><IMG/><p>body</p>");
  });

  it("keeps order for repeated inserts after the same heading", () => {
    const out = applyStorageOps("<h2>H</h2>", [
      { fragment: "<1/>", placement: { afterHeading: "H" } },
      { fragment: "<2/>", placement: { afterHeading: "H" } },
    ]);
    expect(out).toBe("<h2>H</h2><1/><2/>");
  });

  it("throws when the heading is not a plain match (nested markup)", () => {
    expect(() =>
      applyStorageOps("<h2><span>Step 1</span></h2>", [
        { fragment: "<IMG/>", placement: { afterHeading: "Step 1" } },
      ]),
    ).toThrow(/No plain heading/);
  });

  it("replaces a <p>token</p> placeholder", () => {
    const out = applyStorageOps("<p>intro</p><p>{{img:a.png}}</p><p>end</p>", [
      { fragment: "<IMG/>", placement: { replaceToken: "{{img:a.png}}" } },
    ]);
    expect(out).toBe("<p>intro</p><IMG/><p>end</p>");
  });

  it("rejects afterBlock (Jira-only)", () => {
    expect(() =>
      applyStorageOps("<p>x</p>", [
        { fragment: "<IMG/>", placement: { afterBlock: 1 } },
      ]),
    ).toThrow(/Jira-only/);
  });

  it("dedupe replaces an existing embed of the same filename in place", () => {
    const body = "<p>top</p>" + frag("shot.png") + "<p>end</p>";
    const out = applyStorageOps(body, [
      {
        fragment: confluenceImageFragment("shot.png", { width: 800 }),
        placement: { position: "append" },
        dedupeFilename: "shot.png",
      },
    ]);
    expect(out).toBe(
      '<p>top</p><p><ac:image ac:width="800"><ri:attachment ri:filename="shot.png" /></ac:image></p><p>end</p>',
    );
  });

  it("dedupe replaces ONLY the target embed, leaving an earlier embed untouched", () => {
    const body = frag("a.png") + frag("b.png");
    const out = applyStorageOps(body, [
      {
        fragment: confluenceImageFragment("b.png", { width: 900 }),
        placement: { position: "append" },
        dedupeFilename: "b.png",
      },
    ]);
    // a.png embed intact, b.png replaced in place — nothing between them deleted
    expect(out).toBe(
      frag("a.png") +
        '<p><ac:image ac:width="900"><ri:attachment ri:filename="b.png" /></ac:image></p>',
    );
  });

  it("afterHeading occurrence follows document order across heading levels", () => {
    const body = "<h3>Dup</h3><p>x</p><h2>Dup</h2>";
    const first = applyStorageOps(body, [
      { fragment: "<IMG/>", placement: { afterHeading: "Dup", occurrence: 1 } },
    ]);
    // occurrence 1 = the h3 (earlier in the document), not the h2
    expect(first).toBe("<h3>Dup</h3><IMG/><p>x</p><h2>Dup</h2>");
    const second = applyStorageOps(body, [
      { fragment: "<IMG/>", placement: { afterHeading: "Dup", occurrence: 2 } },
    ]);
    expect(second).toBe("<h3>Dup</h3><p>x</p><h2>Dup</h2><IMG/>");
  });

  it("replaceToken matches a token containing XML-sensitive characters", () => {
    // stored escaped: {{a&b}} -> {{a&amp;b}}
    const body = "<p>{{a&amp;b}}</p>";
    const out = applyStorageOps(body, [
      { fragment: "<IMG/>", placement: { replaceToken: "{{a&b}}" } },
    ]);
    expect(out).toBe("<IMG/>");
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
