/* STR Ops — Cloudflare Worker (API + Airbnb/VRBO iCal sync).
   Bindings (wrangler.toml): DB (D1), and the 7 iCal secrets from the STR website:
   ICAL_MILPOINT_AIRBNB, ICAL_MILPOINT_VRBO, ICAL_WESTGATE_AIRBNB,
   ICAL_GALENA_AIRBNB, ICAL_GALENA_VRBO, ICAL_HICKORY_AIRBNB, ICAL_HICKORY_VRBO.
   The Cron trigger calls scheduled() to refresh turns from the feeds. */

const FEEDS = {
  millpoint: ['ICAL_MILPOINT_AIRBNB','ICAL_MILPOINT_VRBO'],
  westgate:  ['ICAL_WESTGATE_AIRBNB'],
  galena:    ['ICAL_GALENA_AIRBNB','ICAL_GALENA_VRBO'],
  hickory:   ['ICAL_HICKORY_AIRBNB','ICAL_HICKORY_VRBO'],
};

const json = (o, s=200) => new Response(JSON.stringify(o), {status:s, headers:{'content-type':'application/json','access-control-allow-origin':'*'}});

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname.replace(/\/$/,'');
    try {
      if (p === '/api/turns')     return json(await rows(env,'SELECT * FROM turns ORDER BY checkout_date'));
      if (p === '/api/water')     return json(await rows(env,'SELECT * FROM water_readings ORDER BY ts DESC'));
      if (p === '/api/sync')      return json(await syncAll(env));
      if (p === '/api/health')    return json({ok:true, feeds:Object.keys(FEEDS)});
      return json({error:'not found'}, 404);
    } catch (e) { return json({error:String(e)}, 500); }
  },
  async scheduled(_ev, env, ctx) { ctx.waitUntil(syncAll(env)); },
};

async function rows(env, sql, ...b){ const r = await env.DB.prepare(sql).bind(...b).all(); return r.results||[]; }

async function syncAll(env){
  const out = {};
  for (const [propId, secretNames] of Object.entries(FEEDS)) {
    const booked = [];
    for (const name of secretNames) {
      const feedUrl = env[name];
      if (!feedUrl) continue;
      try {
        const ics = await (await fetch(feedUrl)).text();
        booked.push(...parseICal(ics));
      } catch (e) { /* skip a failing feed, keep the rest */ }
    }
    booked.sort((a,b)=>a.end.localeCompare(b.end));
    out[propId] = await upsertTurns(env, propId, booked);
  }
  return { synced:true, at:new Date().toISOString(), counts:out };
}

/* Minimal VEVENT parser: returns [{start:'YYYY-MM-DD', end:'YYYY-MM-DD'}] for booked ranges.
   In Airbnb feeds, DTEND is the checkout day = the turnover "clean by" date. */
function parseICal(ics){
  const events=[]; const blocks=ics.split('BEGIN:VEVENT').slice(1);
  for (const blk of blocks){
    const s = blk.match(/DTSTART[^:]*:(\d{8})/); const e = blk.match(/DTEND[^:]*:(\d{8})/);
    const summary = (blk.match(/SUMMARY:([^\r\n]*)/)||[])[1]||'';
    if (/available/i.test(summary)) continue; // skip "Available" blocks
    if (s && e) events.push({ start:fmt(s[1]), end:fmt(e[1]) });
  }
  return events;
}
function fmt(d){ return `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`; }

/* Turn = checkout on booking.end; checkin = start of the next booking on that property.
   same_day flags back-to-back bookings. Preserves existing status/assignment. */
async function upsertTurns(env, propId, booked){
  let count=0;
  for (let i=0;i<booked.length;i++){
    const checkout = booked[i].end;
    const next = booked[i+1];
    const checkin = next ? next.start : null;
    const sameDay = checkin && checkin===checkout ? 1 : 0;
    const id = `${propId}-${checkout}`;
    const existing = await env.DB.prepare('SELECT id,status,assigned_to FROM turns WHERE id=?').bind(id).first();
    if (existing){
      await env.DB.prepare('UPDATE turns SET checkin_date=?, same_day=? WHERE id=?').bind(checkin, sameDay, id).run();
    } else {
      await env.DB.prepare('INSERT INTO turns (id,property_id,checkout_date,checkin_date,same_day,status,source) VALUES (?,?,?,?,?,?,?)')
        .bind(id, propId, checkout, checkin, sameDay, 'needs_cleaning', 'ical').run();
    }
    count++;
  }
  return count;
}
