const express = require('express');
const cors = require('cors');
const { initDB, saveRegistration, upsertChatUser, getAllChatIds, getRegistrations, getBranches, getGroups } = require('./db');
const { sendTelegram, formatMessage, setWebhook, callTelegram } = require('./telegram');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5050;

// Health check
app.get('/', (_req, res) => res.send('OK'));

app.get('/debug', (_req, res) => {
  res.json({
    hasBotToken: !!process.env.TELEGRAM_BOT_TOKEN,
    hasAdminId: !!process.env.TELEGRAM_CHAT_ID,
    hasDbUrl: !!process.env.DATABASE_URL,
    port: process.env.PORT || 'not set',
    renderUrl: process.env.RENDER_EXTERNAL_URL || 'not set',
  });
});

// Notify endpoint — вызывается из WordPress после успешной записи в Rubitime
app.post('/notify', async (req, res) => {
  const { branch, group, name, phone, comment } = req.body;

  if (!branch || !group) {
    return res.status(400).json({ error: 'branch and group are required' });
  }

  const data = {
    branch,
    group_name: group,
    name: name || '',
    phone: phone || '',
    comment: comment || '',
  };

  try {
    const recordId = await saveRegistration(data);

    const msg = formatMessage(data);

    // Админу
    await sendTelegram(msg).catch(() => {});

    // Всем кто когда-либо писал боту
    const allChatIds = await getAllChatIds();
    const broadcastMsg =
      `📢 <b>Новая запись!</b>\n\n` +
      `🏫 ${data.branch}\n` +
      `👥 ${data.group_name}\n` +
      (data.name ? `👤 ${data.name}\n` : '') +
      (data.phone ? `📞 ${data.phone}\n` : '');

    for (const cid of allChatIds) {
      await sendTelegram(broadcastMsg, cid).catch(() => {});
    }

    console.log(`Registration #${recordId} saved, notified ${allChatIds.length + 1} chats`);
    res.json({ ok: true, id: recordId });
  } catch (err) {
    console.error('Error processing registration:', err.message);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// API: список записей (фильтр по branch / group)
app.get('/api/registrations', async (req, res) => {
  try {
    const rows = await getRegistrations({
      branch: req.query.branch || '',
      group_name: req.query.group || '',
      limit: parseInt(req.query.limit) || 100,
    });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/branches', async (_req, res) => {
  try {
    const branches = await getBranches();
    res.json(branches);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/groups', async (req, res) => {
  try {
    const groups = await getGroups(req.query.branch || '');
    res.json(groups);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Telegram webhook — вызывается Telegram, когда кто-то пишет боту
app.post('/telegram-webhook', async (req, res) => {
  const update = req.body;

  // ====== Callback query (нажатие на inline-кнопку) ======
  if (update.callback_query) {
    const cb = update.callback_query;
    const chatId = cb.message.chat.id;
    const msgId = cb.message.message_id;
    const data = cb.data; // например "branch:Прохладный" или "group:Старшая (девочки)"

    await upsertChatUser({
      chat_id: chatId,
      first_name: cb.from.first_name || '',
      username: cb.from.username || '',
      phone: '',
    });

    if (data.startsWith('branch:')) {
      const branch = data.slice(7);
      const groups = await getGroups(branch);
      const rows = groups.map(g => ([{ text: g, callback_data: 'group:' + branch + '|' + g }]));
      rows.push([{ text: '← Назад', callback_data: 'back_to_branches' }]);
      await callTelegram('editMessageText', {
        chat_id: chatId,
        message_id: msgId,
        text: `🏫 <b>${branch}</b>\nВыберите группу:`,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: rows },
      });
    } else if (data.startsWith('group:')) {
      const rest = data.slice(6);
      const sep = rest.indexOf('|');
      const branch = rest.slice(0, sep);
      const group = rest.slice(sep + 1);
      const rows = await getRegistrations({ branch, group_name: group, limit: 30 });
      if (rows.length === 0) {
        await callTelegram('editMessageText', {
          chat_id: chatId,
          message_id: msgId,
          text: `📭 <b>${branch}</b> — <b>${group}</b>\nНет записей.`,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [[{ text: '← Назад', callback_data: 'branch:' + branch }]] },
        });
      } else {
        let msg = `📋 <b>${branch}</b> — <b>${group}</b>\n\n`;
        rows.forEach((r, i) => {
          msg += `${i + 1}. ${r.name || '—'} | ${r.phone || '—'}`;
          if (r.comment) msg += ` | ${r.comment}`;
          msg += `\n   🕐 ${new Date(r.created_at).toLocaleString('ru-RU')}\n`;
        });
        await callTelegram('editMessageText', {
          chat_id: chatId,
          message_id: msgId,
          text: msg,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [[{ text: '← Назад', callback_data: 'branch:' + branch }]] },
        });
      }
    } else if (data === 'back_to_branches') {
      await sendBranchList(chatId, msgId);
    }

    // Отвечаем на callback
    await callTelegram('answerCallbackQuery', { callback_query_id: cb.id });
    return res.json({ ok: true });
  }

  // ====== Обычные сообщения ======
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
        `Спасибо! Ваш номер <b>${phone}</b> сохранён. Теперь при записи на сайте вы получите подтверждение в этом чате.`,
        chatId
      );
      return res.json({ ok: true });
    }

    // Команда /regs — список записей
    if (text === '/regs' || text === '/start') {
      const branches = await getBranches();
      if (branches.length === 0) {
        await sendTelegram('Пока нет записей. Как только кто-то запишется, здесь появится список.', chatId);
        return res.json({ ok: true });
      }
      await sendBranchList(chatId);
      return res.json({ ok: true });
    }

    // Приветствие
    const reply =
      `👋 Привет, ${chat.first_name || 'гость'}!\n\n` +
      `Я бот танцевальной студии.\n\n` +
      `📋 <b>/regs</b> — посмотреть записи на занятия\n` +
      `📱 Отправьте контакт — получать подтверждение записи`;

    await sendTelegram(reply, chatId);

    await callTelegram('sendMessage', {
      chat_id: chatId,
      text: 'Нажмите кнопку, чтобы поделиться номером:',
      reply_markup: {
        keyboard: [
          [{ text: '📱 Отправить номер телефона', request_contact: true }]
        ],
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    });
  }

  res.json({ ok: true });
});

async function sendBranchList(chatId, messageId) {
  const branches = await getBranches();
  const rows = branches.map(b => ([{ text: b, callback_data: 'branch:' + b }]));

  if (messageId) {
    await callTelegram('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: '🏫 Выберите филиал:',
      reply_markup: { inline_keyboard: rows },
    });
  } else {
    await callTelegram('sendMessage', {
      chat_id: chatId,
      text: '🏫 Выберите филиал:',
      reply_markup: { inline_keyboard: rows },
    });
  }
}

// Запуск
(async () => {
  await initDB();
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });

  // Устанавливаем вебхук для Telegram
  try {
    const baseUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
    await setWebhook(`${baseUrl}/telegram-webhook`);
    console.log(`Telegram webhook set to ${baseUrl}/telegram-webhook`);
  } catch (err) {
    console.error('Failed to set Telegram webhook:', err.message);
  }
})();
