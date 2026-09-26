#!/usr/bin/env node

const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const { randomUUID } = require('crypto');
const { existsSync } = require('fs');
const { resolve } = require('path');
const readline = require('readline');

require('dotenv').config({ quiet: true });

function readArg(name) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((item) => item.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
}

function readRequired(name, envName) {
  const value = readArg(name) || process.env[envName];
  if (!value || !String(value).trim()) {
    throw new Error(`Missing ${envName}. Pass --${name}=... or set ${envName}.`);
  }
  return String(value).trim();
}

function hasArg(name) {
  return process.argv.some((item) => item === `--${name}` || item.startsWith(`--${name}=`));
}

function questionHidden(prompt) {
  return new Promise((resolveQuestion) => {
    const input = process.stdin;
    const output = process.stdout;
    const rl = readline.createInterface({ input, output });
    const wasRaw = input.isTTY && input.isRaw;

    output.write(prompt);
    if (input.isTTY) {
      input.setRawMode(true);
    }

    let value = '';
    const onData = (char) => {
      const text = char.toString('utf8');

      if (text === '\r' || text === '\n' || text === '\u0004') {
        output.write('\n');
        if (input.isTTY) {
          input.setRawMode(Boolean(wasRaw));
        }
        input.removeListener('data', onData);
        rl.close();
        resolveQuestion(value);
        return;
      }

      if (text === '\u0003') {
        output.write('\n');
        process.exit(130);
      }

      if (text === '\b' || text === '\u007f') {
        value = value.slice(0, -1);
        return;
      }

      value += text;
    };

    input.on('data', onData);
  });
}

async function readPassword() {
  if (hasArg('password')) {
    throw new Error('Do not pass passwords on the command line. Use the hidden prompt or ADMIN_PASSWORD.');
  }

  if (process.env.ADMIN_PASSWORD) {
    return process.env.ADMIN_PASSWORD;
  }

  if (!process.stdin.isTTY) {
    throw new Error('Missing ADMIN_PASSWORD. Interactive password prompt requires a TTY.');
  }

  const password = await questionHidden('New admin password: ');
  const confirmation = await questionHidden('Confirm admin password: ');
  if (password !== confirmation) {
    throw new Error('Passwords do not match.');
  }
  return password;
}

function readDatabasePath() {
  const configuredPath = readArg('db') || process.env.DATABASE_PATH;
  if (configuredPath && configuredPath.trim()) {
    return resolve(configuredPath.trim());
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('DATABASE_PATH must be set in production.');
  }
  return resolve('./prisma/dev.db');
}

function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

function generateId(prefix) {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

async function main() {
  const email = normalizeEmail(readRequired('email', 'ADMIN_EMAIL'));
  const password = await readPassword();
  const name = readArg('name') || process.env.ADMIN_NAME || '管理员';
  const dbPath = readDatabasePath();

  if (password.length < 8) {
    throw new Error('ADMIN_PASSWORD must be at least 8 characters.');
  }

  if (!existsSync(dbPath)) {
    throw new Error(`Database not found: ${dbPath}`);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const db = new Database(dbPath);
  const now = new Date().toISOString();

  const existing = db
    .prepare('SELECT id, role FROM User WHERE lower(email) = lower(?)')
    .get(email);

  if (existing) {
    db.prepare(
      `UPDATE User
       SET email = ?, name = COALESCE(name, ?), password = ?, role = 'admin', updatedAt = ?
       WHERE id = ?`
    ).run(email, name, passwordHash, now, existing.id);
    console.log(`Updated admin password for ${email} (${existing.id}).`);
  } else {
    const id = generateId('usr');
    db.prepare(
      `INSERT INTO User (id, email, name, password, role, points, tier, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, 'admin', 0, '璞玉', ?, ?)`
    ).run(id, email, name, passwordHash, now, now);
    console.log(`Created admin user ${email} (${id}).`);
  }

  db.close();
}

main().catch((error) => {
  console.error(`[set-admin-password] ${error.message}`);
  process.exit(1);
});
