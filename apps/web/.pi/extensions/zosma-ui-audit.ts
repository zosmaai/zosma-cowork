import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";

const STATUS_KEY = "zosma-ui-audit";
const ABOVE_KEY = "zosma-ui-audit-above";
const BELOW_KEY = "zosma-ui-audit-below";

function clear(ui: ExtensionContext["ui"]): void {
  ui.setStatus(STATUS_KEY, undefined);
  ui.setWidget(ABOVE_KEY, undefined);
  ui.setWidget(BELOW_KEY, undefined);
  ui.setTitle("zosma.ai");
}

export default function zosmaUiAudit(pi: ExtensionAPI): void {
  if (process.env.ZOSMA_UI_VISUAL_AUDIT !== "1") return;

  pi.registerCommand("zosma-ui-audit", {
    description: "Exercise Zosma browser extension UI surfaces for visual acceptance",
    handler: async (args, ctx) => {
      const ui = ctx.ui;
      switch (args.trim()) {
        case "ambient":
          ui.setTitle("zosma.ai — UI audit");
          ui.setStatus(STATUS_KEY, "audit: status ready");
          ui.setWidget(ABOVE_KEY, [
            "Above editor widget",
            "Second line for expansion",
          ]);
          ui.setWidget(BELOW_KEY, [
            "Below editor widget",
            "Second line for expansion",
            "Third line for scrolling rhythm",
          ], { placement: "belowEditor" });
          ui.notify("Audit info notice", "info");
          ui.notify("Audit warning notice", "warning");
          ui.notify("Audit error notice", "error");
          return;

        case "select": {
          const value = await ui.select("Choose audit option", ["Fast", "Accurate", "Cancel path"]);
          ui.notify(value ? `Selected: ${value}` : "Select cancelled", "info");
          return;
        }

        case "confirm": {
          const confirmed = await ui.confirm(
            "Confirm audit action",
            "This is deterministic fixture text. It changes no external state.",
          );
          ui.notify(confirmed ? "Confirmed" : "Confirm cancelled", "info");
          return;
        }

        case "input": {
          const value = await ui.input("Enter audit value", "type something...");
          ui.notify(value ? `Input length: ${value.length}` : "Input cancelled", "info");
          return;
        }

        case "editor": {
          const value = await ui.editor("Edit audit text", "Line 1\nLine 2\nLine 3");
          ui.notify(value ? `Editor lines: ${value.split("\n").length}` : "Editor cancelled", "info");
          return;
        }

        case "custom":
          await ui.custom((_tui, theme, _keybindings, done) => ({
            render(width) {
              return [
                theme.fg("accent", "Zosma extension custom panel"),
                theme.fg("muted", "ANSI colors and terminal columns remain intact."),
                "Press Escape or Ctrl+C to close.",
              ].map((line) => truncateToWidth(line, width));
            },
            handleInput(data) {
              if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
                done(undefined);
              }
            },
            invalidate() {},
          }));
          ui.notify("Custom panel closed", "info");
          return;

        case "clear":
          clear(ui);
          ui.notify("Audit surfaces cleared", "info");
          return;

        default:
          ui.notify(
            "Usage: /zosma-ui-audit ambient|select|confirm|input|editor|custom|clear",
            "warning",
          );
      }
    },
  });
}
