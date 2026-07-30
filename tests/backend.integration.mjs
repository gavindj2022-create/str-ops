import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const wrangler = path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const port = 8791;
const base = `http://127.0.0.1:${port}`;

function runWrangler(args) {
  const result = spawnSync(process.execPath, [wrangler, ...args], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`wrangler ${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`);
  }
}

async function waitForServer(child) {
  const deadline = Date.now() + 30_000;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`wrangler exited early with ${child.exitCode}`);
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.status === 200) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`wrangler did not become ready: ${lastError || 'timeout'}`);
}

async function api(pathname, { method = 'GET', cookie, body, form } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers,
    body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  let payload = null;
  if (response.headers.get('content-type')?.includes('application/json')) payload = await response.json();
  return { response, payload };
}

function cookieFrom(response) {
  const value = response.headers.get('set-cookie');
  assert.ok(value, 'login should set a cookie');
  return value.split(';')[0];
}

runWrangler(['d1', 'migrations', 'apply', 'str-ops', '--local']);
runWrangler(['d1', 'execute', 'str-ops', '--local', '--file=seed/demo.sql']);
runWrangler([
  'd1',
  'execute',
  'str-ops',
  '--local',
  '--command=INSERT INTO team (id, name, role, pin_hash, pin_salt, pin_iterations, color, active) VALUES (\'test-worker\', \'Test Worker\', \'cleaner\', \'FpZQQcVgJOG-EXMgmLRQeUfA9G3N0nUNpQw4ZbOCO7g\', \'str-ops-integration-worker\', 120000, \'#7AA2F7\', 1) ON CONFLICT(id) DO UPDATE SET active=1, role=\'cleaner\', pin_hash=excluded.pin_hash, pin_salt=excluded.pin_salt',
]);
runWrangler([
  'd1',
  'execute',
  'str-ops',
  '--local',
  '--command=DELETE FROM turn_checks WHERE turn_id IN (\'demo-turn-hickory\', \'demo-turn-westgate\')',
]);

const child = spawn(process.execPath, [
  wrangler,
  'dev',
  '--local',
  '--port',
  String(port),
  '--var',
  'SESSION_SECRET:test-only-session-secret-32-characters',
], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});

let logs = '';
child.stdout.on('data', chunk => { logs += chunk; });
child.stderr.on('data', chunk => { logs += chunk; });
let photoWaterReadingId = null;

try {
  await waitForServer(child);

  const health = await api('/api/health');
  assert.equal(health.response.status, 200);
  assert.equal(health.payload.schemaVersion, 2);
  assert.equal(health.payload.database, true);

  const options = await api('/api/login-options');
  assert.equal(options.response.status, 200);
  assert.ok(options.payload.users.some(user => user.id === 'gav' && user.role === 'dev'));
  assert.ok(options.payload.users.some(user => user.id === 'gale' && user.role === 'owner'));
  assert.ok(options.payload.users.some(user => user.id === 'larry' && user.role === 'manager'));
  assert.ok(options.payload.users.some(user => user.id === 'anna' && user.role === 'owner'));
  assert.ok(options.payload.users.some(user => user.id === 'test-worker' && user.role === 'cleaner'));
  assert.equal(options.payload.users.some(user => ['maria', 'jess'].includes(user.id)), false);
  assert.equal(JSON.stringify(options.payload).toLowerCase().includes('pin'), false);

  const anonymousState = await api('/api/state');
  assert.equal(anonymousState.response.status, 401);
  assert.equal(anonymousState.payload.error.code, 'authentication_required');

  const managerLogin = await api('/api/login', {
    method: 'POST',
    body: { teamId: 'larry', pin: '246810' },
  });
  assert.equal(managerLogin.response.status, 200);
  assert.equal(managerLogin.payload.user.role, 'manager');
  const managerCookie = cookieFrom(managerLogin.response);

  const managerState = await api('/api/state', { cookie: managerCookie });
  assert.equal(managerState.response.status, 200);
  assert.equal(managerState.payload.schemaVersion, 2);
  assert.ok(managerState.payload.turns.length >= 5);
  assert.ok(managerState.payload.checklists.millpoint.some(item => item.role === 'laundry'));
  assert.ok(managerState.payload.checklists.westgate.some(item => item.role === 'water'));
  const chicagoToday = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const sameDayTurn = managerState.payload.turns.find(turn => turn.id === 'demo-turn-hickory');
  assert.equal(sameDayTurn.checkout, chicagoToday);
  assert.equal(sameDayTurn.checkinTime, '16:00');
  assert.ok(managerState.payload.financials.every(row => Number.isInteger(row.revenueCents)));
  assert.equal(JSON.stringify(managerState.payload).includes('pin_hash'), false);
  const alertTypes = new Set(managerState.payload.alerts.map(item => item.type));
  for (const expected of ['water_bad', 'maintenance', 'supply', 'task']) {
    assert.ok(alertTypes.has(expected), `missing ${expected} alert`);
  }

  const taskId = `integration-task-${Date.now()}`;
  const createdTask = await api('/api/tasks', {
    method: 'POST',
    cookie: managerCookie,
    body: {
      id: taskId,
      title: 'Integration test task',
      propertyId: 'westgate',
      dueDate: new Date().toISOString().slice(0, 10),
      priority: 'high',
    },
  });
  assert.equal(createdTask.response.status, 201);
  assert.equal(createdTask.payload.priority, 'high');

  const completedTask = await api(`/api/tasks/${taskId}`, {
    method: 'PATCH',
    cookie: managerCookie,
    body: { status: 'done' },
  });
  assert.equal(completedTask.response.status, 200);
  assert.equal(completedTask.payload.done, true);

  const reading = await api('/api/water', {
    method: 'POST',
    cookie: managerCookie,
    body: {
      assetId: 'westgate-pool',
      freeChlorine: 2.6,
      totalChlorine: 3,
      ph: 7.4,
      alk: 100,
      hardness: 250,
      cyanuricAcid: 50,
      salt: 3000,
      pressurePsi: 18,
      waterLevel: 'slightly_above',
      note: 'Integration pool check',
    },
  });
  assert.equal(reading.response.status, 201);
  assert.equal(reading.payload.assetId, 'westgate-pool');
  assert.equal(reading.payload.freeChlorine, 2.6);
  assert.equal(reading.payload.chlorine, 2.6);
  assert.equal(reading.payload.pressurePsi, 18);
  assert.equal(reading.payload.waterLevel, 'slightly_above');
  assert.equal(reading.payload.cyanuricAcid, 50);

  const turnBefore = managerState.payload.turns.find(turn => turn.id === 'demo-turn-westgate');
  const patchedTurn = await api('/api/turns/demo-turn-westgate', {
    method: 'PATCH',
    cookie: managerCookie,
    body: { status: 'in_progress', startedAt: true },
  });
  assert.equal(patchedTurn.response.status, 200);
  assert.equal(patchedTurn.payload.status, 'in_progress');

  const cleanerLogin = await api('/api/login', {
    method: 'POST',
    body: { teamId: 'test-worker', pin: '3333' },
  });
  assert.equal(cleanerLogin.response.status, 200);
  const cleanerCookie = cookieFrom(cleanerLogin.response);
  const cleanerState = await api('/api/state', { cookie: cleanerCookie });
  assert.equal(cleanerState.response.status, 200);
  assert.deepEqual(cleanerState.payload.financials, []);
  assert.deepEqual(cleanerState.payload.tasks, []);
  assert.deepEqual(cleanerState.payload.goals, []);
  assert.deepEqual(cleanerState.payload.alerts, []);

  const cleanerForbidden = await api('/api/tasks', { cookie: cleanerCookie });
  assert.equal(cleanerForbidden.response.status, 403);
  assert.equal(cleanerForbidden.payload.error.code, 'forbidden');

  const checklistBeforeClaim = await api('/api/turns/demo-turn-hickory/checks/0', {
    method: 'PUT',
    cookie: cleanerCookie,
    body: { checked: true },
  });
  assert.equal(checklistBeforeClaim.response.status, 403);

  const legacyBrokenClaim = await api('/api/turns/demo-turn-hickory', {
    method: 'PATCH',
    cookie: cleanerCookie,
    body: { assigned: 'test-worker', status: 'in_progress' },
  });
  assert.equal(legacyBrokenClaim.response.status, 403);

  const cleanerClaim = await api('/api/turns/demo-turn-hickory', {
    method: 'PATCH',
    cookie: cleanerCookie,
    body: { status: 'in_progress', startedAt: true },
  });
  assert.equal(cleanerClaim.response.status, 200);
  assert.equal(cleanerClaim.payload.assigned, 'test-worker');
  assert.ok(cleanerClaim.payload.startedAt);

  const plainCheck = await api('/api/turns/demo-turn-hickory/checks/0', {
    method: 'PUT',
    cookie: cleanerCookie,
    body: { checked: true },
  });
  assert.equal(plainCheck.response.status, 200);
  assert.equal(plainCheck.payload.done, true);
  assert.equal(plainCheck.payload.photoKey, null);

  const plainUncheck = await api('/api/turns/demo-turn-hickory/checks/0', {
    method: 'PUT',
    cookie: cleanerCookie,
    body: { checked: false },
  });
  assert.equal(plainUncheck.response.status, 200);
  assert.equal(plainUncheck.payload.done, false);
  assert.equal(plainUncheck.payload.photoKey, null);

  const prematureDone = await api('/api/turns/demo-turn-hickory', {
    method: 'PATCH',
    cookie: cleanerCookie,
    body: { status: 'done', completedAt: true },
  });
  assert.equal(prematureDone.response.status, 409);
  assert.equal(prematureDone.payload.error.code, 'turn_not_ready');

  const fakePhoto = await api('/api/turns/demo-turn-hickory/checks/0', {
    method: 'PUT',
    cookie: cleanerCookie,
    body: { checked: true, photoKey: 'private/not-real.png' },
  });
  assert.equal(fakePhoto.response.status, 404);

  const photoForm = new FormData();
  photoForm.append('file', new Blob(['integration-photo'], { type: 'image/png' }), 'integration.png');
  const uploadedPhoto = await api('/api/photos', {
    method: 'POST',
    cookie: cleanerCookie,
    form: photoForm,
  });
  assert.equal(uploadedPhoto.response.status, 201);
  assert.match(uploadedPhoto.payload.key, /^private\//);

  const photoWaterReading = await api('/api/water', {
    method: 'POST',
    cookie: cleanerCookie,
    body: {
      assetId: 'hickory-pool',
      chlorine: 2.4,
      ph: 7.4,
      alk: 95,
      pressurePsi: 17,
      waterLevel: 'on_arrow',
      note: 'Photo test log',
      photoKey: uploadedPhoto.payload.key,
      pressurePhotoKey: uploadedPhoto.payload.key,
      levelPhotoKey: uploadedPhoto.payload.key,
    },
  });
  assert.equal(photoWaterReading.response.status, 201);
  assert.equal(photoWaterReading.payload.photoKey, uploadedPhoto.payload.key);
  assert.equal(photoWaterReading.payload.pressurePhotoKey, uploadedPhoto.payload.key);
  assert.equal(photoWaterReading.payload.levelPhotoKey, uploadedPhoto.payload.key);
  photoWaterReadingId = photoWaterReading.payload.id;

  const verifiedCheck = await api('/api/turns/demo-turn-hickory/checks/0', {
    method: 'PUT',
    cookie: cleanerCookie,
    body: { checked: true, photoKey: uploadedPhoto.payload.key },
  });
  assert.equal(verifiedCheck.response.status, 200);
  assert.equal(verifiedCheck.payload.photoKey, uploadedPhoto.payload.key);

  const hickoryTemplate = cleanerState.payload.checklists.hickory;
  for (const itemIdx of Array.from({ length: hickoryTemplate.length - 1 }, (_, offset) => offset + 1)) {
    const completedCheck = await api(`/api/turns/demo-turn-hickory/checks/${itemIdx}`, {
      method: 'PUT',
      cookie: cleanerCookie,
      body: { checked: true, photoKey: uploadedPhoto.payload.key },
    });
    assert.equal(completedCheck.response.status, 200);
  }

  const completedTurn = await api('/api/turns/demo-turn-hickory', {
    method: 'PATCH',
    cookie: cleanerCookie,
    body: { status: 'done', completedAt: true },
  });
  assert.equal(completedTurn.response.status, 200);
  assert.equal(completedTurn.payload.status, 'done');

  const deletePhoto = await api(`/api/photos/${uploadedPhoto.payload.key}`, {
    method: 'DELETE',
    cookie: managerCookie,
  });
  assert.equal(deletePhoto.response.status, 200);

  const reopenAfterPhotoDelete = await api('/api/turns/demo-turn-hickory', {
    method: 'PATCH',
    cookie: managerCookie,
    body: { status: 'in_progress', completedAt: null },
  });
  assert.equal(reopenAfterPhotoDelete.response.status, 200);

  const deletedPhotoBlocksDone = await api('/api/turns/demo-turn-hickory', {
    method: 'PATCH',
    cookie: managerCookie,
    body: { status: 'done', completedAt: true },
  });
  assert.equal(deletedPhotoBlocksDone.response.status, 409);
  assert.equal(deletedPhotoBlocksDone.payload.error.code, 'turn_not_ready');

  await api(`/api/tasks/${taskId}`, { method: 'DELETE', cookie: managerCookie });
  await api(`/api/water/${reading.payload.id}`, { method: 'DELETE', cookie: managerCookie });
  if (photoWaterReadingId) await api(`/api/water/${photoWaterReadingId}`, { method: 'DELETE', cookie: managerCookie });
  await api('/api/turns/demo-turn-westgate', {
    method: 'PATCH',
    cookie: managerCookie,
    body: {
      status: turnBefore.status,
      startedAt: turnBefore.startedAt,
      completedAt: turnBefore.completedAt,
    },
  });

  console.log('Backend integration test passed: auth, roles, CRUD, claim, ready gate, photos, water, and alerts.');
} catch (error) {
  console.error(logs);
  throw error;
} finally {
  child.kill('SIGTERM');
  await Promise.race([
    once(child, 'exit'),
    new Promise(resolve => setTimeout(resolve, 3000)),
  ]);
  runWrangler([
    'd1',
    'execute',
    'str-ops',
    '--local',
    '--command=DELETE FROM turn_checks WHERE turn_id=\'demo-turn-hickory\'; UPDATE turns SET status=\'needs_cleaning\', assigned_to=NULL, started_at=NULL, completed_at=NULL WHERE id=\'demo-turn-hickory\'; DELETE FROM team WHERE id=\'test-worker\'',
  ]);
}
