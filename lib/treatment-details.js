// Optional details shared by treatment persistence, validation and serialization.
const DETAILS = [
  ['reason', 'reason', 500],
  ['observations', 'observations', 2000],
  ['productLot', 'product_lot', 100],
  ['productExpiryDate', 'product_expiry_date', null],
  ['veterinarian', 'veterinarian', 100],
  ['withdrawalSource', 'withdrawal_source', 500],
  ['withdrawalNotes', 'withdrawal_notes', 2000],
];

async function initTreatmentDetails(pool) {
  await pool.query(`ALTER TABLE treatments
    ADD COLUMN IF NOT EXISTS reason TEXT,
    ADD COLUMN IF NOT EXISTS observations TEXT,
    ADD COLUMN IF NOT EXISTS product_lot TEXT,
    ADD COLUMN IF NOT EXISTS product_expiry_date DATE,
    ADD COLUMN IF NOT EXISTS veterinarian TEXT,
    ADD COLUMN IF NOT EXISTS withdrawal_source TEXT,
    ADD COLUMN IF NOT EXISTS withdrawal_notes TEXT`);
}

function detailsToApi(row) {
  return Object.fromEntries(DETAILS
    .filter(([, column]) => row[column] != null)
    .map(([key, column]) => [key, row[column]]));
}

function detailRules(body, isoDate) {
  return DETAILS.map(([key, , max]) => {
    const rule = body(key).optional({ nullable: true });
    if (max === null) {
      return rule.isString().withMessage('Invalid product expiry date').bail()
        .custom((value) => value === '' || /^\d{4}-\d{2}-\d{2}$/.test(value))
        .withMessage('Enter a valid product expiry date').bail()
        .if((value) => value !== '')
        .isISO8601(isoDate).withMessage('Enter a valid product expiry date');
    }
    return rule.isString().withMessage(`Invalid ${key}`).bail().trim()
      .isLength({ max }).withMessage(`${key} must be at most ${max} characters`);
  });
}

// Only supplied detail fields are written. Older clients cannot accidentally erase them.
async function saveDetails(db, id, body) {
  const entries = DETAILS.filter(([key]) => Object.prototype.hasOwnProperty.call(body, key));
  if (!entries.length) return;
  const values = entries.map(([key]) => body[key] == null || body[key] === '' ? null : body[key]);
  const assignments = entries.map(([, column], index) => `${column}=$${index + 2}`).join(', ');
  await db.query(`UPDATE treatments SET ${assignments} WHERE id=$1`, [id, ...values]);
}

module.exports = { DETAILS, initTreatmentDetails, detailsToApi, detailRules, saveDetails };
