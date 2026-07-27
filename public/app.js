/* STR Ops — app logic */
let USER = null;
let VIEW = 'today';
let S = DB.load();

const $ = (s,r=document)=>r.querySelector(s);
const $$ = (s,r=document)=>[...r.querySelectorAll(s)];
const prop = id => PROPERTIES.find(p=>p.id===id);
const member = id => TEAM.find(t=>t.id===id);
const isAdmin = ()=> USER && USER.role==='admin';

const HEAD_TINT = { millpoint:'#1F4E5F', westgate:'#6b4f8a', galena:'#8a6b4f', hickory:'#2E6E82' };

function todayISO(){ return iso(new Date()); }
function fmtDay(isoStr){
  const d=new Date(isoStr+'T00:00'); const t=todayISO();
  if(isoStr===t) return 'today';
  if(isoStr===addDays(1)) return 'tomorrow';
  return d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
}
function isSameDay(turn){ return turn.checkout===turn.checkin; }
function checklistFor(turn){ return CHECKLISTS[turn.propertyId]||[]; }
function turnChecks(turn){ return S.checks[turn.id]||{}; }
function turnPhotos(turn){ return S.photos[turn.id]||{}; }
function turnProgress(turn){
  const list=checklistFor(turn); const c=turnChecks(turn);
  const done=list.filter((_,i)=>c[i]).length; return {done, total:list.length};
}

/* ---------------- login ---------------- */
function renderLogin(){
  const wrap=$('#loginPeople'); wrap.innerHTML='';
  TEAM.forEach(t=>{
    const b=document.createElement('button'); b.className='person-btn';
    b.innerHTML=`<span class="pa" style="background:${t.color};color:#20180a">${t.name[0]}</span>
      <span><span class="pn">${t.name}</span><span class="pr">${t.role==='admin'?'Manager':'Cleaner'}</span></span>`;
    b.onclick=()=>openPin(t); wrap.appendChild(b);
  });
}
let pinTarget=null, pinBuf='';
function openPin(t){
  pinTarget=t; pinBuf=''; $('#loginPeople').classList.add('hidden');
  $('#pinPad').classList.remove('hidden'); $('#pinWho').textContent=`Enter PIN for ${t.name}`;
  $('#pinError').textContent=''; drawDots();
}
function drawDots(){ $$('.pin-dots span').forEach((s,i)=> s.classList.toggle('on', i<pinBuf.length)); }
function pinKey(k){
  if(k==='cancel'){ $('#pinPad').classList.add('hidden'); $('#loginPeople').classList.remove('hidden'); return; }
  if(k==='back'){ pinBuf=pinBuf.slice(0,-1); drawDots(); return; }
  if(pinBuf.length>=4) return;
  pinBuf+=k; drawDots();
  if(pinBuf.length===4){
    if(pinBuf===pinTarget.pin){ signIn(pinTarget); }
    else { $('#pinError').textContent='Wrong PIN, try again'; pinBuf=''; setTimeout(drawDots,180); }
  }
}
function signIn(t){
  USER=t; $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
  const h=new Date().getHours(); const part=h<12?'Morning':h<17?'Afternoon':'Evening';
  $('#greeting').textContent=`${part}, ${t.name}`;
  $('#dateline').textContent=new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'});
  $('#avatar').textContent=t.name[0]; $('#avatar').style.background=t.color;
  go('today'); runReminders();
}
function signOut(){ USER=null; $('#app').classList.add('hidden'); $('#login').classList.remove('hidden');
  $('#pinPad').classList.add('hidden'); $('#loginPeople').classList.remove('hidden'); }

/* ---------------- nav ---------------- */
function go(v){
  VIEW=v; $$('.tab').forEach(t=>t.classList.toggle('active', t.dataset.view===v));
  const el=$('#view');
  if(v==='today') el.innerHTML=renderToday();
  else if(v==='turns') el.innerHTML=renderTurns();
  else if(v==='water') el.innerHTML=renderWater();
  else if(v==='team') el.innerHTML=renderTeam();
  bindView();
  el.scrollTop=0;
}

/* my turns vs all (cleaners see their own first) */
function visibleTurns(){
  let ts=[...S.turns].sort((a,b)=> a.checkout.localeCompare(b.checkout) || (isSameDay(b)-isSameDay(a)));
  return ts;
}

/* ---------------- Today ---------------- */
function renderToday(){
  const t=todayISO();
  const toClean=S.turns.filter(x=>x.checkout<=t && x.status!=='done');
  const arriving=S.turns.filter(x=>x.checkin===t);
  const testsDue=WATER_ASSETS.filter(a=>testDue(a).due);
  const mine=toClean.filter(x=>x.assigned===USER.id);
  const list=(isAdmin()?toClean:(mine.length?mine:toClean));
  let h=`<div class="stat-row">
    <div class="stat clean"><div class="n">${toClean.length}</div><div class="l">to clean</div></div>
    <div class="stat arrive"><div class="n">${arriving.length}</div><div class="l">arriving</div></div>
    <div class="stat pool"><div class="n">${testsDue.length}</div><div class="l">pool tests</div></div>
  </div>`;
  h+=`<p class="sec-label">${isAdmin()?'Turnovers today':'Your turnovers'}</p>`;
  h+= list.length ? list.map(turnCard).join('') :
    `<div class="empty"><span class="em-ico">&#9749;</span>Nothing to clean right now. Enjoy it.</div>`;
  if(testsDue.length){
    h+=`<p class="sec-label">Water needs you</p>`;
    h+=testsDue.map(a=>{
      const p=prop(a.propertyId);
      return `<div class="wa" data-water="${a.id}"><div class="wa-foot"><div>
        <div class="wa-name">${a.name}</div><div class="wa-prop">${p.name} • test due</div></div>
        <button class="assign-chip" data-water="${a.id}">Log now</button></div></div>`;
    }).join('');
  }
  return h;
}

/* ---------------- Turns ---------------- */
function renderTurns(){
  const ts=visibleTurns();
  let h=`<p class="sec-label">All turnovers</p>`;
  h+= ts.length? ts.map(turnCard).join('') : `<div class="empty">No upcoming turns.</div>`;
  return h;
}
function turnCard(turn){
  const p=prop(turn.propertyId); const {done,total}=turnProgress(turn);
  const pct= total? Math.round(done/total*100):0;
  const sameday=isSameDay(turn);
  let pill, pillTxt;
  if(turn.status==='done'){ pill='done'; pillTxt='Ready'; }
  else if(sameday){ pill='sameday'; pillTxt='Same-day turn'; }
  else if(turn.status==='in_progress'){ pill='progress'; pillTxt='In progress'; }
  else { pill='needs'; pillTxt='Needs cleaning'; }
  const who=turn.assigned? member(turn.assigned).name : 'Unassigned';
  const tint=HEAD_TINT[turn.propertyId];
  return `<div class="card ${sameday&&turn.status!=='done'?'urgent':''}" data-turn="${turn.id}">
    <div class="card-head" style="background-color:${tint}">
      <span class="ch-name">${p.name}</span><span class="ch-loc">${p.location}</span>
    </div>
    <div class="card-body">
      <div><span class="pill ${pill}">${pillTxt}</span>
        <div class="cb-meta">Out ${fmtDay(turn.checkout)} • in ${fmtDay(turn.checkin)} • ${who}</div></div>
      <div class="cb-right">
        <div class="ring" style="--p:${pct}%"><i>${done}/${total}</i></div>
        <div class="sm">items</div>
      </div>
    </div></div>`;
}

/* ---------------- Turn sheet (checklist) ---------------- */
function openTurn(id){
  const turn=S.turns.find(t=>t.id===id); if(!turn) return;
  const p=prop(turn.propertyId); const list=checklistFor(turn);
  const checks=turnChecks(turn); const photos=turnPhotos(turn);
  const groups=[...new Set(list.map(i=>i.group))];
  let body=`<div class="sheet-grab"></div>
    <div class="sheet-title">${p.name}</div>
    <div class="sheet-sub">Out ${fmtDay(turn.checkout)} • guest in ${fmtDay(turn.checkin)}${isSameDay(turn)?' • same-day turn':''}</div>`;
  if(isAdmin()){
    const who=turn.assigned?member(turn.assigned).name:'Unassigned';
    body+=`<div class="row" style="margin-bottom:14px"><span class="pa" style="background:${turn.assigned?member(turn.assigned).color:'#2b2b30'}">${turn.assigned?who[0]:'?'}</span>
      <div><div class="rn">${who}</div><div class="rr">Assigned cleaner</div></div>
      <button class="assign-chip" data-assign="${turn.id}">${turn.assigned?'Reassign':'Auto-assign'}</button></div>`;
  }
  groups.forEach(g=>{
    body+=`<div class="chk-group-label">${g}</div>`;
    list.forEach((item,i)=>{
      if(item.group!==g) return;
      const on=!!checks[i]; const hasPhoto=!!photos[i];
      const cam = item.photo? `<button class="cam ${hasPhoto?'has':(item.photo==='required'?'req':'')}" data-photo="${turn.id}:${i}" aria-label="Add photo">${hasPhoto?'&#10003;':'&#128247;'}</button>`:'';
      body+=`<div class="chk ${on?'on':''}" data-check="${turn.id}:${i}">
        <span class="box">&#10003;</span><span class="lbl">${item.label}</span>${cam}</div>`;
    });
  });
  const gate=readyGate(turn);
  if(!gate.ok){
    body+=`<div class="gate-note"><span>&#9888;</span><span>${gate.msg}</span></div>`;
  }
  const doneAlready=turn.status==='done';
  body+=`<div class="btn-row">
    ${doneAlready?`<button class="btn ghost" data-reopen="${turn.id}">Re-open</button>`
      :`<button class="btn primary" data-done="${turn.id}" ${gate.ok?'':'disabled style="opacity:.45"'}>Mark ready for guest</button>`}
    </div>`;
  openSheet(body);
}
function readyGate(turn){
  const list=checklistFor(turn); const checks=turnChecks(turn); const photos=turnPhotos(turn);
  const unchecked=list.filter((_,i)=>!checks[i]).length;
  if(unchecked>0) return {ok:false, msg:`${unchecked} item${unchecked>1?'s':''} left to check off.`};
  const missingPhoto=list.filter((it,i)=> it.photo==='required' && !photos[i]).length;
  if(missingPhoto>0) return {ok:false, msg:`${missingPhoto} verification photo${missingPhoto>1?'s':''} still needed.`};
  return {ok:true};
}

/* ---------------- Water ---------------- */
function latestReading(assetId){
  return S.readings.filter(r=>r.assetId===assetId).sort((a,b)=>b.ts.localeCompare(a.ts))[0];
}
function testDue(asset){
  const r=latestReading(asset.id); if(!r) return {due:true, days:99};
  const days=Math.floor((Date.now()-new Date(r.ts).getTime())/86400000);
  const limit= asset.type==='hottub'?3:4;
  return {due: days>=limit, days};
}
function renderWater(){
  let h=`<p class="sec-label">Pools &amp; hot tubs</p>`;
  h+=WATER_ASSETS.map(a=>{
    const p=prop(a.propertyId); const r=latestReading(a.id);
    const st=r?readingStatus(a.type,{chlorine:r.chlorine,ph:r.ph,alk:r.alk}):'bad';
    const tips=r?doseAdvice(a.type,{chlorine:r.chlorine,ph:r.ph,alk:r.alk}):['No reading yet, test now'];
    const due=testDue(a);
    const cls=(k,ok)=>ok;
    const rs = r? {
      cl: cellClass(a.type,'chlorine',r.chlorine), ph: cellClass(a.type,'ph',r.ph), al: cellClass(a.type,'alk',r.alk)
    }:{cl:'bad',ph:'bad',al:'bad'};
    return `<div class="wa" data-water="${a.id}">
      <div class="wa-top"><div><div class="wa-name">${a.name}</div><div class="wa-prop">${p.name}</div></div>
        <span class="pill ${st==='good'?'ready':st==='warn'?'needs':'sameday'}">${st==='good'?'Balanced':st==='warn'?'Adjust':'Needs care'}</span></div>
      <div class="wa-readout">
        <div class="wa-r ${rs.cl}"><div class="v">${r?r.chlorine:'—'}</div><div class="k">Chlorine</div></div>
        <div class="wa-r ${rs.ph}"><div class="v">${r?r.ph:'—'}</div><div class="k">pH</div></div>
        <div class="wa-r ${rs.al}"><div class="v">${r?r.alk:'—'}</div><div class="k">Alkalinity</div></div>
      </div>
      <div class="dose ${tips.length?'':'ok'}">${tips.length? tips.join(' • ') : 'All balanced, no action needed'}</div>
      <div class="wa-foot"><span class="wa-due ${due.due?'over':''}">${r?`Last tested ${due.days===0?'today':due.days+'d ago'}`:'Never tested'}${due.due?' • due now':''}</span>
        <button class="btn primary" style="width:auto;padding:11px 18px" data-log="${a.id}">Log reading</button></div>
    </div>`;
  }).join('');
  h+=`<button class="btn ghost" data-compliance="1" style="margin-top:6px">&#128196; Export compliance log (PDF)</button>`;
  return h;
}
function cellClass(type,key,val){
  const t=TARGETS[type][key];
  if(val<t[0]||val>t[1]) return (key==='chlorine')?'bad':'warn';
  return 'good';
}
function openLog(assetId){
  const a=WATER_ASSETS.find(x=>x.id===assetId); const p=prop(a.propertyId);
  let body=`<div class="sheet-grab"></div><div class="sheet-title">Log reading</div>
    <div class="sheet-sub">${a.name} • ${p.name}</div>
    <div class="reading-grid">
      <div class="field"><label>Chlorine <span class="unit">ppm</span></label><input id="in-cl" type="number" step="0.1" inputmode="decimal" placeholder="1–3"></div>
      <div class="field"><label>pH</label><input id="in-ph" type="number" step="0.1" inputmode="decimal" placeholder="7.2–7.6"></div>
      <div class="field"><label>Alk <span class="unit">ppm</span></label><input id="in-alk" type="number" step="1" inputmode="numeric" placeholder="80–120"></div>
    </div>
    <div class="field"><label>Note (optional)</label><input id="in-note" type="text" placeholder="e.g. added 2 tabs"></div>
    <button class="btn primary" data-savelog="${a.id}">Save reading</button>`;
  openSheet(body);
}
function saveLog(assetId){
  const cl=parseFloat($('#in-cl').value), ph=parseFloat($('#in-ph').value), alk=parseFloat($('#in-alk').value);
  if(isNaN(cl)||isNaN(ph)||isNaN(alk)){ toast('Fill chlorine, pH and alkalinity'); return; }
  S.readings.push({ id:'r'+Date.now(), assetId, ts:new Date().toISOString().slice(0,16), chlorine:cl, ph, alk, note:$('#in-note').value||'' });
  DB.save(S); closeSheet(); go('water'); toast('Reading saved');
}
function exportCompliance(){
  const rows=[...S.readings].sort((a,b)=>b.ts.localeCompare(a.ts)).map(r=>{
    const a=WATER_ASSETS.find(x=>x.id===r.assetId); const p=prop(a.propertyId);
    return `<tr><td>${r.ts.replace('T',' ')}</td><td>${p.name}</td><td>${a.name}</td><td>${r.chlorine}</td><td>${r.ph}</td><td>${r.alk}</td><td>${r.note||''}</td></tr>`;
  }).join('');
  const w=window.open('','_blank');
  if(!w){ toast('Allow pop-ups to export the log'); return; }
  w.document.write(`<html><head><title>STR Water Compliance Log</title>
    <style>body{font-family:Georgia,serif;padding:32px;color:#111}h1{font-size:20px}
    .sub{color:#555;margin-bottom:18px}table{width:100%;border-collapse:collapse;font-size:13px}
    th,td{border:1px solid #ccc;padding:7px 9px;text-align:left}th{background:#f2efe9}</style></head>
    <body><h1>Short Term Retreats — Water Compliance Log</h1>
    <div class="sub">Chlorine (ppm), pH, Alkalinity (ppm). Generated ${new Date().toLocaleString()}.</div>
    <table><thead><tr><th>Date/time</th><th>Property</th><th>Asset</th><th>Cl</th><th>pH</th><th>Alk</th><th>Note</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <p style="margin-top:22px;color:#777;font-size:12px">Two pools and two hot tubs • Westgate Oasis &amp; Hickory Hideaway</p></body></html>`);
  w.document.close(); setTimeout(()=>w.print(),400); toast('Opening printable log');
}

/* ---------------- Team / admin ---------------- */
function renderTeam(){
  let h=`<p class="sec-label">The team</p>`;
  h+=TEAM.map(t=>`<div class="row"><span class="pa" style="background:${t.color};color:#20180a">${t.name[0]}</span>
    <div><div class="rn">${t.name}</div><div class="rr">${t.role==='admin'?'Manager • full control':'Cleaner'}</div></div>
    <span class="badge ${t.role==='admin'?'admin':''}">${t.role}</span></div>`).join('');
  if(isAdmin()){
    h+=`<p class="sec-label">Manager tools</p>`;
    h+=`<button class="btn ghost" data-autoassign="1" style="margin-bottom:10px">&#9851; Auto-assign all open turns</button>`;
    h+=`<button class="btn ghost" data-editlists="1" style="margin-bottom:10px">&#9998; Edit cleaning checklists</button>`;
    h+=`<button class="btn ghost danger" data-reset="1">Reset demo data</button>`;
    h+=`<p class="admin-note">You are signed in as ${USER.name} (manager).</p>`;
  } else {
    h+=`<p class="admin-note">Ask Anna for manager access to assign turns or edit lists.</p>`;
  }
  return h;
}

/* auto-assign: round-robin across cleaners, balancing count, skip already-assigned */
function autoAssignAll(){
  const cleaners=TEAM.filter(t=>t.role==='cleaner');
  const load={}; cleaners.forEach(c=>load[c.id]=S.turns.filter(t=>t.assigned===c.id&&t.status!=='done').length);
  S.turns.filter(t=>t.status!=='done'&&!t.assigned).forEach(t=>{
    const pick=cleaners.sort((a,b)=>load[a.id]-load[b.id])[0];
    t.assigned=pick.id; load[pick.id]++;
  });
  DB.save(S); go(VIEW); toast('Open turns auto-assigned');
}
function openAssign(turnId){
  const turn=S.turns.find(t=>t.id===turnId);
  const cleaners=TEAM.filter(t=>t.role==='cleaner');
  const load=id=>S.turns.filter(t=>t.assigned===id&&t.status!=='done').length;
  const suggest=[...cleaners].sort((a,b)=>load(a.id)-load(b.id))[0];
  let body=`<div class="sheet-grab"></div><div class="sheet-title">Assign cleaner</div>
    <div class="sheet-sub">${prop(turn.propertyId).name} • out ${fmtDay(turn.checkout)}</div>
    <div class="gate-note" style="background:var(--water-bg);border-color:rgba(79,176,198,.3);color:var(--water)"><span>&#9851;</span><span>Suggested: <b>${suggest.name}</b> (fewest open turns). Tap to confirm or pick someone else.</span></div>
    <div class="pick-list">`;
  cleaners.forEach(c=>{
    body+=`<button data-pick="${turn.id}:${c.id}" class="${c.id===suggest.id?'sel':''}">
      <span class="pa" style="width:32px;height:32px;border-radius:50%;background:${c.color};color:#20180a;display:grid;place-items:center;font-weight:500">${c.name[0]}</span>
      <span>${c.name}<div class="mini">${load(c.id)} open turn${load(c.id)===1?'':'s'}</div></span></button>`;
  });
  body+=`</div>`;
  openSheet(body);
}

/* ---------------- reminders ---------------- */
function runReminders(){
  const t=todayISO();
  const sameDay=S.turns.filter(x=>isSameDay(x)&&x.status!=='done').length;
  const testsDue=WATER_ASSETS.filter(a=>testDue(a).due).length;
  const msgs=[];
  if(sameDay) msgs.push(`${sameDay} same-day turn${sameDay>1?'s':''} today`);
  if(testsDue) msgs.push(`${testsDue} pool test${testsDue>1?'s':''} due`);
  if(msgs.length) setTimeout(()=>toast('Heads up: '+msgs.join(' • ')),700);
}

/* ---------------- sheet + toast + bindings ---------------- */
function openSheet(html){ $('#sheetBody').innerHTML=html; $('#sheet').classList.remove('hidden'); }
function closeSheet(){ $('#sheet').classList.add('hidden'); }
let toastT;
function toast(m){ const el=$('#toast'); el.textContent=m; el.classList.remove('hidden'); clearTimeout(toastT); toastT=setTimeout(()=>el.classList.add('hidden'),2600); }

function bindView(){
  $$('[data-turn]').forEach(el=> el.onclick=()=>openTurn(el.dataset.turn));
  $$('[data-log]').forEach(el=> el.onclick=e=>{e.stopPropagation();openLog(el.dataset.log);});
  $$('[data-water]').forEach(el=> el.onclick=e=>{ if(e.target.dataset.water){e.stopPropagation();openLog(e.target.dataset.water);} });
  $$('[data-compliance]').forEach(el=> el.onclick=exportCompliance);
  $$('[data-autoassign]').forEach(el=> el.onclick=autoAssignAll);
  $$('[data-reset]').forEach(el=> el.onclick=()=>{ if(confirm('Reset demo data to seeded state?')){ DB.reset(); S=DB.load(); go(VIEW); toast('Demo data reset'); }});
  $$('[data-editlists]').forEach(el=> el.onclick=()=>toast('Checklist editor lands in the admin phase'));
}

/* delegated clicks inside the sheet */
$('#sheet').addEventListener('click', e=>{
  const t=e.target.closest('[data-close]'); if(t){ closeSheet(); return; }
  const chk=e.target.closest('[data-check]');
  if(chk && !e.target.closest('[data-photo]')){
    const [id,i]=chk.dataset.check.split(':'); S.checks[id]=S.checks[id]||{}; S.checks[id][i]=!S.checks[id][i];
    const turn=S.turns.find(x=>x.id===id); if(turn.status==='needs_cleaning'){turn.status='in_progress';}
    DB.save(S); openTurn(id); return;
  }
  const ph=e.target.closest('[data-photo]');
  if(ph){ const [id,i]=ph.dataset.photo.split(':'); capturePhoto(id,i); return; }
  const dn=e.target.closest('[data-done]'); if(dn && !dn.disabled){ markDone(dn.dataset.done); return; }
  const ro=e.target.closest('[data-reopen]'); if(ro){ reopen(ro.dataset.reopen); return; }
  const as=e.target.closest('[data-assign]'); if(as){ openAssign(as.dataset.assign); return; }
  const pk=e.target.closest('[data-pick]'); if(pk){ const [id,cid]=pk.dataset.pick.split(':'); S.turns.find(t=>t.id===id).assigned=cid; DB.save(S); closeSheet(); go(VIEW); toast('Cleaner assigned'); return; }
  const sl=e.target.closest('[data-savelog]'); if(sl){ saveLog(sl.dataset.savelog); return; }
});

function capturePhoto(id,i){
  const inp=document.createElement('input'); inp.type='file'; inp.accept='image/*'; inp.capture='environment';
  inp.onchange=()=>{ const f=inp.files[0]; if(!f) return;
    const rd=new FileReader(); rd.onload=()=>{ S.photos[id]=S.photos[id]||{}; S.photos[id][i]=rd.result; DB.save(S); openTurn(id); toast('Photo added'); };
    rd.readAsDataURL(f); };
  inp.click();
}
function markDone(id){ const t=S.turns.find(x=>x.id===id); if(!readyGate(t).ok) return; t.status='done'; DB.save(S); closeSheet(); go(VIEW); toast('Marked ready for guest'); }
function reopen(id){ const t=S.turns.find(x=>x.id===id); t.status='in_progress'; DB.save(S); closeSheet(); go(VIEW); toast('Turn re-opened'); }

/* ---------------- boot ---------------- */
$$('.tab').forEach(t=> t.onclick=()=>go(t.dataset.view));
$('#signout').onclick=signOut;
$('#pinPad').addEventListener('click', e=>{ const b=e.target.closest('button[data-k]'); if(b) pinKey(b.dataset.k); });
renderLogin();

if('serviceWorker' in navigator){ navigator.serviceWorker.register('sw.js').catch(()=>{}); }
