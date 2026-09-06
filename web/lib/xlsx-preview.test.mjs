import assert from "node:assert/strict";
import test from "node:test";

import { cellToString, escapeHtml, generateXlsxPreviewHtml } from "./xlsx-preview.ts";

test("escapes HTML metacharacters", () => {
  assert.equal(escapeHtml("a&b<c>d\"e'"), "a&amp;b&lt;c&gt;d&quot;e'");
});

test("cellToString renders plain and complex exceljs value shapes", () => {
  assert.equal(cellToString({ value: null }), "");
  assert.equal(cellToString({ value: undefined }), "");
  assert.equal(cellToString({ value: 42 }), "42");
  assert.equal(cellToString({ value: true }), "true");
  assert.equal(cellToString({ value: "hi" }), "hi");
  assert.equal(cellToString({ value: new Date("2020-01-01T00:00:00.000Z") }), "2020-01-01T00:00:00.000Z");
  assert.equal(cellToString({ value: { result: 7 } }), "7"); // exceljs Formula
  assert.equal(cellToString({ value: { text: "rich" } }), "rich"); // exceljs RichText-ish
  assert.equal(cellToString({ value: { richText: [{ text: "a" }, { text: "b" }] } }), "ab");
});

test("generateXlsxPreviewHtml builds a grid with sheet tabs and clamps cells", () => {
  const html = generateXlsxPreviewHtml(
    "Employee DB.xlsx",
    [
      {
        name: "People",
        rowCount: 3,
        cells: [
          { row: 1, col: 1, text: "Name" },
          { row: 1, col: 2, text: "Age" },
          { row: 2, col: 1, text: "Ada" },
        ],
      },
      { name: "Finance", rowCount: 1, cells: [] },
    ],
  );

  assert.ok(html.startsWith("<!doctype html>"));
  assert.ok(html.includes("<title>Employee DB.xlsx</title>"));
  assert.ok(html.includes("type=\"application/json\""));
  // Both sheet names become tabs (raw text, escaped by the client's textContent).
  assert.ok(html.includes("\"name\":\"People\""));
  assert.ok(html.includes("\"name\":\"Finance\""));
  // Cell values are carried into the data blob.
  assert.ok(html.includes("\"text\":\"Name\""));
  assert.ok(html.includes("\"text\":\"Ada\""));
  // Keyboard navigation and a status reference box are wired in.
  assert.ok(html.includes("ArrowDown"));
  assert.ok(html.includes("ref-box"));
});

test("generateXlsxPreviewHtml clamps out-of-range and over-limit cells", () => {
  const html = generateXlsxPreviewHtml(
    "Big.xlsx",
    [
      {
        name: "S",
        rowCount: 5000,
        cells: [
          // Out of the sheet's own row range.
          { row: 9999, col: 1, text: "ooo" },
          // Below the column ceiling.
          { row: 1, col: 9999, text: "ooo" },
          // A cell inside bounds that must survive.
          { row: 2, col: 2, text: "kept" },
        ],
      },
    ],
  );
  assert.ok(html.includes("\"text\":\"kept\""));
  assert.ok(!html.includes("\"text\":\"ooo\""));
});

test("generateXlsxPreviewHtml prevents script-tag injection from cell text", () => {
  const html = generateXlsxPreviewHtml(
    "X.xlsx",
    [{ name: "S", rowCount: 2, cells: [{ row: 1, col: 1, html: "</script><b>injected" }] }],
  );
  assert.ok(!html.includes("</script><b>injected"));
});
