// public/includes/table-renderer.js
export async function renderTable(containerSelector, jsonPath) {
  const res = await fetch(jsonPath);
  const { caption, headers, rows } = await res.json();

  const table = document.createElement('table');
  table.classList.add('no-stripe');

  if (caption) {
    const cap = document.createElement('caption');
    cap.textContent = caption;
    table.appendChild(cap);
  }

  // ヘッダーの描画
  const thead = document.createElement('thead');
  const trHead = document.createElement('tr');
  headers.forEach(h => {
    const th = document.createElement('th');
    th.textContent = h;
    trHead.appendChild(th);
  });
  thead.appendChild(trHead);
  table.appendChild(thead);

  // ボディの描画（新フォーマット: rows は { cells: [...] } の配列）
  const tbody = document.createElement('tbody');
  rows.forEach(row => {
    const tr = document.createElement('tr');
    // 旧フォーマット（rows が二重配列）の互換性も確保
    const cellArray = Array.isArray(row) ? row : row.cells || [];
    cellArray.forEach(cell => {
      const td = document.createElement('td');
      // ★ rowSpan の対応
      if (cell && cell.rowSpan) {
        td.rowSpan = cell.rowSpan;
      }
      // cell がオブジェクトなら { text, className } を利用
      if (typeof cell === 'object') {
        td.innerHTML = cell.text;
        if (cell.className) {
          cell.className.split(/\s+/).forEach(cls => td.classList.add(cls));
        }
      } else {
        // 旧フォーマット: cell が文字列
        td.textContent = cell;
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  const container = document.querySelector(containerSelector);
  if (container) {
    container.appendChild(table);
  }
}
