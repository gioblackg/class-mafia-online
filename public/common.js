const qs = (s,r=document)=>r.querySelector(s);
const qsa = (s,r=document)=>[...r.querySelectorAll(s)];
const api = async (url, opts={}) => {
  let res;
  try {
    res = await fetch(url,{...opts,cache:'no-store',headers:{'Content-Type':'application/json',...(opts.headers||{})}});
  } catch (e) {
    throw new Error('서버와 연결이 끊겼습니다. 실행 프로그램을 다시 시작한 뒤 새로고침해 주세요.');
  }
  let data={}; try{ data=await res.json(); }catch{}
  if(!res.ok) throw new Error(data.error||'요청을 처리하지 못했습니다.');
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
