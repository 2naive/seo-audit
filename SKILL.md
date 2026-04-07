---
name: seo-audit
description: Full SEO audit — meta tags, JS-rendered content, Core Web Vitals, screenshots, broken links, robots/sitemap, Open Graph, Schema.org. Generates Markdown + HTML + PDF report.
argument-hint: "[URL сайта]"
allowed-tools: Bash WebFetch Navigate Screenshot Read Write
context: fork
agent: general-purpose
---

Выполни полный SEO-аудит сайта **$ARGUMENTS** и сформируй отчёт.

Дата проведения: !`date +"%Y-%m-%d %H:%M"`

---

## Шаг 0 — Проверка Claude in Chrome

**Перед любыми другими действиями** проверь доступность Chrome-интеграции.

Попробуй выполнить навигацию в браузере: используй инструмент Navigate с URL `$ARGUMENTS`.

### Если Navigate недоступен или вернул ошибку подключения:

Сообщи пользователю:

```
⚠️  Claude in Chrome не подключён.

Для полного SEO-аудита (JS-рендеринг, скриншоты, мобильный вид)
необходимо подключить Chrome:

  1. Убедись, что Chrome/Edge запущен
  2. Установи расширение Claude Code (версия ≥ 1.0.36)
  3. Перезапусти сессию с флагом:

       claude --chrome

  Или подключи Chrome в текущей сессии командой /chrome,
  затем повтори: /seo-audit $ARGUMENTS

─────────────────────────────────────────────
  Продолжить в базовом режиме (без скриншотов
  и JS-рендеринга)? Ответь "да" для продолжения.
─────────────────────────────────────────────
```

Дожди ответа пользователя:
- Если "да" — продолжи, пропуская **Фазу 2** (все Chrome-шаги), отметь в отчёте: `⚠️ Базовый режим — Chrome недоступен`
- Иначе — останови выполнение

### Если Navigate выполнился успешно:

Выведи: `✅ Chrome подключён — запускаю полный аудит`

Продолжай со всеми фазами включая скриншоты и JS-анализ.

---

## Инициализация

Создай рабочую директорию и вычисли имя файла отчёта:
```bash
mkdir -p seo-audit-output
SITE_URL="$ARGUMENTS"
DOMAIN=$(echo "$SITE_URL" | sed 's|https\?://||' | sed 's|/.*||')
DATETIME=$(date +"%Y-%m-%d-%H%M")
REPORT_BASE="seo-report-${DOMAIN}-${DATETIME}"
```

Все выходные файлы этого запуска должны иметь префикс `${REPORT_BASE}`, например:
- `seo-audit-output/${REPORT_BASE}.md`
- `seo-audit-output/${REPORT_BASE}.html`
- `seo-audit-output/${REPORT_BASE}.pdf`
- `seo-audit-output/desktop-${DOMAIN}-${DATETIME}.png`
- `seo-audit-output/mobile-${DOMAIN}-${DATETIME}.png`

---

## Фаза 1 — Статичные технические проверки (WebFetch)

### 1.1 robots.txt
Получи `$ARGUMENTS/robots.txt` через WebFetch. Проверь:
- Есть ли блокировка важных путей (`Disallow: /`)
- Указана ли директива `Sitemap:`
- Нет ли конфликтующих правил

### 1.2 sitemap.xml
Получи `$ARGUMENTS/sitemap.xml` через WebFetch. Проверь:
- Формат валиден (XML)
- Количество URL
- Извлеки до 5 внутренних URL для дальнейшей проверки

### 1.3 Raw HTML главной страницы
Получи `$ARGUMENTS` через WebFetch (raw HTML до JS-рендеринга). Проверь:
- `<title>` — длина 30–60 символов
- `<meta name="description">` — длина 70–160 символов
- `<link rel="canonical">` — совпадает с текущим URL
- `<meta name="robots">` — нет `noindex` на важных страницах
- `<html lang="...">` — указан язык
- `<meta name="viewport">` — обязателен для мобильных
- Open Graph: `og:title`, `og:description`, `og:image`
- Twitter Card: `twitter:card`, `twitter:title`
- Schema.org: `<script type="application/ld+json">` — тип(ы) разметки
- H1–H6 иерархия: один H1, логичная структура
- Изображения без `alt` атрибута

### 1.4 Технические HTTP-проверки
Выполни через Bash:
```bash
# HTTPS + редиректы + заголовки безопасности
curl -sI "$ARGUMENTS" | grep -Ei "HTTP|Location|Strict-Transport|X-Frame|Content-Security|Cache-Control" 2>/dev/null

# Скорость ответа сервера (TTFB)
curl -o /dev/null -s -w "DNS:%{time_namelookup}s Connect:%{time_connect}s TTFB:%{time_starttransfer}s Total:%{time_total}s\n" "$ARGUMENTS" 2>/dev/null

# Сжатие (gzip/br)
curl -sI -H "Accept-Encoding: gzip, br" "$ARGUMENTS" | grep -i "content-encoding" 2>/dev/null
```

---

## Фаза 2 — Браузерный анализ (Chrome)

### 2.1 Десктоп — главная страница
Перейди на `$ARGUMENTS` в Chrome. Затем:

1. Сделай скриншот и сохрани как `seo-audit-output/desktop-${DOMAIN}-${DATETIME}.png`

2. Выполни в консоли браузера для получения SEO-данных:
```javascript
JSON.stringify({
  title: document.title,
  titleLen: document.title.length,
  metaDesc: document.querySelector('meta[name="description"]')?.content,
  metaDescLen: document.querySelector('meta[name="description"]')?.content?.length,
  canonical: document.querySelector('link[rel=canonical]')?.href,
  robots: document.querySelector('meta[name="robots"]')?.content,
  lang: document.documentElement.lang,
  h1: [...document.querySelectorAll('h1')].map(h => h.textContent.trim()),
  h2count: document.querySelectorAll('h2').length,
  h3count: document.querySelectorAll('h3').length,
  imgsNoAlt: document.querySelectorAll('img:not([alt])').length,
  imgsEmptyAlt: document.querySelectorAll('img[alt=""]').length,
  totalImgs: document.querySelectorAll('img').length,
  brokenImgs: [...document.querySelectorAll('img')].filter(i => !i.complete || i.naturalWidth === 0).length,
  internalLinks: new Set([...document.querySelectorAll('a[href]')].map(a => a.href).filter(h => h.startsWith(location.origin))).size,
  externalLinks: [...document.querySelectorAll('a[href]')].filter(a => a.href && !a.href.startsWith(location.origin) && a.href.startsWith('http')).length,
  nofollowLinks: document.querySelectorAll('a[rel*=nofollow]').length,
  schemaTypes: [...document.querySelectorAll('script[type="application/ld+json"]')].map(s => { try { const d = JSON.parse(s.textContent); return d['@type']; } catch(e) { return 'parse_error'; } }),
  ogTitle: document.querySelector('meta[property="og:title"]')?.content,
  ogImage: document.querySelector('meta[property="og:image"]')?.content,
  twitterCard: document.querySelector('meta[name="twitter:card"]')?.content,
  hasViewport: !!document.querySelector('meta[name=viewport]'),
  pageSize: document.documentElement.innerHTML.length,
  jsErrors: window.__seoErrors || []
}, null, 2)
```

3. Проверь JS-ошибки в консоли (красные сообщения)

4. Сравни: если JS-рендеринг изменил title/H1/контент по сравнению с WebFetch — это **JS-зависимый сайт** (критично для SEO)

### 2.2 Мобильный вид
Эмулируй мобильное устройство (открой DevTools → Toggle Device Toolbar → выбери "iPhone 14" или viewport 390×844). Затем:
1. Перезагрузи страницу
2. Сделай скриншот → `seo-audit-output/mobile-${DOMAIN}-${DATETIME}.png`
3. Проверь: текст читаем, кнопки ≥ 48px, нет горизонтального скролла

### 2.3 Проверка Lighthouse (если доступен)
```bash
lighthouse "$ARGUMENTS" \
  --output json \
  --chrome-flags="--headless=new" \
  --only-categories=seo,performance,accessibility,best-practices \
  --output-path seo-audit-output/lighthouse.json \
  --quiet 2>/dev/null && echo "Lighthouse OK" || echo "Lighthouse not installed"
```

Если Lighthouse доступен — извлеки оценки из JSON:
```bash
cat seo-audit-output/lighthouse.json | node -e "
const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
const cats = d.categories;
console.log('SEO:', Math.round(cats.seo?.score*100));
console.log('Performance:', Math.round(cats.performance?.score*100));
console.log('Accessibility:', Math.round(cats.accessibility?.score*100));
console.log('Best Practices:', Math.round(cats['best-practices']?.score*100));
" 2>/dev/null
```

### 2.4 Проверка дополнительных страниц
Для 2–3 URL из sitemap повтори шаги 1.3 и 2.1 (без скриншотов).

---

## Фаза 3 — Формирование данных отчёта

Собери все данные в JSON-файл `seo-audit-output/report-data.json` со структурой:

```json
{
  "url": "$ARGUMENTS",
  "date": "YYYY-MM-DD HH:MM",
  "summary": {
    "summary": "2-3 предложения об общем состоянии SEO сайта",
    "pagesAnalyzed": N,
    "critical": N,
    "warnings": N,
    "ok": N
  },
  "scores": {
    "Мета-теги": N,
    "Структура контента": N,
    "Технические факторы": N,
    "Мобильность": N,
    "Скорость загрузки": N,
    "Open Graph / Соцсети": N,
    "Структурированные данные": N
  },
  "recommendations": [
    { "title": "...", "description": "..." }
  ],
  "pages": [
    {
      "url": "...",
      "issues": [
        { "severity": "critical|warning|info|ok", "msg": "..." }
      ]
    }
  ],
  "technical": [
    { "check": "HTTPS", "status": "ok|warning|critical", "value": "..." },
    { "check": "robots.txt", "status": "...", "value": "..." },
    { "check": "sitemap.xml", "status": "...", "value": "..." },
    { "check": "TTFB", "status": "...", "value": "..." },
    { "check": "Gzip/Brotli", "status": "...", "value": "..." },
    { "check": "Canonical", "status": "...", "value": "..." },
    { "check": "Schema.org", "status": "...", "value": "..." },
    { "check": "Open Graph", "status": "...", "value": "..." },
    { "check": "Mobile viewport", "status": "...", "value": "..." },
    { "check": "lang атрибут", "status": "...", "value": "..." }
  ]
}
```

Заполни корректными значениями на основе всех собранных данных. Оценки выставляй по шкале 1–10.

---

## Фаза 4 — Генерация отчётов

### Markdown-отчёт
Создай `seo-audit-output/${REPORT_BASE}.md` с содержимым:

```markdown
# SEO Аудит: [ДОМЕН]
**Дата**: [дата] | **Инструмент**: Claude Code SEO Audit Skill

## Исполнительное резюме
[summary из данных]

## Оценки
| Категория | Оценка | |
|-----------|--------|---|
[строки с оценками и эмодзи-индикаторами]

## 🔴 Критические ошибки
[список]

## 🟡 Предупреждения
[список]

## 🟢 Что работает хорошо
[список]

## Приоритетный план действий
[нумерованный список рекомендаций]

## Технические детали
[таблица всех проверок]

## Скриншоты
- Desktop: seo-audit-output/desktop.png
- Mobile: seo-audit-output/mobile.png
```

### HTML + PDF отчёт
```bash
# Генерация HTML и PDF через Chrome
node "$(dirname "$0")/generate-report.js" \
  seo-audit-output/report-data.json \
  seo-audit-output
```

---

## Результат

После завершения сообщи пользователю:

```
✅ SEO-аудит завершён

Проверено страниц: N
🔴 Критических: N
🟡 Предупреждений: N

Файлы:
  seo-audit-output/${REPORT_BASE}.md          — Markdown
  seo-audit-output/${REPORT_BASE}.html        — HTML (открыть в браузере)
  seo-audit-output/${REPORT_BASE}.pdf         — PDF
  seo-audit-output/desktop-${DOMAIN}-${DATETIME}.png — скриншот десктоп
  seo-audit-output/mobile-${DOMAIN}-${DATETIME}.png  — скриншот мобильный

Топ-3 приоритетных исправления:
1. ...
2. ...
3. ...
```
