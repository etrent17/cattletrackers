// CSV generation (RFC 4180) for exports opened in spreadsheet programs.
//
// Spreadsheet formula injection: a cell that starts with = + - or @ (or a tab or
// carriage return, which some programs skip before reading a formula) may be run as a
// formula when the file is opened. Such values get a leading single quote so they are
// shown as text. Only use this for text fields; write numbers you control as-is.

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvField(value) {
  let text = value === null || value === undefined ? "" : String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

// rows: array of arrays of cell values. Lines end with CRLF, including the last one.
export function toCsv(rows) {
  return rows.map((row) => row.map(csvField).join(",")).join("\r\n") + "\r\n";
}

// Starts a browser download of `text` as a UTF-8 CSV file. The byte-order mark lets
// Excel detect UTF-8, so names with accents display correctly.
export function downloadCsv(filename, text) {
  const blob = new Blob(["﻿", text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
