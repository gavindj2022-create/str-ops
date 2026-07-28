/* STR Ops API adapter.
   UI code calls this camelCase contract; methods reject cleanly when offline. */
(function(global){
  const DEFAULT_TIMEOUT=1800;

  async function request(path,options={}){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),options.timeout||DEFAULT_TIMEOUT);
    const init={
      method:options.method||'GET',
      credentials:'same-origin',
      headers:{Accept:'application/json',...(options.body!==undefined?{'Content-Type':'application/json'}:{}),...(options.headers||{})},
      signal:controller.signal,
    };
    if(options.formData!==undefined) init.body=options.formData;
    else if(options.body!==undefined) init.body=JSON.stringify(options.body);
    try{
      const response=await fetch(path,init);
      const payload=response.status===204?null:await response.json().catch(()=>null);
      if(!response.ok){
        const error=new Error(payload?.error?.message||payload?.error||`Request failed (${response.status})`);
        error.status=response.status;
        error.payload=payload;
        throw error;
      }
      return payload?.data??payload;
    } finally {
      clearTimeout(timer);
    }
  }

  const resource=name=>({
    list:()=>request(`/api/${name}`),
    create:body=>request(`/api/${name}`,{method:'POST',body}),
    update:(id,body)=>request(`/api/${name}/${encodeURIComponent(id)}`,{method:'PATCH',body}),
    remove:id=>request(`/api/${name}/${encodeURIComponent(id)}`,{method:'DELETE'}),
  });

  function uploadPhoto(file){
    const formData=new FormData();
    formData.append('file',file,file.name||'verification.jpg');
    return request('/api/photos',{method:'POST',formData,timeout:12000});
  }

  global.STRApi={
    request,
    photoUrl:key=>`/api/photos/${String(key).split('/').map(encodeURIComponent).join('/')}`,
    loginOptions:()=>request('/api/login-options'),
    login:(userId,pin)=>request('/api/login',{method:'POST',body:{userId,pin}}),
    logout:()=>request('/api/logout',{method:'POST'}),
    me:()=>request('/api/me'),
    state:()=>request('/api/state'),
    patchTurn:(id,patch)=>request(`/api/turns/${encodeURIComponent(id)}`,{method:'PATCH',body:patch}),
    putCheck:(id,index,checked,photoKey)=>request(`/api/turns/${encodeURIComponent(id)}/checks/${index}`,{
      method:'PUT',body:{checked,...(photoKey?{photoKey}:{})},
    }),
    uploadPhoto,
    logWater:body=>request('/api/water',{method:'POST',body}),
    financials:resource('financials'),
    tasks:resource('tasks'),
    goals:resource('goals'),
    tickets:resource('tickets'),
    supplies:resource('supplies'),
    alerts:()=>request('/api/alerts'),
  };
})(window);
