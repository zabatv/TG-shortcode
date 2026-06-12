# Dance Registration System

Система записи на танцевальные занятия с Telegram-уведомлениями.  
WordPress-плагин (фронтенд) + Node.js/Express бэкенд на Render + PostgreSQL.

---

## Архитектура

```
┌─────────────────────┐      ┌──────────────────────┐      ┌────────────┐
│  WordPress сайт     │─────>│  Render (Node.js)    │─────>│ PostgreSQL │
│                     │ HTTP │                      │  SQL │            │
│  dance-form.php     │      │  src/index.js        │      │ registrations
│  rt-admin.php       │      │  src/db.js           │      │ chat_users
│                     │      │  src/telegram.js     │      │ branches
└─────────────────────┘      └──────────┬───────────┘      │ groups
                                        │                  └────────────┘
                                        │ Telegram API
                                        ▼
                               ┌──────────────────┐
                               │  Telegram Bot     │
                               │  @..._bot        │
                               └──────────────────┘
```

**Компоненты:**

- **WordPress-плагин** — форма записи (шорткод `[rubitime_form]`) и админ-панель (управление филиалами, группами, записями)
- **Node.js бэкенд** — REST API на Express, приём заявок, отправка уведомлений в Telegram
- **PostgreSQL** — хранение регистраций, пользователей чата, филиалов и групп с ссылками
- **Telegram Bot** — рассылка уведомлений о новых записях подписанным пользователям

---

## Структура проекта

```
backend/
├── src/
│   ├── index.js          # Express сервер, роуты, Telegram webhook
│   ├── db.js             # PostgreSQL инициализация, CRUD, seed
│   └── telegram.js       # Отправка сообщений в Telegram
├── dance-form.php        # WordPress плагин — форма записи
├── rt-admin.php          # WordPress плагин — админ-панель
├── package.json
├── render.yaml           # Конфигурация Render
└── README.md
```

---

## API Endpoints

### Регистрации

| Метод | Путь | Описание |
|-------|------|----------|
| `POST` | `/notify` | Создать запись и разослать уведомления |
| `GET` | `/api/registrations` | Список записей (фильтр: `?branch=&group_name=`) |
| `DELETE` | `/api/registrations/:id` | Удалить запись |
| `POST` | `/api/track-click` | Отметить переход по ссылке (`{id: number}`) |

**POST /notify**

```json
{
  "branch": "Прохладный",
  "group": "Старшая (девочки)",
  "name": "Имя",
  "phone": "+70000000000",
  "comment": ""
}
```

После сохранения бот рассылает сообщение всем подписанным пользователям.

### Филиалы

| Метод | Путь | Описание |
|-------|------|----------|
| `GET` | `/api/branches` | Все филиалы с группами |
| `POST` | `/api/branches` | Создать филиал |
| `PUT` | `/api/branches/:id` | Обновить филиал |
| `DELETE` | `/api/branches/:id` | Удалить филиал |

### Группы

| Метод | Путь | Описание |
|-------|------|----------|
| `GET` | `/api/groups/:branchId` | Группы филиала |
| `POST` | `/api/groups` | Создать группу |
| `PUT` | `/api/groups/:id` | Обновить группу |
| `DELETE` | `/api/groups/:id` | Удалить группу |

### Telegram

| Метод | Путь | Описание |
|-------|------|----------|
| `POST` | `/telegram-webhook` | Webhook от Telegram |
| `POST` | `/set-webhook` | Установить webhook (вручную) |

---

## База данных

### `branches`
| Колонка | Тип | Описание |
|---------|-----|----------|
| `id` | SERIAL PK | |
| `key` | VARCHAR UNIQUE | `prokhladny`, `maisky` |
| `name` | VARCHAR | Название филиала |
| `teacher` | VARCHAR | Преподаватель |
| `days` | VARCHAR | Дни занятий |
| `sort_order` | INT | Порядок сортировки |

### `groups`
| Колонка | Тип | Описание |
|---------|-----|----------|
| `id` | SERIAL PK | |
| `branch_id` | INT FK → branches.id | |
| `key` | VARCHAR | `senior_girls`, `middle_girls` и т.д. |
| `name` | VARCHAR | Название группы |
| `time` | VARCHAR | Время занятий |
| `sort_order` | INT | |
| `links` | TEXT | JSON-массив ссылок: `[{"label":"Telegram","url":"https://t.me/..."}]` |

### `registrations`
| Колонка | Тип | Описание |
|---------|-----|----------|
| `id` | SERIAL PK | |
| `branch` | VARCHAR | Филиал |
| `group_name` | VARCHAR | Группа |
| `name` | VARCHAR | Имя клиента |
| `phone` | VARCHAR | Телефон |
| `comment` | TEXT | Комментарий |
| `clicked` | BOOLEAN | Перешёл по ссылке группы |
| `clicked_at` | TIMESTAMP | Когда перешёл |
| `created_at` | TIMESTAMP | Дата записи (Москва) |

### `chat_users`
| Колонка | Тип | Описание |
|---------|-----|----------|
| `id` | SERIAL PK | |
| `chat_id` | BIGINT UNIQUE | ID чата Telegram |
| `first_name` | VARCHAR | |
| `username` | VARCHAR | |
| `phone` | VARCHAR | |
| `last_activity` | TIMESTAMP | |

---

## Telegram Bot

### Команды

| Команда | Доступ | Описание |
|---------|--------|----------|
| `/start` | Все | Начало работы, выбор филиала для просмотра записей |
| `/help` | Все | Справка по командам |
| `/subscribe` | Все | Подписаться на уведомления о новых записях |
| `/unsubscribe` | Все | Отписаться от уведомлений |
| `/regs` | Все | Список записей по филиалам и группам |
| `/admin` | Админ | Панель управления филиалами и группами |
| `/users` | Админ | Количество подписчиков |

### Уведомления

- При новой регистрации бот рассылает сообщение всем подписанным пользователям
- При клике пользователя по ссылке группы админ получает отдельное уведомление: `✅ Перешёл по ссылке!`

### Подписка

При первом сообщении боту пользователь автоматически подписывается на уведомления.
Кнопка подписки/отписки показывается в приветствии.
Команды `/subscribe` и `/unsubscribe` для ручного управления.

---

## Трекинг переходов

После успешной записи на сайте пользователю показываются кнопки со ссылками на группы (Telegram, WhatsApp и т.д.).
При клике на ссылку JavaScript отправляет `POST /api/track-click` с ID регистрации.
В админке (Танцы → Записи) отображается статус: `✔ время` или `—`.
В Telegram список записей через `/regs` показывает `✅ перешёл` / `❌ не перешёл`.

---

## Конфигурация

Переменные окружения (Render):

| Переменная | Описание |
|-----------|----------|
| `DATABASE_URL` | PostgreSQL connection string |
| `TELEGRAM_BOT_TOKEN` | Токен бота |
| `TELEGRAM_WEBHOOK_URL` | Публичный URL вебхука (`.../telegram-webhook`) |

---

## Развёртывание

### Бэкенд (Render)

1. Создать Web Service из репозитория
2. Указать `Build Command`: `npm install`
3. Указать `Start Command`: `npm start`
4. Добавить переменные окружения
5. После деплоя выполнить `POST /set-webhook` (или автоматически при запуске)

### WordPress плагин

1. Скопировать `dance-form.php` и `rt-admin.php` в `/wp-content/plugins/`
2. Активировать плагин
3. Разместить шорткод `[rubitime_form]` на странице
4. В админке появится меню **Танцы** → Филиалы / Группы / Записи

### Настройка ссылок групп

В админке (Танцы → Группы) у каждой группы есть поле **Ссылки**.  
Формат — JSON-массив:

```json
[
  {"label": "Telegram", "url": "https://t.me/your_chat"},
  {"label": "WhatsApp", "url": "https://chat.whatsapp.com/your_group"}
]
```

Эти ссылки показываются пользователю после успешной записи.
