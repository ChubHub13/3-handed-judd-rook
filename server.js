const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = __dirname;
const VERSION = '1.0.4';
const PLAYER_NAMES = ['Daryl', 'Cristi', 'Cindy'];
const SUITS = ['red', 'yellow', 'green', 'black'];
const VALUES = [1, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const WIN_SCORE = 1000;
const BID_START = 150;
const KITTY_SIZE = 9;
const HAND_SIZE = 12;
const PLAYER_TIMEOUT_MS = 8000;
const TRICK_REVEAL_MS = 3000;
const BOT_DELAY = { bid: 700, play: 650, trick: 1200 };

const sessions = new Map();
const game = createGame();
let botTimer = null;
let revealTimer = null;

function id(prefix) { return prefix + crypto.randomBytes(8).toString('hex'); }
function cleanName(v) { const n = String(v || '').trim(); return PLAYER_NAMES.includes(n) ? n : null; }
function now() { return Date.now(); }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function createGame() {
  return {
    version: VERSION,
    handNumber: 0,
    phase: 'waiting',
    dealer: 0,
    currentBidder: 0,
    highBid: 0,
    highBidder: null,
    lastBidderName: '',
    bidHistory: [],
    passed: [false, false, false],
    hands: [[], [], []],
    kitty: [],
    selectedDiscards: [],
    trump: null,
    trick: [],
    lastTrick: null,
    revealUntil: 0,
    leader: 0,
    turn: 0,
    scores: [0, 0, 0],
    handPoints: [0, 0, 0],
    tricksWon: [0, 0, 0],
    bidTeam: null,
    prompt: 'Choose a player to begin.',
    chat: [],
    started: false,
    winner: null,
    live: [false, false, false],
    bot: [true, true, true],
    lastActivity: [0, 0, 0]
  };
}

function buildDeck() {
  let i = 0;
  const deck = [];
  for (const suit of SUITS) {
    for (const value of VALUES) deck.push({ id: `c${i++}`, suit, value, rook: false });
  }
  deck.push({ id: `c${i++}`, suit: 'rook', value: null, rook: true });
  return deck;
}
function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
function cardPoints(c) {
  if (c.rook) return 20;
  if (c.value === 1) return 15;
  if (c.value === 5) return 5;
  if (c.value === 10 || c.value === 14) return 10;
  return 0;
}
function rookRankValue() { return 10.5; }
function cardRank(c) { return c.rook ? rookRankValue() : c.value === 1 ? 15 : c.value; }
function effectiveSuit(c) { return c.rook ? (game.trump === 'none' ? 'red' : game.trump) : c.suit; }
function cardName(c) { return c.rook ? 'the Rook' : `${c.suit} ${c.value}`; }
function playerName(i) { return PLAYER_NAMES[i]; }
function seatState(i) {
  return { seat: i, name: playerName(i), connected: game.live[i], bot: game.bot[i] };
}
function legalCards(player) {
  const hand = game.hands[player] || [];
  if (!game.trick.length) return hand.slice();
  const leadSuit = effectiveSuit(game.trick[0].card);
  const following = hand.filter(c => effectiveSuit(c) === leadSuit);
  return following.length ? following : hand.slice();
}
function beats(challenger, incumbent, leadSuit) {
  const cSuit = effectiveSuit(challenger);
  const iSuit = effectiveSuit(incumbent);
  const cTrump = game.trump !== null && game.trump !== 'none' && cSuit === game.trump;
  const iTrump = game.trump !== null && game.trump !== 'none' && iSuit === game.trump;
  if (cTrump !== iTrump) return cTrump;
  if (cSuit === iSuit) return cardRank(challenger) > cardRank(incumbent);
  if (cSuit === leadSuit && iSuit !== leadSuit) return true;
  return false;
}
function trickWinner(trick) {
  const leadSuit = effectiveSuit(trick[0].card);
  let best = trick[0];
  for (let i = 1; i < trick.length; i++) if (beats(trick[i].card, best.card, leadSuit)) best = trick[i];
  return best.seat;
}
function cardHasBeenPlayed(suit, value) {
  const played = game.hands.flat().concat(game.kitty, game.trick.map(x => x.card));
  return played.some(c => !c.rook && c.suit === suit && c.value === value) === false;
}
function cardAlreadyPlayed(suit, value) {
  const knownPlayed = [];
  if (game.lastTrick?.plays) knownPlayed.push(...game.lastTrick.plays.map(x => x.card));
  knownPlayed.push(...game.trick.map(x => x.card));
  return knownPlayed.some(c => !c.rook && c.suit === suit && c.value === value);
}

// Mirrors the original Rook Solitaire three-player bidding estimator.
function analyzeBotBidHand(hand) {
  const hasRook = hand.some(c => c.rook);
  const aces = hand.filter(c => !c.rook && c.value === 1).length;
  const suitCounts = Object.fromEntries(SUITS.map(s => [s, hand.filter(c => !c.rook && c.suit === s).length]));
  const suitScore = suit => hand.reduce((score, card) => {
    if (card.rook) return score + 9;
    if (card.suit !== suit) return score;
    if (card.value === 1) return score + 20;
    if (card.value === 14) return score + 12;
    if (card.value === 13) return score + 8;
    if (card.value === 12) return score + 5;
    return score + 2 + cardPoints(card) * 0.25;
  }, suitCounts[suit] * 11);
  const bestTrump = SUITS.reduce((best, suit) => suitScore(suit) > suitScore(best) ? suit : best, SUITS[0]);
  const potentialTrumpCount = suitCounts[bestTrump] + (hasRook ? 1 : 0);
  const covered = new Set();
  const standardOrder = [1, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5];
  const trumpOrder = [1, 14, 13, 12, 11, 'rook', 10, 9, 8, 7, 6, 5];
  function markTopRun(suit, order) {
    for (const rank of order) {
      const card = rank === 'rook' ? hand.find(x => x.rook) : hand.find(x => !x.rook && x.suit === suit && x.value === rank);
      if (!card) break;
      covered.add(card.id);
    }
  }
  for (const suit of SUITS) markTopRun(suit, suit === bestTrump ? trumpOrder : standardOrder);
  return { aces, hasRook, bestTrump, potentialTrumpCount, coveredTricks: covered.size, fullCoverage: covered.size === hand.length };
}
function estimateMaxBid(hand) {
  const strength = analyzeBotBidHand(hand);
  const suitCards = Object.fromEntries(SUITS.map(s => [s, hand.filter(c => !c.rook && c.suit === s)]));
  const ranked = [...SUITS].sort((a, b) => {
    const score = s => (suitCards[s].length + (strength.hasRook ? 1 : 0)) * 7 + suitCards[s].reduce((n, c) => n + (c.value === 1 ? 8 : c.value === 14 ? 6 : c.value >= 13 ? 3 : c.value >= 11 ? 1 : 0), 0);
    return score(b) - score(a);
  });
  const trumpSuit = ranked[0];
  const trumpCards = suitCards[trumpSuit];
  const trumpCount = trumpCards.length + (strength.hasRook ? 1 : 0);
  const trumpHasOne = trumpCards.some(c => c.value === 1);
  const trumpHasFourteen = trumpCards.some(c => c.value === 14);
  const totalOnes = hand.filter(c => !c.rook && c.value === 1).length;
  const totalTopCards = hand.filter(c => !c.rook && (c.value === 1 || c.value === 14)).length;
  const secondaryOnes = hand.filter(c => !c.rook && c.suit !== trumpSuit && c.value === 1).length;
  const secondaryFourteens = hand.filter(c => !c.rook && c.suit !== trumpSuit && c.value === 14).length;
  const activeColors = SUITS.filter(s => suitCards[s].length > 0).length;
  const voids = 4 - activeColors;
  let strengthScore = 0;
  if (trumpCount >= 4) strengthScore += 5;
  if (trumpCount >= 5) strengthScore += 5;
  if (trumpCount >= 6) strengthScore += 5;
  if (trumpCount >= 7) strengthScore += 5;
  if (trumpHasOne) strengthScore += 6; else if (trumpCount >= 6) strengthScore -= 5; else strengthScore -= 3;
  if (trumpHasFourteen) strengthScore += 4;
  if (trumpCards.some(c => c.value === 13)) strengthScore += 2;
  if (strength.hasRook) strengthScore += 6;
  strengthScore += secondaryOnes * 5 + secondaryFourteens * 2;
  for (const s of SUITS) {
    if (s === trumpSuit) continue;
    const vals = suitCards[s].map(c => c.value);
    if (vals.includes(1) && vals.includes(14)) strengthScore += 5;
  }
  strengthScore += voids * 3;
  if (activeColors <= 2) strengthScore += 3;
  if (activeColors === 4) strengthScore -= 3;
  const points = hand.reduce((n, c) => n + cardPoints(c), 0);
  if (points >= 45) strengthScore += 2;
  if (points >= 60) strengthScore += 2;
  if (suitCards[ranked[1]]?.length >= 4) strengthScore += 3;
  let estimate = Math.round((145 + strengthScore * 0.65) / 5) * 5;
  estimate = Math.max(150, estimate);
  if (totalTopCards >= 3 && estimate < 160) estimate = 160;
  const exceptional = trumpCount >= 8 && (trumpHasOne || strength.hasRook) && totalOnes >= 2;
  estimate = Math.min(estimate, exceptional ? 175 : 170);
  if (strength.fullCoverage) estimate = 200;
  if (estimate < 200 && Math.random() < 0.35) estimate += Math.random() < 0.5 ? -5 : 5;
  return clamp(Math.round(estimate / 5) * 5, 145, strength.fullCoverage ? 200 : 175);
}
function chooseBestTrump(hand) {
  let best = SUITS[0], bestScore = -Infinity;
  for (const suit of SUITS) {
    let score = 0;
    for (const c of hand) {
      if (c.rook) score += 10;
      else if (c.suit === suit) {
        score += 3;
        if (c.value === 1) score += 18;
        else if (c.value === 14) score += 10;
        else if (c.value === 13) score += 6;
        else if (c.value >= 11) score += 3;
        score += cardPoints(c) * 0.25;
      }
    }
    if (score > bestScore) { bestScore = score; best = suit; }
  }
  return best;
}
function chooseBotDiscards(hand, trump) {
  const desirability = c => {
    if (c.rook) return 100;
    let keep = cardRank(c) * 1.2 + cardPoints(c) * 2.4;
    if (c.suit === trump) keep += 20;
    if (c.value === 1) keep += 28;
    if (c.value === 14) keep += 12;
    return keep;
  };
  return [...hand].sort((a, b) => desirability(a) - desirability(b)).slice(0, KITTY_SIZE);
}
function isGuardedFourteen(c) { return !c.rook && c.value === 14 && !cardAlreadyPlayed(c.suit, 1); }
function wouldStrandFourteen(player, c) {
  if (c.rook || c.value === 14 || c.value === 1 || cardAlreadyPlayed(c.suit, 1)) return false;
  const remaining = game.hands[player].filter(x => x.id !== c.id && !x.rook && x.suit === c.suit);
  return remaining.length === 1 && remaining[0].value === 14;
}
function isThrowablePointCard(c) { return !!c && (c.rook || c.value === 10 || c.value === 5); }
function chooseLowest(cards, player) {
  let pool = cards.filter(c => !wouldStrandFourteen(player, c));
  if (!pool.length) pool = cards.slice();
  return [...pool].sort((a, b) => (cardPoints(a) - cardPoints(b)) || (cardRank(a) - cardRank(b)))[0];
}
function opponentCanBeat(player, card) {
  const leadSuit = effectiveSuit(card);
  for (const opp of [0,1,2]) {
    if (opp === player) continue;
    const hand = game.hands[opp];
    const followers = hand.filter(c => effectiveSuit(c) === leadSuit);
    const legal = followers.length ? followers : hand;
    if (legal.some(c => beats(c, card, leadSuit))) return true;
  }
  return false;
}
function chooseBotLead(player, legal) {
  const isBidder = player === game.highBidder;
  const avoidGuarded = legal.filter(c => !isGuardedFourteen(c) && !wouldStrandFourteen(player, c));
  // Bidding side leads trump first when possible. Never lead Rook unless it is actually top.
  if (isBidder && game.trump && game.trump !== 'none') {
    const trumps = avoidGuarded.filter(c => effectiveSuit(c) === game.trump && (!c.rook || cardRank(c) >= 16));
    if (trumps.length) {
      const sorted = [...trumps].sort((a,b)=>cardRank(b)-cardRank(a));
      return sorted[0];
    }
  }
  // Never lead a second-suit 1 if an opponent is void in that suit and could trump it.
  const safeOnes = avoidGuarded.filter(c => !c.rook && c.value === 1 && !opponentCanBeat(player, c));
  if (safeOnes.length) return safeOnes[0];
  const nonCounters = avoidGuarded.filter(c => cardPoints(c) === 0 && effectiveSuit(c) !== game.trump);
  if (nonCounters.length) {
    const suitLengths = Object.fromEntries(SUITS.map(s => [s, nonCounters.filter(c => effectiveSuit(c) === s).length]));
    const sorted = [...nonCounters].sort((a,b) => (suitLengths[effectiveSuit(a)] - suitLengths[effectiveSuit(b)]) || (cardRank(a) - cardRank(b)));
    return sorted[0];
  }
  const noRook = avoidGuarded.filter(c => !c.rook);
  if (noRook.length) return chooseLowest(noRook, player);
  return chooseLowest(legal, player);
}
function chooseBotCard(player) {
  const legal = legalCards(player);
  if (!game.trick.length) return chooseBotLead(player, legal);
  const leadSuit = effectiveSuit(game.trick[0].card);
  const currentWinner = trickWinner(game.trick);
  const winningPlay = game.trick.find(x => x.seat === currentWinner);
  const sameSide = currentWinner === player || currentWinner !== game.highBidder && player !== game.highBidder && currentWinner !== game.highBidder;
  const winning = legal.filter(c => beats(c, winningPlay.card, leadSuit));
  if (winning.length && currentWinner !== player) {
    const top = winning.find(c => !c.rook && c.value === 1 && !isGuardedFourteen(c));
    if (top) return top;
    return [...winning].sort((a,b)=>cardRank(a)-cardRank(b))[0];
  }
  // If a nonbidder is winning and bot is last to play, feed points when safe.
  if (game.trick.length === 2 && currentWinner !== game.highBidder && !winning.length) {
    const point = legal.filter(c => isThrowablePointCard(c) && !beats(c, winningPlay.card, leadSuit));
    if (point.length) return [...point].sort((a,b)=>cardPoints(b)-cardPoints(a))[0];
  }
  // Bidder bots preserve a trump for the last trick whenever possible.
  if (player === game.highBidder && game.hands[player].length > 1 && game.trick.length === 2) {
    const trumps = legal.filter(c => effectiveSuit(c) === game.trump);
    const nonTrumps = legal.filter(c => effectiveSuit(c) !== game.trump);
    if (trumps.length === 1 && nonTrumps.length) return chooseLowest(nonTrumps, player);
  }
  const safe = legal.filter(c => !isGuardedFourteen(c) && !wouldStrandFourteen(player, c));
  if (sameSide && safe.length) return chooseLowest(safe, player);
  return chooseLowest(legal, player);
}

function createDeal() {
  const deck = shuffle(buildDeck());
  game.hands = [[], [], []];
  for (let r = 0; r < HAND_SIZE; r++) for (let offset = 1; offset <= 3; offset++) game.hands[(game.dealer + offset) % 3].push(deck.pop());
  game.kitty = deck.splice(0);
}
function resetHand() {
  game.phase = 'bidding';
  game.handNumber += 1;
  game.dealer = (game.dealer + 1) % 3;
  game.currentBidder = (game.dealer + 1) % 3;
  game.highBid = 0; game.highBidder = null; game.lastBidderName = ''; game.bidHistory = []; game.passed = [false,false,false];
  game.trump = null; game.selectedDiscards = []; game.trick = []; game.lastTrick = null; game.revealUntil = 0;
  game.handPoints = [0,0,0]; game.tricksWon = [0,0,0]; game.winner = null;
  createDeal();
  game.prompt = `${playerName(game.currentBidder)} bids first.`;
}
function ensureBots() { for (let i=0;i<3;i++) if (!game.live[i]) game.bot[i]=true; }
function beginGame() { ensureBots(); game.started = true; game.phase='dealing'; resetHand(); }
function nextBidder(from) { for (let k=1;k<=3;k++){const p=(from+k)%3;if(!game.passed[p])return p;}return null; }
function minLegalBid() { if (!game.highBid) return BID_START; if (game.highBid < 200) return game.highBid + 5; if (game.highBid < 400) return 400; return 401; }
function recordBid(seat, bid) { game.highBid=bid; game.highBidder=seat; game.lastBidderName=playerName(seat); game.bidHistory.push({seat,bid,passed:false}); }
function passBid(seat) { game.passed[seat]=true; game.bidHistory.push({seat,bid:'Pass',passed:true}); }
function runBotBidding() {
  if (game.phase !== 'bidding' || game.currentBidder === null) return;
  if (!game.bot[game.currentBidder]) return;
  const seat = game.currentBidder;
  const next = minLegalBid();
  const max = estimateMaxBid(game.hands[seat]);
  if (next <= 400 && next <= max) recordBid(seat, next); else passBid(seat);
  advanceBidding();
}
function advanceBidding() {
  const active = [0,1,2].filter(i=>!game.passed[i]);
  if (game.highBidder !== null && active.length === 1 && active[0] === game.highBidder) return finishBidding();
  if (!active.length) { game.currentBidder = (game.dealer+1)%3; game.highBid=0; game.highBidder=null; game.passed=[false,false,false]; game.bidHistory=[]; }
  else game.currentBidder = nextBidder(game.currentBidder);
  game.prompt = game.currentBidder === null ? '' : `${playerName(game.currentBidder)} to bid.`;
  clearTimeout(botTimer);
  if (game.currentBidder !== null && game.bot[game.currentBidder]) botTimer=setTimeout(runBotBidding,BOT_DELAY.bid);
}
function finishBidding() {
  game.phase='pickup';
  const bidder = game.highBidder;
  game.bidTeam=bidder;
  game.hands[bidder].push(...game.kitty);
  game.kitty=[];
  game.selectedDiscards=[];
  game.prompt=`${playerName(bidder)} won the bid at ${game.highBid}. Kitty added to ${playerName(bidder)}'s hand. Choose trump.`;
  if (game.bot[bidder]) {
    game.trump=chooseBestTrump(game.hands[bidder]);
    const discards=chooseBotDiscards(game.hands[bidder],game.trump);
    game.kitty=discards;
    game.hands[bidder]=game.hands[bidder].filter(c=>!discards.some(d=>d.id===c.id));
    beginPlay();
  }
}
function chooseTrump(seat,trump){ if(game.phase!=='pickup'||game.highBidder!==seat||!SUITS.includes(trump)&&trump!=='none')return false;game.trump=trump;game.phase='discard';game.prompt=`${playerName(seat)} chose ${trump==='none'?'No Trump':trump+'.'} Return 9 cards to the kitty.`;return true; }
function selectDiscards(seat, cardIds) {
  if (game.phase!=='discard' || game.highBidder!==seat || !Array.isArray(cardIds)) return false;
  const unique=[...new Set(cardIds)].filter(id=>game.hands[seat].some(c=>c.id===id));
  if(unique.length>9){game.selectedDiscards=unique.slice(0,9);return false;}
  game.selectedDiscards=unique; return true;
}
function finishDiscard(seat) {
  if(game.phase!=='discard'||game.highBidder!==seat||game.selectedDiscards.length!==9)return false;
  game.kitty=game.hands[seat].filter(c=>game.selectedDiscards.includes(c.id));
  game.hands[seat]=game.hands[seat].filter(c=>!game.selectedDiscards.includes(c.id));
  game.selectedDiscards=[]; game.leader=seat;game.turn=seat;game.trick=[];game.phase='playing';game.prompt=`${playerName(seat)} leads.`; scheduleTurn(); return true;
}
function scoreHand() {
  const winner=game.lastTrick?.winner ?? game.leader;
  let kittyPoints=game.kitty.reduce((n,c)=>n+cardPoints(c),0)+20;
  const points=game.handPoints.map(x=>x);
  points[winner]+=kittyPoints;
  game.scores=game.scores.map((s,i)=>s + (i===game.highBidder ? (points[i]>=game.highBid ? points[i] : -game.highBid) : points[i]));
  game.phase='scoring'; game.prompt=`Hand ${game.handNumber} complete.`; if(game.scores.some(s=>s>=WIN_SCORE)) { game.phase='gameover'; game.winner=game.scores.findIndex(s=>s>=WIN_SCORE); }
}
function resolveTrick() {
  const winner=trickWinner(game.trick); const points=game.trick.reduce((n,x)=>n+cardPoints(x.card),0); game.handPoints[winner]+=points; game.tricksWon[winner]+=1;
  game.lastTrick={plays:game.trick.map(x=>({seat:x.seat,card:x.card})),winner,points};
  game.revealUntil=now()+TRICK_REVEAL_MS;game.phase='trickReveal';game.prompt=`${playerName(winner)} won the trick.`;
  clearTimeout(revealTimer); revealTimer=setTimeout(()=>{ game.trick=[]; if(game.hands.every(h=>h.length===0)) scoreHand(); else {game.leader=winner;game.turn=winner;game.phase='playing';game.prompt=`${playerName(winner)} leads.`;scheduleTurn();}},TRICK_REVEAL_MS);
}
function scheduleTurn(){clearTimeout(botTimer); if(game.phase==='playing'&&game.bot[game.turn]) botTimer=setTimeout(()=>botPlay(game.turn),BOT_DELAY.play);}
function playCard(seat,id){
  if(game.phase!=='playing'||game.turn!==seat)return false;const legal=new Set(legalCards(seat).map(c=>c.id));if(!legal.has(id))return false;const idx=game.hands[seat].findIndex(c=>c.id===id);if(idx<0)return false;const card=game.hands[seat].splice(idx,1)[0];game.trick.push({seat,card});if(game.trick.length===3)resolveTrick();else{game.turn=(seat+1)%3;game.prompt=`${playerName(game.turn)} to play.`;scheduleTurn();}return true;
}
function botPlay(seat){ if(game.phase!=='playing'||game.turn!==seat)return; const c=chooseBotCard(seat);if(c)playCard(seat,c.id); }
function addChat(seat,text){const t=String(text||'').trim().slice(0,240);if(!t)return;game.chat.push({name:playerName(seat),text:t,at:now()});game.chat=game.chat.slice(-60);}

function publicState(token){
  const session=sessions.get(token); const seat=session?.seat ?? null;
  return {
    version:VERSION, phase:game.phase, handNumber:game.handNumber, dealer:game.dealer, currentBidder:game.currentBidder, highBid:game.highBid, highBidder:game.highBidder, lastBidderName:game.lastBidderName,
    bidHistory:game.bidHistory, prompt:game.prompt, trump:game.trump, kittyCount:game.kitty.length, selectedDiscards: seat===game.highBidder ? game.selectedDiscards : [],
    hands: game.hands.map((h,i)=>i===seat?h:[]), handCounts:game.hands.map(h=>h.length), trick:game.trick, lastTrick:game.lastTrick, revealUntil:game.revealUntil,
    turn:game.turn, leader:game.leader, scores:game.scores, handPoints:game.handPoints, tricksWon:game.tricksWon, winner:game.winner,
    seats:[0,1,2].map(i=>seatState(i)), chat:game.chat
  };
}
function readJson(req){return new Promise((resolve,reject)=>{let b='';req.on('data',c=>{b+=c;if(b.length>20000)req.destroy()});req.on('end',()=>{try{resolve(b?JSON.parse(b):{})}catch(e){reject(e)}});req.on('error',reject)})}
function json(res,status,payload){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type'});res.end(JSON.stringify(payload));return true;}
function markPresence(){const t=now();for(const [token,s] of sessions){if(t-s.lastSeen>PLAYER_TIMEOUT_MS){game.live[s.seat]=false;s.connected=false;game.bot[s.seat]=true;}}}
function requireSession(data){const s=sessions.get(data.token);if(!s)return null;s.lastSeen=now();game.live[s.seat]=true;game.bot[s.seat]=false;game.lastActivity[s.seat]=now();return s;}

async function api(req,res){
  markPresence();
  if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type'});res.end();return true;}
  if(req.method==='POST'&&req.url==='/api/join'){
    const d=await readJson(req); const name=cleanName(d.name); if(!name)return json(res,400,{ok:false,message:'Choose Daryl, Cristi, or Cindy.'}); const seat=PLAYER_NAMES.indexOf(name); let token=d.token;
    const existing=sessions.get(token); if(!existing||existing.seat!==seat){token=id('s_');sessions.set(token,{seat,name,lastSeen:now(),connected:true});}
    game.live[seat]=true;game.bot[seat]=false;game.lastActivity[seat]=now();
    if(game.phase==='waiting') game.prompt=`${name} is ready. Start the game when you are ready.`;
    return json(res,200,{ok:true,token,name,seat,state:publicState(token)});
  }
  if(req.method==='POST'&&req.url==='/api/heartbeat'){
    const d=await readJson(req);const s=requireSession(d);if(!s)return json(res,404,{ok:false,message:'Session expired.'});return json(res,200,{ok:true,state:publicState(d.token)});
  }
  if(req.method==='GET'&&req.url.startsWith('/api/state')){const u=new URL(req.url,`http://${req.headers.host||'localhost'}`);const s=sessions.get(u.searchParams.get('token'));if(!s)return json(res,404,{ok:false,message:'Session expired.'});return json(res,200,{ok:true,state:publicState(u.searchParams.get('token'))});}
  if(req.method==='POST'&&req.url==='/api/action'){
    const d=await readJson(req);const s=requireSession(d);if(!s)return json(res,404,{ok:false,message:'Session expired.'});let ok=true;
    if(d.action==='start') {
      if(game.phase!=='waiting') return json(res,400,{ok:false,message:'The game has already started.',state:publicState(d.token)});
      beginGame();
      if(game.phase==='bidding'&&game.bot[game.currentBidder]) scheduleBotBidIfNeeded();
      return json(res,200,{ok:true,state:publicState(d.token)});
    }
    else if(d.action==='bid'){if(game.phase!=='bidding'||game.currentBidder!==s.seat||game.bot[s.seat])ok=false;else{const min=minLegalBid();const bid=Number(d.bid);if(![...Array(11)].map((_,i)=>150+i*5).concat([400]).includes(bid)||bid<min)ok=false;else{recordBid(s.seat,bid);advanceBidding();}}}
    else if(d.action==='pass'){if(game.phase!=='bidding'||game.currentBidder!==s.seat||game.bot[s.seat])ok=false;else{passBid(s.seat);advanceBidding();}}
    else if(d.action==='trump'){ok=chooseTrump(s.seat,d.trump);}
    else if(d.action==='discard'){if(selectDiscards(s.seat,d.cardIds))ok=finishDiscard(s.seat);else ok=false;}
    else if(d.action==='selectDiscard'){ok=selectDiscards(s.seat,d.cardIds);}
    else if(d.action==='play'){ok=playCard(s.seat,d.cardId);}
    else if(d.action==='chat'){addChat(s.seat,d.text);}
    else if(d.action==='nextHand'){if(game.phase==='scoring'){resetHand();}else ok=false;}
    else if(d.action==='newGame'){Object.assign(game,createGame());}
    else ok=false;
    if(!ok)return json(res,400,{ok:false,message:'That action is not available right now.',state:publicState(d.token)});
    if(game.phase==='bidding'&&game.bot[game.currentBidder])scheduleBotBidIfNeeded();
    return json(res,200,{ok:true,state:publicState(d.token)});
  }
  return false;
}
function scheduleBotBidIfNeeded(){clearTimeout(botTimer);if(game.phase==='bidding'&&game.bot[game.currentBidder])botTimer=setTimeout(runBotBidding,BOT_DELAY.bid);}

const server=http.createServer(async(req,res)=>{try{const handled=await api(req,res);if(handled)return;const requestPath=req.url==='/'?'/index.html':req.url.split('?')[0];const relative=path.normalize(requestPath).replace(/^[/\\]+/,'');const filePath=path.join(PUBLIC_DIR,relative);if(!filePath.startsWith(PUBLIC_DIR)){res.writeHead(403);res.end('Forbidden');return;}fs.readFile(filePath,(err,content)=>{if(err){res.writeHead(err.code==='ENOENT'?404:500);res.end(err.code==='ENOENT'?'Not found':'Server error');return;}const type=path.extname(filePath).toLowerCase()==='.html'?'text/html; charset=utf-8':'application/octet-stream';res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});res.end(content);});}catch(e){console.error(e);json(res,500,{ok:false,message:'Server error.'});}});
server.listen(PORT,HOST,()=>console.log(`3-Handed Judd Rook v${VERSION} listening on ${HOST}:${PORT}`));
