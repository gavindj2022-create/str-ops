const bool = value => Boolean(Number(value));

function parseItems(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function mapProperty(row) {
  return {
    id: row.id,
    name: row.name,
    location: row.location,
    beds: row.beds,
    baths: row.baths,
    sleeps: row.sleeps,
    hasPool: bool(row.has_pool),
    hasHotTub: bool(row.has_hottub),
    checkoutTime: row.checkout_time,
    checkinTime: row.checkin_time,
    waterTestCadenceDays: row.water_test_cadence_days,
    cleaningRateCents: row.cleaning_rate_cents,
  };
}

export function mapTeam(row) {
  return { id: row.id, name: row.name, role: row.role, color: row.color };
}

export function mapBooking(row) {
  return {
    id: row.id,
    propertyId: row.property_id,
    source: row.source,
    uid: row.uid,
    startDate: row.start_date,
    endDate: row.end_date,
    startTime: row.start_time,
    endTime: row.end_time,
    summary: row.summary,
    active: bool(row.active),
    lastSeenTs: row.last_seen_ts,
  };
}

export function mapTurn(row) {
  return {
    id: row.id,
    propertyId: row.property_id,
    checkout: row.checkout_date,
    checkin: row.checkin_date,
    checkoutDate: row.checkout_date,
    checkinDate: row.checkin_date,
    checkoutTime: row.checkout_time,
    checkinTime: row.checkin_time,
    readyBy: row.checkin_time || '16:00',
    sameDay: bool(row.same_day),
    status: row.status,
    assigned: row.assigned_to,
    assignedTo: row.assigned_to,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    source: row.source,
    bookingId: row.booking_id,
    updatedTs: row.updated_ts,
  };
}

export function mapChecklistTemplate(row) {
  return { id: row.id, propertyId: row.property_id, items: parseItems(row.items) };
}

export function mapTurnCheck(row) {
  return {
    turnId: row.turn_id,
    itemIdx: row.item_idx,
    done: bool(row.done),
    photoKey: row.photo_key,
    updatedBy: row.updated_by,
    updatedTs: row.updated_ts,
  };
}

export function mapWaterAsset(row) {
  return { id: row.id, propertyId: row.property_id, type: row.type, name: row.name };
}

export function mapReading(row) {
  return {
    id: row.id,
    assetId: row.asset_id,
    ts: row.ts,
    chlorine: row.chlorine,
    freeChlorine: row.free_chlorine ?? row.chlorine,
    totalChlorine: row.total_chlorine,
    ph: row.ph,
    alk: row.alk,
    hardness: row.hardness,
    cyanuricAcid: row.cyanuric_acid,
    cya: row.cyanuric_acid,
    salt: row.salt,
    pressurePsi: row.pressure_psi,
    waterLevel: row.water_level,
    note: row.note,
    photoKey: row.photo_key,
    pressurePhotoKey: row.pressure_photo_key,
    levelPhotoKey: row.level_photo_key,
    loggedBy: row.logged_by,
  };
}

export function mapTicket(row) {
  return {
    id: row.id,
    propertyId: row.property_id,
    turnId: row.turn_id,
    category: row.category || 'maintenance',
    summary: row.summary || row.note,
    openedTs: row.opened_ts,
    createdAt: row.opened_ts,
    openedBy: row.opened_by,
    reportedBy: row.opened_by,
    note: row.note,
    photoKey: row.photo_key,
    priority: row.priority,
    severity: row.priority === 'urgent' ? 'high' : row.priority === 'low' ? 'low' : 'medium',
    status: row.status,
    closedTs: row.closed_ts,
  };
}

export function mapFinancial(row) {
  const revenueCents = Number(row.revenue_cents);
  const expensesCents = Number(row.expenses_cents);
  const cleaningCostCents = Number(row.cleaning_cost_cents);
  return {
    id: row.id,
    propertyId: row.property_id,
    month: row.month,
    revenueCents,
    expensesCents,
    cleaningCostCents,
    cleanerPayoutCents: cleaningCostCents,
    netCents: revenueCents - expensesCents - cleaningCostCents,
    note: row.note,
  };
}

export function mapTask(row) {
  return {
    id: row.id,
    title: row.title,
    propertyId: row.property_id,
    dueDate: row.due_date,
    done: bool(row.done),
    status: bool(row.done) ? 'done' : 'open',
    recurring: row.recurring,
    assignedTo: row.assigned_to,
    assigneeId: row.assigned_to,
    priority: row.priority === 'urgent' ? 'high' : row.priority,
    notes: row.notes,
    createdTs: row.created_ts,
    doneTs: row.done_ts,
  };
}

export function mapGoal(row) {
  return {
    id: row.id,
    name: row.name,
    title: row.name,
    targetValue: row.target_value,
    target: row.target_value,
    currentValue: row.current_value,
    current: row.current_value,
    unit: row.unit,
    deadline: row.deadline,
    period: row.deadline,
    status: row.status,
  };
}

export function mapSupply(row) {
  return {
    id: row.id,
    propertyId: row.property_id,
    name: row.name,
    count: row.count,
    reorderAt: row.reorder_at,
    unit: row.unit,
    updatedTs: row.updated_ts,
  };
}
