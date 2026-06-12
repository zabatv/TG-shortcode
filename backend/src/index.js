const express = require('express');
const cors = require('cors');
const {
  initDB, seedBranches,
  saveRegistration, getRegistrations, deleteRegistration,
  getAllBranches, addBranch, updateBranch, deleteBranch,
  getGroupsForBranch, getGroupsByName, addGroup, updateGroup, deleteGroup,
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
        key: b.key,
        name: b.name,
        teacher: b.teacher,
        days: b.days,
        groups: groups.map(g => ({ id: g.id, key: g.key, name: g.name, time: g.time })),
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

    await sendTelegram(formatMessage(data)).catch(() => {});

    const allChatIds = await getAllChatIds();
    const broadcastMsg =
      `📢 <b>Новая запись!</b>\n\n` +
      `🏫 ${data.branch}\n👥 ${data.group_name}\n` +
      (data.name ? `👤 ${data.name}\n` : '') +
      (data.phone ? `📞 ${data.phone}\n` : '');

    for (const cid of allChatIds) {
      await sendTelegram(broadcastMsg, cid).catch(() => {});
    }

    console.log(`Registration #${recordId} saved, notified ${allChatIds.length + 1} chats`);
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
      const rows = branches.map(b => ([{ text: b.name, callback_data: 'regs_group:' + b.name }]));
      await editMsg(chatId, msgId, '🏫 Выберите филиал:', rows);
    }
    // Просмотр записей: выбор группы
    else if (data.startsWith('regs_group:')) {
      const branch = data.slice(11);
      const groups = await getGroupsByName(branch);
      const rows = groups.map(g => ([{ text: g.name + ' ' + g.time, callback_data: 'regs_list:' + branch + '|' + g.name }]));
      rows.push([{ text: '← Назад', callback_data: 'regs_branches' }]);
      await editMsg(chatId, msgId, `🏫 <b>${branch}</b> — выберите группу:`, rows);
    }
    // Просмотр записей: список
    else if (data.startsWith('regs_list:')) {
      const rest = data.slice(10);
      const sep = rest.indexOf('|');
      const branch = rest.slice(0, sep);
      const group = rest.slice(sep + 1);
      const rows = await getRegistrations({ branch, group_name: group, limit: 30 });
      if (rows.length === 0) {
        await editMsg(chatId, msgId, `📭 <b>${branch}</b> — <b>${group}</b>\nНет записей.`,
          [[{ text: '← Назад', callback_data: 'regs_group:' + branch }]]);
      } else {
        let msg = `📋 <b>${branch}</b> — <b>${group}</b>\n\n`;
        rows.forEach((r, i) => {
          msg += `${i + 1}. ${r.name || '—'} | ${r.phone || '—'}`;
          if (r.comment) msg += ` | ${r.comment}`;
          msg += `\n🕐 ${new Date(r.created_at).toLocaleString('ru-RU')}\n`;
        });
        await editMsg(chatId, msgId, msg, [[{ text: '← Назад', callback_data: 'regs_group:' + branch }]]);
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
      const rows = branches.map(b => ([{ text: b.name, callback_data: 'regs_group:' + b.name }]));
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
