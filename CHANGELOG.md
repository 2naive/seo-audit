# Changelog — SEO Audit Skill

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
