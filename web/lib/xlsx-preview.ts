// Self-contained spreadsheet preview renderer. The route parses the .xlsx with
// exceljs and hands this pure function a compact sheet description; it returns
// a full HTML page (grid + arrow-key navigation + sheet tabs) served to an
// iframe. Kept pure (no exceljs import) so it is unit-testable and side-effect free.

export interface SpreadsheetCell {
  row: number;
  col: number;
  text: string;
}

export interface SpreadsheetSheet {
  name: string;
  rowCount: number;
  rowEnd?: number;
  cells: SpreadsheetCell[];
}

// Read far more rows than the DOM will render; generateXlsxPreviewHtml clamps
// the visible grid. Limits parse cost on a huge workbook.
export const XLSX_MAX_RENDER_ROWS = 5000;

function cellValueToString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(cellValueToString).join(" ");
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    // exceljs Formula/Error/RichText cells expose these shapes.
    if (obj.result != null) return String(obj.result);
    if (obj.text != null) return String(obj.text);
    if (Array.isArray(obj.richText)) {
      return obj.richText
        .map((rt) => (rt && typeof rt === "object" && "text" in rt) ? String((rt as { text: unknown }).text) : cellValueToString(rt))
        .join("");
    }
  }
  return String(value);
}

// Convert an exceljs cell to display text. Pure over the cell object so it can
// be tested without opening a workbook.
export function cellToString(cell: { value?: unknown }): string {
  return cellValueToString(cell?.value);
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Clamp the grid so a huge workbook cannot blow up the DOM or the response.
const MAX_ROWS = 2000;
const MAX_COLS = 200;

export function generateXlsxPreviewHtml(fileName: string, sheets: SpreadsheetSheet[]): string {
  // Normalize + clamp into a compact structure the client renders. This bounds
  // both the DOM and the serialized payload regardless of source sheet size.
  const norm: SpreadsheetSheet[] = [];
  let globalColEnd = 0;
  for (const sheet of sheets) {
    const rowCount = Math.min(sheet.rowCount, MAX_ROWS);
    const cells: SpreadsheetCell[] = [];
    let rowEnd = 0;
    let colEnd = 0;
    for (const { row, col, text } of sheet.cells) {
      if (row < 1 || row > rowCount) continue;
      if (col < 1 || col > MAX_COLS) continue;
      cells.push({ row, col, text });
      if (row > rowEnd) rowEnd = row;
      if (col > colEnd) colEnd = col;
    }
    if (colEnd > globalColEnd) globalColEnd = colEnd;
    norm.push({ name: sheet.name, rowCount, cells, rowEnd: rowEnd || 1 });
  }

  const sheetCount = norm.length;

  const sheetJson = JSON.stringify(norm)
    // Prevent a cell containing "</script>" from closing the JSON blob early.
    .replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(fileName)}</title>
<style>
  :root { color-scheme: light; }
  html, body { margin: 0; height: 100%; background: #eef1f5; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    display: flex; flex-direction: column; height: 100vh; overflow: hidden;
  }
  #title {
    padding: 6px 12px; font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    color: #6b7280; border-bottom: 1px solid #e5e7eb; background: #fff;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex-shrink: 0;
  }
  #toolbar {
    display: flex; align-items: center; gap: 8px; padding: 4px 8px;
    border-bottom: 1px solid #e5e7eb; background: #f9fafb; flex-shrink: 0;
  }
  .ref-box {
    width: 64px; text-align: center; border: 1px solid #d1d5db; background: #fff;
    font: 11px ui-monospace, Menlo, Consolas, monospace; padding: 2px 4px; color: #374151;
  }
  .label { font-size: 11px; color: #6b7280; }
  #status { margin-left: auto; font-size: 11px; color: #6b7280; }
  #grid-wrap { flex: 1; overflow: auto; background: #fff; position: relative; }
  table { border-collapse: collapse; table-layout: fixed; font-size: 13px; color: #171717; }
  th, td {
    border: 1px solid #e5e7eb; padding: 0 6px; height: 20px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    box-sizing: content-box;
  }
  .col-header, .row-header {
    background: #f3f4f6; font-weight: 500; text-align: center; color: #6b7280;
    user-select: none; position: sticky; z-index: 2; cursor: pointer;
  }
  .col-header { top: 0; z-index: 3; }
  .corner { top: 0; left: 0; z-index: 4; }
  .row-header { left: 0; z-index: 1; cursor: pointer; }
  td.data { cursor: cell; }
  td.active {
    outline: 2px solid #2563eb; outline-offset: -2px; background: #eff6ff;
    font-weight: 500;
  }
  #tabs {
    display: flex; gap: 2px; padding: 4px 8px 0; background: #f9fafb;
    border-top: 1px solid #e5e7eb; flex-shrink: 0; overflow-x: auto;
  }
  .tab {
    padding: 4px 12px; font-size: 12px; border: 1px solid transparent;
    border-bottom: none; background: transparent; cursor: pointer; color: #6b7280;
    border-radius: 4px 4px 0 0; max-width: 160px; overflow: hidden; text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tab.active { background: #fff; color: #111827; border-color: #e5e7eb; font-weight: 500; }
</style>
</head>
<body>
<div id="title">${escapeHtml(fileName)}</div>
<div id="toolbar">
  <div class="ref-box" id="ref-box">A1</div>
  <span class="label">active cell</span>
  <span id="sheet-count">${sheetCount} sheet${sheetCount === 1 ? "" : "s"}</span>
  <span id="status"></span>
</div>
<div id="grid-wrap"><table id="grid"></table></div>
<div id="tabs"></div>
<script id="xlsx-sheets" type="application/json">${sheetJson}</script>
<script>
(function () {
  var sheets = JSON.parse(document.getElementById("xlsx-sheets").textContent);
  var MAX_COLS = ${MAX_COLS};
  var MAX_ROWS = ${MAX_ROWS};
  var COL_END = ${globalColEnd};

  var grid = document.getElementById("grid");
  var tabs = document.getElementById("tabs");
  var refBox = document.getElementById("ref-box");
  var statusEl = document.getElementById("status");
  var wrap = document.getElementById("grid-wrap");

  // 1-indexed column number -> Excel column letter (1 -> A, 27 -> AA).
  function columnLetter(col) {
    var letters = "";
    while (col > 0) {
      var remainder = (col - 1) % 26;
      letters = String.fromCharCode(65 + remainder) + letters;
      col = Math.floor((col - 1) / 26);
    }
    return letters;
  }

  // Build each sheet's cell index once (row -> col -> text) for the client to
  // render from. Row/col are 1-indexed to match Excel's A1 addressing.
  var sheetEls = sheets.map(function (sheet) {
    var rowMap = new Map();
    for (var i = 0; i < sheet.cells.length; i++) {
      var c = sheet.cells[i];
      if (!rowMap.has(c.row)) rowMap.set(c.row, new Map());
      rowMap.get(c.row).set(c.col, c.text);
    }
    return { sheet: sheet, rowMap: rowMap };
  });

  var active = { index: 0, row: 1, col: 1 };

  function render() {
    grid.innerHTML = "";

    // Head: empty corner + column letters A..G in one sticky row. A real
    // <thead> makes the letters sit ABOVE the header row instead of beside
    // the row numbers, so every letter aligns with the column beneath it.
    var head = document.createElement("thead");
    var headRow = document.createElement("tr");
    var corner = document.createElement("th");
    corner.className = "col-header corner";
    corner.textContent = "\u00a0";
    headRow.appendChild(corner);
    for (var c = 1; c <= COL_END; c++) {
      var ch = document.createElement("th");
      ch.className = "col-header";
      ch.textContent = columnLetter(c);
      ch.setAttribute("data-col", String(c));
      ch.addEventListener("click", function () { setActive(1, c); });
      headRow.appendChild(ch);
    }
    head.appendChild(headRow);
    grid.appendChild(head);

    // Body: one <tr> per (sheet, row), only the active sheet visible. A single
    // table means thead and tbody share column widths, so headers stay aligned.
    var body = document.createElement("tbody");
    sheetEls.forEach(function (item, s) {
      var rowMap = item.rowMap;
      for (var r = 1; r <= item.sheet.rowEnd; r++) {
        var tr = document.createElement("tr");
        tr.style.display = s === active.index ? "" : "none";
        var rh = document.createElement("th");
        rh.className = "row-header";
        rh.textContent = String(r);
        rh.setAttribute("data-row", String(r));
        rh.setAttribute("data-sheet", String(s));
        rh.addEventListener("click", function () { setActive(r, 1); });
        tr.appendChild(rh);
        var cols = rowMap.get(r);
        for (var c = 1; c <= COL_END; c++) {
          var td = document.createElement("td");
          td.className = "data";
          td.setAttribute("data-row", String(r));
          td.setAttribute("data-col", String(c));
          td.setAttribute("data-sheet", String(s));
          if (cols && cols.has(c)) td.textContent = cols.get(c);
          (function (cell) {
            cell.addEventListener("click", function () { setActive(r, c); });
          })(td);
          tr.appendChild(td);
        }
        body.appendChild(tr);
      }
    });
    grid.appendChild(body);

    refreshActive();
  }

  function refreshActive() {
    // Clear the highlight from every data cell, then re-apply on the target so
    // an active cell can only be drawn from the currently active sheet.
    var cells = grid.querySelectorAll("td.data");
    for (var i = 0; i < cells.length; i++) cells[i].classList.remove("active");
    var target = grid.querySelector(
      'td.data[data-sheet="' + active.index + '"][data-row="' + active.row + '"][data-col="' + active.col + '"]'
    );
    if (target) {
      target.classList.add("active");
      target.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    refBox.textContent = columnLetter(active.col) + active.row;
    statusEl.textContent = sheets[active.index].name + " — row " + active.row + ", col " + active.col + " of " + MAX_COLS;
  }

  function setActive(row, col) {
    active.row = Math.max(1, Math.min(MAX_ROWS, row));
    active.col = Math.max(1, Math.min(MAX_COLS, col));
    refreshActive();
  }

  function move(dx, dy) {
    setActive(active.row + dy, active.col + dx);
  }

  function renderTabs() {
    tabs.innerHTML = "";
    sheetEls.forEach(function (item, idx) {
      var btn = document.createElement("button");
      btn.className = "tab" + (idx === active.index ? " active" : "");
      btn.textContent = item.sheet.name;
      btn.addEventListener("click", function () {
        active.index = idx;
        active.row = 1;
        active.col = 1;
        render();
      });
      tabs.appendChild(btn);
    });
  }

  document.addEventListener("keydown", function (e) {
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); move(0, 1); break;
      case "ArrowUp": e.preventDefault(); move(0, -1); break;
      case "ArrowRight": e.preventDefault(); move(1, 0); break;
      case "ArrowLeft": e.preventDefault(); move(-1, 0); break;
      case "PageDown": e.preventDefault(); move(0, 1); break;
      case "PageUp": e.preventDefault(); move(0, -1); break;
    }
  });

  render();
  renderTabs();
})();
</script>
</body>
</html>`;
}
