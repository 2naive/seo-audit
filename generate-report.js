#!/usr/bin/env node
/**
 * SEO Audit Report Generator
 * Usage: node generate-report.js <report.json> [output-dir]
 * Generates: report.html + report.pdf (via Chrome headless)
 */

const { readFileSync, writeFileSync, mkdirSync } = require('fs');
const { execSync } = require('child_process');
const { resolve } = require('path');

// ── Chrome paths ──────────────────────────────────────────────────────────────
const CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

function findChrome() {
  for (const p of CHROME_PATHS) {
    try { execSync(`"${p}" --version`, { stdio: 'pipe' }); return p; } catch {}
  }
  return null;
}

// ── Score → color ─────────────────────────────────────────────────────────────
function scoreColor(score) {
  if (score >= 8) return '#22c55e';
  if (score >= 5) return '#f59e0b';
  return '#ef4444';
}

function severityBadge(s) {
  const map = {
    critical: ['#fee2e2', '#dc2626', '🔴 Критично'],
    warning:  ['#fef9c3', '#ca8a04', '🟡 Предупреждение'],
    info:     ['#eff6ff', '#3b82f6', '🔵 Инфо'],
    ok:       ['#f0fdf4', '#16a34a', '🟢 Хорошо'],
  };
  const [bg, color, label] = map[s] ?? map.info;
  return `<span style="background:${bg};color:${color};padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600">${label}</span>`;
}

// ── HTML template ─────────────────────────────────────────────────────────────
function buildHTML(data) {
  const { url, date, summary, scores, pages, recommendations, technical } = data;

  const totalScore = scores ? (Object.values(scores).reduce((a, b) => a + b, 0) / Object.keys(scores).length).toFixed(1) : 'N/A';

  const scoresRows = scores ? Object.entries(scores).map(([cat, val]) => `
    <tr>
      <td style="padding:10px 16px;border-bottom:1px solid #f1f5f9">${cat}</td>
      <td style="padding:10px 16px;border-bottom:1px solid #f1f5f9;text-align:center">
        <span style="font-size:18px;font-weight:700;color:${scoreColor(val)}">${val}</span><span style="color:#94a3b8">/10</span>
      </td>
      <td style="padding:10px 16px;border-bottom:1px solid #f1f5f9">
        <div style="background:#e2e8f0;border-radius:99px;height:8px;width:100%;max-width:180px">
          <div style="background:${scoreColor(val)};width:${val * 10}%;height:8px;border-radius:99px"></div>
        </div>
      </td>
    </tr>`).join('') : '';

  const issuesList = (pages ?? []).flatMap(p =>
    (p.issues ?? []).map(i => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#475569;max-width:280px;word-break:break-all">
          <a href="${p.url}" style="color:#3b82f6;text-decoration:none">${p.url.replace(/^https?:\/\/[^/]+/, '') || '/'}</a>
        </td>
        <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9">${severityBadge(i.severity)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:13px">${i.msg}</td>
      </tr>`)
  ).join('');

  const recList = (recommendations ?? []).map((r, i) => `
    <div style="display:flex;gap:12px;padding:14px 0;border-bottom:1px solid #f1f5f9">
      <div style="min-width:28px;height:28px;background:#3b82f6;color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px">${i + 1}</div>
      <div>
        <div style="font-weight:600;margin-bottom:4px">${r.title}</div>
        <div style="color:#64748b;font-size:14px">${r.description}</div>
      </div>
    </div>`).join('');

  const techRows = (technical ?? []).map(t => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;font-weight:500">${t.check}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9">${severityBadge(t.status)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#475569">${t.value ?? ''}</td>
    </tr>`).join('');

  const stats = summary ?? {};

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SEO Аудит — ${url}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f8fafc; color: #1e293b; }
  .page { max-width: 960px; margin: 0 auto; padding: 40px 24px; }
  .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 28px; margin-bottom: 24px; }
  h1 { font-size: 28px; font-weight: 800; margin-bottom: 4px; }
  h2 { font-size: 18px; font-weight: 700; margin-bottom: 16px; color: #1e293b; }
  .subtitle { color: #64748b; font-size: 14px; }
  .header-bar { background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); color: #fff; border-radius: 12px; padding: 32px; margin-bottom: 24px; }
  .score-big { font-size: 64px; font-weight: 900; line-height: 1; }
  .stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
  .stat { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px; text-align: center; }
  .stat-value { font-size: 28px; font-weight: 800; }
  .stat-label { font-size: 12px; color: #64748b; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; padding: 10px 12px; background: #f8fafc; font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: #64748b; border-bottom: 2px solid #e2e8f0; }
  @media print {
    body { background: #fff; }
    .page { padding: 20px; }
    .card { break-inside: avoid; }
  }
</style>
</head>
<body>
<div class="page">

  <!-- Header -->
  <div class="header-bar">
    <div style="display:flex;justify-content:space-between;align-items:flex-start">
      <div>
        <div style="font-size:12px;opacity:.8;margin-bottom:8px;text-transform:uppercase;letter-spacing:.1em">SEO Аудит</div>
        <h1 style="color:#fff">${url}</h1>
        <div style="opacity:.8;margin-top:6px;font-size:14px">${date}</div>
      </div>
      <div style="text-align:center">
        <div style="font-size:12px;opacity:.8;margin-bottom:4px">Общая оценка</div>
        <div class="score-big" style="color:${scoreColor(parseFloat(totalScore))}">${totalScore}</div>
        <div style="opacity:.7;font-size:13px">из 10</div>
      </div>
    </div>
    ${stats.summary ? `<div style="margin-top:20px;padding:14px;background:rgba(255,255,255,.15);border-radius:8px;font-size:14px;line-height:1.6">${stats.summary}</div>` : ''}
  </div>

  <!-- Stats -->
  <div class="stat-grid">
    <div class="stat">
      <div class="stat-value" style="color:#1e293b">${stats.pagesAnalyzed ?? '—'}</div>
      <div class="stat-label">Страниц проверено</div>
    </div>
    <div class="stat">
      <div class="stat-value" style="color:#ef4444">${stats.critical ?? '—'}</div>
      <div class="stat-label">🔴 Критических</div>
    </div>
    <div class="stat">
      <div class="stat-value" style="color:#f59e0b">${stats.warnings ?? '—'}</div>
      <div class="stat-label">🟡 Предупреждений</div>
    </div>
    <div class="stat">
      <div class="stat-value" style="color:#22c55e">${stats.ok ?? '—'}</div>
      <div class="stat-label">🟢 Хорошо</div>
    </div>
  </div>

  <!-- Scores -->
  ${scoresRows ? `
  <div class="card">
    <h2>Оценки по категориям</h2>
    <table>
      <thead><tr><th>Категория</th><th style="text-align:center">Оценка</th><th>Прогресс</th></tr></thead>
      <tbody>${scoresRows}</tbody>
    </table>
  </div>` : ''}

  <!-- Recommendations -->
  ${recList ? `
  <div class="card">
    <h2>Приоритетные рекомендации</h2>
    ${recList}
  </div>` : ''}

  <!-- Issues -->
  ${issuesList ? `
  <div class="card">
    <h2>Найденные проблемы</h2>
    <table>
      <thead><tr><th>Страница</th><th>Тип</th><th>Описание</th></tr></thead>
      <tbody>${issuesList}</tbody>
    </table>
  </div>` : ''}

  <!-- Technical -->
  ${techRows ? `
  <div class="card">
    <h2>Технические проверки</h2>
    <table>
      <thead><tr><th>Проверка</th><th>Статус</th><th>Значение</th></tr></thead>
      <tbody>${techRows}</tbody>
    </table>
  </div>` : ''}

  <div style="text-align:center;color:#94a3b8;font-size:12px;margin-top:32px">
    Сгенерировано Claude Code SEO Audit Skill · ${date}
  </div>

</div>
</body>
</html>`;
}

// ── Main ──────────────────────────────────────────────────────────────────────
const [,, inputFile, outputDir = '.'] = process.argv;

if (!inputFile) {
  console.error('Usage: node generate-report.js <report.json> [output-dir]');
  process.exit(1);
}

const data = JSON.parse(readFileSync(inputFile, 'utf8'));
mkdirSync(outputDir, { recursive: true });

const domain = (data.url || 'unknown').replace(/^https?:\/\//, '').replace(/\/.*/, '').replace(/[^a-z0-9.-]/gi, '_');
const now = new Date();
const datetime = now.toISOString().slice(0, 16).replace('T', '-').replace(':', '');
const baseName = `seo-report-${domain}-${datetime}`;
const htmlPath  = resolve(outputDir, `${baseName}.html`);
const pdfPath   = resolve(outputDir, `${baseName}.pdf`);

// Write HTML
const html = buildHTML(data);
writeFileSync(htmlPath, html, 'utf8');
console.log(`HTML → ${htmlPath}`);

// Convert to PDF via Chrome headless
const chrome = findChrome();
if (chrome) {
  try {
    const cmd = `"${chrome}" --headless=new --disable-gpu --no-sandbox --print-to-pdf="${pdfPath}" --print-to-pdf-no-header "file:///${htmlPath.replace(/\\/g, '/')}"`;
    execSync(cmd, { stdio: 'pipe', timeout: 30_000 });
    console.log(`PDF  → ${pdfPath}`);
  } catch (e) {
    console.error('PDF generation failed:', e.message);
    console.log('HTML report is still available.');
  }
} else {
  console.warn('Chrome not found — PDF skipped. Install Chrome or add it to PATH.');
}
