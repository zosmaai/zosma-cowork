# File Upload & @ Mention Feature — Implementation Plan

> For: zosma-cowork
> Branch: `feat/file-upload-brainstorm`
> Each step is numbered. Do them in order. Each step says what files to touch and what to write.

---

## Step 1 — Add FileAttachment type to ChatMessage

**File:** `src/types/index.ts`

**What to do:** Add a `FileAttachment` interface and an optional `attachments` field to `ChatMessage`.

**Code to add** (before `ChatMessage`):

```typescript
/** A file attached to a chat message — uploaded via paperclip or referenced via @mention. */
export interface FileAttachment {
  /** Absolute path to the file on disk */
  path: string;
  /** Base filename (for display) */
  name: string;
  /** File size in bytes (for display, 0 if unknown) */
  size: number;
  /** MIME type hint (for preview rendering, "application/octet-stream" if unknown) */
  mimeType: string;
}
```

**Code to change** in `ChatMessage` — add this field after `provider`:

```typescript
  /** Files attached to this message */
  attachments?: FileAttachment[];
```

**Test:** Run `npm test` — all existing tests must still pass (482 tests). This is a pure additive type change with no behavioral impact.

---

## Step 2 — Add `get_file_info` Tauri command

**File:** `src-tauri/src/lib.rs`

**What to do:** Add a Tauri command that returns file metadata (name, size, mime type) given an absolute path. This is used by the frontend to show file size and type icon in preview chips.

**Code to add** (near other small commands like `write_user_file`):

```rust
use std::path::Path;

#[derive(serde::Serialize)]
pub struct FileInfo {
    pub name: String,
    pub size: u64,
    pub mime_type: String,
}

#[tauri::command]
async fn get_file_info(path: String) -> Result<FileInfo, String> {
    let p = Path::new(&path);
    let name = p
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.clone());
    let metadata = tokio::fs::metadata(&path)
        .await
        .map_err(|e| format!("get_file_info: {e}"))?;
    let mime_type = mime_guess::from_path(&path)
        .first_or("application/octet-stream")
        .to_string();
    Ok(FileInfo {
        name,
        size: metadata.len(),
        mime_type,
    })
}
```

**Register the command:** Add `get_file_info` to the `generate_handler![]` macro invocation (around line 2213+).

**Add dependency:** In `src-tauri/Cargo.toml`, add `mime_guess = "2"` to `[dependencies]`.

**Test:** Run `cargo build --workspace` — must compile.

---

## Step 3 — Build `FilePreviewChip` component

**File:** `src/components/FilePreviewChip.tsx` (new)
**Test:** `src/components/FilePreviewChip.test.tsx` (new)

**What it does:** Shows a rich preview card for a file attached via the paperclip button, displayed above the message input before sending.

**Props:**

```typescript
interface FilePreviewChipProps {
  path: string;
  name: string;
  size: number;
  mimeType: string;
  onRemove: (path: string) => void;
}
```

**Rendering logic:**

| Condition | Render |
|---|---|
| `mimeType` starts with `image/` | `<img>` thumbnail (use `convertFileSrc` from `@tauri-apps/api/core`) + filename + size |
| `mimeType` is `application/pdf` | PDF icon (use `FileText` from lucide-react) + filename + size |
| Everything else | Generic file icon (`File` from lucide-react) + filename + size |

**Layout:** A horizontal card with icon/thumbnail on left, filename + size stacked on right, X remove button on far right.

**Styling:** Use Tailwind classes matching the existing composer glass style (`rounded-md bg-muted text-foreground px-2 py-1.5 text-xs`).

**Test cases:**

1. Renders image thumbnail and filename when mimeType starts with `image/`
2. Renders file icon and filename for non-image files
3. Calls `onRemove` with the path when X is clicked
4. Truncates filenames longer than 30 characters with `…`

---

## Step 4 — Wire `FilePreviewChip` into `MessageInput`

**File:** `src/components/MessageInput.tsx`

**Changes:**

a) **Import** `FilePreviewChip` and `getFileInfo` invoke at top.

b) **Fetch file info on attach** — Modify the `openFileDialog` callback. After getting paths from the dialog, call `invoke("get_file_info", { path })` for each file to populate size and mimeType. Store richer state:

```typescript
const [attachedFiles, setAttachedFiles] = useState<FileAttachment[]>([]);
```

Replace the old `{ path: string; name: string }[]` state with `FileAttachment[]`.

c) **Replace chip rendering** — In the file chips section (currently renders `<span>` with just filename), replace with `FilePreviewChip` components:

```tsx
{attachedFiles.length > 0 && (
  <div className="flex flex-wrap gap-1.5 px-4 pb-1.5">
    {attachedFiles.map((file) => (
      <FilePreviewChip
        key={file.path}
        path={file.path}
        name={file.name}
        size={file.size}
        mimeType={file.mimeType}
        onRemove={removeFile}
      />
    ))}
  </div>
)}
```

d) **Update `handleSubmit`** — Instead of building `[File: path]` text sections, build a proper attachments array and pass it alongside the text. The wire format changes from:

```
[File: /path/file.pdf]

Review this
```

To:

```json
{
  "text": "Review this",
  "attachments": [
    { "path": "/path/file.pdf", "name": "file.pdf", "size": 3200, "mimeType": "application/pdf" }
  ]
}
```

**How to pass attachments to the sidecar:** Modify the `handleSubmit` function to send attachments through the existing prompt/steer/followUp mechanisms. The simplest approach: build the attachments JSON, include it in the prompt text as `[File: path] name size mimeType` — keep backward compat. OR modify the sidecar protocol to accept a separate `attachments` field.

For now (ponytail): Keep sending as text but include richer info:
```
[File: /path/file.pdf] file.pdf 3200 application/pdf
```

e) **Remove `pastedImages` from text too** — same treatment: `[Image: path] name mimeType`

**Test:** Update `MessageInput.test.tsx` — mock `invoke("get_file_info", ...)` to return `{name, size, mimeType}`. Verify chips render with correct info.

---

## Step 5 — Build `AttachmentCard` component

**File:** `src/components/AttachmentCard.tsx` (new)
**Test:** `src/components/AttachmentCard.test.tsx` (new)

**What it does:** Renders an attached file as a WhatsApp-style card in the message bubble.

**Props:**

```typescript
interface AttachmentCardProps {
  path: string;
  name: string;
  size: number;
  mimeType: string;
}
```

**Rendering:**
- Image files: show `<img>` thumbnail using `convertFileSrc(path)`
- Other files: show icon (`FileText` for pdf, `FileCode` for code, `File` for others)
- Display filename (truncated to 40 chars with `…`) + formatted size
- Entire card is clickable — calls `invoke("open_url", { url: `file://${path}` })` to open with OS default handler

**Styling:** A rounded card with subtle border (`border border-border rounded-lg p-2`), matching the chat bubble aesthetic.

**Test cases:**

1. Renders image thumbnail for image mime types  
2. Renders icon for non-image files
3. Shows formatted file size (e.g., "3.2 MB", "240 KB")
4. Clicking the card calls `open_url` with `file://` URL

---

## Step 6 — Render `AttachmentCard` in `ChatMessage`

**File:** `src/components/ChatMessage.tsx`

**Changes:**

a) Import `AttachmentCard` at top.

b) After rendering the message content (the `ReactMarkdown` block) and before the feedback buttons, add:

```tsx
{message.attachments && message.attachments.length > 0 && (
  <div className="flex flex-col gap-1.5 mt-2">
    {message.attachments.map((att) => (
      <AttachmentCard
        key={att.path}
        path={att.path}
        name={att.name}
        size={att.size}
        mimeType={att.mimeType}
      />
    ))}
  </div>
)}
```

c) **Backward compat:** Also parse `[File: path] name size mimeType` patterns from `message.content` for messages that were sent before the new format. Add a helper function `parseInlineAttachments(content: string): FileAttachment[]` that scans for these markers:

```typescript
function parseInlineAttachments(content: string): FileAttachment[] {
  const regex = /\[File:\s+([^\]]+)\]\s+(\S+)\s+(\d+)\s+(\S+)/g;
  const attachments: FileAttachment[] = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    attachments.push({
      path: match[1],
      name: match[2],
      size: Number.parseInt(match[3], 10),
      mimeType: match[4],
    });
  }
  return attachments;
}
```

Strip matched markers from the rendered content so they don't show as raw text.

**Test:** Update `ChatMessage.test.tsx` — add test for rendering attachment cards.

---

## Step 7 — Build `useFileMention` hook

**File:** `src/hooks/useFileMention.ts` (new)
**Test:** `src/hooks/useFileMention.test.ts` (new)

**What it does:** Manages the state machine for `@` mention autocomplete in the textarea.

**State machine:**

| State | Description |
|---|---|
| `idle` | No `@` typing in progress |
| `active` | User has typed `@` and is typing a path |

**Transitions:**

| Event | Current State | Next State | Action |
|---|---|---|---|
| User types `@` | idle | active | Capture cursor position, initialize query to `""` |
| User types more chars | active | active | Update query, filter files |
| User presses `→` on folder | active | active | Append folder to query breadcrumb |
| User presses Enter on file | active | idle | Select file, return `{path, name}` |
| User presses Escape | active | idle | Cancel, return null |
| User deletes back past `@` | active | idle | Cancel |

**Interface:**

```typescript
interface UseFileMentionReturn {
  /** Current state */
  state: "idle" | "active";
  /** Current query text (what the user typed after @) */
  query: string;
  /** Filtered file entries matching the query */
  results: FileEntry[];
  /** Cursor position in the textarea where @ was triggered */
  triggerPosition: number | null;
  /** Call when textarea value changes */
  onInput: (value: string, cursorPos: number) => void;
  /** Call when user presses a key in the textarea */
  onKeyDown: (e: React.KeyboardEvent) => void;
  /** Select a file from results */
  selectFile: (entry: FileEntry) => { path: string; name: string } | null;
  /** Cancel current mention */
  cancel: () => void;
}

interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}
```

**File listing:** Use `readDir` from `@tauri-apps/plugin-fs` to list files in the workspace directory. Cache results for performance. Filter results by fuzzy-matching the query against filenames.

**Workspace root:** Read from `invoke("get_workspace")` which already exists.

**Test cases:**

1. Typing `@` transitions from idle to active
2. Typing chars filters results
3. Pressing Enter on a file returns the selected file
4. Pressing Escape cancels
5. Deleting back past `@` cancels
6. Selecting a folder updates the query breadcrumb

---

## Step 8 — Build `FileMentionPopup` component

**File:** `src/components/FileMentionPopup.tsx` (new)
**Test:** `src/components/FileMentionPopup.test.tsx` (new)

**What it does:** A dropdown popup that shows file/folder suggestions as the user types `@`.

**Props:**

```typescript
interface FileMentionPopupProps {
  /** Filtered entries to display */
  entries: FileEntry[];
  /** Currently highlighted index (keyboard nav) */
  selectedIndex: number;
  /** Query text (shown as empty state) */
  query: string;
  /** Current path breadcrumb (which folder we're browsing) */
  breadcrumb: string;
  /** Called when user navigates with keyboard */
  onSelectIndex: (index: number) => void;
  /** Called when user selects an entry */
  onSelect: (entry: FileEntry) => void;
  /** Position anchor for the popup */
  anchorRect: { top: number; left: number } | null;
}
```

**Rendering:**
- A floating panel positioned near the textarea cursor
- Each row: folder icon (`Folder` from lucide) or file icon (`File`/`FileText`/`FileCode`) + filename
- Selected row gets a highlight background
- If no results and query is non-empty, show "No matches"
- Show breadcrumb at top: `workspace/ > src/ > hooks/`

**Positioning:** Absolute position relative to the textarea. Calculate from cursor position in textarea using a hidden mirror element.

**Test cases:**

1. Renders a list of files and folders
2. Shows folder icon for directories, file icon for files
3. Highlights the selected index
4. Shows "No matches" when results are empty and query is non-empty
5. Shows breadcrumb at the top

---

## Step 9 — Wire `useFileMention` + `FileMentionPopup` into `MessageInput`

**File:** `src/components/MessageInput.tsx`

**Changes:**

a) Import `useFileMention` and `FileMentionPopup`.

b) Call `useFileMention` at the top of the component.

c) Add a hidden mirror `div` to calculate cursor position for popup positioning.

d) Wire `onInput` and `onKeyDown` from the hook into the textarea's `onChange` and `onKeyDown`.

e) When a file is selected via the popup, insert `@path` into the text at the cursor position and add the file's path to the message's attachment list.

f) Render `FileMentionPopup` when the hook state is `"active"` and there are results.

g) The popup should appear near the `@` trigger position in the textarea.

**Key integration:** When user selects a file from the popup:
1. Get the selected path from the hook
2. Insert `@relative/path` as plain text in the textarea at the trigger position
3. Add the file to `attachments[]` state (or mark it as a mention that will be resolved on send)
4. Close the popup

**On send:** Scan text for `@path` patterns, resolve to absolute paths, include in the attachments payload alongside uploaded files.

**Test:** Update `MessageInput.test.tsx` — test that typing `@` shows the popup, that selecting a file inserts the path, and that the popup closes on Escape.

---

## Step 10 — Sidecar: Accept attachments in message payload

**File:** `agent-sidecar/src/commands/types.ts` (or equivalent)

**What to do:** Update the prompt/steer payload types to accept an optional `attachments` field.

```typescript
interface PromptPayload {
  type: "prompt" | "steer" | "follow_up";
  id: string;
  text: string;
  attachments?: Array<{
    path: string;
    name: string;
    size: number;
    mimeType: string;
  }>;
}
```

**File:** `agent-sidecar/src/commands/handlers/core.ts`

**What to do:** When processing a prompt or steer that has `attachments`, inject them into the system prompt as:

```
The user has attached these files:
- /absolute/path/to/file.ext (filename.ext, 1.2 MB)
```

This lets the AI know the files exist and their paths, so it can use its `read` tool to access them.

**Ponytail note:** For maximum simplicity, the frontend can keep sending files as `[File: path] name size mimeType` in the text. This needs zero sidecar changes. The sidecar changes are optional for v1 and can be deferred.

---

## Step 11 — Permission: Add `readDir` capability

**File:** `src-tauri/capabilities/default.json` (or equivalent)

**What to do:** Ensure `tauri-plugin-fs`'s `readDir` permission is granted so the frontend can list workspace files.

```json
{
  "identifier": "default",
  "windows": ["main"],
  "permissions": [
    ... existing permissions ...,
    "fs:read-dir"
  ]
}
```

Also add `fs:read-file` if not already present (needed for `convertFileSrc` to work with local images).

---

## Execution Order

```
Step 1  →  types/index.ts              (2 min)
Step 2  →  src-tauri (Rust)            (5 min)
Step 3  →  FilePreviewChip component   (10 min)
Step 4  →  Wire into MessageInput      (10 min)
Step 5  →  AttachmentCard component    (10 min)
Step 6  →  Wire into ChatMessage       (5 min)
Step 7  →  useFileMention hook         (15 min)
Step 8  →  FileMentionPopup component  (10 min)
Step 9  →  Wire into MessageInput      (15 min)
Step 10 →  Sidecar (optional v1)       (5 min)
Step 11 →  Capabilities                (2 min)
```

**Total:** ~90 min of implementation work.

---

## Test Strategy

| File | What to test |
|---|---|
| `FilePreviewChip.test.tsx` | Renders thumbnail, icon, calls onRemove |
| `AttachmentCard.test.tsx` | Renders card, click opens file |
| `useFileMention.test.ts` | State machine, filtering, selection |
| `FileMentionPopup.test.tsx` | Renders items, keyboard nav, empty state |
| `MessageInput.test.tsx` (update) | File chips render correctly, @popup appears |
| `ChatMessage.test.tsx` (update) | Attachment cards render |

Each test follows the pattern:
1. Write the test (it fails)
2. Write the implementation (it passes)
3. Done

---

## MIME Type → Icon Mapping

For `FilePreviewChip` and `AttachmentCard`:

| MIME type pattern | Lucide icon |
|---|---|
| `image/*` | Thumbnail (img tag) |
| `application/pdf` | `FileText` |
| `text/*` | `FileCode` |
| `application/json` | `FileJson` |
| `application/zip`, `application/gzip`, etc. | `FileArchive` |
| Everything else | `File` |

---

## Size Formatting

Helper function in `src/lib/utils.ts`:

```typescript
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const n = bytes / Math.pow(1024, i);
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
```

---

## End State

After all 11 steps:

1. User clicks 📎 → OS file picker → sees thumbnails + file sizes in preview → sends → attachment card in bubble
2. User types `@` → popup shows workspace files → filters as typed → selects file → `@path` in text → sends → AI sees file path
3. AI reads files using its `read` tool at the provided paths
4. Old messages with `[File: path]` render as proper attachment cards too
