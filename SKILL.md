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

**Цель — минимизировать визуальное вмешательство в работу пользователя.** НИКОГДА не создавай новую вкладку без крайней необходимости — это отвлекает пользователя.

Выбери вкладку для аудита по строгому приоритету:

1. Вызови `mcp__claude-in-chrome__tabs_context_mcp` — получи список открытых вкладок
2. Выбери tabId по приоритету (строго сверху вниз):
   - **Приоритет 1**: вкладка с `chrome://newtab/`, `chrome://new-tab-page/` — переиспользуй
   - **Приоритет 2**: вкладка с тем же доменом что в `$ARGUMENTS` — переиспользуй
   - **Приоритет 3**: вкладка с любым другим доменом, где `title` пустой или `"Untitled"` — переиспользуй
   - **Приоритет 4** (только в крайнем случае): если ВСЕ вкладки содержат важный пользовательский контент — создай новую через `mcp__claude-in-chrome__tabs_create_mcp`
3. Выполни `mcp__claude-in-chrome__navigate` с выбранным tabId и URL `$ARGUMENTS`
4. Сохрани этот tabId — используй его во всех последующих шагах фазы 2 (НЕ создавай дополнительные вкладки)

### Завершение аудита — закрытие вкладки

По завершении аудита (после генерации отчётов) — попытайся **закрыть** созданную вкладку, не оставляя её открытой:

1. **Если вкладка была создана через `tabs_create_mcp` (Приоритет 4)** — закрой её через `mcp__claude-in-chrome__javascript_tool` с кодом:
   ```javascript
   window.close()
   ```
   Это работает для вкладок, открытых программно (extension).

2. **Если вкладка была переиспользована (Приоритеты 1–3)** — верни её на `chrome://newtab/`:
   ```
   mcp__claude-in-chrome__navigate → tabId, url: chrome://newtab/
   ```

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

# Определение рынка по доменной зоне (НЕ упоминать в отчёте — только для логики формирования рекомендаций)
MARKET="international"
case "$DOMAIN" in
  *.ru|*.su|*.рф|*.xn--p1ai) MARKET="ru" ;;
esac
echo "Market: $MARKET (только для логики, в отчёте не упоминать)"

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

### 1.12 Категоризация страниц по типу шаблона (URL pattern)

**Цель**: вместо случайного выбора 2-3 страниц для анализа в Фазе 2 — определить **уникальные типы шаблонов** на сайте и взять по одному представителю каждого типа. Лимит: **20 уникальных типов** на один аудит.

Тип страницы определяется **по структуре URL**, не по контенту:
- `/news/123` и `/news/456` — один тип «новость» (отличается только контент)
- `/products/maxilac-baby` и `/products/maxilac-mini` — один тип «карточка товара»
- `/about` и `/contacts` — два **разных** уникальных типа

Алгоритм нормализации URL → pattern:

```bash
# Получить URL из sitemap (включая sitemap-index)
SITEMAP_URLS=$(curl -s "$ARGUMENTS/sitemap.xml" | grep -oP '(?<=<loc>)[^<]+' | head -500)

# Если sitemap — это index, получить URL из всех вложенных sitemap
echo "$SITEMAP_URLS" | grep -E '\.xml(\.gz)?$' | head -5 | while read SUB; do
  curl -s "$SUB" | grep -oP '(?<=<loc>)[^<]+' | head -200
done > /tmp/all-urls.txt
echo "$SITEMAP_URLS" | grep -vE '\.xml(\.gz)?$' >> /tmp/all-urls.txt

# Категоризация через node — нормализация URL в pattern
node -e "
const fs = require('fs');
const urls = fs.readFileSync('/tmp/all-urls.txt','utf8').split('\n').filter(Boolean);

// Нормализация одного URL в шаблон
function urlToPattern(url) {
  let path;
  try { path = new URL(url).pathname; }
  catch { return null; }
  // Trailing slash → нормализованный
  if (path !== '/' && path.endsWith('/')) path = path.slice(0, -1);
  return path
    .split('/')
    .map(seg => {
      if (!seg) return seg;
      // Чистый числовой ID: /products/123 → /products/{id}
      if (/^\d+\$/.test(seg)) return '{id}';
      // Дата вида 2026-04-09: /news/2026-04-09 → /news/{date}
      if (/^\d{4}-\d{2}-\d{2}\$/.test(seg)) return '{date}';
      // Slug — длинный сегмент с дефисами: /products/maxilac-baby-pro → /products/{slug}
      if (seg.length >= 8 && /-/.test(seg) && /^[a-z0-9-_]+\$/i.test(seg)) return '{slug}';
      // Кириллический slug
      if (seg.length >= 8 && /-/.test(seg) && /[а-яё]/i.test(seg)) return '{slug}';
      // UUID / hash
      if (/^[a-f0-9]{8,}\$/i.test(seg)) return '{hash}';
      // Расширения файлов оставить как есть
      return seg;
    })
    .join('/') || '/';
}

// Группировка
const groups = {};
urls.forEach(u => {
  const p = urlToPattern(u);
  if (!p) return;
  if (!groups[p]) groups[p] = { pattern: p, count: 0, examples: [] };
  groups[p].count++;
  if (groups[p].examples.length < 3) groups[p].examples.push(u);
});

// Сортировка: больше URL в группе = более важный тип
const sorted = Object.values(groups).sort((a,b) => b.count - a.count);
const totalTypes = sorted.length;
const limited = sorted.slice(0, 20);

console.log(JSON.stringify({
  totalUrls: urls.length,
  totalTypes,
  analyzedTypes: limited.length,
  skippedTypes: Math.max(0, totalTypes - 20),
  types: limited.map(g => ({
    pattern: g.pattern,
    matchedCount: g.count,
    sampleUrl: g.examples[0]
  }))
}, null, 2));
"
```

**Результат** — массив до 20 объектов, каждый с `pattern`, `matchedCount`, `sampleUrl`. Сохрани этот результат — он будет использован в Фазе 2 (шаги 2.4 и 3) как `pageTypes[]` в JSON-схеме.

**Если sitemap.xml недоступен** (404):
- Используй внутренние ссылки с главной (собранные в Фазе 2.1 как `internalLinks`/`navMenuItems`)
- Применяй ту же нормализацию
- Лимит остаётся 20 типов

**Особые случаи**:
- Главная страница `/` — всегда уникальный тип, всегда включается первой
- Если найдено `<= 5` типов (маленький сайт) — анализируй все
- Если найдено `> 20` типов — анализируй первые 20 (по убыванию `matchedCount`), пропущенные перечисли в `notChecked[]` с указанием количества

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
  badAnchors: (() => {
    // Плохие анкоры — не описательные, не помогают SEO (9.2.3)
    const badPatterns = /^(нажмите|нажми|здесь|тут|подробнее|подробно|читать далее|читать ещё|читать больше|click here|more|read more|learn more|here|details|link|ссылка|перейти|сюда|туда|>>|→)\s*$/i;
    const bad = [];
    [...document.querySelectorAll('a[href]')].filter(a => a.href.startsWith(location.origin)).forEach(a => {
      const t = a.textContent.trim();
      if (t && badPatterns.test(t)) {
        bad.push({ text: t.slice(0, 40), href: a.pathname });
      }
    });
    return { count: bad.length, examples: bad.slice(0, 10) };
  })(),
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
  aeoReadiness: (() => { const allP = [...document.querySelectorAll('main p, article p, .content p, body p')]; const firstReal = allP.map(p => p.textContent.trim()).find(t => t.split(/\s+/).filter(Boolean).length >= 5); const wordCount = firstReal ? firstReal.split(/\s+/).filter(Boolean).length : 0; const hasFaqElement = !!document.querySelector('[class*="faq" i], [id*="faq" i], [itemtype*="FAQPage"]'); return { firstParagraphWords: wordCount, hasFaqSection: hasFaqElement }; })(),

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
  --chrome-flags="--headless=new --disable-gpu --no-sandbox --window-position=-32000,-32000" \
  --only-categories=seo,performance,accessibility,best-practices \
  --output-path "${OUTPUT_DIR}/lighthouse-${DOMAIN}-${DATETIME}.json" \
  --quiet 2>/dev/null

node -e "
const d = JSON.parse(require('fs').readFileSync('${OUTPUT_DIR}/lighthouse-${DOMAIN}-${DATETIME}.json','utf8'));
const cats = d.categories;
const aud = d.audits;
const shortUrl = u => (u||'').replace(/^https?:\/\/[^/]+/,'').slice(0,80);
const kb = b => b ? Math.round(b/1024)+'KB' : null;
// Render-blocking resources (часто пустой если нет крупных синхронных скриптов)
const blockingScripts = (aud['render-blocking-resources']?.details?.items || [])
  .map(i => ({ url: shortUrl(i.url), duration: i.wastedMs ? Math.round(i.wastedMs)+'ms' : null }))
  .slice(0,5);
// Uses optimized images (legacy формат → WebP/AVIF)
const imgOpts = (aud['uses-optimized-images']?.details?.items || [])
  .map(i => ({ url: shortUrl(i.url), savings: kb(i.wastedBytes) }))
  .slice(0,5);
// Unused JavaScript — обычно главная причина TBT > 200ms
const unusedJs = (aud['unused-javascript']?.details?.items || [])
  .map(i => ({ url: shortUrl(i.url), total: kb(i.totalBytes), wasted: kb(i.wastedBytes), wastedPercent: i.wastedPercent ? Math.round(i.wastedPercent)+'%' : null }))
  .slice(0,5);
// Total byte weight — топ самых тяжёлых ресурсов (часто крупные изображения)
const heavyResources = (aud['total-byte-weight']?.details?.items || [])
  .map(i => ({ url: shortUrl(i.url), total: kb(i.totalBytes) }))
  .sort((a,b) => parseInt(b.total||0) - parseInt(a.total||0))
  .slice(0,5);
// Unminified CSS / JS
const unminifiedCss = (aud['unminified-css']?.details?.items || [])
  .map(i => ({ url: shortUrl(i.url), wasted: kb(i.wastedBytes) }))
  .slice(0,5);
const unminifiedJs = (aud['unminified-javascript']?.details?.items || [])
  .map(i => ({ url: shortUrl(i.url), wasted: kb(i.wastedBytes) }))
  .slice(0,5);
// BFCache failures: i.reason is the human-readable reason string
const bfcacheFailures = (aud['bf-cache']?.details?.items || [])
  .map(i => i.reason)
  .filter(r => r)
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
  unusedJavaScript: unusedJs,
  heavyResources,
  unminifiedCss,
  unminifiedJs,
  bfcacheFailures,
  accessibilityIssues: (aud['color-contrast']?.score===0 ? ['color-contrast: 0'] : [])
    .concat(aud['image-alt']?.score===0 ? ['image-alt: 0'] : [])
    .concat(aud['link-name']?.score===0 ? ['link-name: 0'] : [])
}));
" 2>/dev/null
```

⚠️ **Важно**: сохраняй результат **точно как вернул скрипт**, не переписывай и не «упрощай». На отчёте maxilac.ru v1.14.0 в JSON оказалось `bfcacheFailures: []`, хотя источник содержал 5 валидных причин — агент потерял данные при «осмыслении». Для Lighthouse-полей действует то же правило, что для `pages[].metrics`: collector/parser — единственный источник истины (Правило 15).

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
  --chrome-flags="--headless=new --disable-gpu --no-sandbox --window-position=-32000,-32000" \
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

### 2.4 Проверка уникальных типов страниц

Используй результат **шага 1.12** (`pageTypes[]` с нормализованными URL-патернами). Для каждого типа из списка (до 20 штук, главная всегда первая) выполни:

1. `mcp__claude-in-chrome__navigate` (тот же tabId) → `sampleUrl` типа
2. Дождись загрузки
3. Выполни **ВЕСЬ JS-сборщик из шага 2.1 целиком, без сокращений** через `mcp__claude-in-chrome__javascript_tool`. Запрещено:
   - ❌ оставлять только title/h1/canonical (это «упрощённый» сбор — нарушение)
   - ❌ опускать `badAnchors`, `bodyTextLen`, `domSize`, `semanticTags`, `aeoReadiness`, `formsHttps`, `protocolRelativeCount`, `hasCookieConsent`, `hasFavicon`, `imgDetails`, `brokenImgSrcs`, `anchorFrequency`, `first100WordsHasH1Keyword`
   - ❌ заменять JS-сборщик на «упрощённую версию для внутренних страниц»
   
   Все 50+ полей из шага 2.1 должны быть собраны для **каждой** страницы в `pages[]`. Это критично для Правил 11 и 13 (без полей не сработают условия).

4. Сохрани результат как один объект в `pages[]` JSON-схемы со всеми полями `metrics{...}` + добавь:
   - `pageType.pattern` — нормализованный URL pattern из шага 1.12
   - `pageType.matchedCount` — сколько страниц этого типа найдено в sitemap
   - `pageType.sampleUrl` — конкретный URL который был проанализирован

**Скриншоты дополнительных страниц не делаются** — только главная имеет `desktop-*.webp` и `mobile-*.jpg`. Для остальных типов — только метрики.

**Если шаг 1.12 не выполнен** (sitemap недоступен и нет внутренних ссылок) — fallback: проанализируй главную + 2 страницы из навигационного меню.

**Финальная проверка перед Фазой 3**: пройдись по всем `pages[i].metrics` и убедись что есть `badAnchors`, `bodyTextLen`, `domSize`, `aeoReadiness` для **каждой** страницы. Если нет — повтори JS-сборщик целиком на этой странице.

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

### 2.5.1 Библиотека готовых JSON-LD шаблонов

При формировании рекомендаций по добавлению Schema.org **всегда давай готовый JSON-LD блок** с подставленными реальными данными сайта (название, URL, контакты, цены), не общую инструкцию. Используй шаблоны ниже как основу — заменяй плейсхолдеры `{...}` на данные собранные в Фазе 1/2.

**Organization** (обязательно для всех коммерческих сайтов):
```json
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "{Название компании}",
  "url": "{$ARGUMENTS}",
  "logo": "{URL логотипа, например /images/logo.png}",
  "description": "{Краткое описание из meta description главной}",
  "telephone": "{+7XXXXXXXXXX}",
  "email": "{email}",
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "{улица, дом}",
    "addressLocality": "{город}",
    "postalCode": "{индекс}",
    "addressCountry": "RU"
  },
  "sameAs": [
    "{ссылки на соцсети — см. ниже по market}"
  ]
}
```

**`sameAs` зависит от `projectMeta.market`** (Правило 14):
- **`market === "ru"`**: только `vk.com/...`, `t.me/...`, `ok.ru/...`, `dzen.ru/...`, `rutube.ru/...`. **Запрещено**: facebook.com, twitter.com, x.com, instagram.com, threads.net (Meta признана экстремистской в РФ; Twitter/X заблокирован)
- **`market === "international"`**: facebook.com, twitter.com (или x.com), instagram.com, linkedin.com, youtube.com — стандартный набор. Не вставляй vk/ok/dzen — это RU-специфика.

**WebSite** с SearchAction (для Sitelinks Searchbox):
```json
{
  "@context": "https://schema.org",
  "@type": "WebSite",
  "name": "{Название сайта}",
  "url": "{$ARGUMENTS}",
  "potentialAction": {
    "@type": "SearchAction",
    "target": {
      "@type": "EntryPoint",
      "urlTemplate": "{$ARGUMENTS}/search?q={search_term_string}"
    },
    "query-input": "required name=search_term_string"
  }
}
```

**BreadcrumbList** (для каждой внутренней страницы):
```json
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Главная", "item": "{$ARGUMENTS}" },
    { "@type": "ListItem", "position": 2, "name": "{Раздел}", "item": "{URL раздела}" },
    { "@type": "ListItem", "position": 3, "name": "{Текущая страница}" }
  ]
}
```

**Product** (для интернет-магазинов):
```json
{
  "@context": "https://schema.org",
  "@type": "Product",
  "name": "{Название товара}",
  "description": "{Описание из meta description}",
  "image": "{URL основного изображения}",
  "sku": "{артикул}",
  "brand": { "@type": "Brand", "name": "{Бренд}" },
  "offers": {
    "@type": "Offer",
    "url": "{URL страницы товара}",
    "priceCurrency": "RUB",
    "price": "{цена}",
    "availability": "https://schema.org/InStock",
    "seller": { "@type": "Organization", "name": "{Название магазина}" }
  },
  "aggregateRating": {
    "@type": "AggregateRating",
    "ratingValue": "{средняя оценка}",
    "reviewCount": "{количество отзывов}"
  }
}
```

**Article / BlogPosting** (для статей):
```json
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "{H1 страницы}",
  "image": "{URL основного изображения статьи}",
  "datePublished": "{ISO 8601, например 2026-04-09}",
  "dateModified": "{ISO 8601}",
  "author": {
    "@type": "Person",
    "name": "{Имя автора}",
    "url": "{URL страницы автора}"
  },
  "publisher": {
    "@type": "Organization",
    "name": "{Название сайта}",
    "logo": { "@type": "ImageObject", "url": "{URL логотипа}" }
  },
  "description": "{краткое описание статьи}"
}
```

**FAQPage** (если есть блок вопросов-ответов):
```json
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "{Текст вопроса 1}",
      "acceptedAnswer": { "@type": "Answer", "text": "{Текст ответа 1}" }
    },
    {
      "@type": "Question",
      "name": "{Текст вопроса 2}",
      "acceptedAnswer": { "@type": "Answer", "text": "{Текст ответа 2}" }
    }
  ]
}
```

**LocalBusiness** (для сайтов с физической точкой):
```json
{
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  "@id": "{$ARGUMENTS}#localbusiness",
  "name": "{Название}",
  "image": "{URL фото}",
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "{улица, дом}",
    "addressLocality": "{город}",
    "postalCode": "{индекс}",
    "addressCountry": "RU"
  },
  "geo": { "@type": "GeoCoordinates", "latitude": "{широта}", "longitude": "{долгота}" },
  "telephone": "{+7XXXXXXXXXX}",
  "openingHoursSpecification": [
    { "@type": "OpeningHoursSpecification", "dayOfWeek": ["Monday","Tuesday","Wednesday","Thursday","Friday"], "opens": "09:00", "closes": "18:00" }
  ],
  "priceRange": "{например ₽₽}"
}
```

**Service** (для сайтов услуг):
```json
{
  "@context": "https://schema.org",
  "@type": "Service",
  "serviceType": "{Название услуги}",
  "provider": { "@type": "Organization", "name": "{Название компании}", "url": "{$ARGUMENTS}" },
  "areaServed": { "@type": "City", "name": "{Город}" },
  "description": "{Описание услуги}",
  "offers": {
    "@type": "Offer",
    "priceCurrency": "RUB",
    "price": "{цена}"
  }
}
```

**Правило подстановки данных**:
- Не оставляй плейсхолдеры `{...}` в `fix`-поле — заменяй их на реальные данные собранные в шагах 1.5 (raw HTML), 2.1 (DOM), 2.5 (существующая Schema)
- Если данные неизвестны (например, нет физического адреса) — пропускай поле, не вставляй пустую строку
- Не давай Schema, которая не подходит сайту: для блога — Article, для магазина — Product, для услуг — Service. Не предлагай LocalBusiness если нет точки продаж.

---

## Фаза 3 — Формирование данных отчёта

Собери все данные в JSON-файл `${REPORT_JSON}` (полный путь из инициализации).

**Важно по `screenshotPaths`**: используй абсолютные пути к реально сохранённым PNG-файлам. Если файл не был создан (базовый режим без Chrome), укажи `null`. generate-report.js встроит изображения в HTML/PDF через base64.

### ⚠️ Обязательные поля `pages[].metrics` — НЕ ПРОПУСКАТЬ

Когда сохраняешь результат JS-сборщика из шага 2.1 в `pages[i].metrics`, **обязательно** перенеси ВСЕ собранные поля в JSON, не теряй ни одно. Особенно часто пропускаются (контрольный список):

- ✅ `badAnchors` — `{ count, examples[] }` (см. шаг 2.1, поле обязательное даже если count=0)
- ✅ `bodyTextLen` — длина текста в символах (нужна для thin content в Правиле 11)
- ✅ `domSize`, `domDepth` — DOM метрики
- ✅ `semanticTags` — счётчики `<article>`, `<section>`, и т.д.
- ✅ `aeoReadiness` — `{ firstParagraphWords, hasFaqSection }`
- ✅ `formsHttps`, `protocolRelativeCount`, `hasCookieConsent`, `hasFavicon`
- ✅ `imgsTotal`, `imgsNoAlt`, `imgsBroken`
- ✅ `h2Count`, `h3Count`
- ✅ `first100WordsHasH1Keyword`

**Правило**: если JS-сборщик 2.1 вернул поле — оно ДОЛЖНО попасть в JSON, даже если значение `null` / `0` / `false` / пустой массив. Без этого Правила 11 не сработают (агент не увидит проблем).

### ⚠️ Правило 11 — обход всех страниц для thin content и badAnchors

Перед финализацией `recommendations[]` пройдись по `pages[].metrics` для **каждой** страницы и проверь:

```
for each page in pages:
    words = (page.metrics.bodyTextLen or 0) / 5  # ≈ слов
    if words < 300 and page.template != "home":
        → создать warning рекомендацию "Расширить контент на {page.url}"
        → impact: "Тонкий контент (~{words} слов) — поисковики снижают такие страницы в индексе как малополезные. Google: thin content без уникальной ценности → возможна деиндексация"
        → affectedUrls: [page.url]

    if page.metrics.badAnchors and page.metrics.badAnchors.count > 0:
        → создать warning рекомендацию "Заменить плохие анкоры на {page.url}"
        → description: перечислить конкретные badAnchors.examples
        → impact: "Анкоры не передают семантический контекст ссылкам. Google не понимает релевантность связи между страницами"
        → affectedUrls: [page.url]
```

Это **обязательная финальная проверка**, не пропускать.

## Правила формирования рекомендаций (обязательные)

Эти правила определяют клиентское качество отчёта. Соблюдай каждое.

### ⚠️ Правило 0 — Тон отчёта (маркетинговая подача)

Отчёт **не должен подчёркивать**, что он сгенерирован автоматически или с помощью инструмента — это снижает воспринимаемую ценность работы. Запрещённые формулировки в текстах для клиента (`title`, `description`, `impact`, `executiveSummary.headline`, `strengths[]`, `risks[]`, `notChecked[]`, `summary`):

- ❌ «автоматический аудит», «автоматически проверено», «инструмент проверил»
- ❌ «скилл», «skill», «AI», «нейросеть», «ChatGPT», «Claude», «генератор отчётов»
- ❌ «sub-agent», «фаза 1/2/3», «Lighthouse desktop preset», «JS-сборщик»
- ❌ «лимит N в один аудит», «sub-agent fork», «версия скилла»
- ❌ «мы не проверяли», «не получилось проверить» — заменяй на «требует углублённой работы», «вынесено в отдельный этап»
- ❌ Любые упоминания рыночной сегментации: «российский рынок», «международный рынок», «по 152-ФЗ», «согласно требованиям РФ», «Роскомнадзор», «Meta признана экстремистской», «Twitter заблокирован». Логика рынка применяется ТИХО — клиент видит готовый набор рекомендаций, без объяснения почему GA нет в списке. Если клиент спросит, объяснит эксперт устно.

Допустимо упоминание **отраслевых инструментов** только если речь о методологии или эталонах: Lighthouse как отраслевой стандарт CWV, Google Search Central как источник, Ahrefs/Semrush как промышленный benchmark. Но не «мы прогнали через Lighthouse».

Пиши так, как будто отчёт подготовил эксперт по SEO. Версию указывай как `v1.10.1` без слов «скилл» / «инструмент» / «генератор».

### Правило 1 — Каждая рекомендация имеет 6 обязательных полей

| Поле | Назначение | Пример |
|---|---|---|
| `title` | Повелительное наклонение, активный глагол | «Добавьте Schema.org Organization на главную» (не «Рекомендуется рассмотреть...») |
| `description` | Что именно не так — конкретные числа/URL для **этого** сайта | «JSON-LD разметка отсутствует на 3/3 проверенных страниц. Title главной 105 символов — обрезается в SERP после 60-го» |
| `impact` | **Бизнес-последствие**, не технический факт | ✅ «Без Schema.org теряете блок Sitelinks Searchbox в Google и Knowledge Panel — CTR в SERP падает на 5–15% по брендовым запросам». ❌ «Отсутствует Schema.org — нужно добавить Schema.org» |
| `priority` | high / medium / low — влияние на ранжирование | high — критично для индексации/доверия; medium — заметное влияние; low — улучшение |
| `difficulty` | low / medium / high | low — правка одного файла; medium — несколько файлов; high — структурные изменения |
| `fix` | **Готовый код** для копирования, не инструкция | ✅ полный nginx-блок с `add_header`. ❌ «настройте HSTS в nginx» |

⚠️ **Поле `effortHours` удалено в v1.16.0** — больше не нужно его заполнять. Часы для отображения в карточке рекомендации **вычисляются рендерером автоматически** из `estimateHours.total` (с правильным склонением «час/часа/часов»). Если ты по привычке поставишь `effortHours`, поле **будет проигнорировано** — рендерер всегда читает только `estimateHours.total`. Это устраняет двойной источник истины: на v1.15.2 все 17 рекомендаций имели `effortHours ≠ estimateHours.total`.

Дополнительные поля (рекомендуется):
- `steps[]` — пошаговый план внедрения (3–5 шагов: «Открыть файл X», «Вставить блок Y», «Проверить через Z»)
- `verify` — формат **«Текущее → Желаемое»** с конкретной командой/URL валидатора (см. ниже)
- `category` — номер раздела мастер-чеклиста (`"6.1"`, `"2.2"`)
- `categoryLabel` — короткий лейбл для бейджа («Блок 6 · Schema.org»)
- `phase` — вычисляется автоматически, см. Правило 4
- `affectedUrls[]` — конкретные URL, на которых найдена проблема
- `sourceChecks[]` — массив `check`-имён из `technical[]`, на которые ссылается рекомендация

**`fix` обязан быть CMS-специфичным.** Если `cmsInfo` указывает на 1C-Bitrix — давай Bitrix-специфичный код (через `$APPLICATION->SetPageProperty()`, шаблоны `local/templates/.default/`, админка Маркетинг → SEO). Если WordPress — через `wp_head` action или плагин Yoast. Если nginx — конкретный location-блок. Запрещено давать generic PHP без учёта CMS — он сломает сайт.

| CMS | Где менять | ❌ Плохо | ✅ Хорошо |
|---|---|---|---|
| **1C-Bitrix** | `local/templates/.default/header.php` или Свойства страницы | `<?php $canonical = ...; ?>` (generic PHP) | `<?php $APPLICATION->SetPageProperty('canonical', '...'); ?>` |
| **WordPress** | `functions.php` или плагин | Прямая правка `wp-content/themes/.../header.php` | `add_action('wp_head', function() { ... })` или Yoast SEO |
| **nginx** | `/etc/nginx/sites-enabled/site.conf` | Просто `add_header X` | `server { listen 443; add_header X-Frame-Options "SAMEORIGIN" always; }` |
| **Tilda / Construction sites** | Через панель админки | PHP-код | Инструкция «Настройки → SEO → Custom HTML код» |

**`verify` обязан быть в формате «Текущее → Желаемое»:**

| ❌ Плохо | ✅ Хорошо |
|---|---|
| `https://search.google.com/test/rich-results` | `Сейчас: https://search.google.com/test/rich-results?url=maxilac.ru — показывает «Нет структурированных данных». После исправления — должны появиться Organization и WebSite с зелёной галкой` |
| `проверить через Lighthouse` | `Сейчас: Lighthouse SEO 92, Performance 39. Цель: SEO ≥ 95, Performance ≥ 70 (https://pagespeed.web.dev/?url=maxilac.ru)` |
| `curl -I url` | `Сейчас: curl -sI https://maxilac.ru/sitemap.xml → HTTP/1.1 404. Цель: HTTP/1.1 200 + Content-Type: text/xml` |

### Правило 2 — Запрет на технические тавтологии в `impact`

`impact` обязан быть **бизнес-формулировкой**. Запрещены формулировки вида «нужно добавить X», «отсутствует Y», «без X нет X». Должно быть **последствие** для пользователя/SEO/бизнеса с конкретикой (метрика, %, цифра, аудитория).

| ❌ Плохо (тавтология) | ✅ Хорошо (бизнес-эффект) |
|---|---|
| «Не настроен HSTS» | «При первом визите пользователь уязвим к downgrade-атаке (man-in-the-middle), что может привести к перехвату cookies сессии» |
| «Title слишком длинный» | «Title обрезается в SERP после 60 символов — пользователь не видит ключевые слова в конце, CTR падает на ~10–15% (Google CTR study)» |
| «Нет Schema.org BreadcrumbList» | «Google не строит хлебные крошки в SERP — потеря визуального якоря и кликабельности результата на 5–10%» |
| «Без sitemap.xml поисковики обнаруживают страницы медленно» | «Задержка индексации новых страниц на 2–8 недель → потеря трафика по long-tail запросам в первые месяцы после публикации» |
| «PHPSESSID в URL засоряет индекс» | «Параметризованные URL создают дубли в индексе — каждая страница попадает в индекс N раз с разными ID, размывая ссылочный вес и заставляя страницы сайта конкурировать между собой за один и тот же запрос» |

**Самопроверка для `impact`**: можно ли его прочитать клиенту-нетехнику? Если ответ «он не поймёт что плохого» — переписать. Должно быть видимое для бизнеса последствие (трафик, конверсия, CTR, доверие, юридический риск, brand image).

**Справочные ROI-значения** для типичных проблем (используй в `impact` для убедительности — конкретные цифры лучше абстракций):

| Проблема | Источник | Справочный эффект |
|---|---|---|
| Schema.org Organization + WebSite SearchAction | Google Search Central case studies | Sitelinks Searchbox в SERP, Knowledge Panel; +5–15% CTR по брендовым запросам |
| Schema.org Product (e-commerce) | Google rich results docs | Rich snippets со звёздами, ценой, наличием → +20–30% CTR в SERP |
| Schema.org FAQPage | Google FAQ rich result | До 60% пространства SERP занимает rich snippet с FAQ → высокий CTR |
| Schema.org BreadcrumbList | Google docs | Breadcrumbs в SERP вместо URL → лучше визуальный якорь, +5% CTR |
| HSTS заголовок | Mozilla observatory | Защита от downgrade-атак при первом визите; +10 в Mozilla Security score |
| HTTP/2 включён | Google Web Vitals | -100–300ms к TTFB, мультиплексирование запросов → -1s LCP на медленных соединениях |
| Canonical-теги | Google Search Central | Устраняет дубли в индексе, концентрирует ссылочный вес → +10–25% позиций по запросам |
| Уникальные title/description на каждой странице | Backlinko study 2023 | Дублирующиеся title теряют до 40% потенциального трафика по ключам |
| H1 присутствует и содержит ключ | Backlinko 2 millionsearch results study | Сайты с H1 ранжируются в среднем на 7 позиций выше |
| Sitemap.xml корректный | Google Search Central | Ускорение индексации новых страниц с 2–8 недель до 1–3 дней |
| LCP < 2.5s (зелёная зона) | Google CWV ranking factor | Часть алгоритма ранжирования с июня 2021. Каждая 100ms LCP → ~0.6% conversion |
| CLS < 0.1 | Google CWV | Часть алгоритма ранжирования. Высокий CLS → +20–40% bounce rate |
| TBT < 200ms | Lighthouse Performance | Связан с FID/INP — фактор ранжирования с марта 2024 |
| Открытые AI-краулеры (GPTBot, ClaudeBot) | OpenAI / Anthropic docs | Сайт попадает в обучающие выборки и AI-ответы — новый канал органического трафика |
| Mobile viewport meta + tap targets ≥ 44px | Google Mobile-Friendly | Mobile-first indexing с 2019. Без viewport — мобильная версия исключается из мобильного индекса |
| Cookie consent (152-ФЗ для РФ, GDPR для ЕС) | Роскомнадзор / GDPR Article 13 | Юридический риск: штраф до 75 000 ₽ (РФ) / до 4% годового оборота (ЕС) |
| **[market=ru]** Яндекс.Метрика установлена | Яндекс | 70% поисковой аудитории РФ. Без Метрики — слепая зона по основному источнику трафика |
| **[market=ru]** Верификация в Яндекс.Вебмастер | Яндекс | Доступ к данным об индексации, поисковых запросах, ошибках, ранние уведомления о санкциях |
| **[market=ru]** Google Analytics на RU-сайте — НЕ устанавливать | 152-ФЗ ст.18.1 + ст.13.11 КоАП | Юридический риск: штрафы до 18 млн ₽ за передачу ПД в США без локализации, блокировка Роскомнадзором |
| **[market=intl]** Google Analytics 4 / GTM | Google | Стандарт интернет-аналитики: события, конверсии, ремаркетинг, BigQuery export |
| **[market=intl]** Verification в Google Search Console | Google | Доступ к Search Performance, Index Coverage, Core Web Vitals Field Data, ручным санкциям |

**Применение**: при формировании `impact` ссылайся на одно из значений выше с указанием источника. Например:
- ✅ «Sitelinks Searchbox в Google по брендовым запросам — это +5-15% CTR (Google Search Central case studies)»
- ✅ «Каждая 100ms LCP снижает conversion на ~0.6% (Google CWV)»
- ❌ «Без Schema.org нет rich snippets» (нет цифры, нет источника)

#### Обязательная самопроверка по Правилу 2

Перед сохранением каждого `impact` проверь: содержит ли текст **хотя бы одно** из:
- конкретный процент (`+15%`, `−40%`, `на 7 позиций выше`)
- временной интервал (`в 3–5 раз быстрее`, `−1.2 секунды LCP`, `за 2–8 недель`)
- денежный/количественный диапазон (`штрафы до 18 млн ₽`, `+20–30% CTR`)
- ссылка на исследование/источник из ROI-таблицы выше (Backlinko, Google CWV, Яндекс ИКС, и т.п.)

Если ни одного нет — **перепиши**, не сохраняй. На отчёте maxilac.ru v1.14.0 рекомендации «Исправьте битые изображения», «Установите security-заголовки», «Расширьте контент главной» имели impact-тексты без единой конкретной цифры — они звучат как общие соображения, а не как бизнес-кейс. Исправь это **до** сохранения JSON, а не задним числом.

⚠️ Не путай Reach с ROI: «32 битых изображения» в `description` — это объём, а не эффект. В `impact` нужен **бизнес-результат с цифрой**: «при 32 битых из 57 (56%) пользователь видит сломанную галерею → +15–25% bounce rate на product page (Baymard Institute) → потеря брендового доверия в YMYL-нише».

### Правило 3 — Дедупликация по URL

(старая таблица «low → 1–2 часа, medium → 4–8 часов» удалена в v1.12.0 — теперь однозначные целые часы из расчёта в Правиле 13)

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

Внутри фазы упорядочивай: `priority desc → difficulty asc → estimateHours.total asc`.

### Правило 5 — Лимит 10–20 рекомендаций в отчёте

- Меньше 8 — проверь что не упустил важное (Schema.org, canonical, безопасность)
- Больше 20 — объедини похожие через `affectedUrls[]` или агрегируй мелкие в одну («Настроить security-заголовки» вместо отдельных HSTS, X-Frame, CSP)

### Правило 6 — Полнота: каждый critical/warning в `technical` имеет рекомендацию

Перед финализацией JSON пройдись по `technical[]`. Для каждого `status: "critical"` или `status: "warning"` обязательна запись в `recommendations[]` с соответствующим `sourceChecks[]`. Исключения — только `info`.

#### Обязательная самопроверка перед сохранением (для Rule 6)

Прогоняй формальный чек, а не «прикидывай в уме» — LLM регулярно теряет проверки:

```
uncovered = []
for t in technical:
  if t.status in ['critical', 'warning']:
    if not any(t.check in r.sourceChecks for r in recommendations):
      uncovered.append(t)
assert uncovered == []
```

При невыполнении — у тебя три варианта (выбери один для каждой непокрытой проверки):

1. **Создать новую рекомендацию** с этой проверкой в `sourceChecks`. Стандартный путь.
2. **Дописать `sourceChecks`** в существующую рекомендацию, которая уже покрывает эту проблему по смыслу. Например, `Lighthouse Performance` логически покрыт рекомендацией про оптимизацию скорости — но `sourceChecks` обязан явно содержать `"Lighthouse Performance"`, иначе чек его не увидит.
3. **Понизить статус до `info`** в `technical[]` — только если проверка действительно не требует действий клиента (например, `Google Analytics / GTM` для RU-сайта: установлено = warning, но рекомендации «удалить GTM» нет, потому что это не отдельная задача, а часть рекомендации «установить Яндекс.Метрику и убрать зарубежные счётчики»). Тогда **переформулируй `value`** так, чтобы клиент понял почему это не рекомендация: `value: "GTM-XXXXX установлен — учтено в общей рекомендации по аналитике"`.

⚠️ Не оставляй critical/warning без покрытия молча. На отчёте maxilac.ru v1.14.0 6 проверок (Last-Modified/ETag, Lighthouse Accessibility, HTTP/2, Навигационное меню, GA/GTM, Lighthouse Performance) остались без явного `sourceChecks`-линка — клиент видел статусы в техническом блоке, но не находил их в плане действий.

#### Типичные пары check ↔ рекомендация

Подсказка для частых случаев, чтобы не пропустить:

| Технический чек (`status`) | Куда привязать |
|---|---|
| `Lighthouse Performance` (critical/warning) | Рекомендация про CWV/скорость загрузки → `sourceChecks: ["Lighthouse Performance", ...]` |
| `Lighthouse Accessibility` (warning) | Отдельная рекомендация «Исправить нарушения a11y» (alt, контраст, label) или агрегировать в общую UX-задачу |
| `Lighthouse Best Practices` (warning) | Часто покрывается рекомендацией про security-заголовки или mixed content |
| `HTTP/2 / HTTP/3` (warning) | Рекомендация «Включить HTTP/2 в nginx» — отдельная или внутри пакета DevOps-задач |
| `Last-Modified / ETag` (warning) | Рекомендация про кэширование статики — добавить туда `sourceChecks: ["Last-Modified / ETag"]` |
| `Навигационное меню` без `<nav>` (warning) | Рекомендация про семантическую разметку или a11y |
| `Google Analytics / GTM` на RU-сайте (warning) | Связать с рекомендацией «Установить Яндекс.Метрику и убрать GTM» (в её `sourceChecks`) |

### Правило 7 — Формирование `strengths[]` (3–5 пунктов)

Топ-5 самых важных `ok`-проверок. Активная формулировка с конкретикой:
- ✅ «Скорость в зелёной зоне — LCP 1.1s, CLS 0, TBT 40ms»
- ✅ «Контент индексируется без JS-рендеринга — title/H1/meta идентичны в raw HTML и DOM»
- ❌ «Сайт работает по HTTPS» (слишком общё)
- ❌ «HTTPS работает корректно» (нет цифры — клиент прочитает как «всё нормально, ничего интересного»)

Приоритет источников: CWV → Schema.org валидна → корректные мета-теги → аналитика → безопасность.

**Обязательная самопроверка**: каждый пункт `strengths[]` должен содержать **хотя бы одну** конкретную цифру или измеримый факт (значение метрики, число настроек, версия протокола, диапазон). Без цифры — это не сила, а констатация. На отчёте maxilac.ru v1.14.0 4 из 5 strengths не содержали цифр («HTTPS работает корректно», «robots.txt грамотно закрывает», «Footer содержит телефон и адрес»). Конкретика — это `«HSTS preload включён, max-age 31536000, www→non-www через 301»`, а не `«HTTPS работает»`.

### Правило 8 — Формирование `risks[]` (3–5 пунктов)

Топ-5 `critical` + `priority=high warning`. Формат «**бизнес-последствие → причина с цифрой**»:
- ✅ «Потеря rich snippets и Knowledge Panel (−5–15% CTR по бренду) → отсутствует Schema.org Organization на 4/4 страниц»
- ✅ «Юридический риск по 152-ФЗ (штраф до 75 000 ₽) → нет страницы политики конфиденциальности»
- ❌ «Нет HSTS» (только техфакт без эффекта)
- ❌ «Слепая зона аналитики» (нет цифры, нет масштаба)

**Обязательная самопроверка**: каждый пункт `risks[]` должен содержать (а) бизнес-эффект и (б) конкретную цифру/масштаб (% потерь, число затронутых страниц, размер штрафа, единицу нормы). Если только бизнес-эффект без цифры — добавь масштаб; если только техфакт без эффекта — переформулируй как последствие.

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
| `pages[].metrics.badAnchors.count` | `> 0` | Заменить плохие анкоры (см. examples) на конкретные ключевые слова (9.2.3). Перечислить найденные тексты в `description` рекомендации. |
| `pages[].metrics.bodyTextLen / 5` (≈ слов) | `< 300` для не-главной страницы | Thin content (13.1.1) — расширить контент до 300+ слов уникального текста (без шаблона/футера). Critical для коммерческих страниц. |

**Сравнение mobile/desktop content parity** (4.3.2): сравни `pages[].metrics.bodyTextLen` (десктоп из 2.1) с `bodyTextLen` из 2.2 (mobile). Если `mobile < desktop * 0.7` — критично, mobile-first indexing будет видеть только урезанную версию.

### Правило 12 — Coverage блоков

`coverage.blocksCovered` — блоки которые скилл проверяет автоматически. Стандартный набор для обычного RU-сайта:
- Блоки 1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, **17**, 21 (обычно 14 блоков)

**Уточнение по блокам с частичным покрытием**:
- **Блок 11 (JS-рендеринг)** — покрыт частично: проверяем `JS-зависимость контента` (сравнение raw HTML vs DOM). Не покрыто: SSR/SSG-настройки фреймворков, Google URL Inspection
- **Блок 12 (Скрытый контент)** — покрыт частично: hiddenTextElements + zeroSizeLinks через JS. Не покрыто: cloaking detection (сравнение user-agent vs Googlebot ответов)
- **Блок 8 (E-E-A-T)** — покрыт по сигналам (footer, страницы Контакты/О компании/Политика, авторы), но качественная оценка контента — экспертная
- **Блок 17 (AEO / GEO / AI-поиск)** — покрыт по сигналам: `siteData.llmsTxt`, `siteData.aiCrawlers`, `pages[].metrics.aeoReadiness` (длина лид-абзаца, наличие FAQ-секции). Отображается отдельной секцией «AEO / GEO — готовность к AI-поиску» в отчёте. Если хотя бы один из этих сигналов собран — обязан быть в `blocksCovered`

`coverage.blocksManual` — блоки требующие ручной работы / доступа к внешним системам:
- Блок 14 (off-page / ссылочный профиль) — нужен Ahrefs/Semrush/GSC API
- Блок 15 (локальное SEO) — GBP / Яндекс.Бизнес профили, NAP-аудит
- Блок 16 (международное / hreflang) — применимо только если найден `<link rel=alternate hreflang>`
- Блок 18 (краулинговый бюджет) — нужны логи сервера, GSC Crawl Stats
- Блок 19 (мониторинг) — операционная активность, не аудит состояния
- Блок 20 (полный WCAG-аудит) — Lighthouse Accessibility покрывает 30%, остальное — ручной audit

`notChecked[]` — короткий список конкретных проверок которые не выполнены автоматически (для раздела «Что не проверялось» в отчёте). Обязательно упомянуть GSC Search Performance, Disavow, конкуренцию страниц сайта за одинаковые запросы (overlap по ключам), hreflang (если применимо), Local SEO профили.

### Правило 13 — Оценка трудозатрат на внедрение (effortEstimate)

После формирования всех `recommendations[]` посчитай оценку трудозатрат для **технических** правок. Контент клиент пишет сам — за контент не оцениваем. Off-page вне scope. Результат сохрани в верхнеуровневый объект `effortEstimate{}`.

#### Принципы

1. **Целые часы**. Все часы округляем вверх (`Math.ceil`) до целого. Минимум — 1 час, если роль участвует. Нет «1.5 часа», «2.95 часа», «0.85 часа» — клиент воспринимает дробные числа как неуверенность.
2. **Однозначная оценка** — никаких диапазонов («1–2 часа», «4–8 часов»). Сразу одно конкретное число.
3. **Резерв включён в часы каждой задачи**, не отдельной строкой. Клиент не должен видеть «Резерв на неопределённость X%» — это намёк что оценка нечёткая. Резерв применяется к baseline до округления через множитель.
4. **PM = полноценная роль с прямой оценкой**, не отдельная строка «менеджмент». Колонка PM в каждом этапе. Расчёт: PM = 23% от суммы остальных ролей.
5. **6 ролей**: SEO, Dev, QA, DevOps, Design, PM. Content исключён — за контент отвечает клиент.
6. **3 этапа** соответствуют 3 фазам Roadmap.
7. **Не показывай клиенту** размер проекта (`small`/`medium`/etc) в виде слова — только число URL.

#### Шаг 13.1 — для каждой рекомендации определи `taskType` и `scope`

Закрытый словарь `taskType` (см. предыдущую версию — без изменений): meta_tags, canonical, redirect, schema, cwv, robots, sitemap, hreflang, duplicates, linking, http_codes, mobile, alt_images, security, analytics, eeat, other.

Закрытый словарь `scope`:
- `single` — правка на одной странице
- `template` — правка в шаблоне CMS, влияет на N страниц одного типа
- `site_wide` — миграция, требует регрессионного QA

#### Шаг 13.2 — baseline-часы по типу × scope

| taskType | single | template | site_wide |
|---|---:|---:|---:|
| meta_tags | 1 | 3 | 12 |
| canonical | 1 | 2 | 8 |
| redirect | 1 | 2 | 10 |
| schema | — | 6 | 18 |
| cwv | — | 8 | 32 |
| robots | — | 2 | 4 |
| sitemap | — | 2 | 4 |
| hreflang | — | 10 | 32 |
| duplicates | 1 | 4 | 18 |
| linking | — | 8 | 40 |
| http_codes | 1 | 4 | 10 |
| mobile | — | 6 | 18 |
| alt_images | 1 | 2 | 8 |
| security | 1 | 2 | 6 |
| analytics | 1 | 2 | 4 |
| eeat | 2 | 6 | — |
| other | low=4, medium=12, high=32 | | |

Минимум для любой задачи — **1 час** (даже если расчёт даёт меньше).

#### Шаг 13.3 — множители к baseline

```
raw_effort = baseline × M_scale × M_cms × M_risk × M_qa × M_reserve
effort = max(1, ceil(raw_effort))   // целое число, минимум 1
```

| Множитель | Условие | Значение |
|---|---|---:|
| **M_scale** | affectedUrls ≤ 50 | 1.0 |
| | 50 < urls ≤ 500 | 1.2 |
| | 500 < urls ≤ 5 000 | 1.5 |
| | urls > 5 000 | 2.0 |
| **M_cms** | WordPress / Bitrix / Tilda | 1.0 |
| | Кастомный фреймворк | 1.3 |
| | Legacy / самописная без доки | 1.6 |
| | SPA/SSR (Next.js, Nuxt) для CWV/schema | 1.4 |
| **M_risk** | single | 1.0 |
| | template без миграции | 1.2 |
| | site_wide / миграция URL | 1.5 |
| **M_qa** | single, template ≤ 50 URL | 1.0 |
| | template с большим scope или site_wide | 1.25 |
| **M_reserve** | по `_sizeKey` (см. ниже) | 1.15–1.40 |

**`M_reserve` — резерв на неопределённость** (встроен в каждую задачу, не показывается клиенту отдельно):

| `pageTypeStats.totalUrls` (внутренний `_sizeKey`) | M_reserve |
|---|---:|
| ≤ 10 (`compact`) | 1.15 |
| ≤ 100 (`small`) | 1.20 |
| ≤ 1 000 (`medium`) | 1.25 |
| ≤ 10 000 (`large`) | 1.30 |
| > 10 000 (`enterprise`) | 1.40 |

Внутренний `_sizeKey` сохраняется в `projectMeta._sizeKey` (поле начинается с подчёркивания — это внутренняя метка, **не показывается** в HTML отчёте). В `projectMeta.totalUrls` остаётся число URL — его можно показывать.

#### Шаг 13.4 — распределение по 6 ролям

После получения `effort` распределяй по `SEO / Dev / QA / DevOps / Design / PM`. Content исключён. PM считается **отдельно** в шаге 13.7.

| taskType | SEO | Dev | QA | DevOps | Design |
|---|---:|---:|---:|---:|---:|
| meta_tags | 50% | 40% | 10% | — | — |
| canonical | 15% | 80% | 5% | — | — |
| redirect | 10% | 60% | 5% | 25% | — |
| schema | 25% | 70% | 5% | — | — |
| cwv (frontend) | 5% | 80% | 5% | 10% | — |
| cwv (server-side / HTTP/2 / cache) | 5% | 30% | 5% | 60% | — |
| robots / sitemap | 70% | 25% | 5% | — | — |
| hreflang | 25% | 65% | 10% | — | — |
| duplicates | 30% | 60% | 10% | — | — |
| linking | 60% | 30% | 10% | — | — |
| http_codes | 5% | 50% | 5% | 40% | — |
| mobile | 10% | 65% | 10% | — | 15% |
| alt_images | 60% | 40% | — | — | — |
| security | 5% | 25% | — | 70% | — |
| analytics | 60% | 40% | — | — | — |
| eeat | 40% | 30% | — | — | 30% |

Каждая роль округляется вверх до целого (`Math.ceil`). Если процент роли = 0%, в JSON ставь `0` (не пропускай поле).

Сохраняй результат в `recommendations[].estimateHours { seo, dev, qa, devops, design, pm: 0, total }`. Поле `pm` для каждой задачи = 0 (PM считается на этапе сводки).

#### Шаг 13.5 — RICE-приоритет

```
riceScore = (Reach × Impact × Confidence) / total_hours
```

- `Reach` — `affectedUrls.length` (если 0 — `pageTypeStats.totalUrls` для site_wide, иначе 1)
- `Impact` — по severity: critical=3, high=2, medium=1, low=0.5
- `Confidence` — 1.0 (доказательство в `sourceChecks[]`); 0.8 (экспертная гипотеза); 0.5 (предположение)

Округляй до 1 знака после точки.

#### Шаг 13.6 — группировка в 3 этапа

Этапы **обязаны точно соответствовать 3 фазам Roadmap** — число задач в каждом этапе сводки = число задач в одноимённой фазе Плана действий. Используй только `phase` (см. Правило 4), без дополнительных условий по severity/priority:

| stage | Название | Условие (строго) |
|---|---|---|
| **1** | **Критичные блокеры** | `phase = "urgent"` |
| **2** | **Важные изменения** | `phase = "month"` |
| **3** | **Желательные улучшения** | `phase = "strategy"` |

Сортировка внутри этапа: по `riceScore desc`.

#### Шаг 13.7 — сводка по этапам, PM, итоги

Для каждого этапа суммируй часы по 5 базовым ролям (SEO, Dev, QA, DevOps, Design) — `stageBaseHours`.

**PM рассчитывается отдельно для каждого этапа**:
```
stage.pm = ceil(0.23 × (seo + dev + qa + devops + design))
stage.total = seo + dev + qa + devops + design + pm
```

Заполни `effortEstimate.stages[]` — массив из 3 объектов:
```json
{
  "id": 1,
  "label": "Критичные блокеры",
  "deadline": "1–2 недели",
  "taskCount": N,
  "hours": { "seo": N, "dev": N, "qa": N, "devops": N, "design": N, "pm": N, "total": N }
}
```

Метки этапов:
- 1 → «Критичные блокеры», `deadline: "1–2 недели"`
- 2 → «Важные изменения», `deadline: "до 30 дней"`
- 3 → «Желательные улучшения», `deadline: "1–3 месяца"`

**Итоги** (`effortEstimate.totals`) — суммирование по этапам:
```json
{
  "seo": N, "dev": N, "qa": N, "devops": N, "design": N, "pm": N,
  "total": N
}
```

⚠️ **Удалить из JSON-схемы**:
- `reservePercent`, `reserveHours` — резерв уже встроен в часы задач через `M_reserve`
- `managementHours` — PM теперь полноценная роль в каждом этапе
- `withReserve` — итог теперь честный без отдельного резерва

#### Шаг 13.7а — Обязательная самопроверка перед сохранением (КРИТИЧНО)

Перед записью JSON прогони **арифметическую** самопроверку. Без неё данные в `effortEstimate.stages[]` и `effortEstimate.totals` становятся неконсистентными с `recommendations[]`, и в отчёте появляются противоречия. Это происходило в v1.14.0 (агент сообщал 9/7/1 задач по этапам, а реальное распределение по `phase` было 8/8/1).

**Чек 1 — task counts по этапам**

Для каждого `stage.id ∈ {1, 2, 3}`:
```
expectedCount = recommendations.filter(r => phaseToStage(r.phase) === stage.id).length
assert stage.taskCount === expectedCount
```
где `phaseToStage = { urgent: 1, month: 2, strategy: 3 }`.

**Чек 2 — суммы часов по ролям внутри этапа**

Для каждого `stage` и каждой роли `role ∈ {seo, dev, qa, devops, design}`:
```
expectedHours = sum(r.estimateHours[role]
                    for r in recommendations
                    if phaseToStage(r.phase) === stage.id)
assert stage.hours[role] === expectedHours
```

**Чек 3 — PM по этапу**

```
base = stage.hours.seo + stage.hours.dev + stage.hours.qa + stage.hours.devops + stage.hours.design
assert stage.hours.pm === ceil(0.23 × base)
assert stage.hours.total === base + stage.hours.pm
```

**Чек 4 — totals**

```
for role in [seo, dev, qa, devops, design, pm, total]:
    assert effortEstimate.totals[role] === sum(stage.hours[role] for stage in stages)
```

**Что делать при несовпадении**: **переписать** `effortEstimate.stages[]` и `effortEstimate.totals` так, чтобы все 4 чека прошли. **Не сохраняй JSON, в котором хотя бы одно равенство нарушено.** Источник истины — `recommendations[].estimateHours` и `recommendations[].phase`. Если конфликт между ними и сводкой — доверяй per-rec данным, пересчитывай сводку.

⚠️ Не «прикидывай в уме». Сделай это формально: выпиши массив значений по каждой роли, сложи, сравни с `stage.hours[role]`. LLM-арифметика ненадёжна — выписывание промежуточных сумм даёт корректный результат значительно чаще.

> **Примечание архитектора**. В будущем эти расчёты планируется вынести из SKILL.md в отдельный детерминированный модуль (`estimate.js`), который будет вызываться рендерером перед генерацией HTML. Это устранит дублирование данных в принципе. До тех пор Шаг 13.7а — единственный механизм, гарантирующий целостность сводки. См. раздел «Открытые архитектурные решения» в `CLAUDE.md`.

#### Шаг 13.8 — детализация задач по этапам

Поле `effortEstimate.topByRice[]` **удалено в v1.13.0**. Вместо отдельного «Топ-10 по RICE» отчёт показывает все задачи каждого этапа со временем на каждую — данные берутся напрямую из `recommendations[].estimateHours.total` и `recommendations[].phase`. От тебя требуется только корректно заполнить `phase` (Правило 4) и `estimateHours{}` (Шаги 13.4) для каждой рекомендации.

**Не пиши в отчёте**: «оценка ориентировочная», «отраслевые baseline-часы», «формула», «множители», «calibration» — это снижает доверие клиента и раскрывает автоматический характер расчёта. Числа подаются как итог экспертной оценки.

### Правило 14 — Сегментация рекомендаций по рынку (RU vs international)

Определяется автоматически в инициализации (`projectMeta.market`) по доменной зоне:
- **`ru`** — `.ru`, `.su`, `.рф` (xn--p1ai)
- **`international`** — все остальные

#### 🔒 Запрещённые фразы в клиентских текстах (КРИТИЧНО)

⚠️ **Сегментация — внутренняя логика, клиент о ней не знает.** Любое упоминание разделения «по рынку», «по юрисдикции», «по закону» — нарушение. Запрещено выводить во **всех** клиентских полях:

- `recommendations[].title`
- `recommendations[].description`
- `recommendations[].impact`
- `recommendations[].fix` (кроме `_user_email_placeholders` и комментариев в коде)
- `recommendations[].steps[]`
- `recommendations[].verify`
- `technical[].value`
- `scoreDetails.*[]`
- `strengths[]`, `risks[]`
- `executiveSummary.headline`, `onePhrase`

**Запрещённые конструкции** (полный список — расширяй по аналогии):

| ❌ Запрещено | Почему |
|---|---|
| `RU-сайт`, `RU-рынок`, `для RU` | Прямое раскрытие сегментации |
| `российский рынок`, `российский сайт`, `сайт для России` | То же |
| `международный рынок`, `зарубежный сайт` | То же |
| `152-ФЗ`, `закон 152-ФЗ`, `по ст. 152-ФЗ` | Раскрытие юрисдикции |
| `Роскомнадзор`, `проверка Роскомнадзором` | Раскрытие регулятора |
| `КоАП ст. 13.11`, `штраф по 13.11` | Раскрытие конкретных правовых норм |
| `согласно требованиям РФ`, `по закону РФ` | То же |
| `для российской аудитории`, `для аудитории РФ` | То же |
| `аудитория .ru-зоны`, `домен в .ru` | Раскрытие технической логики выбора |
| `Twitter не работает в РФ`, `Meta признана экстремистской` | Раскрытие политического контекста |
| `платформа X заблокирована` | То же |
| `(market=ru)`, `(RU)` в скобках | Внутренние теги |

#### ✅ Приемлемые замены

Когда нужно сказать про юр. риск или ограничение — пиши **нейтрально**, без географии и без названия закона:

| ❌ «Для RU-сайта это требование 152-ФЗ» | ✅ «Это требование законодательства о персональных данных» |
| ❌ «GTM установлен — юридический риск для RU-сайта» | ✅ «GTM установлен — юридический риск (передача персональных данных в недопустимую юрисдикцию)» |
| ❌ «Без Метрики — слепая зона по основному источнику трафика для RU-рынка» | ✅ «Без Метрики — слепая зона по основному источнику органического трафика этого сайта» |
| ❌ «Twitter Card не нужен для RU» | ✅ «Twitter Card не применим для основной аудитории сайта» (или просто опустить пункт) |
| ❌ «Добавьте баннер согласия на Cookies (152-ФЗ)» | ✅ «Добавьте баннер согласия на использование Cookies» |
| ❌ «Повод для проверки Роскомнадзором» | ✅ «Повод для проверки надзорным органом» |
| ❌ «152-ФЗ требует явного согласия» | ✅ «Закон требует явного согласия пользователя на обработку cookies» |
| ❌ «GA на RU-сайте незаконен» | ✅ «GA в текущей конфигурации не может быть установлен на этом сайте по правовым причинам» (без указания каких) |

**Принцип**: говорим «закон», «надзорный орган», «правовые причины», «основная аудитория сайта», но **не называем** ни 152-ФЗ, ни Роскомнадзор, ни «РФ», ни «российский». Клиент уже знает, в какой стране у него сайт — лишний раз повторять не нужно.

#### Обязательная самопроверка перед сохранением JSON (по всем клиентским полям)

Прогоняй этот формальный чек:

```python
forbidden_substrings = [
  'RU-сайт', 'RU-рынок', 'для RU', 'на RU', '(RU)', '(market=ru)', '(market=intl)',
  'российск', 'для России', 'аудитори.* РФ',
  'международный рынок', 'международного рынка', 'зарубежный сайт',
  '152-ФЗ', '152-фз', '152 ФЗ',
  'Роскомнадзор',
  'КоАП', 'ст. 13.11', '13.11 КоАП',
  'требований РФ', 'закону РФ',
  'Twitter не работает', 'Meta признана', 'заблокирована в РФ',
]

for path in client_facing_fields:
  text = read(path)
  for sub in forbidden_substrings:
    if sub.lower() in text.lower():
      raise ValueError(f"Rule 14 violation: '{sub}' in {path}")
```

При срабатывании — **переписать** поле через таблицу замен выше. Не сохраняй JSON, в котором хотя бы одно нарушение осталось.

⚠️ Не «прикидывай в уме» — формально пройди по запрещённому списку. На отчёте maxilac.ru v1.14.0 было **8 утечек** в client-visible полях (3× «RU-сайт», 5× «152-ФЗ», 1× «Роскомнадзор», 1× «не нужен для RU», и одна прямо в `title` рекомендации). Все попали в финальный HTML. Это нарушение, которое сразу выдаёт автоматический характер отчёта и подрывает доверие.

#### Если `market === "ru"`:

**НЕ рекомендовать**:
- ❌ Установить Google Analytics 4 / GTM (нарушение 152-ФЗ ст. 18.1, штрафы по ст. 13.11 КоАП до 18 млн ₽ + блокировка Роскомнадзором)
- ❌ Верифицироваться в Google Search Console (передача персональных данных в США без локализации)
- ❌ Twitter Card / `twitter:` мета-теги (платформа X заблокирована Роскомнадзором с 2022 года)
- ❌ `og:image` ссылки на Facebook / Instagram изображения
- ❌ Schema.org `sameAs` с facebook.com / twitter.com / x.com / instagram.com / threads.net (Meta признана экстремистской организацией в РФ; деятельность Twitter/X запрещена)
- ❌ Embed-виджеты YouTube / Twitter / Instagram (YouTube замедлен, остальные заблокированы)

**ВМЕСТО них рекомендовать**:
- ✅ Яндекс.Метрика (если нет — критично, RU-рынок без Метрики = слепая зона аналитики)
- ✅ Top.Mail.Ru (опционально для большой аудитории Mail.Ru Group)
- ✅ Верификация в Яндекс.Вебмастер
- ✅ Schema.org `sameAs`: только `vk.com`, `t.me` (Telegram), `ok.ru`, `dzen.ru`, `rutube.ru`, `vc.ru`, `habr.com`
- ✅ Open Graph остаётся (универсальный, читается VK, Telegram, Slack, корпоративными мессенджерами)
- ✅ Embed виджеты VK Video, RuTube, Дзен Видео

**В JSON-LD библиотеке** (раздел 2.5.1) для RU-сайтов в `Organization.sameAs` указывай только VK/Telegram/OK/Dzen/RuTube — НЕ Facebook/Twitter/Instagram. В `LocalBusiness.image` — не используй CDN зарубежных соцсетей.

**В `siteData.aiCrawlers`** для RU — особое внимание: если заблокированы все AI-краулеры, упомянуть что доступ к Яндекс GPT и SearchGPT — отдельно.

#### Если `market === "international"`:

**Рекомендовать стандартный набор**:
- ✅ Google Analytics 4 / GTM
- ✅ Google Search Console верификация
- ✅ Twitter Card / `twitter:` мета-теги
- ✅ Schema.org `sameAs`: facebook.com, twitter.com/x.com, instagram.com, linkedin.com, youtube.com
- ✅ Embed: YouTube, Twitter/X, Instagram

**НЕ рекомендовать** (специфика RU):
- ❌ Яндекс.Метрика (если нет — info, не critical; для большинства международных сайтов Яндекс не приоритет)
- ❌ Top.Mail.Ru
- ❌ Верификация в Яндекс.Вебмастер (info, не warning)
- ❌ Schema.org `sameAs` с vk.com / ok.ru / dzen.ru — это RU-специфика

#### Контрольный пример

Сайт `maxilac.ru` (market=ru):
- ❌ НЕ генерируй рекомендацию «Установите Google Analytics 4»
- ✅ Генерируй «Установите Яндекс.Метрику» как critical
- ❌ НЕ генерируй «Добавьте Twitter Card теги»
- ✅ Generic Open Graph рекомендация остаётся
- В Schema.org `Organization.sameAs` примере — `["https://vk.com/maxilac", "https://t.me/maxilac"]`, **не** facebook/instagram

Сайт `example.com` (market=international):
- ✅ Генерируй «Install Google Analytics 4» как стандарт
- ❌ НЕ генерируй «Установите Яндекс.Метрику» (или максимум info)
- ✅ Twitter Card / Open Graph — оба
- В Schema.org `Organization.sameAs` — стандартные facebook/twitter/linkedin

#### Статусы в `technical[]` по market

При заполнении `technical[]` ставь `status` соответствующий рынку:

| check | market=ru status | market=intl status |
|---|---|---|
| `Яндекс.Метрика` | `critical` если нет, `ok` если есть | `info` (нет) или `ok` (есть) |
| `Google Analytics / GTM` | `info` если нет (нейтрально), **`warning`** если есть (юр. риск) | `warning` если нет, `ok` если есть |
| `Яндекс.Вебмастер (верификация)` | `warning` если нет, `ok` если есть | `info` |
| `Google Search Console (верификация)` | `info` если нет, **`warning`** если есть на RU-сайте (передача ПД в США) | `warning` если нет, `ok` если есть |
| `Twitter Card` | `info` если нет (платформа заблокирована в РФ), `info` если есть | `warning` если нет, `ok` если есть |
| `Open Graph` | `warning` если нет (важен для VK/Telegram) | `warning` если нет |

При формировании `value` для этих проверок не упоминай «по 152-ФЗ», «Роскомнадзор», «заблокировано» — клиенту достаточно нейтрального текста («не установлено», «настроено», «не применимо для основной аудитории»).

#### Приоритет поисковой системы в формулировках (КРИТИЧНО)

Доля Яндекса в поисковом трафике РФ — **~65–70%** (Statcounter, LiveInternet 2024–2025), Google — остаток. Для RU-сайта Яндекс — **основная** поисковая система, и весь язык отчёта должен это отражать. Google можно упоминать вторым после Яндекса, либо вообще опускать, если факт специфичен для одного движка.

| Контекст | `market = ru` (приоритет) | `market = international` |
|---|---|---|
| Главный поисковик в `impact` / `description` | **Яндекс** | **Google** |
| SERP, сниппеты, CTR | «в выдаче Яндекса», «в Яндекс SERP» | «in Google SERP» |
| Индексация / краулинг | «Яндекс-бот», «Яндекс.Вебмастер» | «Googlebot», «Search Console» |
| Schema.org / JSON-LD | «расширенные сниппеты Яндекса» (рецепты, товары, организация, FAQ) **+** «rich results в Google» — оба | «Google rich results» |
| Валидатор Schema.org | **`https://webmaster.yandex.ru/tools/microtest/`** | `https://search.google.com/test/rich-results` |
| CWV / производительность | «факторы ранжирования Яндекса (Vladivostok / поведенческие)» **+** «Core Web Vitals» — оба, Яндекс первым | «Core Web Vitals (Google)» |
| Mobile-first | «Яндекс с 2016 года использует mobile-first индекс (Vladivostok)» | «Google mobile-first indexing» |
| Sitemap.xml / robots.txt | «Яндекс.Вебмастер → Индексирование → Файлы Sitemap» | «Google Search Console → Sitemaps» |
| Карты / локальный бизнес | «Яндекс.Бизнес», «Яндекс.Карты» | «Google Business Profile», «Google Maps» |
| Аналитика трафика | «Яндекс.Метрика → Источники → Поисковые фразы» | «GA4 → Acquisition → Organic Search» |
| AI-краулеры | «YandexGPT, YandexBot для обзоров с ИИ» **+** «GPTBot, ClaudeBot» | «GPTBot, ClaudeBot, Googlebot-Extended» |

#### Что писать для RU вместо «Google ...»

| ❌ Плохо для RU-сайта | ✅ Хорошо для RU-сайта |
|---|---|
| «CTR в Google падает на ~10% из-за длинного title» | «Title обрезается в выдаче Яндекса после ~55–60 символов — пользователь не видит ключ в конце, CTR падает на 10–15%» |
| «Без Schema.org нет rich snippets в Google» | «Без Schema.org Яндекс не строит расширенные сниппеты (товары, рецепты, организация) и Колдунщики, а Google теряет rich results — снижение CTR на 10–25% по обоим источникам» |
| «Sitemap.xml ускоряет индексацию в Google» | «Без sitemap.xml Яндекс-бот и Googlebot обнаруживают новые страницы 2–8 недель вместо 1–3 дней» |
| «BreadcrumbList даёт хлебные крошки в Google SERP» | «BreadcrumbList показывает хлебные крошки в выдаче Яндекса (вместо длинного URL) и rich result в Google» |
| «Mobile-first indexing с 2019 (Google)» | «Яндекс перешёл на mobile-first индекс в 2016 (алгоритм Vladivostok), Google — в 2019. Без viewport мобильная версия исключается из обоих мобильных индексов» |
| «Каждая 100 ms LCP — −0.6% conversion (Google CWV)» | «Скорость загрузки — фактор ранжирования Яндекса (учитывается с 2018) и часть Core Web Vitals в Google. Каждые 100 ms LCP снижают конверсию на ~0.6%» |
| «Disallow в robots.txt блокирует Googlebot» | «Disallow в robots.txt блокирует Яндекс-бот и Googlebot — страница выпадает из обоих индексов» |

#### Дополнения к ROI-таблице (Правило 2) для RU-сайтов

| Проблема | Источник | RU-формулировка |
|---|---|---|
| Schema.org Organization + WebSite | Яндекс.Вебмастер «Расширенные сниппеты» | «Расширенные сниппеты Яндекса» по бренду + Sitelinks Searchbox в Google → +5–15% CTR в обеих SERP |
| Schema.org Recipe / Product | Яндекс «Колдунщики» | Колдунщики Яндекса (рецепты, товары, цены, рейтинг) — занимают до 40% видимой области SERP по соответствующим запросам |
| LCP / скорость | Яндекс «Качество сайта» (ИКС) | Скорость загрузки — компонент ИКС и качества сайта в Яндексе. Медленные сайты (LCP > 4s) теряют позиции в Яндекс SERP сильнее, чем в Google |
| Mobile viewport | Алгоритм «Владивосток» (2016) | Без viewport — исключение из мобильного индекса Яндекса (приоритет) и Google. Мобильный трафик в РФ — 70–80% |
| Поведенческие факторы (CTR, время на сайте, % отказов) | Яндекс ПФ | Один из ключевых факторов ранжирования Яндекса (в отличие от Google, где вес ниже). Качество title/description прямо влияет на ПФ → позиции |
| Турбо-страницы (RSS) | Яндекс.Турбо | RU-only: ускоряют загрузку с мобильных, бесплатный трафик из Яндекс.Новостей и Дзен (если применимо к нише сайта) |

**Правило применения**: при `market === "ru"` агент **обязан** ставить Яндекс на первое место в любых формулировках про SERP/CTR/индексацию/ранжирование. Google допустимо упоминать вторым (через «и Google» / «также в Google»), либо опускать, если факт чисто гугловский (например, GSC Core Web Vitals dashboard). Не пиши формулировок типа «Google не понимает» / «Google ранжирует ниже» в отрыве от Яндекса для RU-сайта — это сразу выдаёт, что отчёт не учитывает основную поисковую систему клиента.

При `market === "international"` — Google остаётся первичным; Яндекс не упоминается вообще.

```json
{
  "url": "$ARGUMENTS",
  "date": "YYYY-MM-DD HH:MM",
  "mode": "full | basic",
  "skillVersion": "1.16.4",
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
  "projectMeta": {
    "cms": "1c-bitrix",
    "totalUrls": 156,
    "isMigration": false,
    "market": "ru",
    "_sizeKey": "small"
  },
  "recommendations": [
    {
      "title": "Название рекомендации (повелительное наклонение: Добавьте, Сократите)",
      "description": "Что именно не так — с конкретными числами/URL для данного сайта",
      "impact": "Бизнес-последствие: «Без Schema.org вы теряете блок Sitelinks Searchbox и rich snippets — CTR в SERP может упасть на 5-15% по брендовым запросам». НЕ технический факт типа «нужно добавить Schema.org».",
      "priority": "high",
      "difficulty": "low",
      "phase": "urgent",
      "category": "6.1",
      "categoryLabel": "Блок 6 · Schema.org",
      "taskType": "schema",
      "scope": "template",
      "estimateHours": {
        "seo": 2,
        "dev": 5,
        "qa": 1,
        "devops": 0,
        "design": 0,
        "pm": 0,
        "total": 8
      },
      "riceScore": 28.5,
      "stage": 2,
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
      "pageType": {
        "pattern": "/products/{slug}",
        "matchedCount": 47,
        "sampleUrl": "https://example.com/products/some-product"
      },
      "metrics": {
        "title": "...",
        "titleLen": 57,
        "metaDesc": "...",
        "metaDescLen": 128,
        "h1": ["Заголовок страницы"],
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
        "bodyTextLen": 4521,
        "badAnchors": { "count": 3, "examples": [{ "text": "подробнее", "href": "/services/1" }] }
      },
      "issues": [
        { "severity": "critical|warning|info|ok", "msg": "..." }
      ]
    }
  ],
  "pageTypeStats": {
    "totalUrls": 156,
    "totalTypes": 7,
    "analyzedTypes": 7,
    "skippedTypes": 0
  },
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
    "unusedJavaScript": [{ "url": "/bitrix/cache/js/.../template.js", "total": "181KB", "wasted": "138KB", "wastedPercent": "76%" }],
    "heavyResources": [{ "url": "/local/assets/img/kidsPromo-mob.png", "total": "1759KB" }],
    "unminifiedCss": [{ "url": "/bitrix/cache/css/.../template.css", "wasted": "5KB" }],
    "unminifiedJs": [],
    "bfcacheFailures": ["The page has an unload handler in the main frame.", "Pages with cache-control:no-store cannot enter back/forward cache."]
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
  ],
  "effortEstimate": {
    "stages": [
      {
        "id": 1,
        "label": "Критичные блокеры",
        "deadline": "1–2 недели",
        "taskCount": 4,
        "hours": { "seo": 5, "dev": 14, "qa": 2, "devops": 6, "design": 0, "pm": 7, "total": 34 }
      },
      {
        "id": 2,
        "label": "Важные изменения",
        "deadline": "до 30 дней",
        "taskCount": 6,
        "hours": { "seo": 14, "dev": 42, "qa": 8, "devops": 4, "design": 2, "pm": 16, "total": 86 }
      },
      {
        "id": 3,
        "label": "Желательные улучшения",
        "deadline": "1–3 месяца",
        "taskCount": 5,
        "hours": { "seo": 18, "dev": 70, "qa": 16, "devops": 12, "design": 8, "pm": 29, "total": 153 }
      }
    ],
    "totals": {
      "seo": 37, "dev": 126, "qa": 26, "devops": 22, "design": 10, "pm": 52, "total": 273
    }
  }
}
```

Заполни корректными значениями. Оценки — по шкале 1–10. При отсутствии данных используй null.

**Требование к `scoreDetails`**: поле обязательно для каждой категории в `scores`. Каждый элемент — конкретный факт с иконкой статуса (✅/🔴/⚠️), например: `"✅ title 52 симв."`, `"🔴 description 285 симв. (норма 70-160)"`. Не оставляй пустые массивы.

**Поле `block` в каждой проверке** — номер раздела мастер-чеклиста (например `"2.2"` = «Блок 2 → HTTP-заголовки»). Используется для группировки в отчёте.

---

### Правило 15 — Целостность данных в `pages[]` (КРИТИЧНО)

В отчёте есть две независимых поверхности на одну и ту же страницу: **метрики** в шапке карточки (Title, Description, H1, Canonical, Schema.org, OG, Breadcrumbs, Изображения) и **issues[]** ниже. Они **обязаны** говорить одно и то же. Противоречие («H1 — зелёная галочка» в метриках и «H1 отсутствует» в issues) подрывает доверие ко всему отчёту.

#### Источник истины — collector

Все значения в `pages[].metrics` берутся **только из результата collector-скрипта (Фаза 1, шаг 2.4 — `[...document.querySelectorAll('h1')].map(...)`** и т.п.). Не редактируй, не «угадывай», не подставляй пустые значения, если collector вернул `null` — пиши `null`.

#### Контракт по типам полей

| Поле | Тип | Пустое значение |
|---|---|---|
| `title` | string \| null | `null` если нет тега |
| `titleLen` | number \| null | `null` если нет |
| `metaDesc` | string \| null | `null` |
| `metaDescLen` | number \| null | `null` |
| **`h1`** | **массив строк** | **`[]`** (никогда не строка, никогда не `null`) |
| `h2Count`, `h3Count` | number | `0` |
| `canonical` | string \| null | `null` |
| `schemaTypes` | массив строк | `[]` |
| `hasSchema`, `hasOpenGraph`, `hasBreadcrumbs`, `hasFavicon`, `hasCookieConsent` | boolean | `false` |
| `imgsTotal`, `imgsNoAlt`, `imgsBroken` | number | `0` |
| `aeoReadiness.firstParagraphWords` | number | `0` |
| `badAnchors` | `{ count: number, examples: [] }` | `{count:0, examples:[]}` |

⚠️ **Не пиши** `"h1": "Заголовок"` (строка) и **не пиши** `"h1": null`. Только массив. Это критично, потому что в JS пустая строка falsy, а пустой массив truthy — путаница приводит к зелёным галочкам там, где значение отсутствует.

#### Правило согласованности `metrics` ↔ `issues[]`

Перед сохранением `pages[]` для каждой страницы выполни внутренний чек: каждый critical/warning из `issues[]` должен **подтверждаться** соответствующим полем `metrics`. Если в issues стоит «H1 отсутствует», то `metrics.h1` обязан быть `[]`. Если в issues «Canonical отсутствует», то `metrics.canonical === null`. Если в issues «Schema.org отсутствует», то `metrics.schemaTypes === []` и `metrics.hasSchema === false`.

| Issue | Обязательное состояние metrics |
|---|---|
| «H1 отсутствует / реализован через H2» | `h1: []` |
| «Дубли H1 на странице» | `h1.length >= 2` |
| «Title слишком длинный» | `titleLen > 60` |
| «Title слишком короткий» | `titleLen < 30` или `titleLen === null` |
| «Description слишком длинный» | `metaDescLen > 160` |
| «Canonical отсутствует» | `canonical === null` |
| «Schema.org разметка отсутствует» | `schemaTypes.length === 0`, `hasSchema === false` |
| «Open Graph не настроен» | `hasOpenGraph === false` |
| «Хлебные крошки отсутствуют» | `hasBreadcrumbs === false` |
| «N изображений без alt» | `imgsNoAlt === N` |
| «N битых картинок» | `imgsBroken === N` |

Если обнаруживаешь конфликт — **доверяй collector-у, переписывай issue**, не наоборот. Collector — машинная истина с реального DOM; issue — твоя интерпретация, она могла быть скопирована из чернового анализа другой страницы.

#### Правило согласованности `pages[]` ↔ `recommendations[]`

Если ты выписал рекомендацию «Добавьте H1 на главную» (или подобную site-wide) — она должна ссылаться через `affectedUrls[]` или `sourceChecks[]` на конкретные страницы из `pages[]`, у которых `metrics.h1 === []`. Не выдумывай рекомендации, у которых нет подтверждения в `pages[].metrics` или в `technical[]`.

#### Самопроверка перед сохранением JSON

Прогоняй мысленный чек по каждой странице:
1. Все поля `metrics` имеют корректный тип по контракту выше? (h1 — массив, canonical — string|null, и т.д.)
2. Каждый critical/warning issue подтверждается полем metrics?
3. Нет ли в metrics поля, которое противоречит issue (например, `hasOpenGraph: true`, но issue «OG не настроен»)?
4. Если на странице нашлось N issue, но `metrics` показывает идеальное состояние — где-то ошибка, перепроверь сбор данных.

---

### Правило 16 — Формальный язык: без сленга и маркетингового жаргона

Отчёт — это **формальный документ**, который читает руководитель/собственник бизнеса, а не SEO-маркетолог в чате. Жаргонные термины SEO-индустрии звучат непрофессионально и снижают воспринимаемую серьёзность работы. Запрещены во **всех** клиентских полях (тот же список, что в Правиле 14).

#### Запрещённый сленг → формальная замена

| ❌ Сленг | ✅ Формально |
|---|---|
| **каннибализация** (запросов / страниц) | «конкуренция страниц одного сайта за один и тот же запрос», «перекрытие страниц по ключам», «overlap по запросам в выдаче» |
| **просадка** (позиций / трафика) | «снижение позиций», «потеря органического трафика», «падение видимости» |
| **просесть** / **проседать** | «потерять позиции», «снизиться в выдаче» |
| **залить** (контент / правки) | «опубликовать», «развернуть», «внести изменения» |
| **выкатить** (релиз) | «опубликовать обновление», «развернуть на проде» |
| **слить** (трафик / данные) | «направить» / «экспортировать» |
| **профукать** | (вычеркнуть, переписать) |
| **накрутка** (поведенческих) | «искусственное влияние на поведенческие факторы» |
| **дропы** (доменов) | «истёкшие домены» |
| **жирные ссылки** | «авторитетные ссылки», «ссылки с высоким DR/ИКС» |
| **нулёвки** (запросы) | «низкочастотные запросы без частотности» |
| **пускалка** / **пушка** | (вычеркнуть, переписать) |
| **бомба-запрос** / **денежный запрос** | «коммерческий высокочастотный запрос», «транзакционный запрос» |
| **сапа** / **миралинкс** | (вычеркнуть, переписать — конкретные биржи не упоминаем) |
| **ПФ** в значении накрутки | «поведенческие факторы» (термин допустим только в нейтральном смысле как фактор ранжирования) |
| **выйти в топ** | «вывести в верхние позиции выдачи», «занять место в первой десятке» |
| **серый/чёрный SEO** | «методы, нарушающие правила поисковой системы» |
| **манипуляция выдачей** | «искусственное влияние на ранжирование» |
| **поисковый спам** | «нарушения требований поисковой системы к качеству контента» |

#### Что НЕ считается сленгом (допустимые технические термины)

Эти термины — устоявшиеся профессиональные, их **не** заменять:
- `Title`, `meta description`, `H1`, `canonical`, `sitemap.xml`, `robots.txt`
- `Schema.org`, `JSON-LD`, `microdata`, `RDFa`, `Open Graph`, `BreadcrumbList`
- `LCP`, `CLS`, `TBT`, `INP`, `FCP`, `Core Web Vitals`, `Lighthouse`
- `краулер`, `краулинг`, `индексация`, `индекс`, `выдача`, `сниппет`
- `редирект`, `301`, `302`, `HSTS`, `HTTP/2`, `HTTPS`
- `анкор`, `nofollow`, `dofollow`, `internal link`, `backlink`, `ИКС`
- `E-E-A-T`, `YMYL`, `EEAT`
- `ranking factor`, `rich snippet`, `featured snippet`, `Knowledge Panel`
- `click-through rate (CTR)`, `bounce rate`, `dwell time`

#### Обязательная самопроверка

Перед сохранением каждого client-facing поля (тот же набор, что в Правиле 14: `title`, `description`, `impact`, `verify`, `steps[]`, `technical[].value`, `scoreDetails`, `strengths`, `risks`, `executiveSummary.*`) пройди по списку запрещённого сленга. При обнаружении — замени по таблице выше. Не «прикинь в уме» — формально пройди.

⚠️ На отчёте maxilac.ru v1.14.0 термин **«каннибализация»** появился в `recommendations[].impact` («приводят к каннибализации собственных страниц») и в `notChecked[]` — оба раза скопирован из примеров SKILL.md. Примеры в SKILL.md теперь переписаны через формальные формулировки.

---

## Фаза 4 — Генерация отчётов

### Markdown-отчёт
Создай `seo-audit-output/${REPORT_BASE}.md` со структурой:

```markdown
# SEO Аудит: [ДОМЕН]
**Дата**: [YYYY-MM-DD] | **Сайт**: [URL] | **Оценка**: [A/B/C/D/F] ([X.X/10])
**Подготовлено**: itsoft.ru · pharm-studio.ru · nedzelsky.pro · v1.10.1

> [⚠️ Базовый режим / ✅ Полный режим Chrome + Lighthouse]

---

## Главное

[executiveSummary.headline]

> *«[executiveSummary.onePhrase]»*

**Проверено страниц**: N · 🔴 N критических · 🟡 N предупреждений · 🟢 N хорошо

### ✅ Что работает
[strengths — 3-5 пунктов в активной формулировке]

### 🔴 Главные риски
[risks — 3-5 пунктов в формате «последствие → причина»]

---

## Оценки по 10 категориям

| Категория | Оценка | Детали |
|-----------|--------|--------|
[строки + scoreDetails]

**Средняя оценка: X.X/10**

---

## План действий

### 🔴 Срочно (1–2 недели) — N задач
[нумерованный список рекомендаций фазы urgent с заголовками]

### 🟡 В этот месяц — N задач
[нумерованный список фазы month]

### 🟢 Стратегия (1–3 месяца) — N задач
[нумерованный список фазы strategy]

---

## Детализация рекомендаций

### N. [Заголовок рекомендации]
**Приоритет**: Высокий · **Сложность**: Низкая · **Трудозатраты**: 1–2 часа · **Категория**: Блок 6 · Schema.org

**Проблема**: [description с конкретными числами]

**Почему это важно**: [impact — бизнес-последствие]

**Шаги внедрения**:
1. [steps]
2. ...

**Готовый код**:
```
[fix]
```

**Как проверить**: [verify]

**Затронутые URL**: [affectedUrls если есть]

[повторить для каждой рекомендации, нумерация сквозная]

---

## Анализ ключевых страниц

### [Тип шаблона] · [URL]
| Параметр | Значение |
|----------|----------|
| Title | N симв. |
| Description | N симв. |
| H1 | ✓/нет |
| Canonical | ✓/нет |
| Schema.org | [типы] |
| Open Graph | ✓/нет |
| Изображения | N (без alt: N, битых: N) |

**Проблемы:**
- [критические/предупреждения]

[повторить для каждой страницы]

---

## Технические проверки по блокам мастер-чеклиста

### Блок 1 · Краулинг и индексирование
| Проверка | Статус | Значение |
|----------|--------|----------|
[строки technical[].block начинающиеся с "1."]

### Блок 2 · Технические HTTP / Сервер
[аналогично]

[... остальные блоки которые проверены ...]

---

## Lighthouse

| Категория | Балл |
|-----------|------|
| Performance | N/100 |
| SEO | N/100 |
| Accessibility | N/100 |
| Best Practices | N/100 |

---

## Оценка трудозатрат на внедрение

Оценка построена на baseline-часах × множители (CMS, объём, риск, QA). Без учёта стоимости согласований клиента.

**CMS**: [cms] · **Размер сайта**: [size] ([totalUrls] URL)

### Сводка по этапам внедрения

| Этап | Dev | SEO | QA | Content | Всего |
|------|----:|----:|---:|--------:|------:|
| 1. Критичные блокеры — N задач | N | N | N | N | N ч |
| 2. Pattern fixes — N задач | N | N | N | N | N ч |
| 3. Site-wide и долгосрочное — N задач | N | N | N | N | N ч |
| 4. Полировка — N задач | N | N | N | N | N ч |
| **Резерв** ([reservePercent]%) | N | N | N | N | N ч |
| **Менеджмент** (~10% Dev+SEO) | — | — | — | — | N ч |
| **ИТОГО** | **N** | **N** | **N** | **N** | **N ч** |

### Топ-10 задач по приоритету (RICE)

| # | Задача | Этап | Часы | RICE |
|---|--------|------|-----:|-----:|
| 1 | ... | 1 | N ч | N |

> Дисклеймер: оценка ориентировочная. Baseline-часы — отраслевые средние. Не включает стоимость согласований клиента (типично +30% к календарному сроку).

**Core Web Vitals**: LCP X · TBT X · CLS X · FCP X · TTI X

[blockingScripts если есть]
[imgOptimizations если есть]
[bfcacheFailures если есть]

---

## За рамками этого отчёта

[notChecked — список проверок вынесенных в отдельный этап]

Для углублённого анализа этих блоков обращайтесь: itsoft.ru · pharm-studio.ru · nedzelsky.pro

---

## Скриншоты
- **Десктоп**: [путь] (1350×940, Lighthouse desktop preset)
- **Мобильный**: [путь] (412×823, Lighthouse mobile)

---

## Методология

Отчёт построен на мастер-чеклисте из 374 проверок в 21 блоке — синтезе ведущих SEO-источников (Google Search Central, Semrush, Ahrefs, Moz, Backlinko, Wellows, Brightter, NoGood) и стандартов W3C / Schema.org.

**Дата**: [date] · **Версия**: v1.10.1
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
