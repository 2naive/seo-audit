---
name: seo-audit
description: Full SEO audit — meta tags, JS-rendered content, Core Web Vitals, E-E-A-T, internal links, schema, analytics checks. Generates Markdown + HTML + PDF report.
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

Определи корень проекта и создай рабочую директорию:
```bash
# Корень проекта — CWD при запуске скилла (не папка самого скилла)
PROJECT_DIR=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
OUTPUT_DIR="${PROJECT_DIR}/seo-audit-output"
mkdir -p "$OUTPUT_DIR"

SITE_URL="$ARGUMENTS"
DOMAIN=$(echo "$SITE_URL" | sed 's|https\?://||' | sed 's|/.*||')
DATETIME=$(date +"%Y-%m-%d-%H%M")
REPORT_BASE="seo-report-${DOMAIN}-${DATETIME}"

# Полные пути к файлам — используй их везде далее
REPORT_JSON="${OUTPUT_DIR}/report-data-${DOMAIN}-${DATETIME}.json"
REPORT_MD="${OUTPUT_DIR}/${REPORT_BASE}.md"
```

Все выходные файлы этого запуска:
- `${OUTPUT_DIR}/${REPORT_BASE}.md`
- `${OUTPUT_DIR}/${REPORT_BASE}.html`  (генерируется через generate-report.js)
- `${OUTPUT_DIR}/${REPORT_BASE}.pdf`   (генерируется через generate-report.js)
- `${OUTPUT_DIR}/report-data-${DOMAIN}-${DATETIME}.json`
- `${OUTPUT_DIR}/desktop-${DOMAIN}-${DATETIME}.png`
- `${OUTPUT_DIR}/mobile-${DOMAIN}-${DATETIME}.png`

**Важно**: никогда не используй относительные пути `seo-audit-output/...` — только абсолютные через `${OUTPUT_DIR}/...`.

---

## Фаза 1 — Статичные технические проверки (WebFetch + Bash)

### 1.1 robots.txt
Получи `$ARGUMENTS/robots.txt` через WebFetch. Проверь:
- Есть ли блокировка важных путей (`Disallow: /`)
- Указана ли директива `Sitemap:` (с актуальным URL)
- Закрыты ли от индексации: поиск по сайту, страницы сортировки/фильтрации, корзина, личные кабинеты, версии для печати, PDF-файлы
- Нет ли инструкций, которые случайно закрывают CSS/JS файлы (например, `Disallow: */?`)
- Директива `Host:` корректна (без www, https)

### 1.2 sitemap.xml
Получи `$ARGUMENTS/sitemap.xml` через WebFetch. Проверь:
- Формат валиден (XML)
- Количество URL (менее 8 — очень мало для коммерческого сайта)
- Нет ли в sitemap редиректов (3xx) или несуществующих страниц (4xx)
- Присутствует ли `<lastmod>` и `<priority>`
- Извлеки до 5 внутренних URL для дальнейшей проверки страниц

### 1.3 Проверка www и протокола (зеркала)
```bash
# Проверка www → non-www редиректа
curl -sI "https://www.${DOMAIN}" | grep -Ei "HTTP|Location" 2>/dev/null

# Проверка http → https редиректа
curl -sI "http://${DOMAIN}" | grep -Ei "HTTP|Location" 2>/dev/null
```
Ожидаемый результат: оба варианта дают 301 на основной хост (`https://${DOMAIN}`).

### 1.4 Проверка страницы 404
```bash
curl -sI "$ARGUMENTS/this-page-does-not-exist-12345" | grep -Ei "HTTP" 2>/dev/null
```
Проверь: сервер должен вернуть 404, а не 200 или редирект.

### 1.5 Raw HTML главной страницы
Получи `$ARGUMENTS` через WebFetch (raw HTML до JS-рендеринга). Проверь:

**Мета-теги:**
- `<title>` — длина 30–60 символов, уникальный, ключевое слово ближе к началу
- `<meta name="description">` — длина 70–160 символов, содержит призыв к действию
- `<link rel="canonical">` — совпадает с текущим URL, без GET-параметров
- `<meta name="robots">` — нет `noindex` на важных страницах
- `<html lang="...">` — указан язык (ru-RU для русскоязычных)
- `<meta name="viewport">` — обязателен для мобильных
- `<meta charset="UTF-8">` — кодировка указана

**Социальные теги:**
- Open Graph: `og:title`, `og:description`, `og:image` (1200×630px), `og:type`, `og:url`, `og:locale`
- Twitter Card: `twitter:card`, `twitter:title`, `twitter:image`

**Аналитика и верификация:**
- Наличие кода Яндекс.Метрики (mc.yandex.ru или metrika.yandex.ru)
- Наличие Google Analytics / GTM (googletagmanager.com или google-analytics.com)
- Верификация Яндекс.Вебмастера (`<meta name="yandex-verification">`)
- Верификация Google Search Console (`<meta name="google-site-verification">`)

**Schema.org:**
- `<script type="application/ld+json">` — какие типы присутствуют
- Обязательно для коммерческих сайтов: Organization (с адресом и телефоном), WebSite
- Желательно: BreadcrumbList, LocalBusiness / MedicalWebPage (для фармы), FAQ

**Структура контента:**
- H1–H6 иерархия: ровно один H1, логичная структура H2/H3
- Изображения без `alt` или с пустым `alt=""`
- Наличие хлебных крошек (breadcrumbs) в HTML

**E-E-A-T сигналы:**
- Есть ли ссылки на страницы «О компании», «Контакты», «FAQ»
- Есть ли информация об авторах/специалистах
- Есть ли страница с юридической информацией / политикой конфиденциальности

### 1.6 URL-структура
Проверь на главной и 2–3 страницах из sitemap:
- URL содержит только латиницу в нижнем регистре и цифры (без кириллицы)
- Слова разделены дефисами, не подчёркиваниями
- URL заканчиваются на `/` (если без расширения), нет дублей со слэшем и без
- ЧПУ (человеко-понятные URL), не числовые идентификаторы

### 1.7 Технические HTTP-заголовки
```bash
# Полные заголовки ответа
curl -sI "$ARGUMENTS" 2>/dev/null

# Скорость ответа (TTFB)
curl -o /dev/null -s -w "DNS:%{time_namelookup}s Connect:%{time_connect}s TTFB:%{time_starttransfer}s Total:%{time_total}s\n" "$ARGUMENTS" 2>/dev/null

# Сжатие gzip/brotli
curl -sI -H "Accept-Encoding: gzip, br" "$ARGUMENTS" | grep -i "content-encoding" 2>/dev/null
```

Проверь следующие заголовки:
- **Content-Encoding**: gzip или br — должен присутствовать
- **Strict-Transport-Security (HSTS)**: `max-age=31536000; includeSubDomains`
- **X-Frame-Options**: `SAMEORIGIN` (защита от кликджекинга)
- **Content-Security-Policy**: желательно для безопасности
- **Cache-Control**: для HTML — `max-age` минимум 3600, для статики — 31536000
- **Last-Modified / ETag**: должны присутствовать для корректного кэширования
- **Content-Type**: должен содержать `charset=utf-8`

### 1.8 Проверка дополнительных страниц
Для 2–3 URL из sitemap получи raw HTML через WebFetch. На каждой проверь:
- title (уникальный, не дублирует другие страницы)
- meta description (уникальная, 70–160 символов)
- количество H1 (ровно один)
- canonical (совпадает с URL страницы)
- наличие хлебных крошек

---

## Фаза 2 — Браузерный анализ (Chrome)

### 2.1 Десктоп — главная страница
Перейди на `$ARGUMENTS` в Chrome. Затем:

1. Сделай скриншот → `seo-audit-output/desktop-${DOMAIN}-${DATETIME}.png`

2. Выполни в консоли браузера:
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
  externalNoFollow: [...document.querySelectorAll('a[href]')].filter(a => a.href && !a.href.startsWith(location.origin) && a.href.startsWith('http') && (a.rel||'').includes('nofollow')).length,
  nofollowLinks: document.querySelectorAll('a[rel*=nofollow]').length,
  schemaTypes: [...document.querySelectorAll('script[type="application/ld+json"]')].map(s => { try { const d = JSON.parse(s.textContent); return d['@type']; } catch(e) { return 'parse_error'; } }),
  hasBreadcrumbs: !!document.querySelector('[itemtype*="BreadcrumbList"], .breadcrumb, .breadcrumbs, nav[aria-label*="breadcrumb" i]'),
  hasNavMenu: !!document.querySelector('nav, [role=navigation]'),
  ogTitle: document.querySelector('meta[property="og:title"]')?.content,
  ogImage: document.querySelector('meta[property="og:image"]')?.content,
  twitterCard: document.querySelector('meta[name="twitter:card"]')?.content,
  hasViewport: !!document.querySelector('meta[name=viewport]'),
  hasYandexMetrika: !!document.querySelector('script[src*="mc.yandex"], script[src*="metrika.yandex"]') || document.documentElement.innerHTML.includes('ym('),
  hasGTM: document.documentElement.innerHTML.includes('googletagmanager'),
  pageSize: document.documentElement.innerHTML.length,
  hasAboutPage: [...document.querySelectorAll('a[href]')].some(a => /o-kompanii|about|о-компании/i.test(a.href)),
  hasFAQ: [...document.querySelectorAll('a[href]')].some(a => /faq|chasto|вопрос/i.test(a.href)) || !!document.querySelector('[itemtype*="FAQPage"], .faq'),
  hasContacts: [...document.querySelectorAll('a[href]')].some(a => /kontakt|contact/i.test(a.href)),
  hasPrivacyPolicy: [...document.querySelectorAll('a[href]')].some(a => /privacy|policy|konfidencialnost|политик/i.test(a.href + a.textContent)),
  jsErrors: window.__seoErrors || []
}, null, 2)
```

3. Проверь JS-ошибки в консоли (красные сообщения)

4. Сравни title/H1/meta description с WebFetch — если изменились, сайт **JS-зависимый** (критично для индексации Яндексом)

5. Проверь внутренние ссылки на качество анкоров:
```javascript
// Примеры внутренних ссылок с их текстами
[...document.querySelectorAll('a[href]')]
  .filter(a => a.href.startsWith(location.origin) && a.textContent.trim())
  .slice(0, 20)
  .map(a => ({ text: a.textContent.trim().slice(0, 50), href: a.pathname }))
```

### 2.2 Мобильный вид
Эмулируй мобильное устройство (DevTools → Toggle Device Toolbar → iPhone 14, viewport 390×844). Затем:
1. Перезагрузи страницу
2. Сделай скриншот → `seo-audit-output/mobile-${DOMAIN}-${DATETIME}.png`
3. Проверь: текст читаем (≥ 12px), кнопки ≥ 48px, нет горизонтального скролла, шрифты не слишком мелкие

### 2.3 Проверка Lighthouse
```bash
lighthouse --version 2>/dev/null && echo "LIGHTHOUSE_OK" || echo "LIGHTHOUSE_MISSING"
```

**Если Lighthouse установлен** (`LIGHTHOUSE_OK`):
```bash
lighthouse "$ARGUMENTS" \
  --output json \
  --chrome-flags="--headless=new" \
  --only-categories=seo,performance,accessibility,best-practices \
  --output-path "${OUTPUT_DIR}/lighthouse-${DOMAIN}-${DATETIME}.json" \
  --quiet 2>/dev/null

node -e "
const d = JSON.parse(require('fs').readFileSync('${OUTPUT_DIR}/lighthouse-${DOMAIN}-${DATETIME}.json','utf8'));
const cats = d.categories;
const aud = d.audits;
console.log(JSON.stringify({
  performance: Math.round((cats.performance?.score||0)*100),
  seo: Math.round((cats.seo?.score||0)*100),
  accessibility: Math.round((cats.accessibility?.score||0)*100),
  bestPractices: Math.round((cats['best-practices']?.score||0)*100),
  metrics: {
    FCP: aud['first-contentful-paint']?.displayValue,
    LCP: aud['largest-contentful-paint']?.displayValue,
    TBT: aud['total-blocking-time']?.displayValue,
    CLS: aud['cumulative-layout-shift']?.displayValue,
    SI:  aud['speed-index']?.displayValue,
    TTI: aud['interactive']?.displayValue
  }
}));
" 2>/dev/null
```

Сохрани результат в поле `lighthouse` в `report-data.json`.

**Если Lighthouse НЕ установлен** — запиши в JSON:
```json
"lighthouse": { "available": false }
```
И отметь в отчёте: `ℹ️ Lighthouse не установлен — установи через: npm install -g lighthouse`

### 2.4 Проверка дополнительных страниц
Для 2–3 URL из sitemap — повтори шаги 1.5 и консольный скрипт из 2.1 (без скриншотов).

### 2.5 Проверка Schema.org (детальная)
На главной проверь полноту Schema.org разметки:
```javascript
[...document.querySelectorAll('script[type="application/ld+json"]')]
  .map(s => { try { return JSON.parse(s.textContent); } catch(e) { return null; } })
  .filter(Boolean)
```
Для фармацевтических/медицинских сайтов проверь наличие:
- `Organization` — с `name`, `url`, `telephone`, `address` (PostalAddress)
- `MedicalWebPage` или `Drug` — для страниц препаратов
- `BreadcrumbList` — на внутренних страницах
- `FAQPage` — если есть блок FAQ на странице
- `Article` / `BlogPosting` — на информационных страницах

---

## Фаза 3 — Формирование данных отчёта

Собери все данные в JSON-файл `${REPORT_JSON}` (полный путь из инициализации).

**Важно**: каждая рекомендация должна содержать:
- `priority`: "high" | "medium" | "low" — влияние на ранжирование
- `difficulty`: "low" | "medium" | "high" — сложность внесения правок
- `fix`: краткий пример решения (код или конкретное действие)

```json
{
  "url": "$ARGUMENTS",
  "date": "YYYY-MM-DD HH:MM",
  "mode": "full | basic",
  "summary": {
    "summary": "2-3 предложения об общем состоянии SEO",
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
    "Структурированные данные": N,
    "E-E-A-T и контент": N,
    "Внутренняя перелинковка": N,
    "Аналитика": N
  },
  "recommendations": [
    {
      "title": "Название рекомендации",
      "description": "Описание проблемы и её влияние на SEO",
      "priority": "high",
      "difficulty": "low",
      "fix": "Конкретный пример: nginx.conf — добавить gzip on; или код Schema.org"
    }
  ],
  "pages": [
    {
      "url": "...",
      "issues": [
        { "severity": "critical|warning|info|ok", "msg": "..." }
      ]
    }
  ],
  "scoreDetails": {
    "Мета-теги": ["✅ title 57 симв.", "🔴 description 276 симв. (норма 70-160)", "✅ canonical корректный"],
    "Структура контента": ["🔴 H1 отсутствует на главной", "✅ H2/H3 структура есть"],
    "Технические факторы": ["🔴 gzip отключён", "⚠️ TTFB 482ms", "✅ HTTPS, редиректы OK"],
    "Мобильность": ["✅ viewport корректный", "⚠️ 3 кнопки < 48px", "✅ нет горизонтального скролла"],
    "Скорость загрузки": ["⚠️ TTFB: 482ms (норма <200ms)", "🔴 gzip отключён", "⚠️ HTML 99KB без сжатия", "⚠️ Cache-Control max-age=3"],
    "Open Graph / Соцсети": ["🔴 og:title отсутствует", "🔴 og:image отсутствует"],
    "Структурированные данные": ["✅ WebPage, BreadcrumbList", "⚠️ нет Organization с адресом", "⚠️ нет Drug/MedicalWebPage"],
    "E-E-A-T и контент": ["⚠️ нет страницы О компании", "⚠️ нет FAQ", "✅ политика конфиденциальности есть"],
    "Внутренняя перелинковка": ["✅ навигационное меню есть", "⚠️ нет хлебных крошек", "✅ 47 внутренних ссылок"],
    "Аналитика": ["✅ Яндекс.Метрика установлена", "⚠️ GSC верификация не найдена"]
  },
  "lighthouse": {
    "available": true,
    "performance": 72,
    "seo": 85,
    "accessibility": 68,
    "bestPractices": 79,
    "metrics": {
      "FCP": "1.2 s",
      "LCP": "3.4 s",
      "TBT": "120 ms",
      "CLS": "0.05",
      "SI": "2.1 s",
      "TTI": "3.8 s"
    }
  },
  "technical": [
    { "check": "HTTPS", "status": "ok|warning|critical|info", "value": "..." },
    { "check": "www → non-www редирект", "status": "...", "value": "..." },
    { "check": "http → https редирект", "status": "...", "value": "..." },
    { "check": "robots.txt", "status": "...", "value": "..." },
    { "check": "sitemap.xml", "status": "...", "value": "..." },
    { "check": "Страница 404", "status": "...", "value": "..." },
    { "check": "TTFB", "status": "...", "value": "..." },
    { "check": "Gzip/Brotli", "status": "...", "value": "..." },
    { "check": "HSTS", "status": "...", "value": "..." },
    { "check": "X-Frame-Options", "status": "...", "value": "..." },
    { "check": "Cache-Control", "status": "...", "value": "..." },
    { "check": "Last-Modified / ETag", "status": "...", "value": "..." },
    { "check": "Canonical", "status": "...", "value": "..." },
    { "check": "H1 структура", "status": "...", "value": "..." },
    { "check": "Meta description длина", "status": "...", "value": "..." },
    { "check": "Open Graph", "status": "...", "value": "..." },
    { "check": "Twitter Card", "status": "...", "value": "..." },
    { "check": "Schema.org", "status": "...", "value": "..." },
    { "check": "Mobile viewport", "status": "...", "value": "..." },
    { "check": "JS-зависимость контента", "status": "...", "value": "..." },
    { "check": "lang атрибут", "status": "...", "value": "..." },
    { "check": "Яндекс.Метрика", "status": "...", "value": "..." },
    { "check": "Google Analytics / GTM", "status": "...", "value": "..." },
    { "check": "Яндекс.Вебмастер (верификация)", "status": "...", "value": "..." },
    { "check": "Хлебные крошки", "status": "...", "value": "..." },
    { "check": "E-E-A-T: О компании", "status": "...", "value": "..." },
    { "check": "E-E-A-T: FAQ", "status": "...", "value": "..." },
    { "check": "URL структура", "status": "...", "value": "..." },
    { "check": "Сервер", "status": "info", "value": "..." }
  ]
}
```

Заполни корректными значениями. Оценки — по шкале 1–10. При отсутствии данных используй null.

---

## Фаза 4 — Генерация отчётов

### Markdown-отчёт
Создай `seo-audit-output/${REPORT_BASE}.md` со структурой:

```markdown
# SEO Аудит: [ДОМЕН]
**Дата**: [YYYY-MM-DD HH:MM] | **Сайт**: [URL] | **Инструмент**: SEO Audit от Nedzelsky.pro

> [⚠️ Базовый режим / ✅ Полный режим Chrome]

---

## Исполнительное резюме
[summary]

- **Проверено страниц**: N
- 🔴 **Критических**: N | 🟡 **Предупреждений**: N | 🟢 **Хорошо**: N

---

## Оценки по категориям
| Категория | Оценка | |
|-----------|--------|---|
[строки с оценками]

**Средняя оценка: X/10**

---

## 🔴 Критические ошибки
[по каждой: **Важность: Высокая** | **Сложность: Низкая/Средняя/Высокая** + описание + пример решения]

## 🟡 Предупреждения
[аналогично]

## 🟢 Что работает хорошо
[список]

---

## Приоритетный план действий
[нумерованный список: 1. [СРОЧНО/ВЫСОКИЙ/СРЕДНИЙ] Название — описание — пример исправления]

---

## Технические детали
[полная таблица проверок]

---

## Анализ по страницам
[по каждой проверенной странице]

---

## Скриншоты
- Desktop: [путь]
- Mobile: [путь]
```

### HTML + PDF отчёт
```bash
# generate-report.js находится рядом со SKILL.md в .claude/skills/seo-audit/
node "${PROJECT_DIR}/.claude/skills/seo-audit/generate-report.js" "${REPORT_JSON}" "${OUTPUT_DIR}"
```

---

## Результат

После завершения сообщи пользователю:

```
✅ SEO-аудит завершён

Сайт: $ARGUMENTS
Режим: [Полный Chrome / Базовый]
Проверено страниц: N
🔴 Критических: N  🟡 Предупреждений: N  🟢 Хорошо: N

Файлы:
  seo-audit-output/${REPORT_BASE}.md          — Markdown
  seo-audit-output/${REPORT_BASE}.html        — HTML (открыть в браузере)
  seo-audit-output/${REPORT_BASE}.pdf         — PDF
  seo-audit-output/desktop-${DOMAIN}-${DATETIME}.png — скриншот десктоп
  seo-audit-output/mobile-${DOMAIN}-${DATETIME}.png  — скриншот мобильный

Топ-3 приоритетных исправления:
1. [СРОЧНО, сложность: низкая] ...
2. [СРОЧНО, сложность: средняя] ...
3. [ВЫСОКИЙ, сложность: низкая] ...
```
