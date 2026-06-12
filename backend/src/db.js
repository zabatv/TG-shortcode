const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS registrations (
      id            SERIAL PRIMARY KEY,
      branch        VARCHAR(255) NOT NULL,
      group_name    VARCHAR(255) NOT NULL,
      name          VARCHAR(255) DEFAULT '',
      phone         VARCHAR(50)  DEFAULT '',
      comment       TEXT         DEFAULT '',
      created_at    TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_users (
      id            SERIAL PRIMARY KEY,
      chat_id       BIGINT NOT NULL UNIQUE,
      first_name    VARCHAR(255) DEFAULT '',
      username      VARCHAR(255) DEFAULT '',
      phone         VARCHAR(50)  DEFAULT '',
      last_activity TIMESTAMP DEFAULT NOW()
    )
  `);
  console.log('DB: tables ready');
}

async function saveRegistration({ branch, group_name, name, phone, comment }) {
  const res = await pool.query(
    `INSERT INTO registrations (branch, group_name, name, phone, comment)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [branch, group_name, name, phone, comment]
  );
  return res.rows[0].id;
}

async function upsertChatUser({ chat_id, first_name, username, phone }) {
  await pool.query(
    `INSERT INTO chat_users (chat_id, first_name, username, phone, last_activity)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (chat_id)
     DO UPDATE SET first_name = $2, username = $3,
       phone = COALESCE(NULLIF($4, ''), chat_users.phone),
       last_activity = NOW()`,
    [chat_id, first_name, username, phone || '']
  );
}

async function findChatByPhone(phone) {
  if (!phone) return null;
  const res = await pool.query(
    'SELECT chat_id FROM chat_users WHERE phone = $1 LIMIT 1',
    [phone]
  );
  return res.rows.length ? res.rows[0].chat_id : null;
}

async function getAllChatIds() {
  const res = await pool.query('SELECT chat_id FROM chat_users');
  return res.rows.map(r => r.chat_id);
}

module.exports = { initDB, saveRegistration, upsertChatUser, findChatByPhone, getAllChatIds };
