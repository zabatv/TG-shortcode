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
  await pool.query(`
    CREATE TABLE IF NOT EXISTS branches (
      id          SERIAL PRIMARY KEY,
      key         VARCHAR(50) UNIQUE NOT NULL,
      name        VARCHAR(255) NOT NULL,
      teacher     VARCHAR(255) DEFAULT '',
      days        VARCHAR(255) DEFAULT '',
      sort_order  INT DEFAULT 0
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS groups (
      id          SERIAL PRIMARY KEY,
      branch_id   INT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
      key         VARCHAR(50) NOT NULL,
      name        VARCHAR(255) NOT NULL,
      time        VARCHAR(50) DEFAULT '',
      sort_order  INT DEFAULT 0
    )
  `);
  // Удаляем дубликаты, оставляя самую старую запись
  await pool.query(`
    DELETE FROM groups WHERE id NOT IN (
      SELECT MIN(id) FROM groups GROUP BY branch_id, key
    )
  `);
  // Добавляем уникальность (если ещё нет)
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'groups_branch_id_key_key'
      ) THEN
        ALTER TABLE groups ADD CONSTRAINT groups_branch_id_key_key UNIQUE (branch_id, key);
      END IF;
    END $$;
  `);
  // Добавляем колонку links (для ссылок группы), если ещё нет
  await pool.query(`
    ALTER TABLE groups ADD COLUMN IF NOT EXISTS links TEXT DEFAULT ''
  `);
  // Добавляем колонки для отслеживания переходов
  await pool.query(`
    ALTER TABLE registrations ADD COLUMN IF NOT EXISTS clicked BOOLEAN DEFAULT false
  `);
  await pool.query(`
    ALTER TABLE registrations ADD COLUMN IF NOT EXISTS clicked_at TIMESTAMP
  `);
  console.log('DB: tables ready');
}

async function seedBranches() {
  // Создаём филиалы если их нет
  await pool.query(`INSERT INTO branches (key, name, teacher, days, sort_order) VALUES
    ('prokhladny', 'Прохладный', 'Губжокова Диана Анзоровна', 'Вторник, четверг', 1),
    ('maisky', 'Майский', '', 'Вторник, четверг', 2)
  ON CONFLICT (key) DO NOTHING`);

  // Группы для Прохладного
  const b = await pool.query('SELECT id FROM branches WHERE key = $1', ['prokhladny']);
  const testLinks = '[{"label":"Telegram","url":"https://t.me/test_group"},{"label":"WhatsApp","url":"https://chat.whatsapp.com/test123"}]';
  await pool.query(`INSERT INTO groups (branch_id, key, name, time, sort_order, links) VALUES
    ($1, 'senior_girls', 'Старшая (девочки)', '15:00–16:20', 1, $2),
    ($1, 'middle_girls', 'Средняя (девочки)', '16:30–17:50', 2, $2),
    ($1, 'junior_girls', 'Младшая (девочки)', '18:00–18:50', 3, $2),
    ($1, 'second_shift_girls', 'Вторая смена (девочки)', '19:00–20:20', 4, $2)
  ON CONFLICT (branch_id, key) DO UPDATE SET
    links = CASE WHEN groups.links = '' OR groups.links IS NULL THEN EXCLUDED.links ELSE groups.links END`,
  [b.rows[0].id, testLinks]);

  // Группы для Майского
  const b2 = await pool.query('SELECT id FROM branches WHERE key = $1', ['maisky']);
  await pool.query(`INSERT INTO groups (branch_id, key, name, time, sort_order, links) VALUES
    ($1, 'middle_common', 'Средняя (общая)', '16:30–17:50', 1, $2),
    ($1, 'senior_common', 'Старшая (общая)', '18:00–19:20', 2, $2)
  ON CONFLICT (branch_id, key) DO UPDATE SET
    links = CASE WHEN groups.links = '' OR groups.links IS NULL THEN EXCLUDED.links ELSE groups.links END`,
  [b2.rows[0].id, testLinks]);

  // Проставляем ссылки для старых групп, у которых их нет
  await pool.query(
    "UPDATE groups SET links = $1 WHERE links = '' OR links IS NULL",
    [testLinks]
  );
  // Чиним двойное экранирование (\" вместо ")
  await pool.query(
    "UPDATE groups SET links = REPLACE(links, '\\\"', '\"') WHERE links LIKE '%\\\"%'"
  );

  console.log('DB: branches seeded');
}

// ====== Регистрации ======
async function saveRegistration({ branch, group_name, name, phone, comment }) {
  const res = await pool.query(
    `INSERT INTO registrations (branch, group_name, name, phone, comment)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [branch, group_name, name || '', phone || '', comment || '']
  );
  return res.rows[0].id;
}

async function deleteRegistration(id) {
  await pool.query('DELETE FROM registrations WHERE id = $1', [id]);
}

async function markClicked(id) {
  await pool.query(
    'UPDATE registrations SET clicked = true, clicked_at = NOW() WHERE id = $1',
    [id]
  );
}

async function getRegistrations({ branch, group_name, limit = 50 }) {
  let sql = 'SELECT * FROM registrations WHERE 1=1';
  const params = [];
  if (branch) { params.push(branch); sql += ` AND branch = $${params.length}`; }
  if (group_name) { params.push(group_name); sql += ` AND group_name = $${params.length}`; }
  sql += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1);
  params.push(limit);
  const res = await pool.query(sql, params);
  return res.rows;
}

// ====== Филиалы ======
async function getAllBranches() {
  const res = await pool.query('SELECT * FROM branches ORDER BY sort_order');
  return res.rows;
}

async function addBranch({ key, name, teacher, days }) {
  const res = await pool.query(
    `INSERT INTO branches (key, name, teacher, days) VALUES ($1, $2, $3, $4) RETURNING *`,
    [key, name, teacher || '', days || '']
  );
  return res.rows[0];
}

async function updateBranch(id, { name, teacher, days }) {
  const res = await pool.query(
    `UPDATE branches SET name = $2, teacher = $3, days = $4 WHERE id = $1 RETURNING *`,
    [id, name, teacher || '', days || '']
  );
  return res.rows[0];
}

async function deleteBranch(id) {
  await pool.query('DELETE FROM branches WHERE id = $1', [id]);
}

// ====== Группы ======
async function getGroupsForBranch(branchId) {
  const res = await pool.query('SELECT * FROM groups WHERE branch_id = $1 ORDER BY sort_order', [branchId]);
  return res.rows;
}

async function getGroupsByName(branchName) {
  const res = await pool.query(
    `SELECT g.* FROM groups g JOIN branches b ON b.id = g.branch_id WHERE b.name = $1 ORDER BY g.sort_order`,
    [branchName]
  );
  return res.rows;
}

async function addGroup({ branch_id, key, name, time }) {
  const res = await pool.query(
    `INSERT INTO groups (branch_id, key, name, time) VALUES ($1, $2, $3, $4) RETURNING *`,
    [branch_id, key, name, time || '']
  );
  return res.rows[0];
}

async function updateGroup(id, { name, time, links }) {
  const res = await pool.query(
    `UPDATE groups SET name = $2, time = $3, links = $4 WHERE id = $1 RETURNING *`,
    [id, name, time || '', links || '']
  );
  return res.rows[0];
}

async function deleteGroup(id) {
  await pool.query('DELETE FROM groups WHERE id = $1', [id]);
}

// ====== Chat users ======
async function upsertChatUser({ chat_id, first_name, username, phone }) {
  await pool.query(
    `INSERT INTO chat_users (chat_id, first_name, username, phone, last_activity)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (chat_id)
     DO UPDATE SET first_name = $2, username = $3,
       phone = COALESCE(NULLIF($4, ''), chat_users.phone),
       last_activity = NOW()`,
    [chat_id, first_name || '', username || '', phone || '']
  );
}

async function getAllChatIds() {
  const res = await pool.query('SELECT chat_id FROM chat_users');
  return res.rows.map(r => r.chat_id);
}

module.exports = {
  initDB, seedBranches,
  saveRegistration, markClicked, getRegistrations, deleteRegistration,
  getAllBranches, addBranch, updateBranch, deleteBranch,
  getGroupsForBranch, getGroupsByName, addGroup, updateGroup, deleteGroup,
  upsertChatUser, getAllChatIds,
};
