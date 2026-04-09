#!/usr/bin/env node
/**
 * SEO Audit Report Generator
 * Usage: node generate-report.js <report.json> [output-dir]
 * Generates: report.html + report.pdf (via Chrome headless)
 */

const SKILL_VERSION = '1.14.3';

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

// Склонение «час / часа / часов»
function hourPlural(n) {
  const m100 = n % 100, m10 = n % 10;
  if (m100 >= 11 && m100 <= 14) return 'часов';
  if (m10 === 1) return 'час';
  if (m10 >= 2 && m10 <= 4) return 'часа';
  return 'часов';
}

// Бейдж часов: всегда выводим число из estimateHours.total (единый источник истины).
// Текстовое поле rec.effortHours игнорируется — раньше оно расходилось с total
// (например, "5 часов" при total=6), что вводило клиента в заблуждение.
function effortBadge(rec) {
  const n = rec && rec.estimateHours && typeof rec.estimateHours.total === 'number' ? rec.estimateHours.total : null;
  if (!n || n <= 0) {
    // Fallback на legacy текстовое поле, если estimateHours отсутствует
    if (!rec || !rec.effortHours) return '';
    return `<span style="background:#f1f5f9;color:#475569;padding:3px 9px;border-radius:5px;font-size:11px;font-weight:700">⏱ ${esc(rec.effortHours)}</span>`;
  }
  return `<span style="background:#f1f5f9;color:#475569;padding:3px 9px;border-radius:5px;font-size:11px;font-weight:700">⏱ ${n} ${hourPlural(n)}</span>`;
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
  // Дата без времени — точное время до минуты намекает на автоматическую генерацию
  const dateOnly = (date || '').slice(0, 10);
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
      <div class="cover-date">${esc(dateOnly)}</div>
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
      Отчёт построен на мастер-чеклисте из 374 проверок в 21 блоке. Каждая рекомендация приоритизирована по влиянию на SEO и сложности внедрения.
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
    ? `Покрыто в этом отчёте: ${coverage.automatedCount || coverage.blocksCovered?.length || 0} блоков · Требует отдельной работы: ${coverage.manualCount || coverage.blocksManual?.length || 0} блоков`
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

  // ── Section: AEO / GEO готовность (AI-поиск) ───────────────────────────────
  const aeoHtml = (() => {
    const sd = data.siteData || {};
    const llms = sd.llmsTxt || {};
    const ai = sd.aiCrawlers || {};
    const aeoPages = (pages || []).filter(p => p.metrics && p.metrics.aeoReadiness);
    if (!aeoPages.length && !llms.exists && !Array.isArray(ai.blocked) && !Array.isArray(ai.allowed) && !Array.isArray(ai.notMentioned)) {
      return ''; // нет ни одного AEO-сигнала — секцию не показываем
    }

    // Склонение «слово / слова / слов»
    const wordPlural = n => {
      const m100 = n % 100, m10 = n % 10;
      if (m100 >= 11 && m100 <= 14) return 'слов';
      if (m10 === 1) return 'слово';
      if (m10 >= 2 && m10 <= 4) return 'слова';
      return 'слов';
    };

    // Минимальная длина «настоящего» лид-абзаца. Меньше — считаем что лида нет
    // (collector в свежих версиях уже фильтрует <5, но защищаемся для legacy данных).
    const MIN_LEAD_WORDS = 5;

    // Агрегаты по AEO-готовности страниц
    const totalAeo = aeoPages.length;
    const noLead = aeoPages.filter(p => (p.metrics.aeoReadiness.firstParagraphWords || 0) < MIN_LEAD_WORDS).length;
    const longFirstP = aeoPages.filter(p => (p.metrics.aeoReadiness.firstParagraphWords || 0) > 60).length;
    const shortFirstP = aeoPages.filter(p => {
      const w = p.metrics.aeoReadiness.firstParagraphWords || 0;
      return w >= MIN_LEAD_WORDS && w <= 60;
    }).length;
    const noFaq = aeoPages.filter(p => p.metrics.aeoReadiness.hasFaqSection === false).length;
    const withFaq = totalAeo - noFaq;
    // Среднее считаем только по страницам, где лид реально есть, чтобы один пустой <p>
    // не утягивал среднее в 1 слово и не вводил клиента в заблуждение.
    const realLeads = aeoPages.filter(p => (p.metrics.aeoReadiness.firstParagraphWords || 0) >= MIN_LEAD_WORDS);
    const avgFirstP = realLeads.length > 0
      ? Math.round(realLeads.reduce((s, p) => s + p.metrics.aeoReadiness.firstParagraphWords, 0) / realLeads.length)
      : 0;

    const blocked = Array.isArray(ai.blocked) ? ai.blocked : [];
    const allowed = Array.isArray(ai.allowed) ? ai.allowed : [];
    const notMent = Array.isArray(ai.notMentioned) ? ai.notMentioned : [];

    const dot = (color, label) => `<span style="display:inline-block;width:8px;height:8px;border-radius:99px;background:${color};margin-right:6px;vertical-align:middle"></span>${label}`;
    const tag = (text, color) => `<span style="display:inline-block;padding:2px 8px;border-radius:99px;background:${color}22;color:${color};font-size:11px;font-weight:600;margin:2px 4px 2px 0">${esc(text)}</span>`;

    return `
    <div class="card" id="aeo-geo">
      <h2>AEO / GEO — готовность к AI-поиску</h2>
      <p style="color:#475569;font-size:14px;margin-bottom:18px">
        Answer Engine Optimization и Generative Engine Optimization — оптимизация под AI-обзоры и LLM-краулеры (ChatGPT, Perplexity, Gemini, YandexGPT). Проверяется доступ AI-краулеров, наличие <code>llms.txt</code> и структура контента, удобная для извлечения ответов.
      </p>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px;margin-bottom:20px">
        <div style="border:1px solid #e2e8f0;border-radius:10px;padding:14px">
          <div style="font-size:11px;text-transform:uppercase;color:var(--muted);font-weight:600;letter-spacing:.04em;margin-bottom:6px">llms.txt</div>
          <div style="font-size:20px;font-weight:700;color:${llms.exists ? '#16a34a' : '#dc2626'}">${llms.exists ? '✓ найден' : '✗ отсутствует'}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:4px">${llms.fullExists ? 'есть llms-full.txt' : 'экспериментальный стандарт для AI-руководства'}</div>
        </div>
        <div style="border:1px solid #e2e8f0;border-radius:10px;padding:14px">
          <div style="font-size:11px;text-transform:uppercase;color:var(--muted);font-weight:600;letter-spacing:.04em;margin-bottom:6px">AI-краулеры</div>
          <div style="font-size:20px;font-weight:700;color:${blocked.length ? '#dc2626' : allowed.length ? '#16a34a' : '#f59e0b'}">${blocked.length ? `${blocked.length} заблокировано` : allowed.length ? `${allowed.length} разрешено` : 'не настроены'}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:4px">${notMent.length ? `${notMent.length} не упомянуты в robots.txt` : 'все основные AI-краулеры учтены'}</div>
        </div>
        <div style="border:1px solid #e2e8f0;border-radius:10px;padding:14px">
          <div style="font-size:11px;text-transform:uppercase;color:var(--muted);font-weight:600;letter-spacing:.04em;margin-bottom:6px">FAQ-секции</div>
          <div style="font-size:20px;font-weight:700;color:${withFaq > 0 ? '#16a34a' : '#dc2626'}">${withFaq} / ${totalAeo}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:4px">страниц с FAQ-блоком (важно для AI-ответов)</div>
        </div>
        <div style="border:1px solid #e2e8f0;border-radius:10px;padding:14px">
          <div style="font-size:11px;text-transform:uppercase;color:var(--muted);font-weight:600;letter-spacing:.04em;margin-bottom:6px">Первый абзац</div>
          <div style="font-size:20px;font-weight:700;color:${avgFirstP >= MIN_LEAD_WORDS && avgFirstP <= 60 ? '#16a34a' : avgFirstP > 60 ? '#f59e0b' : '#dc2626'}">${avgFirstP > 0 ? `${avgFirstP} ${wordPlural(avgFirstP)}` : 'нет лида'}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:4px">${realLeads.length === 0 ? 'ни на одной странице нет полноценного лид-абзаца' : 'средняя длина (норма для AI-ответов: 5–60 слов)'}</div>
        </div>
      </div>

      ${(blocked.length || allowed.length || notMent.length) ? `
      <h3 style="font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:14px 0 8px">Статус AI-краулеров</h3>
      <div style="font-size:13px;line-height:1.9">
        ${blocked.length ? `<div>${dot('#dc2626', 'Заблокированы:')} ${blocked.map(b => tag(b, '#dc2626')).join('')}</div>` : ''}
        ${allowed.length ? `<div>${dot('#16a34a', 'Явно разрешены:')} ${allowed.map(b => tag(b, '#16a34a')).join('')}</div>` : ''}
        ${notMent.length ? `<div>${dot('#f59e0b', 'Не упомянуты в robots.txt:')} ${notMent.map(b => tag(b, '#f59e0b')).join('')}</div>` : ''}
      </div>
      <p style="font-size:12px;color:var(--muted);margin-top:8px">«Не упомянуты» = не указаны явно ни в Allow, ни в Disallow. Для коммерческого сайта рекомендуется явно разрешить — это повышает шанс попасть в обучающие выборки и AI-ответы.</p>
      ` : ''}

      ${totalAeo > 0 ? `
      <h3 style="font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:18px 0 8px">Готовность контента страниц</h3>
      <table style="font-size:13px">
        <thead>
          <tr>
            <th style="text-align:left">Метрика</th>
            <th style="text-align:right;width:80px">Значение</th>
            <th style="text-align:left;width:50%">Что это значит для AI-поиска</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9">Страниц с полноценным лид-абзацем (5–60 слов)</td>
            <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;text-align:right;font-weight:700;font-variant-numeric:tabular-nums;color:${shortFirstP === totalAeo ? '#16a34a' : shortFirstP === 0 ? '#dc2626' : '#f59e0b'}">${shortFirstP} / ${totalAeo}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;color:var(--muted)">Короткий лид-абзац AI используют дословно как ответ на запрос пользователя. Норма — 1–3 предложения с прямым ответом на интент страницы.</td>
          </tr>
          <tr>
            <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9">Страниц с длинным первым абзацем (&gt; 60 слов)</td>
            <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;text-align:right;font-weight:700;font-variant-numeric:tabular-nums;color:${longFirstP === 0 ? '#16a34a' : '#f59e0b'}">${longFirstP} / ${totalAeo}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;color:var(--muted)">Сократить лид до 1–3 предложений. Длинные вступления AI пересказывают своими словами или игнорируют.</td>
          </tr>
          <tr>
            <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9">Страниц без лид-абзаца (контент сразу с заголовков/списков)</td>
            <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;text-align:right;font-weight:700;font-variant-numeric:tabular-nums;color:${noLead === 0 ? '#16a34a' : '#dc2626'}">${noLead} / ${totalAeo}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;color:var(--muted)">Если страница начинается с картинок, заголовков или иконок без вводного абзаца — AI-движкам нечего извлечь как ответ. Добавить вводный текст в 1–3 предложения.</td>
          </tr>
          <tr>
            <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9">Страниц с FAQ-секцией</td>
            <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;text-align:right;font-weight:700;font-variant-numeric:tabular-nums;color:${withFaq === totalAeo ? '#16a34a' : withFaq === 0 ? '#dc2626' : '#f59e0b'}">${withFaq} / ${totalAeo}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;color:var(--muted)">FAQ + Schema.org FAQPage — основной формат, который AI-движки и поисковые ассистенты извлекают как ответы на вопросы.</td>
          </tr>
        </tbody>
      </table>` : ''}

      <p style="margin-top:14px;font-size:12px;color:var(--muted)">
        AEO/GEO — относительно новая дисциплина. Основные сигналы готовности: открытый доступ AI-краулерам, наличие <code>llms.txt</code>, краткие лид-абзацы с прямыми ответами, FAQ-секции с разметкой, Schema.org Article/Product/Organization для контекста.
      </p>
    </div>`;
  })();

  // ── Section: Effort Estimate ───────────────────────────────────────────────
  const effortEstimateHtml = data.effortEstimate ? (() => {
    const ee = data.effortEstimate;
    const pm = data.projectMeta || {};

    // 3 этапа соответствуют Roadmap (Срочно/Месяц/Стратегия)
    const stageColors = {
      1: '#dc2626', // red — Критичные блокеры
      2: '#ea580c', // orange — Важные изменения
      3: '#16a34a', // green — Желательные улучшения
    };
    const stageMeta = {
      1: { label: 'Критичные блокеры', deadline: '1–2 недели' },
      2: { label: 'Важные изменения',  deadline: 'до 30 дней' },
      3: { label: 'Желательные улучшения', deadline: '1–3 месяца' },
    };

    // Сгруппируй пронумерованные рекомендации в этапы по фазам Roadmap.
    // Это гарантирует, что число задач в этапах = число задач в Плане действий.
    const phaseToStage = { urgent: 1, month: 2, strategy: 3 };
    const stageRecs = { 1: [], 2: [], 3: [] };
    numbered.forEach(r => {
      const stage = phaseToStage[computePhase(r)] || 3;
      stageRecs[stage].push(r);
    });

    // Часы конкретной задачи: число из estimateHours.total или парсинг effortHours
    const taskHours = r => {
      const t = r.estimateHours?.total;
      if (typeof t === 'number' && t > 0) return t;
      const m = String(r.effortHours || '').match(/(\d+)/);
      return m ? parseInt(m[1], 10) : 0;
    };

    // Сумма часов по ролям из estimateHours[] всех задач этапа + PM = ceil(0.23 × base)
    const stageHours = stage => {
      const recsArr = stageRecs[stage] || [];
      const sum = { seo: 0, dev: 0, qa: 0, devops: 0, design: 0 };
      recsArr.forEach(r => {
        const eh = r.estimateHours || {};
        sum.seo    += eh.seo    || 0;
        sum.dev    += eh.dev    || 0;
        sum.qa     += eh.qa     || 0;
        sum.devops += eh.devops || 0;
        sum.design += eh.design || 0;
      });
      const base = sum.seo + sum.dev + sum.qa + sum.devops + sum.design;
      const pmH = base > 0 ? Math.ceil(0.23 * base) : 0;
      return { ...sum, pm: pmH, total: base + pmH, taskCount: recsArr.length };
    };

    const s1 = stageHours(1);
    const s2 = stageHours(2);
    const s3 = stageHours(3);
    const totals = {
      seo:    s1.seo    + s2.seo    + s3.seo,
      dev:    s1.dev    + s2.dev    + s3.dev,
      qa:     s1.qa     + s2.qa     + s3.qa,
      devops: s1.devops + s2.devops + s3.devops,
      design: s1.design + s2.design + s3.design,
      pm:     s1.pm     + s2.pm     + s3.pm,
      total:  s1.total  + s2.total  + s3.total,
    };

    // Отрисовка ячейки роли: пустые значения как тире, не "0"
    const cell = v => (v && v > 0) ? String(v) : '<span style="color:#cbd5e1">—</span>';
    const taskWord = n => n === 1 ? 'задача' : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'задачи' : 'задач');

    const stageRow = (id, h) => {
      const meta = stageMeta[id];
      return `
      <tr>
        <td style="padding:12px;border-bottom:1px solid #f1f5f9">
          <div style="display:flex;align-items:center;gap:10px">
            <div style="width:6px;height:32px;background:${stageColors[id]};border-radius:2px;flex-shrink:0"></div>
            <div>
              <div style="font-weight:700;font-size:13px">${id}. ${meta.label}</div>
              <div style="font-size:11px;color:var(--muted)">${meta.deadline} · ${h.taskCount} ${taskWord(h.taskCount)}</div>
            </div>
          </div>
        </td>
        <td style="padding:12px 8px;border-bottom:1px solid #f1f5f9;text-align:right;font-variant-numeric:tabular-nums">${cell(h.seo)}</td>
        <td style="padding:12px 8px;border-bottom:1px solid #f1f5f9;text-align:right;font-variant-numeric:tabular-nums">${cell(h.dev)}</td>
        <td style="padding:12px 8px;border-bottom:1px solid #f1f5f9;text-align:right;font-variant-numeric:tabular-nums">${cell(h.qa)}</td>
        <td style="padding:12px 8px;border-bottom:1px solid #f1f5f9;text-align:right;font-variant-numeric:tabular-nums">${cell(h.devops)}</td>
        <td style="padding:12px 8px;border-bottom:1px solid #f1f5f9;text-align:right;font-variant-numeric:tabular-nums">${cell(h.design)}</td>
        <td style="padding:12px 8px;border-bottom:1px solid #f1f5f9;text-align:right;font-variant-numeric:tabular-nums">${cell(h.pm)}</td>
        <td style="padding:12px;border-bottom:1px solid #f1f5f9;text-align:right;font-weight:700;font-variant-numeric:tabular-nums">${h.total || 0}</td>
      </tr>`;
    };

    const totalRow = `
      <tr style="background:#0f172a;color:#fff">
        <td style="padding:16px 12px;font-weight:800;font-size:14px">ИТОГО</td>
        <td style="padding:16px 8px;text-align:right;font-weight:700;font-variant-numeric:tabular-nums">${totals.seo}</td>
        <td style="padding:16px 8px;text-align:right;font-weight:700;font-variant-numeric:tabular-nums">${totals.dev}</td>
        <td style="padding:16px 8px;text-align:right;font-weight:700;font-variant-numeric:tabular-nums">${totals.qa}</td>
        <td style="padding:16px 8px;text-align:right;font-weight:700;font-variant-numeric:tabular-nums">${totals.devops}</td>
        <td style="padding:16px 8px;text-align:right;font-weight:700;font-variant-numeric:tabular-nums">${totals.design}</td>
        <td style="padding:16px 8px;text-align:right;font-weight:700;font-variant-numeric:tabular-nums">${totals.pm}</td>
        <td style="padding:16px 12px;text-align:right;font-weight:900;font-size:18px;font-variant-numeric:tabular-nums;color:#fbbf24">${totals.total} ч</td>
      </tr>`;

    // Детальный список задач по этапам с часами на каждую задачу
    const stageDetailBlock = (id, recsArr) => {
      if (!recsArr.length) return '';
      const meta = stageMeta[id];
      const rows = recsArr.map(r => `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;width:36px;text-align:center;color:var(--muted);font-weight:600;font-variant-numeric:tabular-nums">${r._num}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:13px">
            <a href="#rec-${r._num}" style="color:inherit;text-decoration:none">${esc(r.title)}</a>
          </td>
          <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;text-align:right;font-variant-numeric:tabular-nums;font-size:13px;font-weight:600;white-space:nowrap">${taskHours(r)} ч</td>
        </tr>`).join('');
      return `
      <div style="margin-top:18px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
          <div style="width:6px;height:20px;background:${stageColors[id]};border-radius:2px"></div>
          <div style="font-weight:700;font-size:13px">${id}. ${meta.label}</div>
          <div style="font-size:11px;color:var(--muted)">${meta.deadline} · ${recsArr.length} ${taskWord(recsArr.length)}</div>
        </div>
        <table style="font-size:13px">
          <tbody>${rows}</tbody>
        </table>
      </div>`;
    };

    const hasAnyTasks = (stageRecs[1].length + stageRecs[2].length + stageRecs[3].length) > 0;

    return `
    <div class="card" id="effort">
      <h2>Оценка трудозатрат на внедрение</h2>
      <p style="color:#475569;font-size:14px;margin-bottom:6px">
        Сводка по ролям в команде и этапам внедрения. Оценка учитывает специфику CMS, объём правок и сложность регрессионного тестирования.
      </p>
      ${pm.cms || pm.totalUrls ? `<p style="color:var(--muted);font-size:12px;margin-bottom:18px">CMS: <strong>${esc(pm.cms || '?')}</strong>${pm.totalUrls ? ` · Объём: <strong>${pm.totalUrls} URL</strong>` : ''}</p>` : ''}

      <h3 style="font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:14px 0 10px">Сводка по этапам внедрения</h3>
      <table style="font-size:13px">
        <thead>
          <tr>
            <th style="text-align:left">Этап</th>
            <th style="text-align:right;width:55px">SEO</th>
            <th style="text-align:right;width:55px">Dev</th>
            <th style="text-align:right;width:55px">QA</th>
            <th style="text-align:right;width:65px">DevOps</th>
            <th style="text-align:right;width:60px">Design</th>
            <th style="text-align:right;width:55px">PM</th>
            <th style="text-align:right;width:80px">Всего</th>
          </tr>
        </thead>
        <tbody>
          ${stageRow(1, s1)}
          ${stageRow(2, s2)}
          ${stageRow(3, s3)}
          ${totalRow}
        </tbody>
      </table>

      ${hasAnyTasks ? `
      <h3 style="font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:24px 0 6px">Задачи по этапам с часами</h3>
      ${stageDetailBlock(1, stageRecs[1])}
      ${stageDetailBlock(2, stageRecs[2])}
      ${stageDetailBlock(3, stageRecs[3])}` : ''}
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
            ${effortBadge(r)}
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
      ${data.effortEstimate ? `<li><a href="#effort">Оценка трудозатрат на внедрение</a></li>` : ''}
      ${recs.length ? `<li><a href="#recs">Детализация ${recs.length} рекомендаций</a></li>` : ''}
      ${(pages && pages.length) ? `<li><a href="#pages">Анализ ${pages.length} ${pages.length === 1 ? 'типа страниц' : pages.length < 5 ? 'типов страниц' : 'типов страниц'}</a></li>` : ''}
      ${aeoHtml ? `<li><a href="#aeo-geo">AEO / GEO — готовность к AI-поиску</a></li>` : ''}
      ${(technical && technical.length) ? `<li><a href="#technical">Технические проверки по блокам</a></li>` : ''}
      ${(desktopSrc || mobileSrc) ? `<li><a href="#screenshots">Скриншоты сайта</a></li>` : ''}
      ${(notChecked && notChecked.length) ? `<li><a href="#not-checked">За рамками этого отчёта</a></li>` : ''}
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

    // Унифицированная нормализация: h1 — всегда массив (collector это гарантирует),
    // но защищаемся от строки/null от несовместимых данных.
    const h1Arr = Array.isArray(m.h1) ? m.h1 : (m.h1 ? [String(m.h1)] : []);
    const h1Count = h1Arr.length;
    let h1Display, h1Ok;
    if (h1Count === 0) {
      h1Display = 'нет'; h1Ok = false;
    } else if (h1Count === 1) {
      const t = String(h1Arr[0] || '').trim();
      h1Display = t.length > 60 ? t.slice(0, 57) + '…' : (t || '✓ (пустой)');
      h1Ok = t.length > 0;
    } else {
      h1Display = `${h1Count} шт. — дубль`; h1Ok = false;
    }

    // Title/Description — отрицательные значения тоже подсвечиваем (не только диапазон)
    const titleOk = m.titleLen != null ? (m.titleLen >= 30 && m.titleLen <= 60) : null;
    const descOk  = m.metaDescLen != null ? (m.metaDescLen >= 70 && m.metaDescLen <= 160) : null;
    const titleVal = m.titleLen != null ? `${m.titleLen} симв.${m.titleLen > 60 ? ' (длинно)' : m.titleLen < 30 ? ' (коротко)' : ''}` : 'нет';
    const descVal  = m.metaDescLen != null ? `${m.metaDescLen} симв.${m.metaDescLen > 160 ? ' (длинно)' : m.metaDescLen < 70 ? ' (коротко)' : ''}` : 'нет';

    const schemaOk    = !!(m.schemaTypes && m.schemaTypes.length);
    const schemaVal   = schemaOk ? m.schemaTypes.join(', ') : 'нет';

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
        ${metricRow('Title', titleVal, m.titleLen == null ? false : titleOk)}
        ${metricRow('Description', descVal, m.metaDescLen == null ? false : descOk)}
        ${metricRow('H1', h1Display, h1Ok)}
        ${metricRow('Canonical', m.canonical ? '✓' : 'нет', !!m.canonical)}
        ${metricRow('Schema.org', schemaVal, schemaOk)}
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
  // Honest counts: показываем «всего уникальных типов» только если значение
  // действительно > pages.length, иначе агент мог завысить totalTypes (был баг
  // на maxilac.ru: totalTypes=5 при реальных 4 уникальных шаблонах). skippedTypes
  // тоже пересчитываем сами — агентский self-report игнорируем.
  const realTotalTypes = pts && pts.totalTypes && pts.totalTypes > pages.length ? pts.totalTypes : pages.length;
  const realSkipped = Math.max(0, realTotalTypes - pages.length);
  const showTotalTypesNote = realTotalTypes > pages.length;
  const pagesHtml = (pages && pages.length) ? `
  <div class="card" id="pages">
    <h2>Анализ уникальных типов страниц</h2>
    <p style="color:#475569;font-size:14px;margin-bottom:16px">
      Проанализировано <strong>${pages.length}</strong> ${pages.length === 1 ? 'тип' : pages.length < 5 ? 'типа' : 'типов'} страниц${pts && pts.totalUrls ? ` из <strong>${pts.totalUrls}</strong> URL в sitemap` : ''}${showTotalTypesNote ? ` (всего уникальных типов: <strong>${realTotalTypes}</strong>)` : ''}.
      ${realSkipped > 0 ? `<br><span style="color:#92400e">⚠ Дополнительно ${realSkipped} ${realSkipped === 1 ? 'тип' : realSkipped < 5 ? 'типа' : 'типов'} страниц ${realSkipped === 1 ? 'вынесен' : 'вынесены'} в углублённый этап анализа.</span>` : ''}
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
        <div class="screenshot-label">Десктоп · viewport 1350 × 940</div>
        <div class="screenshot-frame"><img src="${desktopSrc}" alt="Desktop screenshot"></div>
      </div>` : ''}
      ${mobileSrc ? `<div>
        <div class="screenshot-label">Мобильный · viewport 412 × 823</div>
        <div class="screenshot-frame"><img src="${mobileSrc}" alt="Mobile screenshot"></div>
      </div>` : ''}
    </div>
  </div>` : '';

  // ── Section: Not checked / scope disclosure ─────────────────────────────────
  const notCheckedHtml = (notChecked && notChecked.length) ? `
  <div class="card not-checked" id="not-checked">
    <h2>За рамками этого отчёта</h2>
    <p style="color:#475569;font-size:14px;margin-bottom:14px">
      Часть проверок мастер-чеклиста требует доступа к внешним системам (Google Search Console, Яндекс.Вебмастер, Ahrefs) или углублённой экспертной оценки. Эти разделы вынесены в отдельный этап работ:
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
      Отчёт построен на мастер-чеклисте из <strong>374 проверок в 21 блоке</strong> — синтезе ведущих SEO-источников (Google Search Central, Semrush, Ahrefs, Moz, Backlinko, Wellows, Brightter, NoGood) и стандартов W3C / Schema.org.
    </p>
    <p>
      <strong>Что вошло в проверку:</strong> мета-теги и On-Page элементы, структурированные данные Schema.org, Open Graph, Core Web Vitals и производительность, мобильная оптимизация, краулинг и индексирование, технические HTTP-заголовки, JS-рендеринг, внутренняя перелинковка, аналитика и верификации, AEO/GEO готовность для AI-поиска.
    </p>
    <p>
      <strong>Дата:</strong> ${esc(dateOnly)} · <strong>Версия:</strong> v${reportVersion}
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
    · ${esc(url)} · ${esc(dateOnly)} · <span style="font-family:monospace">v${reportVersion}</span>
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
  ${effortEstimateHtml}
  ${recsHtml}
  ${pagesHtml}
  ${aeoHtml}
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
