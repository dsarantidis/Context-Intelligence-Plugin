/**
 * Build-time script: writes ui.html to dist with BUILD_VERSION (dd.mm.yy.n) replaced.
 * Version format: day.month.year.buildNumber (build number increments each build per day).
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const statePath = path.join(root, '.build-version-state.json');
const srcHtmlPath = path.join(root, 'src', 'ui.html');
const distPath = path.join(root, 'dist');
const distHtmlPath = path.join(distPath, 'ui.html');

const now = new Date();
const dd = String(now.getDate()).padStart(2, '0');
const mm = String(now.getMonth() + 1).padStart(2, '0');
const yy = String(now.getFullYear()).slice(-2);
const today = `${now.getFullYear()}-${mm}-${dd}`;

let n = 1;
try {
  const data = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  if (data.date === today) {
    n = (data.n || 0) + 1;
  }
} catch (_) {}

fs.writeFileSync(statePath, JSON.stringify({ date: today, n }, null, 2), 'utf8');

const version = `${dd}.${mm}.${yy}.${n}`;
const html = fs.readFileSync(srcHtmlPath, 'utf8').replace(/__BUILD_VERSION__/g, version);

if (!fs.existsSync(distPath)) fs.mkdirSync(distPath, { recursive: true });
fs.writeFileSync(distHtmlPath, html, 'utf8');

// Ensure placeholder is actually replaced (sanity check)
if (html.indexOf('__BUILD_VERSION__') !== -1) {
  console.warn('Warning: __BUILD_VERSION__ still present in output');
}

console.log('Version:', version);
