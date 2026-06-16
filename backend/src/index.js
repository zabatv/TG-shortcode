const express = require('express');
const cors = require('cors');
const {
  initDB, seedBranches,
  saveRegistration, markClicked, getRegistrations, deleteRegistration,
  getAllBranches, addBranch, updateBranch, deleteBranch,
  getGroupsForBranch, getGroupsByName, addGroup, updateGroup, getGroupById, deleteGroup,
  upsertChatUser, getAllChatIds,
} = require('./db');
const { sendTelegram, formatMessage, setWebhook, callTelegram } = require('./telegram');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5050;
const ADMIN_ID = process.env.TELEGRAM_CHAT_ID;

function isAdmin(chatId) {
  return chatId && ADMIN_ID && String(chatId) === String(ADMIN_ID);
}

// Health
app.get('/', (_req, res) => res.send('OK'));

app.get('/debug', (_req, res) => {
  res.json({
    hasBotToken: !!process.env.TELEGRAM_BOT_TOKEN,
    hasAdminId: !!ADMIN_ID,
    hasDbUrl: !!process.env.DATABASE_URL,
    port: PORT,
    renderUrl: process.env.RENDER_EXTERNAL_URL || 'not set',
  });
});

// ====== API для WordPress ======
app.get('/api/branches', async (_req, res) => {
  try {
    const branches = await getAllBranches();
    const result = [];
    for (const b of branches) {
      const groups = await getGroupsForBranch(b.id);
      result.push({
        id: b.id,
        key: b.key,
        name: b.name,
        teacher: b.teacher,
        days: b.days,
        groups: groups.map(g => ({ id: g.id, key: g.key, name: g.name, time: g.time, links: g.links })),
      });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/registrations/:id', async (req, res) => {
  try {
    await deleteRegistration(parseInt(req.params.id));
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ====== Трекинг перехода по ссылке группы ======
app.post('/api/track-click', async (req, res) => {
  const { id } = req.body;
  if (id) {
    const rows = await markClicked(parseInt(id));
    if (rows.length > 0) {
      const r = rows[0];
      await sendTelegram(
        `✅ <b>Перешёл по ссылке!</b>\n\n` +
        `👤 ${r.name || '—'} | ${r.phone || '—'}\n` +
        `🏫 ${r.branch} — ${r.group_name}`
      ).catch(() => {});
    }
  }
  res.json({ ok: true });
});

// ====== CRUD филиалов ======
app.post('/api/branches', async (req, res) => {
  try {
    const b = await addBranch(req.body);
    res.json(b);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/branches/:id', async (req, res) => {
  try {
    const b = await updateBranch(parseInt(req.params.id), req.body);
    res.json(b);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/branches/:id', async (req, res) => {
  try {
    await deleteBranch(parseInt(req.params.id));
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ====== CRUD групп ======
app.post('/api/groups', async (req, res) => {
  try {
    const g = await addGroup(req.body);
    res.json(g);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/groups/:id', async (req, res) => {
  try {
    const g = await updateGroup(parseInt(req.params.id), req.body);
    res.json(g);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/groups/:id', async (req, res) => {
  try {
    await deleteGroup(parseInt(req.params.id));
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ====== /notify — запись на занятие ======
app.post('/notify', async (req, res) => {
  const { branch, group, name, phone, comment } = req.body;

  if (!branch || !group) {
    return res.status(400).json({ error: 'branch and group are required' });
  }

  const data = { branch, group_name: group, name: name || '', phone: phone || '', comment: comment || '' };

  try {
    const recordId = await saveRegistration(data);

    const allChatIds = await getAllChatIds();
    const msg = formatMessage(data);

    for (const cid of allChatIds) {
      if (ADMIN_ID && String(cid) === String(ADMIN_ID)) continue;
      await sendTelegram(msg, cid).catch(() => {});
    }

    // Админу отдельно (на случай если его нет в chat_users)
    await sendTelegram(msg).catch(() => {});

    console.log(`Registration #${recordId} saved, notified ${allChatIds.length} chats`);
    res.json({ ok: true, id: recordId });
  } catch (err) {
    console.error('Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ====== API список записей ======
app.get('/api/registrations', async (req, res) => {
  try {
    const rows = await getRegistrations({
      branch: req.query.branch || '',
      group_name: req.query.group || '',
      limit: parseInt(req.query.limit) || 100,
    });
    const msk = rows.map(r => ({
      ...r,
      created_at: new Date(r.created_at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }),
    }));
    res.json(msk);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ====== Telegram вебхук ======
app.post('/telegram-webhook', async (req, res) => {
  const update = req.body;

  // --- Callback query ---
  if (update.callback_query) {
    const cb = update.callback_query;
    const chatId = cb.message.chat.id;
    const msgId = cb.message.message_id;
    const data = cb.data;

    await upsertChatUser({
      chat_id: chatId,
      first_name: cb.from.first_name || '',
      username: cb.from.username || '',
      phone: '',
    });

    // Просмотр записей: выбор филиала
    if (data === 'regs_branches') {
      const branches = await getAllBranches();
      const rows = branches.map(b => ([{ text: b.name, callback_data: 'regs_group:' + b.id }]));
      await editMsg(chatId, msgId, '🏫 Выберите филиал:', rows);
    }
    // Просмотр записей: выбор группы
    else if (data.startsWith('regs_group:')) {
      const branchId = parseInt(data.slice(11));
      const branch = (await getAllBranches()).find(b => b.id === branchId);
      const groups = await getGroupsForBranch(branchId);
      const rows = groups.map(g => ([{ text: g.name + ' ' + g.time, callback_data: 'regs_list:' + g.id }]));
      rows.push([{ text: '← Назад', callback_data: 'regs_branches' }]);
      await editMsg(chatId, msgId, `🏫 <b>${branch ? branch.name : ''}</b> — выберите группу:`, rows);
    }
    // Просмотр записей: список
    else if (data.startsWith('regs_list:')) {
      const groupId = parseInt(data.slice(10));
      const g = await getGroupById(groupId);
      const branch = g ? (await getAllBranches()).find(b => b.id === g.branch_id) : null;
      const rows = await getRegistrations({ branch: branch ? branch.name : '', group_name: g ? g.name : '', limit: 30 });
      if (rows.length === 0) {
        await editMsg(chatId, msgId, `📭 <b>${branch ? branch.name : ''}</b> — <b>${g ? g.name : ''}</b>\nНет записей.`,
          [[{ text: '← Назад', callback_data: 'regs_group:' + (branch ? branch.id : '') }]]);
      } else {
        let msg = `📋 <b>${branch ? branch.name : ''}</b> — <b>${g ? g.name : ''}</b>\n\n`;
        rows.forEach((r, i) => {
          msg += `${i + 1}. ${r.name || '—'} | ${r.phone || '—'}`;
          if (r.comment) msg += ` | ${r.comment}`;
          msg += `\n🕐 ${new Date(r.created_at).toLocaleString('ru-RU')}`;
          msg += ` | ${r.clicked ? '✅ перешёл' : '❌ не перешёл'}\n`;
        });
        await editMsg(chatId, msgId, msg, [[{ text: '← Назад', callback_data: 'regs_group:' + (branch ? branch.id : '') }]]);
      }
    }

    // === Админка: управление филиалами ===
    else if (data === 'admin_branches') {
      const branches = await getAllBranches();
      let msg = '🏫 <b>Филиалы:</b>\n\n';
      const rows = [];
      for (const b of branches) {
        msg += `• <b>${b.name}</b> (${b.key})\n`;
        rows.push([{ text: '❌ ' + b.name, callback_data: 'del_branch:' + b.id }]);
      }
      rows.push([{ text: '➕ Добавить филиал', callback_data: 'add_branch' }]);
      rows.push([{ text: '← Назад', callback_data: 'admin_panel' }]);
      await editMsg(chatId, msgId, msg, rows);
    }
    else if (data === 'add_branch') {
      await sendTelegram('Введите ключ филиала (англ, без пробелов):', chatId);
      await editMsg(chatId, msgId, 'Режим добавления филиала.\nШаг 1: отправьте ключ (например <code>nalchik</code>)');
      // Сохраняем состояние в глобальной переменной (упрощённо)
      userState[chatId] = { action: 'add_branch_step1' };
    }
    else if (data.startsWith('del_branch:')) {
      const id = parseInt(data.slice(11));
      await deleteBranch(id);
      await editMsg(chatId, msgId, '✅ Филиал удалён. Обновляю...');
      // Показываем обновлённый список
      const branches = await getAllBranches();
      let msg = '🏫 <b>Филиалы:</b>\n\n';
      const rows = [];
      for (const b of branches) {
        msg += `• <b>${b.name}</b> (${b.key})\n`;
        rows.push([{ text: '❌ ' + b.name, callback_data: 'del_branch:' + b.id }]);
      }
      rows.push([{ text: '➕ Добавить филиал', callback_data: 'add_branch' }]);
      rows.push([{ text: '← Назад', callback_data: 'admin_panel' }]);
      await editMsg(chatId, msgId, msg, rows);
    }

    // === Админка: управление группами ===
    else if (data === 'admin_groups') {
      const branches = await getAllBranches();
      const rows = branches.map(b => ([{ text: b.name, callback_data: 'admin_groups_list:' + b.id }]));
      rows.push([{ text: '← Назад', callback_data: 'admin_panel' }]);
      await editMsg(chatId, msgId, 'Выберите филиал для управления группами:', rows);
    }
    else if (data.startsWith('admin_groups_list:')) {
      const branchId = parseInt(data.slice(18));
      const branch = (await getAllBranches()).find(b => b.id === branchId);
      const groups = await getGroupsForBranch(branchId);
      let msg = `👥 <b>${branch.name}</b> — группы:\n\n`;
      const rows = [];
      for (const g of groups) {
        msg += `• ${g.name} (${g.time})\n`;
        rows.push([{ text: '❌ ' + g.name, callback_data: 'del_group:' + g.id }]);
      }
      rows.push([{ text: '➕ Добавить группу', callback_data: 'add_group:' + branchId }]);
      rows.push([{ text: '← Назад', callback_data: 'admin_groups' }]);
      await editMsg(chatId, msgId, msg, rows);
    }
    else if (data.startsWith('add_group:')) {
      const branchId = parseInt(data.slice(10));
      userState[chatId] = { action: 'add_group_step1', branchId };
      await sendTelegram('Введите название группы (например "Старшая (девочки)"):', chatId);
      await editMsg(chatId, msgId, 'Режим добавления группы.\nШаг 1: отправьте название');
    }
    else if (data.startsWith('del_group:')) {
      const id = parseInt(data.slice(10));
      await deleteGroup(id);
      // Показываем обновлённый список — возвращаемся к выбору филиала
      const branches = await getAllBranches();
      const rows = branches.map(b => ([{ text: b.name, callback_data: 'admin_groups_list:' + b.id }]));
      rows.push([{ text: '← Назад', callback_data: 'admin_panel' }]);
      await editMsg(chatId, msgId, '✅ Группа удалена. Выберите филиал:', rows);
    }

    // === Админка: главное меню ===
    else if (data === 'admin_panel') {
      await showAdminPanel(chatId, msgId);
    }

    await callTelegram('answerCallbackQuery', { callback_query_id: cb.id }).catch(() => {});
    return res.json({ ok: true });
  }

  // --- Обычные сообщения ---
  if (update.message && !update.message.chat.type.includes('group')) {
    const chat = update.message.chat;
    const chatId = chat.id;
    const text = (update.message.text || '').trim();

    await upsertChatUser({
      chat_id: chatId,
      first_name: chat.first_name || '',
      username: chat.username || '',
      phone: '',
    });

    // Контакт
    if (update.message.contact) {
      const phone = update.message.contact.phone_number;
      await upsertChatUser({ chat_id: chatId, first_name: chat.first_name, username: chat.username, phone });
      await sendTelegram(
        `Спасибо! Ваш номер <b>${phone}</b> сохранён. При записи на сайте вы получите подтверждение.`,
        chatId
      );
      return res.json({ ok: true });
    }

    // Обработка состояний (добавление филиала/группы)
    if (userState[chatId]) {
      const state = userState[chatId];
      if (state.action === 'add_branch_step1') {
        userState[chatId] = { action: 'add_branch_step2', key: text };
        await sendTelegram(`Ключ: <b>${text}</b>\nТеперь отправьте название филиала (например "Нальчик"):`, chatId);
        return res.json({ ok: true });
      }
      if (state.action === 'add_branch_step2') {
        userState[chatId] = { action: 'add_branch_step3', key: state.key, name: text };
        await sendTelegram(`Название: <b>${text}</b>\nОтправьте преподавателя (или "нет"):`, chatId);
        return res.json({ ok: true });
      }
      if (state.action === 'add_branch_step3') {
        const teacher = text === 'нет' ? '' : text;
        userState[chatId] = { action: 'add_branch_step4', key: state.key, name: state.name, teacher };
        await sendTelegram(`Преподаватель: <b>${teacher || '—'}</b>\nОтправьте дни занятий (или "нет"):`, chatId);
        return res.json({ ok: true });
      }
      if (state.action === 'add_branch_step4') {
        const days = text === 'нет' ? '' : text;
        try {
          await addBranch({ key: state.key, name: state.name, teacher: state.teacher, days });
          delete userState[chatId];
          await sendTelegram(`✅ Филиал <b>${state.name}</b> добавлен!`, chatId);
        } catch (err) {
          await sendTelegram(`❌ Ошибка: ${err.message}`, chatId);
        }
        return res.json({ ok: true });
      }
      if (state.action === 'add_group_step1') {
        userState[chatId] = { action: 'add_group_step2', branchId: state.branchId, name: text };
        await sendTelegram(`Название: <b>${text}</b>\nОтправьте время (например "18:00–19:20"):`, chatId);
        return res.json({ ok: true });
      }
      if (state.action === 'add_group_step2') {
        const branch = (await getAllBranches()).find(b => b.id === state.branchId);
        try {
          const key = text.replace(/[^a-zа-яё0-9]/gi, '_').toLowerCase().slice(0, 30);
          await addGroup({ branch_id: state.branchId, key, name: state.name, time: text });
          delete userState[chatId];
          await sendTelegram(`✅ Группа <b>${state.name}</b> добавлена в <b>${branch.name}</b>!`, chatId);
        } catch (err) {
          await sendTelegram(`❌ Ошибка: ${err.message}`, chatId);
        }
        return res.json({ ok: true });
      }
    }

    // Команды
    if (text === '/regs' || text === '/start') {
      const branches = await getAllBranches();
      const rows = branches.map(b => ([{ text: b.name, callback_data: 'regs_group:' + b.id }]));
      if (rows.length === 0) {
        await sendTelegram('Пока нет записей.', chatId);
      } else {
        await callTelegram('sendMessage', {
          chat_id: chatId,
          text: '🏫 Выберите филиал:',
          reply_markup: { inline_keyboard: rows },
        });
      }
      return res.json({ ok: true });
    }

    if (text === '/admin' && isAdmin(chatId)) {
      await showAdminPanel(chatId);
      return res.json({ ok: true });
    }

    if (text === '/help') {
      const help =
        `<b>🤖 Команды бота</b>\n\n` +
        `<b>/start</b> — просмотр записей\n` +
        `<b>/regs</b> — список записей\n` +
        (isAdmin(chatId) ? `<b>/admin</b> — управление филиалами и группами\n` : '') +
        `\n📱 Отправьте контакт, чтобы получать подтверждение записи`;
      await sendTelegram(help, chatId);
      return res.json({ ok: true });
    }

    // Приветствие
    const reply =
      `👋 Привет, ${chat.first_name || 'гость'}!\n\n` +
      `📋 <b>/regs</b> — список записей\n` +
      (isAdmin(chatId) ? `⚙️ <b>/admin</b> — управление филиалами и группами\n\n` : '') +
      `📱 Отправьте контакт — получать подтверждение записи`;

    await sendTelegram(reply, chatId);

    await callTelegram('sendMessage', {
      chat_id: chatId,
      text: 'Нажмите кнопку:',
      reply_markup: {
        keyboard: [[{ text: '📱 Отправить номер телефона', request_contact: true }]],
        resize_keyboard: true, one_time_keyboard: true,
      },
    });
  }

  res.json({ ok: true });
});

// ====== helpers ======
async function editMsg(chatId, msgId, text, keyboard) {
  await callTelegram('editMessageText', {
    chat_id: chatId, message_id: msgId,
    text, parse_mode: 'HTML',
    reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined,
  });
}

async function showAdminPanel(chatId, msgId) {
  const rows = [
    [{ text: '🏫 Филиалы', callback_data: 'admin_branches' }],
    [{ text: '👥 Группы', callback_data: 'admin_groups' }],
  ];
  if (msgId) {
    await editMsg(chatId, msgId, '⚙️ <b>Панель управления</b>', rows);
  } else {
    await callTelegram('sendMessage', {
      chat_id: chatId,
      text: '⚙️ <b>Панель управления</b>',
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: rows },
    });
  }
}

// ====== Состояния пользователей (in-memory) ======
const userState = {};

// ====== Запуск ======
(async () => {
  await initDB();
  await seedBranches();

  // Временный фикс: исправляем названия групп Нальчик (если они в кривой кодировке)
  try {
    const fixNames = [
      { id: 343, name: 'Старшая группа (12-17 лет)', time: '15:00-16:20' },
      { id: 344, name: 'Средняя группа (6-11 лет)', time: '16:30-17:50' },
      { id: 345, name: 'Младшая группа (4-6 лет)', time: '18:00-18:50' },
    ];
    const { getGroupById, updateGroup } = require('./db');
    for (const f of fixNames) {
      const existing = await getGroupById(f.id);
      if (existing) {
        await updateGroup(f.id, {
          name: f.name,
          time: f.time,
          links: existing.links || '',
        });
      }
    }
    console.log('DB: nalchik group names fixed');
  } catch (_) {}

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });

  try {
    const baseUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
    await setWebhook(`${baseUrl}/telegram-webhook`);
    console.log(`Telegram webhook set to ${baseUrl}/telegram-webhook`);
  } catch (err) {
    console.error('Failed to set Telegram webhook:', err.message);
  }
})();
