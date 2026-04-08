---
name: seo-audit
description: Full SEO audit — meta tags, JS-rendered content, Core Web Vitals, E-E-A-T, internal links, schema, analytics checks. Generates Markdown + HTML + PDF report.
argument-hint: "[URL сайта]"
allowed-tools: Bash WebFetch Read Write mcp__claude-in-chrome__navigate mcp__claude-in-chrome__javascript_tool mcp__claude-in-chrome__computer mcp__claude-in-chrome__tabs_context_mcp mcp__claude-in-chrome__tabs_create_mcp mcp__claude-in-chrome__get_page_text mcp__claude-in-chrome__read_console_messages
context: fork
agent: general-purpose
---

Выполни полный SEO-аудит сайта **$ARGUMENTS** и сформируй отчёт.

Дата проведения: !`date +"%Y-%m-%d %H:%M"`

---

## Шаг 0 — Проверка Claude in Chrome

**Перед любыми другими действиями** проверь доступность Chrome-интеграции.

Выбери вкладку для аудита — **не создавай новую без необходимости**:

1. Вызови `mcp__claude-in-chrome__tabs_context_mcp` — получи список открытых вкладок
2. Выбери tabId по приоритету:
   - **Приоритет 1**: вкладка с URL `about:blank` или `chrome://newtab/` — переиспользовать
   - **Приоритет 2**: вкладка с тем же доменом что в `$ARGUMENTS` — переиспользовать
   - **Приоритет 3**: если все вкладки содержат важный контент пользователя — только тогда создай новую через `mcp__claude-in-chrome__tabs_create_mcp`
3. Выполни `mcp__claude-in-chrome__navigate` с выбранным tabId и URL `$ARGUMENTS`
4. Сохрани этот tabId — используй его во всех последующих шагах фазы 2

По завершении аудита (после генерации отчётов) — верни вкладку на `about:blank`:
`mcp__claude-in-chrome__navigate` → tabId, url: `about:blank`

### Если mcp__claude-in-chrome__tabs_context_mcp недоступен или navigate вернул ошибку подключения:

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

### Если navigate выполнился успешно:

Выведи: `✅ Chrome подключён — tabId: [N], запускаю полный аудит`

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
- `${OUTPUT_DIR}/mobile-${DOMAIN}-${DATETIME}.jpg`  (извлекается из Lighthouse JSON)

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
- Нет ли в sitemap редиректов (3xx) или несуществующих страниц (4xx) — проверь HEAD-запросом для 3–5 URL из sitemap:
  ```bash
  # Проверка статусов + цепочек редиректов (num_redirects > 1 = цепочка, теряется link juice)
  for URL in "URL1" "URL2" "URL3"; do
    curl -sLI -o /dev/null -w "$URL → HTTP %{http_code}, редиректов: %{num_redirects}, итог: %{url_effective}\n" "$URL"
  done
  ```
  Если `num_redirects > 1` — это цепочка A→B→C, фиксируй как warning с конкретными URL.
- Нет ли технических/мусорных URL: `*.php?id=`, `?PHPSESSID=`, `/wp-admin/`, `/feed/`, `/tag/`
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

**⚠️ Важно:** если `www.${DOMAIN}` вообще не отвечает (connection refused / timeout) — это **Critical**: поисковики могут считать www и non-www разными сайтами, что влечёт дублирование или потерю части трафика. Фиксируй в отчёте как `status: "critical"`, `value: "www не отвечает совсем — нет DNS-записи или сервер не слушает"`.  
Если http не редиректит на https — тоже **Critical** (утечка трафика).

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
# Полные заголовки ответа + определение CMS/сервера
curl -sI "$ARGUMENTS" 2>/dev/null

# Скорость ответа (TTFB)
curl -o /dev/null -s -w "DNS:%{time_namelookup}s Connect:%{time_connect}s TTFB:%{time_starttransfer}s Total:%{time_total}s\n" "$ARGUMENTS" 2>/dev/null

# Сжатие gzip/brotli
curl -sI -H "Accept-Encoding: gzip, br" "$ARGUMENTS" | grep -i "content-encoding" 2>/dev/null

# Cache-Control по типам ресурсов (HTML, CSS, JS, изображения)
CSS_URL=$(curl -s "$ARGUMENTS" | grep -oP '(?<=href=")[^"]+\.css[^"]*' | head -1) && [ -n "$CSS_URL" ] && curl -sI "${CSS_URL#/}" 2>/dev/null | grep -i "cache-control" || true
JS_URL=$(curl -s "$ARGUMENTS" | grep -oP '(?<=src=")[^"]+\.js[^"]*' | head -1) && [ -n "$JS_URL" ] && curl -sI "${JS_URL#/}" 2>/dev/null | grep -i "cache-control" || true
IMG_URL=$(curl -s "$ARGUMENTS" | grep -oP '(?<=src=")[^"]+\.(jpg|png|webp|svg)[^"]*' | head -1) && [ -n "$IMG_URL" ] && curl -sI "${IMG_URL#/}" 2>/dev/null | grep -i "cache-control" || true
```

Проверь следующие заголовки:
- **Content-Encoding**: gzip или br — должен присутствовать
- **Strict-Transport-Security (HSTS)**: `max-age=31536000; includeSubDomains`
- **X-Frame-Options**: `SAMEORIGIN` (защита от кликджекинга)
- **Content-Security-Policy**: желательно для безопасности
- **Cache-Control по типам**: HTML — `public, max-age=3600`; CSS/JS — `max-age=31536000, immutable`; изображения — `max-age=2592000`; если везде `no-store` или `no-cache` — критично
- **Last-Modified / ETag**: должны присутствовать для корректного кэширования
- **Content-Type**: должен содержать `charset=utf-8`
- **X-Powered-By / Server**: определи CMS и сервер (Bitrix → `X-Powered-By: PHP`, WordPress → `/wp-content/`, Tilda, 1C-Битрикс, и т.д.) — укажи в поле `cmsInfo`

### 1.8 Проверка дополнительных страниц
Для 2–3 URL из sitemap получи raw HTML через WebFetch. На каждой проверь:
- title (уникальный, не дублирует другие страницы)
- meta description (уникальная, 70–160 символов)
- количество H1 (ровно один)
- canonical (совпадает с URL страницы)
- наличие хлебных крошек
- дата публикации / обновления (`<time datetime>`, meta, видимый текст) — важный E-E-A-T сигнал

**После проверки всех страниц** сравни title между собой — если два title совпадают полностью, это дубль (критично). Аналогично для description.

### 1.9 Дополнительные структурные проверки
Для главной страницы через WebFetch проверь:
- Идентификаторы сессий в URL: нет ли `?PHPSESSID=`, `?sid=`, `?session=` в ссылках (засоряют индекс)
- Страницы пагинации: если есть `/page/`, `/p/` — проверь, что title/canonical не дублируют главную
- HTML-карта сайта: проверь `/sitemap/`, `/map/`, `/html-sitemap` — нужна ли она
- Страница «О компании»: если нашлась — получи её через WebFetch и проверь наличие: история компании, специализация, контактные данные, упоминание сотрудников/специалистов
- Политика конфиденциальности: проверь наличие и актуальность (год в тексте)

---

## Фаза 2 — Браузерный анализ (Chrome)

### 2.1 Десктоп — главная страница
Перейди на `$ARGUMENTS` через `mcp__claude-in-chrome__navigate` (используй tabId из шага 0). Дождись загрузки страницы.

**Десктоп-скриншот делается через локальный headless Chrome CLI**, не через `mcp__claude-in-chrome__computer`. Причина: MCP-инструмент возвращает изображение только в контекст LLM, без доступа к raw-байтам, которые можно записать в файл. Поэтому единственный надёжный способ — запустить headless Chrome с **изолированным временным профилем**, чтобы избежать контаминации (пример: дефолтный профиль может открывать стартовую страницу другого сайта вместо `$ARGUMENTS`).

**⛔ ЗАПРЕЩЕНО**:
- Использовать Lighthouse `final-screenshot` для десктопа (Lighthouse снимает только мобильный viewport 412px)
- Использовать headless Chrome без `--user-data-dir=$(mktemp -d)` (контаминация дефолтным профилем приведёт к скриншоту чужого сайта)
- Переименовывать существующий файл из предыдущего аудита

1. **Десктоп-скриншот через headless Chrome с изолированным профилем**:
   ```bash
   CHROME_BIN=$(ls "C:/Program Files/Google/Chrome/Application/chrome.exe" "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" /usr/bin/google-chrome 2>/dev/null | head -1)
   FRESH_PROFILE=$(mktemp -d)
   DESKTOP_PNG="${OUTPUT_DIR}/desktop-${DOMAIN}-${DATETIME}.png"
   # Перед снятием — удалить файл по этому пути, если уже существует (защита от reuse)
   rm -f "$DESKTOP_PNG"
   "$CHROME_BIN" --headless=new --disable-gpu --no-sandbox \
     --user-data-dir="$FRESH_PROFILE" \
     --no-first-run --no-default-browser-check \
     --hide-scrollbars \
     --window-size=1440,900 \
     --screenshot="$DESKTOP_PNG" \
     "$ARGUMENTS" 2>&1 | tail -5
   rm -rf "$FRESH_PROFILE"
   ls -lh "$DESKTOP_PNG"
   ```

   **Ключевые флаги**:
   - `--user-data-dir=$(mktemp -d)` — свежий пустой профиль, не подхватит чужую стартовую страницу
   - `--no-first-run --no-default-browser-check` — не показывать диалоги первого запуска
   - URL `$ARGUMENTS` передаётся последним аргументом — Chrome принудительно навигируется туда
   - `rm -f "$DESKTOP_PNG"` перед — гарантирует что в случае ошибки Chrome файл будет отсутствовать (а не остаться от прошлого аудита)

   Финальная проверка валидности файла — в шаге **2.6** (после Lighthouse).

2. Выполни через `mcp__claude-in-chrome__javascript_tool` (используй тот же tabId):
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
  h2texts: [...document.querySelectorAll('h2')].map(h => h.textContent.trim().slice(0, 80)).slice(0, 15),
  h3texts: [...document.querySelectorAll('h3')].map(h => h.textContent.trim().slice(0, 80)).slice(0, 10),
  h2count: document.querySelectorAll('h2').length,
  h3count: document.querySelectorAll('h3').length,
  imgsNoAlt: document.querySelectorAll('img:not([alt])').length,
  imgsEmptyAlt: document.querySelectorAll('img[alt=""]').length,
  totalImgs: document.querySelectorAll('img').length,
  brokenImgs: [...document.querySelectorAll('img')].filter(i => !i.complete || i.naturalWidth === 0).length,
  brokenImgSrcs: [...document.querySelectorAll('img')].filter(i => !i.complete || i.naturalWidth === 0).map(i => i.src).slice(0, 10),
  imgDetails: [...document.querySelectorAll('img')].slice(0, 10).map(i => ({ src: i.src.replace(location.origin,'').slice(0,60), alt: i.alt || null, hasDimensions: !!(i.width && i.height) })),
  internalLinks: new Set([...document.querySelectorAll('a[href]')].map(a => a.href).filter(h => h.startsWith(location.origin))).size,
  externalLinks: [...document.querySelectorAll('a[href]')].filter(a => a.href && !a.href.startsWith(location.origin) && a.href.startsWith('http')).length,
  externalNoFollow: [...document.querySelectorAll('a[href]')].filter(a => a.href && !a.href.startsWith(location.origin) && a.href.startsWith('http') && (a.rel||'').includes('nofollow')).length,
  nofollowLinks: document.querySelectorAll('a[rel*=nofollow]').length,
  anchorFrequency: (() => { const freq = {}; [...document.querySelectorAll('a[href]')].filter(a => a.href.startsWith(location.origin)).forEach(a => { const t = a.textContent.trim().slice(0,40); if (t) freq[t] = (freq[t]||0)+1; }); return Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,15).map(([text,count])=>({text,count})); })(),
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
  ogLocale: document.querySelector('meta[property="og:locale"]')?.content,
  ogType: document.querySelector('meta[property="og:type"]')?.content,
  ogUrl: document.querySelector('meta[property="og:url"]')?.content,
  hasFooter: !!document.querySelector('footer, [role=contentinfo]'),
  footerLinksCount: document.querySelectorAll('footer a[href], [role=contentinfo] a[href]').length,
  footerHasAddress: !!document.querySelector('footer address, [role=contentinfo] address, footer [itemtype*="PostalAddress"]'),
  footerHasPhone: /\+7|8\s*\(|тел\.|phone/i.test(document.querySelector('footer, [role=contentinfo]')?.textContent || ''),
  navMenuItems: [...document.querySelectorAll('nav a[href], [role=navigation] a[href]')].filter(a => a.href.startsWith(location.origin)).map(a => ({ text: a.textContent.trim().slice(0, 40), path: a.pathname })).slice(0, 15),
  ctaAboveFold: (() => { const fold = window.innerHeight; return [...document.querySelectorAll('button, a.btn, a[class*="cta"], a[class*="button"], input[type=submit], [role=button]')].filter(el => { const r = el.getBoundingClientRect(); return r.top < fold && r.width > 0; }).map(el => el.textContent.trim().slice(0,40)).slice(0,5); })(),
  smallFontElements: [...document.querySelectorAll('p, span, div, li, td')].filter(el => { const fs = parseFloat(window.getComputedStyle(el).fontSize); return fs > 0 && fs < 12 && el.textContent.trim().length > 10; }).length,
  publishDate: document.querySelector('time[datetime], meta[property="article:published_time"], meta[name="date"]')?.getAttribute('datetime') || document.querySelector('time[datetime]')?.dateTime,
  updateDate: document.querySelector('meta[property="article:modified_time"], time[itemprop="dateModified"]')?.content || document.querySelector('time[itemprop="dateModified"]')?.dateTime,
  authorName: document.querySelector('[itemprop="author"] [itemprop="name"], .author, [rel=author]')?.textContent?.trim(),
  jsErrors: window.__seoErrors || []
}, null, 2)
```

3. Проверь JS-ошибки в консоли через `mcp__claude-in-chrome__read_console_messages`

4. Сравни title/H1/meta description с WebFetch — если изменились, сайт **JS-зависимый** (критично для индексации Яндексом)

5. Проверь скрытый контент и нулевые ссылки:
```javascript
JSON.stringify({
  hiddenTextElements: [...document.querySelectorAll('*')].filter(el => {
    const s = window.getComputedStyle(el);
    return el.textContent.trim().length > 20 && (
      s.display === 'none' || s.visibility === 'hidden' ||
      parseFloat(s.fontSize) < 5 || s.color === s.backgroundColor
    );
  }).map(el => ({ tag: el.tagName, text: el.textContent.trim().slice(0, 80) })).slice(0, 5),
  zeroSizeLinks: [...document.querySelectorAll('a[href]')].filter(a => {
    const r = a.getBoundingClientRect(); return r.width < 2 && r.height < 2;
  }).length,
  zeroSizeLinkHrefs: [...document.querySelectorAll('a[href]')].filter(a => {
    const r = a.getBoundingClientRect(); return r.width < 2 && r.height < 2;
  }).map(a => a.href.replace(location.origin,'')).slice(0, 10)
})
```

Анализируй `anchorFrequency` из шага 2 — если текст «подробнее», «здесь», «нажмите» встречается часто, это плохие анкоры. Конкретные ключевые слова — хорошие.

### 2.2 Мобильный вид

**Скриншот мобильного вида берётся из Lighthouse (шаг 2.3)** — Lighthouse запускается в мобильном viewport 412px и сохраняет `final-screenshot` в JSON. Извлечение в файл выполняется автоматически после Lighthouse.

Здесь только JS-проверка мобильной вёрстки через `mcp__claude-in-chrome__javascript_tool`:
```javascript
JSON.stringify({
  viewportWidth: window.innerWidth,
  hasHorizontalScroll: document.body.scrollWidth > window.innerWidth,
  smallButtons: [...document.querySelectorAll('button,a,input[type=submit],[role=button]')]
    .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height < 44; }).length
})
```
Ожидаемо: `viewportWidth` ≈ 390, `hasHorizontalScroll: false`.

### 2.3 Lighthouse
```bash
# Установить если отсутствует
lighthouse --version 2>/dev/null || npm install -g lighthouse
```

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
// Блокирующие скрипты из main-thread-work-breakdown
const mainThread = aud['main-thread-work-breakdown']?.details?.items || [];
const blockingScripts = (aud['render-blocking-resources']?.details?.items || [])
  .map(i => ({ url: (i.url||'').replace(/^https?:\/\/[^/]+/,'').slice(0,60), duration: i.wastedMs ? Math.round(i.wastedMs)+'ms' : null }))
  .slice(0,5);
// Возможности оптимизации изображений
const imgOpts = (aud['uses-optimized-images']?.details?.items || [])
  .map(i => ({ url: (i.url||'').replace(/^https?:\/\/[^/]+/,'').slice(0,60), savings: i.wastedBytes ? Math.round(i.wastedBytes/1024)+'KB' : null }))
  .slice(0,5);
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
  },
  blockingScripts,
  imgOptimizations: imgOpts,
  bfcacheFailures: (aud['bf-cache']?.details?.items||[]).map(i=>i.reason).slice(0,3),
  accessibilityIssues: (aud['color-contrast']?.score===0 ? ['color-contrast: 0'] : [])
    .concat(aud['image-alt']?.score===0 ? ['image-alt: 0'] : [])
    .concat(aud['link-name']?.score===0 ? ['link-name: 0'] : [])
}));
" 2>/dev/null
```

Сохрани результат в поле `lighthouse` в `report-data.json`.

**Извлечение мобильного скриншота** из Lighthouse JSON (Lighthouse снимает в viewport 412px):
```bash
node -e "
const lh = JSON.parse(require('fs').readFileSync('${OUTPUT_DIR}/lighthouse-${DOMAIN}-${DATETIME}.json', 'utf8'));
const shot = lh.audits['final-screenshot']?.details?.data;
if (shot) {
  const b64 = shot.replace('data:image/jpeg;base64,', '');
  require('fs').writeFileSync('${OUTPUT_DIR}/mobile-${DOMAIN}-${DATETIME}.jpg', Buffer.from(b64, 'base64'));
  console.log('Mobile screenshot saved:', '${OUTPUT_DIR}/mobile-${DOMAIN}-${DATETIME}.jpg');
} else {
  console.log('No final-screenshot in Lighthouse JSON — mobile screenshot skipped');
}
"
```

### 2.6 Финальная валидация скриншотов (ОБЯЗАТЕЛЬНО)

**Это контрольная точка перед Фазой 3.** Запускается после того как desktop (шаг 2.1) и mobile (шаг 2.3) сохранены. Запрещает любые попытки обойти проверки расширением файла или подменой источника.

```bash
node -e "
const fs = require('fs');
const crypto = require('crypto');
const desktopPath  = '${OUTPUT_DIR}/desktop-${DOMAIN}-${DATETIME}.png';
const mobilePath   = '${OUTPUT_DIR}/mobile-${DOMAIN}-${DATETIME}.jpg';
const lighthouseJson = '${OUTPUT_DIR}/lighthouse-${DOMAIN}-${DATETIME}.json';

// 1. Десктоп должен существовать ИМЕННО как .png
if (!fs.existsSync(desktopPath)) {
  console.error('FAIL: десктоп-скриншот не найден по пути ' + desktopPath);
  console.error('Десктоп должен быть сохранён через headless Chrome CLI с --user-data-dir=\$(mktemp -d) (шаг 2.1).');
  process.exit(1);
}

const dStat = fs.statSync(desktopPath);
const dBuf = fs.readFileSync(desktopPath);

// 2. mtime: файл ОБЯЗАН быть создан в текущей сессии (новее чем lighthouse JSON или mobile JPG этой сессии)
const referenceTime = fs.existsSync(lighthouseJson)
  ? fs.statSync(lighthouseJson).mtimeMs
  : (fs.existsSync(mobilePath) ? fs.statSync(mobilePath).mtimeMs : Date.now() - 600000);
if (dStat.mtimeMs < referenceTime - 1000) {
  console.error('FAIL: ' + desktopPath + ' имеет mtime ' + new Date(dStat.mtimeMs).toISOString());
  console.error('Это раньше чем lighthouse JSON / mobile-screenshot этой сессии (' + new Date(referenceTime).toISOString() + ').');
  console.error('Файл остался от ПРЕДЫДУЩЕГО аудита и не был перезаписан. Скорее всего headless Chrome упал или подхватил чужой профиль.');
  console.error('Удали файл и пересними десктоп через headless Chrome с --user-data-dir=\$(mktemp -d) (см. шаг 2.1).');
  process.exit(1);
}

// 3. Десктоп — настоящий PNG
const isPNG = dBuf[0]===0x89 && dBuf[1]===0x50 && dBuf[2]===0x4e && dBuf[3]===0x47;
if (!isPNG) {
  console.error('FAIL: ' + desktopPath + ' имеет magic bytes ' + dBuf.slice(0,4).toString('hex') + ', не PNG (89504e47).');
  process.exit(1);
}

// 4. Десктоп достаточно большой (1440×900 viewport → обычно > 50KB)
if (dBuf.length < 50000) {
  console.error('FAIL: десктоп-скриншот ' + dBuf.length + ' bytes < 50KB. Скорее всего headless Chrome не смог снять страницу.');
  process.exit(1);
}

// 5. Если мобильный есть — сравнить MD5. Идентичные файлы = агент использовал один источник
if (fs.existsSync(mobilePath)) {
  const mBuf = fs.readFileSync(mobilePath);
  const dHash = crypto.createHash('md5').update(dBuf).digest('hex');
  const mHash = crypto.createHash('md5').update(mBuf).digest('hex');
  if (dHash === mHash) {
    console.error('FAIL: desktop и mobile имеют одинаковый MD5 (' + dHash + ').');
    console.error('Один источник для обоих — это нарушение. Пересними десктоп.');
    process.exit(1);
  }
  console.log('OK: desktop ' + dBuf.length + 'B (PNG, MD5 ' + dHash.slice(0,8) + ', mtime ' + new Date(dStat.mtimeMs).toISOString() + '), mobile ' + mBuf.length + 'B (JPG, MD5 ' + mHash.slice(0,8) + ')');
} else {
  console.log('OK: desktop ' + dBuf.length + 'B (PNG, mtime ' + new Date(dStat.mtimeMs).toISOString() + '), mobile отсутствует');
}
"
```

**Если этот скрипт упал** — НЕ продолжай к Фазе 3. Вернись к шагу 2.1 и пересними десктоп через `mcp__claude-in-chrome__computer`. Никаких обходных путей: расширение должно быть `.png`, источник — Chrome Extension, не Lighthouse.

### 2.4 Проверка дополнительных страниц
Для 2–3 URL из sitemap — перейди через `mcp__claude-in-chrome__navigate` и повтори консольный скрипт из 2.1 через `mcp__claude-in-chrome__javascript_tool` (без скриншотов).

### 2.5 Проверка Schema.org (детальная)
На главной проверь и валидируй Schema.org через `mcp__claude-in-chrome__javascript_tool`:
```javascript
JSON.stringify((() => {
  const schemas = [...document.querySelectorAll('script[type="application/ld+json"]')]
    .map(s => { try { return JSON.parse(s.textContent); } catch(e) { return null; } })
    .filter(Boolean);
  const required = {
    Organization: ['name','url','telephone','address'],
    WebSite: ['name','url','potentialAction'],
    BreadcrumbList: ['itemListElement'],
    FAQPage: ['mainEntity'],
    LocalBusiness: ['name','address','telephone'],
    Article: ['headline','datePublished','author'],
    BlogPosting: ['headline','datePublished','author'],
    Product: ['name','offers'],
    Service: ['name','provider']
  };
  return schemas.map(s => {
    const type = s['@type'];
    const missing = (required[type] || []).filter(f => !s[f]);
    return { type, missing, hasAll: missing.length === 0, fields: Object.keys(s) };
  });
})())
```
Используй результат для формирования конкретных рекомендаций:
- Для каждого типа с `missing` — дай готовый JSON-LD с заполненными недостающими полями
- Если `Organization` найдена, но нет `telephone` или `address.streetAddress` — критично
- Если `WebSite` есть, но нет `potentialAction` — упущен Sitelinks Searchbox

Укажи ссылки на валидацию в рекомендациях:
- Google Rich Results Test: `https://search.google.com/test/rich-results`
- Яндекс Валидатор разметки: `https://webmaster.yandex.ru/tools/microtest/`

---

## Фаза 3 — Формирование данных отчёта

Собери все данные в JSON-файл `${REPORT_JSON}` (полный путь из инициализации).

**Важно по `screenshotPaths`**: используй абсолютные пути к реально сохранённым PNG-файлам. Если файл не был создан (базовый режим без Chrome), укажи `null`. generate-report.js встроит изображения в HTML/PDF через base64.

**Важно по качеству рекомендаций:**
- Не объединяй разные проблемы в одну рекомендацию. Примеры неверных объединений:
  - ❌ "Исправить meta description" — если на одних страницах description слишком длинный, а на других отсутствует, это **две отдельные рекомендации**
  - ❌ "Добавить хлебные крошки" — если на некоторых страницах они есть, укажи конкретно на каких нет
- `fix` должен содержать **конкретный пример** для данного сайта, не общую фразу. Например: `"Сократить с 203 до 130 символов: «API ЕГРЮЛ и ЕГРИП — бесплатный сервис для проверки компаний по ИНН, ОГРН»"`
- Для Schema.org всегда давай **готовый JSON-LD код** (не ссылку на документацию)
- Для nginx/Apache всегда указывай **блок контекста** (`server {}`, `location /`)
- Для битых изображений — указывай конкретный `src` из `brokenImgSrcs`, не общую инструкцию
- Для нулевых ссылок — указывай конкретные href из `zeroSizeLinkHrefs`, не "проверить в DevTools"

**Обязательное правило полноты**: каждый `status: "critical"` или `status: "warning"` в массиве `technical` **обязан** иметь соответствующую запись в `recommendations`. Перед финализацией JSON пройдись по всем элементам `technical` и убедись что для каждого critical/warning есть рекомендация.

**Дедупликация**: одна проблема должна упоминаться в ONE месте. Если проблема попала в `scoreDetails`, не дублируй её полностью в `pages[].issues` — только конкретный URL и краткий факт. В `recommendations` — один раз с полным описанием и `fix`.

**Важно**: каждая рекомендация должна содержать:
- `priority`: "high" | "medium" | "low" — влияние на ранжирование
- `difficulty`: "low" | "medium" | "high" — сложность внесения правок
- `fix`: конкретный пример решения для данного сайта (код или текст)

```json
{
  "url": "$ARGUMENTS",
  "date": "YYYY-MM-DD HH:MM",
  "mode": "full | basic",
  "skillVersion": "1.5.3",
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
  "cmsInfo": "WordPress / Bitrix / Tilda / Custom / unknown",
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
    },
    "blockingScripts": [{ "url": "/js/main.js", "duration": "340ms" }],
    "imgOptimizations": [{ "url": "/img/hero.jpg", "savings": "120KB" }],
    "bfcacheFailures": ["unload-listener", "cache-control-no-store"]
  },
  "screenshotPaths": {
    "desktop": "${OUTPUT_DIR}/desktop-${DOMAIN}-${DATETIME}.png",  // PNG из Chrome Extension (шаг 2.1)
    "mobile": "${OUTPUT_DIR}/mobile-${DOMAIN}-${DATETIME}.jpg"     // JPG из Lighthouse final-screenshot (шаг 2.3)
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
    { "check": "Сервер", "status": "info", "value": "..." },
    { "check": "Дублирующиеся title", "status": "...", "value": "..." },
    { "check": "Дублирующиеся description", "status": "...", "value": "..." },
    { "check": "Скрытый контент (hidden text)", "status": "...", "value": "..." },
    { "check": "Session ID в URL", "status": "...", "value": "..." },
    { "check": "Качество анкоров внутренних ссылок", "status": "...", "value": "..." },
    { "check": "Яндекс.Вебмастер (верификация)", "status": "...", "value": "..." },
    { "check": "og:locale", "status": "...", "value": "..." },
    { "check": "Навигационное меню", "status": "...", "value": "N пунктов" },
    { "check": "Подвал (footer)", "status": "...", "value": "N ссылок, телефон: да/нет, адрес: да/нет" },
    { "check": "www — доступность", "status": "...", "value": "301 → non-www / не отвечает / нет DNS" },
    { "check": "Мусорные URL в sitemap", "status": "...", "value": "..." }
  ]
}
```

Заполни корректными значениями. Оценки — по шкале 1–10. При отсутствии данных используй null.

**Требование к `scoreDetails`**: поле обязательно для каждой категории в `scores`. Каждый элемент — конкретный факт с иконкой статуса (✅/🔴/⚠️), например: `"✅ title 52 симв."`, `"🔴 description 285 симв. (норма 70-160)"`. Не оставляй пустые массивы.

---

## Фаза 4 — Генерация отчётов

### Markdown-отчёт
Создай `seo-audit-output/${REPORT_BASE}.md` со структурой:

```markdown
# SEO Аудит: [ДОМЕН]
**Дата**: [YYYY-MM-DD HH:MM] | **Сайт**: [URL] | **Инструмент**: itsoft.ru pharm-studio.ru nedzelsky.pro

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
  seo-audit-output/desktop-${DOMAIN}-${DATETIME}.png — скриншот десктоп (Claude Chrome)
  seo-audit-output/mobile-${DOMAIN}-${DATETIME}.jpg  — скриншот мобильный (из Lighthouse)

Топ-3 приоритетных исправления:
1. [СРОЧНО, сложность: низкая] ...
2. [СРОЧНО, сложность: средняя] ...
3. [ВЫСОКИЙ, сложность: низкая] ...
```
