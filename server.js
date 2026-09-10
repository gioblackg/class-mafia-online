const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { URL } = require('url');
const QRCode = require('./vendor/QRCode');
const QRErrorCorrectLevel = require('./vendor/QRCode/QRErrorCorrectLevel');

const PORT = Number(process.env.PORT || 3000);
const HOST = '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'rooms.json');
const ROOM_TTL = 6 * 60 * 60 * 1000;
const APP_VERSION = '2.3.0';
const PID_FILE = path.join(__dirname, '.mafia-server.pid');
const HOSTED = process.env.APP_MODE === 'hosted' || !!process.env.RENDER || !!process.env.RAILWAY_ENVIRONMENT || !!process.env.FLY_APP_NAME;
const PERSIST_TO_DISK = !HOSTED && process.env.PERSIST_ROOMS !== '0';

fs.mkdirSync(DATA_DIR, { recursive: true });
let rooms = {};
if (PERSIST_TO_DISK) {
  try { if (fs.existsSync(DATA_FILE)) rooms = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) || {}; } catch { rooms = {}; }
}

function saveRooms(){
  if (!PERSIST_TO_DISK) return;
  try {
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(rooms, null, 2));
    fs.renameSync(tmp, DATA_FILE);
  } catch (e) {
    console.warn('ROOM_PERSIST_WARNING', e && e.message ? e.message : e);
  }
}
function rand(bytes=18){ return crypto.randomBytes(bytes).toString('hex'); }
function now(){ return Date.now(); }
function uniqueCode(){ for(let i=0;i<100;i++){ const c=String(crypto.randomInt(100000,1000000)); if(!rooms[c]) return c; } throw new Error('방 코드 생성 실패'); }
function freshNight(day){ return {day,status:'idle',startedAt:null,actions:{},resolved:false,result:null}; }
function normalizeRoom(r){
  if (typeof r.roleLocked !== 'boolean') r.roleLocked = false;
  if (!Array.isArray(r.nightHistory)) r.nightHistory = [];
  if (!r.nightAction || r.nightAction.day !== r.day) r.nightAction = freshNight(r.day || 1);
  if (!r.nightAction.status) {
    // v2.1 데이터 호환. 기존 교사용 체크 방식은 새 밤 시작 전까지만 유지한다.
    r.nightAction = freshNight(r.day || 1);
  }
  if (!r.nightAction.actions || typeof r.nightAction.actions !== 'object') r.nightAction.actions = {};
  if (!r.settings) r.settings = {mafiaKnowEachOther:true};
  if (typeof r.settings.mafiaKnowEachOther !== 'boolean') r.settings.mafiaKnowEachOther = true;
  if (!r.currentVotes) r.currentVotes = {};
  if (!Array.isArray(r.voteHistory)) r.voteHistory = [];
  return r;
}
function cleanExpired(){ let changed=false; for(const [c,r] of Object.entries(rooms)){ if(r.expiresAt<=now()){ delete rooms[c]; changed=true; } } if(changed) saveRooms(); }
setInterval(cleanExpired, 10*60*1000).unref();
function getRoom(code){ cleanExpired(); const r=rooms[String(code||'')] || null; return r ? normalizeRoom(r) : null; }
function connected(p){ return now() - (p.lastSeenAt || 0) < 6000; }
function publicRoom(r){ return {code:r.code,expiresAt:r.expiresAt,day:r.day,status:r.status,voteStatus:r.voteStatus,playerCount:r.players.length,aliveCount:r.players.filter(p=>p.alive).length,rolesAssigned:r.rolesAssigned,roleLocked:!!r.roleLocked,nightStatus:r.nightAction?.status||'idle'}; }
function roleLabel(role){ return ({mafia:'마피아',police:'경찰',doctor:'의사',citizen:'시민'})[role]||'미배정'; }
function tally(r){ const c={}; for(const t of Object.values(r.currentVotes||{})) c[t]=(c[t]||0)+1; return r.players.map(p=>({playerId:p.id,name:p.name,votes:c[p.id]||0,alive:p.alive})).filter(x=>x.votes>0).sort((a,b)=>b.votes-a.votes||a.name.localeCompare(b.name,'ko')); }
function playerName(r,id){ return r.players.find(p=>p.id===id)?.name || null; }
function stableCandidateOrder(r,p){
  return r.players
    .filter(x=>x.alive&&x.id!==p.id)
    .map(x=>({id:x.id,name:x.name,key:crypto.createHash('sha256').update(`${r.code}:${r.day}:${p.id}:${x.id}`).digest('hex')}))
    .sort((a,b)=>a.key.localeCompare(b.key))
    .map(({id,name})=>({id,name}));
}
function pickPluralityTarget(r, role, {excludeRole=null}={}){
  const night=r.nightAction||freshNight(r.day);
  const counts={};
  const actors=r.players.filter(p=>p.alive&&p.role===role);
  for(const actor of actors){
    const targetId=night.actions?.[actor.id];
    if(!targetId) continue;
    const target=r.players.find(x=>x.id===targetId&&x.alive);
    if(!target) continue;
    if(excludeRole&&target.role===excludeRole) continue;
    counts[targetId]=(counts[targetId]||0)+1;
  }
  const entries=Object.entries(counts);
  if(!entries.length) return null;
  const max=Math.max(...entries.map(([,n])=>n));
  const tied=entries.filter(([,n])=>n===max).map(([id])=>id);
  if(tied.length===1) return tied[0];
  tied.sort((a,b)=>{
    const ha=crypto.createHash('sha256').update(`${r.code}:${r.day}:${role}:${a}`).digest('hex');
    const hb=crypto.createHash('sha256').update(`${r.code}:${r.day}:${role}:${b}`).digest('hex');
    return ha.localeCompare(hb);
  });
  return tied[0];
}
function nightProgress(r){
  const alive=r.players.filter(p=>p.alive);
  const completed=alive.filter(p=>!!r.nightAction?.actions?.[p.id]).length;
  return {eligible:alive.length,completed};
}
function currentNightSummary(r){
  const mafiaTargetId=pickPluralityTarget(r,'mafia');
  const doctorTargetId=pickPluralityTarget(r,'doctor');
  return {
    mafiaTargetId,
    mafiaTargetName:playerName(r,mafiaTargetId),
    doctorTargetId,
    doctorTargetName:playerName(r,doctorTargetId)
  };
}
function teacherState(r, showRoles=false){
  normalizeRoom(r);
  const night=r.nightAction||freshNight(r.day);
  const nightSummary=currentNightSummary(r);
  return {
    ...publicRoom(r),
    createdAt:r.createdAt,
    settings:r.settings,
    players:r.players.map(p=>({id:p.id,name:p.name,role:showRoles?p.role:null,alive:p.alive,joinedAt:p.joinedAt,connected:!p.virtual&&connected(p),virtual:!!p.virtual,hasVoted:!!r.currentVotes[p.id],nightDone:!!night.actions?.[p.id]})),
    tally:r.voteStatus==='ended'?tally(r):[],
    voteProgress:{eligible:r.players.filter(p=>p.alive).length,voted:Object.keys(r.currentVotes||{}).filter(id=>r.players.some(p=>p.id===id&&p.alive)).length},
    voteHistory:r.voteHistory||[],
    nightAction:{day:night.day,status:night.status,startedAt:night.startedAt,resolved:!!night.resolved,result:night.result||null,...nightSummary,progress:nightProgress(r)},
    nightHistory:r.nightHistory||[],
    nightCapabilities:{mafiaAlive:r.players.some(p=>p.alive&&p.role==='mafia'),doctorAlive:r.players.some(p=>p.alive&&p.role==='doctor')}
  };
}
function studentState(r,p){
  normalizeRoom(r);
  const roleVisible=!!r.rolesAssigned&&!r.roleLocked;
  const fellow=roleVisible&&p.role==='mafia'&&r.settings.mafiaKnowEachOther?r.players.filter(x=>x.role==='mafia'&&x.id!==p.id&&x.alive).map(x=>x.name):[];
  const night=r.nightAction||freshNight(r.day);
  const nightOpen=night.status==='open'&&p.alive;
  const nightDone=!!night.actions?.[p.id];
  let privateNightResult=null;
  if(night.status==='resolved'&&nightDone){
    const pr=(night.result?.policeResults||[]).find(x=>x.policePlayerId===p.id);
    privateNightResult=pr?{kind:'police',targetName:pr.targetName,isMafia:!!pr.isMafia}:{kind:'none'};
  }
  return {
    ...publicRoom(r),
    player:{id:p.id,name:p.name,alive:p.alive,virtual:!!p.virtual,role:roleVisible?p.role:null,roleLabel:roleVisible?roleLabel(p.role):null,fellowMafia:fellow,hasVoted:!!r.currentVotes[p.id],votedTargetId:r.currentVotes[p.id]||null,nightDone},
    candidates:r.voteStatus==='open'&&p.alive?r.players.filter(x=>x.alive&&x.id!==p.id).map(x=>({id:x.id,name:x.name})):[],
    night:{status:night.status,day:night.day,hasActed:nightDone,candidates:nightOpen&&!nightDone?stableCandidateOrder(r,p):[],resolved:!!night.resolved,privateResult:privateNightResult},
    result:r.voteStatus==='ended'?tally(r):null
  };
}
function shuffle(a){ a=[...a]; for(let i=a.length-1;i>0;i--){ const j=crypto.randomInt(i+1); [a[i],a[j]]=[a[j],a[i]]; } return a; }
function json(res,status,obj){ const body=JSON.stringify(obj); res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Content-Length':Buffer.byteLength(body)}); res.end(body); }
function text(res,status,body,type='text/plain; charset=utf-8'){ res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store'}); res.end(body); }
function bodyJson(req){ return new Promise((resolve,reject)=>{ let raw=''; req.on('data',d=>{raw+=d;if(raw.length>100000){reject(new Error('요청이 너무 큽니다.'));req.destroy();}}); req.on('end',()=>{ if(!raw)return resolve({}); try{resolve(JSON.parse(raw));}catch{reject(new Error('잘못된 요청입니다.'));} }); }); }
function header(req,name){ return req.headers[name.toLowerCase()] || ''; }
function teacherAuth(req,r,b){ return header(req,'x-admin-token') || b.adminToken || ''; }
function playerAuth(req,r,b){ return header(req,'x-player-token') || b.playerToken || ''; }

function lanIp(){
  const nets=os.networkInterfaces();
  for(const group of Object.values(nets)) for(const n of (group||[])) if(n.family==='IPv4'&&!n.internal) return n.address;
  return '127.0.0.1';
}
function publicBase(req){
  if(process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/,'');
  const forwardedHost=String(header(req,'x-forwarded-host')||'').split(',')[0].trim();
  const host=forwardedHost || header(req,'host') || `localhost:${PORT}`;
  const proto=String(header(req,'x-forwarded-proto')||'http').split(',')[0].trim() || 'http';
  if(/^localhost(?::\d+)?$/i.test(host)||/^127\.0\.0\.1(?::\d+)?$/.test(host)) return `http://${lanIp()}:${PORT}`;
  return `${proto}://${host}`;
}
function qrSvg(input){
  const q = new QRCode(-1, QRErrorCorrectLevel.M); q.addData(input); q.make();
  const n=q.getModuleCount(), margin=4, size=n+margin*2;
  let parts=[`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="white"/>`];
  for(let r=0;r<n;r++) for(let c=0;c<n;c++) if(q.isDark(r,c)) parts.push(`<rect x="${c+margin}" y="${r+margin}" width="1" height="1" fill="#111"/>`);
  parts.push('</svg>'); return parts.join('');
}

const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
function serveStatic(req,res,pathname){ let rel=pathname==='/'?'/index.html':pathname; try{ rel=decodeURIComponent(rel); }catch{}; const file=path.normalize(path.join(PUBLIC_DIR,rel)); if(!file.startsWith(PUBLIC_DIR)) return text(res,403,'Forbidden'); fs.stat(file,(err,st)=>{ if(err||!st.isFile()) return text(res,404,'Not found'); res.writeHead(200,{'Content-Type':MIME[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache'}); fs.createReadStream(file).pipe(res); }); }

async function api(req,res,u){
  const parts=u.pathname.split('/').filter(Boolean); const method=req.method;
  let b={}; if(['POST','PUT','PATCH'].includes(method)){ try{b=await bodyJson(req);}catch(e){return json(res,400,{error:e.message});} }
  if(method==='GET'&&u.pathname==='/api/health') return json(res,200,{ok:true,app:'class-mafia-online',version:APP_VERSION,mode:HOSTED?'hosted':'local',port:PORT});
  if(method==='POST'&&u.pathname==='/api/rooms'){
    const code=uniqueCode();
    const r={code,adminToken:rand(24),createdAt:now(),expiresAt:now()+ROOM_TTL,day:1,status:'waiting',voteStatus:'idle',rolesAssigned:false,roleLocked:false,settings:{mafiaKnowEachOther:true},players:[],currentVotes:{},voteHistory:[],nightAction:freshNight(1),nightHistory:[]};
    rooms[code]=r; saveRooms(); return json(res,200,{code,adminToken:r.adminToken,expiresAt:r.expiresAt});
  }
  if(parts[0]!=='api'||parts[1]!=='rooms'||!parts[2]) return json(res,404,{error:'API를 찾을 수 없습니다.'});
  const code=parts[2], r=getRoom(code); if(!r) return json(res,404,{error:'방을 찾을 수 없거나 이용 시간이 끝났습니다.'});
  const action=parts.slice(3).join('/');
  if(method==='GET'&&action==='public') return json(res,200,publicRoom(r));
  if(method==='GET'&&action==='qr'){
    const base=publicBase(req); const join=`${base}/student.html?room=${r.code}`; return text(res,200,qrSvg(join),'image/svg+xml');
  }
  if(method==='POST'&&action==='join'){
    if(r.players.length>=40)return json(res,400,{error:'한 방에는 최대 40명까지 입장할 수 있습니다.'});
    const name=String(b.name||'').trim().slice(0,20); if(!name)return json(res,400,{error:'번호 또는 별명을 입력해 주세요.'}); if(r.players.some(p=>p.name===name))return json(res,409,{error:'이미 사용 중인 번호 또는 별명입니다.'}); if(r.rolesAssigned)return json(res,400,{error:'이미 역할 배정이 시작된 방입니다. 선생님께 문의해 주세요.'});
    const p={id:rand(10),token:rand(24),name,role:null,alive:true,joinedAt:now(),lastSeenAt:now()}; r.players.push(p); saveRooms(); return json(res,200,{playerId:p.id,playerToken:p.token,room:publicRoom(r)});
  }
  if(method==='GET'&&action==='me'){
    const token=header(req,'x-player-token')||u.searchParams.get('playerToken')||''; const p=r.players.find(x=>x.token===token); if(!p)return json(res,403,{error:'학생 인증 정보가 없습니다. 다시 입장해 주세요.'}); p.lastSeenAt=now(); return json(res,200,studentState(r,p));
  }
  if(method==='GET'&&action==='teacher'){
    const token=header(req,'x-admin-token')||u.searchParams.get('adminToken')||''; if(token!==r.adminToken)return json(res,403,{error:'교사 권한이 없습니다.'});
    const showRoles=u.searchParams.get('showRoles')==='1'; const st=teacherState(r,showRoles); const base=publicBase(req); st.joinUrl=`${base}/student.html?room=${r.code}`; st.players.forEach(sp=>{ const rp=r.players.find(x=>x.id===sp.id); if(rp?.virtual) sp.previewUrl=`${base}/student.html?room=${r.code}&previewToken=${encodeURIComponent(rp.token)}`; }); return json(res,200,st);
  }
  const admin=teacherAuth(req,r,b); const isTeacher=admin===r.adminToken;
  if(method==='POST'&&action==='test/virtual/add'){
    if(!isTeacher)return json(res,403,{error:'교사 권한이 없습니다.'});
    if(r.rolesAssigned)return json(res,400,{error:'역할 배정 전 테스트 학생을 추가해 주세요. 게임 중이라면 먼저 초기화해 주세요.'});
    const requested=Math.max(1,Math.min(12,parseInt(b.count,10)||6));
    const capacity=Math.max(0,40-r.players.length); if(capacity<1)return json(res,400,{error:'방 인원이 이미 40명입니다.'});
    const count=Math.min(requested,capacity); let serial=1;
    for(let i=0;i<count;i++){
      while(r.players.some(p=>p.name===`테스트${serial}`)) serial++;
      r.players.push({id:rand(10),token:rand(24),name:`테스트${serial}`,role:null,alive:true,joinedAt:now(),lastSeenAt:0,virtual:true}); serial++;
    }
    saveRooms(); return json(res,200,{ok:true,added:count,state:teacherState(r,false)});
  }
  if(method==='POST'&&action==='test/virtual/clear'){
    if(!isTeacher)return json(res,403,{error:'교사 권한이 없습니다.'});
    if(r.rolesAssigned)return json(res,400,{error:'게임 중에는 테스트 학생을 삭제할 수 없습니다. 먼저 게임 초기화를 눌러 주세요.'});
    const before=r.players.length; r.players=r.players.filter(p=>!p.virtual); saveRooms(); return json(res,200,{ok:true,removed:before-r.players.length,state:teacherState(r,false)});
  }
  if(method==='POST'&&action==='test/virtual/night-auto'){
    if(!isTeacher)return json(res,403,{error:'교사 권한이 없습니다.'}); normalizeRoom(r);
    if(r.nightAction.status!=='open')return json(res,400,{error:'밤 행동을 시작한 뒤 사용해 주세요.'});
    let acted=0;
    for(const p of r.players.filter(x=>x.alive&&x.virtual&&!r.nightAction.actions?.[x.id])){
      const candidates=stableCandidateOrder(r,p); if(!candidates.length)continue;
      const idx=parseInt(crypto.createHash('sha256').update(`${r.code}:${r.day}:virtual-night:${p.id}`).digest('hex').slice(0,8),16)%candidates.length;
      r.nightAction.actions[p.id]=candidates[idx].id; acted++;
    }
    saveRooms(); return json(res,200,{ok:true,acted,state:teacherState(r,false)});
  }
  if(method==='POST'&&action==='test/virtual/vote-auto'){
    if(!isTeacher)return json(res,403,{error:'교사 권한이 없습니다.'});
    if(r.voteStatus!=='open')return json(res,400,{error:'낮 투표를 시작한 뒤 사용해 주세요.'});
    let voted=0;
    for(const p of r.players.filter(x=>x.alive&&x.virtual&&!r.currentVotes[x.id])){
      const candidates=r.players.filter(x=>x.alive&&x.id!==p.id); if(!candidates.length)continue;
      const idx=parseInt(crypto.createHash('sha256').update(`${r.code}:${r.day}:virtual-vote:${p.id}`).digest('hex').slice(0,8),16)%candidates.length;
      r.currentVotes[p.id]=candidates[idx].id; voted++;
    }
    saveRooms(); return json(res,200,{ok:true,voted,state:teacherState(r,false)});
  }
  if(method==='POST'&&action==='assign'){
    if(!isTeacher)return json(res,403,{error:'교사 권한이 없습니다.'}); const n=r.players.length; if(n<3)return json(res,400,{error:'학생이 3명 이상 입장한 뒤 역할을 배정해 주세요.'});
    const mafia=Math.max(1,parseInt(b.mafia,10)||0),police=Math.max(0,parseInt(b.police,10)||0),doctor=Math.max(0,parseInt(b.doctor,10)||0); if(mafia+police+doctor>n)return json(res,400,{error:'설정한 특수 역할 수가 전체 학생 수보다 많습니다.'});
    const roles=[...Array(mafia).fill('mafia'),...Array(police).fill('police'),...Array(doctor).fill('doctor'),...Array(n-mafia-police-doctor).fill('citizen')], mix=shuffle(roles);
    r.players.forEach((p,i)=>{p.role=mix[i];p.alive=true;});
    r.settings.mafiaKnowEachOther=b.mafiaKnowEachOther!==false;r.rolesAssigned=true;r.roleLocked=false;r.status='playing';r.day=1;r.voteStatus='idle';r.currentVotes={};r.voteHistory=[];r.nightAction=freshNight(1);r.nightHistory=[];saveRooms();return json(res,200,teacherState(r,false));
  }
  if(method==='POST'&&action==='role-lock'){
    if(!isTeacher)return json(res,403,{error:'교사 권한이 없습니다.'}); if(!r.rolesAssigned)return json(res,400,{error:'먼저 역할을 배정해 주세요.'}); r.roleLocked=b.locked!==false; saveRooms(); return json(res,200,{ok:true,roleLocked:r.roleLocked});
  }
  if(method==='POST'&&action==='vote/start'){
    if(!isTeacher)return json(res,403,{error:'교사 권한이 없습니다.'}); if(!r.rolesAssigned)return json(res,400,{error:'먼저 역할을 배정해 주세요.'}); if(r.nightAction?.status==='open')return json(res,400,{error:'밤 행동을 먼저 종료해 주세요.'}); if(r.voteStatus==='open')return json(res,400,{error:'이미 투표가 진행 중입니다.'}); r.currentVotes={};r.voteStatus='open';saveRooms();return json(res,200,teacherState(r,false));
  }
  if(method==='POST'&&action==='vote'){
    const tok=playerAuth(req,r,b),p=r.players.find(x=>x.token===tok); if(!p)return json(res,403,{error:'학생 인증 정보가 없습니다.'}); p.lastSeenAt=now(); if(r.voteStatus!=='open')return json(res,400,{error:'현재 투표 시간이 아닙니다.'}); if(!p.alive)return json(res,400,{error:'탈락한 학생은 투표할 수 없습니다.'}); if(r.currentVotes[p.id])return json(res,400,{error:'이미 투표했습니다.'}); const t=r.players.find(x=>x.id===String(b.targetId||'')&&x.alive); if(!t)return json(res,400,{error:'투표할 수 없는 대상입니다.'}); if(t.id===p.id)return json(res,400,{error:'자기 자신에게는 투표할 수 없습니다.'}); r.currentVotes[p.id]=t.id;saveRooms();return json(res,200,studentState(r,p));
  }
  if(method==='POST'&&action==='vote/end'){
    if(!isTeacher)return json(res,403,{error:'교사 권한이 없습니다.'}); if(r.voteStatus!=='open')return json(res,400,{error:'진행 중인 투표가 없습니다.'}); r.voteStatus='ended';saveRooms();return json(res,200,teacherState(r,false));
  }
  if(method==='POST'&&action==='eliminate'){
    if(!isTeacher)return json(res,403,{error:'교사 권한이 없습니다.'}); if(r.voteStatus!=='ended')return json(res,400,{error:'투표를 종료한 뒤 탈락 처리해 주세요.'}); if(r.voteHistory.some(h=>h.day===r.day))return json(res,400,{error:'이번 일차의 탈락 처리가 이미 완료되었습니다.'}); const p=r.players.find(x=>x.id===String(b.playerId||'')); if(!p||!p.alive)return json(res,400,{error:'탈락 처리할 수 없는 학생입니다.'}); p.alive=false; r.voteHistory.push({day:r.day,endedAt:now(),eliminatedPlayerId:p.id,eliminatedName:p.name,tally:tally(r),votes:{...r.currentVotes}}); saveRooms();return json(res,200,teacherState(r,false));
  }
  if(method==='POST'&&action==='night/start'){
    if(!isTeacher)return json(res,403,{error:'교사 권한이 없습니다.'});
    if(!r.rolesAssigned)return json(res,400,{error:'먼저 역할을 배정해 주세요.'});
    if(r.voteStatus==='open')return json(res,400,{error:'진행 중인 낮 투표를 먼저 종료해 주세요.'});
    normalizeRoom(r);
    if(r.nightAction.status==='open')return json(res,400,{error:'이미 밤 행동이 진행 중입니다.'});
    if(r.nightAction.resolved)return json(res,400,{error:'이번 일차의 밤 결과가 이미 적용되었습니다.'});
    r.nightAction={day:r.day,status:'open',startedAt:now(),actions:{},resolved:false,result:null};
    r.roleLocked=true;
    saveRooms();
    return json(res,200,teacherState(r,false));
  }
  if(method==='POST'&&action==='night/action'){
    const tok=playerAuth(req,r,b),p=r.players.find(x=>x.token===tok);
    if(!p)return json(res,403,{error:'학생 인증 정보가 없습니다.'});
    p.lastSeenAt=now(); normalizeRoom(r);
    if(r.nightAction.status!=='open')return json(res,400,{error:'현재 밤 행동 시간이 아닙니다.'});
    if(!p.alive)return json(res,400,{error:'탈락한 학생은 밤 행동에 참여할 수 없습니다.'});
    if(r.nightAction.actions[p.id])return json(res,400,{error:'이미 밤 행동을 완료했습니다.'});
    const targetId=String(b.targetId||'');
    const t=r.players.find(x=>x.id===targetId&&x.alive);
    if(!t)return json(res,400,{error:'선택할 수 없는 대상입니다.'});
    if(t.id===p.id)return json(res,400,{error:'자기 자신은 선택할 수 없습니다.'});
    r.nightAction.actions[p.id]=t.id;
    saveRooms();
    return json(res,200,studentState(r,p));
  }
  if(method==='POST'&&action==='night/resolve'){
    if(!isTeacher)return json(res,403,{error:'교사 권한이 없습니다.'});
    if(!r.rolesAssigned)return json(res,400,{error:'먼저 역할을 배정해 주세요.'});
    normalizeRoom(r);
    if(r.nightAction.status!=='open')return json(res,400,{error:'진행 중인 밤 행동이 없습니다.'});
    if(r.nightAction.resolved)return json(res,400,{error:'이번 일차의 밤 결과가 이미 적용되었습니다.'});
    const progress=nightProgress(r);
    if(progress.completed<progress.eligible)return json(res,400,{error:`아직 밤 행동을 완료하지 않은 학생이 있습니다. (${progress.completed}/${progress.eligible}명)`});
    const summary=currentNightSummary(r);
    const target=r.players.find(p=>p.id===summary.mafiaTargetId&&p.alive);
    const doctorTarget=r.players.find(p=>p.id===summary.doctorTargetId&&p.alive);
    const mafiaAlive=r.players.some(p=>p.alive&&p.role==='mafia');
    if(mafiaAlive&&!target)return json(res,400,{error:'마피아의 선택 결과를 확인할 수 없습니다.'});
    const protectedSuccess=!!target&&!!doctorTarget&&target.id===doctorTarget.id;
    const policeResults=r.players.filter(p=>p.alive&&p.role==='police').map(police=>{
      const targetId=r.nightAction.actions?.[police.id]||null;
      const investigated=r.players.find(x=>x.id===targetId);
      return {policePlayerId:police.id,targetId:investigated?.id||null,targetName:investigated?.name||null,isMafia:investigated?.role==='mafia'};
    }).filter(x=>x.targetId);
    let eliminated=null;
    if(target&&!protectedSuccess){ target.alive=false; eliminated=target; }
    const result={day:r.day,resolvedAt:now(),mafiaTargetId:target?.id||null,mafiaTargetName:target?.name||null,doctorTargetId:doctorTarget?.id||null,doctorTargetName:doctorTarget?.name||null,policeResults,protected:protectedSuccess,eliminatedPlayerId:eliminated?.id||null,eliminatedName:eliminated?.name||null};
    r.nightAction.status='resolved';r.nightAction.resolved=true;r.nightAction.result=result;r.nightHistory.push(result);saveRooms();return json(res,200,{ok:true,result});
  }
  if(method==='POST'&&action==='day/next'){
    if(!isTeacher)return json(res,403,{error:'교사 권한이 없습니다.'});
    if(r.voteStatus==='open')return json(res,400,{error:'진행 중인 투표를 먼저 종료해 주세요.'});
    if(r.nightAction?.status==='open')return json(res,400,{error:'진행 중인 밤 행동을 먼저 종료해 주세요.'});
    if(r.voteStatus==='ended'&&!r.voteHistory.some(h=>h.day===r.day))r.voteHistory.push({day:r.day,endedAt:now(),eliminatedPlayerId:null,eliminatedName:'탈락자 없음',tally:tally(r),votes:{...r.currentVotes}});
    r.day++;r.voteStatus='idle';r.currentVotes={};r.nightAction=freshNight(r.day);saveRooms();return json(res,200,teacherState(r,false));
  }
  if(method==='POST'&&action==='kick'){
    if(!isTeacher)return json(res,403,{error:'교사 권한이 없습니다.'}); if(r.rolesAssigned)return json(res,400,{error:'역할 배정 후에는 학생을 내보낼 수 없습니다. 게임 초기화를 이용해 주세요.'}); const i=r.players.findIndex(x=>x.id===String(b.playerId||'')); if(i<0)return json(res,404,{error:'학생을 찾을 수 없습니다.'}); r.players.splice(i,1);saveRooms();return json(res,200,teacherState(r,false));
  }
  if(method==='POST'&&action==='reset'){
    if(!isTeacher)return json(res,403,{error:'교사 권한이 없습니다.'}); r.players.forEach(p=>{p.role=null;p.alive=true;});r.day=1;r.status='waiting';r.voteStatus='idle';r.rolesAssigned=false;r.roleLocked=false;r.currentVotes={};r.voteHistory=[];r.nightAction=freshNight(1);r.nightHistory=[];saveRooms();return json(res,200,teacherState(r,false));
  }
  if(method==='POST'&&action==='delete'){
    if(!isTeacher)return json(res,403,{error:'교사 권한이 없습니다.'}); delete rooms[code];saveRooms();return json(res,200,{ok:true});
  }
  return json(res,404,{error:'요청을 찾을 수 없습니다.'});
}

const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Referrer-Policy','same-origin');
  const host=header(req,'host')||`localhost:${PORT}`; const u=new URL(req.url,`http://${host}`);
  if(u.pathname.startsWith('/api/')){ try{return await api(req,res,u);}catch(e){console.error(e);return json(res,500,{error:'서버 오류가 발생했습니다.'});} }
  serveStatic(req,res,u.pathname);
});
server.on('error',(e)=>{ console.error('SERVER_START_ERROR', e && e.code ? e.code : e); process.exitCode = 1; });
server.listen(PORT,HOST,()=>{
  try { fs.writeFileSync(PID_FILE, String(process.pid), 'ascii'); } catch (_) {}
  console.log(`\n우리 반 마피아 Online v${APP_VERSION} 실행: http://localhost:${PORT}`);
  if (!HOSTED) console.log(`로컬 미리보기 학생 주소: http://${lanIp()}:${PORT}`); else console.log('인터넷 배포 모드로 실행 중입니다.');
  console.log('종료: Ctrl+C\n');
});
function cleanupPid(){ try { if (fs.existsSync(PID_FILE) && fs.readFileSync(PID_FILE,'ascii').trim() === String(process.pid)) fs.unlinkSync(PID_FILE); } catch (_) {} }
process.on('exit', cleanupPid);
process.on('SIGINT',()=>{ cleanupPid(); server.close(()=>process.exit(0)); setTimeout(()=>process.exit(0),800).unref(); });
process.on('SIGTERM',()=>{ cleanupPid(); server.close(()=>process.exit(0)); setTimeout(()=>process.exit(0),800).unref(); });
