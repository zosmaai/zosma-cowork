# File Upload & @ Mention Feature — Implementation Spec

> Branch: `feat/file-upload-brainstorm`
> Status: Draft spec
> Related: `docs/research/file-upload-patterns.md`
> Implementation plan: [`../plans/2026-07-19-file-upload-fix-plan.md`](../plans/2026-07-19-file-upload-fix-plan.md)

---

## 1. Overview

Add two complementary ways to attach files to a chat message:

1. **Upload button** (📎) — OS file dialog → preview → send
2. **@ mention autocomplete** — inline `@` trigger → workspace-rooted file/folder autocomplete → send

Both resolve to the same underlying data: a list of absolute file paths sent alongside the message text. The AI sees these paths and reads files using its existing `read` tool.

For image files, successful file access is separate from vision delivery. `read` returns an image block to Pi; Pi sends that block to the selected model only when model metadata declares image input. Cowork must expose that metadata honestly so users are not told an image was attached when the model will receive text only.

---

## 2. User Stories

| Story | Priority |
|---|---|
| As a user, I can click a paperclip button to pick files from my OS and see a preview before sending | P0 |
| As a user, I see attached files as nice cards inside the message bubble (like WhatsApp) | P0 |
| As a user, I can type `@` in the input to search and select a workspace file or folder | P0 |
| As a user, the @ autocomplete shows fuzzy-matching results as I type | P0 |
| As a user, I can press `→` on a folder in the @ popup to drill into it | P1 |
| As a user, I can attach multiple files at once | P0 |
| As a user, I can click on an attachment in a message to open it with the OS default app | P0 |
| As a user, the AI can read my attached files by their paths | P0 |
| As a user, I can remove a file from the pre-send preview | P0 |
| As a user, I am warned before sending an image to a model that cannot receive images | P0 |

---

## 3. Data Model

### Message Attachment Type

```typescript
// src/types/index.ts

export interface FileAttachment {
  /** Absolute path to the file on disk */
  path: string;
  /** Base filename (for display) */
  name: string;
  /** File size in bytes (for display) */
  size: number;
  /** MIME type hint (for preview rendering) */
  mimeType: string;
}
```

### ChatMessage Changes

Add optional `attachments` field:

```typescript
export interface ChatMessage {
  // ... existing fields ...
  /** Files attached to this message (uploaded or @-referenced) */
  attachments?: FileAttachment[];
}
```

### Wire Format (what gets sent to AI)

The message sent to the sidecar includes `attachments` alongside `text`:

```json
{
  "type": "prompt",
  "id": "p-abc123",
  "text": "Review this file for bugs",
  "attachments": [
    { "path": "/home/arjun/project/src/main.ts", "name": "main.ts", "size": 2048, "mimeType": "text/typescript" },
    { "path": "/home/arjun/project/package.json", "name": "package.json", "size": 512, "mimeType": "application/json" }
  ]
}
```

The sidecar augments the system prompt with:

```
The user has attached these files:
- /home/arjun/project/src/main.ts (main.ts, 2KB)
- /home/arjun/project/package.json (package.json, 512B)
```

AI uses its existing `read` tool to access file contents as needed.

### Image Capability Contract

`ModelInfo` must include Pi's resolved input capabilities:

```typescript
type ModelInput = "text" | "image";

interface ModelInfo {
  // existing model fields
  input: ModelInput[];
}
```

Custom providers persist the same field in each `models[]` entry. A model without an explicit `input` declaration is text-only. Cowork must not infer vision from a model name.

`zosma-router` is the source of truth for its routes. When it publishes optional model capability data from `GET /v1/models` (`input`, `input_modalities`, or `capabilities.image`), Cowork normalizes it to Pi's `input` field. Until router exposes this metadata, Cowork may carry a small explicit catalog for known router vision models.

For a model with `input: ["text", "image"]`, Pi's existing OpenAI-compatible adapter sends tool-result images as standard `image_url` data URLs. `zosma-router` must accept and forward those image URLs to its selected upstream. Cowork must not add a second image-upload/base64 transport.

For a text-only model, Cowork retains the file path and normal file behavior but warns that attached images will not be visible to the model.

---

## 4. Upload Button Flow (Paperclip)

### 4.1 UI

```
┌─────────────────────────────────────────┐
│  Pre-send preview area (if files)       │
│  ┌──────────┐ ┌──────────┐             │
│  │ 📄 file  │ │ 🖼️ image │             │
│  │ .pdf     │ │ .png     │             │
│  │ 3.2MB  ✕ │ │ 240KB  ✕ │             │
│  └──────────┘ └──────────┘             │
├─────────────────────────────────────────┤
│  Type a message...           📎 🎤 🚀  │
└─────────────────────────────────────────┘
```

### 4.2 Implementation

**Already exists in `MessageInput.tsx`:**
- `openFileDialog()` — opens Tauri dialog, returns paths
- `attachedFiles` state — stores `{path, name}` pairs
- File chips render above textarea
- Submit prepends `[File: path]` to message

**Changes needed:**

1. **Read file metadata on attach** — get `size` and `mimeType` per file
   - Add Tauri command `get_file_info(path)` → `{name, size, mimeType}`
   - Or use Node.js `fs.stat` in sidecar

2. **Richer preview chip** — replace simple chip with:
   - Images: `<img>` thumbnail (Tauri `convertFileSrc` for local files)
   - Other files: lucide file-type icon + name + size

3. **Remove `[File: path]` from message text** — move to proper `attachments` field
   - `handleSubmit` builds `attachments[]` instead of string-smeared markers

---

## 5. @ Mention Autocomplete

### 5.1 Trigger

- User types `@` anywhere in the textarea
- A popup appears anchored near the cursor
- Scope: **current workspace** (git root or configured workspace directory)

### 5.2 Popup Behavior

```
Can you fix the bug in @src/hooks
                              ┌─────────────────────────┐
                              │ 📁 src/hooks/            │
                              │ 📁 src/components/       │
                              │ 📄 src/App.tsx           │
                              │ 📄 src/main.tsx          │
                              └─────────────────────────┘
```

| Key | Action |
|---|---|
| Type | Filters list (fuzzy match on filename) |
| `↓` / `↑` | Navigate items |
| `→` or `Enter` on folder | Drill into folder (updates breadcrumb) |
| `Enter` on file | Select file, insert `@path` as text, close popup |
| `Escape` | Close popup |
| `Backspace` at start of `@` | Close popup |

### 5.3 Selection Rendering

Selected file appears as plain text in the textarea:

```
Can you fix the bug in @src/hooks/usePiStream.ts and check the types?
```

No rich text chips — keeping it as plain text keeps the component simple and the textarea predictable.

### 5.4 Parsing on Send

When the user sends, `handleSubmit` scans the text for `@` patterns, resolves each to an absolute path, and includes them in the `attachments[]` array (same as uploaded files).

**Path resolution:**
- Relative `@` paths are resolved against the workspace root
- If `@/` is used (Notion-style), resolve from workspace root
- Otherwise, resolve from the project root

The original `@path` text stays in the message content — AI can see the reference in context. The resolved path goes in `attachments[]`.

---

## 6. Attachment Card in Message Bubble

### 6.1 Render Logic

In `ChatMessage.tsx`, when a message has `attachments[]`, render each as a card:

```
┌─────────────────────────────────────┐
│ You                                  │
│ "Review this file for bugs"          │
│                                      │
│ ┌─────────────────────────────────┐ │
│ │ 📄 main.ts          2.0KB       │ │
│ │ /home/arjun/project/src/main.ts │ │
│ └─────────────────────────────────┘ │
│                                      │
│ ┌─────────────────────────────────┐ │
│ │ 🖼️ screenshot.png   240KB       │ │
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

- **Images:** Show thumbnail (use `convertFileSrc` to load local file)
- **Other files:** File-type icon (lucide) + name + size
- **Click** → `invoke("open_url", { url: \`file://${path}\` })` → OS default app
- **Path shown** on hover or as subtle secondary text

### 6.2 Backward Compatibility

Messages sent before this feature will have `[File: path]` in their text. For a transition period, parse those markers and render them as attachment cards too. After migration, the markers become redundant.

---

## 7. Tauri Commands Needed

| Command | Input | Output | Purpose |
|---|---|---|---|
| `get_file_info` | `path: string` | `{name, size, mimeType}` | Get file metadata for preview |
| ~~`list_directory`~~ | (use sidecar instead) | | File listing for @ autocomplete |

### 7.1 get_file_info

```rust
#[tauri::command]
async fn get_file_info(path: String) -> Result<FileInfo, String> {
    let metadata = std::fs::metadata(&path).map_err(|e| format!("{e}"))?;
    let name = path.split('/').next_back().unwrap_or(&path).to_string();
    let mime = mime_guess::from_path(&path).first_or("application/octet-stream").to_string();
    Ok(FileInfo { name, size: metadata.len(), mime_type: mime })
}
```

### 7.2 Directory Listing

For the @mention autocomplete, file listing can happen in the **frontend** via `tauri-plugin-fs`'s `readDir` which is already available, or via a simple Node.js sidecar call. This avoids adding a new Tauri command.

Actually — `tauri-plugin-fs` is already installed (`src-tauri/Cargo.toml`). Its `readDir` capability can be used directly from the frontend:

```typescript
import { readDir } from "@tauri-apps/plugin-fs";
const entries = await readDir("/home/arjun/project");
```

This is the simplest approach — **no new Tauri commands needed** for directory listing.

---

## 8. Component Tree

### New Components

| Component | Location | Responsibility |
|---|---|---|
| `FilePreviewChip` | `src/components/FilePreviewChip.tsx` | Rich preview card for pre-send (thumbnail + name + size + remove) |
| `FileMentionPopup` | `src/components/FileMentionPopup.tsx` | @mention autocomplete dropdown |
| `AttachmentCard` | `src/components/AttachmentCard.tsx` | Attachment card in message bubble |
| `useFileMention` | `src/hooks/useFileMention.ts` | @mention state machine (trigger, filter, select) |
| `useFileInfo` | `src/hooks/useFileInfo.ts` | Fetch file metadata (size, mime) |

### Modified Components

| Component | Changes |
|---|---|
| `MessageInput.tsx` | Wire `FilePreviewChip` + `FileMentionPopup`; build `attachments[]` on send; warn for images unsupported by selected model |
| `ChatMessage.tsx` | Render `AttachmentCard` for messages with `attachments[]` |
| `ChatView.tsx` | Pass workspace path to MessageInput |
| `agent-sidecar/src/custom-providers.ts` | Persist custom-model `input`; parse router capability metadata; text-only fallback |
| `agent-sidecar/src/commands/handlers/core.ts` | Return resolved model `input` from `get_models` |

---

## 9. Implementation Plan (TDD)

### Phase 1 — Model & Plumbing

| Step | File | Test | Description |
|---|---|---|---|
| 1.1 | `src/types/index.ts` | — | Add `FileAttachment` type |
| 1.2 | `src/types/index.ts` | — | Add `attachments` to `ChatMessage` |
| 1.3 | `src-tauri/src/lib.rs` | — | Add `get_file_info` command |
| 1.4 | `src-tauri/capabilities/` | — | Add `readDir` permission for `tauri-plugin-fs` |
| 1.5 | `agent-sidecar/src/custom-providers.ts` | `custom-providers.test.ts` | Persist image capability; parse router metadata; default unknown models to text-only |
| 1.6 | `agent-sidecar/src/commands/handlers/core.ts` + `src/types/index.ts` | Focused handler test | Expose resolved `input` to composer |

### Phase 2 — Pre-send Preview

| Step | File | Test | Description |
|---|---|---|---|
| 2.1 | `src/components/FilePreviewChip.tsx` | `FilePreviewChip.test.tsx` | Render thumbnail/icon + name + size + remove button |
| 2.2 | `src/hooks/useFileInfo.ts` | `useFileInfo.test.ts` | Fetch file metadata hook |
| 2.3 | `MessageInput.tsx` | Update existing tests | Replace chip rendering with FilePreviewChip |

### Phase 3 — @ Mention Autocomplete

| Step | File | Test | Description |
|---|---|---|---|
| 3.1 | `src/hooks/useFileMention.ts` | `useFileMention.test.ts` | State machine: detect `@`, filter, select, resolve path |
| 3.2 | `src/components/FileMentionPopup.tsx` | `FileMentionPopup.test.tsx` | Dropdown with keyboard nav + file icons |
| 3.3 | `MessageInput.tsx` | Update existing tests | Wire `useFileMention` + `FileMentionPopup` into textarea |

### Phase 4 — Attachment Bubbles

| Step | File | Test | Description |
|---|---|---|---|
| 4.1 | `src/components/AttachmentCard.tsx` | `AttachmentCard.test.tsx` | Render card with icon/thumbnail + name + size |
| 4.2 | `ChatMessage.tsx` | Update existing tests | Render attachments after message content |
| 4.3 | `ChatView.tsx` | — | Pass workspace path context |

### Phase 5 — AI Integration

| Step | File | Test | Description |
|---|---|---|---|
| 5.1 | `agent-sidecar/src/commands/` | Update handler tests | Accept `attachments` in prompt/steer payloads |
| 5.2 | `agent-sidecar/src/prompt-runner.ts` | Update tests | Inject attachment paths into system prompt |
| 5.3 | `src/components/MessageInput.tsx` | `MessageInput.test.tsx` | Warn when an attached image targets a text-only model; no warning for image-capable model |
| 5.4 | Router integration suite | Opt-in integration test | Send a tiny image through `POST /v1/chat/completions`; assert vision-grounded response from an image-capable router model |

### Phase 6 — Polish

| Step | Description |
|---|---|
| 6.1 | Backward compat: parse `[File: path]` in old messages → AttachmentCard |
| 6.2 | Image thumbnails in AttachmentCard via `convertFileSrc` |
| 6.3 | Keyboard shortcuts for @mention popup |

---

## 10. Open Questions

| Question | Decision |
|---|---|
| @mention scope — git root or configurable workspace? | Git root for now, fallback to `process.cwd()` |
| @ mention on folders — what does it mean? | Send folder path, AI decides how to use it |
| File size limit for upload? | Start with none (OS/browser may limit), warn at 50MB |
| Image thumbnails — generate on Rust side or frontend? | Frontend via `convertFileSrc` (simplest) |
| Multiple file upload — allow multi-select? | Yes, already wired in `dialog.open({ multiple: true })` |
| Drag & drop? | Out of scope for v1 |
| Who decides image forwarding? | Cowork/Pi gates by model `input`; zosma-router accepts and forwards OpenAI `image_url` payloads for image-capable routes |
