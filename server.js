'use strict';

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const express = require('express');
const session = require('express-session');
const Database = require('better-sqlite3');

// This lab intentionally binds to loopback only. Do not change this to 0.0.0.0.
const HOST = '127.0.0.1';
const VICTIM_PORT = 3000;
const ATTACKER_PORT = 4000;
const VICTIM_ORIGIN = `http://${HOST}:${VICTIM_PORT}`;
const ATTACKER_ORIGIN = `http://${HOST}:${ATTACKER_PORT}`;
const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'csrf-lab.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    balance INTEGER NOT NULL CHECK (balance >= 0)
  );

  CREATE TABLE IF NOT EXISTS transfers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER NOT NULL REFERENCES accounts(id),
    recipient_id INTEGER NOT NULL REFERENCES accounts(id),
    amount INTEGER NOT NULL CHECK (amount > 0),
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS security_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mode TEXT NOT NULL,
    origin TEXT,
    outcome TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

const accountCount = db.prepare('SELECT COUNT(*) AS count FROM accounts').get().count;
if (accountCount === 0) {
  const insert = db.prepare(
    'INSERT INTO accounts (id, username, display_name, balance) VALUES (?, ?, ?, ?)'
  );
  insert.run(1, 'alice', 'Alice (you)', 1000);
  insert.run(2, 'bob', 'Bob (recipient)', 250);
}

let currentMode = 'vulnerable';
const VALID_MODES = new Set(['vulnerable', 'token', 'origin', 'both']);

const victim = express();
victim.disable('x-powered-by');
victim.use(express.urlencoded({ extended: false, limit: '10kb' }));
victim.use(express.json({ limit: '10kb' }));
victim.use(session({
  name: 'csrf_lab_sid',
  secret: process.env.LAB_SESSION_SECRET || 'local-only-change-this-session-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: false, // HTTP is used only on loopback for this local exercise.
    maxAge: 2 * 60 * 60 * 1000
  }
}));

function now() {
  return new Date().toISOString();
}

function addSecurityEvent({ origin, outcome, reason }) {
  db.prepare(`
    INSERT INTO security_events (mode, origin, outcome, reason, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(currentMode, origin || 'missing', outcome, reason, now());
}

function requireLogin(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ ok: false, error: 'Сначала войди в учебный аккаунт Alice.' });
  }
  next();
}

function getAccount(id) {
  return db.prepare(
    'SELECT id, username, display_name AS displayName, balance FROM accounts WHERE id = ?'
  ).get(id);
}

function safeTokenEqual(received, expected) {
  if (typeof received !== 'string' || typeof expected !== 'string') return false;
  const a = Buffer.from(received, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

victim.get('/api/state', requireLogin, (req, res) => {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }

  const account = getAccount(req.session.userId);
  const transfers = db.prepare(`
    SELECT t.id, s.display_name AS sender, r.display_name AS recipient,
           t.amount, t.created_at AS createdAt
    FROM transfers t
    JOIN accounts s ON s.id = t.sender_id
    JOIN accounts r ON r.id = t.recipient_id
    WHERE t.sender_id = ? OR t.recipient_id = ?
    ORDER BY t.id DESC LIMIT 10
  `).all(req.session.userId, req.session.userId);

  const events = db.prepare(`
    SELECT id, mode, origin, outcome, reason, created_at AS createdAt
    FROM security_events ORDER BY id DESC LIMIT 8
  `).all();

  res.json({
    ok: true,
    account,
    recipient: getAccount(2),
    transfers,
    events,
    mode: currentMode,
    csrfToken: req.session.csrfToken,
    cookieInfo: { httpOnly: true, sameSite: 'Lax', secure: false, host: HOST }
  });
});

// Demo identity only: the lab intentionally omits real password authentication.
victim.post('/api/login', (req, res, next) => {
  const username = String(req.body.username || 'alice');
  if (username !== 'alice') {
    return res.status(400).json({ ok: false, error: 'Для этой лаборатории доступен только demo-пользователь Alice.' });
  }
  req.session.regenerate((err) => {
    if (err) return next(err);
    req.session.userId = 1;
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    req.session.save((saveErr) => {
      if (saveErr) return next(saveErr);
      res.json({ ok: true });
    });
  });
});

victim.post('/api/logout', requireLogin, (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('csrf_lab_sid', { httpOnly: true, sameSite: 'lax', secure: false });
    res.json({ ok: true });
  });
});

// Reset Alice's demo balance from the victim-site UI.
// Login and exact Origin checks keep the endpoint limited to the local victim app.
victim.post('/api/admin/reset-alice', requireLogin, (req, res) => {
  const origin = req.get('origin');

  if (origin !== VICTIM_ORIGIN) {
    return res.status(403).json({
      ok: false,
      error: 'Сброс баланса разрешён только из интерфейса victim-сайта.'
    });
  }

  try {
    const result = db.prepare(
      "UPDATE accounts SET balance = 1000 WHERE username = 'alice'"
    ).run();

    if (result.changes === 0) {
      return res.status(404).json({
        ok: false,
        error: 'Аккаунт Alice не найден.'
      });
    }

    return res.json({
      ok: true,
      username: 'alice',
      balance: 1000
    });
  } catch (error) {
    console.error('Failed to reset Alice balance:', error);

    return res.status(500).json({
      ok: false,
      error: 'Не удалось сбросить баланс.'
    });
  }
});

victim.post('/api/lab/mode', requireLogin, (req, res) => {
  const origin = req.get('origin');

  // Only the victim UI may change the lab's global protection mode.
  if (origin !== VICTIM_ORIGIN) {
    return res.status(403).json({
      ok: false,
      error: 'Изменение режима разрешено только из интерфейса victim-сайта.'
    });
  }

  const nextMode = String(req.body.mode || '');

  if (!VALID_MODES.has(nextMode)) {
    return res.status(400).json({
      ok: false,
      error: 'Неизвестный режим защиты.'
    });
  }

  currentMode = nextMode;
  res.json({ ok: true, mode: currentMode });
});

const performTransfer = db.transaction((senderId, recipientId, amount) => {
  const sender = db.prepare('SELECT balance FROM accounts WHERE id = ?').get(senderId);
  const recipient = db.prepare('SELECT id FROM accounts WHERE id = ?').get(recipientId);

  if (!sender || !recipient) throw new Error('Аккаунт не найден.');
  if (senderId === recipientId) throw new Error('Нельзя переводить деньги самому себе.');

  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 100) {
    throw new Error('Сумма должна быть целым числом от 1 до 100 demo-кредитов.');
  }

  if (sender.balance < amount) throw new Error('Недостаточно demo-кредитов.');

  db.prepare('UPDATE accounts SET balance = balance - ? WHERE id = ?')
    .run(amount, senderId);

  db.prepare('UPDATE accounts SET balance = balance + ? WHERE id = ?')
    .run(amount, recipientId);

  db.prepare(`
    INSERT INTO transfers (sender_id, recipient_id, amount, created_at)
    VALUES (?, ?, ?, ?)
  `).run(senderId, recipientId, amount, now());
});

victim.post('/api/transfer', requireLogin, (req, res) => {
  const origin = req.get('origin') || 'missing';
  const modeNeedsToken = currentMode === 'token' || currentMode === 'both';
  const modeNeedsOrigin = currentMode === 'origin' || currentMode === 'both';

  if (modeNeedsOrigin && origin !== VICTIM_ORIGIN) {
    addSecurityEvent({
      origin,
      outcome: 'blocked',
      reason: 'Origin не совпадает с origin victim-сайта.'
    });

    return res.status(403).json({
      ok: false,
      error: 'Заблокировано: проверка Origin не пройдена.'
    });
  }

  if (modeNeedsToken && !safeTokenEqual(req.body._csrf, req.session.csrfToken)) {
    addSecurityEvent({
      origin,
      outcome: 'blocked',
      reason: 'CSRF-токен отсутствует или неверен.'
    });

    return res.status(403).json({
      ok: false,
      error: 'Заблокировано: CSRF-токен отсутствует или неверен.'
    });
  }

  const recipientId = Number(req.body.recipientId);
  const amount = Number(req.body.amount);

  try {
    performTransfer(req.session.userId, recipientId, amount);

    addSecurityEvent({
      origin,
      outcome: 'accepted',
      reason: `Перевод ${amount} demo-кредитов принят.`
    });

    res.json({
      ok: true,
      message: `Перевод ${amount} demo-кредитов выполнен.`
    });
  } catch (error) {
    addSecurityEvent({
      origin,
      outcome: 'error',
      reason: error.message
    });

    res.status(400).json({
      ok: false,
      error: error.message
    });
  }
});

victim.use(express.static(path.join(__dirname, 'public-victim')));
victim.get('*path', (_req, res) =>
  res.sendFile(path.join(__dirname, 'public-victim', 'index.html'))
);

const attacker = express();
attacker.disable('x-powered-by');
attacker.use(express.static(path.join(__dirname, 'public-attacker')));
attacker.get('*path', (_req, res) =>
  res.sendFile(path.join(__dirname, 'public-attacker', 'index.html'))
);

const victimServer = victim.listen(VICTIM_PORT, HOST, () => {
  console.log(`Victim app:   ${VICTIM_ORIGIN}`);
});

const attackerServer = attacker.listen(ATTACKER_PORT, HOST, () => {
  console.log(`Attacker app: ${ATTACKER_ORIGIN}`);
  console.log('Loopback-only CSRF lab ready. Stop with Ctrl+C.');
});

function shutdown() {
  victimServer.close();
  attackerServer.close();
  db.close();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
