// renderTable.js

/**
 * Build and return a <table> representing data.choices.
 * Does *not* insert into the DOM or bind any events.
 *
 * @param {{ choices: any[], fields?: string[], headers?: string[] }} data
 * @returns {HTMLTableElement}
 */
export function renderTable(data) {
  const table = document.createElement("table");
  table.className = "choices-table";

  // Compute fields & headers
  const fields = Array.isArray(data.fields) && data.fields.length > 0
    ? data.fields
    : null;
  const headers = Array.isArray(data.headers) && data.headers.length > 0
    ? data.headers
    : null;

  // Header row if applicable
  if (fields && headers) {
    const thead = table.createTHead();
    const hr = thead.insertRow();
    // フィールド数に合わせて見出しを揃える + 非文字列はラベル化
    const hdrs = headers
      .slice(0, fields.length)
      .map(h =>
        typeof h === "string"
          ? h
          : h && typeof h === "object"
            ? (h.label || h.title || h.name || "選択肢")
            : "選択肢"
      );
    ["No.", ...hdrs].forEach(label => {
      const th = document.createElement("th");
      th.textContent = label;
      hr.appendChild(th);
    });
  }

  // Data rows
  data.choices.forEach((choice, i) => {
    const row = table.insertRow();
    row.dataset.index = i;

    // A11y: make the row focusable & role=button
    row.setAttribute("role", "button");
    row.tabIndex = 0;

    // No. column
    const noCell = row.insertCell();
    noCell.textContent = `${i + 1}`;

    // Content column(s)
    if (fields) {
      fields.forEach(f => {
        const cell = row.insertCell();
        cell.textContent = choice[f];
      });
    } else {
      // fallback to first non-name key or "name"
      const key = Object.keys(choice).find(k => k !== "name") || "name";
      const cell = row.insertCell();
      cell.textContent = choice[key];
    }
  });

  return table;
}
