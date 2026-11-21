const crypto = require('crypto');
const { pool } = require('../db');
const { hashPassword } = require('./password');

const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

// tag, name/breed, gender, birth, weight, last calving, expected calving, medications, status, notes
const herd = () => [
  ['CT-001', 'Daisy Holstein', 'female', day(-1700), 1380, day(-66), day(200), 'Vitamin B12', 'healthy', 'High milk producer; due for routine hoof trim.'],
  ['CT-002', 'Bessie Jersey', 'female', day(-1200), 1020, day(-280), day(9), '', 'pregnant', 'Due soon; move to the calving pen.'],
  ['CT-003', 'Bull Maximus', 'male', day(-2000), 2150, null, null, 'Vaccination', 'healthy', 'Primary herd sire.'],
  ['CT-004', 'Moo Moo Guernsey', 'female', day(-1400), 1140, day(-250), day(14), '', 'pregnant', 'Confirmed pregnant via ultrasound.'],
  ['CT-005', 'Clover Angus', 'female', day(-1300), 1120, day(-120), null, 'Anti-inflammatory', 'under_treatment', 'Mild lameness; monitor daily.'],
  ['CT-006', 'Maple Hereford', 'female', day(-1600), 1210, day(-200), day(45), '', 'healthy', 'Calm temperament; easy calver.'],
  ['CT-007', 'Buttercup Jersey', 'female', day(-900), 980, null, null, 'Antibiotics', 'quarantine', 'Isolated pending vet check.'],
  ['CT-008', 'Ranger Angus', 'male', day(-700), 1650, null, null, '', 'healthy', 'Young bull; growing well.'],
];

async function createDemoUser() {
  const email = `demo-${crypto.randomBytes(6).toString('hex')}@demo.invalid`;
  const hash = await hashPassword(crypto.randomBytes(32).toString('hex'));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      "INSERT INTO users (email, password_hash, role, is_demo) VALUES ($1, $2, 'user', true) RETURNING id, email, role",
      [email, hash]
    );
    const user = rows[0];
    for (const c of herd()) {
      await client.query(
        `INSERT INTO cattle (owner_id, tag_number, name_breed, gender, birth_date, weight,
           last_calving_date, expected_calving_date, medications, health_status, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [user.id, ...c]
      );
    }
    await client.query('COMMIT');
    return user;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { createDemoUser };