const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const APP_VERSION = '1.0.1';
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = __dirname;
const PLAYER_NAMES = ['Daryl', 'Cristi', 'Cindy'];
const PLAYER_TIMEOUT_MS = 7000;
const TRICK_REVEAL_MS = 3000;
const WIN_SCORE = 1000;
const SUITS = ['red', 'yellow', 'green', 'black'];
const VALUES = [1, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

const BOT_PROFILES = {
  easy: { bidBonus: -12, humanLeadPenalty: 30, openChance: 0.28, mistakeChance: 0.24, jitterChance: 0.25 },
  normal: { bidBonus: 0, humanLeadPenalty: 20, openChance: 0.55, mistakeChance: 0.05, jitterChance: 0.35 },
  hard: { bidBonus: 10, humanLeadPenalty: 12, openChance: 0.78, mistakeChance: 0, jitterChance: 0.45 }
};
const settings = {
  rookRank: '10.5',
  allowNoTrump: true,
  bidStart: 150,
  aiDifficulty: 'normal',
  botDelayMs: 650
};

const sessions = new Map();
const chat = [];
const game = {
  phase: 'waiting',
  seats: PLAYER_NAMES.map((name, seat) => ({ seat, name, connected: false, bot: false, token: null, lastSeen: 0 })),
  scores: [0, 0, 0],
  handNumber: 0,
  dealer: 2,
  hands: [[], [], []],
  kitty: [],
  selectedDiscards: [],
  trump: null,
  highBid: 0,
  highBidder: null,
  passed: [false, false, false],
  currentBidder: 0,
  leader: 0,
  turn: 0,
  trick: [],
  lastTrick: null,
  trickRevealUntil: 0,
  tricksWonByPlayer: [0, 0, 0],
  captured: [[], [], []],
  prompt: 'Choose your player name to join.',
  winner: null,
  botTimer: null,
  handPoints: [0, 0, 0],
  bidderVoidSuits: new Set(),
  bidderShownSuits: new Set()
};

function makeId(prefix = '') { return prefix + crypto.randomBytes(12).toString('hex'); }
function cleanName(value) { const name = String(value || '').trim(); return PLAYER_NAMES.includes(name) ? name : ''; }
function seatForName(name) { return game.seats.findIndex(seat => seat.name === name); }
function findSessionSeat(token) {
  const entry = sessions.get(token);
  if (!entry) return -1;
  return seatForName(entry.name);
}
function now() { return Date.now(); }

function buildDeck() {
  let id = 0;
  const deck = [];
  for (const suit of SUITS) for (const value of VALUES) deck.push({ id: `c${id++}`, suit, value, rook: false });
  deck.push({ id: `c${id++}`, suit: 'rook', value: null, rook: true });
  return deck;
}
function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
function cardPoints(card) {
  if (card.rook) return 20;
  if (card.value === 1) return 15;
  if (card.value === 5) return 5;
  if (card.value === 10 || card.value === 14) return 10;
  return 0;
}
function rookRankValue() { return settings.rookRank === 'high' ? 16 : settings.rookRank === 'low' ? 4 : 10.5; }
function cardRank(card) { return card.rook ? (game.trump === 'none' ? 10.5 : rookRankValue()) : (card.value === 1 ? 15 : card.value); }
function effectiveSuit(card) { return card.rook ? (game.trump === 'none' ? 'red' : game.trump) : card.suit; }
function nextBidValue(highBid = game.highBid) {
  if (!highBid) return settings.bidStart;
  if (highBid < 200) return highBid + 5;
  if (highBid === 200) return 400;
  return 401;
}
function handSize() { return 12; }
function kittySize() { return 9; }
function isHumanSeat(seat) { return game.seats[seat] && game.seats[seat].connected && !game.seats[seat].bot; }

function analyzeBotBidHand(hand) {
  const hasRook = hand.some(card => card.rook);
  const aces = hand.filter(card => !card.rook && card.value === 1).length;
  const suitCounts = Object.fromEntries(SUITS.map(suit => [suit, hand.filter(card => !card.rook && card.suit === suit).length]));
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
  const trumpOrder = settings.rookRank === 'high'
    ? ['rook', ...standardOrder]
    : settings.rookRank === 'low'
      ? [...standardOrder, 'rook']
      : [1, 14, 13, 12, 11, 'rook', 10, 9, 8, 7, 6, 5];
  const markTopRun = (suit, order) => {
    for (const rank of order) {
      const card = rank === 'rook'
        ? hand.find(item => item.rook)
        : hand.find(item => !item.rook && item.suit === suit && item.value === rank);
      if (!card) break;
      covered.add(card.id);
    }
  };
  for (const suit of SUITS) markTopRun(suit, suit === bestTrump ? trumpOrder : standardOrder);
  return { aces, hasRook, bestTrump, potentialTrumpCount, coveredTricks: covered.size, fullCoverage: covered.size === hand.length };
}

function estimateMaxBid(hand, randomize = true) {
  const profile = BOT_PROFILES[settings.aiDifficulty] || BOT_PROFILES.normal;
  const hasRook = hand.some(card => card.rook);
  const handPoints = hand.reduce((sum, card) => sum + cardPoints(card), 0);
  const suitCards = Object.fromEntries(SUITS.map(suit => [suit, hand.filter(card => !card.rook && card.suit === suit)]));
  const highWeight = value => value === 1 ? 8 : value === 14 ? 6 : value === 13 ? 3 : value === 12 ? 2 : (value === 11 || value === 10) ? 1 : 0;
  const suitBidScore = suit => {
    const cards = suitCards[suit];
    const effectiveLength = cards.length + (hasRook ? 1 : 0);
    const highControl = cards.reduce((sum, card) => sum + highWeight(card.value), 0);
    return effectiveLength * 7 + highControl;
  };
  const rankedSuits = [...SUITS].sort((a, b) => suitBidScore(b) - suitBidScore(a));
  const trumpSuit = rankedSuits[0];
  const trumpCards = suitCards[trumpSuit];
  const trumpCount = trumpCards.length + (hasRook ? 1 : 0);
  const trumpHasOne = trumpCards.some(card => card.value === 1);
  const trumpHasFourteen = trumpCards.some(card => card.value === 14);
  const totalOnes = hand.filter(card => !card.rook && card.value === 1).length;
  const totalTopCards = hand.filter(card => !card.rook && (card.value === 1 || card.value === 14)).length;
  const secondaryOnes = hand.filter(card => !card.rook && card.suit !== trumpSuit && card.value === 1).length;
  const secondaryFourteens = hand.filter(card => !card.rook && card.suit !== trumpSuit && card.value === 14).length;
  const activeColors = SUITS.filter(suit => suitCards[suit].length > 0).length;
  const voids = 4 - activeColors;

  let referenceStrength = 0;
  if (trumpCount >= 4) referenceStrength += 5;
  if (trumpCount >= 5) referenceStrength += 5;
  if (trumpCount >= 6) referenceStrength += 5;
  if (trumpCount >= 7) referenceStrength += 5;
  if (trumpHasOne) referenceStrength += 6; else if (trumpCount >= 6) referenceStrength -= 5; else referenceStrength -= 3;
  if (trumpHasFourteen) referenceStrength += 4;
  if (trumpCards.some(card => card.value === 13)) referenceStrength += 2;
  if (hasRook) referenceStrength += 6;
  referenceStrength += secondaryOnes * 5;
  referenceStrength += secondaryFourteens * 2;
  for (const suit of SUITS) {
    if (suit === trumpSuit) continue;
    const values = suitCards[suit].map(card => card.value);
    if (values.includes(1) && values.includes(14)) referenceStrength += 5;
  }
  referenceStrength += voids * 3;
  if (activeColors <= 2) referenceStrength += 3;
  if (activeColors === 4) referenceStrength -= 3;
  if (handPoints >= 45) referenceStrength += 2;
  if (handPoints >= 60) referenceStrength += 2;
  const secondSuit = rankedSuits[1];
  if (suitCards[secondSuit].length >= 4) referenceStrength += 3;

  let estimate = 145 + referenceStrength * 0.65;
  estimate = Math.round(estimate / 5) * 5;
  estimate = Math.max(150, estimate);
  if (totalTopCards >= 3 && estimate < 160) estimate = 160;

  const exceptionalThreeHand = trumpCount >= 8 && (trumpHasOne || hasRook) && totalOnes >= 2;
  estimate = Math.min(estimate, exceptionalThreeHand ? 175 : 170);

  const strength = analyzeBotBidHand(hand);
  if (strength.fullCoverage) estimate = 200;
  if (randomize && estimate < 200 && Math.random() < profile.jitterChance) estimate += Math.random() < 0.5 ? -5 : 5;
  const learnedCeiling = strength.fullCoverage ? 200 : exceptionalThreeHand ? 175 : 170;
  return Math.max(145, Math.min(estimate, learnedCeiling));
}

function chooseBestTrump(hand) {
  let bestSuit = SUITS[0];
  let bestScore = -Infinity;
  for (const suit of SUITS) {
    let score = 0;
    for (const card of hand) {
      if (card.rook) score += settings.rookRank === 'high' ? 18 : settings.rookRank === '10.5' ? 10 : 5;
      else if (card.suit === suit) {
        score += 3;
        if (card.value === 1) score += 18;
        else if (card.value === 14) score += 10;
        else if (card.value === 13) score += 6;
        else if (card.value >= 11) score += 3;
        score += cardPoints(card) * 0.25;
      }
    }
    if (score > bestScore) { bestScore = score; bestSuit = suit; }
  }
  return bestSuit;
}
function sortHand(hand) {
  const order = { red: 0, yellow: 1, green: 2, black: 3, rook: 4 };
  hand.sort((a, b) => (order[effectiveSuit(a)] - order[effectiveSuit(b)]) || (cardRank(b) - cardRank(a)));
}
function chooseBotDiscards(hand, trump, count) {
  const desirability = card => {
    if (card.rook) return 100;
    let keep = cardRank(card) * 1.2 + cardPoints(card) * 2.4;
    if (card.suit === trump) keep += 20;
    if (card.value === 1) keep += 28;
    if (card.value === 14) keep += 12;
    return keep;
  };
  return [...hand].sort((a, b) => desirability(a) - desirability(b)).slice(0, count);
}
function legalCards(seat) {
  const hand = game.hands[seat] || [];
  if (!game.trick.length) return [...hand];
  const leadSuit = effectiveSuit(game.trick[0].card);
  const following = hand.filter(card => effectiveSuit(card) === leadSuit);
  return following.length ? following : [...hand];
}
function beats(challenger, incumbent, leadSuit) {
  const cSuit = effectiveSuit(challenger);
  const iSuit = effectiveSuit(incumbent);
  const cTrump = cSuit === game.trump;
  const iTrump = iSuit === game.trump;
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
  return game.captured.flat().concat(game.trick.map(play => play.card)).some(card =>
    !card.rook && card.suit === suit && card.value === value
  );
}
function isGuardedFourteen(card) {
  return !card.rook && card.value === 14 && !cardHasBeenPlayed(card.suit, 1);
}
function wouldStrandFourteen(seat, card) {
  if (card.rook || !card.suit || card.value === 14) return false;
  if (cardHasBeenPlayed(card.suit, 1)) return false;
  const remaining = game.hands[seat].filter(other =>
    other.id !== card.id && !other.rook && other.suit === card.suit
  );
  return remaining.length === 1 && remaining[0].value === 14;
}
function bidderIsKnownVoidIn(suit) {
  if (!game.bidderVoidSuits) game.bidderVoidSuits = new Set();
  return Boolean(suit) && game.bidderVoidSuits.has(suit);
}
function bidderHasShownSuit(suit) {
  if (!game.bidderShownSuits) game.bidderShownSuits = new Set();
  return Boolean(suit) && game.bidderShownSuits.has(suit);
}
function defenderAgainstBidder(seat) {
  return game.highBidder !== null && seat !== game.highBidder;
}
function opponentCanBeatLead(seat, card) {
  const leadSuit = effectiveSuit(card);
  return [0,1,2].some(opponent => {
    if (opponent === seat) return false;
    const hand = game.hands[opponent] || [];
    const followers = hand.filter(candidate => effectiveSuit(candidate) === leadSuit);
    const legal = followers.length ? followers : hand;
    return legal.some(candidate => beats(candidate, card, leadSuit));
  });
}
function sideSuitKeepScore(seat, suit) {
  const cards = game.hands[seat].filter(card => !card.rook && card.suit === suit);
  if (!cards.length) return -999;
  let score = cards.length * 2;
  if (cards.some(card => card.value === 1)) score += 55;
  if (cards.some(card => card.value === 14)) score += cardHasBeenPlayed(suit, 1) ? 26 : 13;
  if (cards.some(card => card.value === 13)) score += 11;
  if (cards.some(card => card.value === 12)) score += 7;
  score += cards.reduce((sum, card) => sum + cardPoints(card) * 0.18, 0);
  if (
    defenderAgainstBidder(seat) &&
    suit !== game.trump &&
    bidderHasShownSuit(suit) &&
    (cards.length >= 2 || cards.some(card => card.value === 1 || card.value >= 12))
  ) score += 80;
  return score;
}
function lowestSafeDiscard(cards, seat = null) {
  let pool = [...cards];
  if (seat !== null) {
    const withoutStranding14 = pool.filter(card => !wouldStrandFourteen(seat, card));
    if (withoutStranding14.length) pool = withoutStranding14;
  }
  const keepValue = card => {
    if (card.rook) return 22;
    if (card.value === 1) return 100;
    if (card.value === 14) return 88;
    if (card.value === 13) return 34;
    if (card.value === 12) return 18;
    return 0;
  };
  return pool.sort((a, b) =>
    keepValue(a) - keepValue(b) || cardPoints(a) - cardPoints(b) || cardRank(a) - cardRank(b)
  )[0] || null;
}
function cardWinLooksSecure(seat, winningCard, leadSuit) {
  for (const next of [0,1,2]) {
    if (next === seat) continue;
    const hand = game.hands[next];
    const followers = hand.filter(card => effectiveSuit(card) === leadSuit);
    const choices = followers.length ? followers : hand;
    if (choices.some(card => beats(card, winningCard, leadSuit))) return false;
  }
  return true;
}
function isTenCounter(card) { return !card.rook && card.value === 10; }
function isThrowablePointCard(card) { return Boolean(card && (card.rook || card.value === 10 || card.value === 5)); }
function bestPointThrow(cards) {
  const safeCards = cards.filter(card => isThrowablePointCard(card));
  if (!safeCards.length) return null;
  const priority = card => card.rook ? 5 : card.value === 10 ? 4 : card.value === 5 ? 3 : 1;
  return [...safeCards].sort((a,b) => priority(b) - priority(a) || cardPoints(b) - cardPoints(a) || cardRank(a) - cardRank(b))[0];
}
function chooseRookCapture(seat, legal) {
  if (!game.trick.length || !game.trick.some(play => play.card.rook)) return null;
  const currentWinner = trickWinner(game.trick);
  if (currentWinner === seat) return null;
  const leadSuit = effectiveSuit(game.trick[0].card);
  const winningPlay = game.trick.find(play => play.seat === currentWinner);
  const winningCards = legal.filter(card => beats(card, winningPlay.card, leadSuit));
  if (!winningCards.length) return null;
  const winningOnes = winningCards.filter(card => !card.rook && card.value === 1);
  if (winningOnes.length) return lowestWinningCard(winningOnes);
  if (game.trump !== 'none') {
    const winningTrumps = winningCards.filter(card => effectiveSuit(card) === game.trump);
    if (winningTrumps.length) return lowestWinningCard(winningTrumps);
  }
  return lowestWinningCard(winningCards);
}
function lowestWinningCard(cards) {
  return [...cards].sort((a,b) => Number(effectiveSuit(a) === game.trump) - Number(effectiveSuit(b) === game.trump) || cardRank(a) - cardRank(b))[0] || null;
}
function chooseTrumpPullDiscard(seat, legal) {
  if (!game.trick.length || !game.trump || game.trump === 'none' || !defenderAgainstBidder(seat) ||
      game.trick[0].seat !== game.highBidder || effectiveSuit(game.trick[0].card) !== game.trump) return null;
  if (legal.some(card => effectiveSuit(card) === game.trump)) return null;
  const sideCards = legal.filter(card => effectiveSuit(card) !== game.trump);
  if (!sideCards.length) return null;
  const suits = [...new Set(sideCards.map(card => effectiveSuit(card)))];
  if (!suits.length) return null;
  const ranked = [...suits].sort((a,b) => sideSuitKeepScore(seat,a) - sideSuitKeepScore(seat,b));
  const keepSuit = ranked[ranked.length - 1];
  let sacrificeSuits = ranked.filter(suit => suit !== keepSuit).slice(0,2);
  if (!sacrificeSuits.length) sacrificeSuits = ranked.slice(0,1);
  let candidates = sideCards.filter(card => sacrificeSuits.includes(effectiveSuit(card)));
  if (!candidates.length) candidates = sideCards.filter(card => effectiveSuit(card) !== keepSuit);
  if (!candidates.length) candidates = sideCards;
  const withoutStranding14 = candidates.filter(card => !wouldStrandFourteen(seat, card));
  if (withoutStranding14.length) candidates = withoutStranding14;
  const nonWinners = candidates.filter(card => !card.rook && card.value !== 1 && card.value !== 14 && card.value < 13);
  if (nonWinners.length) candidates = nonWinners;
  return chooseStrategicSluff(seat, candidates, game.trump);
}
function chooseStrategicSluff(seat, cards, leadSuit = null) {
  let pool = [...cards];
  if (!pool.length) return null;
  if (defenderAgainstBidder(seat)) {
    if (leadSuit && !pool.some(card => effectiveSuit(card) === leadSuit)) {
      const nonTrump = pool.filter(card => game.trump === 'none' || effectiveSuit(card) !== game.trump);
      const expendableNonTrump = nonTrump.filter(card => card.rook || (!card.rook && card.value !== 1 && card.value !== 14 && card.value !== 13));
      if (expendableNonTrump.length) pool = nonTrump;
    }
    const suits = [...new Set(pool.map(card => effectiveSuit(card)))];
    const protectedSuits = suits.filter(suit => {
      if (!suit || suit === game.trump || !bidderHasShownSuit(suit)) return false;
      const suitCards = game.hands[seat].filter(card => effectiveSuit(card) === suit);
      return suitCards.length >= 2 || suitCards.some(card => !card.rook && (card.value === 1 || card.value >= 12));
    });
    if (protectedSuits.length) {
      const alternatives = pool.filter(card => !protectedSuits.includes(effectiveSuit(card)));
      if (alternatives.length) pool = alternatives;
    }
  }
  return lowestSafeDiscard(pool, seat);
}
function chooseNoTrumpEarlyLossLead(seat, legal) {
  if (game.trump !== 'none' || game.highBidder !== seat) return null;
  const completedTricks = Math.floor((game.hands.reduce((sum,h) => sum + (12-h.length), 0)) / 3);
  const totalTricks = 12;
  const earlyWindow = Math.min(2, Math.max(1, Math.floor(totalTricks * 0.25)));
  if (completedTricks >= earlyWindow || totalTricks - completedTricks <= 4) return null;
  const hand = game.hands[seat];
  const sureWinners = hand.filter(card => !opponentCanBeatLead(seat, card));
  if (sureWinners.length < Math.max(3, hand.length - 3)) return null;
  const plannedLosers = legal.filter(card =>
    !card.rook && card.value !== 1 && card.value !== 14 && cardPoints(card) === 0 && opponentCanBeatLead(seat, card) && !wouldStrandFourteen(seat, card)
  );
  if (!plannedLosers.length) return null;
  return [...plannedLosers].sort((a,b) => cardRank(a) - cardRank(b))[0];
}
function bidderSideSuitToAvoidAfterDefenderWin(seat) {
  if (!defenderAgainstBidder(seat) || !game.lastTrick || game.lastTrick.winner !== seat) return null;
  const lead = game.lastTrick.plays?.[0];
  if (!lead || lead.seat !== game.highBidder) return null;
  const suit = effectiveSuit(lead.card);
  if (!suit || suit === game.trump) return null;
  return suit;
}
function chooseLeadCard(seat, legal) {
  const isDefender = defenderAgainstBidder(seat);
  const avoidTrumpLead = isDefender;
  let leadPool = [...legal];

  // Never lead the Rook unless it is genuinely the highest card under the chosen rules.
  const rook = leadPool.find(card => card.rook);
  if (rook && settings.rookRank !== 'high') {
    const nonRook = leadPool.filter(card => !card.rook);
    if (nonRook.length) leadPool = nonRook;
  }

  if (avoidTrumpLead && game.trump && game.trump !== 'none') {
    const nonTrump = leadPool.filter(card => effectiveSuit(card) !== game.trump);
    if (nonTrump.length) leadPool = nonTrump;
  }
  if (isDefender) {
    const nonVoid = leadPool.filter(card => !bidderIsKnownVoidIn(effectiveSuit(card)));
    if (nonVoid.length) leadPool = nonVoid;
    const bidderSideSuit = bidderSideSuitToAvoidAfterDefenderWin(seat);
    if (bidderSideSuit) {
      const otherColors = leadPool.filter(card => effectiveSuit(card) !== bidderSideSuit);
      if (otherColors.length) leadPool = otherColors;
    }
    const pressureCounters = leadPool.filter(card => !card.rook && (card.value === 10 || card.value === 5) && !wouldStrandFourteen(seat, card));
    if (pressureCounters.length) {
      return [...pressureCounters].sort((a,b) => Number(b.value === 10) - Number(a.value === 10) || sideSuitKeepScore(seat,a.suit) - sideSuitKeepScore(seat,b.suit) || cardRank(a) - cardRank(b))[0];
    }
  }
  const noTrumpEarlyLoss = chooseNoTrumpEarlyLossLead(seat, leadPool);
  if (noTrumpEarlyLoss) return noTrumpEarlyLoss;

  // Never lead a guarded 14 while its 1 remains unseen.
  const safeLeads = leadPool.filter(card => !isGuardedFourteen(card) && !wouldStrandFourteen(seat, card));
  if (safeLeads.length) leadPool = safeLeads;

  const sureWinners = leadPool.filter(card => !opponentCanBeatLead(seat, card));
  if (sureWinners.length) {
    // Favor counters on a genuinely secure winner, but don't sacrifice a guarded 14.
    return [...sureWinners].sort((a,b) => cardPoints(b) - cardPoints(a) || cardRank(b) - cardRank(a))[0];
  }

  if (!avoidTrumpLead && game.trump && game.trump !== 'none' && seat === game.highBidder) {
    const trumps = leadPool.filter(card => effectiveSuit(card) === game.trump);
    const opposingTrump = [0,1,2].some(opponent => opponent !== seat && game.hands[opponent].some(card => effectiveSuit(card) === game.trump));
    if (trumps.length >= 2 && opposingTrump) return [...trumps].sort((a,b) => cardRank(b) - cardRank(a))[0];
  }

  const nonCounters = leadPool.filter(card =>
    cardPoints(card) === 0 && !isGuardedFourteen(card) && effectiveSuit(card) !== game.trump && !wouldStrandFourteen(seat, card) && !card.rook
  );
  const candidates = nonCounters.length ? nonCounters : leadPool.filter(card => !card.rook).length ? leadPool.filter(card => !card.rook) : leadPool;
  const suitLengths = candidates.reduce((counts, card) => {
    const suit = effectiveSuit(card);
    counts[suit] = (counts[suit] || 0) + 1;
    return counts;
  }, {});
  return [...candidates].sort((a,b) => (suitLengths[effectiveSuit(a)] || 0) - (suitLengths[effectiveSuit(b)] || 0) || cardPoints(a) - cardPoints(b) || cardRank(a) - cardRank(b))[0] || legal[0];
}
function chooseBotCard(seat) {
  let legal = legalCards(seat);
  if (!legal.length) return null;

  // Preserve the solitaire safeguards before taking any trick-winning line.
  if (!game.trick.length) return chooseLeadCard(seat, legal);

  const exposedFourteen = defenderAgainstBidder(seat) && game.trick[0].seat === game.highBidder
    ? (() => {
        const leadSuit = effectiveSuit(game.trick[0].card);
        if (!leadSuit || cardRank(game.trick[0].card) >= 14 || cardHasBeenPlayed(leadSuit, 1)) return null;
        const suitCards = game.hands[seat].filter(card => effectiveSuit(card) === leadSuit);
        const fourteen = suitCards.find(card => !card.rook && card.value === 14);
        if (suitCards.length === 2 && fourteen && legal.some(card => card.id === fourteen.id)) {
          const winner = trickWinner(game.trick);
          const winningPlay = game.trick.find(play => play.seat === winner);
          if (winner !== seat && winningPlay && beats(fourteen, winningPlay.card, leadSuit)) return fourteen;
        }
        return null;
      })()
    : null;
  if (exposedFourteen) return exposedFourteen;

  const guardedOut = legal.filter(card => !isGuardedFourteen(card));
  if (guardedOut.length) legal = guardedOut;

  const rookCapture = chooseRookCapture(seat, legal);
  if (rookCapture) return rookCapture;

  const trumpPullDiscard = chooseTrumpPullDiscard(seat, legal);
  if (trumpPullDiscard) return trumpPullDiscard;

  const currentWinner = trickWinner(game.trick);
  const winningPlay = game.trick.find(play => play.seat === currentWinner);
  const leadSuit = effectiveSuit(game.trick[0].card);
  const winningCards = legal.filter(card => beats(card, winningPlay.card, leadSuit));

  if (winningCards.length) {
    const secure = winningCards.filter(card => cardWinLooksSecure(seat, card, leadSuit));
    const secureNoCounter = secure.filter(card => cardPoints(card) === 0 && !card.rook);
    if (secureNoCounter.length) return lowestWinningCard(secureNoCounter);
    if (secure.length) return lowestWinningCard(secure);
    if (game.trick.length === 2) return lowestWinningCard(winningCards);
  }

  const sameSideWinning = currentWinner === seat;
  if (sameSideWinning) {
    const nonOvertaking = legal.filter(card => !beats(card, winningPlay.card, leadSuit));
    const safePool = nonOvertaking.length ? nonOvertaking : legal;
    const secure = cardWinLooksSecure(seat, winningPlay.card, leadSuit);
    if (secure) {
      const pointThrow = bestPointThrow(safePool);
      if (pointThrow) return pointThrow;
      if (safePool.length === 1) return safePool[0];
    }
    return chooseStrategicSluff(seat, safePool, leadSuit);
  }

  return chooseStrategicSluff(seat, legal, leadSuit) || legal[0];
}

function clearBotTimer() { if (game.botTimer) clearTimeout(game.botTimer); game.botTimer = null; }
function scheduleBot() {
  clearBotTimer();
  const seat = game.phase === 'bidding' ? game.currentBidder : game.turn;
  if (!game.seats[seat]?.bot) return;
  game.botTimer = setTimeout(() => botAct(seat), settings.botDelayMs);
}
function botBidAct(seat) {
  if (game.phase !== 'bidding' || game.currentBidder !== seat) return;
  const profile = BOT_PROFILES[settings.aiDifficulty] || BOT_PROFILES.normal;
  const estimatedMax = estimateMaxBid(game.hands[seat]);
  const highIsLive = game.highBidder !== null && isHumanSeat(game.highBidder);
  let maxBid = estimatedMax + profile.bidBonus - (highIsLive ? profile.humanLeadPenalty : 0);
  if (game.highBidder === null && estimatedMax >= settings.bidStart - 10 && estimatedMax < settings.bidStart && Math.random() < profile.openChance) maxBid = Math.max(maxBid, settings.bidStart);
  const next = nextBidValue(game.highBid);
  if (next <= 400 && next <= maxBid) {
    game.highBid = next;
    game.highBidder = seat;
    game.passed[seat] = false;
    game.prompt = `${game.seats[seat].name} bids ${next}.`;
  } else {
    game.passed[seat] = true;
    game.prompt = `${game.seats[seat].name} passes.`;
  }
  advanceBidder();
}
function botAct(seat) {
  if (game.phase === 'bidding' && game.currentBidder === seat) return botBidAct(seat);
  if (game.phase === 'playing' && game.turn === seat) return playCard(seat, chooseBotCard(seat)?.id);
}
function advanceBidder() {
  const active = [0,1,2].filter(seat => !game.passed[seat]);
  if (game.highBidder !== null && active.length === 1 && active[0] === game.highBidder) return finishBidding();
  let next = null;
  for (let offset = 1; offset <= 3; offset++) {
    const candidate = (game.currentBidder + offset) % 3;
    if (!game.passed[candidate]) { next = candidate; break; }
  }
  if (next === null) return finishBidding();
  game.currentBidder = next;
  if (game.seats[next].bot) scheduleBot();
}
function finishBidding() {
  clearBotTimer();
  if (game.highBidder === null) return startHand();
  game.phase = 'pickup';
  game.prompt = `${game.seats[game.highBidder].name} wins the bid at ${game.highBid}.`;
  if (game.seats[game.highBidder].bot) {
    const bidder = game.highBidder;
    const trump = chooseBestTrump(game.hands[bidder]);
    const discards = chooseBotDiscards([...game.hands[bidder], ...game.kitty], trump, kittySize());
    game.trump = trump;
    const discardIds = new Set(discards.map(card => card.id));
    game.hands[bidder] = [...game.hands[bidder], ...game.kitty].filter(card => !discardIds.has(card.id));
    game.kitty = [...game.hands[bidder], ...game.kitty].filter(card => discardIds.has(card.id));
    game.hands[bidder] = game.hands[bidder].slice(0, handSize());
    sortHand(game.hands[bidder]);
    startPlaying();
  }
}
function startHand() {
  clearBotTimer();
  game.phase = 'dealing';
  game.handNumber += 1;
  game.dealer = (game.dealer + 1) % 3;
  game.hands = [[], [], []];
  game.kitty = [];
  game.trick = [];
  game.lastTrick = null;
  game.trickRevealUntil = 0;
  game.selectedDiscards = [];
  game.trump = null;
  game.highBid = 0;
  game.highBidder = null;
  game.passed = [false, false, false];
  game.currentBidder = (game.dealer + 1) % 3;
  game.tricksWonByPlayer = [0, 0, 0];
  game.captured = [[], [], []];
  game.handPoints = [0, 0, 0];
  game.bidderVoidSuits = new Set();
  game.bidderShownSuits = new Set();
  const deck = shuffle(buildDeck());
  for (let round = 0; round < handSize(); round++) for (let offset = 1; offset <= 3; offset++) game.hands[(game.dealer + offset) % 3].push(deck.pop());
  game.kitty = deck.splice(0);
  game.hands.forEach(sortHand);
  game.phase = 'bidding';
  game.prompt = `${game.seats[game.currentBidder].name} is bidding first.`;
  setTimeout(() => {
    if (game.phase !== 'bidding') return;
    if (game.seats[game.currentBidder]?.bot) scheduleBot();
  }, 250);
}
function startPlaying() {
  game.phase = 'playing';
  game.leader = game.highBidder;
  game.turn = game.leader;
  game.trick = [];
  game.prompt = `${game.seats[game.turn].name} leads.`;
  sortHand(game.hands[0]); sortHand(game.hands[1]); sortHand(game.hands[2]);
  if (game.seats[game.turn].bot) scheduleBot();
}
function playCard(seat, cardId) {
  if (game.phase !== 'playing' || game.turn !== seat) return false;
  const legal = legalCards(seat).map(card => card.id);
  if (!legal.includes(cardId)) return false;
  const index = game.hands[seat].findIndex(card => card.id === cardId);
  if (index < 0) return false;
  const card = game.hands[seat].splice(index, 1)[0];
  if (seat === game.highBidder) {
    const playedSuit = effectiveSuit(card);
    if (playedSuit) game.bidderShownSuits.add(playedSuit);
    if (game.trick.length) {
      const leadSuit = effectiveSuit(game.trick[0].card);
      if (playedSuit !== leadSuit) game.bidderVoidSuits.add(leadSuit);
    }
  }
  game.trick.push({ seat, card });
  game.prompt = `${game.seats[seat].name} played ${card.rook ? 'the Rook' : `${card.suit} ${card.value}`}.`;
  if (game.trick.length === 3) {
    const winner = trickWinner(game.trick);
    const points = game.trick.reduce((sum, play) => sum + cardPoints(play.card), 0);
    game.tricksWonByPlayer[winner] += 1;
    game.captured[winner].push(...game.trick.map(play => play.card));
    game.lastTrick = { plays: game.trick.map(play => ({ seat: play.seat, card: { ...play.card } })), winner, points };
    game.trickRevealUntil = now() + TRICK_REVEAL_MS;
    game.phase = 'trickReveal';
    game.prompt = `${game.seats[winner].name} won the trick (${points} points).`;
    clearBotTimer();
    setTimeout(() => finishTrickReveal(winner), TRICK_REVEAL_MS);
  } else {
    game.turn = (seat + 1) % 3;
    if (game.seats[game.turn].bot) scheduleBot();
  }
  return true;
}
function finishTrickReveal(winner) {
  if (game.phase !== 'trickReveal') return;
  game.trick = [];
  if (game.hands.every(hand => hand.length === 0)) return scoreHand();
  game.phase = 'playing';
  game.leader = winner;
  game.turn = winner;
  game.prompt = `${game.seats[winner].name} leads the next trick.`;
  if (game.seats[winner].bot) scheduleBot();
}
function scoreHand() {
  game.phase = 'scoring';
  game.handPoints = game.captured.map(cards => cards.reduce((sum, card) => sum + cardPoints(card), 0));
  const lastWinner = game.lastTrick?.winner ?? game.highBidder;
  game.handPoints[lastWinner] += 20;
  game.captured[lastWinner].push(...game.kitty);
  game.kitty = [];
  const bidderPoints = game.handPoints[game.highBidder] || 0;
  const made = game.highBid === 400 ? bidderPoints === 200 : bidderPoints >= game.highBid;
  if (game.highBid > 0 && made) game.scores[game.highBidder] += game.highBid;
  else if (game.highBid > 0) game.scores[game.highBidder] = Math.max(0, game.scores[game.highBidder] - game.highBid);
  for (let i = 0; i < 3; i++) if (i !== game.highBidder && game.highBid > 0 && made) game.scores[i] += game.handPoints[i];
  if (game.scores.some(score => score >= WIN_SCORE)) {
    game.winner = game.scores.indexOf(Math.max(...game.scores));
    game.phase = 'gameover';
    game.prompt = `${game.seats[game.winner].name} wins the game!`;
  } else {
    game.prompt = `${game.seats[game.highBidder].name} ${made ? 'made' : 'was set on'} the ${game.highBid} bid.`;
  }
}
function chooseTrump(seat, trump) {
  if (game.phase !== 'pickup' || game.highBidder !== seat || !SUITS.includes(trump)) return false;
  game.trump = trump;
  if (game.seats[seat].bot) return false;
  game.phase = 'discard';
  game.prompt = `Return ${kittySize()} cards to the kitty.`;
  return true;
}
function applyBotDiscard(seat) {
  const trump = game.trump || chooseBestTrump(game.hands[seat]);
  const combined = [...game.hands[seat], ...game.kitty];
  const discards = chooseBotDiscards(combined, trump, kittySize());
  const ids = new Set(discards.map(card => card.id));
  game.hands[seat] = combined.filter(card => !ids.has(card.id));
  game.kitty = combined.filter(card => ids.has(card.id));
  game.trump = trump;
  sortHand(game.hands[seat]);
  startPlaying();
}

function sanitizeCard(card) { return { id: card.id, suit: card.suit, value: card.value, rook: card.rook }; }
function publicState(viewSeat) {
  refreshPlayers();
  return {
    version: APP_VERSION,
    phase: game.phase,
    prompt: game.prompt,
    handNumber: game.handNumber,
    dealer: game.dealer,
    scores: [...game.scores],
    seats: game.seats.map(seat => ({ name: seat.name, connected: seat.connected, bot: seat.bot })),
    hands: game.hands.map((hand, index) => index === viewSeat ? hand.map(sanitizeCard) : []),
    handCounts: game.hands.map(hand => hand.length),
    kittyCount: game.kitty.length,
    selectedDiscards: [...game.selectedDiscards],
    trump: game.trump,
    highBid: game.highBid,
    highBidder: game.highBidder,
    passed: [...game.passed],
    currentBidder: game.currentBidder,
    turn: game.turn,
    trick: game.trick.map(play => ({ seat: play.seat, card: sanitizeCard(play.card) })),
    lastTrick: game.lastTrick ? { ...game.lastTrick, plays: game.lastTrick.plays.map(play => ({ seat: play.seat, card: sanitizeCard(play.card) })) } : null,
    trickRevealUntil: game.trickRevealUntil,
    handPoints: [...game.handPoints],
    winner: game.winner,
    chat: chat.slice(-50)
  };
}
function refreshPlayers() {
  const t = now();
  for (const seat of game.seats) {
    if (!seat.connected || seat.bot) continue;
    if (t - seat.lastSeen > PLAYER_TIMEOUT_MS) {
      seat.connected = false;
      if (game.phase !== 'waiting' && game.phase !== 'scoring' && game.phase !== 'gameover') seat.bot = true;
    }
  }
  if (game.phase !== 'waiting') {
    for (const seat of game.seats) if (!seat.connected && !seat.bot) seat.bot = true;
  }
}
function requireSeat(body) {
  const name = cleanName(body.name);
  if (!name) throw new Error('Choose Daryl, Cristi, or Cindy.');
  const seat = seatForName(name);
  if (seat < 0) throw new Error('Unknown player.');
  const token = String(body.token || '');
  if (token && sessions.get(token)?.name === name) return seat;
  const newToken = makeId('s_');
  sessions.set(newToken, { name, createdAt: now() });
  game.seats[seat].token = newToken;
  game.seats[seat].connected = true;
  game.seats[seat].bot = false;
  game.seats[seat].lastSeen = now();
  return seat;
}
function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' });
  res.end(body);
  return true;
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 20000) req.destroy(); });
    req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch (error) { reject(error); } });
    req.on('error', reject);
  });
}

async function api(req, res) {
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' }); res.end(); return true; }
    if (req.method === 'POST' && req.url === '/api/join') {
      const data = await readJson(req);
      const seat = requireSeat(data);
      const token = game.seats[seat].token;
      return json(res, 200, { ok: true, token, name: game.seats[seat].name, state: publicState(seat) });
    }
    if (req.method === 'POST' && req.url === '/api/heartbeat') {
      const data = await readJson(req);
      const seat = findSessionSeat(String(data.token || ''));
      if (seat < 0) return json(res, 401, { ok: false, message: 'Session expired.' });
      game.seats[seat].connected = true;
      game.seats[seat].bot = false;
      game.seats[seat].lastSeen = now();
      return json(res, 200, { ok: true, state: publicState(seat) });
    }
    if (req.method === 'GET' && req.url.startsWith('/api/state')) {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const token = url.searchParams.get('token') || '';
      const seat = findSessionSeat(token);
      if (seat < 0) return json(res, 401, { ok: false, message: 'Session expired.' });
      game.seats[seat].lastSeen = now();
      game.seats[seat].connected = true;
      if (game.seats[seat].bot) game.seats[seat].bot = false;
      return json(res, 200, { ok: true, state: publicState(seat) });
    }
    if (req.method === 'POST' && req.url === '/api/action') {
      const data = await readJson(req);
      const seat = findSessionSeat(String(data.token || ''));
      if (seat < 0) return json(res, 401, { ok: false, message: 'Session expired.' });
      game.seats[seat].lastSeen = now(); game.seats[seat].connected = true; game.seats[seat].bot = false;
      let ok = false;
      switch (data.action) {
        case 'start':
          if (game.phase !== 'waiting') throw new Error('A game is already in progress.');
          clearBotTimer();
          for (const s of game.seats) if (!s.connected) s.bot = true;
          game.scores = [0,0,0]; game.winner = null; startHand(); ok = true; break;
        case 'bid':
          if (game.phase !== 'bidding' || game.currentBidder !== seat || game.seats[seat].bot) throw new Error('It is not your bid.');
          { const bid = Number(data.bid); const min = nextBidValue(game.highBid); if (!Number.isFinite(bid) || bid < min || bid > 400) throw new Error(`Minimum bid is ${min}.`); game.highBid = bid; game.highBidder = seat; game.passed[seat] = false; advanceBidder(); ok = true; } break;
        case 'pass':
          if (game.phase !== 'bidding' || game.currentBidder !== seat) throw new Error('It is not your bid.');
          game.passed[seat] = true; advanceBidder(); ok = true; break;
        case 'trump':
          ok = chooseTrump(seat, data.trump); if (!ok) throw new Error('Choose trump during the trump selection step.'); break;
        case 'discard':
          if (game.phase !== 'discard' || game.highBidder !== seat) throw new Error('It is not time to return the kitty.');
          if (!Array.isArray(data.cardIds) || data.cardIds.length !== kittySize()) throw new Error(`Return exactly ${kittySize()} cards.`);
          { const ids = new Set(data.cardIds); const combined = [...game.hands[seat], ...game.kitty]; if ([...ids].some(id => !combined.some(c => c.id === id))) throw new Error('Invalid card selection.'); game.hands[seat] = combined.filter(c => !ids.has(c.id)); game.kitty = combined.filter(c => ids.has(c.id)); game.selectedDiscards = []; sortHand(game.hands[seat]); startPlaying(); ok = true; } break;
        case 'play':
          ok = playCard(seat, String(data.cardId || '')); if (!ok) throw new Error('That card cannot be played.'); break;
        case 'nextHand':
          if (game.phase !== 'scoring') throw new Error('The hand is not complete.'); startHand(); ok = true; break;
        case 'chat':
          { const text = String(data.text || '').trim().slice(0, 240); if (!text) throw new Error('Message is empty.'); chat.push({ name: game.seats[seat].name, text, at: now() }); if (chat.length > 100) chat.splice(0, chat.length - 100); ok = true; } break;
        case 'newGame':
          if (game.phase !== 'gameover') throw new Error('The game is not over.'); game.scores = [0,0,0]; game.winner = null; startHand(); ok = true; break;
        default: throw new Error('Unknown action.');
      }
      return json(res, 200, { ok, state: publicState(seat) });
    }
    return false;
  } catch (error) {
    console.error(error);
    json(res, 400, { ok: false, message: error.message || 'Server error.' });
    return true;
  }
}

const server = http.createServer(async (req, res) => {
  const handled = await api(req, res);
  if (handled) return;
  const requestPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const relative = path.normalize(requestPath).replace(/^[/\\]+/, '');
  const filePath = path.join(PUBLIC_DIR, relative);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(filePath, (error, content) => {
    if (error) { res.writeHead(error.code === 'ENOENT' ? 404 : 500); res.end(error.code === 'ENOENT' ? 'Not found' : 'Server error'); return; }
    const extension = path.extname(filePath).toLowerCase();
    const contentType = extension === '.html' ? 'text/html; charset=utf-8' : extension === '.css' ? 'text/css; charset=utf-8' : extension === '.js' ? 'text/javascript; charset=utf-8' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
    res.end(content);
  });
});
setInterval(refreshPlayers, 2500);
server.listen(PORT, HOST, () => console.log(`3-Handed Judd Rook v${APP_VERSION} listening on ${HOST}:${PORT}`));
