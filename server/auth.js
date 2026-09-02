const bcrypt = require('bcryptjs');
const { pool } = require('./db');

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

async function signup(email, password) {
  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rows.length) throw httpError(409, 'An account with that email already exists');

  const passwordHash = await bcrypt.hash(password, 10);
  const { rows } = await pool.query(
    'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email',
    [email, passwordHash]
  );
  return rows[0];
}

async function verifyLogin(email, password) {
  const { rows } = await pool.query('SELECT id, email, password_hash FROM users WHERE email = $1', [email]);
  const user = rows[0];
  // Compare against a dummy hash even when no user exists, so login timing doesn't
  // reveal whether an email is registered.
  const hash = user ? user.password_hash : '$2a$10$CwTycUXWue0Thq9StjUM0uJ8Kg7dEXOWSvNWkD6nkV6LR3n7v/aVe';
  const ok = await bcrypt.compare(password, hash);
  if (!user || !ok) throw httpError(401, 'Invalid email or password');
  return { id: user.id, email: user.email };
}

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not signed in' });
  next();
}

module.exports = { signup, verifyLogin, requireAuth, httpError };
