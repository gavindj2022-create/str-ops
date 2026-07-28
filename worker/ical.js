const FEEDS = {
  millpoint: ['ICAL_MILPOINT_AIRBNB', 'ICAL_MILPOINT_VRBO'],
  westgate: ['ICAL_WESTGATE_AIRBNB'],
  galena: ['ICAL_GALENA_AIRBNB', 'ICAL_GALENA_VRBO'],
  hickory: ['ICAL_HICKORY_AIRBNB', 'ICAL_HICKORY_VRBO'],
};

function unfoldIcal(ical) {
  return String(ical || '').replace(/\r?\n[ \t]/g, '');
}

function unescapeIcal(value) {
  return String(value || '')
    .replaceAll('\\n', ' ')
    .replaceAll('\\N', ' ')
    .replaceAll('\\,', ',')
    .replaceAll('\\;', ';')
    .replaceAll('\\\\', '\\')
    .trim();
}

function parseDateValue(value) {
  const match = String(value || '').match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?Z?)?/);
  if (!match) return null;
  return {
    date: `${match[1]}-${match[2]}-${match[3]}`,
    time: match[4] ? `${match[4]}:${match[5]}` : null,
  };
}

function lineValue(block, name) {
  const expression = new RegExp(`^${name}(?:;[^:]*)?:(.+)$`, 'mi');
  return block.match(expression)?.[1]?.trim() || null;
}

export function parseICal(ical) {
  const unfolded = unfoldIcal(ical);
  const events = [];
  for (const block of unfolded.split('BEGIN:VEVENT').slice(1)) {
    const start = parseDateValue(lineValue(block, 'DTSTART'));
    const end = parseDateValue(lineValue(block, 'DTEND'));
    const summary = unescapeIcal(lineValue(block, 'SUMMARY') || '');
    if (!start || !end || /available|not available/i.test(summary)) continue;
    const uid = unescapeIcal(lineValue(block, 'UID') || `${start.date}-${end.date}-${summary}`);
    events.push({
      uid,
      startDate: start.date,
      endDate: end.date,
      startTime: start.time,
      endTime: end.time,
      summary,
    });
  }
  return events;
}

async function hashId(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].slice(0, 12).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function sourceLabel(secretName) {
  return secretName.endsWith('_VRBO') ? 'vrbo' : 'airbnb';
}

async function upsertBookings(env, propertyId, secretName, events, seenAt) {
  const source = sourceLabel(secretName);
  await env.DB.prepare(
    'UPDATE bookings SET active=0 WHERE property_id=? AND source=?',
  ).bind(propertyId, secretName).run();
  for (const event of events) {
    const id = `booking_${await hashId(`${propertyId}:${secretName}:${event.uid}`)}`;
    await env.DB.prepare(
      `INSERT INTO bookings
        (id, property_id, source, uid, start_date, end_date, start_time, end_time,
         summary, active, last_seen_ts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
       ON CONFLICT(property_id, source, uid) DO UPDATE SET
         start_date=excluded.start_date, end_date=excluded.end_date,
         start_time=excluded.start_time, end_time=excluded.end_time,
         summary=excluded.summary, active=1, last_seen_ts=excluded.last_seen_ts`,
    ).bind(
      id,
      propertyId,
      secretName,
      event.uid,
      event.startDate,
      event.endDate,
      event.startTime,
      event.endTime,
      `${source}: ${event.summary || 'Reserved'}`,
      seenAt,
    ).run();
  }
}

async function regenerateTurns(env, propertyId) {
  const bookingsResult = await env.DB.prepare(
    `SELECT * FROM bookings WHERE property_id=? AND active=1
     AND end_date>=date('now')
     ORDER BY start_date, end_date`,
  ).bind(propertyId).all();
  const property = await env.DB.prepare(
    'SELECT checkout_time, checkin_time FROM properties WHERE id=?',
  ).bind(propertyId).first();
  const all = bookingsResult.results || [];
  const byCheckout = new Map();
  for (const booking of all) {
    const current = byCheckout.get(booking.end_date);
    if (!current || booking.start_date < current.start_date) byCheckout.set(booking.end_date, booking);
  }
  const bookings = [...byCheckout.values()].sort((a, b) => a.end_date.localeCompare(b.end_date));
  const liveIds = new Set();
  for (let index = 0; index < bookings.length; index++) {
    const booking = bookings[index];
    const next = bookings
      .filter(candidate => candidate.start_date >= booking.end_date)
      .sort((a, b) => a.start_date.localeCompare(b.start_date))[0];
    const id = `ical-${propertyId}-${booking.end_date}`;
    liveIds.add(id);
    const checkinDate = next?.start_date || null;
    const sameDay = Number(Boolean(checkinDate && checkinDate === booking.end_date));
    await env.DB.prepare(
      `INSERT INTO turns
        (id, property_id, checkout_date, checkin_date, checkout_time, checkin_time,
         same_day, status, source, booking_id, updated_ts)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'needs_cleaning', 'ical', ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         checkout_date=excluded.checkout_date, checkin_date=excluded.checkin_date,
         checkout_time=excluded.checkout_time, checkin_time=excluded.checkin_time,
         same_day=excluded.same_day, booking_id=excluded.booking_id,
         source='ical', updated_ts=excluded.updated_ts`,
    ).bind(
      id,
      propertyId,
      booking.end_date,
      checkinDate,
      booking.end_time || property?.checkout_time || '11:00',
      next?.start_time || property?.checkin_time || '16:00',
      sameDay,
      booking.id,
      new Date().toISOString(),
    ).run();
  }

  const existing = await env.DB.prepare(
    `SELECT id, status FROM turns
     WHERE property_id=? AND source='ical' AND checkout_date>=date('now')`,
  ).bind(propertyId).all();
  for (const turn of existing.results || []) {
    if (!liveIds.has(turn.id) && turn.status === 'needs_cleaning') {
      await env.DB.prepare('DELETE FROM turns WHERE id=?').bind(turn.id).run();
    }
  }
  if (bookings.length) {
    await env.DB.prepare(
      `DELETE FROM turns WHERE property_id=? AND source='seed' AND checkout_date>=date('now')`,
    ).bind(propertyId).run();
  }
  return bookings.length;
}

export async function syncAll(env) {
  const counts = {};
  const errors = [];
  const seenAt = new Date().toISOString();
  for (const [propertyId, secretNames] of Object.entries(FEEDS)) {
    let configured = 0;
    let fetched = 0;
    let eventCount = 0;
    for (const secretName of secretNames) {
      const feedUrl = env[secretName];
      if (!feedUrl) continue;
      configured++;
      try {
        const response = await fetch(feedUrl, { headers: { accept: 'text/calendar' } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const events = parseICal(await response.text());
        await upsertBookings(env, propertyId, secretName, events, seenAt);
        fetched++;
        eventCount += events.length;
      } catch (error) {
        errors.push({ propertyId, source: secretName, message: String(error.message || error) });
      }
    }
    const turns = fetched ? await regenerateTurns(env, propertyId) : 0;
    counts[propertyId] = { configured, fetched, events: eventCount, turns };
  }
  return {
    synced: errors.length === 0,
    at: seenAt,
    counts,
    errors,
  };
}

export { FEEDS };
