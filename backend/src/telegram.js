const https = require('https');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID   = process.env.TELEGRAM_CHAT_ID;

function sendTelegram(text) {
  return new Promise((resolve, reject) => {
    if (!BOT_TOKEN || !CHAT_ID) {
      console.warn('Telegram: BOT_TOKEN or CHAT_ID not set, skipping');
      return resolve(false);
    }

    const body = JSON.stringify({
      chat_id: CHAT_ID,
      text: text,
      parse_mode: 'HTML',
    });

    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/sendMessage`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        const ok = res.statusCode >= 200 && res.statusCode < 300;
        if (ok) resolve(true);
        else reject(new Error(`Telegram API error: ${data}`));
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function formatMessage({ branch, group_name, name, phone, comment }) {
  const lines = [
    '🎯 <b>Новая запись на занятие!</b>',
    '',
    `🏫 <b>Филиал:</b> ${branch}`,
    `👥 <b>Группа:</b> ${group_name}`,
  ];
  if (name)  lines.push(`👤 <b>Имя:</b> ${name}`);
  if (phone) lines.push(`📞 <b>Телефон:</b> ${phone}`);
  if (comment) lines.push(`📝 <b>Комментарий:</b> ${comment}`);
  lines.push('', `🕐 ${new Date().toLocaleString('ru-RU')}`);
  return lines.join('\n');
}

module.exports = { sendTelegram, formatMessage };
