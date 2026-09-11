import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./file-types.ts");
}

test("detects image, audio, document, and spreadsheet preview paths", async () => {
  const {
    getAudioMime,
    getDocumentMime,
    getImageMime,
    getSpreadsheetMime,
    isAudioPath,
    isDocumentPreviewPath,
    isImagePath,
    isSpreadsheetPath,
  } = await loadSubject();

  assert.equal(getImageMime("/tmp/screenshot.PNG"), "image/png");
  assert.equal(getAudioMime("C:\\Users\\me\\voice.OPUS"), "audio/ogg");
  assert.equal(getDocumentMime("/tmp/report.docx"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.equal(isImagePath("/tmp/screenshot.PNG"), true);
  assert.equal(isAudioPath("C:\\Users\\me\\voice.OPUS"), true);
  assert.equal(isDocumentPreviewPath("/tmp/report.pdf"), true);
  assert.equal(isDocumentPreviewPath("/tmp/report.txt"), false);

  assert.equal(getSpreadsheetMime("/tmp/Employee DB.xlsx"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert.equal(getSpreadsheetMime("C:\\Users\\me\\data.XLSX"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert.equal(getSpreadsheetMime("/tmp/legacy.xls"), "application/vnd.ms-excel");
  assert.equal(isSpreadsheetPath("/tmp/Employee DB.xlsx"), true);
  assert.equal(isSpreadsheetPath("/tmp/report.txt"), false);
});

test("extracts extensions from mixed path styles", async () => {
  const { documentPreviewKind, getFileExt, spreadsheetPreviewKind } = await loadSubject();

  assert.equal(getFileExt("/tmp/archive.tar.gz"), "gz");
  assert.equal(getFileExt("C:\\Users\\me\\photo.AVIF"), "avif");
  assert.equal(documentPreviewKind("/tmp/manual.PDF"), "pdf");
  assert.equal(documentPreviewKind("/tmp/manual.md"), null);
  assert.equal(spreadsheetPreviewKind("/tmp/data.XLSX"), "xlsx");
  assert.equal(spreadsheetPreviewKind("/tmp/legacy.XLS"), "xls");
  assert.equal(spreadsheetPreviewKind("/tmp/report.md"), null);
});
