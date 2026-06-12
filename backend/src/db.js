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
  console.log('DB: table ready');
}

async function saveRegistration({ branch, group_name, name, phone, comment }) {
  const res = await pool.query(
    `INSERT INTO registrations (branch, group_name, name, phone, comment)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [branch, group_name, name, phone, comment]
  );
  return res.rows[0].id;
}

module.exports = { initDB, saveRegistration };
