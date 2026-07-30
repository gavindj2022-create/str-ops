/* STR Ops data layer.
   Seeded with the four real Short Term Retreats properties.
   Persists to localStorage. This is the swap point: replace loadTurns()/save()
   with fetch() calls to the Cloudflare Worker + D1 once the .ics feeds are live. */

const STORE_KEY = 'strops.v2';

const PROPERTIES = [
  { id:'millpoint', name:'Millpoint Waterfront', location:'East Peoria', beds:2, baths:2, sleeps:6,
    emoji:'🚤', color:'#1F4E5F', hasPool:false, hasHotTub:false, water:'Lake • boat ramp • 2 kayaks • bonfire' },
  { id:'westgate', name:'Westgate Oasis', location:'Washington, IL', beds:4, baths:2, sleeps:12,
    emoji:'🏝️', color:'#6B4F8A', hasPool:true, hasHotTub:true, water:'Heated 18×36 pool • year-round hot tub' },
  { id:'galena', name:'Galena Shores', location:'Peoria Heights', beds:2, baths:2, sleeps:6,
    emoji:'🏖️', color:'#8A6B4F', hasPool:false, hasHotTub:false, water:'Private beach • 2 kayaks • arcade' },
  { id:'hickory', name:'Hickory Hideaway', location:'East Peoria', beds:3, baths:2.5, sleeps:10,
    emoji:'🌲', color:'#2E6E82', hasPool:true, hasHotTub:true, water:'Heated pool • cabana hot tub • multi-level' },
];

const WATER_ASSETS = [
  { id:'westgate-pool', propertyId:'westgate', type:'pool',   name:'Pool (18×36 heated)' },
  { id:'westgate-tub',  propertyId:'westgate', type:'hottub', name:'Hot tub (4-season room)' },
  { id:'hickory-pool',  propertyId:'hickory',  type:'pool',   name:'Pool (heated in-ground)' },
  { id:'hickory-tub',   propertyId:'hickory',  type:'hottub', name:'Cabana hot tub' },
];

const WATER_ASSET_META = {
  'westgate-pool': {
    emoji:'🏝️', pressureTarget:[10,25], pressureCleanAt:25,
    levelGuide:'Water should sit on the skimmer arrow or just above it.',
  },
  'westgate-tub': {
    emoji:'♨️',
    levelGuide:'Water should cover the jets and stay near the fill line.',
  },
  'hickory-pool': {
    emoji:'🌊', pressureTarget:[10,25], pressureCleanAt:25,
    levelGuide:'Water should sit on the skimmer arrow or just above it.',
  },
  'hickory-tub': {
    emoji:'🫧',
    levelGuide:'Water should cover the jets and stay near the fill line.',
  },
};
WATER_ASSETS.forEach(asset=>Object.assign(asset,WATER_ASSET_META[asset.id]||{}));

const WATER_LEVELS = {
  low: { label:'Below arrow', short:'Low', status:'bad', note:'Add water before the pump runs dry.' },
  on_arrow: { label:'On arrow', short:'On arrow', status:'good', note:'Good working level.' },
  slightly_above: { label:'Slightly above arrow', short:'A little above', status:'good', note:'Preferred on hot or busy days.' },
  high: { label:'Too high', short:'High', status:'warn', note:'Watch it; skimmer may not pull the surface well.' },
};

const BUSINESS_IDEAS = [
  { icon:'🏁', title:'Guest-ready score', detail:'One score per house from cleaning, water, supplies, and open issues.' },
  { icon:'🧭', title:'Ana route board', detail:'Auto-sorts today by house, role lane, same-day pressure, and who owns each lane.' },
  { icon:'📦', title:'Supply par levels', detail:'Coffee, towels, tabs, strips, paper goods, and reorder points by property.' },
  { icon:'📸', title:'Proof timeline', detail:'Before/after photos, pool photos, and final walkthroughs in one owner-friendly history.' },
  { icon:'🔧', title:'Filter + equipment reminders', detail:'Pressure trends can trigger backwash/filter-clean reminders before guests notice.' },
  { icon:'💬', title:'One-tap owner brief', detail:'Copy a clean daily text Ana can send to Gav, Larry, Gale, or the whole crew.' },
];

const WORK_ROLES = [
  { id:'clean', label:'Clean', emoji:'🧽' },
  { id:'laundry', label:'Laundry', emoji:'🧺' },
  { id:'water', label:'Water', emoji:'💧' },
  { id:'inspect', label:'Inspect', emoji:'✅' },
  { id:'supplies', label:'Supplies', emoji:'📦' },
  { id:'maintenance', label:'Maintenance', emoji:'🔧' },
];

const HOUSE_ROLES = {
  millpoint: { clean:['gav'], laundry:['gale'], inspect:['anna'], supplies:['gale'], maintenance:['larry'] },
  westgate:  { clean:['anna'], laundry:['gale'], water:['anna'], inspect:['anna'], supplies:['gale'], maintenance:['larry'] },
  galena:    { clean:['gav'], laundry:['gale'], inspect:['anna'], supplies:['gale'], maintenance:['larry'] },
  hickory:   { clean:['larry'], laundry:['gale'], water:['larry'], inspect:['anna'], supplies:['larry'], maintenance:['larry'] },
};

/* checklist item: {label, group, role, photo:false|'optional'|'required'} */
function baseHome(extra){
  return [
    { group:'Bedrooms', role:'clean', label:'Strip and remake all beds', photo:'required' },
    { group:'Bedrooms', role:'clean', label:'Fresh linens and pillowcases', photo:false },
    { group:'Laundry', role:'laundry', label:'Bag used linens and towels for laundry', photo:false },
    { group:'Bathrooms', role:'clean', label:'Scrub and disinfect bathrooms', photo:'required' },
    { group:'Bathrooms', role:'supplies', label:'Restock towels, paper, toiletries', photo:false },
    { group:'Kitchen', role:'clean', label:'Wash dishes, wipe counters, empty fridge', photo:false },
    { group:'Kitchen', role:'supplies', label:'Restock coffee, supplies, trash bags', photo:false },
    { group:'Living', role:'clean', label:'Vacuum and mop all floors', photo:false },
    { group:'Living', role:'clean', label:'Reset furniture and staging', photo:'optional' },
    ...extra,
    { group:'Finish', role:'clean', label:'Take out all trash', photo:false },
    { group:'Finish', role:'inspect', label:'Final walkthrough photo', photo:'required' },
  ];
}
const CHECKLISTS = {
  westgate: baseHome([
    { group:'Group setup', role:'clean', label:'Reset dining for 12, wipe table + chairs', photo:false },
    { group:'Pool', role:'water', label:'Skim pool, empty baskets, tidy loungers', photo:'required' },
    { group:'Pool', role:'water', label:'Log pool chemistry (see Water tab)', photo:false },
    { group:'Hot tub', role:'water', label:'Wipe hot tub + 4-season room, log chemistry', photo:'required' },
    { group:'Outdoor', role:'clean', label:'Clean BBQ grill + patio, pick up fenced yard', photo:false },
  ]),
  hickory: baseHome([
    { group:'Suites', role:'clean', label:'Reset both king suites', photo:'optional' },
    { group:'Levels', role:'clean', label:'Vacuum all levels + stairs', photo:false },
    { group:'Pool', role:'water', label:'Skim pool, empty baskets, log chemistry', photo:'required' },
    { group:'Hot tub', role:'water', label:'Wipe cabana hot tub, log chemistry', photo:'required' },
  ]),
  millpoint: baseHome([
    { group:'Windows', role:'clean', label:'Clean floor-to-ceiling lake windows', photo:false },
    { group:'Waterfront', role:'clean', label:'Rinse and store kayaks', photo:false },
    { group:'Waterfront', role:'clean', label:'Empty bonfire pit ash, tidy boat ramp area', photo:'optional' },
  ]),
  galena: baseHome([
    { group:'Arcade', role:'clean', label:'Wipe Golden Tee, ping-pong, darts area', photo:false },
    { group:'Beach', role:'clean', label:'Rinse and store kayaks, tidy beach area', photo:false },
    { group:'Bedroom', role:'clean', label:'Reset canopy king bed', photo:'optional' },
  ]),
};

const TEAM = [
  { id:'gav',   name:'Gav',   role:'dev',     title:'Dev + Crew',        pin:'135790', color:'#E0A94B', canWork:true },
  { id:'gale',  name:'Gale',  role:'owner',   title:'Owner',             pin:'975310', color:'#C9A46B', canWork:false },
  { id:'larry', name:'Larry', role:'manager', title:'House Manager',     pin:'246810', color:'#4FB0C6', canWork:true },
  { id:'anna',  name:'Ana',   role:'owner',   title:'Owner + Organizer', pin:'864210', color:'#5BB98B', canWork:true },
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
    { id:'t1', propertyId:'westgate', checkout:addDays(0), checkin:addDays(2), checkoutTime:'10:00', readyBy:'16:00', checkinTime:'16:00', status:'needs_cleaning', assigned:'anna' },
    { id:'t2', propertyId:'hickory',  checkout:addDays(0), checkin:addDays(0), checkoutTime:'10:00', readyBy:'15:30', checkinTime:'16:00', status:'needs_cleaning', assigned:null },
    { id:'t3', propertyId:'millpoint',checkout:addDays(0), checkin:addDays(1), checkoutTime:'10:00', readyBy:'16:00', checkinTime:'16:00', status:'in_progress', assigned:'anna' },
    { id:'t4', propertyId:'galena',   checkout:addDays(1), checkin:addDays(3), checkoutTime:'10:00', readyBy:'16:00', checkinTime:'16:00', status:'needs_cleaning', assigned:null },
    { id:'t5', propertyId:'westgate', checkout:addDays(4), checkin:addDays(6), checkoutTime:'10:00', readyBy:'16:00', checkinTime:'16:00', status:'needs_cleaning', assigned:null },
  ];
}
function seedReadings(){
  return [
    {
      id:'r1', assetId:'westgate-pool', ts:addDays(-3)+'T09:00',
      chlorine:0.6, freeChlorine:0.6, totalChlorine:1, ph:7.1, alk:70,
      hardness:250, cyanuricAcid:40, salt:3000, pressurePsi:22, waterLevel:'low',
      photoKey:null, pressurePhotoKey:null, levelPhotoKey:null
    }, // low -> needs attention
    {
      id:'r2', assetId:'westgate-tub', ts:addDays(-1)+'T09:00',
      chlorine:3.0, freeChlorine:3.0, totalChlorine:3, ph:7.4, alk:100,
      hardness:250, cyanuricAcid:50, salt:null, pressurePsi:null, waterLevel:'on_arrow',
      photoKey:null, pressurePhotoKey:null, levelPhotoKey:null
    },
    {
      id:'r3', assetId:'hickory-pool', ts:addDays(-1)+'T10:00',
      chlorine:2.2, freeChlorine:2.2, totalChlorine:2, ph:7.5, alk:95,
      hardness:250, cyanuricAcid:50, salt:3000, pressurePsi:18, waterLevel:'slightly_above',
      photoKey:null, pressurePhotoKey:null, levelPhotoKey:null
    },
    {
      id:'r4', assetId:'hickory-tub', ts:addDays(-6)+'T10:00',
      chlorine:2.0, freeChlorine:2.0, totalChlorine:2, ph:7.3, alk:90,
      hardness:250, cyanuricAcid:40, salt:null, pressurePsi:null, waterLevel:'on_arrow',
      photoKey:null, pressurePhotoKey:null, levelPhotoKey:null
    }, // stale -> test due
  ];
}
function normalizeReading(reading){
  return {
    freeChlorine:reading.freeChlorine??reading.chlorine??null,
    totalChlorine:reading.totalChlorine??null,
    hardness:reading.hardness??null,
    cyanuricAcid:reading.cyanuricAcid??reading.cya??null,
    salt:reading.salt??null,
    pressurePsi:reading.pressurePsi??null,
    waterLevel:reading.waterLevel??null,
    photoKey:reading.photoKey??null,
    pressurePhotoKey:reading.pressurePhotoKey??null,
    levelPhotoKey:reading.levelPhotoKey??null,
    ...reading,
  };
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
    { id:'task3', title:'Confirm Hickory HVAC service', propertyId:'hickory', assigneeId:'larry', priority:'high', dueDate:addDays(-1), status:'open' },
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
    s.roleMap=s.roleMap||HOUSE_ROLES;
    s.checks=s.checks||{};
    s.photos=s.photos||{};
    s.financials=s.financials||seedFinancials();
    s.tasks=s.tasks||seedTasks();
    s.goals=s.goals||seedGoals();
    s.alerts=s.alerts||seedAlerts();
    s.tickets=s.tickets||seedTickets();
    s.supplies=s.supplies||seedSupplies();
    s.readings=s.readings.map(normalizeReading);
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
  pool: {
    freeChlorine:[1,3], chlorine:[1,3], totalChlorine:[1,3], ph:[7.2,7.8], alk:[80,120],
    hardness:[250,500], cyanuricAcid:[30,100], salt:[2500,3500], pressurePsi:[10,25],
  },
  hottub: {
    freeChlorine:[2,4], chlorine:[2,4], totalChlorine:[2,4], ph:[7.2,7.8], alk:[80,120],
    hardness:[150,500], cyanuricAcid:[30,100], salt:[2500,3500],
  },
};
function readingValue(r,key){
  if(key==='freeChlorine'||key==='chlorine') return r.freeChlorine ?? r.chlorine;
  if(key==='cyanuricAcid') return r.cyanuricAcid ?? r.cya;
  return r[key];
}
function doseAdvice(type, r){
  const t = TARGETS[type]; const tips=[];
  const chlorine=readingValue(r,'freeChlorine');
  if(chlorine < t.freeChlorine[0]) tips.push('Chlorine is low - treat and retest');
  else if(chlorine > t.freeChlorine[1]) tips.push('Chlorine is high - let it drift down before guests');
  if(r.ph < t.ph[0]) tips.push('pH is low - adjust up');
  else if(r.ph > t.ph[1]) tips.push('pH is high - adjust down');
  if(r.alk < t.alk[0]) tips.push('Alkalinity is low');
  else if(r.alk > t.alk[1]) tips.push('Alkalinity is high');
  if(r.pressurePsi!==null&&r.pressurePsi!==undefined&&t.pressurePsi){
    if(r.pressurePsi<t.pressurePsi[0]) tips.push('Pressure is low - check baskets, water level, and flow');
    else if(r.pressurePsi>t.pressurePsi[1]) tips.push('Pressure is high - clean/backwash filter and recheck');
  }
  const level=WATER_LEVELS[r.waterLevel];
  if(level&&level.status!=='good') tips.push(level.note);
  if(['totalChlorine','hardness','cyanuricAcid','salt'].some(key=>{
    const val=readingValue(r,key); const range=t[key];
    return range&&val!==null&&val!==undefined&&(val<range[0]||val>range[1]);
  })) tips.push('One advanced strip number is outside the kit target');
  return tips;
}
function readingStatus(type, r){
  const t=TARGETS[type];
  const off = ['freeChlorine','ph','alk'].filter(k=>{
    const val=readingValue(r,k); const range=t[k];
    return val===null||val===undefined||val < range[0] || val > range[1];
  });
  const level=WATER_LEVELS[r.waterLevel];
  const pressure=readingValue(r,'pressurePsi');
  const pressureOff=t.pressurePsi&&pressure!==null&&pressure!==undefined&&(pressure<t.pressurePsi[0]||pressure>t.pressurePsi[1]);
  const advancedOff=['totalChlorine','hardness','cyanuricAcid','salt'].some(k=>{
    const val=readingValue(r,k); const range=t[k];
    return range&&val!==null&&val!==undefined&&(val<range[0]||val>range[1]);
  });
  if(off.includes('freeChlorine')||level?.status==='bad') return 'bad';
  return off.length||pressureOff||advancedOff||level?.status==='warn' ? 'warn' : 'good';
}
