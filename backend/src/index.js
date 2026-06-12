const express = require('express');
const cors = require('cors');
const { initDB, saveRegistration } = require('./db');
const { sendTelegram, formatMessage } = require('./telegram');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5050;

// Health check
app.get('/', (_req, res) => res.send('OK'));

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
    // 1. Сохраняем в БД
    const recordId = await saveRegistration(data);

    // 2. Отправляем в Telegram
    const tgText = formatMessage(data);
    await sendTelegram(tgText);

    console.log(`Registration #${recordId} saved & notified`);
    res.json({ ok: true, id: recordId });
  } catch (err) {
    console.error('Error processing registration:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Запуск
(async () => {
  await initDB();
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
})();
