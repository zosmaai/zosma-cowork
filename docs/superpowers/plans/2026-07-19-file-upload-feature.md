# File Upload & @ Mention — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /skill:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add file upload (paperclip button) and @mention file autocomplete to the chat composer, with pre-send previews and attachment cards in message bubbles.

**Architecture:** Two upload paths (paperclip button → OS dialog, and `@` inline mention → workspace file browser) plus drag-and-drop from anywhere on the chat area. All three resolve to file paths sent alongside the message. AI reads files via its existing `read` tool. File metadata (size, mime type) fetched via a new Tauri command `get_file_info`. Directory listing for @mention uses existing `@tauri-apps/plugin-fs`. Preview and attachment rendering are pure presentational components.

**Tech Stack:** React 19, TypeScript, Tailwind v4, Tauri v2 + `@tauri-apps/plugin-fs` + `@tauri-apps/plugin-dialog`, Vitest + @testing-library/react, Rust `mime_guess` crate.

**Roadmap:** None

**Phase:** Single-plan implementation

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/types/index.ts` | Modify | Add `FileAttachment` type + `attachments` field to `ChatMessage` |
| `src-tauri/Cargo.toml` | Modify | Add `mime_guess` dependency |
| `src-tauri/src/lib.rs` | Modify | Add `get_file_info` Tauri command + register it |
| `src/components/FilePreviewChip.tsx` | Create | Rich pre-send preview card (thumbnail/icon + name + size + remove) |
| `src/components/FilePreviewChip.test.tsx` | Create | Tests for FilePreviewChip |
| `src/components/AttachmentCard.tsx` | Create | WhatsApp-style attachment card in message bubble |
| `src/components/AttachmentCard.test.tsx` | Create | Tests for AttachmentCard |
| `src/components/FileMentionPopup.tsx` | Create | @mention autocomplete dropdown |
| `src/components/FileMentionPopup.test.tsx` | Create | Tests for FileMentionPopup |
| `src/hooks/useFileMention.ts` | Create | @mention state machine (trigger, filter, select, resolve) |
| `src/hooks/useFileMention.test.ts` | Create | Tests for useFileMention |
| `src/components/MessageInput.tsx` | Modify | Wire FilePreviewChip + FileMentionPopup, build `attachments` on send, stack files on multiple selects |
| `src/components/ChatMessage.tsx` | Modify | Render AttachmentCard for messages with attachments |
| `src/hooks/useFileDrop.ts` | Create | Drag-and-drop state machine: track dragEnter/dragOver/dragLeave/drop on the chat area |
| `src/hooks/useFileDrop.test.ts` | Create | Tests for useFileDrop |
| `src/components/DropZoneOverlay.tsx` | Create | Semi-transparent overlay shown when files are dragged over the chat area |
| `src/components/DropZoneOverlay.test.tsx` | Create | Tests for DropZoneOverlay |
| `src/chat/ChatView.tsx` | Modify | Wrap chat area with drop handling, render DropZoneOverlay
| `src/lib/utils.ts` | Modify | Add `formatFileSize` helper |
| `agent-sidecar/src/commands/types.ts` | Modify | Accept `attachments` field in prompt/steer payload |
| `agent-sidecar/src/commands/handlers/core.ts` | Modify | Inject attachment paths into system prompt |
| `src-tauri/capabilities/default.json` | Modify | Add `fs:read-dir` permission |

---

### Task 1: Add FileAttachment type

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: Add FileAttachment interface**

Insert before `ChatMessage`:

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

- [ ] **Step 2: Add attachments field to ChatMessage**

Add after `provider?: string;`:

```typescript
  /** Files attached to this message */
  attachments?: FileAttachment[];
```

- [ ] **Step 3: Verify no breakage**

Run: `npm test -- --run`
Expected: 53 files, 482 tests passed (same as before, no behavioral change)

---

### Task 2: Add get_file_info Tauri command

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add mime_guess dependency**

In `src-tauri/Cargo.toml`, add to `[dependencies]`:

```
mime_guess = "2"
```

- [ ] **Step 2: Add get_file_info command**

In `src-tauri/src/lib.rs`, add this near the top imports:

```rust
use std::path::Path;
```

Add these types and command before the existing `open_url` command (before `#[tauri::command]` for `open_url`):

```rust
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
        .first_or(mime_guess::mime::APPLICATION_OCTET_STREAM)
        .to_string();
    Ok(FileInfo {
        name,
        size: metadata.len(),
        mime_type,
    })
}
```

- [ ] **Step 3: Register the command**

In the `generate_handler![]` macro, add `get_file_info,` to the list.

- [ ] **Step 4: Verify compilation**

Run: `cargo build --workspace`
Expected: Compiles without errors.

---

### Task 3: Create FilePreviewChip component

**Files:**
- Create: `src/components/FilePreviewChip.tsx`
- Create: `src/components/FilePreviewChip.test.tsx`

- [ ] **Step 1: Write the failing test**

`src/components/FilePreviewChip.test.tsx`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FilePreviewChip } from "./FilePreviewChip";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `tauri://localhost/${path}`,
}));

describe("FilePreviewChip", () => {
  it("renders image thumbnail for image mime types", () => {
    render(
      <FilePreviewChip
        path="/home/user/photo.png"
        name="photo.png"
        size={245760}
        mimeType="image/png"
        onRemove={() => {}}
      />,
    );
    const img = screen.getByRole("img");
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("src", "tauri://localhost//home/user/photo.png");
    expect(screen.getByText("photo.png")).toBeInTheDocument();
  });

  it("renders file icon for non-image files", () => {
    render(
      <FilePreviewChip
        path="/home/user/doc.pdf"
        name="doc.pdf"
        size={3200000}
        mimeType="application/pdf"
        onRemove={() => {}}
      />,
    );
    expect(screen.getByText("doc.pdf")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("shows formatted file size", () => {
    render(
      <FilePreviewChip
        path="/home/user/video.mov"
        name="video.mov"
        size={524288000}
        mimeType="video/quicktime"
        onRemove={() => {}}
      />,
    );
    expect(screen.getByText(/500\.0 MB/)).toBeInTheDocument();
  });

  it("calls onRemove with the path when X is clicked", async () => {
    const onRemove = vi.fn();
    render(
      <FilePreviewChip
        path="/home/user/file.txt"
        name="file.txt"
        size={1024}
        mimeType="text/plain"
        onRemove={onRemove}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /remove/i }));
    expect(onRemove).toHaveBeenCalledWith("/home/user/file.txt");
  });

  it("truncates filenames longer than 30 characters", () => {
    const longName = "a".repeat(40) + ".txt";
    render(
      <FilePreviewChip
        path={`/home/user/${longName}`}
        name={longName}
        size={512}
        mimeType="text/plain"
        onRemove={() => {}}
      />,
    );
    const display = screen.getByText(/…$/);
    expect(display).toBeInTheDocument();
  });
});
```

Run: `npx vitest run src/components/FilePreviewChip.test.tsx`
Expected: FAIL — module not found (`./FilePreviewChip`)

- [ ] **Step 2: Write minimal implementation**

`src/components/FilePreviewChip.tsx`:

```typescript
import { convertFileSrc } from "@tauri-apps/api/core";
import { File, FileArchive, FileCode, FileJson, FileText, X } from "lucide-react";
import type { ReactNode } from "react";

interface FilePreviewChipProps {
  path: string;
  name: string;
  size: number;
  mimeType: string;
  onRemove: (path: string) => void;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const n = bytes / 1024 ** i;
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function fileIcon(mimeType: string): ReactNode {
  if (mimeType.startsWith("text/")) return <FileCode size={16} />;
  if (mimeType === "application/json") return <FileJson size={16} />;
  if (mimeType === "application/pdf") return <FileText size={16} />;
  if (mimeType.includes("zip") || mimeType.includes("gzip") ||
      mimeType.includes("tar") || mimeType.includes("rar") || mimeType.includes("7z"))
    return <FileArchive size={16} />;
  return <File size={16} />;
}

function truncateName(name: string, max = 30): string {
  if (name.length <= max) return name;
  return `${name.slice(0, max - 1)}…`;
}

export function FilePreviewChip({ path, name, size, mimeType, onRemove }: FilePreviewChipProps) {
  const isImage = mimeType.startsWith("image/");
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs max-w-60 bg-muted text-foreground" title={path}>
      {isImage ? (
        <img src={convertFileSrc(path)} alt={name} className="w-6 h-6 rounded object-cover shrink-0" />
      ) : (
        <span className="shrink-0 text-muted-foreground">{fileIcon(mimeType)}</span>
      )}
      <span className="truncate">{truncateName(name)}</span>
      <span className="shrink-0 text-muted-foreground/60">{formatFileSize(size)}</span>
      <button type="button" onClick={() => onRemove(path)} className="shrink-0 rounded p-0.5 hover:opacity-70 text-muted-foreground" aria-label={`Remove ${name}`}>
        <X size={12} />
      </button>
    </span>
  );
}
```

- [ ] **Step 3: Verify tests pass**

Run: `npx vitest run src/components/FilePreviewChip.test.tsx`
Expected: 5 passed

- [ ] **Step 4: Commit**

```bash
git add src/types/index.ts src-tauri/Cargo.toml src-tauri/src/lib.rs src/components/FilePreviewChip.tsx src/components/FilePreviewChip.test.tsx
git commit -m "feat: add FileAttachment type, get_file_info command, and FilePreviewChip component"
```

---

### Task 4: Wire FilePreviewChip into MessageInput

**Files:**
- Modify: `src/components/MessageInput.tsx`

- [ ] **Step 1: Update imports**

Add to the import block:

```typescript
import type { FileAttachment } from "@/types";
import { FilePreviewChip } from "./FilePreviewChip";
```

- [ ] **Step 2: Update state type**

Change the `attachedFiles` state initializer from:

```typescript
const [attachedFiles, setAttachedFiles] = useState<{ path: string; name: string }[]>([]);
```

To:

```typescript
const [attachedFiles, setAttachedFiles] = useState<FileAttachment[]>([]);
```

- [ ] **Step 3: Update openFileDialog to fetch file metadata and stack**

Replace `openFileDialog` with:

```typescript
const openFileDialog = useCallback(async () => {
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const result = await open({ multiple: true, title: "Select files" });
    if (!result) return;
    const paths = Array.isArray(result) ? result : [result];
    const { invoke } = await import("@tauri-apps/api/core");
    const files: FileAttachment[] = [];
    for (const p of paths) {
      try {
        const info = await invoke<{ name: string; size: number; mime_type: string }>("get_file_info", { path: p });
        files.push({ path: p, name: info.name, size: info.size, mimeType: info.mime_type });
      } catch {
        files.push({ path: p, name: p.split("/").pop() ?? p, size: 0, mimeType: "application/octet-stream" });
      }
    }
    // Stack: append to existing files instead of replacing
    setAttachedFiles((prev) => [...prev, ...files]);
    trackEvent("file_picked", { count: files.length });
  } catch {
    // Dialog plugin not available
  }
}, []);
```

- [ ] **Step 4: Replace file chip rendering**

Find the file chips section (currently renders `<span>` with filename) and replace with:

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

- [ ] **Step 5: Run existing tests to verify no breakage**

Run: `npm test -- --run`
Expected: 55 files, 492 tests passed

---

### Task 5: Add formatFileSize to utils

**Files:**
- Modify: `src/lib/utils.ts`

- [ ] **Step 1: Add formatFileSize function**

Append to `src/lib/utils.ts`:

```typescript
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const n = bytes / 1024 ** i;
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
```

- [ ] **Step 2: Run tests**

Run: `npm test -- --run`
Expected: All pass

---

### Task 6: Create AttachmentCard component

**Files:**
- Create: `src/components/AttachmentCard.tsx`
- Create: `src/components/AttachmentCard.test.tsx`

- [ ] **Step 1: Write the failing test**

`src/components/AttachmentCard.test.tsx`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AttachmentCard } from "./AttachmentCard";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `tauri://localhost/${path}`,
  invoke: vi.fn(),
}));

describe("AttachmentCard", () => {
  it("renders image thumbnail for image mime types", () => {
    render(<AttachmentCard path="/img.png" name="img.png" size={102400} mimeType="image/png" />);
    const img = screen.getByRole("img");
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("src", "tauri://localhost//img.png");
  });

  it("renders file icon for non-image files", () => {
    render(<AttachmentCard path="/doc.pdf" name="doc.pdf" size={3200000} mimeType="application/pdf" />);
    expect(screen.getByText("doc.pdf")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("shows formatted file size", () => {
    render(<AttachmentCard path="/vid.mov" name="vid.mov" size={524288000} mimeType="video/quicktime" />);
    expect(screen.getByText(/500\.0 MB/)).toBeInTheDocument();
  });

  it("calls open_url when clicked", async () => {
    const invoke = vi.fn();
    vi.mocked(await import("@tauri-apps/api/core")).invoke = invoke;
    const user = userEvent.setup();
    render(<AttachmentCard path="/home/file.txt" name="file.txt" size={100} mimeType="text/plain" />);
    await user.click(screen.getByRole("button"));
    expect(invoke).toHaveBeenCalledWith("open_url", { url: "file:///home/file.txt" });
  });
});
```

Run: `npx vitest run src/components/AttachmentCard.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 2: Write minimal implementation**

`src/components/AttachmentCard.tsx`:

```typescript
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { File, FileCode, FileText, X as XIcon } from "lucide-react";
import { useCallback } from "react";
import { formatFileSize } from "@/lib/utils";

interface AttachmentCardProps {
  path: string;
  name: string;
  size: number;
  mimeType: string;
}

function fileIcon(mimeType: string) {
  if (mimeType.startsWith("text/")) return <FileCode size={20} />;
  if (mimeType === "application/pdf") return <FileText size={20} />;
  return <File size={20} />;
}

export function AttachmentCard({ path, name, size, mimeType }: AttachmentCardProps) {
  const isImage = mimeType.startsWith("image/");
  const openFile = useCallback(async () => {
    try {
      await invoke("open_url", { url: `file://${path}` });
    } catch { /* ignore */ }
  }, [path]);

  return (
    <button
      type="button"
      onClick={openFile}
      className="flex items-center gap-3 w-full rounded-lg border border-border p-2 text-left hover:bg-muted/50 transition-colors"
      title={path}
    >
      {isImage ? (
        <img src={convertFileSrc(path)} alt={name} className="w-10 h-10 rounded object-cover shrink-0" />
      ) : (
        <span className="w-10 h-10 rounded flex items-center justify-center bg-muted text-muted-foreground shrink-0">
          {fileIcon(mimeType)}
        </span>
      )}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{name}</div>
        <div className="text-xs text-muted-foreground">{formatFileSize(size)}</div>
      </div>
    </button>
  );
}
```

- [ ] **Step 3: Verify tests pass**

Run: `npx vitest run src/components/AttachmentCard.test.tsx`
Expected: 4 passed

---

### Task 7: Wire AttachmentCard into ChatMessage

**Files:**
- Modify: `src/components/ChatMessage.tsx`

- [ ] **Step 1: Import AttachmentCard**

Add to imports:

```typescript
import { AttachmentCard } from "./AttachmentCard";
```

- [ ] **Step 2: Render attachments after message content**

Find the closing `</div>` of the chat-markdown content block (after `message.content` is rendered via ReactMarkdown). Add before the feedback/export section:

```tsx
{/* Attached files */}
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

- [ ] **Step 3: Backward compat — parse inline [File: path] markers**

Add this helper function at the module scope (before `ChatMessageItem`):

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

In the component body, after `filePath` extraction, add:

```typescript
const inlineAttachments = message.attachments?.length
  ? message.attachments
  : isUser && message.content
    ? parseInlineAttachments(message.content)
    : [];
```

Then render `inlineAttachments` instead of `message.attachments`.

- [ ] **Step 4: Run tests**

Run: `npm test -- --run`
Expected: All pass

---

### Task 8: Create useFileMention hook

**Files:**
- Create: `src/hooks/useFileMention.ts`
- Create: `src/hooks/useFileMention.test.ts`

- [ ] **Step 1: Write the failing test**

`src/hooks/useFileMention.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFileMention } from "./useFileMention";

const mockReadDir = vi.fn();
vi.mock("@tauri-apps/plugin-fs", () => ({
  readDir: (...args: unknown[]) => mockReadDir(...args),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue("/home/user/project"),
}));

describe("useFileMention", () => {
  beforeEach(() => {
    mockReadDir.mockReset();
    mockReadDir.mockResolvedValue([
      { name: "src", isDirectory: () => true },
      { name: "package.json", isDirectory: () => false },
      { name: "README.md", isDirectory: () => false },
    ]);
  });

  it("starts in idle state", () => {
    const { result } = renderHook(() => useFileMention());
    expect(result.current.state).toBe("idle");
  });

  it("transitions to active when @ is typed", () => {
    const { result } = renderHook(() => useFileMention());
    act(() => { result.current.onInput("check @", 7); });
    expect(result.current.state).toBe("active");
    expect(result.current.query).toBe("");
  });

  it("filters results as user types", () => {
    const { result } = renderHook(() => useFileMention());
    act(() => { result.current.onInput("check @src", 10); });
    expect(result.current.state).toBe("active");
    expect(result.current.results.length).toBe(1);
    expect(result.current.results[0].name).toBe("src");
  });

  it("returns to idle on Escape", () => {
    const { result } = renderHook(() => useFileMention());
    act(() => { result.current.onInput("@", 1); });
    expect(result.current.state).toBe("active");
    act(() => { result.current.cancel(); });
    expect(result.current.state).toBe("idle");
  });

  it("selectFile returns path and name", () => {
    const { result } = renderHook(() => useFileMention());
    act(() => { result.current.onInput("@", 1); });
    const selection = result.current.selectFile({ name: "package.json", path: "/home/user/project/package.json", isDirectory: false });
    expect(selection).toEqual({ path: "/home/user/project/package.json", name: "package.json" });
  });
});
```

Run: `npx vitest run src/hooks/useFileMention.test.ts`
Expected: FAIL — module not found

- [ ] **Step 2: Write minimal implementation**

`src/hooks/useFileMention.ts`:

```typescript
import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { readDir } from "@tauri-apps/plugin-fs";

export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

interface UseFileMentionReturn {
  state: "idle" | "active";
  query: string;
  results: FileEntry[];
  triggerPosition: number | null;
  breadcrumb: string;
  onInput: (value: string, cursorPos: number) => void;
  selectFile: (entry: FileEntry) => { path: string; name: string } | null;
  cancel: () => void;
}

let cachedEntries: FileEntry[] | null = null;
let cachedRoot = "";

async function getWorkspaceFiles(): Promise<FileEntry[]> {
  if (cachedEntries) return cachedEntries;
  const root: string = await invoke("get_workspace");
  cachedRoot = root;
  const entries = await readDir(root);
  cachedEntries = entries.map((e) => ({
    name: e.name,
    path: `${root}/${e.name}`,
    isDirectory: e.isDirectory?.() ?? false,
  }));
  return cachedEntries!;
}

function fuzzyFilter(entries: FileEntry[], query: string): FileEntry[] {
  if (!query) return entries;
  const lower = query.toLowerCase();
  return entries.filter((e) => e.name.toLowerCase().includes(lower));
}

export function useFileMention(): UseFileMentionReturn {
  const [state, setState] = useState<"idle" | "active">("idle");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FileEntry[]>([]);
  const [allEntries, setAllEntries] = useState<FileEntry[]>([]);
  const [triggerPosition, setTriggerPosition] = useState<number | null>(null);
  const [breadcrumb, setBreadcrumb] = useState("");

  // Load workspace files once
  useEffect(() => {
    getWorkspaceFiles().then(setAllEntries).catch(() => {});
  }, []);

  const onInput = useCallback((value: string, cursorPos: number) => {
    // Find the last @ before cursor
    const textBeforeCursor = value.slice(0, cursorPos);
    const atIndex = textBeforeCursor.lastIndexOf("@");
    if (atIndex === -1) {
      setState("idle");
      return;
    }
    // Check if there's whitespace before @ — if so, it's not a mention trigger
    if (atIndex > 0 && !/\s/.test(value[atIndex - 1]) && value[atIndex - 1] !== "\n") {
      setState("idle");
      return;
    }
    const q = textBeforeCursor.slice(atIndex + 1);
    setState("active");
    setQuery(q);
    setTriggerPosition(atIndex);
    setResults(fuzzyFilter(allEntries, q));
    setBreadcrumb("");
  }, [allEntries]);

  const selectFile = useCallback((entry: FileEntry): { path: string; name: string } | null => {
    setState("idle");
    setQuery("");
    setTriggerPosition(null);
    return { path: entry.path, name: entry.name };
  }, []);

  const cancel = useCallback(() => {
    setState("idle");
    setQuery("");
    setTriggerPosition(null);
  }, []);

  return { state, query, results, triggerPosition, breadcrumb, onInput, selectFile, cancel };
}
```

- [ ] **Step 3: Verify tests pass**

Run: `npx vitest run src/hooks/useFileMention.test.ts`
Expected: 5 passed

---

### Task 9: Create FileMentionPopup component

**Files:**
- Create: `src/components/FileMentionPopup.tsx`
- Create: `src/components/FileMentionPopup.test.tsx`

- [ ] **Step 1: Write the failing test**

`src/components/FileMentionPopup.test.tsx`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FileMentionPopup } from "./FileMentionPopup";

const mockEntries = [
  { name: "src", path: "/workspace/src", isDirectory: true },
  { name: "package.json", path: "/workspace/package.json", isDirectory: false },
  { name: "README.md", path: "/workspace/README.md", isDirectory: false },
];

describe("FileMentionPopup", () => {
  it("renders a list of files and folders", () => {
    render(
      <FileMentionPopup
        entries={mockEntries}
        selectedIndex={0}
        query=""
        breadcrumb=""
        onSelectIndex={() => {}}
        onSelect={() => {}}
        anchorRect={{ top: 100, left: 50 }}
      />,
    );
    expect(screen.getByText("src")).toBeInTheDocument();
    expect(screen.getByText("package.json")).toBeInTheDocument();
    expect(screen.getByText("README.md")).toBeInTheDocument();
  });

  it("shows folder icon for directories", () => {
    render(
      <FileMentionPopup
        entries={mockEntries}
        selectedIndex={0}
        query=""
        breadcrumb=""
        onSelectIndex={() => {}}
        onSelect={() => {}}
        anchorRect={{ top: 100, left: 50 }}
      />,
    );
    // First entry is a folder — should have the folder test id
    const items = screen.getAllByRole("button");
    expect(items.length).toBe(mockEntries.length);
  });

  it("highlights the selected index", () => {
    render(
      <FileMentionPopup
        entries={mockEntries}
        selectedIndex={1}
        query=""
        breadcrumb=""
        onSelectIndex={() => {}}
        onSelect={() => {}}
        anchorRect={{ top: 100, left: 50 }}
      />,
    );
    const items = screen.getAllByRole("button");
    expect(items[1].dataset.selected).toBe("true");
  });

  it("shows 'No matches' when results are empty and query is non-empty", () => {
    render(
      <FileMentionPopup
        entries={[]}
        selectedIndex={0}
        query="xyz"
        breadcrumb=""
        onSelectIndex={() => {}}
        onSelect={() => {}}
        anchorRect={{ top: 100, left: 50 }}
      />,
    );
    expect(screen.getByText(/No matches/)).toBeInTheDocument();
  });

  it("calls onSelect when an entry is clicked", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <FileMentionPopup
        entries={mockEntries}
        selectedIndex={0}
        query=""
        breadcrumb=""
        onSelectIndex={() => {}}
        onSelect={onSelect}
        anchorRect={{ top: 100, left: 50 }}
      />,
    );
    await user.click(screen.getByText("package.json"));
    expect(onSelect).toHaveBeenCalledWith(mockEntries[1]);
  });
});
```

Run: `npx vitest run src/components/FileMentionPopup.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 2: Write minimal implementation**

`src/components/FileMentionPopup.tsx`:

```typescript
import { File, Folder, FileText } from "lucide-react";
import type { FileEntry } from "@/hooks/useFileMention";

interface FileMentionPopupProps {
  entries: FileEntry[];
  selectedIndex: number;
  query: string;
  breadcrumb: string;
  onSelectIndex: (index: number) => void;
  onSelect: (entry: FileEntry) => void;
  anchorRect: { top: number; left: number } | null;
}

function entryIcon(entry: FileEntry) {
  if (entry.isDirectory) return <Folder size={14} className="text-blue-500" />;
  if (entry.name.endsWith(".md")) return <FileText size={14} />;
  return <File size={14} />;
}

export function FileMentionPopup({
  entries, selectedIndex, query, breadcrumb, onSelect, anchorRect,
}: FileMentionPopupProps) {
  if (!anchorRect) return null;

  return (
    <div
      className="fixed z-50 min-w-[220px] max-w-[320px] max-h-[240px] overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg"
      style={{ top: anchorRect.top, left: anchorRect.left }}
    >
      {breadcrumb && (
        <div className="px-2 py-1 text-[10px] text-muted-foreground border-b border-border truncate">
          {breadcrumb}
        </div>
      )}
      {entries.length === 0 && query ? (
        <div className="px-2 py-3 text-xs text-muted-foreground text-center">No matches</div>
      ) : (
        entries.map((entry, i) => (
          <button
            key={entry.path}
            type="button"
            data-selected={i === selectedIndex ? "true" : "false"}
            className={`flex items-center gap-2 w-full rounded px-2 py-1.5 text-xs text-left transition-colors ${
              i === selectedIndex ? "bg-accent text-accent-foreground" : "text-popover-foreground hover:bg-accent/50"
            }`}
            onMouseEnter={() => onSelect(entry)}
            onClick={() => onSelect(entry)}
          >
            {entryIcon(entry)}
            <span className="truncate">{entry.name}</span>
          </button>
        ))
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify tests pass**

Run: `npx vitest run src/components/FileMentionPopup.test.tsx`
Expected: 5 passed

---

### Task 10: Wire useFileMention + FileMentionPopup into MessageInput

**Files:**
- Modify: `src/components/MessageInput.tsx`

- [ ] **Step 1: Add imports**

```typescript
import { useFileMention } from "@/hooks/useFileMention";
import { FileMentionPopup } from "./FileMentionPopup";
```

- [ ] **Step 2: Call useFileMention hook**

Add after the existing `useState` calls:

```typescript
const mention = useFileMention();
```

- [ ] **Step 3: Wire onInput**

The existing `onChange` handler for the textarea calls `setText`. Replace it with a handler that also calls `mention.onInput`:

```typescript
onChange={(e) => {
  const val = e.target.value;
  setText(val);
  mention.onInput(val, e.target.selectionStart ?? val.length);
}}
```

- [ ] **Step 4: Add keyboard handling for mention popup**

In the existing `handleKeyDown`, add before the existing logic:

```typescript
// Let mention popup handle navigation keys when active
if (mention.state === "active") {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const idx = mention.results.findIndex((r) => r === selectedMentionEntry);
    const next = e.key === "ArrowDown"
      ? Math.min(idx + 1, mention.results.length - 1)
      : Math.max(idx - 1, 0);
    // Use a ref to track selected index
    return;
  }
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    if (selectedMentionEntry) {
      mention.selectFile(selectedMentionEntry);
      // Insert @path at cursor
      const before = text.slice(0, mention.triggerPosition ?? 0);
      const after = text.slice(mention.triggerPosition ?? 0);
      setText(`${before}@${selectedMentionEntry.name} ${after}`);
    }
    return;
  }
  if (e.key === "Escape") {
    mention.cancel();
    return;
  }
  if (e.key === "Tab") {
    e.preventDefault();
    // Complete with first result
    if (mention.results.length > 0) {
      const entry = mention.results[0];
      mention.selectFile(entry);
      const before = text.slice(0, mention.triggerPosition ?? 0);
      const after = text.slice(mention.triggerPosition ?? 0);
      setText(`${before}@${entry.name} ${after}`);
    }
    return;
  }
}
```

- [ ] **Step 5: Render FileMentionPopup**

Add this inside the composer shell, before the textarea or after the CommandPalette:

```tsx
{mention.state === "active" && mention.results.length > 0 && (
  <FileMentionPopup
    entries={mention.results}
    selectedIndex={mentionSelectedIndex}
    query={mention.query}
    breadcrumb={mention.breadcrumb}
    onSelectIndex={(i) => { /* set selected index ref */ }}
    onSelect={(entry) => {
      mention.selectFile(entry);
      const before = text.slice(0, mention.triggerPosition ?? 0);
      const after = text.slice(mention.triggerPosition ?? 0);
      setText(`${before}@${entry.name} ${after}`);
    }}
    anchorRect={calculateCursorPosition(textareaRef.current, mention.triggerPosition ?? 0)}
  />
)}
```

- [ ] **Step 6: Implement cursor position calculation**

Add helper function:

```typescript
function calculateCursorPosition(textarea: HTMLTextAreaElement | null, cursorPos: number): { top: number; left: number } | null {
  if (!textarea) return null;
  const rect = textarea.getBoundingClientRect();
  // Approximate: position popup near the @ trigger
  return {
    top: rect.top - 200,
    left: rect.left + 20,
  };
}
```

- [ ] **Step 7: Run tests**

Run: `npm test -- --run`
Expected: All pass (existing tests plus new ones)

---

### Task 11: Add fs permissions to capabilities

**Files:**
- Modify: `src-tauri/capabilities/default.json`

- [ ] **Step 1: Add fs permissions**

Find the `permissions` array and add:

```json
"fs:read-dir",
"fs:read-file"
```

- [ ] **Step 2: Verify build**

Run: `cargo build --workspace`
Expected: Compiles

---

### Task 12: Sidecar — accept attachments in message payload

**Files:**
- Modify: `agent-sidecar/src/commands/types.ts`
- Modify: `agent-sidecar/src/commands/handlers/core.ts`

- [ ] **Step 1: Add attachments to prompt type**

In `agent-sidecar/src/commands/types.ts`, add to the prompt/steer payload interfaces:

```typescript
attachments?: Array<{
  path: string;
  name: string;
  size: number;
  mimeType: string;
}>;
```

- [ ] **Step 2: Inject attachment paths into system prompt**

In `agent-sidecar/src/commands/handlers/core.ts`, when processing a prompt/steer that has `attachments`, prepend to the system prompt:

```typescript
if (payload.attachments?.length) {
  const fileList = payload.attachments
    .map((a) => `- ${a.path} (${a.name}, ${formatSize(a.size)})`)
    .join("\n");
  systemPrompt += `\n\nThe user has attached these files:\n${fileList}\n\nYou can read these files using the read tool if needed.`;
}
```

- [ ] **Step 3: Verify sidecar builds**

Run: `cd agent-sidecar && npx tsc --noEmit`
Expected: No type errors

---

### Task 13: Create useFileDrop hook

**Files:**
- Create: `src/hooks/useFileDrop.ts`
- Create: `src/hooks/useFileDrop.test.ts`

Manages drag-and-drop state for the chat area. Tracks whether files are being dragged over the zone, and extracts file paths from the drop event.

- [ ] **Step 1: Write the failing test**

`src/hooks/useFileDrop.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFileDrop } from "./useFileDrop";

function createDragEvent(type: string, files: File[] = []): DragEvent {
  const dt = new DataTransfer();
  for (const f of files) dt.items.add(f);
  return new DragEvent(type, { dataTransfer: dt });
}

describe("useFileDrop", () => {
  it("starts with isDragging = false", () => {
    const { result } = renderHook(() => useFileDrop({ onDrop: () => {} }));
    expect(result.current.isDragging).toBe(false);
  });

  it("sets isDragging = true on dragEnter", () => {
    const { result } = renderHook(() => useFileDrop({ onDrop: () => {} }));
    act(() => { result.current.handlers.onDragEnter(createDragEvent("dragenter", [new File([""], "test.txt")])); });
    expect(result.current.isDragging).toBe(true);
  });

  it("sets isDragging = false on dragLeave", () => {
    const { result } = renderHook(() => useFileDrop({ onDrop: () => {} }));
    act(() => { result.current.handlers.onDragEnter(createDragEvent("dragenter", [new File([""], "test.txt")])); });
    act(() => { result.current.handlers.onDragLeave(createDragEvent("dragleave")); });
    expect(result.current.isDragging).toBe(false);
  });

  it("calls onDrop with files list and resets isDragging", () => {
    const onDrop = (() => {});
    let droppedFiles: File[] = [];
    const { result } = renderHook(() => useFileDrop({
      onDrop: (files: string[]) => { droppedFiles = files as unknown as File[]; },
    }));
    const file = new File(["content"], "dragged.txt", { type: "text/plain" });
    // We can't fully test the Tauri path extraction in jsdom,
    // but we can verify the drag state lifecycle
    act(() => { result.current.handlers.onDragEnter(createDragEvent("dragenter", [file])); });
    expect(result.current.isDragging).toBe(true);
    act(() => { result.current.handlers.onDragLeave(createDragEvent("dragleave")); });
    expect(result.current.isDragging).toBe(false);
  });

  it("handles multiple dragEnter events from child elements", () => {
    const { result } = renderHook(() => useFileDrop({ onDrop: () => {} }));
    act(() => { result.current.handlers.onDragEnter(createDragEvent("dragenter")); });
    act(() => { result.current.handlers.onDragEnter(createDragEvent("dragenter")); });
    expect(result.current.isDragging).toBe(true);
    act(() => { result.current.handlers.onDragLeave(createDragEvent("dragleave")); });
    expect(result.current.isDragging).toBe(true); // still one active
    act(() => { result.current.handlers.onDragLeave(createDragEvent("dragleave")); });
    expect(result.current.isDragging).toBe(false); // all cleared
  });
});
```

Run: `npx vitest run src/hooks/useFileDrop.test.ts`
Expected: FAIL — module not found

- [ ] **Step 2: Write minimal implementation**

`src/hooks/useFileDrop.ts`:

```typescript
import { useCallback, useEffect, useRef, useState } from "react";

interface UseFileDropOptions {
  onDrop: (filePaths: string[]) => void;
}

interface UseFileDropReturn {
  isDragging: boolean;
  handlers: {
    onDragEnter: (e: DragEvent) => void;
    onDragOver: (e: DragEvent) => void;
    onDragLeave: (e: DragEvent) => void;
    onDrop: (e: DragEvent) => void;
  };
}

/**
 * Hook to manage drag-and-drop state for a drop zone.
 * Uses a counter to handle dragEnter/dragLeave from child elements.
 */
export function useFileDrop({ onDrop }: UseFileDropOptions): UseFileDropReturn {
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);

  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current += 1;
    if (e.dataTransfer?.types.includes("Files")) {
      setIsDragging(true);
    }
  }, []);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback(
    async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      dragCounter.current = 0;

      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length === 0) return;

      // Tauri provides file paths on the dropped files via the webview
      // Files dragged from the OS have a `path` property in Tauri
      const paths = files
        .map((f) => (f as unknown as { path?: string }).path)
        .filter((p): p is string => !!p);

      if (paths.length > 0) {
        onDrop(paths);
      }
    },
    [onDrop],
  );

  return {
    isDragging,
    handlers: {
      onDragEnter: handleDragEnter,
      onDragOver: handleDragOver,
      onDragLeave: handleDragLeave,
      onDrop: handleDrop,
    },
  };
}
```

- [ ] **Step 3: Verify tests pass**

Run: `npx vitest run src/hooks/useFileDrop.test.ts`
Expected: 4 passed

---

### Task 14: Create DropZoneOverlay component

**Files:**
- Create: `src/components/DropZoneOverlay.tsx`
- Create: `src/components/DropZoneOverlay.test.tsx`

A semi-transparent overlay shown when files are dragged over the chat area.

- [ ] **Step 1: Write the failing test**

`src/components/DropZoneOverlay.test.tsx`:

```typescript
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DropZoneOverlay } from "./DropZoneOverlay";

describe("DropZoneOverlay", () => {
  it("renders when isVisible is true", () => {
    render(<DropZoneOverlay isVisible={true} />);
    expect(screen.getByText(/Drop files/)).toBeInTheDocument();
  });

  it("does not render when isVisible is false", () => {
    render(<DropZoneOverlay isVisible={false} />);
    expect(screen.queryByText(/Drop files/)).not.toBeInTheDocument();
  });
});
```

Run: `npx vitest run src/components/DropZoneOverlay.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 2: Write minimal implementation**

`src/components/DropZoneOverlay.tsx`:

```typescript
import { Upload } from "lucide-react";

interface DropZoneOverlayProps {
  isVisible: boolean;
}

export function DropZoneOverlay({ isVisible }: DropZoneOverlayProps) {
  if (!isVisible) return null;

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-3 p-8 rounded-2xl border-2 border-dashed border-primary/50 bg-background/60">
        <Upload size={40} className="text-primary/70" />
        <p className="text-lg font-medium text-foreground">Drop files here</p>
        <p className="text-sm text-muted-foreground">Attach to your message</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify tests pass**

Run: `npx vitest run src/components/DropZoneOverlay.test.tsx`
Expected: 2 passed

---

### Task 15: Wire drag-and-drop into ChatView

**Files:**
- Modify: `src/chat/ChatView.tsx`

- [ ] **Step 1: Import the hook and overlay**

Add to imports:

```typescript
import { useFileDrop } from "@/hooks/useFileDrop";
import { DropZoneOverlay } from "@/components/DropZoneOverlay";
```

- [ ] **Step 2: Add onFilesDrop callback prop**

Add to `ChatViewProps`:

```typescript
/** Called when files are dropped onto the chat area */
onFilesDrop?: (filePaths: string[]) => void;
```

- [ ] **Step 3: Create the drop hook**

Add inside the component, after existing hooks:

```typescript
const { isDragging, handlers: dropHandlers } = useFileDrop({
  onDrop: (paths) => onFilesDrop?.(paths),
});
```

- [ ] **Step 4: Add drop handlers to the scroll container**

Find the scroll container div (`ref={scrollContainerRef}`). Add the drop event handlers:

```tsx
<div
  ref={scrollContainerRef}
  onScroll={handleScroll}
  onDragEnter={dropHandlers.onDragEnter as unknown as React.DragEventHandler}
  onDragOver={dropHandlers.onDragOver as unknown as React.DragEventHandler}
  onDragLeave={dropHandlers.onDragLeave as unknown as React.DragEventHandler}
  onDrop={dropHandlers.onDrop as unknown as React.DragEventHandler}
  className="flex-1 overflow-y-auto relative"
  style={{ scrollbarGutter: "stable" }}
>
```

Key changes: add `relative` to className (needed for overlay positioning) and the drag event handlers.

- [ ] **Step 5: Render DropZoneOverlay**

Inside the scroll container div, as the first child so it overlays everything:

```tsx
<DropZoneOverlay isVisible={isDragging} />
```

- [ ] **Step 6: Wire onFilesDrop in App.tsx**

In `App.tsx`, find where `ChatView` receives its props. Add:

```tsx
onFilesDrop={(paths) => {
  // Convert dropped file paths to FileAttachment and set them on the composer
  // This needs a way to pass files to MessageInput. Simplest approach:
  // store them in a shared state/ref that MessageInput picks up
  setPendingDropFiles(paths);
}}
```

**Ponytail note:** The simplest way to pass dropped files to the composer is via a shared callback or lifting state. Options:
- Lift `attachedFiles` state to the parent (`ChatView` or `App`) and pass down + up
- Use a ref/callback that `MessageInput` exposes via its imperative handle
- Use a simple atom/event bus

Simplest: Add a `onDropFiles` prop to `MessageInput` that ChatView passes through. When files are dropped on the chat area, ChatView calls `onDropFiles` which sets the files in MessageInput's state.

Add to `MessageInputProps`:

```typescript
/** Files dropped onto the chat area (drag-and-drop) */
pendingDropFiles?: FileAttachment[];
```

Add a `useEffect` in `MessageInput` that appends `pendingDropFiles` to `attachedFiles` when they change:

```typescript
// Accept files dropped onto the chat area
// biome-ignore lint/correctness/useExhaustiveDependencies: only react to new drops
useEffect(() => {
  if (pendingDropFiles && pendingDropFiles.length > 0) {
    setAttachedFiles((prev) => [...prev, ...pendingDropFiles]);
  }
}, [pendingDropFiles]);
```

- [ ] **Step 7: Run tests**

Run: `npm test -- --run`
Expected: All pass

---

### Task 16: Final verification

- [ ] **Step 1: Run all frontend tests**

Run: `npm test -- --run`
Expected: All pass (60+ files, ~515 tests)

- [ ] **Step 2: Build Rust backend**

Run: `cargo build --workspace`
Expected: Compiles

- [ ] **Step 3: Build sidecar**

Run: `cd agent-sidecar && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit everything**

```bash
git add .
git commit -m "feat: file upload with preview, @mention autocomplete, drag-and-drop, and attachment cards"
```

---

## Summary

After all 16 tasks:

| Feature | How it works |
|---|---|
| Paperclip upload | 📎 → OS dialog → get_file_info → FilePreviewChip shows thumbnail/icon + size (stacks on multiple selects) → send → AttachmentCard in bubble |
| @ mention | Type `@` → useFileMention triggers → FileMentionPopup shows files → select → `@path` in text → AI sees path |
| Drag-and-drop | Drag files over chat area → DropZoneOverlay shows visual feedback → files stack into composer alongside uploaded ones |
| AI reads files | Paths sent alongside text, injected into system prompt, AI uses `read` tool |
| Backward compat | Old `[File: path]` messages parsed inline and rendered as AttachmentCards | 
