/* STR Ops data layer.
   Seeded with the four real Short Term Retreats properties.
   Persists to localStorage. This is the swap point: replace loadTurns()/save()
   with fetch() calls to the Cloudflare Worker + D1 once the .ics feeds are live. */

const STORE_KEY = 'strops.v2';

const PROPERTIES = [
  { id:'millpoint', name:'Millpoint Waterfront', location:'East Peoria', beds:2, baths:2, sleeps:6,
    hasPool:false, hasHotTub:false, water:'Lake • boat ramp • 2 kayaks • bonfire' },
  { id:'westgate', name:'Westgate Oasis', location:'Washington, IL', beds:4, baths:2, sleeps:12,
    hasPool:true, hasHotTub:true, water:'Heated 18×36 pool • year-round hot tub' },
  { id:'galena', name:'Galena Shores', location:'Peoria Heights', beds:2, baths:2, sleeps:6,
    hasPool:false, hasHotTub:false, water:'Private beach • 2 kayaks • arcade' },
  { id:'hickory', name:'Hickory Hideaway', location:'East Peoria', beds:3, baths:2.5, sleeps:10,
    hasPool:true, hasHotTub:true, water:'Heated pool • cabana hot tub • multi-level' },
];

const WATER_ASSETS = [
  { id:'westgate-pool', propertyId:'westgate', type:'pool',   name:'Pool (18×36 heated)' },
  { id:'westgate-tub',  propertyId:'westgate', type:'hottub', name:'Hot tub (4-season room)' },
  { id:'hickory-pool',  propertyId:'hickory',  type:'pool',   name:'Pool (heated in-ground)' },
  { id:'hickory-tub',   propertyId:'hickory',  type:'hottub', name:'Cabana hot tub' },
];

/* checklist item: {label, group, photo:false|'optional'|'required'} */
function baseHome(extra){
  return [
    { group:'Bedrooms', label:'Strip and remake all beds', photo:'required' },
    { group:'Bedrooms', label:'Fresh linens and pillowcases', photo:false },
    { group:'Bathrooms', label:'Scrub and disinfect bathrooms', photo:'required' },
    { group:'Bathrooms', label:'Restock towels, paper, toiletries', photo:false },
    { group:'Kitchen', label:'Wash dishes, wipe counters, empty fridge', photo:false },
    { group:'Kitchen', label:'Restock coffee, supplies, trash bags', photo:false },
    { group:'Living', label:'Vacuum and mop all floors', photo:false },
    { group:'Living', label:'Reset furniture and staging', photo:'optional' },
    ...extra,
    { group:'Finish', label:'Take out all trash', photo:false },
    { group:'Finish', label:'Final walkthrough photo', photo:'required' },
  ];
}
const CHECKLISTS = {
  westgate: baseHome([
    { group:'Group setup', label:'Reset dining for 12, wipe table + chairs', photo:false },
    { group:'Pool', label:'Skim pool, empty baskets, tidy loungers', photo:'required' },
    { group:'Pool', label:'Log pool chemistry (see Water tab)', photo:false },
    { group:'Hot tub', label:'Wipe hot tub + 4-season room, log chemistry', photo:'required' },
    { group:'Outdoor', label:'Clean BBQ grill + patio, pick up fenced yard', photo:false },
  ]),
  hickory: baseHome([
    { group:'Suites', label:'Reset both king suites', photo:'optional' },
    { group:'Levels', label:'Vacuum all levels + stairs', photo:false },
    { group:'Pool', label:'Skim pool, empty baskets, log chemistry', photo:'required' },
    { group:'Hot tub', label:'Wipe cabana hot tub, log chemistry', photo:'required' },
  ]),
  millpoint: baseHome([
    { group:'Windows', label:'Clean floor-to-ceiling lake windows', photo:false },
    { group:'Waterfront', label:'Rinse and store kayaks', photo:false },
    { group:'Waterfront', label:'Empty bonfire pit ash, tidy boat ramp area', photo:'optional' },
  ]),
  galena: baseHome([
    { group:'Arcade', label:'Wipe Golden Tee, ping-pong, darts area', photo:false },
    { group:'Beach', label:'Rinse and store kayaks, tidy beach area', photo:false },
    { group:'Bedroom', label:'Reset canopy king bed', photo:'optional' },
  ]),
};

const TEAM = [
  { id:'gav',   name:'Gav',   role:'owner',   pin:'135790', color:'#E0A94B' },
  { id:'anna',  name:'Anna',  role:'manager', pin:'246810', color:'#C9A46B' },
  { id:'maria', name:'Maria', role:'cleaner', pin:'1111', color:'#4FB0C6' },
  { id:'jess',  name:'Jess',  role:'cleaner', pin:'2222', color:'#5BB98B' },
];

/* ---- date helpers ---- */
function iso(d){
  return new Intl.DateTimeFormat('en-CA',{
    timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit',
  }).format(d);
}
function addDays(n){ const d=new Date(); d.setDate(d.getDate()+n); return iso(d); }

/* Seed turns emulate what the Airbnb iCal feed will provide (checkout=clean-by). */
function seedTurns(){
  return [
    { id:'t1', propertyId:'westgate', checkout:addDays(0), checkin:addDays(2), checkoutTime:'10:00', readyBy:'16:00', checkinTime:'16:00', status:'needs_cleaning', assigned:'maria' },
    { id:'t2', propertyId:'hickory',  checkout:addDays(0), checkin:addDays(0), checkoutTime:'10:00', readyBy:'15:30', checkinTime:'16:00', status:'needs_cleaning', assigned:null },
    { id:'t3', propertyId:'millpoint',checkout:addDays(0), checkin:addDays(1), checkoutTime:'10:00', readyBy:'16:00', checkinTime:'16:00', status:'in_progress', assigned:'jess' },
    { id:'t4', propertyId:'galena',   checkout:addDays(1), checkin:addDays(3), checkoutTime:'10:00', readyBy:'16:00', checkinTime:'16:00', status:'needs_cleaning', assigned:null },
    { id:'t5', propertyId:'westgate', checkout:addDays(4), checkin:addDays(6), checkoutTime:'10:00', readyBy:'16:00', checkinTime:'16:00', status:'needs_cleaning', assigned:null },
  ];
}
function seedReadings(){
  return [
    { id:'r1', assetId:'westgate-pool', ts:addDays(-3)+'T09:00', chlorine:0.6, ph:7.1, alk:70 }, // low -> needs attention
    { id:'r2', assetId:'westgate-tub',  ts:addDays(-1)+'T09:00', chlorine:3.0, ph:7.4, alk:100 },
    { id:'r3', assetId:'hickory-pool',  ts:addDays(-1)+'T10:00', chlorine:2.2, ph:7.5, alk:95 },
    { id:'r4', assetId:'hickory-tub',   ts:addDays(-6)+'T10:00', chlorine:2.0, ph:7.3, alk:90 }, // stale -> test due
  ];
}

function seedFinancials(){
  return [
    { id:'f1', month:addDays(0).slice(0,7), propertyId:'westgate', revenueCents:842000, expensesCents:231000, cleanerPayoutCents:92000 },
    { id:'f2', month:addDays(0).slice(0,7), propertyId:'hickory', revenueCents:706000, expensesCents:188000, cleanerPayoutCents:76000 },
    { id:'f3', month:addDays(0).slice(0,7), propertyId:'millpoint', revenueCents:514000, expensesCents:121000, cleanerPayoutCents:54000 },
    { id:'f4', month:addDays(0).slice(0,7), propertyId:'galena', revenueCents:468000, expensesCents:108000, cleanerPayoutCents:48000 },
  ];
}
function seedTasks(){
  return [
    { id:'task1', title:'Replace Westgate patio string lights', propertyId:'westgate', assigneeId:'anna', priority:'high', dueDate:addDays(1), status:'open' },
    { id:'task2', title:'Order Millpoint kayak life jackets', propertyId:'millpoint', assigneeId:'gav', priority:'normal', dueDate:addDays(4), status:'open' },
    { id:'task3', title:'Confirm Hickory HVAC service', propertyId:'hickory', assigneeId:'anna', priority:'high', dueDate:addDays(-1), status:'open' },
  ];
}
function seedGoals(){
  return [
    { id:'goal1', title:'Monthly revenue', target:3200000, current:2530000, unit:'cents', period:'This month' },
    { id:'goal2', title:'Turns ready on time', target:98, current:94, unit:'percent', period:'Last 30 days' },
    { id:'goal3', title:'Guest rating', target:4.9, current:4.86, unit:'rating', period:'Rolling 90 days' },
  ];
}
function seedAlerts(){
  return [
    { id:'alert1', type:'water', severity:'urgent', title:'Westgate pool chlorine is low', detail:'Last reading was 0.6 ppm. Treat and retest before guest arrival.', propertyId:'westgate', createdAt:new Date().toISOString(), resolved:false },
    { id:'alert2', type:'turn', severity:'urgent', title:'Hickory same-day turn is unassigned', detail:'Cleaning window is 10:00 AM–3:30 PM today.', propertyId:'hickory', createdAt:new Date().toISOString(), resolved:false },
    { id:'alert3', type:'turn', severity:'watch', title:'Millpoint turn may run late', detail:'Cleaning started, but the ready-by window is approaching.', propertyId:'millpoint', createdAt:new Date().toISOString(), resolved:false },
    { id:'alert4', type:'ticket', severity:'watch', title:'Open damage ticket at Galena', detail:'Guest reported a loose bedroom door handle.', propertyId:'galena', createdAt:new Date().toISOString(), resolved:false },
    { id:'alert5', type:'supply', severity:'watch', title:'Westgate coffee pods are low', detail:'8 remaining; reorder threshold is 12.', propertyId:'westgate', createdAt:new Date().toISOString(), resolved:false },
    { id:'alert6', type:'task', severity:'urgent', title:'Hickory HVAC task is overdue', detail:'Confirm service appointment and update the team.', propertyId:'hickory', createdAt:new Date().toISOString(), resolved:false },
  ];
}
function seedTickets(){
  return [{ id:'ticket1', turnId:null, propertyId:'galena', category:'damage', severity:'medium', summary:'Loose bedroom door handle', note:'Guest reported movement at checkout.', status:'open', reportedBy:'anna', createdAt:new Date().toISOString() }];
}
function seedSupplies(){
  return [{ id:'supply1', propertyId:'westgate', name:'Coffee pods', quantity:8, reorderAt:12, unit:'pods', status:'low' }];
}

const DB = {
  load(){
    let s;
    try { s = JSON.parse(localStorage.getItem(STORE_KEY)); } catch(e){ s=null; }
    if(!s || !s.turns) s={};
    s.turns=s.turns||seedTurns();
    s.readings=s.readings||seedReadings();
    s.checklists=s.checklists||CHECKLISTS;
    s.checks=s.checks||{};
    s.photos=s.photos||{};
    s.financials=s.financials||seedFinancials();
    s.tasks=s.tasks||seedTasks();
    s.goals=s.goals||seedGoals();
    s.alerts=s.alerts||seedAlerts();
    s.tickets=s.tickets||seedTickets();
    s.supplies=s.supplies||seedSupplies();
    s.turns.forEach(turn=>{
      turn.checkoutTime=turn.checkoutTime||'10:00';
      turn.readyBy=turn.readyBy||'16:00';
      turn.checkinTime=turn.checkinTime||'16:00';
    });
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
    return s;
  },
  save(s){ localStorage.setItem(STORE_KEY, JSON.stringify(s)); },
  reset(){ localStorage.removeItem(STORE_KEY); },
};

/* pool chemistry targets + plain-language dosing */
const TARGETS = {
  pool:   { chlorine:[1,3], ph:[7.2,7.6], alk:[80,120] },
  hottub: { chlorine:[2,4], ph:[7.2,7.6], alk:[80,120] },
};
function doseAdvice(type, r){
  const t = TARGETS[type]; const tips=[];
  if(r.chlorine < t.chlorine[0]) tips.push('Add chlorine, level is low');
  else if(r.chlorine > t.chlorine[1]) tips.push('Hold chlorine, let it drop before guests');
  if(r.ph < t.ph[0]) tips.push('Add pH up (soda ash)');
  else if(r.ph > t.ph[1]) tips.push('Add pH down (dry acid)');
  if(r.alk < t.alk[0]) tips.push('Add alkalinity increaser');
  else if(r.alk > t.alk[1]) tips.push('Lower alkalinity');
  return tips;
}
function readingStatus(type, r){
  const t=TARGETS[type];
  const off = ['chlorine','ph','alk'].filter(k=>{
    const key = k==='alk'?'alk':k; const val=r[key];
    return val < t[k][0] || val > t[k][1];
  });
  if(off.includes('chlorine')) return 'bad';
  return off.length ? 'warn' : 'good';
}
