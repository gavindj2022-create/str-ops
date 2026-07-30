import {
  apiError,
  assertSameOrigin,
  finiteNumber,
  handleError,
  HttpError,
  integer,
  json,
  methodNotAllowed,
  newId,
  nowIso,
  oneOf,
  optionalString,
  readJson,
  requiredString,
} from './http.js';
import {
  getSessionUser,
  login,
  logout,
  publicUser,
  requireManager,
  requireUser,
} from './auth.js';
import { computeAlerts } from './alerts.js';
import { FEEDS, syncAll } from './ical.js';
import {
  mapBooking,
  mapChecklistTemplate,
  mapFinancial,
  mapGoal,
  mapProperty,
  mapReading,
  mapSupply,
  mapTask,
  mapTeam,
  mapTicket,
  mapTurn,
  mapTurnCheck,
  mapWaterAsset,
} from './mappers.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const STATUSES = ['needs_cleaning', 'in_progress', 'ready', 'done'];
const WATER_LEVELS = ['low', 'on_arrow', 'slightly_above', 'high'];

async function all(env, sql, ...bindings) {
  const result = await env.DB.prepare(sql).bind(...bindings).all();
  return result.results || [];
}

async function firstOr404(env, sql, bindings, label = 'Record') {
  const row = await env.DB.prepare(sql).bind(...bindings).first();
  if (!row) throw new HttpError(404, 'not_found', `${label} was not found.`);
  return row;
}

async function audit(env, user, action, entityType, entityId, detail = null) {
  await env.DB.prepare(
    `INSERT INTO audit_log
      (id, actor_id, action, entity_type, entity_id, detail_json, created_ts)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    newId('audit'),
    user?.id || null,
    action,
    entityType,
    entityId || null,
    detail ? JSON.stringify(detail) : null,
    nowIso(),
  ).run();
}

function routeParts(pathname) {
  return pathname.split('/').filter(Boolean).map(part => decodeURIComponent(part));
}

function dateValue(value, field, allowNull = true) {
  const parsed = optionalString(value, field, { max: 10, pattern: DATE });
  if (!allowNull && parsed === null) throw new HttpError(400, 'validation_error', `${field} is required.`);
  return parsed;
}

function timestampValue(value, field) {
  if (value === true) return nowIso();
  const parsed = optionalString(value, field, { max: 40 });
  if (parsed && Number.isNaN(Date.parse(parsed))) {
    throw new HttpError(400, 'validation_error', `${field} must be an ISO timestamp.`);
  }
  return parsed;
}

function manager(user) {
  return ['dev', 'owner', 'manager'].includes(user.role);
}

function optionalFinite(value, field, options = {}) {
  if (value === undefined || value === null || value === '') return null;
  return finiteNumber(value, field, options);
}

async function assertPhotoAllowed(env, user, key, label = 'Photo') {
  if (!key) return;
  const photo = await firstOr404(
    env,
    'SELECT object_key, uploaded_by FROM photo_objects WHERE object_key=?',
    [key],
    label,
  );
  if (!manager(user) && photo.uploaded_by !== user.id) {
    throw new HttpError(403, 'forbidden', `That ${label.toLowerCase()} belongs to another team member.`);
  }
}

async function stateResponse(env, user) {
  const [
    propertyRows,
    assetRows,
    templateRows,
    teamRows,
    turnRows,
    readingRows,
    checkRows,
    ticketRows,
    financeRows,
    taskRows,
    goalRows,
    supplyRows,
    bookingRows,
  ] = await Promise.all([
    all(env, 'SELECT * FROM properties ORDER BY name'),
    all(env, 'SELECT * FROM water_assets ORDER BY property_id, name'),
    all(env, 'SELECT * FROM checklist_templates ORDER BY property_id'),
    all(env, 'SELECT id, name, role, color FROM team WHERE active=1 ORDER BY name'),
    all(env, 'SELECT * FROM turns ORDER BY checkout_date, property_id'),
    all(env, 'SELECT * FROM water_readings ORDER BY ts DESC LIMIT 500'),
    all(env, 'SELECT * FROM turn_checks ORDER BY turn_id, item_idx'),
    all(env, 'SELECT * FROM maintenance_tickets ORDER BY opened_ts DESC'),
    manager(user) ? all(env, 'SELECT * FROM financials ORDER BY month DESC, property_id') : [],
    manager(user) ? all(env, 'SELECT * FROM owner_tasks ORDER BY done, due_date, created_ts') : [],
    manager(user) ? all(env, 'SELECT * FROM goals ORDER BY status, deadline') : [],
    all(env, 'SELECT * FROM supplies ORDER BY property_id, name'),
    manager(user)
      ? all(env, 'SELECT * FROM bookings WHERE active=1 ORDER BY start_date, property_id')
      : [],
  ]);

  const templates = templateRows.map(mapChecklistTemplate);
  const checklists = Object.fromEntries(templates.map(template => [template.propertyId, template.items]));
  const checks = {};
  const photos = {};
  for (const row of checkRows) {
    checks[row.turn_id] ||= {};
    checks[row.turn_id][row.item_idx] = Boolean(Number(row.done));
    if (row.photo_key) {
      photos[row.turn_id] ||= {};
      photos[row.turn_id][row.item_idx] = row.photo_key;
    }
  }
  const tasks = taskRows.map(mapTask);
  return {
    schemaVersion: 2,
    user: publicUser(user),
    properties: propertyRows.map(mapProperty),
    waterAssets: assetRows.map(mapWaterAsset),
    checklists,
    checklistTemplates: templates,
    team: teamRows.map(mapTeam),
    turns: turnRows.map(mapTurn),
    readings: readingRows.map(mapReading),
    checks,
    photos,
    turnChecks: checkRows.map(mapTurnCheck),
    tickets: ticketRows.map(mapTicket),
    financials: financeRows.map(mapFinancial),
    tasks,
    ownerTasks: tasks,
    goals: goalRows.map(mapGoal),
    supplies: supplyRows.map(mapSupply),
    bookings: bookingRows.map(mapBooking),
    alerts: manager(user) ? await computeAlerts(env) : [],
  };
}

async function loginOptions(env) {
  const users = (await all(
    env,
    'SELECT id, name, role, color FROM team WHERE active=1 ORDER BY name',
  )).map(mapTeam);
  return json({ users, team: users });
}

async function health(env) {
  let database = false;
  try {
    const result = await env.DB.prepare('SELECT 1 AS ok').first();
    database = Number(result?.ok) === 1;
  } catch {
    database = false;
  }
  const configuredFeeds = Object.values(FEEDS).flat().filter(name => Boolean(env[name])).length;
  return json({
    ok: database,
    schemaVersion: 2,
    database,
    assets: Boolean(env.ASSETS),
    photos: Boolean(env.PHOTOS),
    configuredFeeds,
    timeZone: env.APP_TIMEZONE || 'America/Chicago',
  }, database ? 200 : 503);
}

async function assertTurnReady(env, turn) {
  const templateRow = await firstOr404(
    env,
    'SELECT * FROM checklist_templates WHERE property_id=?',
    [turn.property_id],
    'Checklist template',
  );
  const items = mapChecklistTemplate(templateRow).items;
  const rows = await all(
    env,
    `SELECT turn_checks.item_idx, turn_checks.done, turn_checks.photo_key,
            photo_objects.object_key AS stored_photo_key
     FROM turn_checks
     LEFT JOIN photo_objects ON photo_objects.object_key=turn_checks.photo_key
     WHERE turn_checks.turn_id=?`,
    turn.id,
  );
  const checks = new Map(rows.map(row => [Number(row.item_idx), row]));
  const unchecked = items.filter((_, index) => !Number(checks.get(index)?.done)).length;
  const missingPhotos = items.filter(
    (item, index) => item.photo === 'required' && !checks.get(index)?.stored_photo_key,
  ).length;
  if (unchecked || missingPhotos) {
    const parts = [];
    if (unchecked) parts.push(`${unchecked} checklist item${unchecked === 1 ? '' : 's'}`);
    if (missingPhotos) {
      parts.push(`${missingPhotos} required verification photo${missingPhotos === 1 ? '' : 's'}`);
    }
    throw new HttpError(
      409,
      'turn_not_ready',
      `Turn cannot be completed: ${parts.join(' and ')} remaining.`,
    );
  }
}

async function handleTurns(request, env, user, parts) {
  const id = parts[2];
  if (!id) {
    if (request.method === 'GET') {
      return json((await all(env, 'SELECT * FROM turns ORDER BY checkout_date, property_id')).map(mapTurn));
    }
    if (request.method === 'POST') {
      requireManager(user);
      const body = await readJson(request);
      const turnId = optionalString(body.id, 'id', { max: 120 }) || newId('turn');
      const propertyId = requiredString(body.propertyId, 'propertyId', { max: 80 });
      const checkout = requiredString(body.checkout || body.checkoutDate, 'checkout', { max: 10, pattern: DATE });
      const checkin = dateValue(body.checkin ?? body.checkinDate, 'checkin') ?? null;
      const checkoutTime = optionalString(body.checkoutTime, 'checkoutTime', { max: 5, pattern: TIME }) || '11:00';
      const checkinTime = optionalString(body.checkinTime || body.readyBy, 'checkinTime', { max: 5, pattern: TIME }) || '16:00';
      const status = body.status === undefined ? 'needs_cleaning' : oneOf(body.status, 'status', STATUSES);
      const assignedTo = optionalString(body.assignedTo ?? body.assigned, 'assignedTo', { max: 80 }) ?? null;
      await env.DB.prepare(
        `INSERT INTO turns
          (id, property_id, checkout_date, checkin_date, checkout_time, checkin_time,
           same_day, status, assigned_to, source, updated_ts)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?)`,
      ).bind(
        turnId,
        propertyId,
        checkout,
        checkin,
        checkoutTime,
        checkinTime,
        Number(checkout === checkin),
        status,
        assignedTo,
        nowIso(),
      ).run();
      await audit(env, user, 'create', 'turn', turnId);
      return json(mapTurn(await firstOr404(env, 'SELECT * FROM turns WHERE id=?', [turnId], 'Turn')), 201);
    }
    return methodNotAllowed(['GET', 'POST']);
  }

  if (parts[3] === 'checks') return handleTurnChecks(request, env, user, id, parts[4]);
  if (request.method === 'GET') {
    return json(mapTurn(await firstOr404(env, 'SELECT * FROM turns WHERE id=?', [id], 'Turn')));
  }
  if (request.method !== 'PATCH') return methodNotAllowed(['GET', 'PATCH']);

  const current = await firstOr404(env, 'SELECT * FROM turns WHERE id=?', [id], 'Turn');
  const body = await readJson(request);
  if (!manager(user)) {
    const claiming = !current.assigned_to && body.startedAt;
    if (current.assigned_to !== user.id && !claiming) {
      throw new HttpError(403, 'forbidden', 'Workers can update only their assigned turn.');
    }
    const forbidden = Object.keys(body).some(key =>
      !['status', 'startedAt', 'completedAt'].includes(key),
    );
    if (forbidden) throw new HttpError(403, 'forbidden', 'That turn field requires manager access.');
    if (body.status !== undefined && !['in_progress', 'ready', 'done'].includes(body.status)) {
      throw new HttpError(403, 'forbidden', 'Workers cannot move a turn back to that status.');
    }
  }
  if (body.status === 'done') await assertTurnReady(env, current);

  const updates = [];
  const bindings = [];
  const set = (column, value) => {
    updates.push(`${column}=?`);
    bindings.push(value);
  };
  if (body.status !== undefined) set('status', oneOf(body.status, 'status', STATUSES));
  if (manager(user) && (body.assignedTo !== undefined || body.assigned !== undefined)) {
    set('assigned_to', optionalString(body.assignedTo ?? body.assigned, 'assignedTo', { max: 80 }));
  } else if (!manager(user) && !current.assigned_to && body.startedAt) {
    set('assigned_to', user.id);
  }
  if (body.startedAt !== undefined) set('started_at', timestampValue(body.startedAt, 'startedAt'));
  if (body.completedAt !== undefined) set('completed_at', timestampValue(body.completedAt, 'completedAt'));
  if (manager(user) && (body.checkout !== undefined || body.checkoutDate !== undefined)) {
    set('checkout_date', requiredString(body.checkout ?? body.checkoutDate, 'checkout', { max: 10, pattern: DATE }));
  }
  if (manager(user) && (body.checkin !== undefined || body.checkinDate !== undefined)) {
    set('checkin_date', dateValue(body.checkin ?? body.checkinDate, 'checkin'));
  }
  if (manager(user) && body.checkoutTime !== undefined) {
    set('checkout_time', optionalString(body.checkoutTime, 'checkoutTime', { max: 5, pattern: TIME }));
  }
  if (manager(user) && (body.checkinTime !== undefined || body.readyBy !== undefined)) {
    set('checkin_time', optionalString(body.checkinTime ?? body.readyBy, 'checkinTime', { max: 5, pattern: TIME }));
  }
  if (manager(user) && (
    body.checkout !== undefined ||
    body.checkoutDate !== undefined ||
    body.checkin !== undefined ||
    body.checkinDate !== undefined
  )) {
    const checkout = body.checkout ?? body.checkoutDate ?? current.checkout_date;
    const checkin = body.checkin ?? body.checkinDate ?? current.checkin_date;
    set('same_day', Number(Boolean(checkout && checkin && checkout === checkin)));
  }
  if (!updates.length) throw new HttpError(400, 'validation_error', 'No supported turn fields were provided.');
  set('updated_ts', nowIso());
  await env.DB.prepare(`UPDATE turns SET ${updates.join(', ')} WHERE id=?`).bind(...bindings, id).run();
  await audit(env, user, 'update', 'turn', id, body);
  return json(mapTurn(await firstOr404(env, 'SELECT * FROM turns WHERE id=?', [id], 'Turn')));
}

async function handleTurnChecks(request, env, user, turnId, rawIndex) {
  const turn = await firstOr404(env, 'SELECT * FROM turns WHERE id=?', [turnId], 'Turn');
  if (rawIndex === undefined) {
    if (request.method !== 'GET') return methodNotAllowed(['GET']);
    return json((await all(
      env,
      'SELECT * FROM turn_checks WHERE turn_id=? ORDER BY item_idx',
      turnId,
    )).map(mapTurnCheck));
  }
  if (request.method !== 'PUT') return methodNotAllowed(['PUT']);
  if (!manager(user) && turn.assigned_to !== user.id) {
    throw new HttpError(403, 'forbidden', 'This checklist belongs to another worker.');
  }
  const itemIdx = integer(rawIndex, 'itemIdx', { min: 0, max: 500 });
  const body = await readJson(request);
  const done = body.done === true || body.done === 1 || body.checked === true ? 1 : 0;
  const photoKey = optionalString(body.photoKey, 'photoKey', { max: 500 }) ?? null;
  if (photoKey) {
    const photo = await firstOr404(
      env,
      'SELECT object_key, uploaded_by FROM photo_objects WHERE object_key=?',
      [photoKey],
      'Verification photo',
    );
    if (!manager(user) && photo.uploaded_by !== user.id) {
      throw new HttpError(403, 'forbidden', 'That verification photo belongs to another team member.');
    }
  }
  const updatedTs = nowIso();
  await env.DB.prepare(
    `INSERT INTO turn_checks (turn_id, item_idx, done, photo_key, updated_by, updated_ts)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(turn_id, item_idx) DO UPDATE SET
       done=excluded.done, photo_key=COALESCE(excluded.photo_key, turn_checks.photo_key),
       updated_by=excluded.updated_by, updated_ts=excluded.updated_ts`,
  ).bind(turnId, itemIdx, done, photoKey, user.id, updatedTs).run();
  await audit(env, user, 'update', 'turn_check', `${turnId}:${itemIdx}`, { done, photoKey });
  const row = await firstOr404(
    env,
    'SELECT * FROM turn_checks WHERE turn_id=? AND item_idx=?',
    [turnId, itemIdx],
    'Checklist item',
  );
  return json(mapTurnCheck(row));
}

async function handleWater(request, env, user, parts) {
  const id = parts[2];
  if (!id && request.method === 'GET') {
    return json((await all(env, 'SELECT * FROM water_readings ORDER BY ts DESC LIMIT 500')).map(mapReading));
  }
  if (!id && request.method === 'POST') {
    const body = await readJson(request);
    const readingId = newId('reading');
    const assetId = requiredString(body.assetId, 'assetId', { max: 100 });
    const freeChlorine = finiteNumber(body.freeChlorine ?? body.chlorine, 'freeChlorine', { min: 0, max: 20 });
    const chlorine = freeChlorine;
    const totalChlorine = optionalFinite(body.totalChlorine, 'totalChlorine', { min: 0, max: 20 });
    const ph = finiteNumber(body.ph, 'ph', { min: 0, max: 14 });
    const alk = finiteNumber(body.alk, 'alk', { min: 0, max: 500 });
    const hardness = optionalFinite(body.hardness, 'hardness', { min: 0, max: 1000 });
    const cyanuricAcid = optionalFinite(body.cyanuricAcid ?? body.cya, 'cyanuricAcid', { min: 0, max: 300 });
    const salt = optionalFinite(body.salt, 'salt', { min: 0, max: 10000 });
    const pressurePsi = optionalFinite(body.pressurePsi, 'pressurePsi', { min: 0, max: 80 });
    const waterLevel = body.waterLevel === undefined || body.waterLevel === null || body.waterLevel === ''
      ? null
      : oneOf(body.waterLevel, 'waterLevel', WATER_LEVELS);
    const note = optionalString(body.note, 'note', { max: 2000 }) ?? null;
    const photoKey = optionalString(body.photoKey, 'photoKey', { max: 500 }) ?? null;
    const pressurePhotoKey = optionalString(body.pressurePhotoKey, 'pressurePhotoKey', { max: 500 }) ?? null;
    const levelPhotoKey = optionalString(body.levelPhotoKey, 'levelPhotoKey', { max: 500 }) ?? null;
    await assertPhotoAllowed(env, user, photoKey, 'Water-test photo');
    await assertPhotoAllowed(env, user, pressurePhotoKey, 'Pressure photo');
    await assertPhotoAllowed(env, user, levelPhotoKey, 'Water-level photo');
    await env.DB.prepare(
      `INSERT INTO water_readings
        (id, asset_id, ts, chlorine, free_chlorine, total_chlorine, ph, alk, hardness,
         cyanuric_acid, salt, pressure_psi, water_level, note, photo_key,
         pressure_photo_key, level_photo_key, logged_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      readingId,
      assetId,
      nowIso(),
      chlorine,
      freeChlorine,
      totalChlorine,
      ph,
      alk,
      hardness,
      cyanuricAcid,
      salt,
      pressurePsi,
      waterLevel,
      note,
      photoKey,
      pressurePhotoKey,
      levelPhotoKey,
      user.id,
    ).run();
    await audit(env, user, 'create', 'water_reading', readingId);
    return json(mapReading(await firstOr404(
      env,
      'SELECT * FROM water_readings WHERE id=?',
      [readingId],
      'Water reading',
    )), 201);
  }
  if (id && request.method === 'DELETE') {
    requireManager(user);
    await firstOr404(env, 'SELECT id FROM water_readings WHERE id=?', [id], 'Water reading');
    await env.DB.prepare('DELETE FROM water_readings WHERE id=?').bind(id).run();
    await audit(env, user, 'delete', 'water_reading', id);
    return json({ ok: true });
  }
  return methodNotAllowed(id ? ['DELETE'] : ['GET', 'POST']);
}

function cents(body, key, fallbackKey) {
  const value = body[key] ?? body[fallbackKey];
  return integer(value ?? 0, key, { min: 0, max: 1_000_000_000 });
}

async function handleFinancials(request, env, user, parts, url) {
  requireManager(user);
  const id = parts[2];
  if (!id && request.method === 'GET') {
    const where = [];
    const bindings = [];
    if (url.searchParams.get('month')) {
      where.push('month=?');
      bindings.push(requiredString(url.searchParams.get('month'), 'month', { max: 7, pattern: MONTH }));
    }
    if (url.searchParams.get('propertyId')) {
      where.push('property_id=?');
      bindings.push(requiredString(url.searchParams.get('propertyId'), 'propertyId', { max: 80 }));
    }
    const sql = `SELECT * FROM financials ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY month DESC, property_id`;
    return json((await all(env, sql, ...bindings)).map(mapFinancial));
  }
  if (!id && request.method === 'POST') {
    const body = await readJson(request);
    const propertyId = requiredString(body.propertyId, 'propertyId', { max: 80 });
    const month = requiredString(body.month, 'month', { max: 7, pattern: MONTH });
    const financeId = optionalString(body.id, 'id', { max: 100 }) || newId('finance');
    await env.DB.prepare(
      `INSERT INTO financials
        (id, property_id, month, revenue_cents, expenses_cents, cleaning_cost_cents, note)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(property_id, month) DO UPDATE SET
         revenue_cents=excluded.revenue_cents, expenses_cents=excluded.expenses_cents,
         cleaning_cost_cents=excluded.cleaning_cost_cents, note=excluded.note`,
    ).bind(
      financeId,
      propertyId,
      month,
      cents(body, 'revenueCents', 'revenue'),
      cents(body, 'expensesCents', 'expenses'),
      cents(body, 'cleaningCostCents', 'cleanerPayoutCents'),
      optionalString(body.note, 'note', { max: 2000 }) ?? null,
    ).run();
    const row = await firstOr404(
      env,
      'SELECT * FROM financials WHERE property_id=? AND month=?',
      [propertyId, month],
      'Financial row',
    );
    await audit(env, user, 'upsert', 'financial', row.id);
    return json(mapFinancial(row), 201);
  }
  const bodyId = !id && request.method === 'PATCH' ? (await readJson(request)).id : id;
  if (id && request.method === 'PATCH') {
    const body = await readJson(request);
    await firstOr404(env, 'SELECT id FROM financials WHERE id=?', [id], 'Financial row');
    const updates = [];
    const bindings = [];
    for (const [input, column] of [
      ['revenueCents', 'revenue_cents'],
      ['expensesCents', 'expenses_cents'],
      ['cleaningCostCents', 'cleaning_cost_cents'],
      ['cleanerPayoutCents', 'cleaning_cost_cents'],
    ]) {
      if (body[input] !== undefined) {
        updates.push(`${column}=?`);
        bindings.push(integer(body[input], input, { min: 0, max: 1_000_000_000 }));
      }
    }
    if (body.note !== undefined) {
      updates.push('note=?');
      bindings.push(optionalString(body.note, 'note', { max: 2000 }));
    }
    if (!updates.length) throw new HttpError(400, 'validation_error', 'No supported financial fields were provided.');
    await env.DB.prepare(`UPDATE financials SET ${updates.join(', ')} WHERE id=?`).bind(...bindings, id).run();
    await audit(env, user, 'update', 'financial', id, body);
    return json(mapFinancial(await firstOr404(env, 'SELECT * FROM financials WHERE id=?', [id], 'Financial row')));
  }
  if (id && request.method === 'DELETE') {
    await firstOr404(env, 'SELECT id FROM financials WHERE id=?', [id], 'Financial row');
    await env.DB.prepare('DELETE FROM financials WHERE id=?').bind(id).run();
    await audit(env, user, 'delete', 'financial', id);
    return json({ ok: true });
  }
  void bodyId;
  return methodNotAllowed(id ? ['PATCH', 'DELETE'] : ['GET', 'POST']);
}

function normalizePriority(value) {
  if (value === 'high') return 'urgent';
  return oneOf(value, 'priority', ['low', 'normal', 'urgent']);
}

async function createRecurringTask(env, task) {
  if (!task.recurring || !task.due_date) return;
  const due = new Date(`${task.due_date}T12:00:00Z`);
  if (task.recurring === 'weekly') due.setUTCDate(due.getUTCDate() + 7);
  else due.setUTCMonth(due.getUTCMonth() + 1);
  await env.DB.prepare(
    `INSERT INTO owner_tasks
      (id, title, property_id, due_date, done, recurring, assigned_to, priority, notes, created_ts)
     VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
  ).bind(
    newId('task'),
    task.title,
    task.property_id,
    due.toISOString().slice(0, 10),
    task.recurring,
    task.assigned_to,
    task.priority,
    task.notes,
    nowIso(),
  ).run();
}

async function handleTasks(request, env, user, parts) {
  requireManager(user);
  const id = parts[2];
  if (!id && request.method === 'GET') {
    return json((await all(env, 'SELECT * FROM owner_tasks ORDER BY done, due_date, created_ts')).map(mapTask));
  }
  if (!id && request.method === 'POST') {
    const body = await readJson(request);
    const taskId = optionalString(body.id, 'id', { max: 100 }) || newId('task');
    const done = body.done === true || body.status === 'done';
    await env.DB.prepare(
      `INSERT INTO owner_tasks
        (id, title, property_id, due_date, done, recurring, assigned_to, priority,
         notes, created_ts, done_ts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      taskId,
      requiredString(body.title, 'title', { max: 300 }),
      optionalString(body.propertyId, 'propertyId', { max: 80 }) ?? null,
      dateValue(body.dueDate, 'dueDate') ?? null,
      Number(done),
      body.recurring == null ? null : oneOf(body.recurring, 'recurring', ['weekly', 'monthly']),
      optionalString(body.assignedTo ?? body.assigneeId, 'assignedTo', { max: 80 }) ?? null,
      body.priority ? normalizePriority(body.priority) : 'normal',
      optionalString(body.notes, 'notes', { max: 3000 }) ?? null,
      nowIso(),
      done ? nowIso() : null,
    ).run();
    await audit(env, user, 'create', 'owner_task', taskId);
    return json(mapTask(await firstOr404(env, 'SELECT * FROM owner_tasks WHERE id=?', [taskId], 'Task')), 201);
  }
  if (id && request.method === 'PATCH') {
    const body = await readJson(request);
    const before = await firstOr404(env, 'SELECT * FROM owner_tasks WHERE id=?', [id], 'Task');
    const updates = [];
    const bindings = [];
    const set = (column, value) => { updates.push(`${column}=?`); bindings.push(value); };
    if (body.title !== undefined) set('title', requiredString(body.title, 'title', { max: 300 }));
    if (body.propertyId !== undefined) set('property_id', optionalString(body.propertyId, 'propertyId', { max: 80 }));
    if (body.dueDate !== undefined) set('due_date', dateValue(body.dueDate, 'dueDate'));
    if (body.recurring !== undefined) {
      set('recurring', body.recurring == null ? null : oneOf(body.recurring, 'recurring', ['weekly', 'monthly']));
    }
    if (body.assignedTo !== undefined || body.assigneeId !== undefined) {
      set('assigned_to', optionalString(body.assignedTo ?? body.assigneeId, 'assignedTo', { max: 80 }));
    }
    if (body.priority !== undefined) set('priority', normalizePriority(body.priority));
    if (body.notes !== undefined) set('notes', optionalString(body.notes, 'notes', { max: 3000 }));
    if (body.done !== undefined || body.status !== undefined) {
      const done = body.done === true || body.status === 'done';
      set('done', Number(done));
      set('done_ts', done ? nowIso() : null);
    }
    if (!updates.length) throw new HttpError(400, 'validation_error', 'No supported task fields were provided.');
    await env.DB.prepare(`UPDATE owner_tasks SET ${updates.join(', ')} WHERE id=?`).bind(...bindings, id).run();
    const after = await firstOr404(env, 'SELECT * FROM owner_tasks WHERE id=?', [id], 'Task');
    if (!Number(before.done) && Number(after.done) && after.recurring) await createRecurringTask(env, after);
    await audit(env, user, 'update', 'owner_task', id, body);
    return json(mapTask(after));
  }
  if (id && request.method === 'DELETE') {
    await firstOr404(env, 'SELECT id FROM owner_tasks WHERE id=?', [id], 'Task');
    await env.DB.prepare('DELETE FROM owner_tasks WHERE id=?').bind(id).run();
    await audit(env, user, 'delete', 'owner_task', id);
    return json({ ok: true });
  }
  return methodNotAllowed(id ? ['PATCH', 'DELETE'] : ['GET', 'POST']);
}

async function handleGoals(request, env, user, parts) {
  requireManager(user);
  const id = parts[2];
  if (!id && request.method === 'GET') {
    return json((await all(env, 'SELECT * FROM goals ORDER BY status, deadline')).map(mapGoal));
  }
  if (!id && request.method === 'POST') {
    const body = await readJson(request);
    const goalId = optionalString(body.id, 'id', { max: 100 }) || newId('goal');
    await env.DB.prepare(
      `INSERT INTO goals (id, name, target_value, current_value, unit, deadline, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      goalId,
      requiredString(body.name ?? body.title, 'name', { max: 300 }),
      finiteNumber(body.targetValue ?? body.target, 'targetValue', { min: 0, max: 1_000_000_000 }),
      finiteNumber(body.currentValue ?? body.current ?? 0, 'currentValue', { min: 0, max: 1_000_000_000 }),
      optionalString(body.unit, 'unit', { max: 50 }) ?? null,
      dateValue(body.deadline, 'deadline') ?? null,
      body.status ? oneOf(body.status, 'status', ['active', 'hit', 'archived']) : 'active',
    ).run();
    await audit(env, user, 'create', 'goal', goalId);
    return json(mapGoal(await firstOr404(env, 'SELECT * FROM goals WHERE id=?', [goalId], 'Goal')), 201);
  }
  if (id && request.method === 'PATCH') {
    const body = await readJson(request);
    await firstOr404(env, 'SELECT id FROM goals WHERE id=?', [id], 'Goal');
    const updates = [];
    const bindings = [];
    const set = (column, value) => { updates.push(`${column}=?`); bindings.push(value); };
    if (body.name !== undefined || body.title !== undefined) set('name', requiredString(body.name ?? body.title, 'name', { max: 300 }));
    if (body.targetValue !== undefined || body.target !== undefined) set('target_value', finiteNumber(body.targetValue ?? body.target, 'targetValue', { min: 0, max: 1_000_000_000 }));
    if (body.currentValue !== undefined || body.current !== undefined) set('current_value', finiteNumber(body.currentValue ?? body.current, 'currentValue', { min: 0, max: 1_000_000_000 }));
    if (body.unit !== undefined) set('unit', optionalString(body.unit, 'unit', { max: 50 }));
    if (body.deadline !== undefined) set('deadline', dateValue(body.deadline, 'deadline'));
    if (body.status !== undefined) set('status', oneOf(body.status, 'status', ['active', 'hit', 'archived']));
    if (!updates.length) throw new HttpError(400, 'validation_error', 'No supported goal fields were provided.');
    await env.DB.prepare(`UPDATE goals SET ${updates.join(', ')} WHERE id=?`).bind(...bindings, id).run();
    await audit(env, user, 'update', 'goal', id, body);
    return json(mapGoal(await firstOr404(env, 'SELECT * FROM goals WHERE id=?', [id], 'Goal')));
  }
  if (id && request.method === 'DELETE') {
    await firstOr404(env, 'SELECT id FROM goals WHERE id=?', [id], 'Goal');
    await env.DB.prepare('DELETE FROM goals WHERE id=?').bind(id).run();
    await audit(env, user, 'delete', 'goal', id);
    return json({ ok: true });
  }
  return methodNotAllowed(id ? ['PATCH', 'DELETE'] : ['GET', 'POST']);
}

async function handleTickets(request, env, user, parts) {
  const id = parts[2];
  if (!id && request.method === 'GET') {
    return json((await all(env, 'SELECT * FROM maintenance_tickets ORDER BY opened_ts DESC')).map(mapTicket));
  }
  if (!id && request.method === 'POST') {
    const body = await readJson(request);
    const ticketId = optionalString(body.id, 'id', { max: 100 }) || newId('ticket');
    await env.DB.prepare(
      `INSERT INTO maintenance_tickets
        (id, property_id, turn_id, category, summary, opened_ts, opened_by, note,
         photo_key, priority, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')`,
    ).bind(
      ticketId,
      requiredString(body.propertyId, 'propertyId', { max: 80 }),
      optionalString(body.turnId, 'turnId', { max: 120 }) ?? null,
      optionalString(body.category, 'category', { max: 80 }) ?? 'maintenance',
      requiredString(body.summary ?? body.note, 'summary', { max: 300 }),
      nowIso(),
      user.id,
      optionalString(body.note, 'note', { max: 3000 }) ?? '',
      optionalString(body.photoKey, 'photoKey', { max: 500 }) ?? null,
      body.priority
        ? normalizePriority(body.priority)
        : body.severity === 'high'
          ? 'urgent'
          : body.severity === 'low'
            ? 'low'
            : 'normal',
    ).run();
    await audit(env, user, 'create', 'maintenance_ticket', ticketId);
    return json(mapTicket(await firstOr404(
      env,
      'SELECT * FROM maintenance_tickets WHERE id=?',
      [ticketId],
      'Ticket',
    )), 201);
  }
  if (id && request.method === 'PATCH') {
    const body = await readJson(request);
    const current = await firstOr404(env, 'SELECT * FROM maintenance_tickets WHERE id=?', [id], 'Ticket');
    if (!manager(user) && current.opened_by !== user.id) {
      throw new HttpError(403, 'forbidden', 'Only a manager can update this ticket.');
    }
    if (!manager(user) && (body.status !== undefined || body.priority !== undefined)) {
      throw new HttpError(403, 'forbidden', 'Only a manager can change ticket status or priority.');
    }
    const updates = [];
    const bindings = [];
    const set = (column, value) => { updates.push(`${column}=?`); bindings.push(value); };
    if (body.note !== undefined) set('note', requiredString(body.note, 'note', { max: 3000 }));
    if (body.summary !== undefined) set('summary', requiredString(body.summary, 'summary', { max: 300 }));
    if (body.category !== undefined) set('category', optionalString(body.category, 'category', { max: 80 }));
    if (body.photoKey !== undefined) set('photo_key', optionalString(body.photoKey, 'photoKey', { max: 500 }));
    if (body.priority !== undefined) set('priority', normalizePriority(body.priority));
    if (body.status !== undefined) {
      const status = oneOf(body.status, 'status', ['open', 'in_progress', 'closed']);
      set('status', status);
      set('closed_ts', status === 'closed' ? nowIso() : null);
    }
    if (!updates.length) throw new HttpError(400, 'validation_error', 'No supported ticket fields were provided.');
    await env.DB.prepare(`UPDATE maintenance_tickets SET ${updates.join(', ')} WHERE id=?`).bind(...bindings, id).run();
    await audit(env, user, 'update', 'maintenance_ticket', id, body);
    return json(mapTicket(await firstOr404(env, 'SELECT * FROM maintenance_tickets WHERE id=?', [id], 'Ticket')));
  }
  if (id && request.method === 'DELETE') {
    requireManager(user);
    await firstOr404(env, 'SELECT id FROM maintenance_tickets WHERE id=?', [id], 'Ticket');
    await env.DB.prepare('DELETE FROM maintenance_tickets WHERE id=?').bind(id).run();
    await audit(env, user, 'delete', 'maintenance_ticket', id);
    return json({ ok: true });
  }
  return methodNotAllowed(id ? ['PATCH', 'DELETE'] : ['GET', 'POST']);
}

async function handleSupplies(request, env, user, parts) {
  const id = parts[2];
  if (!id && request.method === 'GET') {
    return json((await all(env, 'SELECT * FROM supplies ORDER BY property_id, name')).map(mapSupply));
  }
  if (!id && request.method === 'POST') {
    requireManager(user);
    const body = await readJson(request);
    const supplyId = optionalString(body.id, 'id', { max: 100 }) || newId('supply');
    await env.DB.prepare(
      `INSERT INTO supplies (id, property_id, name, count, reorder_at, unit, updated_ts)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      supplyId,
      requiredString(body.propertyId, 'propertyId', { max: 80 }),
      requiredString(body.name, 'name', { max: 200 }),
      integer(body.count ?? 0, 'count', { min: 0, max: 1_000_000 }),
      integer(body.reorderAt ?? 0, 'reorderAt', { min: 0, max: 1_000_000 }),
      optionalString(body.unit, 'unit', { max: 50 }) ?? null,
      nowIso(),
    ).run();
    await audit(env, user, 'create', 'supply', supplyId);
    return json(mapSupply(await firstOr404(env, 'SELECT * FROM supplies WHERE id=?', [supplyId], 'Supply')), 201);
  }
  if (id && request.method === 'PATCH') {
    requireManager(user);
    const body = await readJson(request);
    await firstOr404(env, 'SELECT id FROM supplies WHERE id=?', [id], 'Supply');
    const updates = [];
    const bindings = [];
    const set = (column, value) => { updates.push(`${column}=?`); bindings.push(value); };
    if (body.name !== undefined) set('name', requiredString(body.name, 'name', { max: 200 }));
    if (body.count !== undefined) set('count', integer(body.count, 'count', { min: 0, max: 1_000_000 }));
    if (body.reorderAt !== undefined) set('reorder_at', integer(body.reorderAt, 'reorderAt', { min: 0, max: 1_000_000 }));
    if (body.unit !== undefined) set('unit', optionalString(body.unit, 'unit', { max: 50 }));
    if (!updates.length) throw new HttpError(400, 'validation_error', 'No supported supply fields were provided.');
    set('updated_ts', nowIso());
    await env.DB.prepare(`UPDATE supplies SET ${updates.join(', ')} WHERE id=?`).bind(...bindings, id).run();
    await audit(env, user, 'update', 'supply', id, body);
    return json(mapSupply(await firstOr404(env, 'SELECT * FROM supplies WHERE id=?', [id], 'Supply')));
  }
  if (id && request.method === 'DELETE') {
    requireManager(user);
    await firstOr404(env, 'SELECT id FROM supplies WHERE id=?', [id], 'Supply');
    await env.DB.prepare('DELETE FROM supplies WHERE id=?').bind(id).run();
    await audit(env, user, 'delete', 'supply', id);
    return json({ ok: true });
  }
  return methodNotAllowed(id ? ['PATCH', 'DELETE'] : ['GET', 'POST']);
}

async function handlePhotos(request, env, user, parts) {
  if (!env.PHOTOS) throw new HttpError(503, 'photos_not_configured', 'Photo storage is not configured.');
  const key = parts.slice(2).join('/');
  if (!key && request.method === 'POST') {
    const type = request.headers.get('content-type') || '';
    if (!type.toLowerCase().includes('multipart/form-data')) {
      throw new HttpError(415, 'unsupported_media_type', 'Upload must use multipart/form-data.');
    }
    const form = await request.formData();
    const file = form.get('file');
    if (!file || typeof file.arrayBuffer !== 'function') {
      throw new HttpError(400, 'validation_error', 'A file field is required.');
    }
    if (!String(file.type || '').startsWith('image/')) {
      throw new HttpError(400, 'validation_error', 'Only image uploads are accepted.');
    }
    if (file.size > 8 * 1024 * 1024) {
      throw new HttpError(413, 'payload_too_large', 'Photos must be 8 MB or smaller.');
    }
    const extension = (String(file.name || '').match(/\.([a-zA-Z0-9]{2,5})$/)?.[1] || 'jpg').toLowerCase();
    const objectKey = `private/${new Date().toISOString().slice(0, 10)}/${newId('photo')}.${extension}`;
    await env.PHOTOS.put(objectKey, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type },
      customMetadata: { uploadedBy: user.id },
    });
    const created = new Date();
    const purgeAfter = new Date(created.getTime() + 90 * 86400000);
    await env.DB.prepare(
      `INSERT INTO photo_objects
        (object_key, uploaded_by, content_type, size_bytes, created_ts, purge_after_ts)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(objectKey, user.id, file.type, file.size, created.toISOString(), purgeAfter.toISOString()).run();
    await audit(env, user, 'create', 'photo', objectKey);
    return json({ key: objectKey, url: `/api/photos/${objectKey}` }, 201);
  }
  if (key && request.method === 'GET') {
    await firstOr404(env, 'SELECT object_key FROM photo_objects WHERE object_key=?', [key], 'Photo');
    const object = await env.PHOTOS.get(key);
    if (!object) throw new HttpError(404, 'not_found', 'Photo was not found.');
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('cache-control', 'private, no-store');
    headers.set('content-security-policy', "default-src 'none'");
    headers.set('x-content-type-options', 'nosniff');
    return new Response(object.body, { headers });
  }
  if (key && request.method === 'DELETE') {
    requireManager(user);
    await firstOr404(env, 'SELECT object_key FROM photo_objects WHERE object_key=?', [key], 'Photo');
    await env.PHOTOS.delete(key);
    await env.DB.prepare('UPDATE turn_checks SET photo_key=NULL WHERE photo_key=?').bind(key).run();
    await env.DB.prepare('UPDATE maintenance_tickets SET photo_key=NULL WHERE photo_key=?').bind(key).run();
    await env.DB.prepare('UPDATE water_readings SET photo_key=NULL WHERE photo_key=?').bind(key).run();
    await env.DB.prepare('UPDATE water_readings SET pressure_photo_key=NULL WHERE pressure_photo_key=?').bind(key).run();
    await env.DB.prepare('UPDATE water_readings SET level_photo_key=NULL WHERE level_photo_key=?').bind(key).run();
    await env.DB.prepare('DELETE FROM photo_objects WHERE object_key=?').bind(key).run();
    await audit(env, user, 'delete', 'photo', key);
    return json({ ok: true });
  }
  return methodNotAllowed(key ? ['GET', 'DELETE'] : ['POST']);
}

async function purgeExpiredPhotos(env) {
  if (!env.PHOTOS) return 0;
  const expired = await all(env, 'SELECT object_key FROM photo_objects WHERE purge_after_ts<=?', nowIso());
  for (const row of expired) {
    await env.PHOTOS.delete(row.object_key);
    await env.DB.prepare('UPDATE turn_checks SET photo_key=NULL WHERE photo_key=?').bind(row.object_key).run();
    await env.DB.prepare('UPDATE maintenance_tickets SET photo_key=NULL WHERE photo_key=?').bind(row.object_key).run();
    await env.DB.prepare('UPDATE water_readings SET photo_key=NULL WHERE photo_key=?').bind(row.object_key).run();
    await env.DB.prepare('UPDATE water_readings SET pressure_photo_key=NULL WHERE pressure_photo_key=?').bind(row.object_key).run();
    await env.DB.prepare('UPDATE water_readings SET level_photo_key=NULL WHERE level_photo_key=?').bind(row.object_key).run();
    await env.DB.prepare('DELETE FROM photo_objects WHERE object_key=?').bind(row.object_key).run();
  }
  return expired.length;
}

async function handlePush(request, env, user, parts) {
  if (parts[2] === 'key' && request.method === 'GET') {
    if (!env.VAPID_PUBLIC_KEY) throw new HttpError(503, 'push_not_configured', 'Push notifications are not configured.');
    return json({ publicKey: env.VAPID_PUBLIC_KEY });
  }
  if (parts[2] === 'subscribe' && request.method === 'POST') {
    const body = await readJson(request, 32 * 1024);
    const subscription = body.subscription;
    const endpoint = requiredString(subscription?.endpoint, 'subscription.endpoint', { max: 2000 });
    const p256dh = requiredString(subscription?.keys?.p256dh, 'subscription.keys.p256dh', { max: 500 });
    const auth = requiredString(subscription?.keys?.auth, 'subscription.keys.auth', { max: 500 });
    const id = newId('push');
    await env.DB.prepare(
      `INSERT INTO push_subscriptions (id, team_id, endpoint, p256dh, auth, created_ts)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET
         team_id=excluded.team_id, p256dh=excluded.p256dh, auth=excluded.auth`,
    ).bind(id, user.id, endpoint, p256dh, auth, nowIso()).run();
    return json({ ok: true }, 201);
  }
  return methodNotAllowed(parts[2] === 'key' ? ['GET'] : ['POST']);
}

async function routeApi(request, env) {
  const url = new URL(request.url);
  const parts = routeParts(url.pathname);
  const resource = parts[1] || '';

  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (resource === 'health') return request.method === 'GET' ? health(env) : methodNotAllowed(['GET']);
  if (resource === 'login-options') return request.method === 'GET' ? loginOptions(env) : methodNotAllowed(['GET']);
  if (resource === 'login') return request.method === 'POST' ? login(request, env) : methodNotAllowed(['POST']);
  if (resource === 'logout') return request.method === 'POST' ? logout(request, env) : methodNotAllowed(['POST']);

  const user = await requireUser(request, env);
  if (resource === 'me') return request.method === 'GET' ? json({ user: publicUser(user) }) : methodNotAllowed(['GET']);
  if (resource === 'state') return request.method === 'GET' ? json(await stateResponse(env, user)) : methodNotAllowed(['GET']);
  if (resource === 'turns') return handleTurns(request, env, user, parts);
  if (resource === 'water') return handleWater(request, env, user, parts);
  if (resource === 'financials') return handleFinancials(request, env, user, parts, url);
  if (resource === 'tasks') return handleTasks(request, env, user, parts);
  if (resource === 'goals') return handleGoals(request, env, user, parts);
  if (resource === 'tickets') return handleTickets(request, env, user, parts);
  if (resource === 'supplies') return handleSupplies(request, env, user, parts);
  if (resource === 'alerts') {
    requireManager(user);
    return request.method === 'GET' ? json(await computeAlerts(env)) : methodNotAllowed(['GET']);
  }
  if (resource === 'bookings') {
    requireManager(user);
    return request.method === 'GET'
      ? json((await all(env, 'SELECT * FROM bookings WHERE active=1 ORDER BY start_date')).map(mapBooking))
      : methodNotAllowed(['GET']);
  }
  if (resource === 'photos') return handlePhotos(request, env, user, parts);
  if (resource === 'push') return handlePush(request, env, user, parts);
  if (resource === 'sync') {
    requireManager(user);
    return request.method === 'POST' ? json(await syncAll(env)) : methodNotAllowed(['POST']);
  }
  if (resource === 'audit') {
    requireManager(user);
    if (request.method !== 'GET') return methodNotAllowed(['GET']);
    const rows = await all(
      env,
      `SELECT id, actor_id, action, entity_type, entity_id, detail_json, created_ts
       FROM audit_log ORDER BY created_ts DESC LIMIT 200`,
    );
    return json(rows.map(row => ({
      id: row.id,
      actorId: row.actor_id,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      detail: row.detail_json ? JSON.parse(row.detail_json) : null,
      createdTs: row.created_ts,
    })));
  }
  return apiError(404, 'not_found', 'API route was not found.');
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        assertSameOrigin(request);
        return await routeApi(request, env);
      }
      return env.ASSETS
        ? env.ASSETS.fetch(request)
        : apiError(404, 'not_found', 'Static assets are not configured.');
    } catch (error) {
      return handleError(error);
    }
  },

  async scheduled(_event, env, context) {
    context.waitUntil(Promise.all([syncAll(env), purgeExpiredPhotos(env)]));
  },
};

export { stateResponse };
