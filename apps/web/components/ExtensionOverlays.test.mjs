import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { ExtensionCustomPanel, ExtensionDialog } = await jiti.import("./ExtensionOverlays.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

function render(component, props) {
  return renderToStaticMarkup(
    React.createElement(I18nProvider, null, React.createElement(component, props)),
  );
}
const onRespond = () => {};

test("renders select as a labelled modal", () => {
  const html = render(ExtensionDialog, {
    request: {
      type: "extension_ui_request",
      id: "select-1",
      method: "select",
      title: "Choose model",
      options: ["Fast", "Accurate"],
    },
    onRespond,
  });
  assert.match(html, /extension-overlay-mask/);
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /aria-labelledby="[^"]+"/);
  assert.match(html, /extension-dialog-option/);
  assert.match(html, /data-overlay-autofocus="true"/);
  assert.match(html, />Fast</);
});

test("renders confirm, input, and editor variants", () => {
  const confirm = render(ExtensionDialog, {
    request: {
      type: "extension_ui_request",
      id: "confirm-1",
      method: "confirm",
      title: "Run command",
      message: "This changes files.",
    },
    onRespond,
  });
  assert.match(confirm, /extension-dialog-message/);
  assert.match(confirm, />Confirm</);

  const input = render(ExtensionDialog, {
    request: {
      type: "extension_ui_request",
      id: "input-1",
      method: "input",
      title: "Name",
      placeholder: "Session name",
    },
    onRespond,
  });
  assert.match(input, /extension-dialog-input/);
  assert.match(input, /placeholder="Session name"/);

  const editor = render(ExtensionDialog, {
    request: {
      type: "extension_ui_request",
      id: "editor-1",
      method: "editor",
      title: "Edit prompt",
      prefill: "Existing prompt",
    },
    onRespond,
  });
  assert.match(editor, /extension-dialog-editor/);
  assert.match(editor, />Existing prompt<\/textarea>/);
});

test("renders custom ANSI UI with a non-tabbable capture textarea", () => {
  const html = render(ExtensionCustomPanel, {
    request: {
      type: "extension_ui_request",
      id: "custom-1",
      method: "custom",
      lines: ["\u001b[31mFailure\u001b[0m", "Press Escape"],
    },
    onInput: () => {},
  });
  assert.match(html, /extension-custom-panel/);
  assert.match(html, /extension-custom-capture/);
  assert.match(html, /tabindex="-1"/);
  assert.match(html, /extension-custom-output/);
  assert.match(html, /Failure/);
});

test("owns focus, terminal input, restoration, and Tab containment", async () => {
  const source = await readFile(new URL("./ExtensionOverlays.tsx", import.meta.url), "utf8");
  for (const token of [
    "FOCUSABLE_SELECTOR",
    "previousFocusRef",
    "requestAnimationFrame",
    "handleOverlayKeyDown",
    "dialog.contains(document.activeElement)",
    "previousFocusRef.current?.focus()",
    "toTerminalKeyData(event)",
    "asBracketedPaste(text)",
    "event.nativeEvent.isComposing",
    'onInput(request, "\\x03")',
    "normalizeCustomPanelLines(request.lines)",
  ]) {
    assert.ok(source.includes(token), `missing ${token}`);
  }
});
