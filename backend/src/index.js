const express = require('express');
const cors = require('cors');
const { initDB, saveRegistration, upsertChatUser, getAllChatIds } = require('./db');
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

// Telegram webhook — вызывается Telegram, когда кто-то пишет боту
app.post('/telegram-webhook', async (req, res) => {
  const update = req.body;

  // Только личные сообщения (не из групп)
  if (update.message && !update.message.chat.type.includes('group')) {
    const chat = update.message.chat;
    const chatId = chat.id;
    const text = update.message.text || '';

    // Сохраняем/обновляем пользователя в БД
    await upsertChatUser({
      chat_id: chatId,
      first_name: chat.first_name || '',
      username: chat.username || '',
      phone: '',
    });

    // Если прислали номер телефона через контакт
    if (update.message.contact) {
      const phone = update.message.contact.phone_number;
      await upsertChatUser({ chat_id: chatId, first_name: chat.first_name, username: chat.username, phone });
      await sendTelegram(
        `Спасибо! Ваш номер <b>${phone}</b> сохранён. Теперь при записи на сайте вы получите подтверждение в этом чате.`,
        chatId
      );
      return res.json({ ok: true });
    }

    // Простое текстовое сообщение — отвечаем
    const reply =
      `👋 Привет, ${chat.first_name || 'гость'}!\n\n` +
      `Я бот танцевальной студии. Чтобы записаться на занятие, перейдите на сайт.\n\n` +
      `Если хотите получать подтверждение записи в этом чате — отправьте свой номер телефона через кнопку ниже 👇`;

    await sendTelegram(reply, chatId);

    // Кнопка для отправки контакта
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
