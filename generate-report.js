#!/usr/bin/env node
/**
 * SEO Audit Report Generator
 * Usage: node generate-report.js <report.json> [output-dir]
 * Generates: report.html + report.pdf (via Chrome headless)
 */

const SKILL_VERSION = '1.9.2';

const { readFileSync, writeFileSync, mkdirSync, existsSync } = require('fs');
const { execSync } = require('child_process');
const { resolve } = require('path');

// ── Chrome paths ──────────────────────────────────────────────────────────────
// ⚠️ Используется только Chrome (не Edge или другие браузеры).
// Известное ограничение Windows: когда Claude Chrome Extension активен,
// chrome.exe headless может молча падать. PDF тогда не генерируется —
// HTML открывается в браузере и печатается через Ctrl+P → Save as PDF.
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

function gradeColor(grade) {
  const map = { A: '#16a34a', B: '#22c55e', C: '#f59e0b', D: '#ea580c', F: '#dc2626' };
  return map[grade] || '#64748b';
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
    high:   ['#fef2f2', '#b91c1c', 'Высокий приоритет'],
    medium: ['#fffbeb', '#92400e', 'Средний приоритет'],
    low:    ['#f0fdf4', '#166534', 'Низкий приоритет'],
  };
  const [bg, color, label] = map[p] ?? map.medium;
  return `<span style="background:${bg};color:${color};padding:3px 9px;border-radius:5px;font-size:11px;font-weight:700;border:1px solid ${color}33">${label}</span>`;
}

function difficultyBadge(d) {
  const map = {
    low:    ['#f0fdf4', '#166534', 'Просто'],
    medium: ['#fffbeb', '#92400e', 'Средне'],
    high:   ['#fef2f2', '#991b1b', 'Сложно'],
  };
  const [bg, color, label] = map[d] ?? map.medium;
  return `<span style="background:${bg};color:${color};padding:3px 9px;border-radius:5px;font-size:11px;font-weight:700">Сложность: ${label}</span>`;
}

function effortBadge(hours) {
  if (!hours) return '';
  return `<span style="background:#f1f5f9;color:#475569;padding:3px 9px;border-radius:5px;font-size:11px;font-weight:700">⏱ ${esc(hours)}</span>`;
}

function categoryBadge(category, label) {
  if (!category && !label) return '';
  const text = label || `Блок ${category}`;
  return `<span style="background:#eff6ff;color:#1e40af;padding:3px 9px;border-radius:5px;font-size:11px;font-weight:600">${esc(text)}</span>`;
}

// ── Screenshot → base64 ───────────────────────────────────────────────────────
function screenshotBase64(filePath) {
  if (!filePath || !existsSync(filePath)) return null;
  try {
    const buf = readFileSync(filePath);
    const mime = /\.(jpe?g)$/i.test(filePath) ? 'jpeg'
               : /\.webp$/i.test(filePath) ? 'webp'
               : 'png';
    return `data:image/${mime};base64,${buf.toString('base64')}`;
  } catch { return null; }
}

// ── Master checklist block names ──────────────────────────────────────────────
const BLOCK_NAMES = {
  '1': 'Краулинг и индексирование',
  '2': 'Технические HTTP / Сервер',
  '3': 'Скорость и Core Web Vitals',
  '4': 'Мобильная оптимизация',
  '5': 'Мета-теги и On-Page',
  '6': 'Структурированные данные (Schema.org)',
  '7': 'Open Graph / Social',
  '8': 'E-E-A-T',
  '9': 'Внутренняя перелинковка',
  '10': 'Аналитика и верификация',
  '11': 'JS-рендеринг',
  '12': 'Скрытый контент и чёрные техники',
  '13': 'Контент и UX',
  '14': 'Off-Page / Ссылочный профиль',
  '15': 'Локальное SEO',
  '16': 'Международное SEO',
  '17': 'AEO / GEO / AI-поиск',
  '18': 'Краулинговый бюджет',
  '19': 'Мониторинг',
  '20': 'Доступность (WCAG)',
  '21': 'HTML-структура',
};

// ── Lighthouse metric tooltips ────────────────────────────────────────────────
const LH_METRIC_DESC = {
  FCP: 'First Contentful Paint — когда появился первый видимый элемент. Норма < 1.8s',
  LCP: 'Largest Contentful Paint — когда появился главный элемент страницы. Норма ≤ 2.5s',
  TBT: 'Total Blocking Time — суммарное время блокировки главного потока. Норма < 200ms',
  CLS: 'Cumulative Layout Shift — стабильность вёрстки при загрузке. Норма ≤ 0.1',
  SI:  'Speed Index — скорость визуального заполнения страницы. Норма < 3.4s',
  TTI: 'Time to Interactive — когда страница стала интерактивной. Норма < 3.8s',
  INP: 'Interaction to Next Paint — задержка отклика на действие пользователя. Норма ≤ 200ms',
};

// ── HTML template ─────────────────────────────────────────────────────────────
function buildHTML(data) {
  const { url, date, mode, summary, scores, scoreDetails, pages, recommendations, technical, lighthouse, screenshotPaths,
          executiveSummary, strengths, risks, coverage, notChecked, siteData, cmsInfo } = data;

  const recs = recommendations ?? [];
  const totalScore = scores
    ? (Object.values(scores).filter(v => v !== null).reduce((a, b) => a + b, 0) /
       Object.values(scores).filter(v => v !== null).length).toFixed(1)
    : 'N/A';

  const stats = summary ?? {};
  const reportVersion = data.skillVersion || SKILL_VERSION;
  const grade = executiveSummary?.grade || (parseFloat(totalScore) >= 9 ? 'A' : parseFloat(totalScore) >= 7.5 ? 'B' : parseFloat(totalScore) >= 6 ? 'C' : parseFloat(totalScore) >= 4 ? 'D' : 'F');

  // Phase grouping for Roadmap (auto-fallback if phase missing)
  const computePhase = r => {
    if (r.phase) return r.phase;
    if (r.priority === 'high' && r.difficulty === 'low') return 'urgent';
    if (r.priority === 'high') return 'month';
    if (r.priority === 'medium') return 'month';
    return 'strategy';
  };
  const sortPhase = arr => arr.sort((a,b) => {
    const pri = { high: 0, medium: 1, low: 2 };
    const dif = { low: 0, medium: 1, high: 2 };
    return (pri[a.priority]||3) - (pri[b.priority]||3) || (dif[a.difficulty]||3) - (dif[b.difficulty]||3);
  });
  const urgentRecs   = sortPhase(recs.filter(r => computePhase(r) === 'urgent'));
  const monthRecs    = sortPhase(recs.filter(r => computePhase(r) === 'month'));
  const strategyRecs = sortPhase(recs.filter(r => computePhase(r) === 'strategy'));

  // Number recommendations across phases (1, 2, 3...)
  const numbered = [...urgentRecs, ...monthRecs, ...strategyRecs].map((r, i) => ({ ...r, _num: i + 1 }));
  const numberOf = r => numbered.find(n => n.title === r.title)?._num ?? '?';

  // ── Section: Cover page ─────────────────────────────────────────────────────
  const coverHtml = `
  <section class="cover">
    <div class="cover-content">
      <div class="cover-brand">SEO Audit</div>
      <div class="cover-domain">${esc(url.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</div>
      <div class="cover-date">${esc(date)}</div>
      <div class="cover-grade-wrap">
        <div class="cover-grade-label">Общая оценка</div>
        <div class="cover-grade" style="color:${gradeColor(grade)}">${grade}</div>
        <div class="cover-grade-score">${totalScore} / 10</div>
      </div>
      ${executiveSummary?.onePhrase ? `<div class="cover-phrase">«${esc(executiveSummary.onePhrase)}»</div>` : ''}
    </div>
    <div class="cover-footer">
      <div class="cover-footer-brands">
        <a href="https://itsoft.ru">itsoft.ru</a> ·
        <a href="https://pharm-studio.ru">pharm-studio.ru</a> ·
        <a href="https://nedzelsky.pro">nedzelsky.pro</a>
      </div>
      <div class="cover-footer-version">v${reportVersion}</div>
    </div>
  </section>`;

  // ── Section: How to read ────────────────────────────────────────────────────
  const howToReadHtml = `
  <div class="card how-to-read" id="how-to-read">
    <h2>Как читать этот отчёт</h2>
    <p style="color:#475569;margin-bottom:14px;font-size:14px;line-height:1.6">
      Отчёт построен на синтезе 40+ источников и мастер-чеклисте из 374 пунктов в 21 блоке. Каждая рекомендация автоматически приоритизирована по влиянию на SEO и сложности внедрения.
    </p>
    <div class="legend-grid">
      <div class="legend-card">
        <div class="legend-title">Приоритет</div>
        <div class="legend-rows">
          <div>${priorityBadge('high')} — критично для индексации/доверия</div>
          <div>${priorityBadge('medium')} — заметное влияние на ранжирование</div>
          <div>${priorityBadge('low')} — улучшение, желательно</div>
        </div>
      </div>
      <div class="legend-card">
        <div class="legend-title">Сложность внедрения</div>
        <div class="legend-rows">
          <div>${difficultyBadge('low')} — 1–2 часа, правка одного файла</div>
          <div>${difficultyBadge('medium')} — 4–8 часов, несколько файлов</div>
          <div>${difficultyBadge('high')} — 1–3 дня, структурные изменения</div>
        </div>
      </div>
      <div class="legend-card">
        <div class="legend-title">План действий</div>
        <div class="legend-rows" style="font-size:13px;color:#475569">
          <div><strong>Срочно</strong> — внедрить за 1–2 недели</div>
          <div><strong>В этот месяц</strong> — основная работа</div>
          <div><strong>Стратегия</strong> — развитие 1–3 месяца</div>
        </div>
      </div>
    </div>
  </div>`;

  // ── Section: Executive Summary ──────────────────────────────────────────────
  const execSummaryHtml = `
  <div class="card exec-summary" id="exec-summary">
    <div class="exec-grid">
      <div class="exec-grade-block">
        <div class="exec-grade-label">Оценка</div>
        <div class="exec-grade" style="color:${gradeColor(grade)}">${grade}</div>
        <div class="exec-score-num"><span style="font-size:20px;font-weight:800;color:${scoreColor(parseFloat(totalScore))}">${totalScore}</span><span style="color:#94a3b8">/10</span></div>
      </div>
      <div class="exec-headline-block">
        <h2 style="margin-bottom:8px">Главное</h2>
        <p style="font-size:15px;line-height:1.6;color:#1e293b">${esc(executiveSummary?.headline || stats.summary || '')}</p>
        ${cmsInfo ? `<div class="exec-meta">CMS / сервер: <strong>${esc(cmsInfo)}</strong></div>` : ''}
      </div>
    </div>
    <div class="strengths-risks">
      ${(strengths && strengths.length) ? `
      <div class="sr-block sr-strengths">
        <div class="sr-title">✅ Что работает</div>
        <ul>${strengths.map(s => `<li>${esc(s)}</li>`).join('')}</ul>
      </div>` : ''}
      ${(risks && risks.length) ? `
      <div class="sr-block sr-risks">
        <div class="sr-title">🔴 Главные риски</div>
        <ul>${risks.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
      </div>` : ''}
    </div>
  </div>`;

  // ── Section: Stats grid + coverage ──────────────────────────────────────────
  const coverageInfo = coverage
    ? `Автоматически: ${coverage.automatedCount || coverage.blocksCovered?.length || 0} блоков · Ручная работа: ${coverage.manualCount || coverage.blocksManual?.length || 0} блоков`
    : '';
  const statsHtml = `
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
  ${coverageInfo ? `<div class="coverage-line">${coverageInfo}</div>` : ''}`;

  // ── Section: Scores table ───────────────────────────────────────────────────
  const scoresRows = scores ? Object.entries(scores).filter(([,v]) => v !== null).map(([cat, val]) => {
    const details = scoreDetails?.[cat] ?? [];
    const detailsHtml = details.length
      ? `<div style="margin-top:6px;font-size:13px;color:#475569;line-height:1.7">${details.map(d => `<div>${esc(d)}</div>`).join('')}</div>`
      : '';
    return `
    <tr>
      <td style="padding:10px 16px;border-bottom:1px solid #f1f5f9;vertical-align:top">
        <div style="font-weight:500">${esc(cat)}</div>${detailsHtml}
      </td>
      <td style="padding:10px 16px;border-bottom:1px solid #f1f5f9;text-align:center;vertical-align:top">
        <span style="font-size:18px;font-weight:700;color:${scoreColor(val)}">${val}</span><span style="color:#94a3b8">/10</span>
      </td>
      <td style="padding:10px 16px;border-bottom:1px solid #f1f5f9;vertical-align:top">
        <div style="background:#e2e8f0;border-radius:99px;height:8px;width:100%;max-width:180px;margin-top:8px">
          <div style="background:${scoreColor(val)};width:${val * 10}%;height:8px;border-radius:99px"></div>
        </div>
      </td>
    </tr>`;
  }).join('') : '';
  const scoresHtml = scoresRows ? `
  <div class="card" id="scores">
    <h2>Оценки по 10 категориям</h2>
    <table>
      <thead><tr><th>Категория</th><th style="text-align:center">Оценка</th><th>Прогресс</th></tr></thead>
      <tbody>${scoresRows}</tbody>
    </table>
  </div>` : '';

  // ── Section: Lighthouse ─────────────────────────────────────────────────────
  const lhHtml = (lighthouse && lighthouse.available) ? (() => {
    const lhScoreColor = s => s >= 90 ? '#22c55e' : s >= 50 ? '#f59e0b' : '#ef4444';
    const cats = [
      { label: 'Performance', val: lighthouse.performance },
      { label: 'SEO', val: lighthouse.seo },
      { label: 'Accessibility', val: lighthouse.accessibility },
      { label: 'Best Practices', val: lighthouse.bestPractices },
    ].filter(c => c.val != null);
    const metrics = lighthouse.metrics ?? {};
    const blocking = lighthouse.blockingScripts ?? [];
    const imgOpts  = lighthouse.imgOptimizations ?? [];
    const bfFails  = lighthouse.bfcacheFailures ?? [];
    return `
    <div class="card" id="lighthouse">
      <h2>Lighthouse — производительность и качество</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:20px">
        ${cats.map(c => `
        <div style="border:1px solid #e2e8f0;border-radius:10px;padding:14px;text-align:center">
          <div style="font-size:32px;font-weight:800;color:${lhScoreColor(c.val)}">${c.val}</div>
          <div style="font-size:12px;color:#64748b;margin-top:4px">${c.label}</div>
        </div>`).join('')}
      </div>
      ${Object.keys(metrics).length ? `
      <h3 style="font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#64748b;margin-bottom:10px">Core Web Vitals и метрики</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;margin-bottom:16px">
        ${Object.entries(metrics).map(([k, v]) => `
        <div style="background:#f8fafc;border-radius:8px;padding:10px">
          <div style="font-size:15px;font-weight:700;color:#1e293b">${esc(String(v))}</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:2px;font-weight:600">${k}</div>
          ${LH_METRIC_DESC[k] ? `<div style="font-size:10px;color:#94a3b8;margin-top:4px;line-height:1.4">${LH_METRIC_DESC[k]}</div>` : ''}
        </div>`).join('')}
      </div>` : ''}
      ${blocking.length ? `
      <h3 style="font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#64748b;margin:16px 0 8px">Блокирующие скрипты</h3>
      <div style="font-size:12px;color:#475569">
        ${blocking.map(b => `<div style="padding:6px 0;border-bottom:1px solid #f1f5f9"><code style="background:#f8fafc;padding:2px 6px;border-radius:3px">${esc(b.url)}</code> ${b.duration ? `<span style="color:#dc2626;font-weight:600">— ${esc(b.duration)}</span>` : ''}</div>`).join('')}
      </div>` : ''}
      ${imgOpts.length ? `
      <h3 style="font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#64748b;margin:16px 0 8px">Возможности оптимизации изображений</h3>
      <div style="font-size:12px;color:#475569">
        ${imgOpts.map(i => `<div style="padding:6px 0;border-bottom:1px solid #f1f5f9"><code style="background:#f8fafc;padding:2px 6px;border-radius:3px">${esc(i.url)}</code> ${i.savings ? `<span style="color:#dc2626;font-weight:600">— экономия ${esc(i.savings)}</span>` : ''}</div>`).join('')}
      </div>` : ''}
      ${bfFails.length ? `
      <h3 style="font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#64748b;margin:16px 0 8px">BFCache не работает</h3>
      <div style="font-size:12px;color:#475569">${bfFails.map(f => `<div>• ${esc(f)}</div>`).join('')}</div>` : ''}
    </div>`;
  })() : '';

  // ── Section: Roadmap (3 phases) ─────────────────────────────────────────────
  function phaseColumn(title, label, recsArr, color, deadline) {
    if (!recsArr.length) return '';
    return `
    <div class="phase-col" style="border-top-color:${color}">
      <div class="phase-header">
        <div class="phase-label" style="color:${color}">${label}</div>
        <div class="phase-title">${title}</div>
        <div class="phase-meta">${recsArr.length} ${recsArr.length === 1 ? 'задача' : recsArr.length < 5 ? 'задачи' : 'задач'}${deadline ? ` · ${deadline}` : ''}</div>
      </div>
      <ol class="phase-list">
        ${recsArr.map(r => `<li><a href="#rec-${numberOf(r)}">${esc(r.title)}</a></li>`).join('')}
      </ol>
    </div>`;
  }
  const roadmapHtml = recs.length ? `
  <div class="card roadmap" id="roadmap">
    <h2>План действий</h2>
    <p style="color:#475569;font-size:14px;margin-bottom:20px">Рекомендации сгруппированы в три фазы по приоритету и сложности. Внутри каждой фазы — упорядочены по ROI.</p>
    <div class="phase-grid">
      ${phaseColumn('Срочно', '🔴 Срочно', urgentRecs, '#dc2626', '1–2 недели')}
      ${phaseColumn('В этот месяц', '🟡 В этот месяц', monthRecs, '#ea580c', 'до 30 дней')}
      ${phaseColumn('Стратегия', '🟢 Стратегия', strategyRecs, '#16a34a', '1–3 месяца')}
    </div>
  </div>` : '';

  // ── Section: Recommendation cards (full detail) ─────────────────────────────
  function recCard(r) {
    const num = r._num;
    const stepsHtml = (r.steps && r.steps.length) ? `
      <div class="rec-section">
        <div class="rec-section-title">Шаги внедрения</div>
        <ol class="rec-steps">${r.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>
      </div>` : '';
    const fixHtml = r.fix ? `
      <div class="rec-section">
        <div class="rec-section-title">Готовый код</div>
        <pre class="rec-code">${esc(r.fix)}</pre>
      </div>` : '';
    const verifyHtml = r.verify ? `
      <div class="rec-section">
        <div class="rec-section-title">Как проверить что исправлено</div>
        <div class="rec-verify">${esc(r.verify)}</div>
      </div>` : '';
    const affectedHtml = (r.affectedUrls && r.affectedUrls.length) ? `
      <div class="rec-section">
        <div class="rec-section-title">Затронутые страницы (${r.affectedUrls.length})</div>
        <div class="rec-urls">${r.affectedUrls.slice(0, 8).map(u => `<a href="${esc(u)}">${esc(u.replace(/^https?:\/\/[^/]+/, '') || '/')}</a>`).join(' · ')}${r.affectedUrls.length > 8 ? ` <span style="color:#94a3b8">+${r.affectedUrls.length - 8} ещё</span>` : ''}</div>
      </div>` : '';

    return `
    <div class="rec-card" id="rec-${num}">
      <div class="rec-header">
        <div class="rec-num">${num}</div>
        <div class="rec-title-block">
          <div class="rec-title">${esc(r.title)}</div>
          <div class="rec-badges">
            ${r.priority ? priorityBadge(r.priority) : ''}
            ${r.difficulty ? difficultyBadge(r.difficulty) : ''}
            ${effortBadge(r.effortHours)}
            ${categoryBadge(r.category, r.categoryLabel)}
          </div>
        </div>
      </div>
      <div class="rec-body">
        ${r.description ? `<div class="rec-section"><div class="rec-section-title">Проблема</div><div class="rec-text">${esc(r.description)}</div></div>` : ''}
        ${r.impact ? `<div class="rec-section"><div class="rec-section-title">Почему это важно</div><div class="rec-text rec-impact">${esc(r.impact)}</div></div>` : ''}
        ${stepsHtml}
        ${fixHtml}
        ${verifyHtml}
        ${affectedHtml}
      </div>
    </div>`;
  }

  function recsPhaseSection(phaseTitle, color, recsArr) {
    if (!recsArr.length) return '';
    return `
    <div class="recs-phase">
      <div class="recs-phase-header" style="border-left-color:${color}">
        <div class="recs-phase-title" style="color:${color}">${phaseTitle}</div>
        <div class="recs-phase-count">${recsArr.length} ${recsArr.length === 1 ? 'рекомендация' : 'рекомендаций'}</div>
      </div>
      ${recsArr.map(r => recCard(r)).join('')}
    </div>`;
  }

  const numberedUrgent   = numbered.filter(r => computePhase(r) === 'urgent');
  const numberedMonth    = numbered.filter(r => computePhase(r) === 'month');
  const numberedStrategy = numbered.filter(r => computePhase(r) === 'strategy');

  // Pre-compute screenshot data URIs (used in TOC visibility check + Screenshots section)
  const desktopSrc = screenshotBase64(screenshotPaths?.desktop);
  const mobileSrc  = screenshotBase64(screenshotPaths?.mobile);

  // ── Section: TOC (table of contents) ────────────────────────────────────────
  const tocHtml = `
  <div class="card toc">
    <h2>Содержание</h2>
    <ol class="toc-list">
      <li><a href="#how-to-read">Как читать этот отчёт</a></li>
      <li><a href="#exec-summary">Главное · оценка ${grade}</a></li>
      <li><a href="#scores">Оценки по 10 категориям</a></li>
      ${(lighthouse && lighthouse.available) ? `<li><a href="#lighthouse">Lighthouse — производительность</a></li>` : ''}
      ${recs.length ? `<li><a href="#roadmap">План действий — ${urgentRecs.length + monthRecs.length + strategyRecs.length} задач в 3 фазах</a></li>` : ''}
      ${recs.length ? `<li><a href="#recs">Детализация ${recs.length} рекомендаций</a></li>` : ''}
      ${(pages && pages.length) ? `<li><a href="#pages">Анализ ${pages.length} ${pages.length === 1 ? 'типа страниц' : pages.length < 5 ? 'типов страниц' : 'типов страниц'}</a></li>` : ''}
      ${(technical && technical.length) ? `<li><a href="#technical">Технические проверки по блокам</a></li>` : ''}
      ${(desktopSrc || mobileSrc) ? `<li><a href="#screenshots">Скриншоты сайта</a></li>` : ''}
      ${(notChecked && notChecked.length) ? `<li><a href="#not-checked">Что не проверялось</a></li>` : ''}
      <li><a href="#methodology">Методология</a></li>
    </ol>
  </div>`;

  const recsHtml = recs.length ? `
  <div class="card" id="recs">
    <h2>Детализация рекомендаций</h2>
    <p style="color:#475569;font-size:14px;margin-bottom:20px">Каждая рекомендация содержит проблему, бизнес-эффект, пошаговый план, готовый код и способ проверки.</p>
    ${recsPhaseSection('🔴 Срочно — 1–2 недели', '#dc2626', numberedUrgent)}
    ${recsPhaseSection('🟡 В этот месяц', '#ea580c', numberedMonth)}
    ${recsPhaseSection('🟢 Стратегия — 1–3 месяца', '#16a34a', numberedStrategy)}
  </div>` : '';

  // ── Section: Pages audit (templates) ────────────────────────────────────────
  const templateLabels = {
    home: 'Главная', category: 'Категория', service: 'Услуга', article: 'Статья',
    contacts: 'Контакты', faq: 'FAQ', other: 'Прочее'
  };
  function pageCard(p) {
    const m = p.metrics || {};
    const issues = (p.issues || []).filter(i => i.severity !== 'ok');
    const tplLabel = templateLabels[p.template] || p.template || 'Страница';
    const pt = p.pageType || {};
    const metricRow = (label, value, ok) => `
      <div class="page-metric ${ok === false ? 'bad' : ok === true ? 'good' : ''}">
        <span class="page-metric-label">${label}</span>
        <span class="page-metric-value">${esc(String(value ?? '—'))}</span>
      </div>`;
    return `
    <div class="page-card">
      <div class="page-card-header">
        <div class="page-tpl">${esc(tplLabel)}</div>
        <a href="${esc(p.url)}" class="page-url">${esc(p.url.replace(/^https?:\/\/[^/]+/, '') || '/')}</a>
      </div>
      ${pt.pattern ? `
      <div class="page-type-info">
        <span class="page-type-pattern">Pattern: <code>${esc(pt.pattern)}</code></span>
        ${pt.matchedCount ? `<span class="page-type-count">${pt.matchedCount} ${pt.matchedCount === 1 ? 'страница этого типа' : pt.matchedCount < 5 ? 'страницы этого типа' : 'страниц этого типа'}</span>` : ''}
      </div>` : ''}
      <div class="page-metrics">
        ${metricRow('Title', m.titleLen ? `${m.titleLen} симв.` : null, m.titleLen >= 30 && m.titleLen <= 60)}
        ${metricRow('Description', m.metaDescLen ? `${m.metaDescLen} симв.` : null, m.metaDescLen >= 70 && m.metaDescLen <= 160)}
        ${metricRow('H1', m.h1 ? '✓' : 'нет', !!m.h1)}
        ${metricRow('Canonical', m.canonical ? '✓' : 'нет', !!m.canonical)}
        ${metricRow('Schema.org', (m.schemaTypes && m.schemaTypes.length) ? m.schemaTypes.join(', ') : 'нет', !!(m.schemaTypes && m.schemaTypes.length))}
        ${metricRow('Open Graph', m.hasOpenGraph ? '✓' : 'нет', !!m.hasOpenGraph)}
        ${metricRow('Хлебные крошки', m.hasBreadcrumbs ? '✓' : 'нет', !!m.hasBreadcrumbs)}
        ${m.imgsTotal != null ? metricRow('Изображения', `${m.imgsTotal} (без alt: ${m.imgsNoAlt || 0}, битых: ${m.imgsBroken || 0})`, (m.imgsNoAlt || 0) === 0 && (m.imgsBroken || 0) === 0) : ''}
      </div>
      ${issues.length ? `
      <div class="page-issues">
        <div class="page-issues-title">Проблемы (${issues.length})</div>
        ${issues.slice(0, 6).map(i => `<div class="page-issue">${severityBadge(i.severity)} <span>${esc(i.msg)}</span></div>`).join('')}
        ${issues.length > 6 ? `<div style="color:#94a3b8;font-size:12px;margin-top:6px">+${issues.length - 6} ещё</div>` : ''}
      </div>` : ''}
    </div>`;
  }
  const pts = data.pageTypeStats;
  const pagesHtml = (pages && pages.length) ? `
  <div class="card" id="pages">
    <h2>Анализ уникальных типов страниц</h2>
    <p style="color:#475569;font-size:14px;margin-bottom:16px">
      Проанализировано <strong>${pages.length}</strong> ${pages.length === 1 ? 'тип' : pages.length < 5 ? 'типа' : 'типов'} страниц${pts && pts.totalUrls ? ` из <strong>${pts.totalUrls}</strong> URL в sitemap` : ''}${pts && pts.totalTypes ? ` (всего уникальных типов: <strong>${pts.totalTypes}</strong>)` : ''}.
      ${pts && pts.skippedTypes > 0 ? `<br><span style="color:#92400e">⚠ Пропущено ${pts.skippedTypes} ${pts.skippedTypes === 1 ? 'тип' : 'типов'} (лимит 20 на один аудит).</span>` : ''}
    </p>
    <div class="pages-grid">${pages.map(p => pageCard(p)).join('')}</div>
  </div>` : '';

  // ── Section: Technical checks grouped by master checklist block ─────────────
  const techByBlock = {};
  (technical || []).forEach(t => {
    const blockId = (t.block || '').split('.')[0] || '?';
    if (!techByBlock[blockId]) techByBlock[blockId] = [];
    techByBlock[blockId].push(t);
  });
  const techBlockOrder = Object.keys(techByBlock).sort((a,b) => {
    const na = parseInt(a) || 99, nb = parseInt(b) || 99;
    return na - nb;
  });
  const techHtml = techBlockOrder.length ? `
  <div class="card" id="technical">
    <h2>Технические проверки по блокам мастер-чеклиста</h2>
    <p style="color:#475569;font-size:14px;margin-bottom:16px">Проверки сгруппированы по разделам мастер-чеклиста (374 пункта в 21 блоке).</p>
    ${techBlockOrder.map(b => `
    <div class="tech-block">
      <h3 class="tech-block-title">Блок ${b} · ${BLOCK_NAMES[b] || ''}</h3>
      <table>
        <tbody>
          ${techByBlock[b].map(t => `
          <tr>
            <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;font-weight:500;width:35%">${esc(t.check)}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;width:120px">${severityBadge(t.status)}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#475569;word-break:break-word">${esc(t.value ?? '')}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`).join('')}
  </div>` : '';

  // ── Section: Screenshots ────────────────────────────────────────────────────
  // desktopSrc / mobileSrc предвычислены в начале buildHTML
  const screenshotsHtml = (desktopSrc || mobileSrc) ? `
  <div class="card" id="screenshots">
    <h2>Скриншоты сайта</h2>
    <p style="color:#64748b;font-size:12px;margin-bottom:14px">Показана верхняя часть страницы (above-the-fold). Полные скриншоты — в отдельных файлах рядом с отчётом.</p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start">
      ${desktopSrc ? `<div>
        <div class="screenshot-label">Десктоп · 1350×940 (Lighthouse desktop preset)</div>
        <div class="screenshot-frame"><img src="${desktopSrc}" alt="Desktop screenshot"></div>
      </div>` : ''}
      ${mobileSrc ? `<div>
        <div class="screenshot-label">Мобильный · 412×823 (Lighthouse mobile)</div>
        <div class="screenshot-frame"><img src="${mobileSrc}" alt="Mobile screenshot"></div>
      </div>` : ''}
    </div>
  </div>` : '';

  // ── Section: Not checked / scope disclosure ─────────────────────────────────
  const notCheckedHtml = (notChecked && notChecked.length) ? `
  <div class="card not-checked" id="not-checked">
    <h2>Что не проверялось автоматически</h2>
    <p style="color:#475569;font-size:14px;margin-bottom:14px">
      Часть проверок мастер-чеклиста требует доступа к внешним системам (Google Search Console, Яндекс.Вебмастер, Ahrefs) или ручной экспертной оценки. Эти разделы не входят в автоматический аудит:
    </p>
    <ul class="not-checked-list">
      ${notChecked.map(n => `<li>${esc(n)}</li>`).join('')}
    </ul>
    <div class="not-checked-cta">
      Для углублённого анализа этих блоков — обращайтесь к экспертам:
      <a href="https://itsoft.ru">itsoft.ru</a> ·
      <a href="https://pharm-studio.ru">pharm-studio.ru</a> ·
      <a href="https://nedzelsky.pro">nedzelsky.pro</a>
    </div>
  </div>` : '';

  // ── Section: Methodology / footer ───────────────────────────────────────────
  const methodologyHtml = `
  <div class="card methodology" id="methodology">
    <h2>Методология</h2>
    <p>
      Аудит построен на синтезе <strong>40+ источников</strong> (Semrush, Ahrefs, Moz, Google, Brightter, Wellows, NoGood, GitHub-стандарты) и <strong>мастер-чеклисте из 374 пунктов в 21 блоке</strong>.
    </p>
    <p>
      <strong>Инструменты сбора:</strong> Lighthouse 12+ (mobile + desktop preset), curl HTTP-проверки, WebFetch raw HTML, Chrome DevTools для JS-рендеринга и DOM-анализа.
    </p>
    <p>
      <strong>Версия скилла:</strong> v${reportVersion}. <strong>Дата проведения:</strong> ${esc(date)}.
    </p>
    <p style="margin-top:12px">
      <strong>Контакты для углублённого аудита:</strong>
      <a href="https://itsoft.ru">itsoft.ru</a> ·
      <a href="https://pharm-studio.ru">pharm-studio.ru</a> ·
      <a href="https://nedzelsky.pro">nedzelsky.pro</a>
    </p>
  </div>
  <div class="report-footer">
    <a href="https://itsoft.ru">itsoft.ru</a> ·
    <a href="https://pharm-studio.ru">pharm-studio.ru</a> ·
    <a href="https://nedzelsky.pro">nedzelsky.pro</a>
    · ${esc(url)} · ${esc(date)} · <span style="font-family:monospace">v${reportVersion}</span>
  </div>`;

  // ── Assemble final HTML ─────────────────────────────────────────────────────
  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SEO Аудит — ${esc(url)}</title>
<style>
  :root {
    --critical: #dc2626; --warning: #f59e0b; --ok: #16a34a; --info: #3b82f6;
    --primary: #1e40af; --primary-dark: #1e3a8a; --muted: #64748b;
    --bg: #f8fafc; --card-bg: #fff; --border: #e2e8f0;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: #1e293b; line-height: 1.5; }
  a { color: var(--primary); }
  .page { max-width: 980px; margin: 0 auto; padding: 32px 24px; }
  .card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 12px; padding: 28px; margin-bottom: 20px; }
  h1 { font-size: 28px; font-weight: 800; }
  h2 { font-size: 20px; font-weight: 700; margin-bottom: 14px; color: #0f172a; }
  h3 { font-size: 14px; font-weight: 700; }
  p { font-size: 14px; line-height: 1.6; color: #334155; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; padding: 10px 12px; background: #f8fafc; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); border-bottom: 2px solid var(--border); }

  /* ── Cover page ─────────────────────────────────────────────────────────── */
  .cover {
    min-height: 270mm;
    background: linear-gradient(135deg, #1e3a8a 0%, #1e40af 50%, #3b82f6 100%);
    color: #fff;
    padding: 60px 50px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    page-break-after: always;
    margin: -32px -24px 32px -24px;
    border-radius: 0;
  }
  .cover-content { margin-top: 80px; }
  .cover-brand { font-size: 14px; opacity: .7; text-transform: uppercase; letter-spacing: .25em; margin-bottom: 30px; font-weight: 600; }
  .cover-domain { font-size: 56px; font-weight: 900; line-height: 1; margin-bottom: 16px; word-break: break-word; }
  .cover-date { font-size: 18px; opacity: .8; margin-bottom: 60px; }
  .cover-grade-wrap { display: flex; align-items: baseline; gap: 24px; margin-bottom: 40px; }
  .cover-grade-label { font-size: 13px; text-transform: uppercase; letter-spacing: .15em; opacity: .7; }
  .cover-grade { font-size: 140px; font-weight: 900; line-height: .9; }
  .cover-grade-score { font-size: 24px; opacity: .8; }
  .cover-phrase { font-size: 18px; line-height: 1.5; opacity: .85; max-width: 600px; font-style: italic; border-left: 3px solid rgba(255,255,255,.4); padding-left: 16px; }
  .cover-footer { display: flex; justify-content: space-between; align-items: flex-end; font-size: 13px; opacity: .8; padding-top: 30px; border-top: 1px solid rgba(255,255,255,.2); }
  .cover-footer a { color: #fff; text-decoration: none; }
  .cover-footer-version { font-family: monospace; }

  /* ── TOC ────────────────────────────────────────────────────────────────── */
  .toc h2 { font-size: 16px; margin-bottom: 12px; }
  .toc-list { padding-left: 22px; font-size: 14px; line-height: 1.9; column-count: 2; column-gap: 32px; }
  .toc-list li { padding: 1px 0; break-inside: avoid; }
  .toc-list a { color: var(--primary); text-decoration: none; }
  .toc-list a:hover { text-decoration: underline; }

  /* ── How to read ────────────────────────────────────────────────────────── */
  .legend-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
  .legend-card { background: #f8fafc; border-radius: 8px; padding: 14px; }
  .legend-title { font-size: 12px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; margin-bottom: 10px; }
  .legend-rows { display: flex; flex-direction: column; gap: 6px; font-size: 12px; }

  /* ── Executive Summary ──────────────────────────────────────────────────── */
  .exec-summary { padding: 24px 28px; }
  .exec-grid { display: grid; grid-template-columns: 140px 1fr; gap: 24px; align-items: center; padding-bottom: 20px; border-bottom: 1px solid var(--border); margin-bottom: 20px; }
  .exec-grade-block { text-align: center; }
  .exec-grade-label { font-size: 11px; text-transform: uppercase; color: var(--muted); letter-spacing: .1em; }
  .exec-grade { font-size: 84px; font-weight: 900; line-height: 1; margin: 4px 0; }
  .exec-score-num { font-size: 14px; }
  .exec-meta { font-size: 12px; color: var(--muted); margin-top: 10px; }
  .strengths-risks { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  .sr-block { padding: 16px; border-radius: 8px; }
  .sr-strengths { background: #f0fdf4; border: 1px solid #bbf7d0; }
  .sr-risks { background: #fef2f2; border: 1px solid #fecaca; }
  .sr-title { font-size: 13px; font-weight: 700; margin-bottom: 10px; }
  .sr-block ul { list-style: none; }
  .sr-block li { font-size: 13px; line-height: 1.5; padding: 4px 0; padding-left: 16px; position: relative; }
  .sr-block li::before { content: '•'; position: absolute; left: 4px; }

  /* ── Stats grid ─────────────────────────────────────────────────────────── */
  .stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 12px; }
  .stat { background: var(--card-bg); border: 1px solid var(--border); border-radius: 10px; padding: 16px; text-align: center; }
  .stat-value { font-size: 32px; font-weight: 800; }
  .stat-label { font-size: 12px; color: var(--muted); margin-top: 4px; }
  .coverage-line { font-size: 12px; color: var(--muted); text-align: center; margin-bottom: 20px; padding: 8px; background: #f8fafc; border-radius: 6px; }

  /* ── Roadmap ────────────────────────────────────────────────────────────── */
  .phase-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }
  .phase-col { background: #f8fafc; border-radius: 10px; padding: 18px; border-top: 4px solid; }
  .phase-header { margin-bottom: 12px; }
  .phase-label { font-size: 11px; text-transform: uppercase; font-weight: 700; letter-spacing: .05em; }
  .phase-title { font-size: 16px; font-weight: 800; color: #0f172a; margin: 4px 0; }
  .phase-meta { font-size: 11px; color: var(--muted); }
  .phase-list { padding-left: 20px; font-size: 13px; line-height: 1.6; }
  .phase-list li { padding: 3px 0; }
  .phase-list a { color: #1e40af; text-decoration: none; }
  .phase-list a:hover { text-decoration: underline; }

  /* ── Recommendations ────────────────────────────────────────────────────── */
  .recs-phase { margin-bottom: 28px; }
  .recs-phase-header { padding: 8px 0 12px 14px; border-left: 4px solid; margin-bottom: 14px; }
  .recs-phase-title { font-size: 14px; font-weight: 800; }
  .recs-phase-count { font-size: 11px; color: var(--muted); margin-top: 2px; }
  .rec-card { border: 1px solid var(--border); border-radius: 10px; padding: 18px 22px; margin-bottom: 14px; }
  .rec-header { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 14px; padding-bottom: 12px; border-bottom: 1px solid #f1f5f9; }
  .rec-num { min-width: 32px; height: 32px; background: linear-gradient(135deg, #1e40af, #3b82f6); color: #fff; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 14px; flex-shrink: 0; }
  .rec-title-block { flex: 1; }
  .rec-title { font-weight: 700; font-size: 16px; line-height: 1.3; color: #0f172a; margin-bottom: 8px; }
  .rec-badges { display: flex; gap: 6px; flex-wrap: wrap; }
  .rec-section { margin-top: 12px; }
  .rec-section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); margin-bottom: 6px; }
  .rec-text { font-size: 13px; line-height: 1.6; color: #334155; }
  .rec-impact { background: #eff6ff; border-left: 3px solid #3b82f6; padding: 10px 14px; border-radius: 0 6px 6px 0; color: #1e3a8a; font-weight: 500; }
  .rec-steps { padding-left: 22px; font-size: 13px; line-height: 1.7; color: #334155; }
  .rec-code { background: #0f172a; color: #e2e8f0; padding: 12px 14px; border-radius: 6px; font-family: 'SF Mono', Consolas, Monaco, monospace; font-size: 11px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; overflow-wrap: break-word; }
  .rec-verify { background: #f0fdf4; border-left: 3px solid #16a34a; padding: 8px 12px; border-radius: 0 6px 6px 0; font-size: 12px; color: #166534; font-family: 'SF Mono', Consolas, monospace; word-break: break-word; }
  .rec-urls { font-size: 12px; line-height: 1.6; }
  .rec-urls a { color: #1e40af; text-decoration: none; word-break: break-all; }

  /* ── Pages audit ────────────────────────────────────────────────────────── */
  .pages-grid { display: grid; grid-template-columns: 1fr; gap: 14px; }
  .page-card { border: 1px solid var(--border); border-radius: 10px; padding: 16px 20px; }
  .page-card-header { display: flex; justify-content: space-between; align-items: center; padding-bottom: 10px; border-bottom: 1px solid #f1f5f9; margin-bottom: 12px; }
  .page-tpl { background: #eff6ff; color: #1e40af; padding: 4px 10px; border-radius: 5px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; }
  .page-url { font-family: monospace; font-size: 13px; color: #1e40af; text-decoration: none; }
  .page-type-info { display: flex; gap: 16px; padding: 8px 0; margin-bottom: 10px; border-bottom: 1px solid #f1f5f9; font-size: 12px; color: var(--muted); align-items: center; flex-wrap: wrap; }
  .page-type-pattern code { background: #f8fafc; padding: 2px 6px; border-radius: 3px; color: #1e40af; font-family: monospace; }
  .page-type-count { background: #fef3c7; color: #92400e; padding: 2px 8px; border-radius: 4px; font-weight: 600; }
  .page-metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 12px; }
  .page-metric { display: flex; justify-content: space-between; padding: 4px 8px; border-radius: 4px; font-size: 12px; }
  .page-metric.good { background: #f0fdf4; }
  .page-metric.bad { background: #fef2f2; }
  .page-metric-label { color: var(--muted); }
  .page-metric-value { font-weight: 600; color: #1e293b; }
  .page-issues { padding-top: 10px; border-top: 1px solid #f1f5f9; }
  .page-issues-title { font-size: 11px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; margin-bottom: 6px; }
  .page-issue { font-size: 12px; padding: 4px 0; display: flex; gap: 8px; align-items: center; }

  /* ── Tech blocks ────────────────────────────────────────────────────────── */
  .tech-block { margin-bottom: 18px; }
  .tech-block-title { font-size: 12px; font-weight: 700; text-transform: uppercase; color: var(--muted); letter-spacing: .05em; margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px solid #f1f5f9; }

  /* ── Screenshots ────────────────────────────────────────────────────────── */
  .screenshot-label { font-size: 11px; font-weight: 600; color: var(--muted); margin-bottom: 8px; text-transform: uppercase; letter-spacing: .05em; }
  .screenshot-frame {
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
    max-height: 600px;
    position: relative;
    background: #f8fafc;
  }
  .screenshot-frame img {
    display: block;
    width: 100%;
    height: auto;
    /* Если картинка выше 600px, верхние 600px видны через overflow:hidden родителя */
  }
  /* Градиентная подсветка снизу — намёк что скриншот обрезан */
  .screenshot-frame::after {
    content: '';
    position: absolute;
    left: 0; right: 0; bottom: 0; height: 60px;
    background: linear-gradient(to bottom, transparent, rgba(248, 250, 252, .95));
    pointer-events: none;
  }

  /* ── Not checked ────────────────────────────────────────────────────────── */
  .not-checked { background: #fffbeb; border-color: #fde68a; }
  .not-checked-list { padding-left: 20px; font-size: 13px; line-height: 1.7; color: #92400e; margin-bottom: 14px; }
  .not-checked-cta { font-size: 13px; padding: 12px; background: rgba(255,255,255,.5); border-radius: 6px; color: #92400e; }

  /* ── Methodology ────────────────────────────────────────────────────────── */
  .methodology p { margin-bottom: 8px; font-size: 13px; }

  /* ── Report footer ──────────────────────────────────────────────────────── */
  .report-footer { text-align: center; color: var(--muted); font-size: 11px; margin-top: 32px; padding-top: 16px; border-top: 1px solid var(--border); }
  .report-footer a { color: var(--muted); text-decoration: none; }

  /* ── Print rules ────────────────────────────────────────────────────────── */
  @page { size: A4; margin: 16mm 14mm; @bottom-right { content: "Стр. " counter(page) " / " counter(pages); font-size: 10px; color: #94a3b8; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; } }
  @page :first { margin: 0; @bottom-right { content: ''; } }
  @media print {
    body { background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .page { padding: 0; max-width: 100%; }
    .card { break-inside: avoid; margin-bottom: 14px; }
    .stat-grid { break-inside: avoid; }
    .rec-card { break-inside: avoid; }
    .page-card { break-inside: avoid; }
    .phase-col { break-inside: avoid; }
    .tech-block { break-inside: avoid; }
    .legend-card { break-inside: avoid; }
    .screenshot-frame { break-inside: avoid; max-height: 200mm; }
    tr { break-inside: avoid; }
    .cover { margin: 0; padding: 30mm 25mm; min-height: 297mm; }
  }
</style>
</head>
<body>
<div class="page">
  ${coverHtml}
  ${tocHtml}
  ${howToReadHtml}
  ${execSummaryHtml}
  ${statsHtml}
  ${scoresHtml}
  ${lhHtml}
  ${roadmapHtml}
  ${recsHtml}
  ${pagesHtml}
  ${techHtml}
  ${screenshotsHtml}
  ${notCheckedHtml}
  ${methodologyHtml}
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

// ── Convert to PDF via Chrome headless + CDP WebSocket ─────────────────────
// Why CDP: на Windows когда активен Claude Chrome Extension, обычный
// `chrome --headless --print-to-pdf` молча падает (chrome.exe видит
// существующий main process через Process Singleton mechanism и подсасывает
// к нему вместо запуска отдельной headless instance, --user-data-dir не
// помогает). А `--print-to-pdf` несовместимо с `--remote-debugging-port`.
// Решение — запустить Chrome с --remote-debugging-port (это обходит
// Singleton), затем через WebSocket вызвать Page.printToPDF из CDP.
//
// Минимальный WebSocket клиент написан с нуля через http+net+crypto,
// без зависимостей. Lighthouse использует тот же подход (chrome-launcher).
async function generatePDF(chrome, htmlFilePath, pdfOutPath) {
  const { spawn } = require('child_process');
  const http = require('http');
  const net = require('net');
  const cryptoMod = require('crypto');
  const os = require('os');
  const path = require('path');
  const { mkdtempSync, rmSync, unlinkSync, writeFileSync, statSync } = require('fs');

  try { if (existsSync(pdfOutPath)) unlinkSync(pdfOutPath); } catch {}

  const tmpProfile = mkdtempSync(path.join(os.tmpdir(), 'chr-cdp-'));
  const port = 9222 + Math.floor(Math.random() * 1000);
  const fileUrl = 'file:///' + htmlFilePath.replace(/\\/g, '/').replace(/^\/+/, '');

  const child = spawn(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--user-data-dir=' + tmpProfile,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--remote-debugging-port=' + port,
    // Окно гарантированно за пределами экрана. Размер должен быть нормальным
    // (1280×800) — если поставить 1×1, Chrome не создаёт нормальный page target
    // и --print-to-pdf через CDP не работает.
    '--window-position=-32000,-32000',
    '--window-size=1280,800',
    fileUrl,
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
    windowsHide: true,
  });
  child.unref();

  function fetchJSON(p) {
    return new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}${p}`, res => {
        let body = '';
        res.on('data', d => body += d);
        res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
      }).on('error', reject);
    });
  }

  function cleanup() {
    try { child.kill(); } catch {}
    try { rmSync(tmpProfile, { recursive: true, force: true }); } catch {}
  }

  // Wait for Chrome debug port AND page target to appear (up to 20s).
  // Просто проверка /json/version не достаточна — Chrome может открыть debug
  // port раньше чем создаст page target. Polling /json/list пока не появится page.
  let target = null;
  for (let i = 0; i < 80; i++) {
    try {
      const targets = await fetchJSON('/json/list');
      target = targets.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (target) break;
    } catch {}
    await new Promise(r => setTimeout(r, 250));
  }
  if (!target) { cleanup(); throw new Error('No page target found after 20s — Chrome did not open page'); }

  // Minimal WebSocket client for CDP
  function wsConnect(wsUrl) {
    return new Promise((resolve, reject) => {
      const u = new URL(wsUrl);
      const key = cryptoMod.randomBytes(16).toString('base64');
      const sock = net.connect(u.port, u.hostname);
      let buf = Buffer.alloc(0);
      let upgraded = false;
      const handlers = new Map();
      let nextId = 1;

      sock.on('connect', () => {
        sock.write(
          `GET ${u.pathname}${u.search} HTTP/1.1\r\n` +
          `Host: ${u.hostname}:${u.port}\r\n` +
          `Upgrade: websocket\r\n` +
          `Connection: Upgrade\r\n` +
          `Sec-WebSocket-Key: ${key}\r\n` +
          `Sec-WebSocket-Version: 13\r\n\r\n`
        );
      });

      sock.on('data', d => {
        buf = Buffer.concat([buf, d]);
        if (!upgraded) {
          const idx = buf.indexOf('\r\n\r\n');
          if (idx >= 0) {
            const headers = buf.slice(0, idx).toString();
            if (!headers.includes('101')) return reject(new Error('WS upgrade failed'));
            buf = buf.slice(idx + 4);
            upgraded = true;
            resolve(api);
          } else return;
        }
        // Frame parsing (server→client, no mask, supports fragmented payloads)
        while (buf.length >= 2) {
          const opcode = buf[0] & 0x0f;
          let len = buf[1] & 0x7f;
          let off = 2;
          if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
          else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
          if (buf.length < off + len) return;
          const payload = buf.slice(off, off + len).toString('utf8');
          buf = buf.slice(off + len);
          if (opcode === 1) {
            try {
              const msg = JSON.parse(payload);
              if (msg.id && handlers.has(msg.id)) {
                const cb = handlers.get(msg.id);
                handlers.delete(msg.id);
                cb(msg);
              }
            } catch {}
          }
        }
      });

      sock.on('error', reject);

      function sendFrame(text) {
        const payload = Buffer.from(text);
        const mask = cryptoMod.randomBytes(4);
        const len = payload.length;
        let header;
        if (len < 126) {
          header = Buffer.from([0x81, 0x80 | len]);
        } else if (len < 65536) {
          header = Buffer.alloc(4);
          header[0] = 0x81; header[1] = 0x80 | 126; header.writeUInt16BE(len, 2);
        } else {
          header = Buffer.alloc(10);
          header[0] = 0x81; header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(len), 2);
        }
        const masked = Buffer.alloc(len);
        for (let i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i & 3];
        sock.write(Buffer.concat([header, mask, masked]));
      }

      const api = {
        send(method, params = {}) {
          return new Promise(res => {
            const id = nextId++;
            handlers.set(id, m => res(m.result || m.error));
            sendFrame(JSON.stringify({ id, method, params }));
          });
        },
        close() { try { sock.end(); } catch {} },
      };
    });
  }

  let ws;
  try {
    ws = await wsConnect(target.webSocketDebuggerUrl);
    await ws.send('Page.enable');
    // Дать странице время отрендериться (картинки, шрифты, base64 ассеты)
    await new Promise(r => setTimeout(r, 2500));
    const result = await ws.send('Page.printToPDF', {
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
    });
    if (!result || !result.data) {
      throw new Error('Page.printToPDF returned no data: ' + JSON.stringify(result).slice(0, 200));
    }
    writeFileSync(pdfOutPath, Buffer.from(result.data, 'base64'));
    return statSync(pdfOutPath).size;
  } finally {
    if (ws) ws.close();
    cleanup();
  }
}

// Запуск PDF generation
const chrome = findChrome();
if (chrome) {
  generatePDF(chrome, htmlPath, pdfPath)
    .then(size => console.log(`PDF  → ${pdfPath} (${Math.round(size / 1024)} KB)`))
    .catch(e => {
      console.error('PDF generation failed:', e.message);
      console.log('HTML report is still available — open it in a browser.');
    });
} else {
  console.warn('Chrome not found — PDF skipped. Install Chrome or add it to PATH.');
}
