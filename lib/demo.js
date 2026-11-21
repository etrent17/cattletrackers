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

// Calving history by tag: days ago, calf sex, calf tag, birth weight, ease, outcome, notes.
// The newest event of each cow must be on her last calving date above.
const calvings = () => ({
  'CT-001': [
    [-66, 'female', 'CT-021', 88, 'unassisted', 'alive', 'Up and nursing within the hour.'],
    [-460, 'male', '', 95, 'assisted', 'alive', 'Large calf; light pull needed.'],
    [-850, 'female', '', 82, 'unassisted', 'alive', ''],
  ],
  'CT-002': [
    [-280, 'female', '', 61, 'unassisted', 'alive', ''],
    [-660, 'male', '', 64, 'unassisted', 'stillborn', 'Born overnight; vet found no cause.'],
  ],
  'CT-004': [[-250, 'male', '', 79, 'unassisted', 'alive', '']],
  'CT-005': [[-120, 'female', 'CT-019', 74, 'caesarean', 'alive', 'Breech presentation; vet attended.']],
  'CT-006': [
    [-200, 'male', '', 85, 'unassisted', 'alive', ''],
    [-590, 'female', '', 80, 'unassisted', 'alive', 'Easy calver, as usual.'],
  ],
});

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
    const history = calvings();
    for (const c of herd()) {
      const cow = await client.query(
        `INSERT INTO cattle (owner_id, tag_number, name_breed, gender, birth_date, weight,
           last_calving_date, expected_calving_date, medications, health_status, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [user.id, ...c]
      );
      for (const [daysAgo, sex, calfTag, weight, ease, outcome, notes] of history[c[0]] || []) {
        await client.query(
          `INSERT INTO calving_events (cattle_id, owner_id, calving_date, calf_sex, calf_tag,
             birth_weight, ease, outcome, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [cow.rows[0].id, user.id, day(daysAgo), sex, calfTag || null, weight, ease, outcome, notes || null]
        );
      }
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