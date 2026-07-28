# File Upload, @ Mention & Image Capability — Fix Plan

> **Problem:** The @mention autocomplete doesn't trigger visibly, files don't load in time, and selecting a file should create a visible chip/tag in the input that resolves to an absolute path for AI. Image files also need an honest capability check: Pi only sends image blocks when the selected model declares image input.
> **Spec:** [`../specs/2026-07-19-file-upload-feature.md`](../specs/2026-07-19-file-upload-feature.md)

---

## Root Causes

### 1. Workspace files never finish loading before user types `@`

In `useFileMention.ts`:
```typescript
loaded.current = true;  // ← set IMMEDIATELY
getWorkspaceFiles().then(setAllEntries).catch(() => {});
```

`loaded.current` is set to `true` before `getWorkspaceFiles()` completes. If the user types `@` before the Promise resolves, `allEntries` is still `[]`, so `results` is `[]`, and the popup condition `mention.results.length > 0` is false → nothing renders.

### 2. Popup only shows when there are results

In `MessageInput.tsx`:
```tsx
{mention.state === "active" && mention.results.length > 0 && (
  <FileMentionPopup ... />
)}
```

Even if `@` is detected correctly, no popup appears until results are non-empty. So the user gets zero feedback.

### 3. File selection inserts plain text, not a visible tag

When user selects a file, we do:
```typescript
setText(`${before}@${entry.name} `);
```

Just plain text in the textarea. User wants a chip/tag that is visually distinct.

### 4. Popup positioned at shell, not near the `@` cursor

`calcMentionAnchor` returns a fixed position above the composer shell, not dynamic based on where `@` was typed.

### 5. Custom router models lose image capability during discovery

`GET /v1/models` returns model IDs but OpenAI's response shape has no standard image-capability field. Cowork stores bare discovered IDs, and Pi's `ModelRegistry` defaults a custom model with no `input` field to `input: ["text"]`.

This makes a vision-capable router model appear text-only. Pi correctly removes an image returned by `read` before it calls the model. The router never receives it.

The recent `custom-local-llm/openai-codex/gpt-5.6-terra` session proved this: its image tool result was persisted, but native `openai-codex/gpt-5.6-terra` worked only because Pi's built-in model catalog declares `input: ["text", "image"]`.

**Boundary:** Cowork/Pi decides whether to send an image; `zosma-router` must accept and forward the standard OpenAI `image_url` data URL after Cowork has decided it is supported.

---

## Fix Plan

### Fix 1: Load files eagerly, show loading state

**File:** `src/hooks/useFileMention.ts`

**Change:** Instead of lazy-loading in a `useEffect` with `loaded.current`, load files synchronously in the hook body (or at least track loading state):

```typescript
const [loading, setLoading] = useState(true);

useEffect(() => {
  getWorkspaceFiles()
    .then(setAllEntries)
    .catch(() => {})
    .finally(() => setLoading(false));
}, []);
```

Remove the `loaded.current = true` before the Promise resolves. Track `loading` state and expose it so the popup can show "Loading..." instead of nothing.

**Return type change:** Add `loading: boolean` to `UseFileMentionReturn`.

### Fix 2: Show popup whenever state is "active" — even with empty results

**File:** `src/components/MessageInput.tsx`

**Change:** Relax the render condition:

```tsx
{mention.state === "active" && (
  <FileMentionPopup
    entries={mention.results}
    loading={mention.loading}
    ...
  />
)}
```

Always render when active. The popup itself handles the empty/loading states internally.

### Fix 3: Popup shows contextual states

**File:** `src/components/FileMentionPopup.tsx`

**Add `loading` prop.** Render different content based on state:

| State | Render |
|---|---|
| `loading` | "Loading workspace files…" spinner |
| `!loading && entries.length === 0 && query` | "No matches for `{query}`" |
| `!loading && entries.length === 0 && !query` | "No files in workspace" |
| `entries.length > 0` | File list (current) |

This gives the user feedback at every stage.

### Fix 4: File selection adds to `attachedFiles` + shows chip

**File:** `src/components/MessageInput.tsx`

**Change the `onSelect` handler** in both the keyboard handler and the popup's `onSelect`:

When a file is selected:
1. Keep inserting `@filename` text in the textarea (so user sees the reference)
2. **Also** add the file to `attachedFiles` state (as a `FileAttachment`) — it appears as a chip in the pre-send preview area alongside uploaded files
3. The chip shows the filename + a "mention" badge to distinguish from uploaded files

```typescript
onSelect: (entry) => {
  // 1. Insert text reference
  const before = text.slice(0, mention.triggerPosition ?? 0);
  setText(`${before}@${entry.name} `);
  
  // 2. Add as attached file chip (visible in pre-send area)
  setAttachedFiles(prev => [...prev, {
    path: entry.path,
    name: entry.name,
    size: 0,  // We don't have this info yet — could fetch it
    mimeType: entry.isDirectory ? "inode/directory" : "application/octet-stream",
  }]);
  
  setMentionSelectedIndex(0);
  mention.selectFile(entry);  // resets state
}
```

### Fix 5: Mark @-mentioned files differently from uploaded files

**File:** `src/components/FilePreviewChip.tsx`

Add a subtle visual difference for @-mentioned files vs uploaded files:
- Mentioned files: show an `AtSign` icon or a small `@` badge
- Uploaded files: show the paperclip icon or generic file icon (current)

Simplest approach: Add an optional `source?: "mention" | "upload"` field to `FileAttachment` type. The chip shows a different icon based on source.

```typescript
export interface FileAttachment {
  path: string;
  name: string;
  size: number;
  mimeType: string;
  source?: "upload" | "mention";  // NEW
}
```

### Fix 6: Position popup near the `@` cursor in the textarea

**File:** `src/components/MessageInput.tsx`

Update `calcMentionAnchor` to estimate cursor position in the textarea using a hidden mirror element:

```typescript
function calcMentionAnchor(textarea: HTMLTextAreaElement | null): { top: number; left: number } | null {
  if (!textarea) return null;
  const rect = textarea.getBoundingClientRect();
  // Simple approximation: position above the left side of the textarea
  return { top: rect.top - 8, left: rect.left + 16 };
}
```

For more precise positioning, use a mirror div that mirrors the textarea content up to the cursor and measure its width. But for v1, fixed position above the input is fine.

### Fix 7: Expose file size info for @-selected files

**File:** `src/hooks/useFileMention.ts` + `src/components/MessageInput.tsx`

When the user selects a file, fetch its metadata (size, mime type) using `invoke("get_file_info")`. This populates the chip correctly.

Or simpler: keep `size: 0` and `mimeType: "application/octet-stream"` for now — the file size is cosmetic for the chip. The AI gets the absolute path and reads the file directly.

### Fix 8: On send, attach absolute paths for @-mentioned files

**File:** `src/components/MessageInput.tsx` — `handleSubmit`

When building the message payload, `attachedFiles` already contains both uploaded and @-mentioned files. The absolute `path` field is already populated. On send, format as `[File: absolute/path] name size mimeType` (the existing format).

The `@filename` text in the message content serves as a visual reference for the user. The AI gets the absolute path in the `[File: ...]` marker.

No sidecar changes needed — the existing parsing in `ChatMessage.tsx` already handles this.

---

## Image Capability Plan

### Capability source and safe fallback

1. Extend custom-model config with `input?: ("text" | "image")[]`.
2. Parse optional router capability fields from each `/v1/models` row. Accept Cowork aliases such as `input`, `input_modalities`, or `capabilities.image`; normalize them to Pi's `input` shape.
3. Preserve `input` across rediscovery like reasoning and compat fields.
4. Default models without explicit capability metadata to `input: ["text"]`. Do not infer vision from model name alone.
5. Until `zosma-router` exposes capability metadata, seed its known vision models in one small explicit Cowork catalog. This is a compatibility bridge, not generic custom-provider behavior.

### Composer behavior

1. Include `input` in sidecar `get_models` results and frontend `ModelInfo`.
2. When user attaches, drops, pastes, or @-mentions an image while selected model is text-only, show inline warning: selected model will not receive images.
3. Do not block normal files. Do not silently claim an image was sent.
4. With `input` containing `image`, existing Pi `read` behavior sends tool-result images as OpenAI `image_url` data URLs. No duplicate Cowork file-to-base64 path.

### Router contract test

Add opt-in router integration test: send tiny PNG through `POST /v1/chat/completions` using image-capable model and assert vision-grounded response. Unit tests verify Cowork metadata and Pi configuration only.

## Files to Modify

| File | Changes |
|---|---|
| `agent-sidecar/src/custom-providers.ts` | Parse/persist `input`; preserve across rediscovery; resolve explicit known router vision metadata; retain text-only fallback |
| `agent-sidecar/src/custom-providers.test.ts` | Test capability parsing, persistence, preservation, and text-only fallback |
| `agent-sidecar/src/commands/handlers/core.ts` | Include model `input` in `get_models` response |
| Focused core-handler test | Assert `input` reaches UI payload |
| `src/types/index.ts` | Add model input capability and `source?: "upload" \| "mention"` to `FileAttachment` |
| `src/hooks/useFileMention.ts` | Fix race condition, add `loading` state, remove premature `loaded.current = true` |
| `src/components/FileMentionPopup.tsx` | Add `loading` prop, show contextual states |
| `src/components/MessageInput.tsx` | Always render popup, attach selected mentions, warn for images unsupported by selected model |
| `src/components/FilePreviewChip.tsx` | Show `@` badge for mentioned files |
| `src/components/MessageInput.test.tsx` | Test image warning and no warning for vision model |

## Test Updates

| Test | Changes |
|---|---|
| `custom-providers.test.ts` | Test image-capability parsing, persistence, rediscovery preservation, unknown-model text-only fallback |
| `useFileMention.test.ts` | Update for `loading` state, test loading flow |
| `FileMentionPopup.test.tsx` | Add tests for loading state, empty state, no matches state |
| `MessageInput.test.tsx` | Test @mention attachment and image warnings |

---

## Execution Order

1. Add custom-model `input` capability handling with failing sidecar tests.
2. Expose `input` through `get_models` and frontend types.
3. Add composer image-support warning with failing component test.
4. Fix `useFileMention` loading state.
5. Update popup, mention chip, and composer selection behavior.
6. Run focused tests, full frontend tests, sidecar typecheck, and router integration check.
