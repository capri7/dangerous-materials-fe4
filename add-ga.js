const fs = require('fs');
const path = require('path');

const GA_TAG = `<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-9D6XGBJWTC"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-9D6XGBJWTC');
</script>`;

function insertGA(filePath) {
  let html = fs.readFileSync(filePath, 'utf8');
  if (html.includes('G-9D6XGBJWTC')) {
    console.log(`スキップ（既に設定済み）: ${filePath}`);
    return;
  }
  html = html.replace('<head>', '<head>\n' + GA_TAG);
  fs.writeFileSync(filePath, html, 'utf8');
  console.log(`完了: ${filePath}`);
}

function walk(dir) {
  fs.readdirSync(dir).forEach(file => {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      walk(fullPath);
    } else if (file.endsWith('.html')) {
      insertGA(fullPath);
    }
  });
}

walk('./public');