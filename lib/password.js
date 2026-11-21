const argon2 = require('argon2');

const OPTIONS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

const hashPassword = (pw) => argon2.hash(pw, OPTIONS);
const verifyPassword = (hash, pw) => argon2.verify(hash, pw);
const dummyHash = hashPassword('not-a-real-password'); // equalizes timing for unknown emails

module.exports = { hashPassword, verifyPassword, dummyHash };