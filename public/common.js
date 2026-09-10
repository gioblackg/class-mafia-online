const qs = (s,r=document)=>r.querySelector(s);
const qsa = (s,r=document)=>[...r.querySelectorAll(s)];
const api = async (url, opts={}) => {
  let res;
  try {
    res = await fetch(url,{...opts,cache:'no-store',headers:{'Content-Type':'application/json',...(opts.headers||{})}});
  } catch (cause) {
    const err = new Error('서버와 연결이 잠시 끊겼습니다. 자동으로 다시 연결합니다.');
    err.network = true;
    err.cause = cause;
    throw err;
  }
  let data={}; try{ data=await res.json(); }catch{}
  if(!res.ok){
    const err = new Error(data.error||'요청을 처리하지 못했습니다.');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
};
const escapeHtml = (s='') => String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c]));
const roleMeta = {
  mafia:{label:'마피아',emoji:'🕵️',desc:'정체를 숨기고 시민들 사이에 숨어 보세요.'},
  police:{label:'경찰',emoji:'🔎',desc:'토론과 관찰로 마피아를 찾아내세요.'},
  doctor:{label:'의사',emoji:'🩺',desc:'마을을 지키는 중요한 역할입니다.'},
  citizen:{label:'시민',emoji:'🙂',desc:'친구들의 이야기를 듣고 마피아를 찾아보세요.'}
};
function flash(el,msg,type='notice'){ el.className=type; el.textContent=msg; el.hidden=false; setTimeout(()=>{el.hidden=true},4500); }

function getMafiaDeviceId(){
  const key='mafia_device_id_v1';
  let id='';
  try{id=localStorage.getItem(key)||''}catch{}
  if(!id){
    try{id=(globalThis.crypto&&crypto.randomUUID)?crypto.randomUUID():('dev_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2))}
    catch{id='dev_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2)}
    try{localStorage.setItem(key,id)}catch{}
  }
  return id;
}
