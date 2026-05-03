/**
 * @zosmaai/zosma-slides - Slide Generation Extension for Zosma Cowork
 *
 * Converts structured JSON content into professional .pptx files.
 * Used as a Pi-compatible extension loaded via the Node.js sidecar.
 */

import PptxGenJS from "pptxgenjs";

// --- Types ---

export type ThemeName = "dark" | "light" | "corporate";
export type SlideType = "title" | "section" | "content" | "comparison" | "cards" | "cta";

export interface SlideData {
  type: SlideType;
  title?: string;
  subtitle?: string;
  content?: string;
  items?: string[];
  left?: { title: string; bullets: string[] };
  right?: { title: string; bullets: string[] };
  cards?: Array<{ title: string; content: string }>;
}

export interface SlideDeck {
  title: string;
  theme?: ThemeName;
  slides: SlideData[];
}

export interface GenerateResult {
  filePath: string;
  slides: number;
  buffer?: string;
}

// --- Themes ---

const themes: Record<ThemeName, { bg: string; text: string; accent: string; secondary: string; titleSize: number; bodySize: number }> = {
  dark: { bg: "1a1a2e", text: "ffffff", accent: "00d4ff", secondary: "8892b0", titleSize: 36, bodySize: 18 },
  light: { bg: "ffffff", text: "1a1a2e", accent: "0066cc", secondary: "666666", titleSize: 36, bodySize: 18 },
  corporate: { bg: "f8f9fa", text: "212529", accent: "0d6efd", secondary: "6c757d", titleSize: 34, bodySize: 16 },
};

// --- Validation ---

const VALID_THEMES = new Set(["dark", "light", "corporate"] as const);
const VALID_TYPES = new Set(["title", "section", "content", "comparison", "cards", "cta"] as const);

export function validateDeck(deck: unknown): SlideDeck {
  if (!deck || typeof deck !== "object") throw new Error("Deck must be an object");
  const d = deck as Record<string, unknown>;
  if (typeof d.title !== "string" || d.title.trim() === "") throw new Error("Deck requires a non-empty title");
  if (!Array.isArray(d.slides) || d.slides.length === 0) throw new Error("Deck requires at least one slide");
  const theme = (d.theme as ThemeName) || "dark";
  if (!VALID_THEMES.has(theme)) throw new Error(`Invalid theme: ${theme}`);
  for (let i = 0; i < d.slides.length; i++) {
    const s = d.slides[i];
    if (!s || typeof s !== "object") throw new Error(`Slide ${i} must be an object`);
    const slideType = (s as Record<string, unknown>).type;
    if (!slideType || typeof slideType !== "string" || !["title", "section", "content", "comparison", "cards", "cta"].includes(slideType)) {
      throw new Error(`Slide ${i} has invalid or missing type`);
    }
  }
  return { title: d.title.trim(), theme, slides: d.slides as SlideData[] };
}

// --- Generation ---

export async function generateSlides(deck: unknown, outputPath?: string): Promise<GenerateResult> {
  const validated = validateDeck(deck);
  const theme = themes[(validated.theme as keyof typeof themes) ?? "dark"];
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";
  pptx.author = "Zosma Cowork";
  pptx.company = "Zosma AI";
  pptx.subject = validated.title;

  const st = pptx.ShapeType;
  for (const slide of validated.slides) {
    const s = pptx.addSlide();
    s.background = { fill: theme.bg };
    renderSlide(slide, { slide: s, theme, st });
  }

  if (outputPath) {
    await pptx.writeFile({ fileName: outputPath });
    return { filePath: outputPath, slides: validated.slides.length };
  } else {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const pptxAny = pptx as any;
    const buf = await pptxAny.write({ outputType: "nodebuffer" });
    return { filePath: "", slides: validated.slides.length, buffer: buf.toString("base64") };
  }
}

// --- Available templates ---

export function listTemplates(): Array<{ name: string; description: string }> {
  return [
    { name: "pitch", description: "Startup pitch deck (11 slides)" },
    { name: "presentation", description: "General purpose presentation" },
    { name: "report", description: "Business report format" },
  ];
}

// --- Slide Renderers ---

interface RenderCtx {
  slide: any;
  theme: Record<string, any>;
  st: typeof PptxGenJS.ShapeType;
}

function renderSlide(data: SlideData, ctx: RenderCtx): void {
  const { slide, theme, st } = ctx;
  switch (data.type) {
    case "title": return renderTitle(slide, data, theme, st);
    case "section": return renderSection(slide, data, theme, st);
    case "content": return renderContent(slide, data, theme, st);
    case "comparison": return renderComparison(slide, data, theme, st);
    case "cards": return renderCards(slide, data, theme, st);
    case "cta": return renderCta(slide, data, theme, st);
  }
}

function renderTitle(slide: any, d: SlideData, t: Record<string, any>, st: any): void {
  slide.addText(d.title || "Untitled", {
    x: 0.5, y: 2.0, w: "90%", fontSize: t.titleSize, fontFace: "Arial",
    color: t.text, align: "center", fontWeight: "bold",
  });
  if (d.subtitle) {
    slide.addText(d.subtitle, {
      x: 0.5, y: 3.2, w: "90%", fontSize: t.bodySize, fontFace: "Arial",
      color: t.secondary, align: "center",
    });
  }
  slide.addShape(st.rect, {
    x: "35%", y: 2.8, w: "30%", h: 0.05, fill: { color: t.accent },
  });
}

function renderSection(slide: any, d: SlideData, t: Record<string, any>, st: any): void {
  slide.addShape(st.rect, { x: 0, y: 0, w: "100%", h: "100%", fill: { color: t.accent } });
  slide.addText(d.title || "Section", {
    x: 0.5, y: 2.5, w: "90%", fontSize: 44, fontFace: "Arial",
    color: t.bg, align: "center", fontWeight: "bold",
  });
}

function renderContent(slide: any, d: SlideData, t: Record<string, any>, st: any): void {
  let y = 0.5;
  if (d.title) {
    slide.addText(d.title, { x: 0.5, y: 0.3, w: "90%", fontSize: 28, fontFace: "Arial", color: t.accent, fontWeight: "bold" });
    slide.addShape(st.rect, { x: 0.5, y: 1.0, w: 3, h: 0.04, fill: { color: t.accent } });
    y = 1.2;
  }
  if (d.content) {
    slide.addText(d.content, { x: 0.5, y, w: "90%", fontSize: t.bodySize, fontFace: "Arial", color: t.text, lineSpacingMultiple: 1.3 });
    y += 2.5;
  }
  if (d.items?.length) {
    slide.addText(d.items.map((item: string) => ({ text: item, options: { breakLine: true } })), { x: 0.5, y, w: "90%", fontSize: t.bodySize - 2, fontFace: "Arial", color: t.text, bullet: true, lineSpacingMultiple: 1.5 });
  }
}

function renderComparison(slide: any, d: SlideData, t: Record<string, any>, st: any): void {
  let y = 0.5;
  if (d.title) {
    slide.addText(d.title, { x: 0.5, y: 0.3, w: "90%", fontSize: 28, fontFace: "Arial", color: t.accent, fontWeight: "bold", align: "center" });
    y = 1.2;
  }
  const colW = "44%";
  if (d.left) {
    slide.addShape(st.roundRect, { x: 0.3, y, w: colW, h: 3.5, fill: { color: t.accent } });
    slide.addText(d.left.title, { x: 0.5, y: y + 0.2, w: "42%", fontSize: 16, fontFace: "Arial", color: t.bg, fontWeight: "bold" });
    if (d.left.bullets.length) {
      slide.addText(d.left.bullets.map((b: string) => ({ text: b, options: { breakLine: true } })), { x: 0.5, y: y + 0.8, w: "42%", fontSize: 13, fontFace: "Arial", color: t.bg, bullet: true, lineSpacingMultiple: 1.3 });
    }
  }
  if (d.right) {
    slide.addShape(st.roundRect, { x: "54%", y, w: colW, h: 3.5, fill: { color: t.secondary } });
    slide.addText(d.right.title, { x: "56%", y: y + 0.2, w: "42%", fontSize: 16, fontFace: "Arial", color: t.bg, fontWeight: "bold" });
    if (d.right.bullets.length) {
      slide.addText(d.right.bullets.map((b: string) => ({ text: b, options: { breakLine: true } })), { x: "56%", y: y + 0.8, w: "42%", fontSize: 13, fontFace: "Arial", color: t.bg, bullet: true, lineSpacingMultiple: 1.3 });
    }
  }
}

function renderCards(slide: any, d: SlideData, t: Record<string, any>, st: any): void {
  if (d.title) {
    slide.addText(d.title, { x: 0.5, y: 0.3, w: "90%", fontSize: 28, fontFace: "Arial", color: t.accent, fontWeight: "bold", align: "center" });
  }
  const cards = d.cards || [];
  const colW = cards.length > 1 ? "44%" : "90%";
  for (let i = 0; i < Math.min(cards.length, 6); i++) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = col === 0 ? 0.3 : "54%";
    const y = (d.title ? 1.2 : 0.5) + row * 2.0;
    slide.addShape(st.roundRect, { x, y, w: colW, h: 1.8, fill: { color: t.accent } });
    slide.addText(cards[i].title, { x: (col === 0 ? 0.5 : "56%"), y: y + 0.15, w: "42%", fontSize: 15, fontFace: "Arial", color: t.bg, fontWeight: "bold" });
    slide.addText(cards[i].content, { x: (col === 0 ? 0.5 : "56%"), y: y + 0.7, w: "42%", fontSize: 12, fontFace: "Arial", color: t.bg, lineSpacingMultiple: 1.2 });
  }
}

function renderCta(slide: any, d: SlideData, t: Record<string, any>, st: any): void {
  slide.addShape(st.rect, { x: 0, y: 0, w: "100%", h: "100%", fill: { color: t.accent } });
  slide.addText(d.title || "Get Started", {
    x: 0.5, y: 2.0, w: "90%", fontSize: 44, fontFace: "Arial",
    color: t.bg, align: "center", fontWeight: "bold",
  });
  if (d.content) {
    slide.addText(d.content, {
      x: 0.5, y: 3.2, w: "90%", fontSize: t.bodySize, fontFace: "Arial",
      color: t.bg, align: "center",
    });
  }
}

// --- Extension Entry Point (for sidecar) ---

export default function createExtension() {
  return {
    name: "slide-generator",
    version: "0.1.0",
    tools: {
      generate_slides: {
        description: "Generate a .pptx slide deck from structured JSON content",
        parameters: { deck: "SlideDeck object with title, theme, and slides array", outputPath: "Optional file path" },
        execute: async (args: { deck: unknown; outputPath?: string }): Promise<GenerateResult> => {
          return generateSlides(args.deck, args.outputPath);
        },
      },
      list_templates: {
        description: "List available slide templates",
        parameters: {},
        execute: async (): Promise<Array<{ name: string; description: string }>> => {
          return listTemplates();
        },
      },
    },
  };
}
