# Slide Generation Feature — Zosma Cowork

## Vision
Let users generate professional, editable slide decks (`.pptx`) by simply describing what they want in natural language. No design skills, no PowerPoint expertise — just describe and get a downloadable, editable file.

## How It Works

```
User: "Create a pitch deck for my AI startup"

  ┌─────────────────────────────────────────────────┐
  │  1. AI generates structured JSON content         │
  │     (slide titles, bullets, comparison tables)   │
  └──────────────┬──────────────────────────────────┘
                 │
  ┌──────────────▼──────────────────────────────────┐
  │  2. pptxgenjs renders JSON to .pptx              │
  │     (programmatic, deterministic, fast)          │
  └──────────────┬──────────────────────────────────┘
                 │
  ┌──────────────▼──────────────────────────────────┐
  │  3. .pptx file saved to ~/.zosmaai/cowork/       │
  │     User can open in PPT / Google Slides         │
  └─────────────────────────────────────────────────┘
```

## Architecture

### Component Tree

```
src/
├── components/
│   ├── SlideGeneratorDialog.tsx   ← "Generate Slides" dialog UI
│   └── SlidePreview.tsx            ← Optional: show slide thumbnails
├── hooks/
│   └── useSlideGenerator.ts        ← State management for generation
├── lib/
│   └── slide-generator.ts          ← Core engine calling the backend
└── skills/
    └── slide-generation.json        ← Skill manifest for AI routing
```

### Data Flow

1. **User Input**: `"Create a pitch deck about my AI startup"`
2. **AI Content Generation**: LLM generates structured JSON matching the `SlideDeck` schema
3. **Validation**: Check JSON against schema, fill defaults for missing fields
4. **Rendering**: `pptxgenjs` renders JSON to `.pptx` file on disk
5. **Result**: Opens the file dialog or shows the file in the explorer

### Slide Deck Schema (JSON Input Format)

```typescript
interface SlideDeck {
  title: string;
  filename?: string;
  theme: "dark" | "light" | "corporate";
  slides: Slide[];
}

type Slide =
  | TitleSlide       // Opening slide with title + subtitle
  | SectionSlide     // Section divider
  | ContentSlide     // Bullet points or card-style items
  | ComparisonSlide  // Table/comparison grid
  | CardsSlide       // Pricing/feature cards
  | CTASlide;        // Call to action / closing
```

Full schema in `scripts/generate-slides.mjs` (the reusable engine).

## Implementation Plan

### Phase 1: Engine (done)
- [x] `scripts/generate-slides.mjs` — reusable slide generation engine
- [x] Supports 6 slide types (title, section, content, comparison, cards, cta)
- [x] Supports 3 themes (dark, light, corporate)
- [x] Compatible with PPT and Google Slides
- [x] All text is editable, all shapes are preserved

### Phase 2: Zosma Cowork Integration

| Component | File | Description |
|-----------|------|-------------|
| Dialog UI | `src/components/SlideGeneratorDialog.tsx` | Modal with text input + theme selector + "Generate" button |
| SDK | `src/lib/slide-generator.ts` | Calls LLM to produce JSON, then invokes Rust to render |
| Rust backend | `src-tauri/src/slides.rs` | Renders .pptx via pptxgenjs (Node subprocess) or Rust pptx lib |
| Skill | `skills/slide-generation.json` | Agent skill that routes slide generation requests |
| Hook | `src/hooks/useSlideGenerator.ts` | State management for the generation flow |

### Phase 3: AI Prompt Template

```markdown
You are a professional presentation designer. Given a user request,
generate slides in the following JSON format:

{
  "title": "Presentation Title",
  "theme": "dark" | "light" | "corporate",
  "slides": [
    {
      "type": "title",
      "title": "Slide Title",
      "subtitle": "Supporting text",
      "meta": "Tags and metadata"
    },
    {
      "type": "content",
      "title": "Section Title",
      "items": [
        { "title": "Point 1", "desc": "Details..." },
        ...
      ]
    },
    ...
  ]
}

Guidelines:
- Use meaningful, specific content (not placeholders)
- Add data points and numbers where relevant
- Keep slide text concise (max 5-6 items per content slide)
- Use comparison slides for competitive analysis
- Use cards slides for pricing/feature tiers
- End with a call to action slide
```

## Usage in Production

### How the AI Agent Uses It

When a user says "create a slideshow about X":
1. Agent recognizes the intent (via the slide-generation skill)
2. Agent generates a structured JSON deck matching the schema
3. Agent calls `slide_generate` Tauri command with the JSON
4. Rust backend writes the .pptx file and returns the path
5. UI shows the file with "Open" / "Open in Google Slides" buttons

### How Non-Technical Users Use It

```
User: "Create a pitch deck for my startup called 'FoodBot'.
       We make AI-powered restaurant recommendations.
       We have 10k users and are raising a seed round."

Result: A 10-slide professional pitch deck opens in their file manager.
        They can open it in PowerPoint or Google Slides and edit further.
```

## Tech Decisions

| Choice | Rationale |
|--------|-----------|
| **pptxgenjs** (Node) | Battle-tested, 4.0.1 stable, handles all PPT features |
| **Call via Node subprocess** | Rex Wing (Rust pptx lib) is immature. Node subprocess is reliable |
| **.pptx format** | Universal. Works with Microsoft PPT, Google Slides, LibreOffice |
| **3 themes** | Enough variety without overwhelming users. Can add more later |

## Appendix: Engine Output Samples

### Zosma Cowork Pitch Deck
→ `Zosma-Cowork-Pitch-Deck.pptx` on Google Drive
→ 11 slides, dark theme, full brand styling

### AI Slide Generator Demo
→ `AI-Slide-Generator-Demo.pptx` on Google Drive
→ 4 slides demonstrating core use cases
