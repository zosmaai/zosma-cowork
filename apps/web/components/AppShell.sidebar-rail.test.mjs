import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");

test("keeps the sidebar at a fixed width with no drag handle", () => {
  // The old resizable handle is gone; the user can no longer drag to resize.
  assert.doesNotMatch(source, /sidebar-resize-handle/);
  // Width still comes from the persisted css variable so it survives reload.
  assert.match(source, /"--sidebar-width"/);
});

test("has a ChatGPT-style collapse-to-icon-rail toggle", () => {
  assert.match(source, /const \[sidebarCollapsed, setSidebarCollapsed\] = useState\(false\)/);
  assert.match(source, /const handleSidebarCollapseToggle = useCallback/);
  assert.match(source, /setSidebarCollapsed\(\(/);
  // Rail toggling is distinct from full hide (mobile drawer).
  assert.doesNotMatch(source, /handleSidebarCollapseToggle.*handleSidebarToggle[\s\S]*?onToggleSidebar/);
});

test("wires the rail class into the sidebar container", () => {
  assert.match(source, /sidebar-collapsed/);
  // Rail only: collapsed + not mobile (mobile uses the drawer instead).
  assert.match(source, /sidebarCollapsed && !isMobile/);
});

test("SidebarSidebar accepts a rail prop and app-shell footer switches to icon rail", async () => {
  const sessionSidebar = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
  assert.match(sessionSidebar, /rail\?:\s*bool/);
  assert.match(sessionSidebar, /onToggleRail/);
  assert.match(sessionSidebar, /isMobile\?:\s*bool/);
  assert.match(source, /sidebar-footer/);
  assert.match(source, /is-rail/);
});
