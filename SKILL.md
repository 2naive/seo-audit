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

По завершении аудита (после генерации отчётов) — верни вкладку на `chrome://newtab/`:
`mcp__claude-in-chrome__navigate` → tabId, url: `chrome://newtab/`

⚠️ Не используй `about:blank` — `mcp__claude-in-chrome__navigate` отвергает такие URL.

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
- `${OUTPUT_DIR}/desktop-${DOMAIN}-${DATETIME}.jpg`  (Lighthouse desktop preset, шаг 2.3)
- `${OUTPUT_DIR}/mobile-${DOMAIN}-${DATETIME}.jpg`   (Lighthouse mobile final-screenshot, шаг 2.3)

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
- **AI-краулеры** (1.1.8): не заблокированы ли `GPTBot`, `ClaudeBot`, `OAI-SearchBot`, `PerplexityBot`, `Googlebot-Extended`, `Bingbot`, `Applebot-Extended`, `CCBot`. Для большинства коммерческих сайтов их блокировка нежелательна — сайт исключается из обучающих выборок и AI-ответов. Зафиксируй какие найдены в `Disallow:` или `Allow:` явно.

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

### 1.4 Проверка страницы 404 + soft 404
```bash
# HTTP-код несуществующей страницы
curl -sI "$ARGUMENTS/this-page-does-not-exist-12345" | grep -Ei "HTTP" 2>/dev/null

# Soft 404: страница может вернуть HTTP 200 но в теле «не найдено» — критично (1.5.2)
curl -s "$ARGUMENTS/this-page-does-not-exist-12345" | grep -iE "(не\s*найден|page\s*not\s*found|404)" | head -3
```
Проверь:
- Сервер должен вернуть 404, а не 200 или редирект
- **Soft 404** — если код 200, но в теле есть «не найдено / Page Not Found / 404» — это critical, Google понижает такие страницы в индексе и тратит краулинговый бюджет

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

# HTTP/2 / HTTP/3 detection (3.5.1)
curl -sI --http2 "$ARGUMENTS" 2>/dev/null | head -1   # ожидаем "HTTP/2 200"
curl -sI --http3 "$ARGUMENTS" 2>/dev/null | head -1   # если поддерживается — "HTTP/3 200"

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
- Страницы пагинации: если есть `/page/`, `/p/`, `?page=` (13.3) — получи 1–2 такие страницы через WebFetch и проверь:
  - Title и description не дублируют первую страницу (должно быть «Каталог — страница 2» или подобное)
  - Canonical указывает **на саму себя** (страница 2), не на страницу 1
  - Реализована через HTML `<a href>`, а не только JS-инфинити-скролл
- HTML-карта сайта: проверь `/sitemap/`, `/map/`, `/html-sitemap` — нужна ли она
- Страница «О компании»: если нашлась — получи её через WebFetch и проверь наличие: история компании, специализация, контактные данные, упоминание сотрудников/специалистов
- Политика конфиденциальности: проверь наличие и актуальность (год в тексте)

### 1.10 AI-эра: llms.txt и hreflang
```bash
# llms.txt — экспериментальный стандарт для AI-руководства (21.3.5)
curl -sI "$ARGUMENTS/llms.txt" 2>/dev/null | head -1
curl -sI "$ARGUMENTS/llms-full.txt" 2>/dev/null | head -1
```
- `llms.txt` (200) — присутствует, фиксируй как `info` (best practice для AI-эры)
- 404 — фиксируй как `info`, не warning (стандарт ещё в драфте)

**Hreflang** (Блок 16, применимо только если найден `<link rel="alternate" hreflang>` в шаге 1.5 raw HTML):
- Если на сайте только `lang="ru"` и нет hreflang-тегов — пропусти Блок 16, отметь как «не применимо» в `coverage`
- Если найдены hreflang — проверь:
  - Двунаправленность: каждая локаль ссылается на все версии (включая `x-default`)
  - Корректные ISO-коды (`ru-RU`, `en-US`)
  - Hreflang не конфликтует с canonical
  - Один метод реализации: HTML или sitemap, без смешивания

### 1.11 Orphan pages (детектор)
**Только если sitemap.xml доступен** — собери два множества и сравни:
```bash
# Получи список URL из sitemap (первые 50)
curl -s "$ARGUMENTS/sitemap.xml" | grep -oP '(?<=<loc>)[^<]+' | head -50 > /tmp/sitemap-urls.txt
# Получи внутренние ссылки с главной
# (это уже собирается в шаге 2.1 как internalLinks/navMenuItems — используй эти данные)
```
- **Orphan candidates** = URL из sitemap, на которые НЕ ссылается ни главная, ни подвал, ни навигация (9.2.1)
- Это эвристика: для полной проверки нужен краулер по всему сайту, но даже базовое сравнение с главной даёт ценные находки

---

## Фаза 2 — Браузерный анализ (Chrome)

### 2.1 Десктоп — главная страница
Перейди на `$ARGUMENTS` через `mcp__claude-in-chrome__navigate` (используй tabId из шага 0). Дождись загрузки страницы.

**Десктоп-скриншот** делается через **отдельный запуск Lighthouse с `--preset=desktop`**. Причина: `mcp__claude-in-chrome__computer` возвращает изображение только в контекст LLM (raw-байты недоступны для записи через Write); локальный headless Chrome с `--screenshot=` молча падает на Windows когда уже запущен Claude Chrome Extension (тот занимает процессную группу). Lighthouse desktop preset — единственный надёжный способ получить уникальный десктопный скриншот в этой среде.

**⛔ ЗАПРЕЩЕНО**:
- Использовать Lighthouse mobile `final-screenshot` для десктопа (это мобильный viewport 412px — будет идентичен `mobile-*.jpg`)
- Полагаться на headless Chrome `--screenshot=` — на Windows + Claude Extension это не работает
- Переименовывать существующий файл из предыдущего аудита

1. **Десктоп-скриншот через Lighthouse desktop preset**:

   Этот шаг ОТЛОЖЕН до шага 2.3 — там запускается Lighthouse мобильный, а сразу после — второй запуск с `--preset=desktop`. См. шаг 2.3.

   На этом этапе (2.1) только убедись что вкладка с `$ARGUMENTS` активна и работает (для шага 2 — JS-сборщик).

   ⚠️ **Node.js на Windows**: внутри `node -e` всегда используй пути в формате `C:/Users/...` (forward slashes с буквой диска). НЕ `/c/Users/...` (Node не интерпретирует msys-префикс) и НЕ `C:\Users\...` (бэкслеши ломают эскейпинг в bash).

   Финальная проверка валидности файла — в шаге **2.6** (после Lighthouse).

2. Выполни через `mcp__claude-in-chrome__javascript_tool` (используй тот же tabId):

⚠️ **Важно: `mcp__claude-in-chrome__javascript_tool` блокирует возврат строк, содержащих cookie/query-подобные паттерны** (например `PHPSESSID`, `JSESSIONID`, длинные параметрические URL). Если в твоём JS-скрипте `document.documentElement.innerHTML` или подобные «сырые» дампы — инструмент вернёт `[BLOCKED: Cookie/query string data]`. Поэтому:
- НЕ возвращай `innerHTML` целиком и не дампи длинные строки HTML
- Для проверки наличия Метрики/GTM используй точечно: `!!document.querySelector('script[src*="mc.yandex"]')` вместо `innerHTML.includes('ym(')`
- Если нужно проверить наличие подстроки в HTML — используй `.indexOf()` с разбиением: `'mc'+'.yandex'` (избегает прямого совпадения с фильтром инструмента)

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
  hasYandexMetrika: !!document.querySelector('script[src*="mc.yandex"], script[src*="metrika.yandex"]'),
  hasGTM: !!document.querySelector('script[src*="googletagmanager"]'),
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
  jsErrors: window.__seoErrors || [],

  // === v1.7.0: расширенный сбор по мастер-чеклисту ===

  // DOM size + depth (3.5.4 — норма ≤1500 узлов, ≤32 уровня)
  domSize: document.querySelectorAll('*').length,
  domDepth: (() => { let max = 0; const walk = (el, d) => { if (d > max) max = d; [...el.children].forEach(c => walk(c, d+1)); }; walk(document.body, 0); return max; })(),

  // Семантический HTML (17.3.6 — для GEO)
  semanticTags: {
    article: document.querySelectorAll('article').length,
    section: document.querySelectorAll('section').length,
    header: document.querySelectorAll('header').length,
    nav: document.querySelectorAll('nav').length,
    main: document.querySelectorAll('main').length,
    aside: document.querySelectorAll('aside').length,
    figure: document.querySelectorAll('figure').length
  },

  // Text/HTML ratio (21.3.3 — норма ≥15%)
  textHtmlRatio: (() => { const t = document.body.innerText.length; const h = document.documentElement.outerHTML.length; return h > 0 ? Math.round(t/h*100) : 0; })(),

  // Font-display (3.5.2 — должен быть swap или optional)
  fontDisplay: [...(document.fonts || [])].slice(0,10).map(f => ({ family: f.family, display: f.display, status: f.status })),

  // Формы — все ли action ведут на HTTPS (2.5.2)
  formsHttps: (() => { const forms = [...document.forms]; return { total: forms.length, httpsActions: forms.filter(f => !f.action || f.action.startsWith('https://') || f.action.startsWith('/')).length, insecureActions: forms.filter(f => f.action && f.action.startsWith('http://')).map(f => f.action).slice(0,3) }; })(),

  // Protocol-relative URLs (2.5.3 — //example.com небезопасно)
  protocolRelativeCount: [...document.querySelectorAll('[src^="//"], [href^="//"]')].length,

  // Cookie consent banner heuristic (13.6.2)
  hasCookieConsent: !!document.querySelector('[class*="cookie" i], [id*="cookie" i], [class*="consent" i], [id*="consent" i], [class*="gdpr" i]'),

  // AEO readiness (17.2.1, 17.2.2): первые 1-2 абзаца ≤60 слов + есть ли FAQ
  aeoReadiness: (() => { const firstP = document.querySelector('main p, article p, .content p, body p'); const wordCount = firstP ? firstP.textContent.trim().split(/\s+/).length : null; const hasFaqElement = !!document.querySelector('[class*="faq" i], [id*="faq" i], [itemtype*="FAQPage"]'); return { firstParagraphWords: wordCount, hasFaqSection: hasFaqElement }; })(),

  // Первые 100 слов содержат ли ключ из H1 (5.7.1)
  first100WordsHasH1Keyword: (() => { const h1 = document.querySelector('h1')?.textContent.trim().toLowerCase(); if (!h1) return null; const first100 = (document.body.innerText || '').trim().split(/\s+/).slice(0, 100).join(' ').toLowerCase(); const h1Words = h1.split(/\s+/).filter(w => w.length > 3); return h1Words.some(w => first100.includes(w)); })(),

  // Favicon (7.3.2)
  hasFavicon: !!document.querySelector('link[rel*="icon"]'),
  faviconHrefs: [...document.querySelectorAll('link[rel*="icon"]')].map(l => l.href.replace(location.origin,'')).slice(0,3)
}, null, 2)
```

3. Проверь JS-ошибки и **mixed content** в консоли через `mcp__claude-in-chrome__read_console_messages` (используй параметр `pattern` для фильтрации):
   - `pattern: "Mixed Content"` — Mixed Content warnings (HTTPS-страница загружает HTTP-ресурсы → 2.1.2 critical)
   - `pattern: "error"` — JS-ошибки
   - Фиксируй количество и первые 3 примера в `mixedContentIssues[]` поле

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

Здесь только JS-проверка мобильной вёрстки через `mcp__claude-in-chrome__javascript_tool`. Сравни `bodyTextLen` с тем же показателем из десктопного запуска шага 2.1 — резкое различие (>30%) сигнализирует о desktop/mobile content parity issue (4.3.2):

```javascript
JSON.stringify({
  viewportWidth: window.innerWidth,
  hasHorizontalScroll: document.body.scrollWidth > window.innerWidth,
  smallButtons: [...document.querySelectorAll('button,a,input[type=submit],[role=button]')]
    .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height < 44; }).length,
  // Tap target spacing (4.2.2 — соседние кликабельные элементы должны быть ≥8px друг от друга)
  closeTapTargets: (() => {
    const els = [...document.querySelectorAll('button,a,input[type=submit],[role=button]')]
      .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    let close = 0;
    for (let i = 0; i < els.length; i++) {
      const a = els[i].getBoundingClientRect();
      for (let j = i+1; j < els.length; j++) {
        const b = els[j].getBoundingClientRect();
        const dx = Math.max(0, Math.max(a.left - b.right, b.left - a.right));
        const dy = Math.max(0, Math.max(a.top - b.bottom, b.top - a.bottom));
        if (dx < 8 && dy < 8) { close++; break; }
      }
      if (close > 30) break;
    }
    return close;
  })(),
  // Mobile/desktop content parity (4.3.2)
  bodyTextLen: document.body.innerText.length,
  h1Count: document.querySelectorAll('h1').length,
  h2Count: document.querySelectorAll('h2').length,
  imgCount: document.querySelectorAll('img').length
})
```
Ожидаемо: `viewportWidth` ≈ 390, `hasHorizontalScroll: false`. Для оценки content parity сравни с десктопными показателями (`pageSize`, `h2count` из шага 2.1) — критично если мобильный показывает <70% контента десктопа.

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

**Второй запуск Lighthouse — desktop preset (для десктопного скриншота)**:
```bash
lighthouse "$ARGUMENTS" \
  --output json \
  --preset=desktop \
  --chrome-flags="--headless=new" \
  --only-categories=performance \
  --output-path "${OUTPUT_DIR}/lighthouse-desktop-${DOMAIN}-${DATETIME}.json" \
  --quiet 2>/dev/null
```

**Извлечение десктопного скриншота** из второго Lighthouse JSON (viewport 1350×940). Lighthouse desktop preset обычно отдаёт **WEBP** в `fullPageScreenshot`, реже JPEG/PNG — определяем расширение по mime-типу из data URI:
```bash
node -e "
const fs = require('fs');
const lh = JSON.parse(fs.readFileSync('${OUTPUT_DIR}/lighthouse-desktop-${DOMAIN}-${DATETIME}.json', 'utf8'));
const fullShot = lh.fullPageScreenshot?.screenshot?.data;
const finalShot = lh.audits['final-screenshot']?.details?.data;
const shot = fullShot || finalShot;
if (!shot) {
  console.error('FAIL: ни fullPageScreenshot ни final-screenshot не найдены в desktop Lighthouse JSON');
  process.exit(1);
}
// Определи формат из data URI: data:image/webp;base64,... или data:image/jpeg;base64,...
const mimeMatch = shot.match(/^data:image\/(\w+);base64,/);
const ext = mimeMatch ? mimeMatch[1].replace('jpeg','jpg') : 'jpg';
const b64 = shot.replace(/^data:image\/[^;]+;base64,/, '');
const outPath = '${OUTPUT_DIR}/desktop-${DOMAIN}-${DATETIME}.' + ext;
fs.writeFileSync(outPath, Buffer.from(b64, 'base64'));
console.log('Desktop screenshot saved:', outPath, '(' + Buffer.from(b64,'base64').length + ' bytes, format=' + ext + ')');
// Запиши путь в файл-маркер чтобы валидация шага 2.6 знала какое расширение использовать
fs.writeFileSync('${OUTPUT_DIR}/.desktop-ext-${DOMAIN}-${DATETIME}', ext);
"
```

После этого определи фактическое расширение десктопа:
```bash
DESKTOP_EXT=$(cat "${OUTPUT_DIR}/.desktop-ext-${DOMAIN}-${DATETIME}" 2>/dev/null || echo "jpg")
DESKTOP_FILE="${OUTPUT_DIR}/desktop-${DOMAIN}-${DATETIME}.${DESKTOP_EXT}"
echo "Desktop screenshot path: $DESKTOP_FILE"
```

Используй этот путь в `screenshotPaths.desktop` JSON. Десктоп **отличается** от мобильного по viewport (1350×940 vs 412×823) — валидация в шаге 2.6 проверит уникальность через MD5.

### 2.6 Финальная валидация скриншотов (ОБЯЗАТЕЛЬНО)

**Это контрольная точка перед Фазой 3.** Запускается после того как desktop (шаг 2.1) и mobile (шаг 2.3) сохранены. Запрещает любые попытки обойти проверки расширением файла или подменой источника.

```bash
node -e "
const fs = require('fs');
const crypto = require('crypto');
// Десктоп может быть .jpg / .webp / .png — найди существующий файл
const desktopBase = '${OUTPUT_DIR}/desktop-${DOMAIN}-${DATETIME}';
const desktopPath = ['.webp','.jpg','.jpeg','.png'].map(e => desktopBase + e).find(p => fs.existsSync(p));
const mobilePath  = '${OUTPUT_DIR}/mobile-${DOMAIN}-${DATETIME}.jpg';
const lighthouseJson = '${OUTPUT_DIR}/lighthouse-${DOMAIN}-${DATETIME}.json';

// 1. Десктоп должен существовать
if (!desktopPath) {
  console.error('FAIL: десктоп-скриншот не найден (искал ' + desktopBase + '.{webp,jpg,jpeg,png}).');
  console.error('Десктоп должен быть получен через второй запуск Lighthouse с --preset=desktop (шаг 2.3).');
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
  console.error('Это раньше чем mobile lighthouse JSON этой сессии (' + new Date(referenceTime).toISOString() + ').');
  console.error('Файл остался от ПРЕДЫДУЩЕГО аудита. Удали и пересними через шаг 2.3.');
  process.exit(1);
}

// 3. Десктоп — JPEG / PNG / WEBP (Lighthouse desktop preset обычно отдаёт WEBP)
const isJPEG = dBuf[0]===0xff && dBuf[1]===0xd8 && dBuf[2]===0xff;
const isPNG  = dBuf[0]===0x89 && dBuf[1]===0x50 && dBuf[2]===0x4e && dBuf[3]===0x47;
const isWEBP = dBuf[0]===0x52 && dBuf[1]===0x49 && dBuf[2]===0x46 && dBuf[3]===0x46 && dBuf[8]===0x57 && dBuf[9]===0x45 && dBuf[10]===0x42 && dBuf[11]===0x50;
const fmt = isJPEG ? 'JPEG' : isPNG ? 'PNG' : isWEBP ? 'WEBP' : null;
if (!fmt) {
  console.error('FAIL: ' + desktopPath + ' имеет magic bytes ' + dBuf.slice(0,12).toString('hex') + ', не JPEG/PNG/WEBP.');
  process.exit(1);
}

// 4. Десктоп достаточно большой (Lighthouse desktop fullPageScreenshot обычно > 30KB)
if (dBuf.length < 30000) {
  console.error('FAIL: десктоп-скриншот ' + dBuf.length + ' bytes < 30KB. Lighthouse desktop preset не вернул fullPageScreenshot.');
  process.exit(1);
}

// 5. Если мобильный есть — сравнить MD5. Идентичные = агент использовал ту же мобильную картинку
if (fs.existsSync(mobilePath)) {
  const mBuf = fs.readFileSync(mobilePath);
  const dHash = crypto.createHash('md5').update(dBuf).digest('hex');
  const mHash = crypto.createHash('md5').update(mBuf).digest('hex');
  if (dHash === mHash) {
    console.error('FAIL: desktop и mobile имеют одинаковый MD5 (' + dHash + ').');
    console.error('Скорее всего ты использовал mobile final-screenshot для десктопа. Запусти ВТОРОЙ Lighthouse с --preset=desktop (шаг 2.3) и извлеки fullPageScreenshot из desktop JSON.');
    process.exit(1);
  }
  console.log('OK: desktop ' + dBuf.length + 'B (' + fmt + ', MD5 ' + dHash.slice(0,8) + ', mtime ' + new Date(dStat.mtimeMs).toISOString() + '), mobile ' + mBuf.length + 'B (JPG, MD5 ' + mHash.slice(0,8) + ')');
} else {
  console.log('OK: desktop ' + dBuf.length + 'B (' + fmt + ', mtime ' + new Date(dStat.mtimeMs).toISOString() + '), mobile отсутствует');
}
"
```

**Если этот скрипт упал** — НЕ продолжай к Фазе 3. Вернись к шагу 2.3 и убедись что второй Lighthouse `--preset=desktop` отработал и `fullPageScreenshot` извлечён в `desktop-*.jpg`.

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

## Правила формирования рекомендаций (обязательные)

Эти правила определяют клиентское качество отчёта. Соблюдай каждое.

### Правило 1 — Каждая рекомендация имеет 7 обязательных полей

| Поле | Назначение | Пример |
|---|---|---|
| `title` | Повелительное наклонение, активный глагол | «Добавьте Schema.org Organization на главную» (не «Рекомендуется рассмотреть...») |
| `description` | Что именно не так — конкретные числа/URL для **этого** сайта | «JSON-LD разметка отсутствует на 3/3 проверенных страниц. Title главной 105 символов — обрезается в SERP после 60-го» |
| `impact` | **Бизнес-последствие**, не технический факт | ✅ «Без Schema.org теряете блок Sitelinks Searchbox в Google и Knowledge Panel — CTR в SERP падает на 5–15% по брендовым запросам». ❌ «Отсутствует Schema.org — нужно добавить Schema.org» |
| `priority` | high / medium / low — влияние на ранжирование | high — критично для индексации/доверия; medium — заметное влияние; low — улучшение |
| `difficulty` | low / medium / high | low — правка одного файла; medium — несколько файлов; high — структурные изменения |
| `effortHours` | человеко-часы из таблицы | low → "1–2 часа", medium → "4–8 часов", high → "1–3 дня" |
| `fix` | **Готовый код** для копирования, не инструкция | ✅ полный nginx-блок с `add_header`. ❌ «настройте HSTS в nginx» |

Дополнительные поля (рекомендуется):
- `steps[]` — пошаговый план внедрения (3–5 шагов: «Открыть файл X», «Вставить блок Y», «Проверить через Z»)
- `verify` — команда `curl`, URL валидатора или DevTools-шаг для проверки что исправлено
- `category` — номер раздела мастер-чеклиста (`"6.1"`, `"2.2"`)
- `categoryLabel` — короткий лейбл для бейджа («Блок 6 · Schema.org»)
- `phase` — вычисляется автоматически, см. Правило 4
- `affectedUrls[]` — конкретные URL, на которых найдена проблема
- `sourceChecks[]` — массив `check`-имён из `technical[]`, на которые ссылается рекомендация

### Правило 2 — Запрет на технические тавтологии в `impact`

`impact` обязан быть **бизнес-формулировкой**. Запрещены формулировки вида «нужно добавить X», «отсутствует Y». Должно быть **последствие** для пользователя/SEO/бизнеса.

| ❌ Плохо (тавтология) | ✅ Хорошо (бизнес-эффект) |
|---|---|
| «Не настроен HSTS» | «При первом визите пользователь уязвим к downgrade-атаке (man-in-the-middle), что может привести к перехвату cookies сессии» |
| «Title слишком длинный» | «Title обрезается в SERP после 60 символов — пользователь не видит ключевые слова в конце, CTR падает» |
| «Нет Schema.org BreadcrumbList» | «Google не строит хлебные крошки в SERP — потеря визуального якоря и кликабельности результата» |

### Правило 3 — Дедупликация по URL

Если одна проблема обнаружена на N страницах — это **одна** рекомендация с массивом `affectedUrls[]`, не N копий.

❌ Неправильно:
```
1. Добавить canonical на /page1
2. Добавить canonical на /page2
3. Добавить canonical на /page3
```
✅ Правильно:
```
1. Добавить canonical на 3 страницы
   affectedUrls: ["/page1", "/page2", "/page3"]
```

Исключение: если решение принципиально разное для каждого URL (например, разные title-проблемы) — отдельные рекомендации.

### Правило 4 — Автоматическое назначение `phase`

| Условие | phase |
|---|---|
| `priority=high` + `difficulty=low` | `"urgent"` (1–2 недели) |
| `priority=high` + `difficulty=medium\|high` | `"month"` (в ближайший месяц) |
| `priority=medium` (любая сложность) | `"month"` |
| `priority=low` | `"strategy"` (1–3 месяца) |

Внутри фазы упорядочивай: `priority desc → difficulty asc → effortHours asc`.

### Правило 5 — Лимит 10–20 рекомендаций в отчёте

- Меньше 8 — проверь что не упустил важное (Schema.org, canonical, безопасность)
- Больше 20 — объедини похожие через `affectedUrls[]` или агрегируй мелкие в одну («Настроить security-заголовки» вместо отдельных HSTS, X-Frame, CSP)

### Правило 6 — Полнота: каждый critical/warning в `technical` имеет рекомендацию

Перед финализацией JSON пройдись по `technical[]`. Для каждого `status: "critical"` или `status: "warning"` обязательна запись в `recommendations[]` с соответствующим `sourceChecks[]`. Исключения — только `info`.

### Правило 7 — Формирование `strengths[]` (3–5 пунктов)

Топ-5 самых важных `ok`-проверок. Активная формулировка с конкретикой:
- ✅ «Скорость в зелёной зоне — LCP 1.1s, CLS 0, TBT 40ms»
- ✅ «Контент индексируется без JS-рендеринга — title/H1/meta идентичны в raw HTML и DOM»
- ❌ «Сайт работает по HTTPS» (слишком общё)

Приоритет источников: CWV → Schema.org валидна → корректные мета-теги → аналитика → безопасность.

### Правило 8 — Формирование `risks[]` (3–5 пунктов)

Топ-5 `critical` + `priority=high warning`. Формат «**бизнес-последствие → причина**»:
- ✅ «Потеря rich snippets и Knowledge Panel → отсутствует Schema.org Organization»
- ✅ «Юридический риск по 152-ФЗ → нет страницы политики конфиденциальности»
- ❌ «Нет HSTS» (только техфакт)

### Правило 9 — `executiveSummary.grade` (буквенная оценка)

| Средний score (0–10) | grade |
|---|---|
| ≥ 9.0 | A |
| 7.5–8.9 | B |
| 6.0–7.4 | C |
| 4.0–5.9 | D |
| < 4.0 | F |

`headline` — одна фраза с главным выводом. `onePhrase` — самая короткая суть для печати в обложке.

### Правило 10 — Сложение `coverage`

`coverage.blocksCovered` — массив номеров блоков мастер-чеклиста, которые скилл проверил автоматически (обычно: 1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 21).

### Правило 11 — Использование новых данных из siteData и pages[].metrics

При формировании рекомендаций обязательно проверяй и используй данные из v1.7.0+ полей. Это критично — без этих рекомендаций отчёт будет неполным.

| Поле | Условие | Рекомендация |
|---|---|---|
| `siteData.http2.version` | `"HTTP/1.1"` (не HTTP/2) | Включить HTTP/2 в nginx (`listen 443 ssl http2;`) — снижает RTT, мультиплексирование |
| `siteData.http2.http3` | `false` (по умолчанию) | (info) HTTP/3 — best practice |
| `siteData.aiCrawlers.notMentioned` | непустой и сайт коммерческий | Создать `llms.txt` или явно разрешить AI-краулеры в robots.txt — для AEO/GEO |
| `siteData.llmsTxt.exists` | `false` | (info) Создать `llms.txt` — экспериментальный стандарт для AI-руководства |
| `siteData.aiCrawlers.blocked` | непустой | Critical если случайно заблокированы Bingbot/Googlebot-Extended; warning если только AI |
| `siteData.mixedContent.count` | `> 0` | Critical: исправить HTTPS-страницу с HTTP-ресурсами (2.1.2) |
| `siteData.pagination.found && siteData.pagination.issues` | непустой | Исправить дубли title/canonical на страницах пагинации (13.3) |
| `siteData.orphanPages.found` | непустой | Добавить внутренние ссылки на orphan-страницы из главной/sitemap |
| `pages[].metrics.domSize` | `> 1500` | Уменьшить DOM (3.5.4) — производительность рендеринга |
| `pages[].metrics.domDepth` | `> 32` | Упростить вложенность (3.5.4) |
| `pages[].metrics.textHtmlRatio` | `< 15` | Контент потоплен кодом — рассмотреть упрощение шаблона (21.3.3) |
| `pages[].metrics.semanticTags.main` | `0` | Добавить `<main>` для GEO/доступности (17.3.6) |
| `pages[].metrics.aeoReadiness.firstParagraphWords` | `> 60` | AEO: сократить первый абзац до 60 слов — для AI-ответов (17.2.1) |
| `pages[].metrics.aeoReadiness.hasFaqSection` | `false` для коммерческого | Добавить FAQ-секцию + FAQPage Schema (17.2.2) |
| `pages[].metrics.first100WordsHasH1Keyword` | `false` | Ключ из H1 включить в первые 100 слов (5.7.1) |
| `pages[].metrics.hasFavicon` | `false` | Добавить favicon (7.3.2) |
| `pages[].metrics.hasCookieConsent` | `false` для EU/RU аудитории | Cookie consent banner (152-ФЗ / GDPR, 13.6.2) |
| `pages[].metrics.formsHttps.insecureActions` | непустой | Critical: HTTP-action в форме (2.5.2) |
| `pages[].metrics.protocolRelativeCount` | `> 0` | Заменить `//example.com` на `https://` (2.5.3) |
| `pages[].metrics.closeTapTargets` | `> 5` (mobile) | Увеличить расстояние между кликабельными элементами (4.2.2) |
| `pages[].metrics.fontDisplay` | элементы без `display: swap` | Добавить `font-display: swap` (3.5.2) |

**Сравнение mobile/desktop content parity** (4.3.2): сравни `pages[].metrics.bodyTextLen` (десктоп из 2.1) с `bodyTextLen` из 2.2 (mobile). Если `mobile < desktop * 0.7` — критично, mobile-first indexing будет видеть только урезанную версию.

### Правило 12 — Coverage блоков

`coverage.blocksManual` — блоки требующие ручной работы / доступа к внешним системам:
- Блок 8 (E-E-A-T — частично, экспертная оценка контента)
- Блок 14 (off-page / ссылочный профиль)
- Блок 15 (локальное SEO — GBP / Яндекс.Бизнес)
- Блок 16 (международное / hreflang — если применимо)
- Блок 18 (краулинговый бюджет — нужны логи)
- Блок 19 (мониторинг — операционная активность)
- Блок 20 (полный WCAG-аудит)

`notChecked[]` — короткий список конкретных проверок которые не выполнены автоматически (для раздела «Что не проверялось» в отчёте).

```json
{
  "url": "$ARGUMENTS",
  "date": "YYYY-MM-DD HH:MM",
  "mode": "full | basic",
  "skillVersion": "1.7.3",
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
  "executiveSummary": {
    "grade": "B",
    "headline": "Хороший технический базис, критические пробелы в Schema.org и безопасности",
    "onePhrase": "Технически сайт в форме, но три блокирующих пункта мешают индексации и доверию"
  },
  "strengths": [
    "Скорость в зелёной зоне — LCP 1.1s, CLS 0",
    "Open Graph полный, Twitter Card корректный",
    "Контент индексируется без JS-рендеринга — title/H1/desc одинаковы в raw HTML и после JS"
  ],
  "risks": [
    "Потеря rich snippets и Knowledge Panel — отсутствует Schema.org Organization",
    "Уязвимость к downgrade-атакам при первом визите — нет HSTS",
    "Юридический риск по 152-ФЗ — нет страницы политики конфиденциальности"
  ],
  "coverage": {
    "blocksCovered": ["1","2","3","4","5","6","7","9","10","11","12","13","21"],
    "blocksManual":  ["8","14","15","16","18","19","20"],
    "automatedCount": 13,
    "manualCount": 7
  },
  "notChecked": [
    "GSC Search Performance / индексация (требует доступ в Search Console)",
    "Ссылочный профиль и Disavow (требует Ahrefs/Semrush)",
    "Каннибализация ключевых запросов (требует GSC + ручную проверку)",
    "Hreflang при многоязычном сайте (если применимо)",
    "Локальное SEO: Google Business Profile / Яндекс.Бизнес"
  ],
  "recommendations": [
    {
      "title": "Название рекомендации (повелительное наклонение: Добавьте, Сократите)",
      "description": "Что именно не так — с конкретными числами/URL для данного сайта",
      "impact": "Бизнес-последствие: «Без Schema.org вы теряете блок Sitelinks Searchbox и rich snippets — CTR в SERP может упасть на 5-15% по брендовым запросам». НЕ технический факт типа «нужно добавить Schema.org».",
      "priority": "high",
      "difficulty": "low",
      "effortHours": "1-2 часа",
      "phase": "urgent",
      "category": "6.1",
      "categoryLabel": "Блок 6 · Schema.org",
      "steps": [
        "Открыть header.php (или соответствующий шаблон)",
        "В блок <head> вставить готовый JSON-LD из поля fix",
        "Заменить плейсхолдеры [телефон], [адрес] на реальные данные",
        "Залить на прод и проверить через Rich Results Test"
      ],
      "fix": "Готовый код для копирования: <script type=\"application/ld+json\">{...}</script>",
      "verify": "https://search.google.com/test/rich-results — вставить URL главной, должны появиться Organization и WebSite",
      "affectedUrls": ["https://example.com/", "https://example.com/services/"],
      "sourceChecks": ["Schema.org", "Структурированные данные"]
    }
  ],
  "pages": [
    {
      "url": "...",
      "template": "home | category | service | article | contacts | faq | other",
      "metrics": {
        "title": "...",
        "titleLen": 57,
        "metaDesc": "...",
        "metaDescLen": 128,
        "h1": "...",
        "h2Count": 7,
        "h3Count": 0,
        "canonical": "...",
        "hasSchema": true,
        "schemaTypes": ["Organization", "WebSite"],
        "hasBreadcrumbs": false,
        "hasOpenGraph": true,
        "imgsTotal": 31,
        "imgsNoAlt": 19,
        "imgsBroken": 2,
        "domSize": 1247,
        "domDepth": 22,
        "textHtmlRatio": 18,
        "semanticTags": { "article": 0, "section": 5, "header": 1, "nav": 2, "main": 1, "aside": 0, "figure": 3 },
        "first100WordsHasH1Keyword": true,
        "hasFavicon": true,
        "hasCookieConsent": false,
        "aeoReadiness": { "firstParagraphWords": 42, "hasFaqSection": false },
        "fontDisplay": [{ "family": "Roboto", "display": "swap" }],
        "formsHttps": { "total": 1, "httpsActions": 1, "insecureActions": [] },
        "protocolRelativeCount": 0,
        "closeTapTargets": 0,
        "bodyTextLen": 4521
      },
      "issues": [
        { "severity": "critical|warning|info|ok", "msg": "..." }
      ]
    }
  ],
  "siteData": {
    "llmsTxt": { "exists": false, "fullExists": false },
    "aiCrawlers": { "blocked": [], "allowed": [], "notMentioned": ["GPTBot","ClaudeBot","PerplexityBot","Googlebot-Extended"] },
    "hreflang": { "applicable": false, "tags": [], "issues": [] },
    "http2": { "version": "HTTP/2", "http3": false },
    "mixedContent": { "count": 0, "samples": [] },
    "pagination": { "found": false, "issues": [] },
    "orphanPages": { "found": [], "checkedAgainst": "main+nav+footer" }
  },
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
    "desktop": "${OUTPUT_DIR}/desktop-${DOMAIN}-${DATETIME}.{ext}",  // расширение зависит от формата Lighthouse desktop fullPageScreenshot: обычно .webp, реже .jpg
    "mobile": "${OUTPUT_DIR}/mobile-${DOMAIN}-${DATETIME}.jpg"       // JPG из Lighthouse mobile final-screenshot (шаг 2.3)
  },
  "technical": [
    { "check": "HTTPS", "block": "2.1", "status": "ok|warning|critical|info", "value": "..." },
    { "check": "www → non-www редирект", "block": "1.4", "status": "...", "value": "..." },
    { "check": "http → https редирект", "block": "1.4", "status": "...", "value": "..." },
    { "check": "robots.txt", "block": "1.1", "status": "...", "value": "..." },
    { "check": "sitemap.xml", "block": "1.2", "status": "...", "value": "..." },
    { "check": "Страница 404", "block": "1.5", "status": "...", "value": "..." },
    { "check": "TTFB", "block": "2.3", "status": "...", "value": "..." },
    { "check": "Gzip/Brotli", "block": "2.4", "status": "...", "value": "..." },
    { "check": "HSTS", "block": "2.2", "status": "...", "value": "..." },
    { "check": "X-Frame-Options", "block": "2.2", "status": "...", "value": "..." },
    { "check": "Content-Security-Policy", "block": "2.2", "status": "...", "value": "..." },
    { "check": "Cache-Control", "block": "2.2", "status": "...", "value": "..." },
    { "check": "Last-Modified / ETag", "block": "2.2", "status": "...", "value": "..." },
    { "check": "Canonical", "block": "5.3", "status": "...", "value": "..." },
    { "check": "H1 структура", "block": "5.5", "status": "...", "value": "..." },
    { "check": "Meta description длина", "block": "5.2", "status": "...", "value": "..." },
    { "check": "Title длина", "block": "5.1", "status": "...", "value": "..." },
    { "check": "Open Graph", "block": "7.1", "status": "...", "value": "..." },
    { "check": "Twitter Card", "block": "7.2", "status": "...", "value": "..." },
    { "check": "Schema.org", "block": "6.1", "status": "...", "value": "..." },
    { "check": "Mobile viewport", "block": "4.1", "status": "...", "value": "..." },
    { "check": "JS-зависимость контента", "block": "11.1", "status": "...", "value": "..." },
    { "check": "lang атрибут", "block": "5.4", "status": "...", "value": "..." },
    { "check": "Яндекс.Метрика", "block": "10.2", "status": "...", "value": "..." },
    { "check": "Google Analytics / GTM", "block": "10.1", "status": "...", "value": "..." },
    { "check": "Яндекс.Вебмастер (верификация)", "block": "10.2", "status": "...", "value": "..." },
    { "check": "Google Search Console (верификация)", "block": "10.2", "status": "...", "value": "..." },
    { "check": "Хлебные крошки", "block": "9.1", "status": "...", "value": "..." },
    { "check": "E-E-A-T: О компании", "block": "8.2", "status": "...", "value": "..." },
    { "check": "E-E-A-T: FAQ", "block": "8.2", "status": "...", "value": "..." },
    { "check": "E-E-A-T: Контакты", "block": "8.2", "status": "...", "value": "..." },
    { "check": "E-E-A-T: Политика конфиденциальности", "block": "8.3", "status": "...", "value": "..." },
    { "check": "URL структура", "block": "5.8", "status": "...", "value": "..." },
    { "check": "Сервер / CMS", "block": "2.2", "status": "info", "value": "..." },
    { "check": "Дублирующиеся title", "block": "5.1", "status": "...", "value": "..." },
    { "check": "Дублирующиеся description", "block": "5.2", "status": "...", "value": "..." },
    { "check": "Скрытый контент (hidden text)", "block": "12.1", "status": "...", "value": "..." },
    { "check": "Session ID в URL", "block": "5.8", "status": "...", "value": "..." },
    { "check": "Качество анкоров внутренних ссылок", "block": "9.2", "status": "...", "value": "..." },
    { "check": "og:locale", "block": "7.1", "status": "...", "value": "..." },
    { "check": "Навигационное меню", "block": "9.1", "status": "...", "value": "N пунктов" },
    { "check": "Подвал (footer)", "block": "9.1", "status": "...", "value": "N ссылок, телефон: да/нет, адрес: да/нет" },
    { "check": "www — доступность", "block": "1.4", "status": "...", "value": "301 → non-www / не отвечает / нет DNS" },
    { "check": "Мусорные URL в sitemap", "block": "1.2", "status": "...", "value": "..." },
    { "check": "Tap targets (мобильные)", "block": "4.2", "status": "...", "value": "..." },
    { "check": "Lighthouse Best Practices", "block": "2.2", "status": "...", "value": "..." }
  ]
}
```

Заполни корректными значениями. Оценки — по шкале 1–10. При отсутствии данных используй null.

**Требование к `scoreDetails`**: поле обязательно для каждой категории в `scores`. Каждый элемент — конкретный факт с иконкой статуса (✅/🔴/⚠️), например: `"✅ title 52 симв."`, `"🔴 description 285 симв. (норма 70-160)"`. Не оставляй пустые массивы.

**Поле `block` в каждой проверке** — номер раздела мастер-чеклиста (например `"2.2"` = «Блок 2 → HTTP-заголовки»). Используется для группировки в отчёте.

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
  seo-audit-output/desktop-${DOMAIN}-${DATETIME}.jpg — скриншот десктоп (Lighthouse desktop preset)
  seo-audit-output/mobile-${DOMAIN}-${DATETIME}.jpg  — скриншот мобильный (Lighthouse mobile)

Топ-3 приоритетных исправления:
1. [СРОЧНО, сложность: низкая] ...
2. [СРОЧНО, сложность: средняя] ...
3. [ВЫСОКИЙ, сложность: низкая] ...
```
