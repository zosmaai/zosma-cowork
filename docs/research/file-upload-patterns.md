# File Upload & @Mention Patterns — UX Research

> Research date: 2026-07-19
> Sources: First-hand product experience + public documentation

---

## 1. WhatsApp — The Baseline

### Upload Flow

1. **Paperclip icon** in the input toolbar (Android) or **+** button (iOS)
2. Opens a bottom sheet: Gallery, Camera, Document, Location, Contact, Poll
3. **Document picker** → native OS file browser
4. **Preview screen** appears before sending:
   - **Images/Video:** Full thumbnail grid, can add caption
   - **PDF:** Filename + page count + file size + small icon preview
   - **Other docs:** Filename + size + generic icon
5. **Send** → attachment appears inside the message bubble

### Message Bubble Attachment

- **Single file:** A rectangular card inside the bubble: thumbnail/icon on the left, filename + size on the right
- **Multiple files:** Each gets its own card, stacked vertically
- **Images:** Show as a thumbnail grid (1, 2, 3, 4+ layout) inside the bubble
- **Caption text** can accompany the attachment(s)
- **Tap** the attachment → opens the file or full image
- **Long press** → share/forward/delete

### Key UX Decisions

| Decision | Why |
|---|---|
| Preview before send | User confirms the right file, avoids accidents |
| Inline card in bubble | Scans well in a chat timeline |
| Thumbnails for images | Visual recognition is faster than filename reading |
| Generic icons for docs | Still recognizable without preview burden |

---

## 2. Telegram — The Power User Variant

### Upload Flow

- **Paperclip** → side menu with: File, Photo/Video, Camera, Poll, Location, Contact
- **File picker** supports multi-select with an explicit **"Attach"** button
- **No preview card** — file attaches inline immediately
- **Before send:** User can add a caption + formatting + spoiler tags
- **"Quick upload"** — drag & drop files into the chat window

### @ File Mention

- Type `@` → pops up user/group/bot list
- **Files are NOT in @ mentions** — Telegram separates file upload from @ mentions
- Instead, use **"Attach previous message"** (reply to a message containing the file)

### Key Difference from WhatsApp

- Less preview hesitation — files attach immediately
- More keyboard-friendly
- @ mentions are people-only

---

## 3. Slack — The Collaborative Workspace

### Upload Flow

1. **+** button next to the input, or **drag & drop** anywhere on the channel
2. **File picker** opens
3. **Before send:** A pre-send dialog shows:
   - File name, size, type icon
   - **Comment box** (optional, your message)
   - Channel selector
   - Share settings
4. **Send** → file appears as a message in the channel

### Message Bubble Attachment

- **Expanded card** (default): Thumbnail + filename + file type + size + timestamp
- **Compact view** (click "Show less"): Just filename + icon
- **Images:** Thumbnail inline, click to open full-size lightbox
- **Code:** Syntax-highlighted preview inside the message
- **Thread replies:** Files appear inline in threads too

### @ Mentions (People, Channels, Files)

- Type `@` → popup with **People**, **Channels**, and **Apps** tabs
- **Files are searchable** via the search box (`/` shortcut) — not via @ mentions
- Slack uses **"Link to file"** pattern: you can copy a link to any file and paste it in a message
- The link shows as a **rich unfurl** (preview card) when pasted

### Key UX Decisions

| Decision | Why |
|---|---|
| Pre-send dialog (not just preview) | Lets you set channel/sharing options |
| Drag & drop anywhere | Low friction, feels native |
| Link-based file sharing | Files live in a permanent home, not transient in chat |
| Rich unfurl for links | Makes copy-pasted file references scannable |

---

## 4. Discord — The Guild Chat

### Upload Flow

1. **+** button near input, or **drag & drop** files
2. Native OS file picker (multi-select supported)
3. **Before send:** Files appear as a list above the input, each with an ✕ remove button
4. **Optional comment** in the input box
5. **Send** → files appear in chat

### Message Bubble Attachment

- **Gallery layout** for images: grid (2, 3, 4+)
- **Single non-image:** Filename + size + download button + type icon
- **Spoiler tag:** Can mark files as spoiler (blurred until clicked)
- **Nitro users:** Larger file upload limit (500MB vs 25MB)

### @ Mention Pattern

- `@` → user/role list (people only)
- `#` → channel list
- **No file mentions** — files are always uploaded explicitly

---

## 5. Notion — The Document Platform

### @ File Mention (Unique Approach)

- Type `@` → menu shows: Date, People, Pages, Files, Databases, Colors, etc.
- **"Files"** sub-option → **"Upload"** or **"Link"**
- "Link" lets you paste a URL → creates a rich embed
- "Upload" opens OS file picker → file appears as a card in the doc
- **Auto-complete** on recently uploaded files when you type `@`

### File Card Rendering

- **Image:** Full inline image with caption
- **PDF:** Embedded viewer with filename + page preview
- **Video/Audio:** Embedded player
- **Other:** Card with type icon + filename + size + download button

---

## 6. Google Chat — The Enterprise Chat

### Upload Flow

1. **Upload icon** (arrow up) near input, or **drag & drop**
2. **Drive integration** — can attach from Google Drive or local
3. **Before send:** File tag shown above input
4. **Send** → file appears as a chip in the message

### Message Bubble

- **Compact chip**: Filename + Drive icon + file type badge
- Click → Drive preview pane
- No thumbnail preview for most files

---

## 7. Key Patterns Summary

### Pattern Matrix

| App | Pre-send Preview | Preview Card in Bubble | @ File Mentions | Drag & Drop | Multi-file |
|---|---|---|---|---|---|
| WhatsApp | ✅ Full screen | ✅ Card with thumb | ❌ | ❌ | ✅ (stacked) |
| Telegram | ❌ (immediate) | ✅ Card with thumb | ❌ (people only) | ✅ | ✅ |
| Slack | ✅ Dialog with options | ✅ Expanded card | ❌ (link unfurl instead) | ✅ | ✅ |
| Discord | ✅ File list above input | ✅ Gallery/grid | ❌ (people/channels only) | ✅ | ✅ |
| Notion | ❌ | ✅ Inline card/embed | ✅ `@` → Files submenu | ✅ | ✅ |
| Google Chat | ✅ Tag above input | ❌ Chip only | ❌ | ✅ | ✅ |

### What Works for a Desktop AI Coworker

| Pattern | Source | Why It Fits |
|---|---|---|
| **Pre-send preview card** | WhatsApp, Slack, Discord | User confirms the right file before involving AI |
| **Attachment card in bubble** | WhatsApp (gold standard) | Familiar chat UX, scannable timeline |
| **@ file mention with autocomplete** | Notion (most relevant) | Keyboard-driven, power user friendly, native to a code context |
| **Drag & drop** | Slack, Discord, Notion | Desktop apps must support drag & drop |
| **Multi-file upload** | All apps | Users often need to share multiple files |
| **Workspace-rooted @ scope** | New (unique to dev tools) | Files live in a project, not a flat filesystem |

### Anti-Patterns to Avoid

- **Immediate upload (Telegram style)** — AI needs context before acting on a file; user should be able to add a message with the file
- **People-only @ mentions (Discord/Telegram style)** — Users need to reference files by name in conversation
- **No preview (Google Chat style)** — Users need to see what they're sending to AI
- **Link unfurls only (Slack style)** — Files are local, not URLs; need direct path reference

---

## 8. Recommended Design

Based on the research, the strongest combination for a desktop AI coworker is:

### Two Upload Paths

| Path | Trigger | Best For |
|---|---|---|
| **Upload button** | 📎 icon → OS file dialog | "I have a file right now" |
| **@ mention** | `@` in input → autocomplete popup | "I want to reference a file in context" |

### @ Mention Scope

- Root at the **project/workspace directory** (configurable)
- Show **files + folders** in the autocomplete
- `→` on a folder drills into it (breadcrumb shows path)
- Fuzzy match on filename (like `fzf`)

### Pre-send Preview

- Slide-in card above input: thumbnail for images, icon + name + size for others
- Remove button per file
- Caption/message goes in the input box below

### Message Bubble Attachment

- WhatsApp-style card: thumbnail/icon + filename + size
- Click → open with OS default handler
- AI sees absolute file paths in the message data

### AI File Awareness

- System prompt lists attached file paths
- AI decides when to read files
- File contents NOT auto-injected (user may want AI to focus)
