import { HttpError, apiError, json, nowIso, readJson, requiredString } from './http.js';

const COOKIE_NAME = 'str_ops_session';
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;
const ELEVATED_ROLES = ['dev', 'owner', 'manager'];

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function utf8(value) {
  return new TextEncoder().encode(value);
}

async function sha256(value) {
  return bytesToBase64Url(await crypto.subtle.digest('SHA-256', utf8(value)));
}

async function hmac(value, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    utf8(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return bytesToBase64Url(await crypto.subtle.sign('HMAC', key, utf8(value)));
}

function constantTimeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index++) {
    diff |= (left.charCodeAt(index % Math.max(left.length, 1)) || 0)
      ^ (right.charCodeAt(index % Math.max(right.length, 1)) || 0);
  }
  return diff === 0;
}

function sessionSecret(env) {
  if (!env.SESSION_SECRET || String(env.SESSION_SECRET).length < 24) {
    throw new HttpError(503, 'auth_not_configured', 'Session authentication is not configured.');
  }
  return String(env.SESSION_SECRET);
}

function cookieValue(request) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE_NAME) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function sessionCookie(value, maxAge = SESSION_SECONDS) {
  const expires = maxAge > 0
    ? new Date(Date.now() + maxAge * 1000).toUTCString()
    : new Date(0).toUTCString();
  return `${COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}; Expires=${expires}`;
}

async function makeSessionToken(env) {
  const nonce = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const issued = Date.now().toString(36);
  const unsigned = `${nonce}.${issued}`;
  return `${unsigned}.${await hmac(unsigned, sessionSecret(env))}`;
}

async function verifyTokenSignature(token, env) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return false;
  const unsigned = `${parts[0]}.${parts[1]}`;
  const expected = await hmac(unsigned, sessionSecret(env));
  return constantTimeEqual(parts[2], expected);
}

export async function hashPin(pin, salt, iterations = 120000) {
  const material = await crypto.subtle.importKey('raw', utf8(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: utf8(salt), iterations, hash: 'SHA-256' },
    material,
    256,
  );
  return bytesToBase64Url(bits);
}

export function publicUser(row) {
  return { id: row.id, name: row.name, role: row.role, color: row.color };
}

function requestIp(request) {
  return request.headers.get('cf-connecting-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || 'local';
}

async function failedLoginState(env, attemptKey) {
  return env.DB.prepare(
    'SELECT failed_count, window_started_ts, locked_until_ts FROM login_attempts WHERE attempt_key=?',
  ).bind(attemptKey).first();
}

async function recordFailure(env, attemptKey, existing) {
  const now = new Date();
  const windowStart = existing?.window_started_ts ? new Date(existing.window_started_ts) : now;
  const inWindow = now.getTime() - windowStart.getTime() < LOCK_MINUTES * 60 * 1000;
  const count = inWindow ? Number(existing?.failed_count || 0) + 1 : 1;
  const lockedUntil = count >= MAX_FAILURES
    ? new Date(now.getTime() + LOCK_MINUTES * 60 * 1000).toISOString()
    : null;
  await env.DB.prepare(
    `INSERT INTO login_attempts (attempt_key, failed_count, window_started_ts, locked_until_ts)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(attempt_key) DO UPDATE SET
       failed_count=excluded.failed_count,
       window_started_ts=excluded.window_started_ts,
       locked_until_ts=excluded.locked_until_ts`,
  ).bind(attemptKey, count, inWindow ? windowStart.toISOString() : now.toISOString(), lockedUntil).run();
  return lockedUntil;
}

export async function login(request, env) {
  const body = await readJson(request, 4096);
  const teamId = requiredString(body.teamId ?? body.userId, 'teamId', { max: 80 });
  const pin = requiredString(String(body.pin ?? ''), 'pin', { max: 8, pattern: /^\d{4,8}$/ });
  const attemptKey = await sha256(`${teamId}:${requestIp(request)}`);
  const state = await failedLoginState(env, attemptKey);
  if (state?.locked_until_ts && new Date(state.locked_until_ts) > new Date()) {
    return apiError(429, 'login_locked', 'Too many failed attempts. Try again in 15 minutes.', {
      'retry-after': String(LOCK_MINUTES * 60),
    });
  }

  const user = await env.DB.prepare(
    `SELECT id, name, role, color, pin_hash, pin_salt, pin_iterations
     FROM team WHERE id=? AND active=1`,
  ).bind(teamId).first();
  const computed = user
    ? await hashPin(pin, user.pin_salt, Number(user.pin_iterations))
    : await hashPin(pin, 'str-ops-missing-user', 120000);
  if (!user || !constantTimeEqual(computed, user.pin_hash)) {
    const lockedUntil = await recordFailure(env, attemptKey, state);
    return apiError(
      lockedUntil ? 429 : 401,
      lockedUntil ? 'login_locked' : 'invalid_credentials',
      lockedUntil ? 'Too many failed attempts. Try again in 15 minutes.' : 'The PIN was not accepted.',
    );
  }
  if (ELEVATED_ROLES.includes(user.role) && pin.length < 6) {
    return apiError(403, 'pin_upgrade_required', 'Elevated accounts require a 6-digit PIN.');
  }

  await env.DB.prepare('DELETE FROM login_attempts WHERE attempt_key=?').bind(attemptKey).run();
  const token = await makeSessionToken(env);
  const tokenHash = await sha256(token);
  const now = nowIso();
  const expires = new Date(Date.now() + SESSION_SECONDS * 1000).toISOString();
  await env.DB.prepare(
    'INSERT INTO sessions (token_hash, team_id, created_ts, expires_ts, last_seen_ts) VALUES (?, ?, ?, ?, ?)',
  ).bind(tokenHash, user.id, now, expires, now).run();
  return json({ ok: true, user: publicUser(user) }, 200, { 'set-cookie': sessionCookie(token) });
}

export async function logout(request, env) {
  const token = cookieValue(request);
  if (token) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await sha256(token)).run();
  }
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', 0) });
}

export async function getSessionUser(request, env) {
  const token = cookieValue(request);
  if (!token || !(await verifyTokenSignature(token, env))) return null;
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(
    `SELECT t.id, t.name, t.role, t.color, s.expires_ts
     FROM sessions s JOIN team t ON t.id=s.team_id
     WHERE s.token_hash=? AND t.active=1`,
  ).bind(tokenHash).first();
  if (!row || new Date(row.expires_ts) <= new Date()) {
    if (row) await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(tokenHash).run();
    return null;
  }
  const now = nowIso();
  await env.DB.prepare('UPDATE sessions SET last_seen_ts=? WHERE token_hash=?').bind(now, tokenHash).run();
  return { ...publicUser(row), sessionHash: tokenHash };
}

export async function requireUser(request, env) {
  const user = await getSessionUser(request, env);
  if (!user) throw new HttpError(401, 'authentication_required', 'Please sign in to continue.');
  return user;
}

export function requireManager(user) {
  if (!ELEVATED_ROLES.includes(user.role)) {
    throw new HttpError(403, 'forbidden', 'Leadership access is required.');
  }
}

export function requireOwner(user) {
  if (user.role !== 'owner') throw new HttpError(403, 'forbidden', 'Owner access is required.');
}
