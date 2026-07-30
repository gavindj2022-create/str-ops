import assert from 'node:assert/strict';
import test from 'node:test';

import { chicagoClock, waterReadingStatus } from '../worker/alerts.js';
import { hashPin } from '../worker/auth.js';
import { parseICal } from '../worker/ical.js';
import { mapFinancial, mapReading, mapTurn } from '../worker/mappers.js';

test('parseICal unfolds lines, preserves times, and skips availability blocks', () => {
  const events = parseICal([
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:booking-123',
    'DTSTART;TZID=America/Chicago:20260728T160000',
    'DTEND;TZID=America/Chicago:20260731T100000',
    'SUMMARY:Reserved',
    ' continuation',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:available-1',
    'DTSTART;VALUE=DATE:20260801',
    'DTEND;VALUE=DATE:20260802',
    'SUMMARY:Available',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n'));

  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    uid: 'booking-123',
    startDate: '2026-07-28',
    endDate: '2026-07-31',
    startTime: '16:00',
    endTime: '10:00',
    summary: 'Reservedcontinuation',
  });
});

test('demo PIN hash matches the seeded PBKDF2 hash', async () => {
  assert.equal(
    await hashPin('246810', 'str-ops-demo-larry-v3', 120000),
    'SURJnMYJPBLwkQKD4LS1GMCtK9eJ0ISLs2Uyp2G-mP4',
  );
});

test('water status treats chlorine outside target as bad', () => {
  assert.equal(waterReadingStatus('pool', { chlorine: 0.6, ph: 7.4, alk: 100 }), 'bad');
  assert.equal(waterReadingStatus('hottub', { chlorine: 3, ph: 7.4, alk: 100 }), 'good');
  assert.equal(waterReadingStatus('pool', { chlorine: 2, ph: 8.1, alk: 100 }), 'warn');
  assert.equal(waterReadingStatus('pool', { freeChlorine: 2, ph: 7.4, alk: 100, pressurePsi: 30 }), 'warn');
  assert.equal(waterReadingStatus('pool', { free_chlorine: 2, ph: 7.4, alk: 100, water_level: 'low' }), 'bad');
});

test('Chicago comparisons use the requested timezone', () => {
  assert.deepEqual(
    chicagoClock(new Date('2026-07-27T06:30:00.000Z')),
    { date: '2026-07-27', time: '01:30', localMinute: '2026-07-27T01:30' },
  );
});

test('SQL adapters return camelCase and money stays in cents', () => {
  assert.deepEqual(mapFinancial({
    id: 'f1',
    property_id: 'westgate',
    month: '2026-07',
    revenue_cents: 100000,
    expenses_cents: 25000,
    cleaning_cost_cents: 10000,
    note: null,
  }), {
    id: 'f1',
    propertyId: 'westgate',
    month: '2026-07',
    revenueCents: 100000,
    expensesCents: 25000,
    cleaningCostCents: 10000,
    cleanerPayoutCents: 10000,
    netCents: 65000,
    note: null,
  });

  const turn = mapTurn({
    id: 't1',
    property_id: 'westgate',
    checkout_date: '2026-07-27',
    checkin_date: '2026-07-27',
    checkout_time: '10:00',
    checkin_time: '16:00',
    same_day: 1,
    status: 'needs_cleaning',
    assigned_to: 'anna',
    started_at: null,
    completed_at: null,
    source: 'seed',
    booking_id: null,
    updated_ts: null,
  });
  assert.equal(turn.propertyId, 'westgate');
  assert.equal(turn.sameDay, true);
  assert.equal(turn.assignedTo, 'anna');
  assert.ok(!('assigned_to' in turn));

  const reading = mapReading({
    id: 'r1',
    asset_id: 'westgate-pool',
    ts: '2026-07-29T10:00:00.000Z',
    chlorine: 2.4,
    free_chlorine: 2.4,
    total_chlorine: 3,
    ph: 7.4,
    alk: 100,
    hardness: 250,
    cyanuric_acid: 50,
    salt: 3000,
    pressure_psi: 18,
    water_level: 'slightly_above',
    note: 'Pool check',
    photo_key: 'private/strip.png',
    pressure_photo_key: 'private/gauge.png',
    level_photo_key: 'private/level.png',
    logged_by: 'anna',
  });
  assert.equal(reading.freeChlorine, 2.4);
  assert.equal(reading.cyanuricAcid, 50);
  assert.equal(reading.pressurePsi, 18);
  assert.equal(reading.levelPhotoKey, 'private/level.png');
});
