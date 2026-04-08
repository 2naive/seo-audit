# Changelog — SEO Audit Skill

## [1.8.2] — 2026-04-09 — Качество и навигация по отчёту

Патч на основе критического разбора v1.8.1-отчёта maxilac.ru. Найдено 9 проблем разной приоритетности; в этом релизе устранены 4 важных.

### Added — TOC (оглавление) в HTML-отчёт

- Новая секция «Содержание» после обложки, перед «Как читать»
- Кликабельные ссылки на 11 основных разделов отчёта (Главное, Оценки, Lighthouse, План действий, Детализация рекомендаций, Анализ страниц, Технические проверки, Скриншоты, Что не проверялось, Методология)
- Двухколоночная вёрстка через `column-count: 2` для компактности
- id-якоря добавлены ко всем секциям: `#how-to-read`, `#exec-summary`, `#scores`, `#lighthouse`, `#roadmap`, `#recs`, `#pages`, `#technical`, `#screenshots`, `#not-checked`, `#methodology`
- Условное скрытие пунктов TOC: если в отчёте нет страниц или скриншотов, соответствующие пункты не показываются

### Added — усиленные правила формирования рекомендаций (Фаза 3)

**Правило 1 — `fix` обязан быть CMS-специфичным**:
- Таблица good/bad для 4 CMS: Bitrix, WordPress, nginx, Tilda
- Запрет на generic PHP без учёта CMS — например, для Bitrix canonical нельзя давать `<?php $canonical = ...; ?>`, нужно `$APPLICATION->SetPageProperty('canonical', ...)`
- Если `cmsInfo` указывает на конкретную CMS — fix должен использовать её API/конвенции

**Правило 1 — `verify` обязан быть в формате «Текущее → Желаемое»**:
- Таблица good/bad с 3 примерами
- Запрещены обобщённые фразы типа «проверить через Lighthouse» — нужно указать текущее значение и целевое
- Пример: `Сейчас: curl -sI .../sitemap.xml → HTTP 404. Цель: HTTP 200 + Content-Type: text/xml`

**Правило 2 — расширенный запрет тавтологий в `impact`**:
- Таблица расширена с 3 до 5 примеров (добавлены sitemap, PHPSESSID)
- Самопроверка: «можно ли это прочитать клиенту-нетехнику?»
- Требование конкретики: метрика, %, цифра, аудитория

### Changed — Правило 12 (coverage блоков)

- Добавлены пояснения по блокам с **частичным** покрытием:
  - **Блок 11 (JS-рендеринг)** — покрыт частично (сравнение raw HTML vs DOM), не покрыт SSR/SSG-анализ
  - **Блок 12 (Скрытый контент)** — покрыт hiddenTextElements + zeroSizeLinks, не покрыт cloaking detection
  - **Блок 8 (E-E-A-T)** — покрыт по сигналам, экспертная оценка контента — manual
- Блоки 11 и 12 остаются в `blocksCovered` с указанием частичности
- Уточнения для каждого manual-блока (что именно требует ручной работы)

### Verified

- Тест на готовом JSON maxilac.ru: HTML 364 KB, PDF 3.4 MB, TOC отображается с двумя колонками
- Все id-якоря работают (внутренние ссылки из TOC и Roadmap)
- Backward compatible: старые отчёты v1.6/v1.7 продолжают рендериться

## [1.8.1] — 2026-04-09

### Fixed — PDF generation работает при активном Claude Chrome Extension

**Корневая причина** (диагностика):
- На Windows когда работает Claude Chrome Extension, обычный `chrome.exe --headless --print-to-pdf` молча падает (exit 0, файл не создан, `lockfile: Device or resource busy`).
- Process Singleton mechanism Chrome: `chrome.exe` видит существующий main process и выводит «Opening in existing browser session» — подсасывает к нему вместо запуска изолированной headless instance.
- `--user-data-dir=$(mktemp -d)` НЕ помогает обойти Singleton (вопреки распространённому совету).
- Только `--remote-debugging-port=N` обходит Singleton — но `--print-to-pdf` несовместимо с debug port (флаги взаимоисключающие).

**Решение — CDP через WebSocket** (как в `chrome-launcher`/Lighthouse):
1. `spawn` Chrome с `--remote-debugging-port=N`, `detached: true`, `child.unref()` (наследование handles от родителя ломает Singleton bypass)
2. Polling `GET http://127.0.0.1:N/json/version` до готовности (до 15 секунд)
3. `GET /json/list` — получить `webSocketDebuggerUrl` для page target
4. WebSocket handshake (HTTP Upgrade с `Sec-WebSocket-Key`)
5. Отправка `Page.enable` через WebSocket frame (с маскированием от клиента)
6. Пауза 2.5 сек для рендера (картинки, шрифты, base64 ассеты)
7. `Page.printToPDF` через CDP — получаем base64 в response
8. Сохранение через `Buffer.from(data, 'base64')`
9. Cleanup: `child.kill()` + `rmSync` временного профиля

**Реализация**:
- Минимальный WebSocket клиент написан с нуля через `http` + `net` + `crypto` — без npm-зависимостей (~100 строк)
- Поддерживает фрагментированные frames (7/16/64-bit length)
- Маскирование payload от клиента к серверу (требование RFC 6455)
- Обработка только text frames (opcode 1) — достаточно для CDP

**Тест**: PDF 3.4 MB сгенерирован при активном Claude Chrome Extension в текущей сессии. Время: ~5 секунд (включая запуск Chrome, навигацию, рендер, печать).

### Changed
- `generate-report.js`: функция `generatePDF()` async, использует CDP вместо `--print-to-pdf` флага
- Удалено известное ограничение из v1.8.0 «PDF не работает при активном Extension» — теперь работает

## [1.8.0] — 2026-04-09 — Клиентская вёрстка отчёта

Третий и финальный релиз серии переработки `/seo-audit` под клиентский отчёт. После v1.6 (фундамент схемы) и v1.7 (расширение сбора) — теперь полная переработка вёрстки HTML/PDF.

### Added — 13 секций нового отчёта

1. **Cover-page** — отдельная обложка с брендингом, оценкой A-F (большая буква 140px), фразой-выводом и подвалом «itsoft.ru · pharm-studio.ru · nedzelsky.pro»
2. **«Как читать отчёт»** — карточка с легендой приоритетов, сложности, фаз
3. **Executive Summary** — оценка A-F + Главное + Сильные стороны + Главные риски (две колонки)
4. **Дашборд метрик** — stat-grid + строка покрытия (X блоков auto / Y manual)
5. **Оценки по 10 категориям** — таблица + scoreDetails (как было, расширена)
6. **Lighthouse** — расширен: 4 категории, метрики с пояснениями, blockingScripts, imgOptimizations, bfcacheFailures
7. **План действий (Roadmap)** — три колонки: 🔴 Срочно (1-2 недели) · 🟡 В этот месяц · 🟢 Стратегия. С внутренними якорями к карточкам
8. **Детализация рекомендаций** — расширенные карточки с 7 секциями: Проблема, Почему важно (impact), Шаги внедрения (steps), Готовый код (fix), Как проверить (verify), Затронутые URL, 4 бейджа (приоритет / сложность / часы / категория)
9. **Анализ ключевых страниц** — карточки по типу шаблона (home/category/service/article/contacts/faq) с метриками title/desc/H1/canonical/Schema/OG/breadcrumbs/imgs и проблемами
10. **Технические проверки по блокам** — `technical[]` сгруппированы по 21 блоку мастер-чеклиста с заголовками
11. **Скриншоты** — с подписями про viewport и источник
12. **Что не проверялось автоматически** — желтая карточка с `notChecked[]` и upsell на ручную работу
13. **Методология** — статичная страница с источниками, инструментами, контактами

### Added — новые helpers в `generate-report.js`

- `gradeColor(grade)` — A=#16a34a, B=#22c55e, C=#f59e0b, D=#ea580c, F=#dc2626
- `effortBadge(hours)` — бейдж «⏱ 1–2 часа»
- `categoryBadge(category, label)` — бейдж «Блок 6 · Schema.org»
- `BLOCK_NAMES` — карта 21 блока мастер-чеклиста
- `LH_METRIC_DESC` — пояснения к LCP/TBT/CLS/FCP/SI/TTI/INP под каждой метрикой
- `computePhase(r)` + автоматическая нумерация рекомендаций сквозная
- Внутренние якоря `id="rec-N"` от Roadmap к карточкам

### Added — клиентский CSS-стиль

- Палитра CSS-переменных (`--critical`, `--warning`, `--ok`, `--primary`)
- Cover-page как полноэкранный градиент с `page-break-after: always`
- `@page :first` — без номера страницы на обложке
- Все карточки рекомендаций / страниц / фаз / блоков получают `break-inside: avoid`
- Тёмный фон для блоков кода (`#0f172a` + `#e2e8f0`)
- Цветные акценты: impact в синем блоке, verify в зелёном, рекомендации фаз с цветной левой границей

### Removed

- Старый блок «Топ-5 действий с максимальным ROI» — дублировал Roadmap
- Старая секция «Проблемы по страницам» как отдельная таблица — теперь внутри Page Cards

### Changed

- Markdown-шаблон в Фазе 4 SKILL.md синхронизирован с новой HTML-структурой
- Общая структура `buildHTML()` переписана с нуля для контроля над секциями

### Verified (тест на data от maxilac.ru-0007)

- ✅ HTML 378 KB генерируется без ошибок
- ✅ Все 13 секций присутствуют в выводе
- ✅ 17 расширенных карточек рекомендаций с impact / steps / verify / 4 бейджа
- ✅ 3 колонки фаз в Roadmap с якорями
- ✅ Cover-page с оценкой D, фразой, брендингом
- ✅ Технические проверки сгруппированы по блокам мастер-чеклиста

### Known limitations

- PDF generation на Windows блокируется, когда активен Claude Chrome Extension (Chrome headless конфликтует с тем же бинарником). Workaround: открыть HTML в браузере и распечатать через Ctrl+P → Save as PDF. Альтернативные браузеры (Edge и др.) использовать запрещено по требованию пользователя.

## [1.7.3] — 2026-04-09

### Fixed

- **PDF generation падал с "PDF not found after Chrome completed"** — та же причина что у скриншотов до v1.7.1: `chrome.exe --headless` запущенный без `--user-data-dir` конфликтует с уже работающим Claude Chrome Extension, флаг headless не активируется, файл не создаётся. `generate-report.js` теперь:
  - Создаёт временный профиль через `mkdtempSync(os.tmpdir(), 'chr-pdf-')`
  - Запускает Chrome с `--user-data-dir=<temp>` + `--no-first-run` + `--no-default-browser-check`
  - Использует `cwd: outputDir` + относительный путь к PDF (Windows-специфика)
  - В `finally` удаляет временный профиль через `rmSync(..., {recursive:true, force:true})`
  - Timeout увеличен с 30 до 60 секунд (большие отчёты требуют времени)

- Тест: повторная генерация отчёта maxilac.ru дала PDF 3.2 MB (раньше 0 KB / отсутствие файла).

### Verified (тестовый запуск v1.7.2 на maxilac.ru)

- ✅ Lighthouse desktop отдал WEBP, файл сохранён как `desktop-*.webp` (155 KB)
- ✅ Валидация 2.6 приняла WEBP magic bytes (52 49 46 46 ... 57 45 42 50)
- ✅ Правило 11 применилось:
  - HTTP/2 upgrade рекомендован (siteData.http2.version = HTTP/1.1)
  - llms.txt + AI crawlers рекомендованы (notMentioned: 7 ботов)
  - Cookie consent (152-ФЗ) рекомендован
  - Semantic HTML рекомендован
- 17 рекомендаций в отчёте (было 15 без Правила 11)

## [1.7.2] — 2026-04-08

### Fixed (по результатам теста v1.7.1 на maxilac.ru)

- **Lighthouse desktop preset отдаёт WEBP, не JPEG** — десктоп-файл `.jpg` имел magic bytes `52 49 46 46 ... 57 45 42 50` (WEBP RIFF-контейнер). Валидация v1.7.1 не знала про WEBP и могла пропустить файл с неверным расширением.
  - Шаг 2.3: extraction теперь определяет формат из data URI mime-типа (`data:image/webp;base64,...`) и сохраняет файл с правильным расширением (`.webp`, `.jpg` или `.png`)
  - Шаг 2.6: валидация принимает WEBP magic bytes (`52494646...57454250`) в дополнение к JPEG/PNG
  - Шаг 2.6: ищет десктоп-файл с любым из расширений `.webp`/`.jpg`/`.jpeg`/`.png`
  - `generate-report.js`: `screenshotBase64` поддерживает `image/webp` MIME-тип

- **Агент не использовал собранные v1.7.0/v1.7.1 данные в рекомендациях** — `siteData.http2.version="HTTP/1.1"` собрано, но рекомендации апгрейдить не было; AI crawlers собраны, но llms.txt не предлагалось; AEO readiness собран, но не использовался.
  - Добавлено **Правило 11** в Фазу 3: 21 явное условие → рекомендация для каждого нового поля (HTTP/2 upgrade, llms.txt, mixed content, DOM size, AEO readiness, formsHttps, и т.д.)
  - Добавлено **Правило 12** (бывшее «coverage блоков») — переименовано

### Verified (тестовый запуск v1.7.1 на maxilac.ru)

- ✅ siteData полностью заполнено: 7/7 полей (llmsTxt, aiCrawlers, hreflang, http2, mixedContent, pagination, orphanPages)
- ✅ pages[].metrics — 10/13 новых полей (3 опущены агентом для пустых результатов: fontDisplay, formsHttps, closeTapTargets, protocolRelativeCount)
- ✅ Lighthouse desktop preset работает, mobile/desktop разные MD5
- ❌ HTTP/1.1 detected на maxilac.ru, но рекомендации не было — фиксится Правилом 11

## [1.7.1] — 2026-04-08

### Fixed (по результатам тестового аудита maxilac.ru с v1.7.0)

- **21 новое поле сбора v1.7.0 не попадало в JSON** — данные собирались агентом через JS-скрипт, но не было указания куда их класть в финальном JSON. Расширена `pages[].metrics`: добавлены `domSize`, `domDepth`, `textHtmlRatio`, `semanticTags`, `first100WordsHasH1Keyword`, `hasFavicon`, `hasCookieConsent`, `aeoReadiness`, `fontDisplay`, `formsHttps`, `protocolRelativeCount`, `closeTapTargets`, `bodyTextLen`, `imgsTotal`, `imgsNoAlt`, `imgsBroken`, `h2Count`, `h3Count`. Добавлено новое верхнеуровневое поле `siteData`: `llmsTxt`, `aiCrawlers`, `hreflang`, `http2`, `mixedContent`, `pagination`, `orphanPages`.

- **Headless Chrome падает молча на Windows когда запущен Claude Chrome Extension** — корневая причина: Extension занимает процессную группу, и `chrome.exe --headless` открывается как обычное окно вместо headless. Файл создаётся пустым с exit 0. Решение: десктоп-скриншот теперь делается через **второй запуск Lighthouse с `--preset=desktop`**, оттуда извлекается `fullPageScreenshot` (1350×940 viewport) в `desktop-*.jpg`. Это единственный надёжный способ получить уникальный десктопный скриншот в этой среде.

### Changed

- **Шаг 2.1** — упрощён, десктоп-скриншот отложен до 2.3
- **Шаг 2.3** — теперь делает ДВА запуска Lighthouse:
  1. mobile (как было) — `lighthouse-{domain}-{datetime}.json` + `mobile-*.jpg`
  2. desktop — `lighthouse-desktop-{domain}-{datetime}.json` + `desktop-*.jpg` (с `--preset=desktop --only-categories=performance`)
- **Шаг 2.6** — валидация принимает JPEG (magic bytes `ffd8ff`) для десктопа, минимальный размер снижен с 50KB до 30KB (Lighthouse JPEG обычно 30–200KB), MD5-проверка остаётся.
- **screenshotPaths.desktop** в JSON-схеме теперь `.jpg` вместо `.png`.

### Notes

- Lighthouse desktop preset запускает только `performance` категорию (не нужны полные SEO/A11y данные второй раз) — это быстрее и меньше нагрузки.
- В отчёте теперь оба скриншота — JPEG, что снижает размер HTML/PDF.

## [1.7.0] — 2026-04-08

### Added — расширение сбора данных по мастер-чеклисту

**JS-сборщик в шаге 2.1 (12 новых полей):**
- `domSize`, `domDepth` (3.5.4 — норма ≤1500 узлов / ≤32 уровня)
- `semanticTags` — счётчики `<article>`, `<section>`, `<header>`, `<nav>`, `<main>`, `<aside>`, `<figure>` (17.3.6 для GEO)
- `textHtmlRatio` (21.3.3 — норма ≥15%)
- `fontDisplay` — массив `{family, display, status}` для первых 10 шрифтов (3.5.2)
- `formsHttps` — `{total, httpsActions, insecureActions}` (2.5.2)
- `protocolRelativeCount` — количество `src="//..."` ссылок (2.5.3)
- `hasCookieConsent` — heuristic по `[class*=cookie/consent/gdpr]` (13.6.2)
- `aeoReadiness` — `{firstParagraphWords, hasFaqSection}` (17.2.1, 17.2.2)
- `first100WordsHasH1Keyword` (5.7.1)
- `hasFavicon`, `faviconHrefs` (7.3.2)

**JS-сборщик в шаге 2.2 (mobile, новые поля):**
- `closeTapTargets` — пары интерактивных элементов с расстоянием < 8px (4.2.2)
- `bodyTextLen`, `h1Count`, `h2Count`, `imgCount` для desktop/mobile content parity (4.3.2)

**Bash-проверки:**
- **1.1** — расширена проверкой AI-краулеров (`GPTBot`, `ClaudeBot`, `PerplexityBot`, `Googlebot-Extended` и др., 1.1.8)
- **1.4** — добавлена проверка soft 404 (страница 200 с «не найдено» в теле, 1.5.2)
- **1.7** — добавлена detection HTTP/2 и HTTP/3 (3.5.1)
- **1.9** — расширена проверкой пагинации (title/canonical/реализация, 13.3)
- **1.10 (новый)** — проверка `llms.txt` + `llms-full.txt` (21.3.5) и hreflang при многоязычии (Блок 16)
- **1.11 (новый)** — детектор orphan pages (URL из sitemap без входящих ссылок с главной/навигации, 9.2.1)
- **2.1** — Mixed Content detection через `read_console_messages` с `pattern: "Mixed Content"` (2.1.2)

### Notes

- Для mobile-desktop content parity: сравни `bodyTextLen` в шаге 2.2 с десктопным `pageSize` из шага 2.1. Резкое различие (>30%) — это критично (mobile-first indexing).
- Hreflang проверяется только если найден `<link rel="alternate" hreflang>` в шаге 1.5. Иначе — пропуск Блока 16 как «не применимо».
- Orphan pages — эвристика на основе главной + навигации (без полного crawl). Для коммерческих сайтов даёт быструю валидную картину.

## [1.6.1] — 2026-04-08

### Fixed (по результатам тестового аудита maxilac.ru)

- **`mcp__claude-in-chrome__javascript_tool` блокирует строки с PHPSESSID/JSESSIONID** — добавлено предупреждение в шаг 2.1: не возвращать `innerHTML` целиком из JS-сборщика. Переписаны проверки `hasYandexMetrika` и `hasGTM` через `querySelector` вместо `innerHTML.includes`, чтобы не получать `[BLOCKED: Cookie/query string data]`.
- **Headless Chrome на Windows не принимает абсолютные пути в `--screenshot=`** (ни `C:/...`, ни `C:\...`, ни `/c/...` — файл создаётся пустым с exit 0). В шаг 2.1 добавлено обязательное `cd "$OUTPUT_DIR"` и относительное имя файла как единственный надёжный способ.
- **Node.js на Windows не интерпретирует `/c/...` пути** (msys-ism не применяется). Добавлено явное правило: внутри `node -e` использовать только формат `C:/Users/...` (forward slashes с буквой диска).
- **`mcp__claude-in-chrome__navigate` отвергает `about:blank`** — заменено на `chrome://newtab/` для возврата вкладки в финальном шаге.

### Verified (тестовый запуск v1.6.0 на maxilac.ru)

- Все 14 новых полей рекомендаций заполнены агентом 16/16 (100%)
- `executiveSummary.grade` = "D" с осмысленным `headline` и `onePhrase`
- `strengths[]` = 5, `risks[]` = 7 (правильный формат «последствие → причина»)
- `coverage` корректный: 13 автоматических блоков, 7 manual
- `pages[].template` и `pages[].metrics` заполнены для всех страниц
- `technical[].block` = 54/54
- `phase` распределение: 7 urgent / 8 month / 1 strategy

## [1.6.0] — 2026-04-08

### Added — расширение JSON-схемы (фундамент для клиентского отчёта)

**Верхнеуровневые поля:**
- `executiveSummary` — `{grade, headline, onePhrase}` для буквенной оценки A-F и заголовка
- `strengths[]` — топ-5 «что уже работает» с активными формулировками
- `risks[]` — топ-5 бизнес-рисков в формате «последствие → причина»
- `coverage` — `{blocksCovered, blocksManual, automatedCount, manualCount}` для блока «Покрытие аудита»
- `notChecked[]` — список ручных проверок (для секции upsell)

**Поля рекомендаций (`recommendations[]`):**
- `impact` — обязательное бизнес-последствие, не технический факт
- `steps[]` — пошаговый план внедрения
- `verify` — команда / URL валидатора для проверки исправления
- `category` — номер блока мастер-чеклиста (`"6.1"`)
- `categoryLabel` — короткий лейбл для бейджа
- `effortHours` — человеко-часы (low → "1–2 часа" и т.д.)
- `phase` — `urgent` / `month` / `strategy` (вычисляется автоматически)
- `affectedUrls[]` — массив URL для дедупликации
- `sourceChecks[]` — связь с `technical[].check`

**Поля страниц (`pages[]`):**
- `template` — тип шаблона (home / category / service / article / contacts / faq)
- `metrics` — title, titleLen, metaDesc, h1, canonical, hasSchema, schemaTypes, hasBreadcrumbs

**Поля проверок (`technical[]`):**
- `block` — номер раздела мастер-чеклиста для группировки в отчёте

### Added — 10 правил формирования рекомендаций (Фаза 3)

1. 7 обязательных полей с примерами good/bad
2. Запрет технических тавтологий в `impact`
3. Дедупликация по `affectedUrls[]`
4. Автоматическое назначение `phase` (high+low → urgent, и т.д.)
5. Лимит 10–20 рекомендаций
6. Полнота: каждый critical/warning имеет рекомендацию
7. Формирование `strengths[]` с приоритетом источников
8. Формирование `risks[]` в формате «последствие → причина»
9. Буквенная оценка `grade` A-F по шкале средних scores
10. Сложение `coverage` и `notChecked[]`

### Notes

- Все изменения **обратно совместимы**: новые поля опциональные, старая схема продолжает работать.
- Это первый из трёх релизов перехода к клиентскому отчёту:
  - **v1.6.0** — JSON-схема + правила (фундамент)
  - **v1.7.0** — расширение сбора данных (новые проверки из мастер-чеклиста)
  - **v1.8.0** — клиентская вёрстка (cover, Roadmap, Page Templates, Methodology)

## [1.5.3] — 2026-04-08

### Fixed
- **Десктоп-скриншот pharm-studio.ru вместо целевого сайта** — корневая причина: `mcp__claude-in-chrome__computer` возвращает изображение в LLM-контекст, но не отдаёт raw-байты для записи через Write tool. Агент перешёл на локальный headless Chrome без `--user-data-dir`, и Chrome подхватил pharm-studio.ru из дефолтного профиля. Кроме того, валидация v1.5.1 не отлавливала случай, когда headless Chrome падал и оставлял старый файл от предыдущего аудита.

### Changed
- **Шаг 2.1 — десктоп через headless Chrome с изолированным профилем**:
  - Признано официально: десктоп снимается через `chrome.exe --headless=new`, не через MCP-инструмент Chrome Extension
  - Обязательные флаги: `--user-data-dir=$(mktemp -d)`, `--no-first-run`, `--no-default-browser-check`, `--window-size=1440,900`
  - URL `$ARGUMENTS` передаётся последним аргументом в командной строке Chrome
  - Перед снятием: `rm -f "$DESKTOP_PNG"` чтобы при ошибке Chrome не остался старый файл
- **Шаг 2.6 — добавлена mtime-валидация**: десктоп-файл должен быть новее чем lighthouse JSON / mobile JPG этой сессии. Это ловит случай "файл от предыдущего аудита остался на диске и не был перезаписан".

## [1.5.2] — 2026-04-08

### Changed
- **Подпись в подвале отчёта** — заменено "SEO Audit от Nedzelsky.pro" на "itsoft.ru · pharm-studio.ru · nedzelsky.pro" (три кликабельные ссылки) в HTML/PDF и в шаблоне Markdown.

## [1.5.1] — 2026-04-08

### Fixed
- **Десктоп-скриншот снова дублировал мобильный** — агент обошёл валидацию из 1.4.6, сохранив Lighthouse JPEG как `desktop-*.jpg` (валидация проверяла только `.png`). Добавлена новая контрольная точка **шаг 2.6** перед Фазой 3:
  1. Десктоп ОБЯЗАН существовать по пути `desktop-*.png` (расширение строго `.png`)
  2. Magic bytes должны быть `89504e47` (PNG)
  3. Размер > 50 KB
  4. **MD5 desktop ≠ MD5 mobile** — если совпадают, fail с объяснением что агент использовал один источник для обоих
- **Шаг 2.1** — добавлен явный запрет на использование Lighthouse `final-screenshot` для десктопа, с указанием что нарушение приведёт к провалу шага 2.6.

## [1.5.0] — 2026-04-08

### Added
- **JS-скрипт шаг 2.1 расширен** — новые поля: `h2texts`/`h3texts` (текст заголовков, не только счётчик), `anchorFrequency` (топ-15 анкоров с частотой), `imgDetails` (src+alt первых 10 изображений), `brokenImgSrcs` (конкретные src битых картинок), `ctaAboveFold` (CTA выше fold), `smallFontElements` (шрифты < 12px), `zeroSizeLinkHrefs` (href нулевых ссылок)
- **Шаг 1.2 — цепочки редиректов** — `curl -w "%{num_redirects}"` для URL из sitemap, фиксирует A→B→C цепочки как warning
- **Шаг 1.7 — Cache-Control по типам** — отдельные проверки для CSS/JS/изображений, определение CMS через `X-Powered-By` и паттерны URL
- **Шаг 2.3 Lighthouse — блокирующие скрипты** — извлечение `render-blocking-resources`, `uses-optimized-images`, `bf-cache` failures из Lighthouse JSON
- **Шаг 2.5 Schema.org — валидация обязательных полей** — JavaScript-валидатор для Organization, WebSite, BreadcrumbList, FAQPage, Article с проверкой missing полей
- **Фаза 3 — правила полноты и дедупликации** — каждый critical/warning в `technical` обязан иметь рекомендацию; одна проблема — в одном месте
- **JSON-схема** — новые поля: `cmsInfo`, `lighthouse.blockingScripts`, `lighthouse.imgOptimizations`, `lighthouse.bfcacheFailures`

## [1.4.6] — 2026-04-08

### Fixed
- **Десктоп-скриншот снова был JPEG из Lighthouse** — несмотря на инструкцию в 1.4.5, агент продолжал сохранять Lighthouse `final-screenshot` как `desktop-*.png` (с JPEG-заголовком `ffd8ff`). Добавлена обязательная валидация magic bytes после сохранения: скрипт проверяет что файл начинается с `89504e47` (PNG) и > 50 KB. При провале выводит явную ошибку с инструкцией повторить через `mcp__claude-in-chrome__computer`.

## [1.4.5] — 2026-04-08

### Fixed
- **Десктоп-скриншот дублировал мобильный** — агент использовал Lighthouse `final-screenshot` для обоих скриншотов, т.к. инструкция в 2.1 не запрещала это явно. Root cause: Lighthouse снимает только мобильный viewport (412px), поэтому оба файла были идентичны. Добавлено явное предупреждение в шаг 2.1: "не из Lighthouse — Lighthouse снимает мобильный viewport". Добавлены комментарии в JSON-схему (`screenshotPaths`) с указанием источника каждого файла.

## [1.4.4] — 2026-04-08

### Fixed
- **Мобильный скриншот через Lighthouse вместо `resize_window`** — `mcp__claude-in-chrome__resize_window` не изменял реальный viewport Chrome через расширение, из-за чего мобильный скриншот всегда был недоступен ("не применился в текущей конфигурации"). Теперь мобильный скриншот извлекается из поля `audits['final-screenshot']` Lighthouse JSON (Lighthouse запускается в mobile viewport 412px и автоматически делает снимок страницы). Файл сохраняется как `.jpg` вместо `.png`.
- **`screenshotBase64` в generate-report.js** — добавлена поддержка `.jpg`/`.jpeg` файлов (MIME-тип определяется по расширению).
- **Удалён `mcp__claude-in-chrome__resize_window` из allowed-tools** — инструмент не работает для изменения viewport, убран чтобы агент не пытался его использовать.

## [1.4.3] — 2026-04-08

### Changed
- **Фаза 0 — не создавать новую вкладку без необходимости**

  Раньше скилл всегда вызывал `tabs_create_mcp`, из-за чего каждый запуск открывал новую вкладку/окно Chrome.

  Теперь приоритетный порядок выбора вкладки:
  1. Использовать существующую вкладку `about:blank` или `chrome://newtab/`
  2. Использовать вкладку с тем же доменом (повторный аудит того же сайта)
  3. Создать новую — только если все вкладки содержат важный контент пользователя

  По завершении аудита вкладка возвращается в `about:blank` — не засоряет Chrome историей.

## [1.4.2] — 2026-04-08

### Fixed
- **Мобильный скриншот идентичен десктопному** (одинаковый MD5) — агент повторно использовал base64-данные от шага 2.1 вместо нового вызова инструмента.

  Root cause: инструкция фазы 2.2 была одной строкой без явного указания что `mcp__claude-in-chrome__computer` вызывается заново. Агент «оптимизировал», переиспользуя уже полученный результат скриншота.

  Fix: фаза 2.2 разбита на 8 явных шагов:
  1. `resize_window` 390×844
  2. `navigate` (тот же tabId)
  3. `sleep 1` — ждём перерендер viewport
  4. Явный новый вызов `computer(action: screenshot)` с предупреждением ⚠️
  5–8. Write → base64 -d → verify > 20KB

  Добавлена JS-проверка `viewportWidth ≈ 390` и `hasHorizontalScroll` для верификации что viewport действительно изменился.

## [1.4.1] — 2026-04-07

### Fixed
- **Скриншоты всегда были от предыдущего сайта** (pharm-studio.ru) — все PNG-файлы имели одинаковый MD5 хеш across всех запусков.

  Root cause: `echo "BASE64_DATA" | base64 -d > file.png` физически не работает для больших строк (PNG screenshot = сотни КБ base64). Bash молча обрезал данные или команда падала, агент копировал старый файл.

  Fix: инструкция изменена на двухшаговый процесс:
  1. Write-инструментом записать base64-строку из ответа `mcp__claude-in-chrome__computer` в текстовый `.b64` файл
  2. Декодировать через bash: `base64 -d file.b64 > file.png && rm file.b64`

- Удалён `take-screenshot.js` — Chrome headless `--screenshot` не создаёт файл на этой Windows-конфигурации (Chrome открывает вкладку в существующей сессии вместо headless-режима)

## [1.4.0] — 2026-04-07

### Added (SKILL.md)

**JS-скрипт (Фаза 2.1)** — 11 новых полей на основе анализа egrul.org vs iSEO:
- `ogLocale`, `ogType`, `ogUrl` — полная проверка OG-тегов (og:locale часто отсутствует)
- `hasFooter`, `footerLinksCount`, `footerHasAddress`, `footerHasPhone` — подвал критичен для E-E-A-T и контактных сигналов
- `navMenuItems` — список ссылок меню с анкорами (iSEO проверяет каждую ссылку)
- `publishDate`, `updateDate` — дата публикации/обновления (E-E-A-T для информационных страниц)
- `authorName` — автор материала (E-E-A-T для YMYL)

**Фаза 1.2 (sitemap)** — проверка статусов URL через HEAD-запросы, проверка мусорных URL (`*.php?id=`, `PHPSESSID`, `/wp-admin/`)

**Фаза 1.3 (зеркала)** — явная инструкция: если www не отвечает совсем (connection refused) → `status: "critical"`, не просто "нет редиректа"

**Фаза 2.5 (Schema.org)** — проверка обязательных полей для каждого типа разметки; ссылки на валидаторы (Google Rich Results Test, Яндекс Валидатор)

**Фаза 3 (рекомендации)** — правило против смешивания разных проблем в одну рекомендацию (пример: "добавить description" ≠ "сократить description"); требование конкретного примера в `fix` для данного сайта

**JSON-схема** — 5 новых технических проверок: `og:locale`, навигационное меню, подвал, `www — доступность`, мусорные URL в sitemap

### Root cause
Анализ отчёта egrul.org выявил: рекомендации смешивали разные проблемы (description длинный на главной ≠ description отсутствует на /subscribe); www не отвечал совсем, но фиксировался как "нет редиректа"; подвал и навигация не анализировались; og:locale игнорировался.

Все значимые изменения фиксируются здесь.  
Формат: [Semantic Versioning](https://semver.org/). Даты — UTC+3 (Moscow).

---

## [1.3.2] — 2026-04-07

### Fixed
- **Скриншоты показывали чужой сайт** — `mcp__claude-in-chrome__computer` снимает видимое окно Chrome. Если вкладка предыдущего аудита (pharm-studio.ru) оставалась активной, скриншот был неверным. Все PNG-файлы имели одинаковый MD5.
- Добавлена явная проверка активной вкладки через `tabs_context_mcp` перед каждым скриншотом
- Сохранение скриншота теперь через `echo "BASE64" | base64 -d > file.png` (не через Write, который пишет текст)
- Добавлена проверка размера файла после сохранения (должен быть > 50 KB)

---

## [1.3.1] — 2026-04-07

### Fixed
- **Chrome не использовался при аудите** — в `allowed-tools` были указаны несуществующие инструменты `Navigate` и `Screenshot`. Агент-форк не находил их и переключался в базовый режим без Chrome.
- Заменены на реальные MCP-имена: `mcp__claude-in-chrome__navigate`, `mcp__claude-in-chrome__javascript_tool`, `mcp__claude-in-chrome__computer`, `mcp__claude-in-chrome__tabs_context_mcp`, `mcp__claude-in-chrome__tabs_create_mcp`, `mcp__claude-in-chrome__resize_window`, `mcp__claude-in-chrome__get_page_text`, `mcp__claude-in-chrome__read_console_messages`
- Все инструкции в Фазах 0/2 SKILL.md теперь явно называют конкретный MCP-инструмент
- Фаза 0: порядок — `tabs_context_mcp` → `tabs_create_mcp` → `navigate`

---

## [1.3.0] — 2026-04-07

### Added (generate-report.js)
- **Скриншоты в PDF** — поле `screenshotPaths` в JSON читается, конвертируется в base64 и встраивается в HTML/PDF
- **Нумерация страниц PDF** — CSS `@page { @bottom-right { content: "Стр. N / M" } }`
- **Раздел "Топ-5 действий с максимальным ROI"** — синяя рамка в конце отчёта, выбирает high-priority рекомендации с низкой сложностью
- Вспомогательная функция `screenshotBase64(filePath)` для чтения PNG → base64

### Added (SKILL.md)
- Поле `screenshotPaths` в JSON-схеме (абсолютные пути к PNG)
- Требование заполнять `scoreDetails` обязательно для каждой категории (не оставлять пустые массивы)
- **Фаза 1.8**: проверка дат публикации/обновления; сравнение title и description между страницами на дубли
- **Фаза 1.9** (новая): session ID в URL, страницы пагинации, HTML-карта сайта, структура страницы «О компании», актуальность политики конфиденциальности
- **Фаза 2.1**: оценка качества анкоров внутренних ссылок; скрипт обнаружения скрытого контента (`display:none`, `visibility:hidden`, нулевой font-size, совпадение цвета текста с фоном)
- **Фаза 2.3/2.4**: явные ссылки на `mcp__claude-in-chrome__javascript_tool`
- 6 новых технических проверок: дублирующиеся title, дублирующиеся description, hidden text, session ID в URL, качество анкоров, Яндекс.Вебмастер

### Fixed
- Пути к скриншотам исправлены с относительных `seo-audit-output/` на абсолютные `${OUTPUT_DIR}/`
- Удалён дублирующийся `const { existsSync } = require('fs')` внутри try-блока

---

## [1.2.2] — 2026-04-07

### Fixed (generate-report.js)
- CSS `print-color-adjust: exact` + `-webkit-print-color-adjust: exact` — цвета пропадали в PDF при печати
- `@page { size: A4; margin: 16mm 14mm }` — страницы PDF без полей
- `word-break: break-all; overflow-wrap: break-word` для блоков `fix` — длинные URL/команды вылезали за границу
- Убрано `text-transform: uppercase` — кириллица в заголовках рендерилась некорректно
- Уменьшен шрифт scoreDetails до 13px для лучшей читаемости

---

## [1.2.1] — 2026-04-07

### Fixed (SKILL.md)
- Lighthouse устанавливается автоматически перед запуском: `lighthouse --version 2>/dev/null || npm install -g lighthouse`
- Убрана информационная плашка "Lighthouse не установлен" — вместо уведомления выполняется установка

---

## [1.2.0] — 2026-04-07

### Added
- **Раздел Lighthouse в отчёте** — блок с четырьмя оценками (Performance, SEO, Accessibility, Best Practices) и шестью метриками (FCP, LCP, TBT, CLS, SI, TTI)
- **scoreDetails** — под каждой категорией оценок теперь выводятся конкретные факты с иконками (✅/🔴/⚠️)
- JSON-схема расширена полем `scoreDetails` с примерами для всех 10 категорий
- JSON-схема расширена полем `lighthouse` с реальными данными из Lighthouse CLI

---

## [1.1.5] — 2026-04-07

### Fixed (generate-report.js)
- Chrome `--print-to-pdf` на Windows требует forward slashes — добавлен `.replace(/\\/g, '/')`
- Chrome записывает PDF асинхронно — добавлен polling до 5 секунд через `Atomics.wait`

---

## [1.1.4] — 2026-04-07

### Fixed (generate-report.js)
- HTML-теги в поле `fix` (например `<script>`, `<meta>`) рендерились как HTML и ломали вёрстку
- Добавлена функция `esc()` — все пользовательские данные экранируются через неё

---

## [1.1.3] — 2026-04-07

### Changed
- Копирайт в подвале изменён с "Сгенерировано Claude Code SEO Audit" на "SEO Audit от Nedzelsky.pro"

---

## [1.1.2] — 2026-04-07

### Added
- `.gitignore` — исключены `seo-audit-output/`, `*.png`, `*.pdf`, `lighthouse-*.json`

---

## [1.1.1] — 2026-04-07

### Fixed (SKILL.md + generate-report.js)
- Выходные файлы создавались в папке самого скилла, а не проекта — исправлено через `git rev-parse --show-toplevel`
- `report-data.json` перезаписывался при каждом запуске — переименован в `report-data-{domain}-{datetime}.json`
- HTML и PDF получали текущий timestamp вместо времени из JSON — `generate-report.js` теперь берёт дату из `data.date`

---

## [1.1.0] — 2026-04-07

### Added (на основе анализа 8 отчётов конкурентов iSEO: helinorm.ru, spasgan.ru)
**SKILL.md:**
- 28 дополнительных технических проверок (E-E-A-T, Schema.org, перелинковка, аналитика)
- Детальная проверка Schema.org: Organization, BreadcrumbList, FAQPage, Article, Drug/MedicalWebPage
- Проверка E-E-A-T сигналов: страницы О компании, авторов, контактов, FAQ, политики конфиденциальности
- Проверка аналитики: Яндекс.Метрика, GTM, верификация Яндекс.Вебмастера и GSC
- Консольный скрипт (2.1) расширен: broken images, external nofollow, OG-теги, breadcrumbs, меню навигации
- JSON-схема: поля `scoreDetails`, расширенный список `technical`, примеры данных
- Фаза 2.5: детальная проверка Schema.org через браузер

**generate-report.js:**
- Секция Lighthouse (4 оценки + 6 метрик)
- scoreDetails под каждой строкой таблицы оценок
- Группировка рекомендаций по приоритету (high / medium / low)
- Значки `priorityBadge` и `difficultyBadge`

---

## [1.0.0] — 2026-04-07

### Added — первоначальный релиз
- `SKILL.md` — инструкция для Claude Code `/seo-audit [URL]`
  - Фаза 0: проверка Chrome-подключения, fallback в базовый режим
  - Фаза 1: статические проверки (robots.txt, sitemap, www/https редиректы, 404, HTML-мета, HTTP-заголовки)
  - Фаза 2: браузерный анализ (Chrome JS, скриншоты desktop/mobile, Lighthouse)
  - Фаза 3: сборка `report-data.json`
  - Фаза 4: генерация MD + HTML + PDF
- `generate-report.js` — генератор HTML+PDF через Chrome headless `--print-to-pdf`
  - Шаблон: заголовок с общей оценкой, статистика, таблица категорий, рекомендации, таблица техпроверок
  - Цветовая кодировка оценок (зелёный ≥8, жёлтый ≥5, красный <5)
  - Badges для priority/difficulty/severity
