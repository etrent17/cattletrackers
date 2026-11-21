// Escape a value for safe insertion into HTML built with template strings,
// both as element text and inside quoted attribute values (`data-id="..."`).
// null/undefined become an empty string; other values are converted with String().
const HTML_ESCAPES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}
