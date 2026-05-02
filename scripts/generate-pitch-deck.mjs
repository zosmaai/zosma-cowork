/**
 * Zosma Cowork — Professional Pitch Deck Generator
 *
 * Generates a .pptx file compatible with PowerPoint and Google Slides.
 * All text is editable, all shapes preserved.
 *
 * Usage: node scripts/generate-pitch-deck.mjs
 */

import PptxGenJS from "pptxgenjs";
import { writeFileSync } from "fs";

// ─── Brand Palette ───────────────────────────────────────────────────────────
const C = {
  bgDark:    "1A1A2E",   // deep navy
  bgMid:     "16213E",   // midnight blue
  accent:    "0F3460",   // royal blue
  gold:      "E94560",   // coral/red accent
  teal:      "00B4D8",   // bright cyan
  white:     "FFFFFF",
  offWhite:  "E8E8E8",
  gray:      "8892A0",
  lightBg:   "F0F4F8",   // light slide bg
  darkText:  "1A1A2E",
  cardBg:    "FFFFFF",
  subtle:    "CBD5E1",
};

const FONT_TITLE = "Calibri";
const FONT_BODY  = "Calibri";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function addSlideNumber(ppt, slide, num, total) {
  slide.addText(`${num} / ${total}`, {
    x: 8.5, y: 5.2, w: 1.5, h: 0.35,
    fontSize: 9, color: C.gray, fontFace: FONT_BODY,
    align: "right", valign: "bottom",
  });
}

// ─── Deck Builder ────────────────────────────────────────────────────────────

export function buildDeck() {
  const ppt = new PptxGenJS();
  ppt.layout = "LAYOUT_16x9"; // 10" x 5.625"
  ppt.author = "Zosma AI";
  ppt.company = "Zosma AI";
  ppt.title = "Zosma Cowork — AI Coding Assistant";
  ppt.subject = "Investor Pitch Deck";

  const TOTAL = 11;

  // ── Slide 1: Title ──────────────────────────────────────────────────────────
  {
    const slide = ppt.addSlide();
    slide.background = { fill: C.bgDark };

    // Decorative top bar
    slide.addShape(ppt.ShapeType.rect, {
      x: 0, y: 0, w: 10, h: 0.06, fill: { color: C.gold },
    });

    // Brand name
    slide.addText("ZOSMA", {
      x: 0.8, y: 1.2, w: 3, h: 0.5,
      fontSize: 14, color: C.teal, fontFace: FONT_TITLE,
      letterSpacing: 6, bold: true,
    });

    // Main title
    slide.addText("Cowork", {
      x: 0.8, y: 1.7, w: 6, h: 1.0,
      fontSize: 44, color: C.white, fontFace: FONT_TITLE,
      bold: true,
    });

    // Tagline
    slide.addText("The AI Coding Assistant for Teams", {
      x: 0.8, y: 2.7, w: 6, h: 0.5,
      fontSize: 18, color: C.gold, fontFace: FONT_BODY,
    });

    // Subtitle
    slide.addText("Built on the Rust Pi Coding Agent  •  Open Core  •  Desktop Native", {
      x: 0.8, y: 3.3, w: 6, h: 0.4,
      fontSize: 12, color: C.gray, fontFace: FONT_BODY,
    });

    // Decorative accent shape (right side)
    slide.addShape(ppt.ShapeType.ellipse, {
      x: 7.5, y: 1.0, w: 2.8, h: 2.8,
      fill: { color: C.accent, transparency: 70 },
      line: { color: C.teal, width: 1.5, transparency: 50 },
    });
    slide.addShape(ppt.ShapeType.ellipse, {
      x: 8.0, y: 1.5, w: 2.0, h: 2.0,
      fill: { color: C.gold, transparency: 80 },
      line: { color: C.gold, width: 1, transparency: 60 },
    });

    // Bottom bar
    slide.addShape(ppt.ShapeType.rect, {
      x: 0, y: 5.35, w: 10, h: 0.05, fill: { color: C.gold },
    });

    addSlideNumber(ppt, slide, 1, TOTAL);
  }

  // ── Slide 2: The Problem ────────────────────────────────────────────────────
  {
    const slide = ppt.addSlide();
    slide.background = { fill: C.lightBg };

    // Header accent
    slide.addShape(ppt.ShapeType.rect, {
      x: 0, y: 0, w: 10, h: 0.06, fill: { color: C.gold },
    });

    slide.addText("The Problem", {
      x: 0.8, y: 0.4, w: 5, h: 0.6,
      fontSize: 28, color: C.darkText, fontFace: FONT_TITLE, bold: true,
    });

    const problems = [
      { icon: "🔑", title: "API Key Chaos", desc: "Every developer manages their own API keys for each AI provider. Lost keys, billing surprises, rate limits." },
      { icon: "🏢", title: "No Team Management", desc: "No centralized billing, no team-level rate limiting, no usage analytics for engineering managers." },
      { icon: "🔒", title: "Security Risks", desc: "API keys stored in plaintext configs. No audit trail of which team member used what." },
      { icon: "🔄", title: "Provider Lock-In", desc: "Teams hardcode one provider. Switching means changing every developer's config." },
    ];

    problems.forEach((p, i) => {
      const y = 1.3 + i * 0.95;
      // Card background
      slide.addShape(ppt.ShapeType.roundRect, {
        x: 0.8, y, w: 8.4, h: 0.8,
        fill: { color: C.cardBg },
        shadow: { type: "outer", blur: 4, offset: 2, color: "000000", opacity: 0.08 },
        rectRadius: 8,
      });
      slide.addText(`${p.icon}  ${p.title}`, {
        x: 1.1, y: y + 0.05, w: 3.5, h: 0.35,
        fontSize: 14, color: C.darkText, fontFace: FONT_TITLE, bold: true,
      });
      slide.addText(p.desc, {
        x: 1.1, y: y + 0.38, w: 7.8, h: 0.35,
        fontSize: 11, color: C.gray, fontFace: FONT_BODY,
      });
    });

    addSlideNumber(ppt, slide, 2, TOTAL);
  }

  // ── Slide 3: The Solution ───────────────────────────────────────────────────
  {
    const slide = ppt.addSlide();
    slide.background = { fill: C.bgDark };

    slide.addShape(ppt.ShapeType.rect, {
      x: 0, y: 0, w: 10, h: 0.06, fill: { color: C.gold },
    });

    slide.addText("The Solution", {
      x: 0.8, y: 0.4, w: 5, h: 0.6,
      fontSize: 28, color: C.white, fontFace: FONT_TITLE, bold: true,
    });

    slide.addText("One desktop app. Zero API key management.", {
      x: 0.8, y: 1.0, w: 8, h: 0.4,
      fontSize: 16, color: C.teal, fontFace: FONT_BODY,
    });

    // Feature boxes
    const features = [
      { title: "Hybrid Model Access", desc: "Use your own API keys OR subscribe to Zosma-hosted models. No configuration changes needed." },
      { title: "Team Console", desc: "Centralized billing, usage analytics, role-based access. One dashboard for your whole team." },
      { title: "Built on Pi Rust Agent", desc: "Leverages the battle-tested Pi coding agent engine. Extensible with skills, tools, and custom agents." },
    ];

    features.forEach((f, i) => {
      const x = 0.8 + i * 3.0;
      slide.addShape(ppt.ShapeType.roundRect, {
        x, y: 1.6, w: 2.7, h: 2.8,
        fill: { color: C.bgMid },
        line: { color: C.accent, width: 1 },
        rectRadius: 10,
      });
      // Number
      slide.addText(`0${i + 1}`, {
        x: x + 0.2, y: 1.8, w: 1, h: 0.4,
        fontSize: 20, color: C.gold, fontFace: FONT_TITLE, bold: true,
      });
      slide.addText(f.title, {
        x: x + 0.2, y: 2.3, w: 2.3, h: 0.5,
        fontSize: 14, color: C.white, fontFace: FONT_TITLE, bold: true,
      });
      slide.addText(f.desc, {
        x: x + 0.2, y: 2.9, w: 2.3, h: 1.2,
        fontSize: 10, color: C.gray, fontFace: FONT_BODY,
      });
    });

    addSlideNumber(ppt, slide, 3, TOTAL);
  }

  // ── Slide 4: Architecture ───────────────────────────────────────────────────
  {
    const slide = ppt.addSlide();
    slide.background = { fill: C.lightBg };

    slide.addShape(ppt.ShapeType.rect, {
      x: 0, y: 0, w: 10, h: 0.06, fill: { color: C.gold },
    });

    slide.addText("Architecture", {
      x: 0.8, y: 0.4, w: 5, h: 0.6,
      fontSize: 28, color: C.darkText, fontFace: FONT_TITLE, bold: true,
    });

    // Flow diagram - boxes with arrows
  
    // Layer 1: Desktop App (Tauri + React)
    slide.addShape(ppt.ShapeType.roundRect, {
      x: 0.8, y: 1.3, w: 4.0, h: 1.2,
      fill: { color: C.accent },
      rectRadius: 8,
    });
    slide.addText("Zosma Cowork Desktop", {
      x: 0.8, y: 1.35, w: 4.0, h: 0.35,
      fontSize: 13, color: C.white, fontFace: FONT_TITLE, bold: true,
      align: "center",
    });
    slide.addText("Tauri v2  •  React  •  Tailwind", {
      x: 0.8, y: 1.7, w: 4.0, h: 0.3,
      fontSize: 10, color: C.offWhite, fontFace: FONT_BODY,
      align: "center",
    });
    slide.addText("MetaAgents Engine (Rust)", {
      x: 0.8, y: 2.0, w: 4.0, h: 0.3,
      fontSize: 10, color: C.offWhite, fontFace: FONT_BODY,
      align: "center",
    });

    // Arrow
    slide.addText("→", {
      x: 4.8, y: 1.5, w: 0.5, h: 0.6,
      fontSize: 28, color: C.accent, fontFace: FONT_BODY,
      align: "center", valign: "middle",
    });

    // Layer 2: Model Router (Proxy)
    slide.addShape(ppt.ShapeType.roundRect, {
      x: 5.2, y: 1.3, w: 4.0, h: 1.2,
      fill: { color: C.gold },
      rectRadius: 8,
    });
    slide.addText("Zosma Model Router", {
      x: 5.2, y: 1.35, w: 4.0, h: 0.35,
      fontSize: 13, color: C.white, fontFace: FONT_TITLE, bold: true,
      align: "center",
    });
    slide.addText("OpenAI-Compatible API", {
      x: 5.2, y: 1.7, w: 4.0, h: 0.3,
      fontSize: 10, color: C.white, fontFace: FONT_BODY,
      align: "center",
    });
    slide.addText("Rate Limiting  •  Key Validation", {
      x: 5.2, y: 2.0, w: 4.0, h: 0.3,
      fontSize: 10, color: C.white, fontFace: FONT_BODY,
      align: "center",
    });

    // Layer 3: Providers
    slide.addText("↓  OpenAI  |  Anthropic  |  Google  |  Groq  |  +100 more  ↓", {
      x: 0.8, y: 2.7, w: 8.4, h: 0.4,
      fontSize: 11, color: C.gray, fontFace: FONT_BODY,
      align: "center",
    });

    // Provider boxes
    const providers = [
      { name: "OpenAI", color: "10A37F" },
      { name: "Anthropic", color: "CC7832" },
      { name: "Google", color: "4285F4" },
      { name: "Groq", color: "E94560" },
    ];
    providers.forEach((p, i) => {
      const x = 1.5 + i * 1.9;
      slide.addShape(ppt.ShapeType.roundRect, {
        x, y: 3.2, w: 1.6, h: 0.5,
        fill: { color: p.color },
        rectRadius: 6,
      });
      slide.addText(p.name, {
        x, y: 3.2, w: 1.6, h: 0.5,
        fontSize: 10, color: C.white, fontFace: FONT_TITLE, bold: true,
        align: "center", valign: "middle",
      });
    });

    // Bottom: BYOK + Zosma Hosted badge
    slide.addShape(ppt.ShapeType.roundRect, {
      x: 2.5, y: 4.0, w: 5.0, h: 0.55,
      fill: { color: C.bgDark },
      rectRadius: 20,
    });
    slide.addText("Hybrid: Bring Your Own Key  +  Zosma-Hosted Models", {
      x: 2.5, y: 4.0, w: 5.0, h: 0.55,
      fontSize: 11, color: C.white, fontFace: FONT_BODY, bold: true,
      align: "center", valign: "middle",
    });

    addSlideNumber(ppt, slide, 4, TOTAL);
  }

  // ── Slide 5: Key Features ───────────────────────────────────────────────────
  {
    const slide = ppt.addSlide();
    slide.background = { fill: C.bgDark };

    slide.addShape(ppt.ShapeType.rect, {
      x: 0, y: 0, w: 10, h: 0.06, fill: { color: C.gold },
    });

    slide.addText("Key Features", {
      x: 0.8, y: 0.4, w: 5, h: 0.6,
      fontSize: 28, color: C.white, fontFace: FONT_TITLE, bold: true,
    });

    const items = [
      { label: "Multi-Session", value: "Run multiple conversations simultaneously with session management" },
      { label: "Skill System", value: "Extend capabilities with installable skills and custom tools" },
      { label: "Tool Calls", value: "Real-time visibility into agent tool execution with rich results" },
      { label: "File Explorer", value: "Built-in file browser and code editing integration" },
      { label: "Prompt Library", value: "Save and organize reusable prompts and command templates" },
      { label: "Extensions", value: "Plugin system for third-party integrations and custom workflows" },
    ];

    items.forEach((item, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = 0.8 + col * 4.5;
      const y = 1.2 + row * 1.35;

      slide.addShape(ppt.ShapeType.roundRect, {
        x, y, w: 4.2, h: 1.1,
        fill: { color: C.bgMid },
        line: { color: C.accent, width: 0.5 },
        rectRadius: 8,
      });
      // Bullet dot
      slide.addShape(ppt.ShapeType.ellipse, {
        x: x + 0.2, y: y + 0.25, w: 0.12, h: 0.12,
        fill: { color: C.gold },
      });
      slide.addText(item.label, {
        x: x + 0.5, y: y + 0.1, w: 3.5, h: 0.35,
        fontSize: 13, color: C.white, fontFace: FONT_TITLE, bold: true,
      });
      slide.addText(item.value, {
        x: x + 0.5, y: y + 0.5, w: 3.5, h: 0.5,
        fontSize: 10, color: C.gray, fontFace: FONT_BODY,
      });
    });

    addSlideNumber(ppt, slide, 5, TOTAL);
  }

  // ── Slide 6: Market Opportunity ─────────────────────────────────────────────
  {
    const slide = ppt.addSlide();
    slide.background = { fill: C.lightBg };

    slide.addShape(ppt.ShapeType.rect, {
      x: 0, y: 0, w: 10, h: 0.06, fill: { color: C.gold },
    });

    slide.addText("Market Opportunity", {
      x: 0.8, y: 0.4, w: 5, h: 0.6,
      fontSize: 28, color: C.darkText, fontFace: FONT_TITLE, bold: true,
    });

    // Stats boxes
    const stats = [
      { number: "$30B+", label: "AI Coding Assistant Market by 2028" },
      { number: "10M+", label: "Active AI-Assisted Developers Worldwide" },
      { number: "87%", label: "Of Teams Use Multiple AI Providers" },
      { number: "3x", label: "Productivity Gain Reported by Early Adopters" },
    ];

    stats.forEach((s, i) => {
      const y = 1.3 + i * 0.95;
      slide.addShape(ppt.ShapeType.roundRect, {
        x: 0.8, y, w: 8.4, h: 0.75,
        fill: { color: C.cardBg },
        shadow: { type: "outer", blur: 3, offset: 1, color: "000000", opacity: 0.06 },
        rectRadius: 8,
      });
      slide.addText(s.number, {
        x: 1.0, y: y + 0.05, w: 2.0, h: 0.65,
        fontSize: 24, color: C.gold, fontFace: FONT_TITLE, bold: true,
        align: "center", valign: "middle",
      });
      slide.addText(s.label, {
        x: 3.2, y: y + 0.05, w: 5.5, h: 0.65,
        fontSize: 13, color: C.darkText, fontFace: FONT_BODY,
        valign: "middle",
      });
    });

    addSlideNumber(ppt, slide, 6, TOTAL);
  }

  // ── Slide 7: Competitive Landscape ──────────────────────────────────────────
  {
    const slide = ppt.addSlide();
    slide.background = { fill: C.bgDark };

    slide.addShape(ppt.ShapeType.rect, {
      x: 0, y: 0, w: 10, h: 0.06, fill: { color: C.gold },
    });

    slide.addText("Competitive Advantage", {
      x: 0.8, y: 0.4, w: 5, h: 0.6,
      fontSize: 28, color: C.white, fontFace: FONT_TITLE, bold: true,
    });

    // Table-like comparison cards
    const headers = ["", "Cursor", "GitHub Copilot", "Zosma Cowork"];
    const rows = [
      ["Open Source",         "❌", "❌", "✅ Open Core"],
      ["Local-First",         "❌", "❌", "✅ Tauri Desktop"],
      ["Multi-Provider",      "⚠️ Limited", "❌ Only OpenAI", "✅ 100+ Models"],
      ["Team Management",     "❌", "✅ Enterprise", "✅ Built-in"],
      ["API Key Mgmt",        "❌ Manual", "❌ Manual", "✅ Zero Config"],
      ["Custom Skills/Agents","⚠️ Limited", "❌", "✅ Full SDK"],
    ];

    // Column positions
    const colX = [0.8, 2.3, 4.6, 6.9];
    const colW = [1.4, 2.2, 2.2, 2.8];

    // Header row
    headers.forEach((h, i) => {
      slide.addText(h, {
        x: colX[i], y: 1.2, w: colW[i], h: 0.4,
        fontSize: i === 3 ? 13 : 11, color: i === 3 ? C.gold : C.white,
        fontFace: FONT_TITLE, bold: true,
        align: "center", valign: "middle",
      });
    });

    // Divider
    slide.addShape(ppt.ShapeType.rect, {
      x: 0.8, y: 1.65, w: 8.4, h: 0.02, fill: { color: C.accent },
    });

    // Data rows
    rows.forEach((row, ri) => {
      const y = 1.75 + ri * 0.52;
      // Alternate row bg
      if (ri % 2 === 0) {
        slide.addShape(ppt.ShapeType.rect, {
          x: 0.8, y, w: 8.4, h: 0.48,
          fill: { color: C.bgMid, transparency: 50 },
        });
      }
      row.forEach((cell, ci) => {
        slide.addText(cell, {
          x: colX[ci], y, w: colW[ci], h: 0.48,
          fontSize: ci === 3 ? 10.5 : 10,
          color: ci === 3 ? C.teal : ci === 0 ? C.white : C.gray,
          fontFace: FONT_BODY,
          bold: ci === 0 || ci === 3,
          align: "center", valign: "middle",
        });
      });
    });

    addSlideNumber(ppt, slide, 7, TOTAL);
  }

  // ── Slide 8: Business Model ─────────────────────────────────────────────────
  {
    const slide = ppt.addSlide();
    slide.background = { fill: C.lightBg };

    slide.addShape(ppt.ShapeType.rect, {
      x: 0, y: 0, w: 10, h: 0.06, fill: { color: C.gold },
    });

    slide.addText("Business Model", {
      x: 0.8, y: 0.4, w: 5, h: 0.6,
      fontSize: 28, color: C.darkText, fontFace: FONT_TITLE, bold: true,
    });

    // Three tier cards
    const tiers = [
      { name: "Free", price: "$0", desc: "Open core desktop app", features: ["BYOK only", "Unlimited sessions", "All core features", "Community support"], color: C.gray },
      { name: "Pro", price: "$20/mo", desc: "Individual developer", features: ["Zosma-hosted models", "Priority support", "Advanced skills", "Early access"], color: C.accent },
      { name: "Team", price: "$50/mo", desc: "Per user, per month", features: ["Team dashboard", "Centralized billing", "Usage analytics", "Admin controls"], color: C.gold },
    ];

    tiers.forEach((tier, i) => {
      const x = 0.8 + i * 3.1;
      // Card
      slide.addShape(ppt.ShapeType.roundRect, {
        x, y: 1.2, w: 2.8, h: 3.8,
        fill: { color: C.cardBg },
        line: { color: tier.color, width: i === 1 ? 2 : 1 },
        shadow: { type: "outer", blur: i === 1 ? 8 : 3, offset: 2, color: "000000", opacity: 0.1 },
        rectRadius: 12,
      });
      // Tier name
      slide.addText(tier.name, {
        x, y: 1.3, w: 2.8, h: 0.4,
        fontSize: 14, color: tier.color, fontFace: FONT_TITLE, bold: true,
        align: "center",
      });
      // Price
      slide.addText(tier.price, {
        x, y: 1.7, w: 2.8, h: 0.5,
        fontSize: 22, color: C.darkText, fontFace: FONT_TITLE, bold: true,
        align: "center",
      });
      slide.addText(tier.desc, {
        x, y: 2.2, w: 2.8, h: 0.3,
        fontSize: 9, color: C.gray, fontFace: FONT_BODY,
        align: "center",
      });
      // Divider
      slide.addShape(ppt.ShapeType.rect, {
        x: x + 0.3, y: 2.55, w: 2.2, h: 0.015, fill: { color: C.subtle },
      });
      // Features
      tier.features.forEach((f, fi) => {
        slide.addText(`✓  ${f}`, {
          x: x + 0.3, y: 2.7 + fi * 0.35, w: 2.2, h: 0.3,
          fontSize: 10, color: C.darkText, fontFace: FONT_BODY,
        });
      });
    });

    addSlideNumber(ppt, slide, 8, TOTAL);
  }

  // ── Slide 9: Technology ─────────────────────────────────────────────────────
  {
    const slide = ppt.addSlide();
    slide.background = { fill: C.bgDark };

    slide.addShape(ppt.ShapeType.rect, {
      x: 0, y: 0, w: 10, h: 0.06, fill: { color: C.gold },
    });

    slide.addText("Technology Stack", {
      x: 0.8, y: 0.4, w: 5, h: 0.6,
      fontSize: 28, color: C.white, fontFace: FONT_TITLE, bold: true,
    });

    const stack = [
      { name: "Tauri v2", desc: "Desktop shell (Rust + WebView)", type: "frontend" },
      { name: "React + Tailwind", desc: "Rich, responsive UI", type: "frontend" },
      { name: "MetaAgents Engine", desc: "Rust core session manager", type: "core" },
      { name: "Pi Agent SDK", desc: "Battle-tested agent runtime", type: "core" },
      { name: "Hono (Backend)", desc: "Model router & auth service", type: "backend" },
      { name: "PostgreSQL + Redis", desc: "Persistence & rate limiting", type: "backend" },
      { name: "LiteLLM", desc: "100+ provider proxy", type: "backend" },
      { name: "GKE (Google Cloud)", desc: "Scalable container orchestration", type: "infra" },
    ];

    const sections = [
      { label: "Frontend", types: ["frontend"], y: 1.1 },
      { label: "Core Engine", types: ["core"], y: 2.3 },
      { label: "Backend / Infra", types: ["backend", "infra"], y: 3.5 },
    ];

    sections.forEach((section) => {
      const items = stack.filter((s) => section.types.includes(s.type));
      items.forEach((item, i) => {
        const x = 0.8 + i * 2.3;
        slide.addShape(ppt.ShapeType.roundRect, {
          x, y: section.y, w: 2.1, h: 0.9,
          fill: { color: C.bgMid },
          line: { color: C.accent, width: 0.5 },
          rectRadius: 8,
        });
        slide.addText(item.name, {
          x, y: section.y + 0.05, w: 2.1, h: 0.35,
          fontSize: 12, color: C.white, fontFace: FONT_TITLE, bold: true,
          align: "center",
        });
        slide.addText(item.desc, {
          x, y: section.y + 0.4, w: 2.1, h: 0.4,
          fontSize: 9, color: C.gray, fontFace: FONT_BODY,
          align: "center",
        });
      });
    });

    addSlideNumber(ppt, slide, 9, TOTAL);
  }

  // ── Slide 10: Roadmap ───────────────────────────────────────────────────────
  {
    const slide = ppt.addSlide();
    slide.background = { fill: C.lightBg };

    slide.addShape(ppt.ShapeType.rect, {
      x: 0, y: 0, w: 10, h: 0.06, fill: { color: C.gold },
    });

    slide.addText("Roadmap", {
      x: 0.8, y: 0.4, w: 5, h: 0.6,
      fontSize: 28, color: C.darkText, fontFace: FONT_TITLE, bold: true,
    });

    // Timeline
    const phases = [
      { period: "Q2 2026", title: "MVP Launch", items: ["Desktop app with BYOK", "Zosma model router beta", "Basic team features"], active: true },
      { period: "Q3 2026", title: "Growth", items: ["Team dashboard GA", "Usage analytics", "Custom model deployments"], active: false },
      { period: "Q4 2026", title: "Scale", items: ["Enterprise SSO", "Audit logging", "Advanced rate limiting"], active: false },
      { period: "Q1 2027", title: "Platform", items: ["API marketplace", "Custom agent builder", "On-prem deployment"], active: false },
    ];

    // Timeline line
    slide.addShape(ppt.ShapeType.rect, {
      x: 0.8, y: 2.0, w: 8.4, h: 0.04, fill: { color: C.accent },
    });

    phases.forEach((phase, i) => {
      const x = 0.8 + i * 2.3;

      // Timeline dot
      slide.addShape(ppt.ShapeType.ellipse, {
        x: x + 0.7, y: 1.85, w: 0.3, h: 0.3,
        fill: { color: phase.active ? C.gold : C.accent },
        line: { color: phase.active ? C.gold : C.subtle, width: 2 },
      });

      // Period label above
      slide.addText(phase.period, {
        x, y: 1.3, w: 2.1, h: 0.35,
        fontSize: 13, color: phase.active ? C.gold : C.darkText,
        fontFace: FONT_TITLE, bold: true,
        align: "center",
      });
      slide.addText(phase.title, {
        x, y: 1.6, w: 2.1, h: 0.3,
        fontSize: 10, color: phase.active ? C.gold : C.gray,
        fontFace: FONT_BODY, bold: true,
        align: "center",
      });

      // Items below
      phase.items.forEach((item, ii) => {
        slide.addText(`• ${item}`, {
          x: x + 0.1, y: 2.3 + ii * 0.35, w: 2.0, h: 0.3,
          fontSize: 9, color: C.darkText, fontFace: FONT_BODY,
        });
      });
    });

    addSlideNumber(ppt, slide, 10, TOTAL);
  }

  // ── Slide 11: Call to Action ────────────────────────────────────────────────
  {
    const slide = ppt.addSlide();
    slide.background = { fill: C.bgDark };

    slide.addShape(ppt.ShapeType.rect, {
      x: 0, y: 0, w: 10, h: 0.06, fill: { color: C.gold },
    });

    slide.addText("Let's Build Together", {
      x: 1.0, y: 1.0, w: 8, h: 0.8,
      fontSize: 36, color: C.white, fontFace: FONT_TITLE, bold: true,
      align: "center",
    });

    slide.addShape(ppt.ShapeType.roundRect, {
      x: 2.5, y: 2.0, w: 5.0, h: 0.1, fill: { color: C.gold },
    });

    slide.addText("github.com/zosmaai/zosma-cowork", {
      x: 1.0, y: 2.5, w: 8, h: 0.5,
      fontSize: 16, color: C.teal, fontFace: FONT_BODY, bold: true,
      align: "center",
    });

    slide.addText("Try it today. Open source. Free forever.", {
      x: 1.0, y: 3.1, w: 8, h: 0.4,
      fontSize: 14, color: C.gray, fontFace: FONT_BODY,
      align: "center",
    });

    // Bottom accent
    slide.addShape(ppt.ShapeType.rect, {
      x: 0, y: 5.35, w: 10, h: 0.05, fill: { color: C.gold },
    });

    addSlideNumber(ppt, slide, 11, TOTAL);
  }

  return ppt;
}

// ── Main ─────────────────────────────────────────────────────────────────────
if (process.argv[1]?.endsWith("generate-pitch-deck.mjs")) {
  const ppt = buildDeck();
  ppt.writeFile({ fileName: "Zosma-Cowork-Pitch-Deck.pptx" })
    .then(() => console.log("✅ Pitch deck generated: Zosma-Cowork-Pitch-Deck.pptx"))
    .catch((err) => console.error("❌ Failed:", err));
}
