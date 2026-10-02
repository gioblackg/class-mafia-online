const Module = require('module');
const fs = require('fs');
const path = require('path');
const original = Module._extensions['.js'];

Module._extensions['.js'] = function(mod, filename) {
  if (path.basename(filename) !== 'server.js') return original(mod, filename);
  let src = fs.readFileSync(filename, 'utf8');

  src = src.replace("const APP_VERSION = '2.10.0';", "const APP_VERSION = '2.11.0';");
  src = src.replace("nightStatus:r.nightAction?.status||'idle'};", "nightStatus:r.nightAction?.status||'idle',winner:r.winner||null};");
  src = src.replace("({mafia:'마피아',police:'경찰',doctor:'의사',citizen:'시민'})", "({mafia:'마피아',police:'경찰',doctor:'의사',clown:'광대',citizen:'시민'})");
  src = src.replace(
    "const mafia=Math.max(1,parseInt(b.mafia,10)||0),police=Math.max(0,parseInt(b.police,10)||0),doctor=Math.max(0,parseInt(b.doctor,10)||0); if(mafia+police+doctor>n)return json(res,400,{error:'설정한 특수 역할 수가 전체 학생 수보다 많습니다.'});",
    "const mafia=Math.max(1,parseInt(b.mafia,10)||0),police=Math.max(0,parseInt(b.police,10)||0),doctor=Math.max(0,parseInt(b.doctor,10)||0),clown=Math.max(0,Math.min(1,parseInt(b.clown,10)||0)); if(mafia+police+doctor+clown>n)return json(res,400,{error:'설정한 특수 역할 수가 전체 학생 수보다 많습니다.'});"
  );
  src = src.replace(
    "const roles=[...Array(mafia).fill('mafia'),...Array(police).fill('police'),...Array(doctor).fill('doctor'),...Array(n-mafia-police-doctor).fill('citizen')], mix=shuffle(roles);",
    "const roles=[...Array(mafia).fill('mafia'),...Array(police).fill('police'),...Array(doctor).fill('doctor'),...Array(clown).fill('clown'),...Array(n-mafia-police-doctor-clown).fill('citizen')], mix=shuffle(roles);"
  );
  src = src.replace(
    "r.settings.mafiaKnowEachOther=b.mafiaKnowEachOther!==false;r.settings.totalDays=totalDays;r.rolesAssigned=true",
    "r.settings.mafiaKnowEachOther=b.mafiaKnowEachOther!==false;r.settings.totalDays=totalDays;r.settings.clown=clown;r.winner=null;r.rolesAssigned=true"
  );
  src = src.replace(
    "p.alive=false; r.voteHistory.push({day:r.day,endedAt:now(),eliminatedPlayerId:p.id,eliminatedName:p.name,tally:tally(r),votes:{...r.currentVotes}}); saveRooms();return json(res,200,teacherState(r,false));",
    "p.alive=false; const clownWin=p.role==='clown'; if(clownWin){r.winner='clown';r.status='finished';} r.voteHistory.push({day:r.day,endedAt:now(),eliminatedPlayerId:p.id,eliminatedName:p.name,eliminatedRole:p.role,clownWin,tally:tally(r),votes:{...r.currentVotes}}); saveRooms();return json(res,200,teacherState(r,false));"
  );
  src = src.replace(
    "r.nightHistory=[];saveRooms();return json(res,200,teacherState(r,false));",
    "r.nightHistory=[];r.winner=null;saveRooms();return json(res,200,teacherState(r,false));"
  );

  mod._compile(src, filename);
};
