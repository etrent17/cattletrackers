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

// Weight history by tag (feature 10): days ago, weight in lbs, notes. The newest weighing of each
// animal must equal its weight in herd() above, because cattle.weight follows the weighings.
const weighings = () => ({
  'CT-001': [[-14, 1380, 'Fall weigh-in'], [-120, 1335, ''], [-240, 1300, 'Dry period'], [-365, 1350, '']],
  'CT-002': [[-14, 1020, 'Heavy in calf'], [-120, 960, ''], [-240, 935, '']],
  'CT-003': [[-14, 2150, ''], [-120, 2110, ''], [-240, 2060, ''], [-365, 2005, '']],
  'CT-004': [[-14, 1140, ''], [-120, 1085, ''], [-240, 1060, '']],
  'CT-005': [[-14, 1120, 'Lost condition while lame'], [-60, 1150, ''], [-120, 1135, ''], [-240, 1110, '']],
  'CT-006': [[-14, 1210, ''], [-120, 1190, ''], [-240, 1165, '']],
  'CT-007': [[-14, 980, 'Weighed in quarantine'], [-120, 940, ''], [-240, 885, '']],
  'CT-008': [[-14, 1650, 'Growing well'], [-120, 1395, ''], [-240, 1120, ''], [-365, 850, 'Weaning weight']],
});

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
    const history = calvings();
    const weights = weighings();
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
      for (const [daysAgo, weight, notes] of weights[c[0]] || []) {
        await client.query(
          'INSERT INTO weighings (cattle_id, owner_id, date, weight, notes) VALUES ($1,$2,$3,$4,$5)',
          [cow.rows[0].id, user.id, day(daysAgo), weight, notes || null]
        );
      }
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