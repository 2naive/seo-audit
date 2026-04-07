# SEO Audit Skill

**Версия:** см. `generate-report.js` константа `SKILL_VERSION`  
**Автор:** SEO Audit от Nedzelsky.pro  
**Расположение:** `.claude/skills/seo-audit/`

Скилл для Claude Code (`/seo-audit [URL]`) — выполняет полный технический SEO-аудит сайта и генерирует отчёт в форматах Markdown, HTML и PDF.

---

## Файлы

| Файл | Назначение |
|------|-----------|
| `SKILL.md` | Основная инструкция для агента (все фазы аудита) |
| `generate-report.js` | Генератор HTML+PDF из `report-data.json` |
| `CHANGELOG.md` | История изменений с обоснованием |
| `README.md` | Этот файл — документация и архитектура |

Выходные файлы создаются в `{корень-проекта}/seo-audit-output/` и **не хранятся в репозитории** (`.gitignore`).

---

## Использование

```bash
/seo-audit https://example.com
```

Агент создаёт в `seo-audit-output/`:
- `seo-report-{domain}-{datetime}.md` — Markdown
- `seo-report-{domain}-{datetime}.html` — HTML (открыть в браузере)
- `seo-report-{domain}-{datetime}.pdf` — PDF
- `report-data-{domain}-{datetime}.json` — исходные данные
- `desktop-{domain}-{datetime}.png` — скриншот десктоп
- `mobile-{domain}-{datetime}.png` — скриншот мобильный

---

## Архитектура

### Режимы работы

| Режим | Условие | Что пропускается |
|-------|---------|-----------------|
| **Полный (Chrome)** | `mcp__claude-in-chrome__navigate` доступен | — |
| **Базовый** | Chrome недоступен, пользователь подтвердил | Фаза 2 целиком (JS-анализ, скриншоты, Lighthouse) |

### Фазы аудита

```
Фаза 0  →  Проверка Chrome-подключения
Фаза 1  →  Статичные проверки (WebFetch + Bash curl)
Фаза 2  →  Браузерный анализ (Chrome MCP-инструменты)
Фаза 3  →  Сборка report-data.json
Фаза 4  →  generate-report.js → HTML + PDF
```

**Фаза 0** — пытается открыть URL через `mcp__claude-in-chrome__tabs_create_mcp` + `navigate`. Если инструменты недоступны — запрашивает подтверждение на базовый режим.

**Фаза 1** — только WebFetch и Bash (curl). Не требует Chrome. Проверяет:
- robots.txt (блокировки, Sitemap:, Host:)
- sitemap.xml (формат, количество URL, lastmod)
- www/http редиректы (зеркала)
- 404-страницу
- raw HTML главной (мета-теги, OG, Schema.org, E-E-A-T ссылки, H1-H6)
- HTTP-заголовки (HSTS, X-Frame-Options, gzip, Cache-Control, TTFB)
- 2–3 страницы из sitemap
- Дубли title/description между страницами
- Session ID в URL, пагинация, HTML-карта, «О компании», политика

**Фаза 2** — требует Chrome. Проверяет:
- JS-рендеренный контент (сравнение с raw HTML → JS-зависимость)
- Скриншоты desktop (1280×900) и mobile (390×844)
- JS-ошибки в консоли
- Качество анкоров внутренних ссылок
- Скрытый контент (display:none, visibility:hidden, font-size<5px)
- Schema.org через браузер
- Lighthouse (Performance, SEO, Accessibility, Best Practices + 6 метрик)

**Фаза 3** — агент собирает все данные в `report-data-{domain}-{datetime}.json`. Схема описана ниже.

**Фаза 4** — запускает `generate-report.js`, который читает JSON и генерирует HTML + PDF через Chrome headless `--print-to-pdf`.

---

## Схема report-data.json

```json
{
  "url": "https://example.com",
  "date": "YYYY-MM-DD HH:MM",
  "mode": "full | basic",
  "skillVersion": "1.3.2",
  "summary": {
    "summary": "Текст резюме",
    "pagesAnalyzed": 4,
    "critical": 7,
    "warnings": 11,
    "ok": 19
  },
  "scores": {
    "Мета-теги": 6,
    "Структура контента": 7,
    ...
  },
  "scoreDetails": {
    "Мета-теги": ["✅ title 52 симв.", "🔴 description 285 симв."],
    ...
  },
  "recommendations": [
    {
      "title": "...",
      "description": "...",
      "priority": "high | medium | low",
      "difficulty": "low | medium | high",
      "fix": "nginx.conf: gzip on;"
    }
  ],
  "pages": [
    {
      "url": "...",
      "issues": [{ "severity": "critical|warning|info|ok", "msg": "..." }]
    }
  ],
  "scoreDetails": { ... },
  "lighthouse": {
    "available": true,
    "performance": 84,
    "seo": 100,
    "accessibility": 98,
    "bestPractices": 77,
    "metrics": { "FCP": "1.2 s", "LCP": "2.4 s", ... }
  },
  "screenshotPaths": {
    "desktop": "/abs/path/desktop-example.com-2026-04-07-1457.png",
    "mobile": "/abs/path/mobile-example.com-2026-04-07-1457.png"
  },
  "technical": [
    { "check": "HTTPS", "status": "ok|warning|critical|info", "value": "..." },
    ...
  ]
}
```

### Правила заполнения

- `scoreDetails` — **обязателен** для каждой категории из `scores`. Каждый элемент — факт с иконкой: `"✅ title 52 симв."`, `"🔴 description 285 симв. (норма 70-160)"`. Пустые массивы недопустимы.
- `screenshotPaths` — абсолютные пути к реально существующим PNG-файлам или `null`.
- `skillVersion` — текущая версия скилла (из константы `SKILL_VERSION` в `generate-report.js`).
- `lighthouse.available: false` — если Lighthouse не запустился; остальные поля опциональны.

---

## generate-report.js

Node.js скрипт без внешних зависимостей (только стандартная библиотека).

```
node generate-report.js <report.json> [output-dir]
```

### Что генерирует

1. **HTML** — полностью самодостаточный файл (inline CSS, base64 изображения). Открывается в любом браузере.
2. **PDF** — через Chrome headless `--print-to-pdf`. Требует Chrome в одном из стандартных путей.

### Секции отчёта (по порядку)

| # | Секция | Источник данных |
|---|--------|----------------|
| 1 | Шапка (URL, дата, режим, общая оценка) | `url`, `date`, `mode`, `scores` |
| 2 | Статистика (4 плитки) | `summary` |
| 3 | Оценки по категориям + детали | `scores`, `scoreDetails` |
| 4 | Lighthouse | `lighthouse` |
| 5 | Рекомендации (сгруппированы по приоритету) | `recommendations` |
| 6 | Проблемы по страницам | `pages` |
| 7 | Технические проверки | `technical` |
| 8 | Скриншоты (embedded base64) | `screenshotPaths` |
| 9 | Топ-5 действий с максимальным ROI | `recommendations` (фильтрация) |
| — | Подвал с версией | `SKILL_VERSION`, `url`, `date` |

### Цветовая схема оценок

| Значение | Цвет | Смысл |
|----------|------|-------|
| 8–10 | Зелёный `#22c55e` | Хорошо |
| 5–7 | Жёлтый `#f59e0b` | Требует внимания |
| 1–4 | Красный `#ef4444` | Критично |

---

## Известные ограничения

| Ограничение | Обходной путь |
|------------|---------------|
| Скриншоты показывают не тот сайт | Перед скриншотом проверить активную вкладку через `tabs_context_mcp` |
| Lighthouse не запускается | `npm install -g lighthouse` вручную |
| Chrome не найден для PDF | Установить Chrome по стандартному пути |
| Большие base64 скриншоты не помещаются в Bash echo | Использовать временный файл: `node -e "fs.writeFileSync(...)"` |

---

## Требования

| Компонент | Версия | Обязательность |
|-----------|--------|---------------|
| Node.js | ≥ 16 | Обязательно (generate-report.js) |
| Google Chrome | любая | Обязательно (PDF генерация, Chrome-режим) |
| lighthouse | ≥ 10 | Опционально (устанавливается автоматически) |
| Claude Code | ≥ 1.0.36 | Обязательно |
| Claude in Chrome extension | ≥ 1.0.36 | Для полного режима |

---

## Хронология ключевых решений

### Почему Chrome MCP, а не Puppeteer/Playwright?
Claude Code уже интегрирован с Chrome через расширение. Использование `mcp__claude-in-chrome__*` инструментов не требует дополнительных зависимостей и работает в рамках той же сессии.

### Почему PDF через Chrome --print-to-pdf, а не wkhtmltopdf/puppeteer?
Chrome уже требуется для аудита, добавление второй зависимости избыточно. Chrome headless корректно рендерит CSS (градиенты, print-color-adjust, @page counters).

### Почему inline CSS в HTML, а не внешние файлы?
Самодостаточный HTML-файл можно открыть без сервера и отправить клиенту одним файлом. PDF генерируется из этого же файла — нет расхождений.

### Почему скриншоты встраиваются как base64, а не ссылки на файлы?
PDF должен содержать изображения без внешних зависимостей. При пересылке PDF клиенту скриншоты сохраняются.

### Почему report-data.json с timestamp в имени?
Предыдущая версия перезаписывала единственный файл `report-data.json` при каждом запуске. Теперь каждый аудит хранит свои данные отдельно — можно повторно сгенерировать отчёт из старых данных.

### Почему scoreDetails обязателен?
Без него оценка "Мобильность: 7/10" — субъективное мнение агента без обоснования. Клиент не понимает, что именно проверялось. scoreDetails превращает цифру в верифицируемые факты.
