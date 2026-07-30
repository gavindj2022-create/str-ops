/* STR Ops phone-first application. The API is authoritative when connected;
   loopback/offline use falls back to synthetic state stored on this device. */
let USER=null;
let VIEW='today';
let S=DB.load();
let API_CONNECTED=false;
let WATER_DRAFTS={};

const API=window.STRApi;
const $=(selector,root=document)=>root.querySelector(selector);
const $$=(selector,root=document)=>[...root.querySelectorAll(selector)];
const prop=id=>PROPERTIES.find(item=>item.id===id)||{id,name:'Unknown property',location:'',hasPool:false,hasHotTub:false};
const member=id=>TEAM.find(item=>item.id===id)||null;
const normalizeRole=role=>role==='admin'?'manager':role;
const isLeaderRole=role=>['dev','owner','manager'].includes(normalizeRole(role));
const isLeader=()=>USER&&isLeaderRole(USER.role);
const roleLabel=role=>({dev:'Dev',owner:'Owner',manager:'House Manager',cleaner:'Worker',admin:'House Manager'}[role]||'Team');
const displayRole=person=>person?.title||roleLabel(normalizeRole(person?.role));
const propertyColor=id=>prop(id).color||HEAD_TINT[id]||'#2E6E82';
const propertyEmoji=id=>prop(id).emoji||'🏠';
const assignableWorkers=()=>TEAM.filter(person=>person.canWork!==false&&person.id!=='gale');
const photoSrc=key=>key&&(API.photoUrl?API.photoUrl(key):`/api/photos/${String(key).split('/').map(encodeURIComponent).join('/')}`);
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const HEAD_TINT={millpoint:'#1F4E5F',westgate:'#6b4f8a',galena:'#8a6b4f',hickory:'#2E6E82'};
const GROUP_ROLE={laundry:'laundry',pool:'water','hot tub':'water',finish:'inspect',supplies:'supplies',maintenance:'maintenance'};

function roleMap(){ return S.roleMap||HOUSE_ROLES||{}; }
function roleDef(id){ return WORK_ROLES.find(role=>role.id===id)||{id,label:id||'Work',emoji:'•'}; }
function itemRole(item){
  if(item?.role) return item.role;
  const group=String(item?.group||'').toLowerCase();
  const label=String(item?.label||'').toLowerCase();
  if(group.includes('laundry')||label.includes('linen')||label.includes('towel')) return 'laundry';
  if(group.includes('pool')||group.includes('hot tub')||label.includes('chemistry')) return 'water';
  if(group.includes('finish')||label.includes('walkthrough')) return 'inspect';
  if(label.includes('restock')||label.includes('suppl')) return 'supplies';
  if(group.includes('maintenance')) return 'maintenance';
  return GROUP_ROLE[group]||'clean';
}
function roleIdsForProperty(propertyId){
  return Object.keys(roleMap()[propertyId]||{}).filter(role=>(roleMap()[propertyId][role]||[]).length);
}
function roleMembers(propertyId,role){
  const ids=roleMap()[propertyId]?.[role]||[];
  return ids.map(member).filter(Boolean);
}
function roleNames(propertyId,role){
  const people=roleMembers(propertyId,role);
  return people.length?people.map(person=>person.name).join(', '):'Unassigned';
}
function userRolesForProperty(propertyId,userId=USER?.id){
  if(!userId) return [];
  return roleIdsForProperty(propertyId).filter(role=>(roleMap()[propertyId]?.[role]||[]).includes(userId));
}
function userHasRoleForProperty(propertyId,userId=USER?.id){ return userRolesForProperty(propertyId,userId).length>0; }
function roleChip(propertyId,role,{mine=false}={}){
  const def=roleDef(role);
  return `<span class="role-chip ${mine?'mine':''}">${def.emoji} ${esc(def.label)} <i>${esc(roleNames(propertyId,role))}</i></span>`;
}
function roleSummary(propertyId,{limit=4,onlyMine=false}={}){
  let roles=roleIdsForProperty(propertyId);
  if(onlyMine) roles=roles.filter(role=>(roleMap()[propertyId]?.[role]||[]).includes(USER?.id));
  return roles.slice(0,limit).map(role=>roleChip(propertyId,role,{mine:userRolesForProperty(propertyId).includes(role)})).join('');
}
function myLaneText(propertyId){
  const roles=userRolesForProperty(propertyId);
  if(!roles.length) return '';
  return roles.map(role=>`${roleDef(role).emoji} ${roleDef(role).label}`).join(' + ');
}
function roleCandidatePeople(propertyId){
  const ids=new Set([...assignableWorkers().map(person=>person.id)]);
  Object.values(roleMap()[propertyId]||{}).flat().forEach(id=>ids.add(id));
  return TEAM.filter(person=>ids.has(person.id));
}
function defaultTurnOwner(turn){
  return roleMembers(turn.propertyId,'clean')[0]||roleCandidatePeople(turn.propertyId)[0]||assignableWorkers()[0]||null;
}

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
  S.roleMap=S.roleMap||HOUSE_ROLES;
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
      <span><span class="pn">${esc(person.name)}</span><span class="pr">${esc(displayRole(person))}</span></span>`;
    button.onclick=()=>openPin(person);
    wrap.appendChild(button);
  });
}
let pinTarget=null;
let pinBuf='';
const isPrivateLanHost=host=>/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)
  || /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
  || /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host);
const isLocalDemo=()=>['localhost','127.0.0.1'].includes(location.hostname)||isPrivateLanHost(location.hostname)||location.protocol==='file:';
async function attemptLogin(person,attempted,{showChecking=false,showErrors=false,quick=false}={}){
  if(showChecking) $('#pinError').textContent='Checking PIN…';
  try{
    const result=await API.login(person.id,attempted);
    const remoteUser=result?.user||result;
    signIn({...person,...remoteUser,role:normalizeRole(remoteUser?.role||person.role)});
    API_CONNECTED=true;
    hydrateFromApi();
    return true;
  } catch(error){
    if(!error?.status&&isLocalDemo()&&attempted===person.pin){
      API_CONNECTED=false;
      signIn(person);
      toast('Local demo mode · changes stay on this device');
      return true;
    }
    if(quick){
      toast('Could not sign in. Refresh the local demo seed and try again.');
    }else if(showErrors){
      $('#pinError').textContent='Wrong PIN, try again';
    }
    return false;
  }
}
function openPin(person){
  pinTarget=person;
  pinBuf='';
  if(isLocalDemo()){
    attemptLogin(person,person.pin,{quick:true});
    return;
  }
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
  const ok=await attemptLogin(pinTarget,attempted,{showChecking:true,showErrors:true});
  if(!ok){
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
  const roleTurns=turns.filter(turn=>turn.status!=='done'&&userHasRoleForProperty(turn.propertyId));
  const available=turns.filter(turn=>!turn.assigned&&turn.status!=='done');
  return [...new Map([...mine,...roleTurns,...available].map(turn=>[turn.id,turn])).values()];
}

/* ---------------- Today and turns ---------------- */
function renderToday(){
  const today=todayISO();
  const toClean=S.turns.filter(turn=>turn.checkout&&turn.checkout<=today&&turn.status!=='done');
  const arriving=S.turns.filter(turn=>turn.checkin===today);
  const testsDue=WATER_ASSETS.filter(asset=>testDue(asset).due);
  const mine=toClean.filter(turn=>turn.assigned===USER.id);
  const roleTurns=toClean.filter(turn=>userHasRoleForProperty(turn.propertyId));
  const available=toClean.filter(turn=>!turn.assigned);
  const list=isLeader()?toClean:[...new Map([...mine,...roleTurns,...available].map(turn=>[turn.id,turn])).values()];
  let html=`<div class="stat-row">
    <div class="stat clean"><div class="n">${toClean.length}</div><div class="l">Clean today</div></div>
    <div class="stat arrive"><div class="n">${arriving.length}</div><div class="l">Guests today</div></div>
    <div class="stat pool"><div class="n">${testsDue.length}</div><div class="l">Water checks</div></div>
  </div>`;
  if(isLeader()){
    const urgent=S.alerts.filter(alert=>!alert.resolved&&alert.severity==='urgent').length;
    html+=`<button class="brief-banner" data-open-cockpit>
      <span><b>${urgent} urgent signal${urgent===1?'':'s'}</b><small>${S.tasks.filter(task=>task.status!=='done').length} open tasks · ${S.tickets.filter(ticket=>ticket.status==='open').length} open ticket</small></span>
      <span>Open cockpit</span>
    </button>`;
  }
  const laneRows=PROPERTIES.map(property=>({property,roles:userRolesForProperty(property.id)})).filter(row=>row.roles.length);
  if(laneRows.length){
    html+=`<div class="lane-card"><div><b>Your house lanes</b><small>Default roles for each house. Ana can still override individual turns.</small></div>
      <div class="lane-list">${laneRows.map(row=>`<span>${propertyEmoji(row.property.id)} ${esc(row.property.name)}: ${row.roles.map(role=>`${roleDef(role).emoji} ${esc(roleDef(role).label)}`).join(' + ')}</span>`).join('')}</div></div>`;
  }
  html+=`<p class="sec-label">${isLeader()?'Turnovers today':'Your work today'}</p>`;
  html+=list.length?list.map(turnCard).join(''):`<div class="empty"><span class="em-ico">&#9749;</span>Nothing needs you right now.</div>`;
  if(testsDue.length){
    html+=`<p class="sec-label">Water needs you</p>`;
    html+=testsDue.map(asset=>`<div class="wa compact" data-water="${asset.id}">
      <div class="wa-foot"><div><div class="wa-name">${esc(asset.name)}</div>
      <div class="wa-prop">${propertyEmoji(asset.propertyId)} ${esc(prop(asset.propertyId).name)} · test due</div></div>
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
  const lane=myLaneText(turn.propertyId);
  const roles=roleSummary(turn.propertyId,{limit:4});
  const canWork=turn.status!=='done'&&(!turn.assigned||turn.assigned===USER.id||isLeader());
  const action=canWork?`
    <div class="quick-actions">
      ${turn.status==='needs_cleaning'?`<button data-claim="${turn.id}">${turn.assigned?'Start work':'Claim + Start'}</button>`:''}
      <button class="quick-done" data-quickdone="${turn.id}">Done</button>
    </div>`:'';
  return `<article class="card ${sameDay&&turn.status!=='done'?'urgent':''}" data-turn="${turn.id}">
    <div class="card-head" style="background-color:${propertyColor(turn.propertyId)}">
      <span class="home-badge">${propertyEmoji(turn.propertyId)}</span><span class="ch-name">${esc(property.name)}</span><span class="ch-loc">${esc(property.location)}</span>
    </div>
    <div class="card-body">
      <div class="card-copy"><span class="pill ${pill}">${pillText}</span>
        <div class="cb-meta">Out ${fmtDay(turn.checkout)} ${fmtTime(turn.checkoutTime)} · ${esc(who)}</div>
        <div class="turn-window">${sameDay?'Tight window':'Ready window'}: ${fmtTime(turn.checkoutTime)}–${fmtTime(turn.readyBy)}${turn.checkin?` · guests ${fmtDay(turn.checkin)} ${fmtTime(turn.checkinTime)}`:''}</div>
        ${lane?`<div class="lane-line">Your lane: ${esc(lane)}</div>`:''}
        <div class="role-strip">${roles}</div>
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
  const groupHasMyLane=group=>list.some(item=>item.group===group&&userRolesForProperty(turn.propertyId).includes(itemRole(item)));
  const groups=[...new Set(list.map(item=>item.group))].sort((a,b)=>Number(groupHasMyLane(b))-Number(groupHasMyLane(a)));
  let body=`<div class="sheet-grab"></div><div class="sheet-title">${esc(property.name)}</div>
    <div class="sheet-sub">${propertyEmoji(turn.propertyId)} Cleaning window ${fmtTime(turn.checkoutTime)}–${fmtTime(turn.readyBy)}${turn.checkin?` · guest in ${fmtDay(turn.checkin)} at ${fmtTime(turn.checkinTime)}`:''}</div>
    <div class="plain-note"><b>House roles</b> split the work by lane. <b>Claim + Start</b> still marks the overall turn as started so Ana can see progress.</div>
    <div class="role-map-card"><b>House role map</b><div class="role-strip">${roleSummary(turn.propertyId,{limit:8})}</div></div>
    <div class="sheet-action-row">
      ${!turn.assigned&&turn.status!=='done'?`<button class="btn primary" data-claim="${turn.id}">Claim + Start</button>`:''}
      <button class="btn ghost" data-report="${turn.id}">Report issue</button>
    </div>`;
  if(isLeader()){
    const assigned=member(turn.assigned);
    const who=assigned?.name||(turn.assigned?'Assigned team member':'Unassigned');
    body+=`<div class="row"><span class="pa" style="background:${assigned?.color||'#2b2b30'}">${esc(who[0]||'?')}</span>
      <div><div class="rn">${esc(who)}</div><div class="rr">Assigned team member</div></div>
      <button class="assign-chip" data-assign="${turn.id}">${turn.assigned?'Reassign':'Assign'}</button></div>`;
  }
  groups.forEach(group=>{
    const groupRole=itemRole(list.find(item=>item.group===group));
    const def=roleDef(groupRole);
    const myLane=userRolesForProperty(turn.propertyId).includes(groupRole);
    body+=`<div class="chk-group-label ${myLane?'mine':''}"><span>${esc(group)}</span><small>${def.emoji} ${esc(def.label)} · ${esc(roleNames(turn.propertyId,groupRole))}</small></div>`;
    list.forEach((item,index)=>{
      if(item.group!==group) return;
      const on=Boolean(checks[index]);
      const hasPhoto=Boolean(photos[index]);
      const role=itemRole(item);
      const def=roleDef(role);
      const myItem=userRolesForProperty(turn.propertyId).includes(role);
      const helper=`${myItem?'Your lane · ':''}${def.emoji} ${def.label}: ${roleNames(turn.propertyId,role)} · ${on?'Tap again to undo':'Tap when finished'}`;
      const camera=item.photo?`<button class="cam ${hasPhoto?'has':item.photo==='required'?'req':''}" data-photo="${turn.id}:${index}" aria-label="Add photo">${hasPhoto?'&#10003;':'&#128247;'}</button>`:'';
      body+=`<div class="chk ${on?'on':''} ${myItem?'mine':'other-lane'}" data-check="${turn.id}:${index}">
        <span class="box">&#10003;</span><span class="lbl"><span class="chk-text">${esc(item.label)}</span><small>${esc(helper)}</small></span>${camera}</div>`;
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
async function toggleCheck(id,index){
  const turn=S.turns.find(item=>item.id===id);
  if(!turn) return;
  if(!isLeader()&&turn.assigned!==USER.id){
    toast('Claim this turn before updating its checklist');
    return;
  }
  const previous={
    checked:Boolean((S.checks[id]||{})[index]),
    status:turn.status,
    completedAt:turn.completedAt,
  };
  const checked=!previous.checked;
  S.checks[id]=S.checks[id]||{};
  S.checks[id][index]=checked;
  if(checked&&turn.status==='needs_cleaning') turn.status='in_progress';
  if(!checked&&['ready','done'].includes(turn.status)){
    turn.status='in_progress';
    turn.completedAt=null;
  }
  saveLocal();
  openTurn(id);
  toast(checked?'Item checked':'Item unchecked');
  try{
    await API.putCheck(id,Number(index),checked);
    if(turn.status!==previous.status||turn.completedAt!==previous.completedAt){
      await API.patchTurn(id,{status:turn.status,completedAt:turn.completedAt});
    }
    API_CONNECTED=true;
  }catch(error){
    API_CONNECTED=false;
    if(error?.status){
      S.checks[id][index]=previous.checked;
      turn.status=previous.status;
      turn.completedAt=previous.completedAt;
      saveLocal();
      openTurn(id);
      toast(`Checklist change failed: ${error.message}`);
    }else{
      toast('Saved on this phone; cloud sync is offline.');
    }
  }
}

/* ---------------- Issue report ---------------- */
function openIssue(turnId){
  const turn=S.turns.find(item=>item.id===turnId);
  if(!turn) return;
  openSheet(`<div class="sheet-grab"></div><div class="sheet-title">Report damage or issue</div>
    <div class="sheet-sub">${esc(prop(turn.propertyId).name)} - alerts the leadership team</div>
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
  toast('Issue sent to the leadership team');
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
  let html=`<div class="streak-card"><span class="streak-icon">&#10022;</span><div><b>${complianceStreak()} safe water streak</b>
    <small>${current} of ${WATER_ASSETS.length} water assets current · tests every 2 days</small></div></div>
    <div class="scan-card"><span class="streak-icon">&#128247;</span><div><b>Photo Test Log</b><small>Take a kit photo, type the 3 numbers, and STR Ops keeps the reading plus the photo.</small></div></div>
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
    const thumb=reading?.photoKey?`<img class="water-thumb" src="${esc(photoSrc(reading.photoKey))}" alt="Pool kit photo">`:'';
    const photoBadge=reading?.photoKey?'<span class="photo-badge">Kit photo saved</span>':'';
    return `<div class="wa" data-water="${asset.id}">
      <div class="wa-top"><div><div class="wa-name">${propertyEmoji(asset.propertyId)} ${esc(asset.name)}</div><div class="wa-prop">${esc(property.name)}</div></div>
        <span class="pill ${status==='good'?'ready':status==='warn'?'needs':'sameday'}">${status==='good'?'Balanced':status==='warn'?'Adjust':'Needs care'}</span></div>
      ${thumb}
      ${photoBadge}
      <div class="wa-readout">
        <div class="wa-r ${cells.chlorine}"><div class="v">${reading?.chlorine??'-'}</div><div class="k">Chlorine</div></div>
        <div class="wa-r ${cells.ph}"><div class="v">${reading?.ph??'-'}</div><div class="k">pH</div></div>
        <div class="wa-r ${cells.alk}"><div class="v">${reading?.alk??'-'}</div><div class="k">Alkalinity</div></div>
      </div>
      <div class="dose ${tips.length?'':'ok'}">${tips.length?esc(tips.join(' · ')):'All balanced, no action needed'}</div>
      <div class="wa-foot"><span class="wa-due ${due.due?'over':''}">${reading?`Last tested ${due.days===0?'today':`${due.days}d ago`}`:'Never tested'}${due.due?' · due now':''}</span>
        <div class="water-actions"><button class="btn ghost small-btn" data-waterphoto="${asset.id}">Photo test</button><button class="btn primary small-btn" data-log="${asset.id}">Log numbers</button></div></div></div>`;
  }).join('');
  html+=`<button class="btn ghost" data-compliance>&#128196; Export compliance log</button>`;
  return html;
}
function cellClass(type,key,value){
  const target=TARGETS[type][key];
  if(value<target[0]||value>target[1]) return key==='chlorine'?'bad':'warn';
  return 'good';
}
function targetRange(asset,key){
  const range=TARGETS[asset.type][key];
  return `${range[0]}-${range[1]}`;
}
function openLog(assetId){
  const asset=WATER_ASSETS.find(item=>item.id===assetId);
  if(!asset) return;
  const draft=WATER_DRAFTS[assetId]||{};
  const preview=draft.previewUrl||draft.url||'';
  openSheet(`<div class="sheet-grab"></div><div class="sheet-title">Water test</div>
    <div class="sheet-sub">${propertyEmoji(asset.propertyId)} ${esc(asset.name)} · ${esc(prop(asset.propertyId).name)}</div>
    <div class="plain-note"><b>Photo Test Log</b> keeps the kit photo with this reading. It does not guess from color yet, so type the numbers you see before saving.</div>
    <button class="btn ghost" data-waterphoto="${asset.id}">&#128247; ${draft.photoKey?'Replace kit photo':'Attach kit photo'}</button>
    ${preview?`<img class="kit-preview" src="${esc(preview)}" alt="Kit photo preview">`:''}
    ${draft.photoKey?`<div class="photo-badge wide">${draft.synced===false?'Local photo attached':'Kit photo attached'}</div>`:''}
    <div class="reading-grid">
      <div class="field"><label>Chlorine <span class="unit">ppm</span></label><input id="in-cl" type="number" step="0.1" inputmode="decimal" placeholder="${targetRange(asset,'chlorine')}"><small class="target">Target ${targetRange(asset,'chlorine')}</small></div>
      <div class="field"><label>pH</label><input id="in-ph" type="number" step="0.1" inputmode="decimal" placeholder="${targetRange(asset,'ph')}"><small class="target">Target ${targetRange(asset,'ph')}</small></div>
      <div class="field"><label>Alkalinity <span class="unit">ppm</span></label><input id="in-alk" type="number" step="1" inputmode="numeric" placeholder="${targetRange(asset,'alk')}"><small class="target">Target ${targetRange(asset,'alk')}</small></div>
    </div>
    <div class="field"><label>What did you add? (optional)</label><input id="in-note" maxlength="160" placeholder="Example: added 2 tabs"></div>
    <button class="btn primary" data-savelog="${asset.id}">Save reading</button>`);
}
function saveLog(assetId){
  const asset=WATER_ASSETS.find(item=>item.id===assetId);
  if(!asset) return;
  const chlorine=parseFloat($('#in-cl').value);
  const ph=parseFloat($('#in-ph').value);
  const alk=parseFloat($('#in-alk').value);
  if([chlorine,ph,alk].some(Number.isNaN)){ toast('Fill chlorine, pH, and alkalinity'); return; }
  const draft=WATER_DRAFTS[assetId]||{};
  const reading={
    id:`reading-${Date.now()}`,assetId,ts:new Date().toISOString(),chlorine,ph,alk,
    note:$('#in-note').value.trim(),recordedBy:USER.id,photoKey:draft.photoKey||null,photoLocal:draft.synced===false,
  };
  const remoteReading={...reading};
  if(draft.synced===false) delete remoteReading.photoKey;
  commit(()=>S.readings.push(reading),()=>API.logWater(remoteReading),{render:false});
  delete WATER_DRAFTS[assetId];
  closeSheet();
  go('water');
  const tips=doseAdvice(asset.type,reading);
  toast(tips.length?'Reading saved with care note':'Reading saved and balanced');
}
function captureWaterPhoto(assetId){
  const asset=WATER_ASSETS.find(item=>item.id===assetId);
  if(!asset) return;
  const input=document.createElement('input');
  input.type='file';
  input.accept='image/*';
  input.capture='environment';
  input.onchange=async()=>{
    const file=input.files[0];
    if(!file) return;
    const previewUrl=URL.createObjectURL(file);
    toast('Uploading kit photo...');
    try{
      const uploaded=await API.uploadPhoto(file);
      API_CONNECTED=true;
      WATER_DRAFTS[assetId]={photoKey:uploaded.key,synced:true,url:uploaded.url||photoSrc(uploaded.key),previewUrl};
      openLog(assetId);
      toast('Kit photo attached. Confirm the numbers.');
    }catch(error){
      API_CONNECTED=false;
      WATER_DRAFTS[assetId]={photoKey:`local-water-${Date.now()}`,synced:false,previewUrl};
      openLog(assetId);
      toast('Photo attached for this phone only. Confirm the numbers.');
    }
  };
  input.click();
}
function exportCompliance(){
  const rows=[...S.readings].sort((a,b)=>b.ts.localeCompare(a.ts)).map(reading=>{
    const asset=WATER_ASSETS.find(item=>item.id===reading.assetId);
    const property=prop(asset?.propertyId);
    const when=new Date(reading.ts).toLocaleString('en-US',{timeZone:'America/Chicago'});
    return `<tr><td>${esc(when)}</td><td>${esc(property.name)}</td><td>${esc(asset?.name||'')}</td><td>${reading.chlorine}</td><td>${reading.ph}</td><td>${reading.alk}</td><td>${reading.photoKey?'Yes':'No'}</td><td>${esc(reading.note||'')}</td></tr>`;
  }).join('');
  const printWindow=window.open('','_blank');
  if(!printWindow){ toast('Allow pop-ups to export'); return; }
  printWindow.document.write(`<html><head><title>STR Water Compliance Log</title><style>
    body{font-family:Georgia,serif;padding:32px;color:#111}h1{font-size:20px}.sub{color:#555;margin-bottom:18px}
    table{width:100%;border-collapse:collapse;font-size:13px}th,td{border:1px solid #ccc;padding:7px;text-align:left}th{background:#f2efe9}
    </style></head><body><h1>Short Term Retreats | Water Compliance Log</h1>
    <div class="sub">America/Chicago · generated ${esc(new Date().toLocaleString('en-US',{timeZone:'America/Chicago'}))}</div>
    <table><thead><tr><th>Date/time</th><th>Property</th><th>Asset</th><th>Cl</th><th>pH</th><th>Alk</th><th>Photo</th><th>Note</th></tr></thead><tbody>${rows}</tbody></table></body></html>`);
  printWindow.document.close();
  setTimeout(()=>printWindow.print(),300);
}

/* Enhanced pool operations: pressure, water level, strip chemistry, and proof photos. */
const WATER_PHOTO_KINDS = {
  kit: { key:'photoKey', icon:'🧪', label:'Strip photo', short:'Strip', help:'Bottle + test strip proof' },
  pressure: { key:'pressurePhotoKey', icon:'⏱️', label:'Gauge photo', short:'Gauge', help:'Pressure gauge proof' },
  level: { key:'levelPhotoKey', icon:'🌊', label:'Level photo', short:'Level', help:'Skimmer arrow proof' },
};
const CORE_CHEM_FIELDS = [
  { id:'in-free-cl', key:'freeChlorine', label:'Free chlorine', unit:'ppm', step:'0.1', mode:'decimal', required:true },
  { id:'in-ph', key:'ph', label:'pH', unit:'', step:'0.1', mode:'decimal', required:true },
  { id:'in-alk', key:'alk', label:'Alkalinity', unit:'ppm', step:'1', mode:'numeric', required:true },
];
const ADVANCED_CHEM_FIELDS = [
  { id:'in-total-cl', key:'totalChlorine', label:'Total chlorine', unit:'ppm', step:'0.1', mode:'decimal' },
  { id:'in-hardness', key:'hardness', label:'Hardness', unit:'ppm', step:'1', mode:'numeric' },
  { id:'in-cya', key:'cyanuricAcid', label:'Cyanuric acid', unit:'ppm', step:'1', mode:'numeric' },
  { id:'in-salt', key:'salt', label:'Salt', unit:'ppm', step:'1', mode:'numeric' },
];
function waterDraft(assetId){
  WATER_DRAFTS[assetId]=WATER_DRAFTS[assetId]||{photos:{},values:{}};
  WATER_DRAFTS[assetId].photos=WATER_DRAFTS[assetId].photos||{};
  WATER_DRAFTS[assetId].values=WATER_DRAFTS[assetId].values||{};
  return WATER_DRAFTS[assetId];
}
function stashWaterForm(assetId){
  const draft=waterDraft(assetId);
  [...CORE_CHEM_FIELDS,...ADVANCED_CHEM_FIELDS,{id:'in-pressure',key:'pressurePsi'}].forEach(field=>{
    const element=$(`#${field.id}`);
    if(element) draft.values[field.key]=element.value;
  });
  const level=$('#in-level');
  if(level) draft.values.waterLevel=level.value;
  const note=$('#in-note');
  if(note) draft.values.note=note.value;
}
function photoFor(assetId,kind){
  return waterDraft(assetId).photos[kind]||{};
}
function photoKeys(reading){
  return ['photoKey','pressurePhotoKey','levelPhotoKey'].map(key=>reading?.[key]).filter(Boolean);
}
function firstWaterPhoto(reading){ return photoKeys(reading)[0]||null; }
function waterLevelMeta(value){ return WATER_LEVELS[value]||{ label:'Not logged', short:'-', status:'empty', note:'Add a water-level check.' }; }
function friendlyValue(value,empty='-'){
  return value===null||value===undefined||value===''?empty:value;
}
function targetRange(asset,key){
  const range=TARGETS[asset.type]?.[key]||TARGETS[asset.type]?.[key==='freeChlorine'?'chlorine':key];
  return range?`${range[0]}-${range[1]}`:'optional';
}
function inputHint(asset,key){
  const latest=latestReading(asset.id)||{};
  const value=readingValue(latest,key);
  const target=targetRange(asset,key);
  return value===null||value===undefined?`Target ${target}`:`Last ${value} / target ${target}`;
}
function waterField(asset,field,draft){
  const unit=field.unit?` <span class="unit">${esc(field.unit)}</span>`:'';
  const target=targetRange(asset,field.key);
  return `<div class="field"><label>${esc(field.label)}${unit}</label>
    <input id="${field.id}" type="number" step="${field.step}" inputmode="${field.mode}" placeholder="${esc(inputHint(asset,field.key))}" value="${esc(draft.values[field.key]||'')}">
    <small class="target">${field.required?'Required':'Optional'} · ${esc(target)}</small></div>`;
}
function pressureClass(asset,value){
  if(value===null||value===undefined||value==='') return 'empty';
  const range=TARGETS[asset.type]?.pressurePsi||asset.pressureTarget;
  if(!range) return 'good';
  return value<range[0]||value>range[1]?'warn':'good';
}
function levelClass(value){ return waterLevelMeta(value).status; }
function cellClass(type,key,value){
  const target=TARGETS[type]?.[key]||TARGETS[type]?.[key==='chlorine'?'freeChlorine':key];
  if(!target||value===null||value===undefined||value==='') return 'empty';
  return value<target[0]||value>target[1] ? (key==='chlorine'||key==='freeChlorine'?'bad':'warn') : 'good';
}
function waterProofBadges(reading){
  const badges=[
    [reading?.pressurePhotoKey,'Gauge'],
    [reading?.levelPhotoKey,'Level'],
    [reading?.photoKey,'Strip'],
  ].filter(([key])=>key);
  return badges.length?`<div class="proof-badges">${badges.map(([,label])=>`<span>${esc(label)} photo</span>`).join('')}</div>`:'';
}
function waterScore(asset,reading){
  if(!reading) return {label:'No check', score:0, className:'bad'};
  const status=readingStatus(asset.type,reading);
  const due=testDue(asset);
  const score=Math.max(0,Math.min(100,
    (status==='good'?78:status==='warn'?56:32)
    +(reading.waterLevel?8:0)
    +(reading.pressurePsi!==null&&reading.pressurePsi!==undefined?7:0)
    +(photoKeys(reading).length?7:0)
    -(due.due?18:0)
  ));
  return {score,label:score>=85?'Guest-ready':score>=65?'Watch':'Needs care',className:score>=85?'good':score>=65?'warn':'bad'};
}
function renderWater(){
  const current=WATER_ASSETS.filter(asset=>!testDue(asset).due&&readingStatus(asset.type,latestReading(asset.id)||{})==='good').length;
  const avgScore=Math.round(WATER_ASSETS.reduce((sum,asset)=>sum+waterScore(asset,latestReading(asset.id)).score,0)/WATER_ASSETS.length);
  let html=`<div class="streak-card"><span class="streak-icon">💧</span><div><b>${avgScore}% water guest-ready score</b>
    <small>${current} of ${WATER_ASSETS.length} water assets current · pressure, level, strip, and proof photos</small></div></div>
    <div class="scan-card pro-scan"><span class="streak-icon">📸</span><div><b>Pool check</b><small>Take 3 quick photos: gauge, skimmer arrow, and strip bottle. Then type the numbers from the kit.</small></div></div>
    <div class="pool-reference-grid">
      <div><b>⏱️ Pressure gauge</b><small>Log PSI. If it jumps high, clean/backwash and recheck.</small></div>
      <div><b>🌊 Water level</b><small>Use below / on arrow / a little above / high.</small></div>
      <div><b>🧪 Chemical strip</b><small>Track free chlorine, pH, alkalinity, CYA, hardness, and salt.</small></div>
    </div>
    <p class="sec-label">Pools &amp; hot tubs</p>`;
  html+=WATER_ASSETS.map(asset=>{
    const property=prop(asset.propertyId);
    const reading=latestReading(asset.id);
    const status=reading?readingStatus(asset.type,reading):'bad';
    const score=waterScore(asset,reading);
    const tips=reading?doseAdvice(asset.type,reading):['No reading yet, run a pool check now'];
    const due=testDue(asset);
    const free=readingValue(reading||{},'freeChlorine');
    const level=waterLevelMeta(reading?.waterLevel);
    const thumbKey=firstWaterPhoto(reading);
    const thumb=thumbKey?`<img class="water-thumb" src="${esc(photoSrc(thumbKey))}" alt="Pool proof photo">`:'';
    return `<div class="wa ${score.className}" data-water="${asset.id}">
      <div class="wa-top"><div><div class="wa-name">${asset.emoji||propertyEmoji(asset.propertyId)} ${esc(asset.name)}</div><div class="wa-prop">${propertyEmoji(asset.propertyId)} ${esc(property.name)}</div></div>
        <span class="pill ${status==='good'?'ready':status==='warn'?'needs':'sameday'}">${score.label}</span></div>
      ${thumb}
      ${waterProofBadges(reading)}
      <div class="pool-ops-strip">
        <div class="wa-r ${pressureClass(asset,reading?.pressurePsi)}"><div class="v">${friendlyValue(reading?.pressurePsi)}</div><div class="k">PSI</div></div>
        <div class="wa-r ${levelClass(reading?.waterLevel)}"><div class="v">${esc(level.short)}</div><div class="k">Level</div></div>
        <div class="wa-r ${score.className}"><div class="v">${score.score}%</div><div class="k">Ready</div></div>
      </div>
      <div class="wa-readout">
        <div class="wa-r ${cellClass(asset.type,'freeChlorine',free)}"><div class="v">${friendlyValue(free)}</div><div class="k">Free Cl</div></div>
        <div class="wa-r ${cellClass(asset.type,'ph',reading?.ph)}"><div class="v">${friendlyValue(reading?.ph)}</div><div class="k">pH</div></div>
        <div class="wa-r ${cellClass(asset.type,'alk',reading?.alk)}"><div class="v">${friendlyValue(reading?.alk)}</div><div class="k">Alk</div></div>
      </div>
      ${reading?`<div class="chem-mini">
        <span>Total Cl ${friendlyValue(reading.totalChlorine)}</span>
        <span>CYA ${friendlyValue(reading.cyanuricAcid)}</span>
        <span>Hard ${friendlyValue(reading.hardness)}</span>
        <span>Salt ${friendlyValue(reading.salt)}</span>
      </div>`:''}
      <div class="dose ${tips.length?'':'ok'}">${tips.length?esc(tips.join(' · ')):'All balanced, no action needed'}</div>
      <div class="wa-foot"><span class="wa-due ${due.due?'over':''}">${reading?`Last checked ${due.days===0?'today':`${due.days}d ago`}`:'Never checked'}${due.due?' · due now':''}</span>
        <div class="water-actions"><button class="btn ghost small-btn" data-waterphoto="${asset.id}:kit">Strip photo</button><button class="btn primary small-btn" data-log="${asset.id}">Pool check</button></div></div></div>`;
  }).join('');
  html+=`<button class="btn ghost" data-compliance>📄 Export pool log</button>`;
  return html;
}
function photoTile(assetId,kind){
  const meta=WATER_PHOTO_KINDS[kind];
  const photo=photoFor(assetId,kind);
  return `<button class="photo-tile ${photo.photoKey?'attached':''}" data-waterphoto="${assetId}:${kind}">
    <span>${meta.icon}</span><b>${photo.photoKey?'Replace':'Add'} ${esc(meta.short)}</b><small>${esc(meta.help)}</small></button>`;
}
function photoPreview(assetId,kind){
  const meta=WATER_PHOTO_KINDS[kind];
  const photo=photoFor(assetId,kind);
  const src=photo.previewUrl||photo.url||photoSrc(photo.photoKey);
  return src?`<figure class="proof-preview"><img src="${esc(src)}" alt="${esc(meta.label)} preview"><figcaption>${esc(meta.label)} attached${photo.synced===false?' locally':''}</figcaption></figure>`:'';
}
function openLog(assetId){
  const asset=WATER_ASSETS.find(item=>item.id===assetId);
  if(!asset) return;
  const draft=waterDraft(assetId);
  const levelValue=draft.values.waterLevel||'';
  openSheet(`<div class="sheet-grab"></div><div class="sheet-title">Pool check</div>
    <div class="sheet-sub">${asset.emoji||propertyEmoji(asset.propertyId)} ${esc(asset.name)} · ${esc(prop(asset.propertyId).name)}</div>
    <div class="plain-note"><b>Fifth-grade version:</b> take the three proof photos, then type the strip numbers. The app stores the proof and flags what needs attention.</div>
    <div class="photo-capture-grid">
      ${photoTile(asset.id,'pressure')}
      ${photoTile(asset.id,'level')}
      ${photoTile(asset.id,'kit')}
    </div>
    <div class="proof-preview-grid">
      ${photoPreview(asset.id,'pressure')}
      ${photoPreview(asset.id,'level')}
      ${photoPreview(asset.id,'kit')}
    </div>
    <div class="reading-grid issue-grid">
      <div class="field"><label>Pressure PSI <span class="unit">pool gauge</span></label>
        <input id="in-pressure" type="number" step="1" inputmode="numeric" placeholder="${esc(inputHint(asset,'pressurePsi'))}" value="${esc(draft.values.pressurePsi||'')}">
        <small class="target">${asset.pressureTarget?`Target ${targetRange(asset,'pressurePsi')}`:'Optional for this asset'}</small></div>
      <div class="field"><label>Water level</label>
        <select id="in-level">
          <option value="">Choose level</option>
          ${Object.entries(WATER_LEVELS).map(([value,meta])=>`<option value="${value}" ${levelValue===value?'selected':''}>${esc(meta.label)}</option>`).join('')}
        </select>
        <small class="target">${esc(asset.levelGuide||'Record the water line.')}</small></div>
    </div>
    <p class="sec-label">Core chemistry</p>
    <div class="reading-grid">${CORE_CHEM_FIELDS.map(field=>waterField(asset,field,draft)).join('')}</div>
    <details class="advanced-chem" open>
      <summary>More strip numbers from the bottle</summary>
      <div class="reading-grid issue-grid">${ADVANCED_CHEM_FIELDS.map(field=>waterField(asset,field,draft)).join('')}</div>
    </details>
    <div class="field"><label>What did you add or notice? (optional)</label><input id="in-note" maxlength="180" placeholder="Example: added 2 tabs, skimmed, pressure 18 PSI" value="${esc(draft.values.note||'')}"></div>
    <div class="plain-note safety-note"><b>Safety note:</b> this tracks readings and suggests what to check. Follow the chemical label and never mix pool chemicals.</div>
    <button class="btn primary" data-savelog="${asset.id}">Save pool check</button>`);
}
function readNumberField(selector,label,{required=false,min=0,max=10000}={}){
  const element=$(selector);
  const raw=element?.value.trim()||'';
  if(!raw){
    if(required){ toast(`Fill ${label}`); return {ok:false}; }
    return {ok:true,value:null};
  }
  const value=Number(raw);
  if(!Number.isFinite(value)||value<min||value>max){
    toast(`Check ${label}`);
    return {ok:false};
  }
  return {ok:true,value};
}
function saveLog(assetId){
  const asset=WATER_ASSETS.find(item=>item.id===assetId);
  if(!asset) return;
  const freeResult=readNumberField('#in-free-cl','free chlorine',{required:true,max:20});
  const phResult=readNumberField('#in-ph','pH',{required:true,max:14});
  const alkResult=readNumberField('#in-alk','alkalinity',{required:true,max:500});
  if(!freeResult.ok||!phResult.ok||!alkResult.ok) return;
  const optionalResults={
    totalChlorine:readNumberField('#in-total-cl','total chlorine',{max:20}),
    hardness:readNumberField('#in-hardness','hardness',{max:1000}),
    cyanuricAcid:readNumberField('#in-cya','cyanuric acid',{max:300}),
    salt:readNumberField('#in-salt','salt',{max:10000}),
    pressurePsi:readNumberField('#in-pressure','pressure PSI',{max:80}),
  };
  if(Object.values(optionalResults).some(result=>!result.ok)) return;
  const draft=waterDraft(assetId);
  const photos=draft.photos||{};
  const reading={
    id:`reading-${Date.now()}`,assetId,ts:new Date().toISOString(),
    chlorine:freeResult.value,freeChlorine:freeResult.value,ph:phResult.value,alk:alkResult.value,
    totalChlorine:optionalResults.totalChlorine.value,
    hardness:optionalResults.hardness.value,
    cyanuricAcid:optionalResults.cyanuricAcid.value,
    salt:optionalResults.salt.value,
    pressurePsi:optionalResults.pressurePsi.value,
    waterLevel:$('#in-level').value||null,
    note:$('#in-note').value.trim(),recordedBy:USER.id,
    photoKey:photos.kit?.photoKey||null,
    pressurePhotoKey:photos.pressure?.photoKey||null,
    levelPhotoKey:photos.level?.photoKey||null,
  };
  const remoteReading={...reading};
  if(photos.kit?.synced===false) delete remoteReading.photoKey;
  if(photos.pressure?.synced===false) delete remoteReading.pressurePhotoKey;
  if(photos.level?.synced===false) delete remoteReading.levelPhotoKey;
  commit(()=>S.readings.push(reading),()=>API.logWater(remoteReading),{render:false});
  delete WATER_DRAFTS[assetId];
  closeSheet();
  go('water');
  const tips=doseAdvice(asset.type,reading);
  toast(tips.length?'Pool check saved with care note':'Pool check saved and guest-ready');
}
function captureWaterPhoto(target){
  const [assetId,rawKind='kit']=String(target).split(':');
  const kind=WATER_PHOTO_KINDS[rawKind]?rawKind:'kit';
  const asset=WATER_ASSETS.find(item=>item.id===assetId);
  if(!asset) return;
  stashWaterForm(assetId);
  const meta=WATER_PHOTO_KINDS[kind];
  const input=document.createElement('input');
  input.type='file';
  input.accept='image/*';
  input.capture='environment';
  input.onchange=async()=>{
    const file=input.files[0];
    if(!file) return;
    const previewUrl=URL.createObjectURL(file);
    toast(`Uploading ${meta.short.toLowerCase()} photo...`);
    try{
      const uploaded=await API.uploadPhoto(file);
      API_CONNECTED=true;
      waterDraft(assetId).photos[kind]={photoKey:uploaded.key,synced:true,url:uploaded.url||photoSrc(uploaded.key),previewUrl};
      openLog(assetId);
      toast(`${meta.short} photo attached. Confirm the numbers.`);
    }catch(error){
      API_CONNECTED=false;
      waterDraft(assetId).photos[kind]={photoKey:`local-water-${kind}-${Date.now()}`,synced:false,previewUrl};
      openLog(assetId);
      toast(`${meta.short} photo attached on this phone only.`);
    }
  };
  input.click();
}
function exportCompliance(){
  const rows=[...S.readings].sort((a,b)=>b.ts.localeCompare(a.ts)).map(reading=>{
    const asset=WATER_ASSETS.find(item=>item.id===reading.assetId);
    const property=prop(asset?.propertyId);
    const when=new Date(reading.ts).toLocaleString('en-US',{timeZone:'America/Chicago'});
    return `<tr><td>${esc(when)}</td><td>${esc(property.name)}</td><td>${esc(asset?.name||'')}</td>
      <td>${friendlyValue(reading.pressurePsi)}</td><td>${esc(waterLevelMeta(reading.waterLevel).label)}</td>
      <td>${friendlyValue(readingValue(reading,'freeChlorine'))}</td><td>${friendlyValue(reading.totalChlorine)}</td>
      <td>${friendlyValue(reading.ph)}</td><td>${friendlyValue(reading.alk)}</td><td>${friendlyValue(reading.hardness)}</td>
      <td>${friendlyValue(reading.cyanuricAcid)}</td><td>${friendlyValue(reading.salt)}</td><td>${photoKeys(reading).length}</td><td>${esc(reading.note||'')}</td></tr>`;
  }).join('');
  const printWindow=window.open('','_blank');
  if(!printWindow){ toast('Allow pop-ups to export'); return; }
  printWindow.document.write(`<html><head><title>STR Pool Operations Log</title><style>
    body{font-family:Georgia,serif;padding:32px;color:#111}h1{font-size:20px}.sub{color:#555;margin-bottom:18px}
    table{width:100%;border-collapse:collapse;font-size:11px}th,td{border:1px solid #ccc;padding:6px;text-align:left}th{background:#f2efe9}
    </style></head><body><h1>Short Term Retreats | Pool Operations Log</h1>
    <div class="sub">America/Chicago · generated ${esc(new Date().toLocaleString('en-US',{timeZone:'America/Chicago'}))}</div>
    <table><thead><tr><th>Date/time</th><th>Property</th><th>Asset</th><th>PSI</th><th>Level</th><th>Free Cl</th><th>Total Cl</th><th>pH</th><th>Alk</th><th>Hard</th><th>CYA</th><th>Salt</th><th>Photos</th><th>Note</th></tr></thead><tbody>${rows}</tbody></table></body></html>`);
  printWindow.document.close();
  setTimeout(()=>printWindow.print(),300);
}

/* ---------------- Ops cockpit ---------------- */
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
  const propertyScores=PROPERTIES.map(property=>{
    const waterAssets=WATER_ASSETS.filter(asset=>asset.propertyId===property.id);
    const waterAvg=waterAssets.length
      ? Math.round(waterAssets.reduce((sum,asset)=>sum+waterScore(asset,latestReading(asset.id)).score,0)/waterAssets.length)
      : 100;
    const activeTurns=S.turns.filter(turn=>turn.propertyId===property.id&&turn.status!=='done'&&turn.checkout&&turn.checkout<=todayISO()).length;
    const issues=S.tickets.filter(ticket=>ticket.propertyId===property.id&&ticket.status==='open').length;
    const lowSupplies=S.supplies.filter(supply=>supply.propertyId===property.id&&(Number(supply.quantity??supply.count)||0)<=(Number(supply.reorderAt)||0)).length;
    const score=Math.max(0,Math.min(100,waterAvg-(activeTurns*8)-(issues*12)-(lowSupplies*6)));
    return {property,score,label:score>=85?'Guest-ready':score>=65?'Watch':'Needs help'};
  });
  let html=`<div class="cockpit-head"><div><span class="eyebrow">Ops cockpit</span><h1>Today at a glance.</h1></div>
    <span class="live-dot ${API_CONNECTED?'online':''}">${API_CONNECTED?'Live':'Demo'}</span></div>
    <div class="organizer-card">
      <div><b>Ana's organizer tools</b><small>Assign open turns, copy the day brief, then send it to the crew.</small></div>
      <div class="organizer-actions"><button class="btn ghost small-btn" data-autoassign>Auto-assign</button><button class="btn primary small-btn" data-copybrief>Copy brief</button></div>
    </div>
    <div class="money-grid">
      <div class="money-card hero"><small>Revenue</small><b>${money(totals.revenue)}</b><span>this month</span></div>
      <div class="money-card"><small>Net operating</small><b>${money(net)}</b><span>after costs + payouts</span></div>
      <div class="money-card"><small>Property costs</small><b>${money(totals.expenses)}</b><span>recorded expenses</span></div>
      <div class="money-card"><small>Crew pay</small><b>${money(totals.payouts)}</b><span>projected payouts</span></div>
    </div>
    <div class="section-heading"><p class="sec-label">Guest-ready score</p><span>clean + water + issues</span></div>
    <div class="ready-grid">${propertyScores.map(row=>`<div class="ready-card ${row.score>=85?'good':row.score>=65?'warn':'bad'}">
      <span>${propertyEmoji(row.property.id)}</span><div><b>${esc(row.property.name)}</b><small>${row.label}</small></div><strong>${row.score}%</strong></div>`).join('')}</div>
    <div class="section-heading"><p class="sec-label">Professional upgrades</p><span>brainstorm board</span></div>
    <div class="idea-grid">${BUSINESS_IDEAS.map(idea=>`<div class="idea-card"><span>${idea.icon}</span><div><b>${esc(idea.title)}</b><small>${esc(idea.detail)}</small></div></div>`).join('')}</div>
    <div class="section-heading"><p class="sec-label">Needs attention</p><span>${openAlerts.length} open</span></div>
    <div class="alert-stack">${openAlerts.map(alertCard).join('')}</div>
    <div class="section-heading"><p class="sec-label">Goals</p><span>${S.goals.length} tracked</span></div>
    <div class="goal-list">${S.goals.map(goalCard).join('')}</div>
    <div class="section-heading"><p class="sec-label">Ops tasks</p><button data-addtask>+ Add</button></div>
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
  openSheet(`<div class="sheet-grab"></div><div class="sheet-title">Add ops task</div>
    <div class="field"><label>Task</label><input id="task-title" maxlength="120" placeholder="What needs to happen?"></div>
    <div class="reading-grid issue-grid">
      <div class="field"><label>Property</label><select id="task-property">${PROPERTIES.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Assigned to</label><select id="task-owner">${TEAM.filter(item=>isLeaderRole(item.role)).map(item=>`<option value="${item.id}">${esc(item.name)}</option>`).join('')}</select></div>
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
      <div class="field"><label>Worker payouts ($)</label><input id="fin-payouts" type="number" min="0" step="1"></div>
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
  let html=`<p class="sec-label">Team &amp; roles</p>
    <div class="plain-note"><b>Ana and Gale are owners.</b> Ana can organize the day, assign turns, and copy a simple brief to send out.</div>`;
  html+=TEAM.map(person=>`<div class="row"><span class="pa" style="background:${person.color};color:#20180a">${esc(person.name[0])}</span>
    <div><div class="rn">${esc(person.name)}</div><div class="rr">${esc(displayRole(person))}${person.id==='anna'?' - assigns, organizes, and sends the day':person.role==='dev'?' - app build + crew':person.role==='owner'?' - owner':person.role==='manager'?' - house operations':''}</div></div>
    <span class="badge ${person.role!=='cleaner'?'admin':''}">${esc(displayRole(person))}</span></div>`).join('');
  html+=`<p class="sec-label">House role map</p>
    <div class="role-board">${PROPERTIES.map(property=>`<div class="role-house">
      <div class="role-house-head"><span>${propertyEmoji(property.id)}</span><b>${esc(property.name)}</b></div>
      <div class="role-strip">${roleSummary(property.id,{limit:8})}</div>
    </div>`).join('')}</div>`;
  if(isLeader()){
    html+=`<p class="sec-label">Organizer tools</p>
      <button class="btn ghost" data-autoassign>&#9851; Auto-assign open turns</button>
      <button class="btn ghost" data-copybrief>&#128203; Copy today's brief</button>
      <button class="btn danger-outline" data-reset>Reset local demo</button>
      <p class="admin-note">Signed in as ${esc(USER.name)} - ${esc(displayRole(USER))}.</p>`;
  } else {
    html+=`<p class="admin-note">You can claim available turns, complete your checklist, log water, and report issues.</p>`;
  }
  return html;
}
function autoAssignAll(){
  const workers=assignableWorkers();
  if(!workers.length){ toast('No assignable team members yet'); return; }
  const load=Object.fromEntries(workers.map(worker=>[worker.id,S.turns.filter(turn=>turn.assigned===worker.id&&turn.status!=='done').length]));
  const patches=[];
  commit(()=>{
    S.turns.filter(turn=>turn.status!=='done'&&!turn.assigned).forEach(turn=>{
      const defaultOwner=defaultTurnOwner(turn);
      const choice=defaultOwner||[...workers].sort((a,b)=>load[a.id]-load[b.id])[0];
      turn.assigned=choice.id;
      load[choice.id]=(load[choice.id]||0)+1;
      patches.push({id:turn.id,assigned:choice.id});
    });
  },()=>Promise.all(patches.map(patch=>API.patchTurn(patch.id,{assigned:patch.assigned}))));
  toast('Open turns assigned from house roles');
}
function openAssign(turnId){
  const turn=S.turns.find(item=>item.id===turnId);
  if(!turn) return;
  const cleaners=roleCandidatePeople(turn.propertyId);
  if(!cleaners.length){ toast('No assignable team members yet'); return; }
  const load=id=>S.turns.filter(item=>item.assigned===id&&item.status!=='done').length;
  const suggested=defaultTurnOwner(turn)||[...cleaners].sort((a,b)=>load(a.id)-load(b.id))[0];
  openSheet(`<div class="sheet-grab"></div><div class="sheet-title">Assign team member</div>
    <div class="sheet-sub">${esc(prop(turn.propertyId).name)} · ${fmtDay(turn.checkout)}</div>
    <div class="gate-note water-note"><span>&#9851;</span><span>Suggested: <b>${esc(suggested.name)}</b>, based on this house's Clean lane. The role map still shows everyone's separate lane.</span></div>
    <div class="pick-list">${cleaners.map(cleaner=>`<button data-pick="${turn.id}:${cleaner.id}" class="${cleaner.id===suggested.id?'sel':''}">
      <span class="pa" style="background:${cleaner.color}">${esc(cleaner.name[0])}</span>
      <span>${esc(cleaner.name)}<div class="mini">${userRolesForProperty(turn.propertyId,cleaner.id).map(role=>roleDef(role).label).join(', ')||'Manual override'} · ${load(cleaner.id)} open turn${load(cleaner.id)===1?'':'s'}</div></span></button>`).join('')}</div>`);
}
function pickCleaner(turnId,cleanerId){
  const turn=S.turns.find(item=>item.id===turnId);
  if(!turn) return;
  commit(()=>{ turn.assigned=cleanerId; },()=>API.patchTurn(turnId,{assigned:cleanerId}),{render:false});
  closeSheet();
  go(VIEW);
  toast('Team member assigned');
}
function dailyBriefText(){
  const today=todayISO();
  const active=S.turns.filter(turn=>turn.checkout&&turn.checkout<=today&&turn.status!=='done');
  const waterDue=WATER_ASSETS.filter(asset=>testDue(asset).due);
  const urgent=S.alerts.filter(alert=>!alert.resolved&&alert.severity==='urgent');
  const lines=[
    `STR Ops brief for ${new Date().toLocaleDateString('en-US',{timeZone:'America/Chicago',weekday:'long',month:'short',day:'numeric'})}`,
    '',
    'Turns',
    ...(active.length?active.map(turn=>`${propertyEmoji(turn.propertyId)} ${prop(turn.propertyId).name}: ${member(turn.assigned)?.name||'Unassigned'} (${turn.status.replace('_',' ')}) · ${roleIdsForProperty(turn.propertyId).map(role=>`${roleDef(role).label}: ${roleNames(turn.propertyId,role)}`).join(' · ')}`) : ['No turns due today.']),
    '',
    'Water',
    ...(waterDue.length?waterDue.map(asset=>`${propertyEmoji(asset.propertyId)} ${prop(asset.propertyId).name} ${asset.name}: due now`) : ['Water is current.']),
    '',
    'Urgent',
    ...(urgent.length?urgent.map(alert=>`${propertyEmoji(alert.propertyId)} ${alert.title}`) : ['No urgent alerts.']),
  ];
  return lines.join('\n');
}
async function copyDailyBrief(){
  const text=dailyBriefText();
  try{
    await navigator.clipboard.writeText(text);
    toast('Brief copied for Ana to send');
  }catch{
    openSheet(`<div class="sheet-grab"></div><div class="sheet-title">Today brief</div>
      <div class="field"><textarea rows="12">${esc(text)}</textarea></div>`);
  }
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
  $$('[data-waterphoto]').forEach(element=>element.onclick=event=>{ event.stopPropagation(); captureWaterPhoto(element.dataset.waterphoto); });
  $$('[data-water]').forEach(element=>element.onclick=event=>{
    const trigger=event.target.closest('[data-water]');
    if(trigger){ event.stopPropagation(); openLog(trigger.dataset.water); }
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
  $$('[data-copybrief]').forEach(element=>element.onclick=copyDailyBrief);
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
    toggleCheck(id,index);
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
  const waterPhoto=event.target.closest('[data-waterphoto]');
  if(waterPhoto){ captureWaterPhoto(waterPhoto.dataset.waterphoto); return; }
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
