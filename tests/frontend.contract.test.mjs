import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const root=new URL('../',import.meta.url);
const read=path=>readFile(new URL(path,root),'utf8');

test('demo state uses canonical camelCase shape and corrected team roles',async()=>{
  const source=await read('public/data.js');
  const storage=new Map();
  const context=vm.createContext({
    localStorage:{
      getItem:key=>storage.get(key)||null,
      setItem:(key,value)=>storage.set(key,value),
      removeItem:key=>storage.delete(key),
    },
    Intl,Date,console,
  });
  vm.runInContext(`${source}\nglobalThis.__demo={TEAM,DB,iso};`,context);
  const {TEAM,DB,iso}=context.__demo;
  const state=DB.load();
  assert.deepEqual(Array.from(TEAM,item=>item.role),['dev','owner','manager','cleaner']);
  assert.equal(TEAM.find(item=>item.id==='gav').pin.length,6);
  assert.equal(TEAM.find(item=>item.id==='gale').role,'owner');
  assert.equal(TEAM.find(item=>item.id==='larry').pin.length,6);
  assert.equal(TEAM.find(item=>item.id==='anna').role,'cleaner');
  for(const key of ['turns','readings','financials','tasks','goals','alerts','tickets','supplies']){
    assert.ok(Array.isArray(state[key]),`${key} should be seeded`);
  }
  assert.ok(state.turns.every(turn=>'propertyId' in turn&&'readyBy' in turn&&'checkoutTime' in turn));
  assert.ok(state.financials.every(row=>'revenueCents' in row&&'cleanerPayoutCents' in row));
  assert.match(iso(new Date()),/^\d{4}-\d{2}-\d{2}$/);
});

test('API adapter targets the documented camelCase endpoints',async()=>{
  const calls=[];
  const context=vm.createContext({
    window:{},
    FormData,
    AbortController,
    setTimeout,
    clearTimeout,
    fetch:async(path,init)=>{
      calls.push({path,init});
      return {ok:true,status:200,json:async()=>({data:{ok:true}})};
    },
  });
  vm.runInContext(await read('public/api.js'),context);
  const api=context.window.STRApi;
  await api.loginOptions();
  await api.login('gav','135790');
  await api.logout();
  await api.me();
  await api.state();
  await api.patchTurn('t1',{status:'done'});
  await api.putCheck('t1',2,true,'photo-key');
  await api.logWater({assetId:'westgate-pool'});
  await api.financials.create({id:'f1'});
  await api.tasks.update('task1',{status:'done'});
  await api.goals.remove('goal1');
  await api.tickets.list();
  await api.supplies.list();
  await api.alerts();
  assert.deepEqual(calls.map(call=>call.path),[
    '/api/login-options','/api/login','/api/logout','/api/me','/api/state',
    '/api/turns/t1','/api/turns/t1/checks/2','/api/water','/api/financials',
    '/api/tasks/task1','/api/goals/goal1','/api/tickets','/api/supplies','/api/alerts',
  ]);
  assert.equal(calls[5].init.method,'PATCH');
  assert.equal(calls[6].init.method,'PUT');
  assert.equal(JSON.parse(calls[6].init.body).photoKey,'photo-key');
});

test('UI contract includes gated cockpit and core phone actions',async()=>{
  const [html,app,css]=await Promise.all([
    read('public/index.html'),read('public/app.js'),read('public/styles.css'),
  ]);
  assert.match(html,/data-view="cockpit"/);
  assert.match(html,/leader-only hidden/);
  assert.match(app,/if\(view==='cockpit'&&!isLeader\(\)\) view='today'/);
  assert.match(app,/repeat\(person\.pin\.length\)/);
  assert.match(app,/pinTarget\?\.pin\?\.length\|\|4/);
  assert.match(app,/isLocalDemo\(\)/);
  assert.match(app,/attemptLogin\(person,person\.pin,\{quick:true\}\)/);
  assert.match(app,/startedAt:true/);
  assert.match(app,/Cloud sync failed/);
  assert.ok(!app.includes('Test'+' PIN'),'login cards should not show demo credentials');
  for(const phrase of ['I’m on it','Done · ready for guest','Report damage or issue','balanced-log streak','Ops cockpit']){
    assert.ok(app.includes(phrase),`missing ${phrase}`);
  }
  assert.match(css,/@media \(max-width:390px\)/);
  assert.match(css,/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
});

test('service worker never caches API, non-GET, or photo requests',async()=>{
  const sw=await read('public/sw.js');
  assert.match(sw,/request\.method!=='GET'/);
  assert.match(sw,/pathname\.startsWith\('\/api\/'\)/);
  assert.match(sw,/pathname\.includes\('\/photos\/'\)/);
  assert.ok(!/cache\.put\(e\.request/.test(sw)||sw.includes("request.method!=='GET'"));
});
