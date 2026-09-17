# EdgeFocus Task Tool

Локальный веб-инструмент для создания задач в EdgeFocus обычным человеческим языком —
через официальный REST API (`docs.json`, Swagger 2.0). Без браузерной автоматизации,
без ручных HTTP-запросов, без ID задач и bucket'ов.

Вы пишете:

```
Сделать адаптивную версию страницы Business, 25 сентября, 2h
```

Приложение само распознаёт название, дату и estimate, показывает превью,
создаёт задачу, кладёт её в нужный Kanban bucket и проверяет, что всё сохранилось.

---

## 1. Что делает приложение

1. Разбирает свободный текст на `title` / `dueDate` / `estimateMinutes` / `assignee`.
2. Показывает распознанные данные для подтверждения (`Создать` / `Отмена`).
3. Находит целевую колонку Kanban **по имени** через API (ID не захардкожен).
   Колонку по умолчанию задаёт `EDGEFOCUS_TARGET_BUCKET` (сейчас — «Дизайн»),
   а в окне превью её можно переключить на любую другую колонку доски.
   **Если дата задачи уже в прошлом — она автоматически уходит в `EDGEFOCUS_DONE_BUCKET`
   («Выпущено»)**, потому что это уже сделанная работа. Явный выбор колонки правило отменяет.
4. Проверяет, нет ли недавно созданной задачи с таким же названием — защита от дубликатов.
5. Создаёт задачу: `PUT /projects/{id}/tasks`.
6. Переносит её в bucket: `POST /projects/{project}/views/{view}/buckets/{bucket}/tasks`.
7. Опционально назначает исполнителя: `GET /users?s=…` + `PUT /tasks/{taskID}/assignees`.
8. Перечитывает задачу и сверяет title, project, date, estimate, bucket, assignee.
9. Показывает результат, Task ID и ссылку `https://edgefocus.ru/tasks/{task_id}`.
10. Позволяет позже перенести **любую существующую** задачу в любую колонку —
    по номеру (`#153`) или по названию, независимо от её дат.
11. Ведёт локальную историю последних задач.

---

## 2. Требования

* Node.js 18+ (нужен встроенный `fetch`); проверено на Node 20/22
* npm 9+
* API-токен EdgeFocus

---

## 3. Установка

```bash
npm install
```

---

## 4. Создание `.env`

Скопируйте `.env.example` в `.env` и заполните токен:

```env
EDGEFOCUS_BASE_URL=https://edgefocus.ru/api/v1
EDGEFOCUS_TOKEN=ваш_токен

EDGEFOCUS_PROJECT_ID=176
EDGEFOCUS_KANBAN_VIEW_ID=765
EDGEFOCUS_TABLE_VIEW_ID=764
EDGEFOCUS_TARGET_BUCKET=Дизайн

EDGEFOCUS_WEB_URL=https://edgefocus.ru
PORT=3001
```

`.env` уже в `.gitignore`. Токен читает **только backend** — во frontend он
никогда не попадает, в логах и сообщениях об ошибках он заменяется на `***REDACTED***`.

Если токена нет, приложение скажет:
`EDGEFOCUS_TOKEN is not configured.` — и подскажет, как его добавить.

---

## 5. Как запустить

Сначала — проверка соединения без создания задач:

```bash
npm run test:edgefocus
```

Потом:

```bash
npm run dev
```

Откройте <http://localhost:3000>.

Frontend (Vite) слушает порт 3000 и проксирует `/api` на backend (Express, порт 3001).

Продакшн-сборка в один процесс:

```bash
npm run build
npm start          # http://localhost:3001
```

Другие команды:

| Команда | Что делает |
| --- | --- |
| `npm run dev` | frontend + backend в режиме разработки |
| `npm run build` | сборка фронтенда (её же запускает Vercel) |
| `npm run test:edgefocus` | **read-only** проверка API, ничего не создаёт |
| `npm test` | тесты парсера (vitest) |
| `npm run typecheck` | проверка TypeScript |
| `npm run build` | сборка backend + frontend |

---

## 5a. Деплой на Vercel

Проект собирается и как локальное приложение, и как проект Vercel:
фронтенд — статика (`vite build` → `dist/public`), а весь backend — одна
serverless-функция `api/index.ts`, которая отдаёт тот же Express-app.

1. Запушить репозиторий на GitHub.
2. На vercel.com → **Add New… → Project** → выбрать репозиторий.
   Build Command, Output Directory и rewrites уже заданы в `vercel.json` —
   менять ничего не нужно.
3. В **Settings → Environment Variables** добавить те же переменные, что в `.env`:

   | Переменная | Значение |
   | --- | --- |
   | `EDGEFOCUS_TOKEN` | API-токен EdgeFocus |
   | `EDGEFOCUS_BASE_URL` | `https://edgefocus.ru/api/v1` |
   | `EDGEFOCUS_PROJECT_ID` | `176` |
   | `EDGEFOCUS_KANBAN_VIEW_ID` | `765` |
   | `EDGEFOCUS_TABLE_VIEW_ID` | `764` |
   | `EDGEFOCUS_TARGET_BUCKET` | `Дизайн` |
   | `EDGEFOCUS_DONE_BUCKET` | `Выпущено` |
   | `EDGEFOCUS_DEFAULT_ASSIGNEE` | `Арен Авагян` |
   | `EDGEFOCUS_WEB_URL` | `https://edgefocus.ru` |
   | **`APP_PASSWORD`** | **пароль для входа — обязателен** |

4. Deploy.

**Никогда не коммить `.env`.** Vercel читает переменные только из
Environment Variables; файл `.env` в репозитории не нужен и означает утёкший
токен. Если это случилось — отзовите токен в EdgeFocus и выпустите новый.

### Почему `APP_PASSWORD` обязателен

Адрес на Vercel публичный. Токен остаётся на сервере и в браузер не попадает,
но без пароля форму сможет открыть кто угодно и создавать задачи в проекте 176.
Если `APP_PASSWORD` задан, все `/api/*` запросы (кроме `/api/health`) требуют
заголовок `x-app-password`; фронтенд показывает экран входа и хранит пароль
в `localStorage` этого браузера. Пустой `APP_PASSWORD` = защита выключена —
допустимо только локально.

История последних задач хранится в `localStorage` браузера: файловая система
на Vercel доступна только для чтения, и история у каждого своя.

### PWA

Приложение устанавливается на телефон: в браузере откройте меню и выберите
«Установить приложение» / «На экран "Домой"». Service worker кэширует только
статику — запросы к `/api/*` всегда идут в сеть, чтобы задача никогда не
создавалась «из кэша».

### Производительность

Список колонок, настройки вида и найденный исполнитель кэшируются в памяти
функции (5–30 минут). Это заметно сокращает число обращений к EdgeFocus при
создании задачи и оставляет запас по лимиту времени выполнения на Vercel.
Кэш живёт в процессе: после нового деплоя или простоя он просто наполнится
заново.

---

## 6. Как использовать

**Режим «Обычным языком»** — одно поле. Пока вы печатаете, под полем видно,
что разобрал парсер: название, дата, estimate, колонка, исполнитель. Разбор
идёт прямо в браузере, без запросов к серверу.

- `Создать задачу` — показать превью и подтвердить.
- `Ctrl/Cmd + Enter` — создать сразу, одним запросом. Если сервер найдёт
  похожую задачу, созданную за последние 3 дня, вместо создания откроется
  превью с предупреждением.

В превью дату и estimate можно поправить, не переписывая строку: кликните
по значению, введите новое («завтра», «20.09», «1.5h») и нажмите Enter.

В превью выпадающий список **Колонка** позволяет выбрать любую колонку доски
(Входящие, Аналитика, Готово к разработке, Дизайн, Разработка, Код-ревью, QA,
Приёмка, Готово к выпуску, Выпущено). По умолчанию подставляется
`EDGEFOCUS_TARGET_BUCKET`, а для задач с прошедшей датой — `EDGEFOCUS_DONE_BUCKET`.

### Задачи в работе

Блок **«Задачи в работе»** показывает открытые задачи доски, сгруппированные
по колонкам, и переносит любую из них в «Выпущено» одной кнопкой.
Колонка задачи читается через `expand=buckets`.

### Перенос существующей задачи

Блок **«Переместить существующую задачу»** внизу страницы: введите `#153` или часть
названия, выберите колонку (по умолчанию «Выпущено») и нажмите стрелку.
Даты задачи при этом не учитываются — переносится любая задача в любой момент.

Если колонка назначена в EdgeFocus как `done_bucket_id` для этого вида
(для «Выпущено» это так), API сам помечает задачу как **Done** — приложение это проверяет.

**Режим «По полям»** — fallback, если парсер понял неправильно:
отдельные поля `Название`, `Дата`, `Estimate` (выпадающий список + своё значение).

---

## 7. Примеры команд

```
Сделать адаптивную версию страницы Business, 25 сентября, 2h
Сделать адаптив для Business до 25 сентября на 2 часа
Проверить мобильную версию платформы, дедлайн 20.09, 1.5 часа
Добавить advanced search, дедлайн 30 сентября, 4 часа
Fix mobile select, tomorrow, 30 min
Редизайн страницы Business - 25 сентября - 2h
Сделать адаптив Business, 25 сентября, 2h, assign Aren
Сделать адаптив Business, 25 сентября, 2h, @aren
```

### Поддерживаемые даты

`сегодня`, `today`, `завтра`, `tomorrow`, `послезавтра`, `day after tomorrow`,
`20.09`, `20.09.2026`, `20/09/26`, `25 сентября`, `25 сентября 2026`,
`25 September 2026`, `September 25`, `2026-09-25`, `next Monday`,
`следующий понедельник`.

Если год не указан, берётся текущий. Дата, прошедшая больше 90 дней назад,
читается как следующий год («1 марта» в сентябре 2026 → 2027-03-01), а недавно
прошедшая остаётся в прошлом («10 сентября» → 2026-09-10) — такие задачи
автоматически уходят в колонку «Выпущено».

### Поддерживаемые estimate

`5m` `15m` `30m` `45m` `1h` `1h 30m` `2h` `3h` `4h` `6h` `8h`
`90m` `150m` `1.5h` `2.5h` `2,5h` `30 мин` `2 часа` `1 час`
Голое число (`45`) трактуется как минуты.

В API всегда уходит целое число минут (`time_estimate`).

---

## 8. Архитектура

```
frontend (React + Vite, :3000)
        |
        v  /api/* (proxy)
backend (Express + TypeScript, :3001)   <-- здесь и только здесь живёт EDGEFOCUS_TOKEN
        |
        v
EdgeFocus API (https://edgefocus.ru/api/v1)
```

```
src/
  api/edgefocus.ts          HTTP-клиент EdgeFocus: auth, endpoints, классификация ошибок
  config/index.ts           чтение .env, валидация, редактирование токена в логах
  parser/taskParser.ts      natural language -> { title, dueDate, estimateMinutes, assignee }
  parser/taskParser.test.ts тесты парсера
  services/taskService.ts   bucket by name, duplicate guard, create + move + assign + verify
  services/history.ts       локальная история (data/history.json)
  scripts/testConnection.ts read-only проверка API (npm run test:edgefocus)
  server/index.ts           Express API: /api/parse, /api/preflight, /api/tasks, /api/history
  types/edgefocus.ts        типы из docs.json (models.Task, models.Bucket, ...)
  client/
    App.tsx                 состояние: форма -> превью -> результат
    api.ts, format.ts
    components/TaskForm.tsx TaskPreview.tsx TaskResult.tsx RecentTasks.tsx
```

История хранится в `data/history.json` (создаётся автоматически, в `.gitignore`).
Отдельная БД для первой версии не нужна.

---

## 9. EdgeFocus API endpoints

Authentication — `securityDefinitions.JWTKeyAuth` из `docs.json`:
`{"type":"apiKey","name":"Authorization","in":"header"}`, значение — `Bearer <token>`.

| Метод | Endpoint | Схема тела / ответа | Зачем |
| --- | --- | --- | --- |
| `GET` | `/projects/{id}` | `models.Project` | проверка доступа к проекту |
| `GET` | `/projects/{id}/views/{view}/buckets` | `[]models.Bucket` | поиск bucket по имени |
| `PUT` | `/projects/{id}/tasks` | `models.Task` | создание задачи |
| `GET` | `/tasks/{id}` | `models.Task` | verification |
| `POST` | `/tasks/{id}` | `models.Task` | обновление задачи |
| `GET` | `/projects/{id}/views/{view}/tasks` | `[]models.Task` | поиск дубликатов, проверка bucket |
| `GET` | `/projects/{project}/views/{id}` | `models.ProjectView` | чтение `done_bucket_id` |
| `POST` | `/projects/{project}/views/{view}/buckets/{bucket}/tasks` | `models.TaskBucket` | перенос в bucket |
| `GET` | `/users?s=…` | `[]user.User` | поиск исполнителя |
| `GET` | `/tasks/{taskID}/assignees` | `[]user.User` | verification исполнителя |
| `PUT` | `/tasks/{taskID}/assignees` | `models.TaskAssginee` | назначение исполнителя |

Используемые поля `models.Task`: `title`, `project_id`, `end_date` и `start_date`
(RFC3339), `time_estimate` (минуты), плюс read-only `id`, `buckets`, `created`.

`start_date` проставляется на тот же день, что и `end_date` (отключается
через `EDGEFOCUS_SET_START_DATE=false`).

Колонка задачи читается через `GET /tasks/{id}?expand=buckets`, а не через
`bucket_id`: последний, по описанию в `docs.json`, заполняется только при доступе
через view с bucket'ами и часто приходит нулевым. Если документированный
`POST .../buckets/{bucket}/tasks` не переместил задачу, приложение повторяет
перенос через `POST /tasks/{id}` с полем `bucket_id` («Can be used to move a task
between buckets») и проверяет результат заново.

Исполнитель ищется через `GET /projects/{id}/projectusers?s=…` (права
`Projects: Projectusers`), с откатом на `GET /users?s=…`. Значение по умолчанию —
`EDGEFOCUS_DEFAULT_ASSIGNEE`, в тексте задачи переопределяется через
`@nick` или `исполнитель Имя Фамилия`.

Тело `models.TaskBucket`: `{ task_id, bucket_id, project_view_id }`.
Тело `models.TaskAssginee`: `{ user_id }` (орфография поля — из документации API).

Даты отправляются как `YYYY-MM-DDT12:00:00.000Z` — полдень UTC, чтобы календарный
день не «съезжал» при пересчёте часовых поясов.

---

## 10. Troubleshooting

| Сообщение | Что делать |
| --- | --- |
| `EDGEFOCUS_TOKEN is not configured.` | Создайте `.env` и добавьте токен, перезапустите. |
| `Authentication failed. Check EDGEFOCUS_TOKEN.` (401) | Токен неверный или истёк — выпустите новый в EdgeFocus. |
| `No access to this EdgeFocus project.` (403) | У пользователя нет прав на проект `EDGEFOCUS_PROJECT_ID`. |
| `Project/view/task not found.` (404) | Проверьте `EDGEFOCUS_PROJECT_ID`, `EDGEFOCUS_KANBAN_VIEW_ID`, `EDGEFOCUS_TABLE_VIEW_ID`. |
| `Bucket "…" not found …` | В сообщении перечислены все найденные колонки — поправьте `EDGEFOCUS_TARGET_BUCKET`. |
| HTTP 400 | Показывается текст ошибки API; подробности — в блоке `Technical details`. |
| `EdgeFocus server error. Try again.` (500) | Проблема на стороне EdgeFocus, повторите позже. |
| `Could not connect to EdgeFocus.` | Нет сети / VPN / сервер недоступен. Задача **не** пересоздаётся автоматически. |
| «Возможно, такая задача уже была создана.» | Найден дубликат за последние 3 дня — проверьте ссылку и подтвердите, если задача всё же нужна. |
| Порт 3000 занят | Vite настроен на `strictPort` — освободите порт или поменяйте его в `vite.config.ts`. |

Технические детали любой ошибки раскрываются в UI через `Technical details`.
Токен там никогда не отображается.
