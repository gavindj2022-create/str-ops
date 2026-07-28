const TARGETS = {
  pool: { chlorine: [1, 3], ph: [7.2, 7.6], alk: [80, 120] },
  hottub: { chlorine: [2, 4], ph: [7.2, 7.6], alk: [80, 120] },
};

function queryRows(result) {
  return result.results || [];
}

export function chicagoClock(now = new Date(), timeZone = 'America/Chicago') {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now).map(part => [part.type, part.value]),
  );
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return { date, time: `${parts.hour}:${parts.minute}`, localMinute: `${date}T${parts.hour}:${parts.minute}` };
}

export function waterReadingStatus(type, reading) {
  const target = TARGETS[type] || TARGETS.pool;
  const bad = ['chlorine', 'ph', 'alk'].filter(key => {
    const value = Number(reading[key]);
    return value < target[key][0] || value > target[key][1];
  });
  if (bad.includes('chlorine')) return 'bad';
  return bad.length ? 'warn' : 'good';
}

function alert({ type, severity, propertyId = null, title, detail, ts, entityId }) {
  const stable = `${type}:${entityId || propertyId || title}`;
  return {
    id: stable,
    type,
    severity,
    propertyId,
    label: title,
    title,
    detail,
    ts,
    createdAt: ts,
    entityId: entityId || null,
    resolved: false,
  };
}

export async function computeAlerts(env, now = new Date()) {
  const timeZone = env.APP_TIMEZONE || 'America/Chicago';
  const cadenceFallback = Number(env.WATER_TEST_CADENCE_DAYS || 2);
  const clock = chicagoClock(now, timeZone);
  const [
    turnsResult,
    latestReadingsResult,
    assetsResult,
    ticketsResult,
    suppliesResult,
    tasksResult,
  ] = await Promise.all([
    env.DB.prepare(
      `SELECT t.*, p.name AS property_name
       FROM turns t JOIN properties p ON p.id=t.property_id
       WHERE t.status!='done' AND t.checkout_date<=date(?, '+1 day')`,
    ).bind(clock.date).all(),
    env.DB.prepare(
      `SELECT wr.*, wa.type, wa.property_id, wa.name AS asset_name, p.name AS property_name
       FROM water_readings wr
       JOIN water_assets wa ON wa.id=wr.asset_id
       JOIN properties p ON p.id=wa.property_id
       WHERE wr.ts=(SELECT MAX(wr2.ts) FROM water_readings wr2 WHERE wr2.asset_id=wr.asset_id)`,
    ).all(),
    env.DB.prepare(
      `SELECT wa.*, p.name AS property_name, p.water_test_cadence_days,
        (SELECT MAX(ts) FROM water_readings wr WHERE wr.asset_id=wa.id) AS last_ts
       FROM water_assets wa JOIN properties p ON p.id=wa.property_id`,
    ).all(),
    env.DB.prepare(
      `SELECT mt.*, p.name AS property_name FROM maintenance_tickets mt
       JOIN properties p ON p.id=mt.property_id WHERE mt.status!='closed'`,
    ).all(),
    env.DB.prepare(
      `SELECT s.*, p.name AS property_name FROM supplies s
       JOIN properties p ON p.id=s.property_id WHERE s.count<=s.reorder_at`,
    ).all(),
    env.DB.prepare(
      `SELECT ot.*, p.name AS property_name FROM owner_tasks ot
       LEFT JOIN properties p ON p.id=ot.property_id
       WHERE ot.done=0 AND ot.due_date IS NOT NULL AND ot.due_date<=?`,
    ).bind(clock.date).all(),
  ]);

  const alerts = [];

  for (const turn of queryRows(turnsResult)) {
    if (Number(turn.same_day) && turn.checkout_date === clock.date) {
      alerts.push(alert({
        type: 'same_day_turn',
        severity: turn.assigned_to ? 'warning' : 'urgent',
        propertyId: turn.property_id,
        title: `${turn.property_name} has a same-day turn`,
        detail: turn.assigned_to
          ? 'Checkout and arrival are today.'
          : 'Checkout and arrival are today, and the turn is unassigned.',
        ts: `${turn.checkout_date}T${turn.checkout_time || '10:00'}:00`,
        entityId: turn.id,
      }));
    }
    const readyAt = `${turn.checkin_date || turn.checkout_date}T${turn.checkin_time || '16:00'}`;
    if (readyAt < clock.localMinute && (!turn.started_at || !turn.completed_at)) {
      alerts.push(alert({
        type: turn.started_at ? 'turn_late' : 'turn_unstarted',
        severity: 'urgent',
        propertyId: turn.property_id,
        title: `${turn.property_name} is not ready on time`,
        detail: turn.started_at
          ? 'Cleaning started but has not been completed.'
          : 'The ready-by time passed and cleaning has not started.',
        ts: `${readyAt}:00`,
        entityId: turn.id,
      }));
    }
  }

  for (const reading of queryRows(latestReadingsResult)) {
    const status = waterReadingStatus(reading.type, reading);
    if (status === 'bad') {
      alerts.push(alert({
        type: 'water_bad',
        severity: 'urgent',
        propertyId: reading.property_id,
        title: `${reading.property_name} ${reading.asset_name} needs treatment`,
        detail: `Latest chlorine is ${reading.chlorine}, pH is ${reading.ph}, alkalinity is ${reading.alk}.`,
        ts: reading.ts,
        entityId: reading.id,
      }));
    }
  }

  for (const asset of queryRows(assetsResult)) {
    const cadence = Number(asset.water_test_cadence_days || cadenceFallback);
    const last = asset.last_ts ? new Date(`${String(asset.last_ts).replace(' ', 'T')}Z`) : null;
    const overdue = !last || now.getTime() - last.getTime() > cadence * 86400000;
    if (overdue) {
      alerts.push(alert({
        type: 'water_overdue',
        severity: last ? 'warning' : 'urgent',
        propertyId: asset.property_id,
        title: `${asset.property_name} ${asset.name} test is overdue`,
        detail: `Water should be tested every ${cadence} days.`,
        ts: asset.last_ts || now.toISOString(),
        entityId: asset.id,
      }));
    }
  }

  for (const ticket of queryRows(ticketsResult)) {
    alerts.push(alert({
      type: 'maintenance',
      severity: ticket.priority === 'urgent' ? 'urgent' : 'warning',
      propertyId: ticket.property_id,
      title: ticket.summary
        ? `${ticket.property_name}: ${ticket.summary}`
        : `${ticket.property_name} has an open issue`,
      detail: ticket.note,
      ts: ticket.opened_ts,
      entityId: ticket.id,
    }));
  }

  for (const supply of queryRows(suppliesResult)) {
    alerts.push(alert({
      type: 'supply',
      severity: supply.count <= 0 ? 'urgent' : 'warning',
      propertyId: supply.property_id,
      title: `${supply.property_name} is low on ${supply.name}`,
      detail: `${supply.count} ${supply.unit || ''} left, reorder at ${supply.reorder_at}.`.trim(),
      ts: supply.updated_ts,
      entityId: supply.id,
    }));
  }

  for (const task of queryRows(tasksResult)) {
    const overdue = task.due_date < clock.date;
    alerts.push(alert({
      type: 'task',
      severity: overdue || task.priority === 'urgent' ? 'urgent' : 'warning',
      propertyId: task.property_id,
      title: overdue ? `Overdue: ${task.title}` : `Due today: ${task.title}`,
      detail: task.property_name ? `Task for ${task.property_name}.` : 'Portfolio task.',
      ts: `${task.due_date}T23:59:00`,
      entityId: task.id,
    }));
  }

  const rank = { urgent: 0, warning: 1, info: 2 };
  return alerts.sort((left, right) =>
    (rank[left.severity] ?? 9) - (rank[right.severity] ?? 9)
    || String(right.ts).localeCompare(String(left.ts)),
  );
}
