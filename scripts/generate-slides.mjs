#!/usr/bin/env node
/**
 * Zosma Cowork — AI Slide Generator
 *
 * Reusable slide generation engine.
 * Takes structured JSON input, produces a .pptx file.
 *
 * Usage:
 *   node generate-slides.mjs < input.json          # pipe JSON
 *   node generate-slides.mjs --template pitch       # use built-in template
 *
 * Input JSON format:
 *   {
 *     "title": "My Presentation",
 *     "theme": { "primary": "1A1A2E", "accent": "E94560", ... },
 *     "slides": [
 *       { "type": "title", "title": "...", "subtitle": "..." },
 *       { "type": "bullets", "title": "...", "items": [...] },
 *       { "type": "comparison", "title": "...", "rows": [[...], ...] },
 *       { "type": "cta", "title": "...", "body": "..." }
 *     ]
 *   }
 */

import PptxGenJS from "pptxgenjs";
import { readFileSync } from "fs";

// ─── Default Theme ───────────────────────────────────────────────────────────
const THEMES = {
  dark: {
    bg:        "1A1A2E",
    bgMid:     "16213E",
    accent:    "0F3460",
    highlight: "E94560",
    secondary: "00B4D8",
    text:      "FFFFFF",
    muted:     "8892A0",
    cardBg:    "FFFFFF",
    cardText:  "1A1A2E",
    fontTitle: "Calibri",
    fontBody:  "Calibri",
  },
  light: {
    bg:        "FFFFFF",
    bgMid:     "F0F4F8",
    accent:    "0F3460",
    highlight: "E94560",
    secondary: "00B4D8",
    text:      "1A1A2E",
    muted:     "8892A0",
    cardBg:    "FFFFFF",
    cardText:  "1A1A2E",
    fontTitle: "Calibri",
    fontBody:  "Calibri",
  },
  corporate: {
    bg:        "FFFFFF",
    bgMid:     "F8F9FA",
    accent:    "1B4965",
    highlight: "62B6CB",
    secondary: "5F8CAE",
    text:      "212529",
    muted:     "6C757D",
    cardBg:    "FFFFFF",
    cardText:  "212529",
    fontTitle: "Calibri",
    fontBody:  "Calibri",
  },
};

// ─── Slide Builders ──────────────────────────────────────────────────────────

const BUILDERS = {
  title(ppt, slide, s, C) {
    slide.background = { fill: C.bg };
    slide.addShape(ppt.ShapeType.rect, {
      x: 0, y: 0, w: 10, h: 0.06, fill: { color: C.highlight },
    });
    slide.addText(s.title || "Title", {
      x: 0.8, y: 1.5, w: 8, h: 1.2,
      fontSize: 40, color: C.text, fontFace: C.fontTitle, bold: true,
    });
    if (s.subtitle) {
      slide.addText(s.subtitle, {
        x: 0.8, y: 2.8, w: 8, h: 0.5,
        fontSize: 18, color: C.highlight, fontFace: C.fontBody,
      });
    }
    if (s.meta) {
      slide.addText(s.meta, {
        x: 0.8, y: 3.4, w: 8, h: 0.4,
        fontSize: 12, color: C.muted, fontFace: C.fontBody,
      });
    }
    slide.addShape(ppt.ShapeType.rect, {
      x: 0, y: 5.35, w: 10, h: 0.05, fill: { color: C.highlight },
    });
  },

  section(ppt, slide, s, C) {
    slide.background = { fill: C.bg };
    slide.addShape(ppt.ShapeType.rect, {
      x: 0, y: 0, w: 10, h: 0.06, fill: { color: C.highlight },
    });
    slide.addText(s.title || "Section", {
      x: 0.8, y: 1.8, w: 8, h: 0.8,
      fontSize: 32, color: C.text, fontFace: C.fontTitle, bold: true,
    });
    if (s.body) {
      slide.addText(s.body, {
        x: 0.8, y: 2.8, w: 8, h: 0.5,
        fontSize: 14, color: C.muted, fontFace: C.fontBody,
      });
    }
  },

  content(ppt, slide, s, C) {
    slide.background = { fill: C.bgMid || C.bg };
    slide.addShape(ppt.ShapeType.rect, {
      x: 0, y: 0, w: 10, h: 0.06, fill: { color: C.highlight },
    });
    slide.addText(s.title || "Content", {
      x: 0.8, y: 0.4, w: 8, h: 0.6,
      fontSize: 26, color: C.text, fontFace: C.fontTitle, bold: true,
    });

    if (s.items) {
      s.items.forEach((item, i) => {
        const y = 1.3 + i * 0.7;
        slide.addShape(ppt.ShapeType.roundRect, {
          x: 0.8, y, w: 8.4, h: 0.55,
          fill: { color: C.cardBg },
          shadow: { type: "outer", blur: 3, offset: 1, color: "000000", opacity: 0.06 },
          rectRadius: 6,
        });
        if (typeof item === "string") {
          slide.addText(`•  ${item}`, {
            x: 1.1, y, w: 7.8, h: 0.55,
            fontSize: 12, color: C.cardText, fontFace: C.fontBody,
            valign: "middle",
          });
        } else {
          slide.addText(item.title || "", {
            x: 1.1, y: y + 0.02, w: 7.8, h: 0.25,
            fontSize: 12, color: C.cardText, fontFace: C.fontTitle, bold: true,
          });
          slide.addText(item.desc || "", {
            x: 1.1, y: y + 0.27, w: 7.8, h: 0.25,
            fontSize: 10, color: C.muted, fontFace: C.fontBody,
          });
        }
      });
    }

    if (s.body) {
      slide.addText(s.body, {
        x: 0.8, y: 1.3, w: 8.4, h: 3.5,
        fontSize: 13, color: C.text, fontFace: C.fontBody,
      });
    }
  },

  comparison(ppt, slide, s, C) {
    slide.background = { fill: C.bgMid || C.bg };
    slide.addShape(ppt.ShapeType.rect, {
      x: 0, y: 0, w: 10, h: 0.06, fill: { color: C.highlight },
    });
    slide.addText(s.title || "Comparison", {
      x: 0.8, y: 0.4, w: 8, h: 0.6,
      fontSize: 26, color: C.text, fontFace: C.fontTitle, bold: true,
    });

    if (s.headers && s.rows) {
      const colX = s.colX || [0.8, 2.3, 4.6, 6.9];
      const colW = s.colW || [1.4, 2.2, 2.2, 2.8];
      const startY = s.startY || 1.2;

      s.headers.forEach((h, i) => {
        slide.addText(h, {
          x: colX[i], y: startY, w: colW[i], h: 0.4,
          fontSize: 11, color: C.text, fontFace: C.fontTitle, bold: true,
          align: "center", valign: "middle",
        });
      });

      slide.addShape(ppt.ShapeType.rect, {
        x: colX[0], y: startY + 0.45, w: colX[colX.length - 1] + colW[colW.length - 1] - colX[0], h: 0.02,
        fill: { color: C.highlight },
      });

      s.rows.forEach((row, ri) => {
        const y = startY + 0.55 + ri * 0.5;
        if (ri % 2 === 0) {
          slide.addShape(ppt.ShapeType.rect, {
            x: colX[0], y, w: colX[colX.length - 1] + colW[colW.length - 1] - colX[0], h: 0.45,
            fill: { color: C.text, transparency: 90 },
          });
        }
        row.forEach((cell, ci) => {
          slide.addText(String(cell), {
            x: colX[ci], y, w: colW[ci], h: 0.45,
            fontSize: 10, color: ci === 0 ? C.text : C.muted,
            fontFace: C.fontBody, bold: ci === 0,
            align: "center", valign: "middle",
          });
        });
      });
    }
  },

  cards(ppt, slide, s, C) {
    slide.background = { fill: C.bgMid || C.bg };
    slide.addShape(ppt.ShapeType.rect, {
      x: 0, y: 0, w: 10, h: 0.06, fill: { color: C.highlight },
    });
    slide.addText(s.title || "Cards", {
      x: 0.8, y: 0.4, w: 8, h: 0.6,
      fontSize: 26, color: C.text, fontFace: C.fontTitle, bold: true,
    });

    if (s.cards) {
      s.cards.forEach((card, i) => {
        const cols = s.columns || 3;
        const cardW = (8.4 - (cols - 1) * 0.3) / cols;
        const x = 0.8 + i * (cardW + 0.3);
        const y = 1.3;

        slide.addShape(ppt.ShapeType.roundRect, {
          x, y, w: cardW, h: 3.0,
          fill: { color: C.cardBg },
          line: { color: card.highlight ? C.highlight : C.muted, width: card.highlight ? 2 : 0.5 },
          shadow: { type: "outer", blur: card.highlight ? 6 : 2, offset: 2, color: "000000", opacity: 0.08 },
          rectRadius: 10,
        });

        slide.addText(card.title || "", {
          x, y: y + 0.15, w: cardW, h: 0.35,
          fontSize: 14, color: card.highlight ? C.highlight : C.cardText,
          fontFace: C.fontTitle, bold: true, align: "center",
        });

        if (card.subtitle) {
          slide.addText(card.subtitle, {
            x, y: y + 0.5, w: cardW, h: 0.35,
            fontSize: 18, color: C.cardText, fontFace: C.fontTitle, bold: true,
            align: "center",
          });
        }

        if (card.items) {
          card.items.forEach((item, ii) => {
            slide.addText(`✓  ${item}`, {
              x: x + 0.2, y: y + (card.subtitle ? 1.0 : 0.6) + ii * 0.35, w: cardW - 0.4, h: 0.3,
              fontSize: 10, color: C.cardText, fontFace: C.fontBody,
            });
          });
        }
      });
    }
  },

  cta(ppt, slide, s, C) {
    slide.background = { fill: C.bg };
    slide.addShape(ppt.ShapeType.rect, {
      x: 0, y: 0, w: 10, h: 0.06, fill: { color: C.highlight },
    });
    slide.addText(s.title || "Thank You", {
      x: 1, y: 1.2, w: 8, h: 0.8,
      fontSize: 36, color: C.text, fontFace: C.fontTitle, bold: true,
      align: "center",
    });
    slide.addShape(ppt.ShapeType.roundRect, {
      x: 3.0, y: 2.2, w: 4.0, h: 0.08, fill: { color: C.highlight },
    });
    if (s.body) {
      slide.addText(s.body, {
        x: 1, y: 2.6, w: 8, h: 0.5,
        fontSize: 14, color: C.muted, fontFace: C.fontBody,
        align: "center",
      });
    }
    if (s.link) {
      slide.addText(s.link, {
        x: 1, y: 3.2, w: 8, h: 0.4,
        fontSize: 16, color: C.secondary, fontFace: C.fontBody, bold: true,
        align: "center",
      });
    }
    slide.addShape(ppt.ShapeType.rect, {
      x: 0, y: 5.35, w: 10, h: 0.05, fill: { color: C.highlight },
    });
  },
};

// ─── Main Generator ─────────────────────────────────────────────────────────

export function generateSlides(input) {
  const ppt = new PptxGenJS();
  ppt.layout = "LAYOUT_16x9";
  ppt.author = input.author || "Zosma Cowork";
  ppt.title = input.title || "Presentation";
  ppt.subject = input.subject || "";

  const themeName = input.theme?.name || "dark";
  const C = { ...(THEMES[themeName] || THEMES.dark), ...(input.theme?.colors || {}) };
  const slides = input.slides || [];

  slides.forEach((s, i) => {
    const builder = BUILDERS[s.type];
    if (!builder) {
      console.warn(`Unknown slide type: ${s.type}, skipping`);
      return;
    }
    const slide = ppt.addSlide();
    builder(ppt, slide, s, C);
    // Slide number
    if (s.showNumber !== false) {
      slide.addText(`${i + 1} / ${slides.length}`, {
        x: 8.5, y: 5.2, w: 1.5, h: 0.35,
        fontSize: 9, color: C.muted, fontFace: C.fontBody,
        align: "right",
      });
    }
  });

  return ppt;
}

// ─── Template: Pitch Deck ────────────────────────────────────────────────────

const TEMPLATES = {
  pitch: {
    title: "Pitch Deck",
    author: "Zosma Cowork",
    theme: { name: "dark" },
    slides: [
      { type: "title", title: "Your Company Name", subtitle: "One-line value proposition", meta: "Product  •  Market  •  Vision" },
      { type: "content", title: "The Problem", items: [
        { title: "Problem 1", desc: "Describe the pain point your target customer experiences." },
        { title: "Problem 2", desc: "Another challenge they face in their daily workflow." },
        { title: "Problem 3", desc: "Why existing solutions fall short." },
        { title: "Problem 4", desc: "The cost of not solving this — time, money, frustration." },
      ]},
      { type: "content", title: "Our Solution", items: [
        { title: "Core Feature 1", desc: "How your product directly solves problem 1." },
        { title: "Core Feature 2", desc: "The key differentiator vs competitors." },
        { title: "Core Feature 3", desc: "Why customers will love using it." },
      ]},
      { type: "content", title: "Market Opportunity", items: [
        "TAM: Total Addressable Market — the full revenue opportunity",
        "SAM: Serviceable Available Market — your realistic reach",
        "SOM: Serviceable Obtainable Market — your near-term target",
        "Key growth drivers and market tailwinds",
      ]},
      { type: "comparison", title: "Competitive Advantage", headers: ["", "Competitor A", "Competitor B", "Us"], rows: [
        ["Feature 1",   "⚠️ Limited", "❌", "✅ Best"],
        ["Feature 2",   "❌", "✅ Yes", "✅ Yes"],
        ["Feature 3",   "✅ Yes", "✅ Yes", "✅ Best"],
        ["Pricing",     "$$$", "$$", "$"],
      ]},
      { type: "cards", title: "Business Model", columns: 3, cards: [
        { title: "Free", subtitle: "$0", items: ["Core features", "Community support", "BYOK"], highlight: false },
        { title: "Pro", subtitle: "$20/mo", items: ["All features", "Priority support", "Hosted models"], highlight: true },
        { title: "Team", subtitle: "$50/mo", items: ["Team dashboard", "Analytics", "Admin controls"], highlight: false },
      ]},
      { type: "content", title: "Traction", items: [
        { title: "Metric 1", desc: "Key achievement or milestone reached." },
        { title: "Metric 2", desc: "User growth, revenue, or engagement numbers." },
        { title: "Metric 3", desc: "Notable partnerships or customer logos." },
      ]},
      { type: "content", title: "Roadmap", items: [
        { title: "Q2 2026", desc: "MVP launch with core functionality." },
        { title: "Q3 2026", desc: "Team features, dashboard, analytics." },
        { title: "Q4 2026", desc: "Enterprise features, SSO, audit logging." },
        { title: "Q1 2027", desc: "Platform expansion, marketplace, API." },
      ]},
      { type: "cta", title: "Let's Build Together", body: "We're looking for partners, investors, and early adopters.", link: "your-company.com" },
    ],
  },
};

// ─── CLI ─────────────────────────────────────────────────────────────────────

function _main() {
  if (!process.argv[1]?.endsWith("generate-slides.mjs")) return;

  const templateName = process.argv.find((a) => a.startsWith("--template="))?.split("=")[1]
    || process.argv[process.argv.indexOf("--template") + 1];

  function generateAndSave(input) {
    const ppt = generateSlides(input);
    const filename = (input.filename || input.title || "presentation").replace(/[^a-zA-Z0-9_-]/g, "-") + ".pptx";
    ppt.writeFile({ fileName: filename })
      .then(() => console.log(`✅ Generated: ${filename}`))
      .catch((err) => console.error("❌ Failed:", err));
  }

  if (templateName && TEMPLATES[templateName]) {
    generateAndSave(TEMPLATES[templateName]);
    console.log(`Using template: ${templateName}`);
    return;
  }

  // Read from stdin or file arg
  const fileArg = process.argv[2];
  if (fileArg && !fileArg.startsWith("--")) {
    generateAndSave(JSON.parse(readFileSync(fileArg, "utf-8")));
    return;
  }

  // Read stdin
  const chunks = [];
  process.stdin.on("data", (c) => chunks.push(c));
  process.stdin.on("end", () => {
    try {
      generateAndSave(JSON.parse(Buffer.concat(chunks).toString()));
    } catch {
      console.error("Usage: node generate-slides.mjs [input.json | --template pitch]");
      console.error("  Or pipe JSON: echo '...' | node generate-slides.mjs");
      process.exit(1);
    }
  });
  process.stdin.resume();
}

_main();
