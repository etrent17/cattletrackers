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

// Sample financial records (feature 11): date, kind, category, amount, cow number or null, description
const transactions = () => [
  [day(-150), 'expense', 'Feed', '1840.00', null, 'Hay, 80 round bales'],
  [day(-140), 'income', 'Milk', '2315.60', null, 'Monthly milk cheque'],
  [day(-120), 'expense', 'Vet and medicine', '185.40', 'CT-005', 'Lameness exam and anti-inflammatory'],
  [day(-110), 'income', 'Milk', '2290.15', null, 'Monthly milk cheque'],
  [day(-95), 'expense', 'Equipment', '649.99', null, 'Replacement water trough'],
  [day(-80), 'income', 'Milk', '2402.80', null, 'Monthly milk cheque'],
  [day(-70), 'expense', 'Breeding', '120.00', 'CT-004', 'Pregnancy check by ultrasound'],
  [day(-60), 'expense', 'Labour', '960.00', null, 'Seasonal help, two weeks'],
  [day(-45), 'income', 'Sale of animals', '1450.00', null, 'Sold two weaned steers'],
  [day(-30), 'expense', 'Feed', '725.25', null, 'Mineral supplement and grain'],
  [day(-20), 'expense', 'Vet and medicine', '210.00', 'CT-007', 'Quarantine vet visit and antibiotics'],
  [day(-10), 'income', 'Milk', '2350.35', null, 'Monthly milk cheque'],
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
    await insertDemoTransactions(client, user.id);
    await client.query('COMMIT');
    return user;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function insertDemoTransactions(client, userId) {
  for (const [date, kind, category, amount, tag, description] of transactions()) {
    await client.query(
      `INSERT INTO transactions (owner_id, date, kind, category, amount, cattle_id, description)
       VALUES ($1, $2, $3, $4, $5, (SELECT id FROM cattle WHERE owner_id = $1 AND tag_number = $6), $7)`,
      [userId, date, kind, category, amount, tag, description]
    );
  }
}

module.exports = { createDemoUser };