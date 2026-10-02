const qs = (s,r=document)=>r.querySelector(s);
const qsa = (s,r=document)=>[...r.querySelectorAll(s)];
const nativeFetch = globalThis.fetch.bind(globalThis);
const api = async (url, opts={}) => {
  let res;
  try {
    const next={...opts,cache:'no-store',headers:{'Content-Type':'application/json',...(opts.headers||{})}};
    if(String(url).endsWith('/assign') && next.body){
      try{
        const payload=JSON.parse(next.body);
        const clownInput=document.querySelector('#clownN');
        if(clownInput) payload.clown=Math.max(0,Math.min(1,Number(clownInput.value)||0));
        next.body=JSON.stringify(payload);
      }catch{}
    }
    res = await nativeFetch(url,next);
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
  if(data?.winner==='clown' || data?.state?.winner==='clown') showClownVictory();
  return data;
};
const escapeHtml = (s='') => String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c]));
const roleMeta = {
  mafia:{label:'마피아',emoji:'🕵️',desc:'정체를 숨기고 시민들 사이에 숨어 보세요.'},
  police:{label:'경찰',emoji:'🔎',desc:'토론과 관찰로 마피아를 찾아내세요.'},
  doctor:{label:'의사',emoji:'🩺',desc:'마을을 지키는 중요한 역할입니다.'},
  clown:{label:'광대',emoji:'🤡',desc:'시민도 마피아도 아닙니다. 낮 투표에서 자신이 탈락하면 혼자 승리합니다.'},
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

function showClownVictory(){
  if(document.querySelector('#clownVictoryOverlay')) return;
  const el=document.createElement('div');
  el.id='clownVictoryOverlay';
  el.style.cssText='position:fixed;inset:0;z-index:99999;background:rgba(28,20,38,.94);display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;color:white;font-family:inherit';
  el.innerHTML='<div style="max-width:620px"><div style="font-size:84px">🤡</div><h1 style="font-size:42px;margin:8px 0 12px">광대 승리!</h1><p style="font-size:20px;line-height:1.6;margin:0 0 22px">광대가 낮 투표로 탈락했습니다.<br>광대가 단독으로 승리했습니다.</p><button type="button" style="font:inherit;font-weight:800;padding:12px 24px;border:0;border-radius:14px;cursor:pointer" onclick="this.closest(\'#clownVictoryOverlay\').remove()">확인</button></div>';
  document.body.appendChild(el);
}

function installClownSetup(){
  const mafia=document.querySelector('#mafiaN');
  if(!mafia || document.querySelector('#clownN')) return;
  const settings=mafia.closest('.role-settings');
  if(!settings) return;
  const field=document.createElement('div');
  field.className='field';
  field.innerHTML='<label>광대 🤡</label><input id="clownN" class="input" type="number" min="0" max="1" value="1">';
  settings.appendChild(field);
}
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',installClownSetup); else installClownSetup();
