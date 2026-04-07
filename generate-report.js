#!/usr/bin/env node
/**
 * SEO Audit Report Generator
 * Usage: node generate-report.js <report.json> [output-dir]
 * Generates: report.html + report.pdf (via Chrome headless)
 */

const SKILL_VERSION = '1.4.6';

const { readFileSync, writeFileSync, mkdirSync, existsSync } = require('fs');
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

// ── HTML escape ───────────────────────────────────────────────────────────────
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

function priorityBadge(p) {
  const map = {
    high:   ['#fef2f2', '#b91c1c', '↑ Высокий'],
    medium: ['#fffbeb', '#92400e', '→ Средний'],
    low:    ['#f0fdf4', '#166534', '↓ Низкий'],
  };
  const [bg, color, label] = map[p] ?? map.medium;
  return `<span style="background:${bg};color:${color};padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;border:1px solid ${color}33">${label}</span>`;
}

function difficultyBadge(d) {
  const map = {
    low:    ['#f0fdf4', '#166534', '🔧 Просто'],
    medium: ['#fffbeb', '#92400e', '🔧🔧 Средне'],
    high:   ['#fef2f2', '#991b1b', '🔧🔧🔧 Сложно'],
  };
  const [bg, color, label] = map[d] ?? map.medium;
  return `<span style="background:${bg};color:${color};padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600">${label}</span>`;
}

// ── Screenshot → base64 ───────────────────────────────────────────────────────
function screenshotBase64(filePath) {
  if (!filePath || !existsSync(filePath)) return null;
  try {
    const buf = readFileSync(filePath);
    const mime = /\.(jpe?g)$/i.test(filePath) ? 'jpeg' : 'png';
    return `data:image/${mime};base64,${buf.toString('base64')}`;
  } catch { return null; }
}

// ── HTML template ─────────────────────────────────────────────────────────────
function buildHTML(data) {
  const { url, date, mode, summary, scores, scoreDetails, pages, recommendations, technical, lighthouse, screenshotPaths } = data;

  const totalScore = scores
    ? (Object.values(scores).filter(v => v !== null).reduce((a, b) => a + b, 0) /
       Object.values(scores).filter(v => v !== null).length).toFixed(1)
    : 'N/A';

  const scoresRows = scores ? Object.entries(scores).filter(([,v]) => v !== null).map(([cat, val]) => {
    const details = scoreDetails?.[cat] ?? [];
    const detailsHtml = details.length
      ? `<div style="margin-top:6px;font-size:13px;color:#475569;line-height:1.7">${details.map(d => `<div>${esc(d)}</div>`).join('')}</div>`
      : '';
    return `
    <tr>
      <td style="padding:10px 16px;border-bottom:1px solid #f1f5f9;vertical-align:top">
        <div style="font-weight:500">${cat}</div>${detailsHtml}
      </td>
      <td style="padding:10px 16px;border-bottom:1px solid #f1f5f9;text-align:center;vertical-align:top">
        <span style="font-size:18px;font-weight:700;color:${scoreColor(val)}">${val}</span><span style="color:#94a3b8">/10</span>
      </td>
      <td style="padding:10px 16px;border-bottom:1px solid #f1f5f9;vertical-align:top">
        <div style="background:#e2e8f0;border-radius:99px;height:8px;width:100%;max-width:180px;margin-top:4px">
          <div style="background:${scoreColor(val)};width:${val * 10}%;height:8px;border-radius:99px"></div>
        </div>
      </td>
    </tr>`;
  }).join('') : '';

  const issuesList = (pages ?? []).flatMap(p =>
    (p.issues ?? []).map(i => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#475569;max-width:260px;word-break:break-all">
          <a href="${p.url}" style="color:#3b82f6;text-decoration:none">${p.url.replace(/^https?:\/\/[^/]+/, '') || '/'}</a>
        </td>
        <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9">${severityBadge(i.severity)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:13px">${esc(i.msg)}</td>
      </tr>`)
  ).join('');

  // Group recommendations by priority
  const recs = recommendations ?? [];
  const highRecs  = recs.filter(r => r.priority === 'high');
  const midRecs   = recs.filter(r => r.priority === 'medium');
  const lowRecs   = recs.filter(r => r.priority === 'low' || !r.priority);

  function recCard(r, idx) {
    return `
    <div style="border:1px solid #e2e8f0;border-radius:10px;padding:16px 20px;margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap">
        <div style="min-width:28px;height:28px;background:#1e40af;color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px">${idx}</div>
        <div style="font-weight:700;font-size:15px;flex:1">${esc(r.title)}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          ${r.priority ? priorityBadge(r.priority) : ''}
          ${r.difficulty ? difficultyBadge(r.difficulty) : ''}
        </div>
      </div>
      <div style="color:#475569;font-size:14px;line-height:1.6;margin-bottom:${r.fix ? '10px' : '0'}">${esc(r.description)}</div>
      ${r.fix ? `<div style="background:#f8fafc;border-left:3px solid #3b82f6;padding:8px 12px;border-radius:0 6px 6px 0;font-family:monospace;font-size:12px;color:#1e293b;white-space:pre-wrap;word-break:break-all;overflow-wrap:break-word">${esc(r.fix)}</div>` : ''}
    </div>`;
  }

  function recsSection(title, recsArr, startIdx) {
    if (!recsArr.length) return '';
    return `
    <div style="margin-bottom:20px">
      <div style="font-size:13px;font-weight:700;letter-spacing:.02em;color:#64748b;margin-bottom:12px">${title}</div>
      ${recsArr.map((r, i) => recCard(r, startIdx + i)).join('')}
    </div>`;
  }

  const techRows = (technical ?? []).map(t => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;font-weight:500">${t.check}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9">${severityBadge(t.status)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#475569;word-break:break-word">${esc(t.value ?? '')}</td>
    </tr>`).join('');

  const stats = summary ?? {};
  const modeLabel = mode === 'full' ? '✅ Полный режим (Chrome)' : '⚠️ Базовый режим (без Chrome)';
  const reportVersion = data.skillVersion || SKILL_VERSION;

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SEO Аудит — ${url}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f8fafc; color: #1e293b; }
  .page { max-width: 980px; margin: 0 auto; padding: 40px 24px; }
  .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 28px; margin-bottom: 24px; }
  h1 { font-size: 28px; font-weight: 800; margin-bottom: 4px; }
  h2 { font-size: 18px; font-weight: 700; margin-bottom: 16px; color: #1e293b; }
  .header-bar { background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); color: #fff; border-radius: 12px; padding: 32px; margin-bottom: 24px; }
  .score-big { font-size: 64px; font-weight: 900; line-height: 1; }
  .stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
  .stat { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px; text-align: center; }
  .stat-value { font-size: 28px; font-weight: 800; }
  .stat-label { font-size: 12px; color: #64748b; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; padding: 10px 12px; background: #f8fafc; font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: #64748b; border-bottom: 2px solid #e2e8f0; }
  .mode-badge { display:inline-block; padding:4px 12px; border-radius:6px; font-size:13px; font-weight:600; background:rgba(255,255,255,.2); margin-top:8px; }
  @page { size: A4; margin: 16mm 14mm; @bottom-right { content: "Стр. " counter(page) " / " counter(pages); font-size: 10px; color: #94a3b8; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; } }
  @media print {
    body { background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .page { padding: 0; max-width: 100%; }
    .card { break-inside: avoid; margin-bottom: 16px; }
    .stat-grid { break-inside: avoid; }
    .header-bar { break-inside: avoid; }
    tr { break-inside: avoid; }
  }
</style>
</head>
<body>
<div class="page">

  <!-- Header -->
  <div class="header-bar">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:20px;flex-wrap:wrap">
      <div>
        <div style="font-size:12px;opacity:.8;margin-bottom:8px;text-transform:uppercase;letter-spacing:.1em">SEO Аудит</div>
        <h1 style="color:#fff">${url}</h1>
        <div style="opacity:.8;margin-top:6px;font-size:14px">${date}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
          <div class="mode-badge">${modeLabel}</div>
          <div class="mode-badge" style="background:rgba(255,255,255,.12);font-family:monospace">v${reportVersion}</div>
        </div>
      </div>
      <div style="text-align:center;min-width:100px">
        <div style="font-size:12px;opacity:.8;margin-bottom:4px">Общая оценка</div>
        <div class="score-big" style="color:${scoreColor(parseFloat(totalScore))}">${totalScore}</div>
        <div style="opacity:.7;font-size:13px">из 10</div>
      </div>
    </div>
    ${stats.summary ? `<div style="margin-top:20px;padding:14px;background:rgba(255,255,255,.15);border-radius:8px;font-size:14px;line-height:1.6">${esc(stats.summary)}</div>` : ''}
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

  <!-- Lighthouse -->
  ${lighthouse ? (() => {
    if (!lighthouse.available) return '';
    const lhScoreColor = s => s >= 90 ? '#22c55e' : s >= 50 ? '#f59e0b' : '#ef4444';
    const cats = [
      { label: 'Performance', val: lighthouse.performance },
      { label: 'SEO', val: lighthouse.seo },
      { label: 'Accessibility', val: lighthouse.accessibility },
      { label: 'Best Practices', val: lighthouse.bestPractices },
    ].filter(c => c.val != null);
    const metrics = lighthouse.metrics ?? {};
    return `
  <div class="card">
    <h2>Lighthouse</h2>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:${Object.keys(metrics).length ? '20px' : '0'}">
      ${cats.map(c => `
      <div style="border:1px solid #e2e8f0;border-radius:10px;padding:14px;text-align:center">
        <div style="font-size:32px;font-weight:800;color:${lhScoreColor(c.val)}">${c.val}</div>
        <div style="font-size:12px;color:#64748b;margin-top:4px">${c.label}</div>
      </div>`).join('')}
    </div>
    ${Object.keys(metrics).length ? `
    <div style="border-top:1px solid #f1f5f9;padding-top:16px;display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px">
      ${Object.entries(metrics).map(([k, v]) => `
      <div style="background:#f8fafc;border-radius:8px;padding:10px;text-align:center">
        <div style="font-size:15px;font-weight:700;color:#1e293b">${esc(String(v))}</div>
        <div style="font-size:11px;color:#94a3b8;margin-top:2px">${k}</div>
      </div>`).join('')}
    </div>` : ''}
  </div>`;
  })() : ''}

  <!-- Recommendations grouped by priority -->
  ${recs.length ? `
  <div class="card">
    <h2>Рекомендации</h2>
    <div style="font-size:13px;color:#64748b;margin-bottom:20px">
      Для каждой рекомендации указаны: приоритет (влияние на ранжирование) и сложность внедрения.
    </div>
    ${recsSection('🔴 Высокий приоритет — внедрить в первую очередь', highRecs, 1)}
    ${recsSection('🟡 Средний приоритет', midRecs, highRecs.length + 1)}
    ${recsSection('🟢 Низкий приоритет', lowRecs, highRecs.length + midRecs.length + 1)}
  </div>` : ''}

  <!-- Issues by page -->
  ${issuesList ? `
  <div class="card">
    <h2>Проблемы по страницам</h2>
    <table>
      <thead><tr><th>Страница</th><th>Тип</th><th>Описание</th></tr></thead>
      <tbody>${issuesList}</tbody>
    </table>
  </div>` : ''}

  <!-- Technical checks -->
  ${techRows ? `
  <div class="card">
    <h2>Технические проверки</h2>
    <table>
      <thead><tr><th>Проверка</th><th>Статус</th><th>Значение</th></tr></thead>
      <tbody>${techRows}</tbody>
    </table>
  </div>` : ''}

  <!-- Screenshots -->
  ${(() => {
    const desktopSrc = screenshotBase64(screenshotPaths?.desktop);
    const mobileSrc  = screenshotBase64(screenshotPaths?.mobile);
    if (!desktopSrc && !mobileSrc) return '';
    return `
  <div class="card">
    <h2>Скриншоты сайта</h2>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start">
      ${desktopSrc ? `<div>
        <div style="font-size:12px;font-weight:600;color:#64748b;margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em">Десктоп</div>
        <img src="${desktopSrc}" style="width:100%;border:1px solid #e2e8f0;border-radius:8px" alt="Desktop screenshot">
      </div>` : ''}
      ${mobileSrc ? `<div>
        <div style="font-size:12px;font-weight:600;color:#64748b;margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em">Мобильный</div>
        <img src="${mobileSrc}" style="width:100%;border:1px solid #e2e8f0;border-radius:8px" alt="Mobile screenshot">
      </div>` : ''}
    </div>
  </div>`;
  })()}

  <!-- Top-5 ROI actions -->
  ${(() => {
    const recs = recommendations ?? [];
    const top5 = recs
      .filter(r => r.priority === 'high' && r.difficulty !== 'high')
      .slice(0, 3)
      .concat(recs.filter(r => r.priority === 'high' && r.difficulty === 'high').slice(0, 2))
      .concat(recs.filter(r => r.priority !== 'high').slice(0, 2))
      .slice(0, 5);
    if (!top5.length) return '';
    const roiItems = top5.map((r, i) => `
      <div style="display:flex;gap:14px;padding:12px 0;border-bottom:1px solid #f1f5f9">
        <div style="min-width:32px;height:32px;background:linear-gradient(135deg,#1e40af,#3b82f6);color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px;flex-shrink:0">${i + 1}</div>
        <div>
          <div style="font-weight:700;font-size:14px;margin-bottom:4px">${esc(r.title)}</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            ${r.priority ? priorityBadge(r.priority) : ''}
            ${r.difficulty ? difficultyBadge(r.difficulty) : ''}
          </div>
        </div>
      </div>`).join('');
    return `
  <div class="card" style="border-color:#1e40af;border-width:2px">
    <h2 style="color:#1e40af">Топ-5 действий с максимальным ROI</h2>
    <div style="font-size:13px;color:#64748b;margin-bottom:12px">Исправьте эти пункты в первую очередь — они дадут максимальный результат при минимальных затратах.</div>
    ${roiItems}
  </div>`;
  })()}

  <div style="text-align:center;color:#94a3b8;font-size:12px;margin-top:32px">
    SEO Audit от Nedzelsky.pro · ${esc(url)} · ${esc(date)} · <span style="font-family:monospace">v${reportVersion}</span>
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
// Use date from report data ("YYYY-MM-DD HH:MM") so filename matches MD/screenshots from the same run
// Result: "YYYY-MM-DD-HHMM", e.g. "2026-04-07-1343"
const datetime = (data.date || new Date().toISOString().slice(0, 16))
  .replace(' ', '-')   // "2026-04-07 13:43" → "2026-04-07-13:43"
  .replace(':', '');   // → "2026-04-07-1343"
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
    const pdfFwd  = pdfPath.replace(/\\/g, '/');
    const htmlFwd = htmlPath.replace(/\\/g, '/');
    const cmd = `"${chrome}" --headless=new --disable-gpu --no-sandbox --print-to-pdf="${pdfFwd}" --print-to-pdf-no-header "file:///${htmlFwd}"`;
    execSync(cmd, { stdio: 'pipe', timeout: 30_000 });
    // Chrome may flush async — wait up to 5s for file to appear
    const deadline = Date.now() + 5000;
    while (!existsSync(pdfPath) && Date.now() < deadline) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
    }
    if (existsSync(pdfPath)) {
      console.log(`PDF  → ${pdfPath}`);
    } else {
      console.warn('PDF not found after Chrome completed — check Chrome permissions or disk space.');
    }
  } catch (e) {
    console.error('PDF generation failed:', e.message);
    console.log('HTML report is still available.');
  }
} else {
  console.warn('Chrome not found — PDF skipped. Install Chrome or add it to PATH.');
}
