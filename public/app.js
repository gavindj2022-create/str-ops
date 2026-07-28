/* STR Ops phone-first application. The API is authoritative when connected;
   loopback/offline use falls back to synthetic state stored on this device. */
let USER=null;
let VIEW='today';
let S=DB.load();
let API_CONNECTED=false;

const API=window.STRApi;
const $=(selector,root=document)=>root.querySelector(selector);
const $$=(selector,root=document)=>[...root.querySelectorAll(selector)];
const prop=id=>PROPERTIES.find(item=>item.id===id)||{id,name:'Unknown property',location:'',hasPool:false,hasHotTub:false};
const member=id=>TEAM.find(item=>item.id===id)||null;
const normalizeRole=role=>role==='admin'?'manager':role;
const isLeader=()=>USER&&['owner','manager'].includes(normalizeRole(USER.role));
const roleLabel=role=>({owner:'Owner',manager:'Manager',cleaner:'Cleaner',admin:'Manager'}[role]||'Team');
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const HEAD_TINT={millpoint:'#1F4E5F',westgate:'#6b4f8a',galena:'#8a6b4f',hickory:'#2E6E82'};

function todayISO(){ return iso(new Date()); }
function fmtDay(value){
  if(!value) return 'not scheduled';
  if(value===todayISO()) return 'today';
  if(value===addDays(1)) return 'tomorrow';
  return new Date(`${value}T12:00:00`).toLocaleDateString('en-US',{
    timeZone:'America/Chicago',weekday:'short',month:'short',day:'numeric',
  });
}
function fmtTime(value){
  if(!value) return 'time TBD';
  const [hour,minute]=value.split(':').map(Number);
  return new Date(2000,0,1,hour,minute).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
}
function isSameDay(turn){ return Boolean(turn.checkout&&turn.checkin&&turn.checkout===turn.checkin); }
function checklistFor(turn){ return S.checklists?.[turn.propertyId]||CHECKLISTS[turn.propertyId]||[]; }
function turnChecks(turn){ return S.checks[turn.id]||{}; }
function turnPhotos(turn){ return S.photos[turn.id]||{}; }
function turnProgress(turn){
  const list=checklistFor(turn);
  const checks=turnChecks(turn);
  return {done:list.filter((_,index)=>checks[index]).length,total:list.length};
}
function saveLocal(){ DB.save(S); }
function commit(change,remoteCall,options={}){
  const before=remoteCall?JSON.stringify(S):null;
  change();
  saveLocal();
  if(options.render!==false&&USER) go(options.view||VIEW);
  if(remoteCall){
    Promise.resolve().then(remoteCall).then(()=>{
      API_CONNECTED=true;
    }).catch(error=>{
      API_CONNECTED=false;
      if(error?.status&&before){
        S=JSON.parse(before);
        saveLocal();
        if(USER) go(options.view||VIEW);
        toast(`Cloud sync failed, so the change was restored: ${error.message}`);
      }else{
        toast('Saved on this phone; cloud sync is currently offline.');
      }
    });
  }
}
function mergeRemoteState(remote){
  const state=remote?.state||remote;
  if(!state||typeof state!=='object') return;
  const collections=['turns','readings','checklists','checks','photos','financials','tasks','goals','alerts','tickets','supplies'];
  collections.forEach(key=>{
    if(state[key]!==undefined&&(Array.isArray(state[key])||['checklists','checks','photos'].includes(key))) S[key]=state[key];
  });
  S.turns=(S.turns||[]).map(turn=>({
    checkoutTime:'10:00',readyBy:'16:00',checkinTime:'16:00',...turn,
  }));
  saveLocal();
}

/* ---------------- login ---------------- */
function renderLogin(){
  const wrap=$('#loginPeople');
  wrap.innerHTML='';
  TEAM.forEach(person=>{
    const button=document.createElement('button');
    button.className='person-btn';
    button.innerHTML=`<span class="pa" style="background:${person.color};color:#20180a">${esc(person.name[0])}</span>
      <span><span class="pn">${esc(person.name)}</span><span class="pr">${roleLabel(normalizeRole(person.role))}</span></span>`;
    button.onclick=()=>openPin(person);
    wrap.appendChild(button);
  });
}
let pinTarget=null;
let pinBuf='';
function openPin(person){
  pinTarget=person;
  pinBuf='';
  $('.pin-dots').innerHTML='<span></span>'.repeat(person.pin.length);
  $('#loginPeople').classList.add('hidden');
  $('#pinPad').classList.remove('hidden');
  $('#pinWho').textContent=`Enter PIN for ${person.name}`;
  $('#pinError').textContent='';
  drawDots();
}
function drawDots(){ $$('.pin-dots span').forEach((dot,index)=>dot.classList.toggle('on',index<pinBuf.length)); }
async function pinKey(key){
  if(key==='cancel'){
    $('#pinPad').classList.add('hidden');
    $('#loginPeople').classList.remove('hidden');
    return;
  }
  if(key==='back'){ pinBuf=pinBuf.slice(0,-1); drawDots(); return; }
  const pinLength=pinTarget?.pin?.length||4;
  if(pinBuf.length>=pinLength) return;
  pinBuf+=key;
  drawDots();
  if(pinBuf.length!==pinLength) return;

  const attempted=pinBuf;
  $('#pinError').textContent='Checking PIN…';
  try{
    const result=await API.login(pinTarget.id,attempted);
    const remoteUser=result?.user||result;
    signIn({...pinTarget,...remoteUser,role:normalizeRole(remoteUser?.role||pinTarget.role)});
    API_CONNECTED=true;
    hydrateFromApi();
  } catch(error){
    const localDemo=['localhost','127.0.0.1'].includes(location.hostname)||location.protocol==='file:';
    if(!error?.status&&localDemo&&attempted===pinTarget.pin){
      API_CONNECTED=false;
      signIn(pinTarget);
      toast('Local demo mode · changes stay on this device');
      return;
    }
    $('#pinError').textContent='Wrong PIN, try again';
    pinBuf='';
    setTimeout(drawDots,180);
  }
}
function signIn(person){
  USER={...person,role:normalizeRole(person.role)};
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',hour:'numeric',hourCycle:'h23'}).format(new Date()));
  const part=hour<12?'Morning':hour<17?'Afternoon':'Evening';
  $('#greeting').textContent=`${part}, ${USER.name}`;
  $('#dateline').textContent=new Date().toLocaleDateString('en-US',{
    timeZone:'America/Chicago',weekday:'long',month:'long',day:'numeric',
  });
  $('#avatar').textContent=USER.name[0];
  $('#avatar').style.background=USER.color||'#C9A46B';
  $$('.leader-only').forEach(element=>element.classList.toggle('hidden',!isLeader()));
  $('#tabbar').classList.toggle('five-tabs',isLeader());
  go('today');
  runReminders();
}
function signOut(){
  API.logout().catch(()=>{});
  USER=null;
  VIEW='today';
  $('#app').classList.add('hidden');
  $('#login').classList.remove('hidden');
  $('#pinPad').classList.add('hidden');
  $('#loginPeople').classList.remove('hidden');
}
async function hydrateFromApi(){
  try{
    const remote=await API.state();
    API_CONNECTED=true;
    mergeRemoteState(remote);
    if(USER) go(VIEW);
  } catch(error){ API_CONNECTED=false; }
  if(isLeader()){
    API.alerts().then(alerts=>{
      if(Array.isArray(alerts)){
        S.alerts=alerts;
        saveLocal();
        if(VIEW==='cockpit') go('cockpit');
      }
    }).catch(()=>{});
  }
}

/* ---------------- navigation ---------------- */
function go(view){
  if(view==='cockpit'&&!isLeader()) view='today';
  VIEW=view;
  $$('.tab').forEach(tab=>tab.classList.toggle('active',tab.dataset.view===view));
  const target=$('#view');
  if(view==='today') target.innerHTML=renderToday();
  else if(view==='turns') target.innerHTML=renderTurns();
  else if(view==='water') target.innerHTML=renderWater();
  else if(view==='cockpit') target.innerHTML=renderCockpit();
  else target.innerHTML=renderTeam();
  bindView();
  target.scrollTop=0;
}
function visibleTurns(){
  const turns=[...(S.turns||[])].sort((a,b)=>(a.checkout||'9999').localeCompare(b.checkout||'9999')||(Number(isSameDay(b))-Number(isSameDay(a))));
  if(isLeader()) return turns;
  const mine=turns.filter(turn=>turn.assigned===USER.id);
  const available=turns.filter(turn=>!turn.assigned&&turn.status!=='done');
  return [...mine,...available];
}

/* ---------------- Today and turns ---------------- */
function renderToday(){
  const today=todayISO();
  const toClean=S.turns.filter(turn=>turn.checkout&&turn.checkout<=today&&turn.status!=='done');
  const arriving=S.turns.filter(turn=>turn.checkin===today);
  const testsDue=WATER_ASSETS.filter(asset=>testDue(asset).due);
  const mine=toClean.filter(turn=>turn.assigned===USER.id);
  const available=toClean.filter(turn=>!turn.assigned);
  const list=isLeader()?toClean:[...mine,...available];
  let html=`<div class="stat-row">
    <div class="stat clean"><div class="n">${toClean.length}</div><div class="l">to clean</div></div>
    <div class="stat arrive"><div class="n">${arriving.length}</div><div class="l">arriving</div></div>
    <div class="stat pool"><div class="n">${testsDue.length}</div><div class="l">water tests</div></div>
  </div>`;
  if(isLeader()){
    const urgent=S.alerts.filter(alert=>!alert.resolved&&alert.severity==='urgent').length;
    html+=`<button class="brief-banner" data-open-cockpit>
      <span><b>${urgent} urgent signal${urgent===1?'':'s'}</b><small>${S.tasks.filter(task=>task.status!=='done').length} open tasks · ${S.tickets.filter(ticket=>ticket.status==='open').length} open ticket</small></span>
      <span>View cockpit →</span>
    </button>`;
  }
  html+=`<p class="sec-label">${isLeader()?'Turnovers today':'Your work today'}</p>`;
  html+=list.length?list.map(turnCard).join(''):`<div class="empty"><span class="em-ico">&#9749;</span>Nothing needs you right now.</div>`;
  if(testsDue.length){
    html+=`<p class="sec-label">Water needs you</p>`;
    html+=testsDue.map(asset=>`<div class="wa compact" data-water="${asset.id}">
      <div class="wa-foot"><div><div class="wa-name">${esc(asset.name)}</div>
      <div class="wa-prop">${esc(prop(asset.propertyId).name)} · test due</div></div>
      <button class="assign-chip" data-water="${asset.id}">Log now</button></div></div>`).join('');
  }
  return html;
}
function renderTurns(){
  const turns=visibleTurns();
  return `<p class="sec-label">${isLeader()?'All turnovers':'Assigned & available'}</p>
    ${turns.length?turns.map(turnCard).join(''):'<div class="empty">No upcoming turns.</div>'}`;
}
function turnCard(turn){
  const property=prop(turn.propertyId);
  const {done,total}=turnProgress(turn);
  const percent=total?Math.round(done/total*100):0;
  const sameDay=isSameDay(turn);
  let pill='needs';
  let pillText='Needs cleaning';
  if(['ready','done'].includes(turn.status)){ pill='done'; pillText='Ready'; }
  else if(sameDay){ pill='sameday'; pillText='Same-day turn'; }
  else if(turn.status==='in_progress'){ pill='progress'; pillText='In progress'; }
  const assigned=member(turn.assigned);
  const who=assigned?.name||(turn.assigned?'Assigned team member':'Unassigned');
  const canWork=turn.status!=='done'&&(!turn.assigned||turn.assigned===USER.id||isLeader());
  const action=canWork?`
    <div class="quick-actions">
      ${turn.status==='needs_cleaning'?`<button data-claim="${turn.id}">${turn.assigned?'I’m on it':'Claim · I’m on it'}</button>`:''}
      <button class="quick-done" data-quickdone="${turn.id}">Done</button>
    </div>`:'';
  return `<article class="card ${sameDay&&turn.status!=='done'?'urgent':''}" data-turn="${turn.id}">
    <div class="card-head" style="background-color:${HEAD_TINT[turn.propertyId]||'#2E6E82'}">
      <span class="ch-name">${esc(property.name)}</span><span class="ch-loc">${esc(property.location)}</span>
    </div>
    <div class="card-body">
      <div class="card-copy"><span class="pill ${pill}">${pillText}</span>
        <div class="cb-meta">Out ${fmtDay(turn.checkout)} ${fmtTime(turn.checkoutTime)} · ${esc(who)}</div>
        <div class="turn-window">${sameDay?'Tight window':'Ready window'}: ${fmtTime(turn.checkoutTime)}–${fmtTime(turn.readyBy)}${turn.checkin?` · guests ${fmtDay(turn.checkin)} ${fmtTime(turn.checkinTime)}`:''}</div>
      </div>
      <div class="cb-right"><div class="ring" style="--p:${percent}%"><i>${done}/${total}</i></div><div class="sm">items</div></div>
    </div>${action}</article>`;
}

/* ---------------- Turn checklist ---------------- */
function openTurn(id){
  const turn=S.turns.find(item=>item.id===id);
  if(!turn) return;
  const property=prop(turn.propertyId);
  const list=checklistFor(turn);
  const checks=turnChecks(turn);
  const photos=turnPhotos(turn);
  const groups=[...new Set(list.map(item=>item.group))];
  let body=`<div class="sheet-grab"></div><div class="sheet-title">${esc(property.name)}</div>
    <div class="sheet-sub">Cleaning window ${fmtTime(turn.checkoutTime)}–${fmtTime(turn.readyBy)}${turn.checkin?` · guest in ${fmtDay(turn.checkin)} at ${fmtTime(turn.checkinTime)}`:''}</div>
    <div class="sheet-action-row">
      ${!turn.assigned&&turn.status!=='done'?`<button class="btn primary" data-claim="${turn.id}">I’m on it</button>`:''}
      <button class="btn ghost" data-report="${turn.id}">Report issue</button>
    </div>`;
  if(isLeader()){
    const assigned=member(turn.assigned);
    const who=assigned?.name||(turn.assigned?'Assigned team member':'Unassigned');
    body+=`<div class="row"><span class="pa" style="background:${assigned?.color||'#2b2b30'}">${esc(who[0]||'?')}</span>
      <div><div class="rn">${esc(who)}</div><div class="rr">Assigned cleaner</div></div>
      <button class="assign-chip" data-assign="${turn.id}">${turn.assigned?'Reassign':'Assign'}</button></div>`;
  }
  groups.forEach(group=>{
    body+=`<div class="chk-group-label">${esc(group)}</div>`;
    list.forEach((item,index)=>{
      if(item.group!==group) return;
      const on=Boolean(checks[index]);
      const hasPhoto=Boolean(photos[index]);
      const camera=item.photo?`<button class="cam ${hasPhoto?'has':item.photo==='required'?'req':''}" data-photo="${turn.id}:${index}" aria-label="Add photo">${hasPhoto?'&#10003;':'&#128247;'}</button>`:'';
      body+=`<div class="chk ${on?'on':''}" data-check="${turn.id}:${index}">
        <span class="box">&#10003;</span><span class="lbl">${esc(item.label)}</span>${camera}</div>`;
    });
  });
  const gate=readyGate(turn);
  if(!gate.ok) body+=`<div class="gate-note"><span>&#9888;</span><span>${esc(gate.msg)}</span></div>`;
  body+=`<div class="btn-row">${turn.status==='done'
    ?`<button class="btn ghost" data-reopen="${turn.id}">Re-open turn</button>`
    :`<button class="btn primary" data-done="${turn.id}" ${gate.ok?'':'disabled'}>Done · ready for guest</button>`}</div>`;
  openSheet(body);
}
function readyGate(turn){
  const list=checklistFor(turn);
  const checks=turnChecks(turn);
  const photos=turnPhotos(turn);
  const unchecked=list.filter((_,index)=>!checks[index]).length;
  if(unchecked) return {ok:false,msg:`${unchecked} checklist item${unchecked===1?'':'s'} left.`};
  const missing=list.filter((item,index)=>item.photo==='required'&&!photos[index]).length;
  if(missing) return {ok:false,msg:`${missing} required verification photo${missing===1?'':'s'} left.`};
  return {ok:true};
}
async function claimTurn(id){
  const turn=S.turns.find(item=>item.id===id);
  if(!turn||turn.status==='done') return;
  const previous={assigned:turn.assigned,status:turn.status,startedAt:turn.startedAt};
  Object.assign(turn,{assigned:USER.id,status:'in_progress',startedAt:new Date().toISOString()});
  saveLocal();
  closeSheet();
  go(VIEW);
  toast(`${prop(turn.propertyId).name} is yours`);
  try{
    const remote=await API.patchTurn(id,{status:'in_progress',startedAt:true});
    API_CONNECTED=true;
    Object.assign(turn,remote);
    saveLocal();
    go(VIEW);
  }catch(error){
    API_CONNECTED=false;
    if(error?.status){
      Object.assign(turn,previous);
      saveLocal();
      go(VIEW);
      toast(`Could not claim turn: ${error.message}`);
    }else{
      toast('Started on this phone; cloud sync will retry next time.');
    }
  }
}
function quickDone(id){
  const turn=S.turns.find(item=>item.id===id);
  if(!turn) return;
  if(!readyGate(turn).ok){
    openTurn(id);
    toast('Finish the checklist before marking ready');
    return;
  }
  markDone(id);
}
async function markDone(id){
  const turn=S.turns.find(item=>item.id===id);
  if(!turn||!readyGate(turn).ok) return;
  const previous={status:turn.status,completedAt:turn.completedAt};
  turn.status='done';
  turn.completedAt=new Date().toISOString();
  saveLocal();
  closeSheet();
  go(VIEW);
  toast('Done · ready for guest');
  try{
    const remote=await API.patchTurn(id,{status:'done',completedAt:turn.completedAt});
    API_CONNECTED=true;
    Object.assign(turn,remote);
    saveLocal();
    go(VIEW);
  }catch(error){
    API_CONNECTED=false;
    if(error?.status){
      Object.assign(turn,previous);
      saveLocal();
      go(VIEW);
      toast(`Turn is not complete: ${error.message}`);
    }else{
      toast('Completed on this phone; cloud sync will retry next time.');
    }
  }
}
function reopen(id){
  const turn=S.turns.find(item=>item.id===id);
  if(!turn) return;
  commit(()=>{ turn.status='in_progress'; turn.completedAt=null; },()=>API.patchTurn(id,{status:'in_progress',completedAt:null}),{render:false});
  closeSheet();
  go(VIEW);
  toast('Turn re-opened');
}

/* ---------------- Issue report ---------------- */
function openIssue(turnId){
  const turn=S.turns.find(item=>item.id===turnId);
  if(!turn) return;
  openSheet(`<div class="sheet-grab"></div><div class="sheet-title">Report damage or issue</div>
    <div class="sheet-sub">${esc(prop(turn.propertyId).name)} · alerts the owner team</div>
    <div class="reading-grid issue-grid">
      <div class="field"><label>Type</label><select id="issue-category">
        <option value="damage">Damage</option><option value="maintenance">Maintenance</option>
        <option value="missing">Missing item</option><option value="safety">Safety</option>
      </select></div>
      <div class="field"><label>Severity</label><select id="issue-severity">
        <option value="medium">Needs attention</option><option value="high">Urgent</option><option value="low">Minor</option>
      </select></div>
    </div>
    <div class="field"><label>What happened?</label><input id="issue-summary" maxlength="120" placeholder="Short headline"></div>
    <div class="field"><label>Details</label><textarea id="issue-note" rows="4" placeholder="Location, what you saw, and anything you did"></textarea></div>
    <button class="btn primary" data-submitissue="${turnId}">Send issue report</button>`);
}
function submitIssue(turnId){
  const turn=S.turns.find(item=>item.id===turnId);
  const summary=$('#issue-summary').value.trim();
  if(!summary){ toast('Add a short description'); return; }
  const ticket={
    id:`ticket-${Date.now()}`,turnId,propertyId:turn.propertyId,category:$('#issue-category').value,
    severity:$('#issue-severity').value,summary,note:$('#issue-note').value.trim(),status:'open',
    reportedBy:USER.id,createdAt:new Date().toISOString(),
  };
  const alert={
    id:`alert-${Date.now()}`,type:'ticket',severity:ticket.severity==='high'?'urgent':'watch',
    title:`New ${ticket.category}: ${ticket.summary}`,detail:ticket.note||'Open the ticket for details.',
    propertyId:ticket.propertyId,createdAt:ticket.createdAt,resolved:false,
  };
  commit(()=>{ S.tickets.unshift(ticket); S.alerts.unshift(alert); },()=>API.tickets.create(ticket),{render:false});
  closeSheet();
  go(VIEW);
  toast('Issue sent to the owner team');
}

/* ---------------- Water ---------------- */
function latestReading(assetId){
  return S.readings.filter(reading=>reading.assetId===assetId).sort((a,b)=>b.ts.localeCompare(a.ts))[0]||null;
}
function testDue(asset){
  const reading=latestReading(asset.id);
  if(!reading) return {due:true,days:99};
  const days=Math.max(0,Math.floor((Date.now()-new Date(reading.ts).getTime())/86400000));
  return {due:days>=2,days};
}
function complianceStreak(){
  let streak=0;
  const readings=[...S.readings].sort((a,b)=>b.ts.localeCompare(a.ts));
  for(const reading of readings){
    const asset=WATER_ASSETS.find(item=>item.id===reading.assetId);
    if(!asset||readingStatus(asset.type,reading)!=='good') break;
    streak+=1;
  }
  return streak;
}
function renderWater(){
  const current=WATER_ASSETS.filter(asset=>!testDue(asset).due&&readingStatus(asset.type,latestReading(asset.id)||{})==='good').length;
  let html=`<div class="streak-card"><span class="streak-icon">&#10022;</span><div><b>${complianceStreak()} balanced-log streak</b>
    <small>${current} of ${WATER_ASSETS.length} water assets current · tests every 2 days</small></div></div>
    <p class="sec-label">Pools &amp; hot tubs</p>`;
  html+=WATER_ASSETS.map(asset=>{
    const property=prop(asset.propertyId);
    const reading=latestReading(asset.id);
    const status=reading?readingStatus(asset.type,reading):'bad';
    const tips=reading?doseAdvice(asset.type,reading):['No reading yet, test now'];
    const due=testDue(asset);
    const cells=reading?{
      chlorine:cellClass(asset.type,'chlorine',reading.chlorine),
      ph:cellClass(asset.type,'ph',reading.ph),
      alk:cellClass(asset.type,'alk',reading.alk),
    }:{chlorine:'bad',ph:'bad',alk:'bad'};
    return `<div class="wa" data-water="${asset.id}">
      <div class="wa-top"><div><div class="wa-name">${esc(asset.name)}</div><div class="wa-prop">${esc(property.name)}</div></div>
        <span class="pill ${status==='good'?'ready':status==='warn'?'needs':'sameday'}">${status==='good'?'Balanced':status==='warn'?'Adjust':'Needs care'}</span></div>
      <div class="wa-readout">
        <div class="wa-r ${cells.chlorine}"><div class="v">${reading?.chlorine??'-'}</div><div class="k">Chlorine</div></div>
        <div class="wa-r ${cells.ph}"><div class="v">${reading?.ph??'-'}</div><div class="k">pH</div></div>
        <div class="wa-r ${cells.alk}"><div class="v">${reading?.alk??'-'}</div><div class="k">Alkalinity</div></div>
      </div>
      <div class="dose ${tips.length?'':'ok'}">${tips.length?esc(tips.join(' · ')):'All balanced, no action needed'}</div>
      <div class="wa-foot"><span class="wa-due ${due.due?'over':''}">${reading?`Last tested ${due.days===0?'today':`${due.days}d ago`}`:'Never tested'}${due.due?' · due now':''}</span>
        <button class="btn primary small-btn" data-log="${asset.id}">Log reading</button></div></div>`;
  }).join('');
  html+=`<button class="btn ghost" data-compliance>&#128196; Export compliance log</button>`;
  return html;
}
function cellClass(type,key,value){
  const target=TARGETS[type][key];
  if(value<target[0]||value>target[1]) return key==='chlorine'?'bad':'warn';
  return 'good';
}
function openLog(assetId){
  const asset=WATER_ASSETS.find(item=>item.id===assetId);
  if(!asset) return;
  openSheet(`<div class="sheet-grab"></div><div class="sheet-title">Log reading</div>
    <div class="sheet-sub">${esc(asset.name)} · ${esc(prop(asset.propertyId).name)}</div>
    <div class="reading-grid">
      <div class="field"><label>Chlorine <span class="unit">ppm</span></label><input id="in-cl" type="number" step="0.1" inputmode="decimal" placeholder="1–3"></div>
      <div class="field"><label>pH</label><input id="in-ph" type="number" step="0.1" inputmode="decimal" placeholder="7.2–7.6"></div>
      <div class="field"><label>Alk <span class="unit">ppm</span></label><input id="in-alk" type="number" step="1" inputmode="numeric" placeholder="80–120"></div>
    </div>
    <div class="field"><label>Note (optional)</label><input id="in-note" maxlength="160" placeholder="e.g. added 2 tabs"></div>
    <button class="btn primary" data-savelog="${asset.id}">Save reading</button>`);
}
function saveLog(assetId){
  const chlorine=parseFloat($('#in-cl').value);
  const ph=parseFloat($('#in-ph').value);
  const alk=parseFloat($('#in-alk').value);
  if([chlorine,ph,alk].some(Number.isNaN)){ toast('Fill chlorine, pH, and alkalinity'); return; }
  const reading={
    id:`reading-${Date.now()}`,assetId,ts:new Date().toISOString(),chlorine,ph,alk,
    note:$('#in-note').value.trim(),recordedBy:USER.id,
  };
  commit(()=>S.readings.push(reading),()=>API.logWater(reading),{render:false});
  closeSheet();
  go('water');
  toast('Reading saved');
}
function exportCompliance(){
  const rows=[...S.readings].sort((a,b)=>b.ts.localeCompare(a.ts)).map(reading=>{
    const asset=WATER_ASSETS.find(item=>item.id===reading.assetId);
    const property=prop(asset?.propertyId);
    const when=new Date(reading.ts).toLocaleString('en-US',{timeZone:'America/Chicago'});
    return `<tr><td>${esc(when)}</td><td>${esc(property.name)}</td><td>${esc(asset?.name||'')}</td><td>${reading.chlorine}</td><td>${reading.ph}</td><td>${reading.alk}</td><td>${esc(reading.note||'')}</td></tr>`;
  }).join('');
  const printWindow=window.open('','_blank');
  if(!printWindow){ toast('Allow pop-ups to export'); return; }
  printWindow.document.write(`<html><head><title>STR Water Compliance Log</title><style>
    body{font-family:Georgia,serif;padding:32px;color:#111}h1{font-size:20px}.sub{color:#555;margin-bottom:18px}
    table{width:100%;border-collapse:collapse;font-size:13px}th,td{border:1px solid #ccc;padding:7px;text-align:left}th{background:#f2efe9}
    </style></head><body><h1>Short Term Retreats | Water Compliance Log</h1>
    <div class="sub">America/Chicago · generated ${esc(new Date().toLocaleString('en-US',{timeZone:'America/Chicago'}))}</div>
    <table><thead><tr><th>Date/time</th><th>Property</th><th>Asset</th><th>Cl</th><th>pH</th><th>Alk</th><th>Note</th></tr></thead><tbody>${rows}</tbody></table></body></html>`);
  printWindow.document.close();
  setTimeout(()=>printWindow.print(),300);
}

/* ---------------- Owner cockpit ---------------- */
function money(cents){ return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format((Number(cents)||0)/100); }
function goalDisplay(goal,value){
  if(goal.unit==='cents') return money(value);
  if(goal.unit==='percent') return `${value}%`;
  return Number(value).toFixed(2);
}
function renderCockpit(){
  if(!isLeader()) return '';
  const totals=S.financials.reduce((sum,row)=>({
    revenue:sum.revenue+(Number(row.revenueCents)||0),
    expenses:sum.expenses+(Number(row.expensesCents)||0),
    payouts:sum.payouts+(Number(row.cleanerPayoutCents)||0),
  }),{revenue:0,expenses:0,payouts:0});
  const net=totals.revenue-totals.expenses-totals.payouts;
  const openAlerts=S.alerts.filter(alert=>!alert.resolved);
  const openTasks=S.tasks.filter(task=>task.status!=='done');
  let html=`<div class="cockpit-head"><div><span class="eyebrow">Owner cockpit</span><h1>The business, at a glance.</h1></div>
    <span class="live-dot ${API_CONNECTED?'online':''}">${API_CONNECTED?'Live':'Demo'}</span></div>
    <div class="money-grid">
      <div class="money-card hero"><small>Revenue</small><b>${money(totals.revenue)}</b><span>this month</span></div>
      <div class="money-card"><small>Net operating</small><b>${money(net)}</b><span>after costs + payouts</span></div>
      <div class="money-card"><small>Property costs</small><b>${money(totals.expenses)}</b><span>recorded expenses</span></div>
      <div class="money-card"><small>Cleaner pay</small><b>${money(totals.payouts)}</b><span>projected payouts</span></div>
    </div>
    <div class="section-heading"><p class="sec-label">Needs attention</p><span>${openAlerts.length} open</span></div>
    <div class="alert-stack">${openAlerts.map(alertCard).join('')}</div>
    <div class="section-heading"><p class="sec-label">Goals</p><span>${S.goals.length} tracked</span></div>
    <div class="goal-list">${S.goals.map(goalCard).join('')}</div>
    <div class="section-heading"><p class="sec-label">Owner tasks</p><button data-addtask>+ Add</button></div>
    <div class="task-list">${openTasks.length?openTasks.map(taskCard).join(''):'<div class="empty compact-empty">No open tasks.</div>'}</div>
    <div class="section-heading"><p class="sec-label">Property numbers</p><button data-addfinancial>+ Add</button></div>
    <div class="finance-list">${S.financials.map(financialRow).join('')}</div>`;
  return html;
}
function alertCard(alert){
  return `<div class="alert-card ${alert.severity==='urgent'?'urgent':'watch'}">
    <span class="alert-mark">${alert.severity==='urgent'?'!':'·'}</span><div><b>${esc(alert.title)}</b>
    <small>${esc(alert.detail)}</small><em>${esc(prop(alert.propertyId).name)}</em></div>
    <button data-dismissalert="${alert.id}" aria-label="Dismiss alert">×</button></div>`;
}
function goalCard(goal){
  const percent=Math.min(100,Math.max(0,Math.round((Number(goal.current)||0)/(Number(goal.target)||1)*100)));
  return `<div class="goal-card"><div><b>${esc(goal.title)}</b><small>${esc(goal.period||'')}</small></div>
    <strong>${goalDisplay(goal,goal.current)} <i>/ ${goalDisplay(goal,goal.target)}</i></strong>
    <div class="goal-track"><span style="width:${percent}%"></span></div></div>`;
}
function taskCard(task){
  const assigned=member(task.assigneeId);
  const overdue=task.dueDate&&task.dueDate<todayISO();
  return `<div class="task-card ${overdue?'overdue':''}"><button data-taskdone="${task.id}" aria-label="Complete task">&#10003;</button>
    <div><b>${esc(task.title)}</b><small>${esc(prop(task.propertyId).name)} · ${assigned?.name||'Unassigned'} · ${overdue?'Overdue':fmtDay(task.dueDate)}</small></div>
    <span>${task.priority==='high'?'High':'Open'}</span></div>`;
}
function financialRow(row){
  const net=(Number(row.revenueCents)||0)-(Number(row.expensesCents)||0)-(Number(row.cleanerPayoutCents)||0);
  return `<div class="finance-row"><div><b>${esc(prop(row.propertyId).name)}</b><small>${esc(row.month)}</small></div>
    <div><strong>${money(row.revenueCents)}</strong><small>${money(net)} net</small></div></div>`;
}
function openTaskForm(){
  openSheet(`<div class="sheet-grab"></div><div class="sheet-title">Add owner task</div>
    <div class="field"><label>Task</label><input id="task-title" maxlength="120" placeholder="What needs to happen?"></div>
    <div class="reading-grid issue-grid">
      <div class="field"><label>Property</label><select id="task-property">${PROPERTIES.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Owner</label><select id="task-owner">${TEAM.filter(item=>item.role!=='cleaner').map(item=>`<option value="${item.id}">${esc(item.name)}</option>`).join('')}</select></div>
    </div>
    <div class="reading-grid issue-grid">
      <div class="field"><label>Due date</label><input id="task-due" type="date" value="${addDays(1)}"></div>
      <div class="field"><label>Priority</label><select id="task-priority"><option value="normal">Normal</option><option value="high">High</option></select></div>
    </div>
    <button class="btn primary" data-savetask>Save task</button>`);
}
function saveTask(){
  const title=$('#task-title').value.trim();
  if(!title){ toast('Give the task a name'); return; }
  const task={
    id:`task-${Date.now()}`,title,propertyId:$('#task-property').value,assigneeId:$('#task-owner').value,
    priority:$('#task-priority').value,dueDate:$('#task-due').value,status:'open',
  };
  commit(()=>S.tasks.unshift(task),()=>API.tasks.create(task),{render:false});
  closeSheet();
  go('cockpit');
  toast('Task added');
}
function openFinancialForm(){
  openSheet(`<div class="sheet-grab"></div><div class="sheet-title">Add property numbers</div>
    <div class="reading-grid issue-grid">
      <div class="field"><label>Property</label><select id="fin-property">${PROPERTIES.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Month</label><input id="fin-month" type="month" value="${todayISO().slice(0,7)}"></div>
    </div>
    <div class="field"><label>Revenue ($)</label><input id="fin-revenue" type="number" min="0" step="1" inputmode="decimal"></div>
    <div class="reading-grid issue-grid">
      <div class="field"><label>Expenses ($)</label><input id="fin-expenses" type="number" min="0" step="1"></div>
      <div class="field"><label>Cleaner payouts ($)</label><input id="fin-payouts" type="number" min="0" step="1"></div>
    </div>
    <button class="btn primary" data-savefinancial>Save snapshot</button>`);
}
function saveFinancial(){
  const revenue=Number($('#fin-revenue').value);
  if(!Number.isFinite(revenue)||revenue<0){ toast('Add valid revenue'); return; }
  const row={
    id:`financial-${Date.now()}`,propertyId:$('#fin-property').value,month:$('#fin-month').value,
    revenueCents:Math.round(revenue*100),expensesCents:Math.round((Number($('#fin-expenses').value)||0)*100),
    cleanerPayoutCents:Math.round((Number($('#fin-payouts').value)||0)*100),
  };
  const existingIndex=S.financials.findIndex(item=>item.propertyId===row.propertyId&&item.month===row.month);
  if(existingIndex>=0) row.id=S.financials[existingIndex].id;
  commit(()=>{
    if(existingIndex>=0) S.financials.splice(existingIndex,1,row);
    else S.financials.unshift(row);
  },()=>API.financials.create(row),{render:false});
  closeSheet();
  go('cockpit');
  toast('Numbers added');
}

/* ---------------- Team and assignment ---------------- */
function renderTeam(){
  let html=`<p class="sec-label">The team</p>`;
  html+=TEAM.map(person=>`<div class="row"><span class="pa" style="background:${person.color};color:#20180a">${esc(person.name[0])}</span>
    <div><div class="rn">${esc(person.name)}</div><div class="rr">${roleLabel(normalizeRole(person.role))}${person.role==='owner'?' · business + operations':person.role==='manager'?' · operations control':''}</div></div>
    <span class="badge ${person.role!=='cleaner'?'admin':''}">${roleLabel(normalizeRole(person.role))}</span></div>`).join('');
  if(isLeader()){
    html+=`<p class="sec-label">Leader tools</p>
      <button class="btn ghost" data-autoassign>&#9851; Auto-assign open turns</button>
      <button class="btn danger-outline" data-reset>Reset local demo</button>
      <p class="admin-note">Signed in as ${esc(USER.name)} · ${roleLabel(USER.role)}.</p>`;
  } else {
    html+=`<p class="admin-note">You can claim available turns, complete your checklist, log water, and report issues.</p>`;
  }
  return html;
}
function autoAssignAll(){
  const cleaners=TEAM.filter(person=>person.role==='cleaner');
  const load=Object.fromEntries(cleaners.map(cleaner=>[cleaner.id,S.turns.filter(turn=>turn.assigned===cleaner.id&&turn.status!=='done').length]));
  const patches=[];
  commit(()=>{
    S.turns.filter(turn=>turn.status!=='done'&&!turn.assigned).forEach(turn=>{
      const choice=[...cleaners].sort((a,b)=>load[a.id]-load[b.id])[0];
      turn.assigned=choice.id;
      load[choice.id]+=1;
      patches.push({id:turn.id,assigned:choice.id});
    });
  },()=>Promise.all(patches.map(patch=>API.patchTurn(patch.id,{assigned:patch.assigned}))));
  toast('Open turns assigned');
}
function openAssign(turnId){
  const turn=S.turns.find(item=>item.id===turnId);
  if(!turn) return;
  const cleaners=TEAM.filter(person=>person.role==='cleaner');
  const load=id=>S.turns.filter(item=>item.assigned===id&&item.status!=='done').length;
  const suggested=[...cleaners].sort((a,b)=>load(a.id)-load(b.id))[0];
  openSheet(`<div class="sheet-grab"></div><div class="sheet-title">Assign cleaner</div>
    <div class="sheet-sub">${esc(prop(turn.propertyId).name)} · ${fmtDay(turn.checkout)}</div>
    <div class="gate-note water-note"><span>&#9851;</span><span>Suggested: <b>${esc(suggested.name)}</b>, with the fewest open turns.</span></div>
    <div class="pick-list">${cleaners.map(cleaner=>`<button data-pick="${turn.id}:${cleaner.id}" class="${cleaner.id===suggested.id?'sel':''}">
      <span class="pa" style="background:${cleaner.color}">${esc(cleaner.name[0])}</span>
      <span>${esc(cleaner.name)}<div class="mini">${load(cleaner.id)} open turn${load(cleaner.id)===1?'':'s'}</div></span></button>`).join('')}</div>`);
}
function pickCleaner(turnId,cleanerId){
  const turn=S.turns.find(item=>item.id===turnId);
  if(!turn) return;
  commit(()=>{ turn.assigned=cleanerId; },()=>API.patchTurn(turnId,{assigned:cleanerId}),{render:false});
  closeSheet();
  go(VIEW);
  toast('Cleaner assigned');
}

/* ---------------- reminders, sheet, bindings ---------------- */
function runReminders(){
  const sameDay=S.turns.filter(turn=>isSameDay(turn)&&turn.status!=='done').length;
  const tests=WATER_ASSETS.filter(asset=>testDue(asset).due).length;
  const messages=[];
  if(sameDay) messages.push(`${sameDay} same-day turn${sameDay===1?'':'s'}`);
  if(tests) messages.push(`${tests} water test${tests===1?'':'s'} due`);
  if(messages.length) setTimeout(()=>toast(`Heads up: ${messages.join(' · ')}`),650);
}
function openSheet(html){ $('#sheetBody').innerHTML=html; $('#sheet').classList.remove('hidden'); }
function closeSheet(){ $('#sheet').classList.add('hidden'); }
let toastTimer;
function toast(message){
  const element=$('#toast');
  element.textContent=message;
  element.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>element.classList.add('hidden'),2600);
}
function bindView(){
  $$('[data-turn]').forEach(element=>element.onclick=()=>openTurn(element.dataset.turn));
  $$('[data-claim]').forEach(element=>element.onclick=event=>{ event.stopPropagation(); claimTurn(element.dataset.claim); });
  $$('[data-quickdone]').forEach(element=>element.onclick=event=>{ event.stopPropagation(); quickDone(element.dataset.quickdone); });
  $$('[data-log]').forEach(element=>element.onclick=event=>{ event.stopPropagation(); openLog(element.dataset.log); });
  $$('[data-water]').forEach(element=>element.onclick=event=>{
    const trigger=event.target.closest('[data-water]');
    if(trigger&&trigger!==element){ event.stopPropagation(); openLog(trigger.dataset.water); }
  });
  $$('[data-open-cockpit]').forEach(element=>element.onclick=()=>go('cockpit'));
  $$('[data-compliance]').forEach(element=>element.onclick=exportCompliance);
  $$('[data-addtask]').forEach(element=>element.onclick=openTaskForm);
  $$('[data-addfinancial]').forEach(element=>element.onclick=openFinancialForm);
  $$('[data-taskdone]').forEach(element=>element.onclick=()=>{
    const task=S.tasks.find(item=>item.id===element.dataset.taskdone);
    if(!task) return;
    commit(()=>{ task.status='done'; task.completedAt=new Date().toISOString(); },()=>API.tasks.update(task.id,{status:'done',completedAt:task.completedAt}));
    toast('Task complete');
  });
  $$('[data-dismissalert]').forEach(element=>element.onclick=()=>{
    const alert=S.alerts.find(item=>item.id===element.dataset.dismissalert);
    if(!alert) return;
    commit(()=>{ alert.resolved=true; },null);
  });
  $$('[data-autoassign]').forEach(element=>element.onclick=autoAssignAll);
  $$('[data-reset]').forEach(element=>element.onclick=()=>{
    if(confirm('Reset all local demo changes?')){
      DB.reset();
      S=DB.load();
      go(VIEW);
      toast('Demo reset');
    }
  });
}

$('#sheet').addEventListener('click',event=>{
  if(event.target.closest('[data-close]')){ closeSheet(); return; }
  const check=event.target.closest('[data-check]');
  if(check&&!event.target.closest('[data-photo]')){
    const [id,index]=check.dataset.check.split(':');
    const turn=S.turns.find(item=>item.id===id);
    if(!isLeader()&&turn?.assigned!==USER.id){
      toast('Claim this turn before updating its checklist');
      return;
    }
    const checked=!(S.checks[id]||{})[index];
    commit(()=>{
      S.checks[id]=S.checks[id]||{};
      S.checks[id][index]=checked;
      if(turn?.status==='needs_cleaning') turn.status='in_progress';
    },()=>API.putCheck(id,Number(index),checked),{render:false});
    openTurn(id);
    return;
  }
  const photo=event.target.closest('[data-photo]');
  if(photo){ const [id,index]=photo.dataset.photo.split(':'); capturePhoto(id,index); return; }
  const done=event.target.closest('[data-done]');
  if(done&&!done.disabled){ markDone(done.dataset.done); return; }
  const reopenButton=event.target.closest('[data-reopen]');
  if(reopenButton){ reopen(reopenButton.dataset.reopen); return; }
  const claim=event.target.closest('[data-claim]');
  if(claim){ claimTurn(claim.dataset.claim); return; }
  const report=event.target.closest('[data-report]');
  if(report){ openIssue(report.dataset.report); return; }
  const submit=event.target.closest('[data-submitissue]');
  if(submit){ submitIssue(submit.dataset.submitissue); return; }
  const assign=event.target.closest('[data-assign]');
  if(assign){ openAssign(assign.dataset.assign); return; }
  const pick=event.target.closest('[data-pick]');
  if(pick){ const [turnId,cleanerId]=pick.dataset.pick.split(':'); pickCleaner(turnId,cleanerId); return; }
  const saveWater=event.target.closest('[data-savelog]');
  if(saveWater){ saveLog(saveWater.dataset.savelog); return; }
  if(event.target.closest('[data-savetask]')){ saveTask(); return; }
  if(event.target.closest('[data-savefinancial]')) saveFinancial();
});
function capturePhoto(id,index){
  const input=document.createElement('input');
  input.type='file';
  input.accept='image/*';
  input.capture='environment';
  input.onchange=async()=>{
    const file=input.files[0];
    if(!file) return;
    toast('Uploading verification photo…');
    try{
      const uploaded=await API.uploadPhoto(file);
      await API.putCheck(id,Number(index),Boolean((S.checks[id]||{})[index]),uploaded.key);
      API_CONNECTED=true;
      S.photos[id]=S.photos[id]||{};
      S.photos[id][index]=uploaded.key;
      saveLocal();
      openTurn(id);
      toast('Verification photo synced');
    }catch(error){
      API_CONNECTED=false;
      S.photos[id]=S.photos[id]||{};
      S.photos[id][index]=`local-demo-${Date.now()}`;
      saveLocal();
      openTurn(id);
      toast('Photo counted for this local demo only; cloud upload did not complete.');
    }
  };
  input.click();
}

/* ---------------- boot ---------------- */
$$('.tab').forEach(tab=>tab.onclick=()=>go(tab.dataset.view));
$('#signout').onclick=signOut;
$('#pinPad').addEventListener('click',event=>{
  const key=event.target.closest('button[data-k]');
  if(key) pinKey(key.dataset.k);
});
renderLogin();

if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});
