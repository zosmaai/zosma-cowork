import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { generateSlides, validateDeck, listTemplates, SlideDeck } from "./index";
import * as extModule from "./index";

describe("validateDeck", () => {
  it("accepts a minimal valid deck", () => {
    const deck = { title: "Test", theme: "dark", slides: [{ type: "title", title: "Hi" }] };
    const result = validateDeck(deck);
    expect(result.title).toBe("Test");
    expect(result.theme).toBe("dark");
    expect(result.slides).toHaveLength(1);
  });

  it("defaults theme to dark when missing", () => {
    const deck = { title: "Test", slides: [{ type: "title" }] };
    expect(validateDeck(deck).theme).toBe("dark");
  });

  it("trims whitespace from title", () => {
    const deck = { title: "  Trimmed  ", slides: [{ type: "cta" }] };
    expect(validateDeck(deck).title).toBe("Trimmed");
  });

  it("rejects null input", () => {
    expect(() => validateDeck(null)).toThrow();
  });

  it("rejects missing title", () => {
    expect(() => validateDeck({ slides: [] })).toThrow(/title/);
  });

  it("rejects empty title", () => {
    expect(() => validateDeck({ title: "   ", slides: [] })).toThrow(/title/);
  });

  it("rejects missing slides array", () => {
    expect(() => validateDeck({ title: "Test" })).toThrow(/slide/);
  });

  it("rejects empty slides array", () => {
    expect(() => validateDeck({ title: "Test", slides: [] })).toThrow(/at least one/);
  });

  it("rejects invalid theme", () => {
    expect(() => validateDeck({ title: "T", slides: [{ type: "title" }], theme: "neon" })).toThrow(/theme/);
  });

  it("rejects slide with missing type", () => {
    expect(() => validateDeck({ title: "T", slides: [{}] })).toThrow(/type/);
  });

  it("rejects slide with invalid type", () => {
    expect(() => validateDeck({ title: "T", slides: [{ type: "invalid" }] })).toThrow(/type/);
  });
});

describe("listTemplates", () => {
  it("returns an array of templates", () => {
    const templates = listTemplates();
    expect(Array.isArray(templates)).toBe(true);
    expect(templates.length).toBeGreaterThan(0);
    expect(templates[0]).toHaveProperty("name");
    expect(templates[0]).toHaveProperty("description");
  });

  it("includes a pitch template", () => {
    const templates = listTemplates();
    expect(templates.some((t) => t.name === "pitch")).toBe(true);
  });
});

describe("createExtension (default export)", () => {
  it("returns extension with correct name and version", () => {
    const createExt = extModule.default;
    const ext = createExt();
    expect(ext.name).toBe("slide-generator");
    expect(ext.version).toBe("0.1.0");
  });

  it("exposes generate_slides tool", () => {
    const createExt = extModule.default;
    const ext = createExt();
    expect(ext.tools.generate_slides).toBeDefined();
    expect(ext.tools.generate_slides.description).toContain("pptx");
  });

  it("exposes list_templates tool", () => {
    const createExt = extModule.default;
    const ext = createExt();
    expect(ext.tools.list_templates).toBeDefined();
  });
});

describe("generateSlides", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "zosma-slides-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("generates a PPTX file with correct slide count", async () => {
    const deck: SlideDeck = {
      title: "Test Deck",
      theme: "dark",
      slides: [
        { type: "title", title: "Hello World", subtitle: "A test" },
        { type: "content", title: "Features", items: ["Fast", "Reliable"] },
        { type: "cta", title: "Get Started" },
      ],
    };
    const outputPath = path.join(tmpDir, "test.pptx");
    const result = await generateSlides(deck, outputPath);

    expect(result.slides).toBe(3);
    expect(result.filePath).toBe(outputPath);
    expect(fs.existsSync(outputPath)).toBe(true);

    const stat = fs.statSync(outputPath);
    expect(stat.size).toBeGreaterThan(0);
  });

  it("generates all slide types without crashing", async () => {
    const deck: SlideDeck = {
      title: "All Types",
      theme: "light",
      slides: [
        { type: "title", title: "Title Slide" },
        { type: "section", title: "Section 1" },
        { type: "content", title: "Content", content: "Some text here", items: ["A", "B"] },
        {
          type: "comparison",
          title: "Compare",
          left: { title: "Left", bullets: ["L1"] },
          right: { title: "Right", bullets: ["R1"] },
        },
        {
          type: "cards",
          title: "Cards Slide",
          cards: [
            { title: "Card 1", content: "Content 1" },
            { title: "Card 2", content: "Content 2" },
          ],
        },
        { type: "cta", title: "CTA", content: "Call to action text" },
      ],
    };
    const outputPath = path.join(tmpDir, "all-types.pptx");
    const result = await generateSlides(deck, outputPath);

    expect(result.slides).toBe(6);
    expect(fs.existsSync(outputPath)).toBe(true);
  });

  it("supports corporate theme", async () => {
    const deck: SlideDeck = { title: "Corp", theme: "corporate", slides: [{ type: "title", title: "Corporate" }] };
    const outputPath = path.join(tmpDir, "corp.pptx");
    const result = await generateSlides(deck, outputPath);
    expect(result.slides).toBe(1);
    expect(fs.existsSync(outputPath)).toBe(true);
  });

  it("throws on invalid deck input", async () => {
    await expect(generateSlides({ title: "", slides: [] } as unknown, path.join(tmpDir, "bad.pptx"))).rejects.toThrow();
  });

  it("returns buffer when no outputPath provided", async () => {
    const deck: SlideDeck = { title: "Buffer Test", slides: [{ type: "title", title: "Buf" }] };
    const result = await generateSlides(deck);
    expect(result.buffer).toBeDefined();
    expect(typeof result.buffer).toBe("string");
    expect(result.filePath).toBe("");
  });
});
