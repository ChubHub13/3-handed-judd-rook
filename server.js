const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const rooms = new Map();
const PLAYER_TIMEOUT_MS = 7000;
const ROOM_TTL_MS = 6 * 60 * 60 * 1000;
const VALUES = [1, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const SUITS = ['red', 'yellow', 'green', 'black'];
const TARGET_SCORE = 1000;

function id(prefix) { return prefix + crypto.randomBytes(9).toString('hex'); }
function cleanName(v, fallback='Player') { const s=String(v||'').trim().slice(0,18); return s||fallback; }
function roomCode() {
  const a='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code=''; do { code='ROOK-'+Array.from({length:4},()=>a[Math.floor(Math.random()*a.length)]).join(''); } while (rooms.has(code));
  return code;
}
function cardName(card){ return card.rook?'the Rook':`${card.suit} ${card.value}`; }
function points(card){ if(card.rook)return 20; if(card.value===1)return 15; if(card.value===5)return 5; if(card.value===10||card.value===14)return 10; return 0; }
function buildDeck(){ let n=0, d=[]; for(const suit of SUITS) for(const value of VALUES) d.push({id:`c${n++}`,suit,value,rook:false}); d.push({id:`c${n}`,suit:'rook',value:null,rook:true}); return d; }
function shuffle(a){ for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; }
function rookRank(room){ return room.settings.rookRank==='high'?16:room.settings.rookRank==='low'?4:10.5; }
function rank(room, card){ if(card.rook)return room.state.trump==='none'?10.5:rookRank(room); return card.value===1?15:card.value; }
function effSuit(room,card){ return card.rook?(room.state.trump==='none'?'red':room.state.trump):card.suit; }
function handSize(){ return 12; }
function discardCount(){ return 9; }
function legalCards(room,seat){
  const hand=room.state.hands[seat]||[]; if(!room.state.trick.length)return hand;
  const lead=effSuit(room,room.state.trick[0].card); const follow=hand.filter(c=>effSuit(room,c)===lead); return follow.length?follow:hand;
}
function beats(room,a,b,lead){ const as=effSuit(room,a), bs=effSuit(room,b); const at=as===room.state.trump, bt=bs===room.state.trump; if(at!==bt)return at; if(as===bs)return rank(room,a)>rank(room,b); if(as===lead&&bs!==lead)return true; return false; }
function trickWinner(room,trick){ let best=trick[0]; const lead=effSuit(room,trick[0].card); for(let i=1;i<trick.length;i++)if(beats(room,trick[i].card,best.card,lead))best=trick[i]; return best.seat; }

function newRoom(hostName){
  const r={
    code:roomCode(), createdAt:Date.now(), hostPlayerId:null, started:false,
    settings:{rookRank:'10.5',winScore:TARGET_SCORE},
    seats:[0,1,2].map(seat=>({seat,playerId:null,name:null,connected:false,bot:false,lastSeen:0})),
    state:null
  };
  const p=id('p_'); r.hostPlayerId=p; r.seats[0]={seat:0,playerId:p,name:cleanName(hostName,'Host'),connected:true,bot:false,lastSeen:Date.now()};
  rooms.set(r.code,r); return {room:r,playerId:p,seat:0};
}
function findRoom(code){ return rooms.get(String(code||'').trim().toUpperCase()); }
function seatFor(room,pid){ return room.seats.findIndex(s=>s.playerId===pid); }
function setBot(room,seat){ room.seats[seat]={seat,playerId:id('bot_'),name:`Bot ${seat+1}`,connected:true,bot:true,lastSeen:Date.now()}; }
function refresh(room){ const now=Date.now(); for(const s of room.seats){ if(!s.playerId||s.bot)continue; if(now-s.lastSeen>PLAYER_TIMEOUT_MS){s.connected=false; if(room.started)setBot(room,s.seat);} } }
function fillBots(room){ for(let i=0;i<3;i++)if(!room.seats[i].playerId||room.seats[i].bot)setBot(room,i); }
function playerName(room,seat){ return room.seats[seat]?.name||`Player ${seat+1}`; }

function makePublic(room, requesterSeat=null){
  refresh(room);
  const s=room.state;
  const pub={
    phase:s?.phase||'lobby', handNumber:s?.handNumber||0, dealer:s?.dealer??null, turn:s?.turn??null,
    currentBidder:s?.currentBidder??null, highBid:s?.highBid||0, highBidder:s?.highBidder??null, trump:s?.trump??null,
    bidTeam:s?.bidTeam??null, scores:s?.scores||[0,0,0], trick:(s?.trick||[]).map(x=>({seat:x.seat,card:x.card})),
    lastTrick:s?.lastTrick||null, kittyCount:s?.nest?.length||0, hands:s?s.hands.map((h,i)=>i===requesterSeat?h: h.map(()=>({back:true}))):[[],[],[]],
    handCounts:s?s.hands.map(h=>h.length):[0,0,0], selectedDiscards:s?.selectedDiscards||[], prompt:s?.prompt||'', winner:s?.winner??null,
    seats:room.seats.map(x=>({seat:x.seat,name:x.name,connected:x.connected,bot:x.bot,isHost:x.playerId===room.hostPlayerId})),
    started:room.started, roomCode:room.code
  };
  return pub;
}
function response(res,status,payload){ const body=JSON.stringify(payload); res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type'}); res.end(body); return true; }
function readJson(req){ return new Promise((resolve,reject)=>{let b=''; req.on('data',c=>{b+=c;if(b.length>50000)req.destroy();});req.on('end',()=>{try{resolve(b?JSON.parse(b):{});}catch(e){reject(e);}});req.on('error',reject);}); }

function sortHand(room,hand){ hand.sort((a,b)=>{ const so={red:0,yellow:1,green:2,black:3,rook:4}; const sa=a.rook?(room.state.trump||a.suit):a.suit; const sb=b.rook?(room.state.trump||b.suit):b.suit; return (so[sa]-so[sb]) || (rank(room,b)-rank(room,a));}); }
function deal(room){
  const d=shuffle(buildDeck()); const hands=[[],[],[]];
  for(let r=0;r<12;r++)for(let off=1;off<=3;off++){const seat=(room.state.dealer+off)%3; hands[seat].push(d.pop());}
  room.state.hands=hands; room.state.nest=d.splice(0); room.state.phase='bidding'; room.state.currentBidder=(room.state.dealer+1)%3; room.state.turn=null; room.state.trump=null;
  room.state.highBid=0; room.state.highBidder=null; room.state.passed=[false,false,false]; room.state.lastBid=[null,null,null]; room.state.trick=[]; room.state.lastTrick=null; room.state.selectedDiscards=[]; room.state.prompt='Bidding';
  hands.forEach(h=>sortHand(room,h));
  runBots(room);
}
function newGame(room){
  room.started=true; room.state={phase:'dealing',handNumber:(room.state?.handNumber||0)+1,dealer:room.state?.dealer==null?Math.floor(Math.random()*3):(room.state.dealer+1)%3,scores:room.state?.scores||[0,0,0],hands:[[],[],[]],nest:[],trick:[],lastTrick:null,highBid:0,highBidder:null,currentBidder:null,turn:null,trump:null,passed:[false,false,false],lastBid:[null,null,null],selectedDiscards:[],prompt:'Dealing cards',winner:null,bidTeam:null}; setTimeout(()=>deal(room),150); }
function botSeat(room,seat){ const s=room.seats[seat]; return s?.bot===true; }
function estimateBid(room,seat){ const hand=room.state.hands[seat]; const rook=hand.some(c=>c.rook); let best=0; for(const suit of SUITS){let v=0,cnt=0;for(const c of hand){if(c.rook){v+=7;continue;}if(c.suit!==suit)continue;cnt++;v+=c.value===1?22:c.value===14?12:c.value===13?8:c.value===12?5:2;} best=Math.max(best,v+cnt*6);} let bid=150+Math.round((best-45)/5)*5; if(rook)bid+=10; return Math.max(150,Math.min(175,bid)); }
function botBid(room,seat){ if(room.state.currentBidder!==seat||room.state.phase!=='bidding')return; const next=room.state.highBid?Math.min(400,room.state.highBid<200?room.state.highBid+5:400):150; const max=estimateBid(room,seat); if(next<=max){room.state.highBid=next;room.state.highBidder=seat;room.state.lastBid[seat]=next;} else {room.state.passed[seat]=true;room.state.lastBid[seat]='Pass';} advanceBid(room,seat); }
function advanceBid(room,from){ const active=[0,1,2].filter(x=>!room.state.passed[x]); if(room.state.highBidder!==null&&active.length===1&&active[0]===room.state.highBidder){finishBid(room);return;} if(!active.length){room.state.passed=[false,false,false];room.state.lastBid=[null,null,null];room.state.highBid=0;room.state.highBidder=null;room.state.currentBidder=0;room.state.prompt='No bid - bidding restarts';return;} let n=null; for(let o=1;o<=3;o++){const c=(from+o)%3;if(!room.state.passed[c]){n=c;break;}} room.state.currentBidder=n; room.state.prompt=`${playerName(room,n)} is bidding`;
  if(botSeat(room,n))setTimeout(()=>botBid(room,n),500);
}
function finishBid(room){ room.state.phase='pickup'; room.state.currentBidder=null; room.state.bidTeam=room.state.highBidder; room.state.prompt=`${playerName(room,room.state.highBidder)} won the bid at ${room.state.highBid}`; const b=room.state.highBidder; if(botSeat(room,b))botPrepare(room,b); }
function chooseTrump(room,seat){ const hand=room.state.hands[seat]; let best='red',bs=-1; for(const suit of SUITS){let x=0;for(const c of hand){if(c.rook)x+=10; else if(c.suit===suit)x+=(c.value===1?18:c.value===14?10:c.value>=12?6:2);}if(x>bs){bs=x;best=suit;}} return best; }
function botPrepare(room,seat){ if(room.state.phase!=='pickup'||room.state.highBidder!==seat)return; room.state.hands[seat].push(...room.state.nest); room.state.nest=[]; room.state.trump=chooseTrump(room,seat); sortHand(room,room.state.hands[seat]); const scored=[...room.state.hands[seat]].map(c=>({c,score:(c.rook?100:0)+(c.suit===room.state.trump?40:0)+(c.value===1?45:c.value===14?24:c.value===13?14:c.value===12?9:c.value*0.3)})).sort((a,b)=>a.score-b.score); const discard=scored.slice(0,9).map(x=>x.c.id); room.state.nest=room.state.hands[seat].filter(c=>discard.includes(c.id)); room.state.hands[seat]=room.state.hands[seat].filter(c=>!discard.includes(c.id)); sortHand(room,room.state.hands[seat]); beginPlay(room); }
function beginPlay(room){ room.state.phase='playing'; room.state.turn=room.state.highBidder; room.state.trick=[]; room.state.prompt=`${playerName(room,room.state.turn)} leads`; if(botSeat(room,room.state.turn))setTimeout(()=>botPlay(room,room.state.turn),500); }
function botPlay(room,seat){ if(room.state.phase!=='playing'||room.state.turn!==seat)return; const legal=legalCards(room,seat); let card; if(!room.state.trick.length){ const nonTrump=legal.filter(c=>effSuit(room,c)!==room.state.trump); card=(nonTrump.length?nonTrump:legal).sort((a,b)=>rank(room,a)-rank(room,b))[0]; } else { const lead=effSuit(room,room.state.trick[0].card); const current=trickWinner(room,room.state.trick); const win=room.state.trick.find(x=>x.seat===current).card; const wins=legal.filter(c=>beats(room,c,win,lead)); card=(wins.length?wins:legal).sort((a,b)=>rank(room,a)-rank(room,b))[0]; }
  play(room,seat,card.id);
}
function play(room,seat,cardId){ if(room.state.phase!=='playing'||room.state.turn!==seat) return {ok:false,message:'Not your turn.'}; const legal=legalCards(room,seat); const card=legal.find(c=>c.id===cardId); if(!card)return {ok:false,message:'Illegal card.'}; const i=room.state.hands[seat].findIndex(c=>c.id===cardId); room.state.hands[seat].splice(i,1); room.state.trick.push({seat,card}); if(room.state.trick.length<3){room.state.turn=(seat+1)%3;room.state.prompt=`${playerName(room,room.state.turn)} to play`;if(botSeat(room,room.state.turn))setTimeout(()=>botPlay(room,room.state.turn),350);return {ok:true};}
  const winner=trickWinner(room,room.state.trick); const pts=room.state.trick.reduce((s,x)=>s+points(x.card),0); room.state.lastTrick={plays:room.state.trick.map(x=>({seat:x.seat,card:x.card})),winner,points:pts}; room.state.trick=[]; room.state.turn=winner; room.state.prompt=`${playerName(room,winner)} won the trick`; if(room.state.hands.every(h=>h.length===0))score(room); else if(botSeat(room,winner))setTimeout(()=>botPlay(room,winner),500); return {ok:true}; }
function score(room){
  const s=room.state;
  const bid=s.highBidder;
  const nestPoints=(s.nest||[]).reduce((sum,c)=>sum+points(c),0)+20;
  const bidderPoints=(s.capturedPoints?.[bid]||0);
  const totalAvailable=(s.totalPoints||0)+nestPoints;
  const made=s.highBid===400 ? bidderPoints===totalAvailable : bidderPoints>=s.highBid;
  const defenderPoints=Math.max(0,totalAvailable-bidderPoints);
  const changes=[0,0,0];
  if(s.highBid===400){
    changes[bid]=made?400:-400;
    for(let i=0;i<3;i++)if(i!==bid)changes[i]=made?0:defenderPoints;
  }else{
    changes[bid]=made?bidderPoints:-s.highBid;
    for(let i=0;i<3;i++)if(i!==bid)changes[i]=defenderPoints;
  }
  for(let i=0;i<3;i++)s.scores[i]=Math.max(0,(s.scores[i]||0)+changes[i]);
  const reached=s.scores.map((score,i)=>score>=room.settings.winScore?i:null).filter(v=>v!==null);
  s.winner=reached.length===1?reached[0]:null;
  s.finalPoints=[bidderPoints,defenderPoints];
  s.finalChanges=changes;
  s.phase=s.winner===null?'scoring':'gameover';
  s.prompt=s.winner===null?`${playerName(room,bid)} ${made?'made':'was set on'} ${s.highBid} — ${bidderPoints} bidder points`:`${playerName(room,s.winner)} wins the game`;
}
function updateCaptured(room,plays){ const pts=plays.reduce((s,x)=>s+points(x.card),0); const winner=trickWinner(room,plays); if(!room.state.trickPointsByPlayer)room.state.trickPointsByPlayer=[0,0,0]; room.state.trickPointsByPlayer[winner]+=pts; room.state.totalPoints=(room.state.totalPoints||0)+pts; room.state.capturedPoints=room.state.trickPointsByPlayer.reduce((a,v)=>a+v,0)===room.state.totalPoints?room.state.capturedPoints||[0,0,0]:room.state.capturedPoints||[0,0,0]; room.state.capturedPoints[winner]+=pts; }
const oldPlay=play;
play=function(room,seat,cardId){ if(room.state.phase!=='playing'||room.state.turn!==seat)return {ok:false,message:'Not your turn.'}; const legal=legalCards(room,seat); const card=legal.find(c=>c.id===cardId); if(!card)return {ok:false,message:'Illegal card.'}; const i=room.state.hands[seat].findIndex(c=>c.id===cardId); room.state.hands[seat].splice(i,1); room.state.trick.push({seat,card}); if(room.state.trick.length<3){room.state.turn=(seat+1)%3;room.state.prompt=`${playerName(room,room.state.turn)} to play`;if(botSeat(room,room.state.turn))setTimeout(()=>botPlay(room,room.state.turn),350);return {ok:true};} const plays=room.state.trick.slice(); const winner=trickWinner(room,plays); const pts=plays.reduce((s,x)=>s+points(x.card),0); if(!room.state.trickPointsByPlayer)room.state.trickPointsByPlayer=[0,0,0]; if(!room.state.capturedPoints)room.state.capturedPoints=[0,0,0]; room.state.capturedPoints[winner]+=pts; room.state.totalPoints=(room.state.totalPoints||0)+pts; room.state.lastTrick={plays:plays.map(x=>({seat:x.seat,card:x.card})),winner,points:pts}; room.state.trick=[]; room.state.turn=winner; if(room.state.hands.every(h=>h.length===0))score(room); else {room.state.prompt=`${playerName(room,winner)} won the trick`; if(botSeat(room,winner))setTimeout(()=>botPlay(room,winner),500);} return {ok:true}; };

function runBots(room){ if(!room.started)return; if(room.state.phase==='bidding'&&botSeat(room,room.state.currentBidder))setTimeout(()=>botBid(room,room.state.currentBidder),500); if(room.state.phase==='playing'&&botSeat(room,room.state.turn))setTimeout(()=>botPlay(room,room.state.turn),500); }

async function handle(req,res){
  try{
    if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type'});return res.end();}
    if(req.method==='POST'&&req.url==='/api/room/create'){const d=await readJson(req),c=newRoom(d.name);return response(res,200,{ok:true,roomCode:c.room.code,playerId:c.playerId,seat:c.seat,state:makePublic(c.room,0)});}
    if(req.method==='POST'&&req.url==='/api/room/join'){const d=await readJson(req),r=findRoom(d.roomCode);if(!r)return response(res,404,{ok:false,message:'Room not found.'});refresh(r);let s=r.seats.findIndex(x=>!x.playerId&&!x.bot); if(s<0)s=r.seats.findIndex(x=>!x.connected&&!x.bot); if(s<0)return response(res,409,{ok:false,message:'Room is full.'}); if(r.started&&r.seats[s].playerId&&!r.seats[s].bot)return response(res,409,{ok:false,message:'Game is already in progress.'}); const p=id('p_');r.seats[s]={seat:s,playerId:p,name:cleanName(d.name),connected:true,bot:false,lastSeen:Date.now()};return response(res,200,{ok:true,roomCode:r.code,playerId:p,seat:s,host:p===r.hostPlayerId,state:makePublic(r,s)});}
    if(req.method==='POST'&&req.url==='/api/room/heartbeat'){const d=await readJson(req),r=findRoom(d.roomCode);if(!r)return response(res,404,{ok:false,message:'Room not found.'});const s=seatFor(r,d.playerId);if(s<0)return response(res,404,{ok:false,message:'Player not found.'});r.seats[s].lastSeen=Date.now();r.seats[s].connected=true;return response(res,200,{ok:true,state:makePublic(r,s)});}
    if(req.method==='GET'&&req.url.startsWith('/api/state')){const u=new URL(req.url,'http://x'),r=findRoom(u.searchParams.get('roomCode'));if(!r)return response(res,404,{ok:false,message:'Room not found.'});const s=seatFor(r,u.searchParams.get('playerId'));if(s<0)return response(res,403,{ok:false,message:'Not a member.'});return response(res,200,{ok:true,state:makePublic(r,s)});}
    if(req.method==='POST'&&req.url==='/api/action'){const d=await readJson(req),r=findRoom(d.roomCode);if(!r)return response(res,404,{ok:false,message:'Room not found.'});refresh(r);const seat=seatFor(r,d.playerId);if(seat<0)return response(res,403,{ok:false,message:'Not a member.'});if(r.seats[seat].bot)return response(res,403,{ok:false,message:'That seat is controlled by a bot.'});r.seats[seat].lastSeen=Date.now();r.seats[seat].connected=true;let result={ok:false,message:'Unknown action.'};
      if(d.action==='start'){if(d.playerId!==r.hostPlayerId)return response(res,403,{ok:false,message:'Only the host can start.'});fillBots(r);newGame(r);result={ok:true};}
      else if(!r.started||!r.state)result={ok:false,message:'Game has not started.'};
      else if(d.action==='bid'){if(r.state.phase!=='bidding'||r.state.currentBidder!==seat)return response(res,409,{ok:false,message:'Not your bidding turn.'});const min=r.state.highBid?r.state.highBid<200?r.state.highBid+5:400:150;const b=Number(d.bid);if(!Number.isFinite(b)||b<min||b>400||(b>200&&b<400))return response(res,409,{ok:false,message:`Minimum bid is ${min}.`});r.state.highBid=b;r.state.highBidder=seat;r.state.lastBid[seat]=b;advanceBid(r,seat);result={ok:true};}
      else if(d.action==='pass'){if(r.state.phase!=='bidding'||r.state.currentBidder!==seat)return response(res,409,{ok:false,message:'Not your bidding turn.'});r.state.passed[seat]=true;r.state.lastBid[seat]='Pass';advanceBid(r,seat);result={ok:true};}
      else if(d.action==='trump'){if(r.state.phase!=='pickup'||r.state.highBidder!==seat)return response(res,409,{ok:false,message:'Trump selection is not available.'});if(!SUITS.includes(d.trump))return response(res,409,{ok:false,message:'Choose a color.'});r.state.hands[seat].push(...r.state.nest);r.state.nest=[];r.state.trump=d.trump;sortHand(r,r.state.hands[seat]);r.state.phase='discard';r.state.selectedDiscards=[];r.state.prompt=`Return ${discardCount()} cards`;result={ok:true};}
      else if(d.action==='discard'){if(r.state.phase!=='discard'||r.state.highBidder!==seat)return response(res,409,{ok:false,message:'Discard is not available.'});const ids=Array.isArray(d.cardIds)?d.cardIds:[];if(ids.length!==9)return response(res,409,{ok:false,message:'Select exactly 9 cards.'});const uniq=[...new Set(ids)];if(uniq.length!==9||uniq.some(cid=>!r.state.hands[seat].some(c=>c.id===cid)))return response(res,409,{ok:false,message:'Invalid discard selection.'});r.state.nest=r.state.hands[seat].filter(c=>uniq.includes(c.id));r.state.hands[seat]=r.state.hands[seat].filter(c=>!uniq.includes(c.id));sortHand(r,r.state.hands[seat]);beginPlay(r);result={ok:true};}
      else if(d.action==='play'){result=play(r,seat,d.cardId);}
      else if(d.action==='nextHand'){if(d.playerId!==r.hostPlayerId||r.state.phase!=='scoring')return response(res,409,{ok:false,message:'Host can only deal the next hand after scoring.'});newGame(r);result={ok:true};}
      return response(res,result.ok?200:409,{...result,state:makePublic(r,seat)});
    }
    return false;
  }catch(e){console.error(e);return response(res,500,{ok:false,message:'Server error.'});}
}

const server=http.createServer(async(req,res)=>{const handled=await handle(req,res);if(handled)return;let rp=req.url==='/'?'/index.html':req.url.split('?')[0];const rel=path.normalize(rp).replace(/^[/\\]+/,'');const fp=path.join(__dirname,rel);if(!fp.startsWith(__dirname)){res.writeHead(403);return res.end('Forbidden');}fs.readFile(fp,(err,data)=>{if(err){res.writeHead(err.code==='ENOENT'?404:500);return res.end(err.code==='ENOENT'?'Not found':'Server error');}const ext=path.extname(fp).toLowerCase();const ct=ext==='.html'?'text/html; charset=utf-8':ext==='.js'?'text/javascript; charset=utf-8':ext==='.css'?'text/css; charset=utf-8':'application/octet-stream';res.writeHead(200,{'Content-Type':ct,'Cache-Control':'no-store'});res.end(data);});});
setInterval(()=>{const cut=Date.now()-ROOM_TTL_MS;for(const [c,r] of rooms)if(r.createdAt<cut)rooms.delete(c);},15*60*1000);
server.listen(PORT,HOST,()=>console.log(`3-Handed Judd Rook authoritative server listening on http://${HOST}:${PORT}`));
