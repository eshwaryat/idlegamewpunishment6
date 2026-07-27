import { useState, useEffect, useRef, type ReactNode, type ChangeEvent, type KeyboardEvent } from 'react';

// ── shared types ──
type Biz = {
  id: string; name: string; baseCost: number; baseRev: number; baseTime: number;
  icon: string; costMul: number; upgBonus: number; mgrCost: number; upgCostMul: number;
  owned: number; progress: number; isRunning: boolean; upgradeLevel: number; hasManager: boolean;
};
type OptimalStep = { type: string; biz: string; cost: number; score: number; affordable: boolean } | null;
type FineLogEntry = { fine: number; m: number; ts: number; step: OptimalStep };
type FlashMsg = { msg: string; color: string } | null;
type LogEvent = Record<string, any>;

// ── business definitions ──
const BIZ_TYPES = [
  { id:'lemonade',     name:'Lemonade Stand',   baseCost:4,             baseRev:1,           baseTime:2000,  icon:'🍋', costMul:1.15, upgBonus:1.35, mgrCost:1000,          upgCostMul:5   },
  { id:'newspaper',    name:'Newspaper Route',  baseCost:80,            baseRev:10,          baseTime:4000,  icon:'📰', costMul:1.14, upgBonus:1.35, mgrCost:5000,          upgCostMul:4.5 },
  { id:'carwash',      name:'Car Wash',         baseCost:1600,          baseRev:100,         baseTime:6000,  icon:'🚗', costMul:1.13, upgBonus:1.35, mgrCost:25000,         upgCostMul:4.0 },
  { id:'pizza',        name:'Pizza Delivery',   baseCost:32000,         baseRev:1000,        baseTime:8000,  icon:'🍕', costMul:1.12, upgBonus:1.35, mgrCost:150000,        upgCostMul:3.5 },
  { id:'arcade',       name:'Arcade',           baseCost:640000,        baseRev:10000,       baseTime:10000, icon:'🎮', costMul:1.11, upgBonus:1.35, mgrCost:1000000,       upgCostMul:3.0 },
  { id:'cinema',       name:'Movie Theater',    baseCost:12800000,      baseRev:100000,      baseTime:12000, icon:'🎬', costMul:1.10, upgBonus:1.35, mgrCost:10000000,      upgCostMul:2.8 },
  { id:'bank',         name:'Bank',             baseCost:128000000,     baseRev:1000000,     baseTime:14000, icon:'🏦', costMul:1.09, upgBonus:1.35, mgrCost:100000000,     upgCostMul:2.6 },
  { id:'oilrig',       name:'Oil Company',      baseCost:128000000,     baseRev:10000000,    baseTime:16000, icon:'🛢️', costMul:1.08, upgBonus:1.35, mgrCost:1000000000,    upgCostMul:2.4 },
  { id:'airline',      name:'Airline',          baseCost:12800000000,   baseRev:100000000,   baseTime:18000, icon:'✈️', costMul:1.07, upgBonus:1.35, mgrCost:15000000000,   upgCostMul:2.2 },
  { id:'spacestation', name:'Space Station',    baseCost:128000000000,  baseRev:1000000000,  baseTime:20000, icon:'🚀', costMul:1.06, upgBonus:1.35, mgrCost:200000000000,  upgCostMul:2.0 },
];

// ── punishment / freeze config ──
const P = {
  WINDOW: 15000,            // ms window per optimal step
  WARN_AT: 6000,            // ms left when warning bar turns orange/red
  BASE: 0.05,               // 5% of balance per miss
  SCALE: 1.5,               // exponential escalation factor
  MAX_EXP: 6,               // exponent cap
  FREEZE_AFTER: 3,          // consecutive deadlock-wipe rounds before freeze
  DEADLOCK_WIPE_FRAC: 0.95, // punishment must wipe >= this fraction of balance to count
  FREEZE_DURATION: 20000,   // how long a freeze lasts (ms)
};

// ════════════════════════════════════════════════════════════
//  SHARED EFFECTIVE INCOME MODEL
//  Single source of truth for a business's CURRENT income/sec,
//  based on actual game state:
//    - Managed business             -> full income
//    - Unmanaged but running        -> 50% income
//    - Unmanaged and not running    -> 0 income
//  Used by calcOptimalStep() (for TimeToAfford / current income),
//  calcIPS(), isInDeadlock(), and the freeze system, so they all
//  agree on the player's actual current income.
// ════════════════════════════════════════════════════════════
function effectiveIncomePerSec(b: Biz, ascBonus: number): number {
  if (b.owned === 0) return 0;

  let r = b.baseRev * Math.pow(b.upgBonus, b.upgradeLevel);
  let m = 1;
  if (b.owned >= 10)  m *= 2;
  if (b.owned >= 25)  m *= 2;
  if (b.owned >= 50)  m *= 3;
  if (b.owned >= 75)  m *= 3;
  if (b.owned >= 100) m *= 4;
  if (b.owned >= 200) m *= 5;

  const cycSec = (b.baseTime / (1 + b.upgradeLevel * 0.05)) / 1000;
  const raw = (r * m * ascBonus * b.owned) / cycSec;

  if (b.hasManager) return raw;       // fully automated
  if (b.isRunning)  return raw * 0.5; // manual, mid-cycle: counted at 50%
  return 0;                           // not running: no income at all
}

// ════════════════════════════════════════════════════════════
//  DYNAMIC OPTIMAL STEP ENGINE
//  Returns { type, biz, cost, score, affordable } — the single best
//  action given current game state, scored uniformly as:
//
//      Score = TimeToAfford + (Cost / GainPerSecond)
//
//  where TimeToAfford = max(0, (Cost - CurrentMoney) / CurrentIncomePerSecond)
//
//  Purchases, Upgrades, and Manager hires are all scored with this
//  same formula. Lower score = better. Unaffordable actions are NOT
//  penalized — they're scored normally, since a high-value action
//  that's currently unaffordable can still be "optimal" if the time
//  needed to save up for it is small relative to its payoff.
// ════════════════════════════════════════════════════════════
function calcOptimalStep(bizList: Biz[], currentMoney: number, ascBonus: number): OptimalStep {

  // ── helper: PROJECTED revenue/s for a business in a hypothetical state ──
  // Used only to compute the Gain (delta income/sec) of a simulated future
  // action (purchase/upgrade/manager). Assumes a managed business runs at
  // full output and an unmanaged one runs at its 50% manual-play average,
  // regardless of its current isRunning flag — this is a projection of
  // production under the new state, not the player's current income.
  // (Current income uses effectiveIncomePerSec() instead — see above.)
  const revPerSec = (b: Biz, overrideOwned?: number, overrideLevel?: number): number => {
    const owned = overrideOwned ?? b.owned;
    const level = overrideLevel ?? b.upgradeLevel;
    if (owned === 0) return 0;
    let r = b.baseRev * Math.pow(b.upgBonus, level);
    let m = 1;
    if (owned >= 10)  m *= 2;
    if (owned >= 25)  m *= 2;
    if (owned >= 50)  m *= 3;
    if (owned >= 75)  m *= 3;
    if (owned >= 100) m *= 4;
    if (owned >= 200) m *= 5;
    const cycSec = (b.baseTime / (1 + level * 0.05)) / 1000;
    const raw = (r * m * ascBonus * owned) / cycSec;
    // If no manager, player must click — credit only 50% of theoretical max
    return b.hasManager ? raw : raw * 0.5;
  };

  const cost = (b: Biz) => Math.floor(b.baseCost * Math.pow(b.costMul, b.owned));

  // Total current income/sec across the whole empire — used for TimeToAfford.
  // Uses the SHARED effective income model (actual isRunning/hasManager state),
  // so this agrees with calcIPS()/deadlock/freeze on the player's real income.
  const currentIncomePerSecond = bizList.reduce((s, b) => s + effectiveIncomePerSec(b, ascBonus), 0);

  // Unified scoring function used by every action type
  const score = (actionCost: number, gain: number): number => {
    if (gain <= 0) return Infinity; // an action with no payoff is never worth doing
    const timeToAfford = currentIncomePerSecond > 0
      ? Math.max(0, (actionCost - currentMoney) / currentIncomePerSecond)
      : (actionCost > currentMoney ? Infinity : 0);
    return timeToAfford + (actionCost / gain);
  };

  const candidates: NonNullable<OptimalStep>[] = [];

  for (const b of bizList) {
    // ── PURCHASE ──
    const pc = cost(b);
    const currentRPS = revPerSec(b);
    const afterRPS   = revPerSec(b, b.owned + 1);
    const deltaRPS   = afterRPS - currentRPS;
    candidates.push({
      type: 'PURCHASE', biz: b.id,
      cost: pc,
      score: score(pc, deltaRPS),
      affordable: currentMoney >= pc,
    });

    if (b.owned > 0) {
      // ── UPGRADE ── (same formula as purchase, no efficiency discount)
      const uc = b.baseCost * 50 * Math.pow(b.upgCostMul, b.upgradeLevel);
      const currentRPS_u = revPerSec(b);
      const afterRPS_u   = revPerSec(b, b.owned, b.upgradeLevel + 1);
      const deltaRPS_u   = afterRPS_u - currentRPS_u;
      candidates.push({
        type: 'UPGRADE', biz: b.id,
        cost: uc,
        score: score(uc, deltaRPS_u),
        affordable: currentMoney >= uc,
      });

      // ── HIRE_MANAGER ── (same formula, no manager multiplier)
      if (!b.hasManager) {
        const mc = b.mgrCost;
        // Gain = extra revenue/s unlocked by full automation vs the 50% manual credit
        const deltaRPS_m = revPerSec(b) * (1 / 0.5 - 1); // doubles effective RPS
        candidates.push({
          type: 'HIRE_MANAGER', biz: b.id,
          cost: mc,
          score: score(mc, deltaRPS_m),
          affordable: currentMoney >= mc,
        });
      }
    }
  }

  if (candidates.length === 0) return null;

  // Sort purely by score — lowest (best) first.
  candidates.sort((a, b) => a.score - b.score);
  return candidates[0];
}

// ════════════════════════════════════════
const freshBiz = () => BIZ_TYPES.map(b => ({
  ...b,
  owned: 0,
  progress: 0,
  isRunning: false,
  upgradeLevel: 0,
  hasManager: false,
}));

const fmt = (n: number): string => {
  if (n >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
  if (n >= 1e9)  return '$' + (n / 1e9 ).toFixed(2) + 'B';
  if (n >= 1e6)  return '$' + (n / 1e6 ).toFixed(2) + 'M';
  if (n >= 1e3)  return '$' + (n / 1e3 ).toFixed(2) + 'K';
  return '$' + n.toFixed(2);
};

// ════════════════════════════════════════
export default function IdleEmpire() {
  const [name,     setName]     = useState('');
  const [started,  setStarted]  = useState(false);
  const [money,    setMoney]    = useState(4);
  const [earned,   setEarned]   = useState(0);
  const [paused,   setPaused]   = useState(false);
  const [biz,      setBiz]      = useState<Biz[]>(freshBiz());
  const [tutorial, setTutorial] = useState(true);
  const [ascBonus, setAscBonus] = useState(1);
  void setAscBonus; // reserved for a future ascension/prestige mechanic

  // ── audio ──
  const [backgroundMusic, setBackgroundMusic] = useState<HTMLAudioElement | null>(null);
  const kachingPool = useRef<HTMLAudioElement[]>([]);
  const kachingIdx   = useRef(0);
  const buzzerRef    = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const music = new Audio('/sounds/background.mp3');
    music.loop = true;
    music.volume = 0.3019;
    setBackgroundMusic(music);
    return () => { music.pause(); music.src = ''; };
  }, []);

  useEffect(() => {
    kachingPool.current = Array.from({ length: 4 }, () => {
      const a = new Audio('/sounds/kaching.mp3');
      a.volume = 0.5;
      return a;
    });
    buzzerRef.current = new Audio('/sounds/buzzer.mp3');
    buzzerRef.current.volume = 0.6;

    return () => {
      kachingPool.current.forEach(a => { a.pause(); a.src = ''; });
      kachingPool.current = [];
      if (buzzerRef.current) { buzzerRef.current.pause(); buzzerRef.current.src = ''; }
    };
  }, []);

  useEffect(() => {
    if (!backgroundMusic) return;
    if (started && !paused) {
      backgroundMusic.play().catch(() => {});
    } else {
      backgroundMusic.pause();
    }
  }, [started, paused, backgroundMusic]);

  const playKaching = () => {
    const pool = kachingPool.current;
    if (pool.length === 0) return;
    const a = pool[kachingIdx.current];
    kachingIdx.current = (kachingIdx.current + 1) % pool.length;
    try {
      a.currentTime = 0;
      a.play().catch(e => console.warn('kaching failed:', e.name, e.message));
    } catch (e) {
      console.error('kaching error:', e);
    }
  };

  const playBuzzer = () => {
    const a = buzzerRef.current;
    if (!a) return;
    try {
      a.currentTime = 0;
      a.play().catch(e => console.warn('buzzer failed:', e.name, e.message));
    } catch (e) {
      console.error('buzzer error:', e);
    }
  };


  // punishment state
  const [misses,     setMisses]     = useState(0);
  const [deadline,   setDeadline]   = useState<number | null>(null);
  const [timeLeft,   setTimeLeft]   = useState<number | null>(null);
  const [fineLog,    setFineLog]    = useState<FineLogEntry[]>([]);
  const [totalFines, setTotalFines] = useState(0);
  const [shake,      setShake]      = useState(false);
  const [flashMsg,   setFlashMsg]   = useState<FlashMsg>(null);
  const [botActive,  setBotActive]  = useState(false);

  // current optimal step (recomputed after every action)
  const [optimalStep,    setOptimalStep]    = useState<OptimalStep>(null);

  // deadlock / freeze
  const [freezeUntil,    setFreezeUntil]    = useState<number | null>(null);
  const [isFrozen,       setIsFrozen]       = useState(false);
  const [deadlockStreak, setDeadlockStreak] = useState(0);
  const [roiPerSec,      setRoiPerSec]      = useState(0);

  // refs (game loop reads these without stale closures)
  const rBiz            = useRef<Biz[]>(freshBiz());
  const rMoney          = useRef(4);
  const rEarned         = useRef(0);
  const rMisses         = useRef(0);
  const rDeadline       = useRef<number | null>(null);
  const rBotActive      = useRef(false);
  const rSession        = useRef(Date.now());
  const rLog            = useRef<LogEvent[]>([]);
  const rFreezeUntil    = useRef<number | null>(null);
  const rDeadlockStreak = useRef(0);
  const rOptimalStep    = useRef<OptimalStep>(null);   // what the engine currently expects
  const rAscBonus       = useRef(1);

  useEffect(()=>{ rBiz.current            = biz;            },[biz]);
  useEffect(()=>{ rMoney.current          = money;          },[money]);
  useEffect(()=>{ rEarned.current         = earned;         },[earned]);
  useEffect(()=>{ rMisses.current         = misses;         },[misses]);
  useEffect(()=>{ rDeadline.current       = deadline;       },[deadline]);
  useEffect(()=>{ rBotActive.current      = botActive;      },[botActive]);
  useEffect(()=>{ rFreezeUntil.current    = freezeUntil;    },[freezeUntil]);
  useEffect(()=>{ rDeadlockStreak.current = deadlockStreak; },[deadlockStreak]);
  useEffect(()=>{ rOptimalStep.current    = optimalStep;    },[optimalStep]);
  useEffect(()=>{ rAscBonus.current       = ascBonus;       },[ascBonus]);

  // ── calc helpers (used in game loop, must be stable) ──
  const cost = (b: Biz) => Math.floor(b.baseCost * Math.pow(b.costMul, b.owned));
  const rev  = (b: Biz, overrideOwned?: number, overrideLevel?: number): number => {
    const owned = overrideOwned ?? b.owned;
    const level = overrideLevel ?? b.upgradeLevel;
    if (owned === 0) return 0;
    let r = b.baseRev * Math.pow(b.upgBonus, level);
    let m = 1;
    if (owned >= 10)  m *= 2;
    if (owned >= 25)  m *= 2;
    if (owned >= 50)  m *= 3;
    if (owned >= 75)  m *= 3;
    if (owned >= 100) m *= 4;
    if (owned >= 200) m *= 5;
    return r * m * rAscBonus.current;
  };
  const ctime = (b: Biz) => b.baseTime / (1 + b.upgradeLevel * 0.05);

  // Current total income/sec — single source of truth, shared with calcOptimalStep.
  const calcIPS = (bizList: Biz[]): number => bizList.reduce(
    (s, b) => s + effectiveIncomePerSec(b, rAscBonus.current), 0
  );

  // ── recompute optimal step and arm timer ──
  const recomputeOptimal = (bizList: Biz[], currentMoney: number, isFirstAction = false): OptimalStep => {
    const step = calcOptimalStep(bizList, currentMoney, rAscBonus.current);
    setOptimalStep(step);
    rOptimalStep.current = step;

    if (step) {
      const d = Date.now() + P.WINDOW;
      setDeadline(d); rDeadline.current = d;
      if (isFirstAction) {
        setBotActive(true); rBotActive.current = true;
      }
    }
    return step;
  };

  // ── logging ──
  // Every event automatically captures ips and currentMisses so analysts
  // can reconstruct income trajectory and punishment exposure for any moment
  // in the session without needing to join against other events.
  const log = (type: string, data: Record<string, any> = {}) => rLog.current.push({
    ts: Date.now(), sMs: Date.now() - rSession.current,
    type, name, money: rMoney.current, earned: rEarned.current,
    ips: calcIPS(rBiz.current),
    currentMisses: rMisses.current,
    ...data,
  });

  const flash = (msg: string, color = '#ef4444') => {
    setFlashMsg({ msg, color });
    setTimeout(() => setFlashMsg(null), 3200);
  };

  // ── deadlock check (payback principle) ──
  const isInDeadlock = (bizList: Biz[], currentMoney: number, timeLeftMs: number | null) => {
    const step = rOptimalStep.current;
    if (!step) return false;

    const targetBiz = bizList.find(b => b.id === step.biz);
    if (!targetBiz) return false;

    let requiredCost = 0;
    if (step.type === 'PURCHASE')          requiredCost = cost(targetBiz);
    else if (step.type === 'UPGRADE')      requiredCost = targetBiz.baseCost * 50 * Math.pow(targetBiz.upgCostMul, targetBiz.upgradeLevel);
    else if (step.type === 'HIRE_MANAGER') requiredCost = targetBiz.mgrCost;

    if (requiredCost <= 0 || currentMoney >= requiredCost) return false;

    const ips = calcIPS(bizList);
    if (ips <= 0) return true;

    const deficit   = requiredCost - currentMoney;
    const secNeeded = deficit / ips;
    const secLeft   = (timeLeftMs ?? P.WINDOW) / 1000;
    return secNeeded > secLeft;
  };

  // ── freeze helper ──
  const applyFreeze = () => {
    const until = Date.now() + P.FREEZE_DURATION;
    setFreezeUntil(until); rFreezeUntil.current = until;
    setIsFrozen(true);
    // Extend deadline by freeze duration
    const dl = rDeadline.current;
    if (dl) {
      const newDl = dl + P.FREEZE_DURATION;
      setDeadline(newDl); rDeadline.current = newDl;
    }
    // Capture streak BEFORE resetting so the value that triggered the freeze is preserved in the log
    const triggerStreak = rDeadlockStreak.current;
    setDeadlockStreak(0); rDeadlockStreak.current = 0;
    log('DEADLOCK_FREEZE', { freezeUntil: until, freezeDuration: P.FREEZE_DURATION, triggerStreak, optimalStep: rOptimalStep.current });
  };

  // ── punish ──
  const punish = () => {
    const m = rMisses.current + 1;
    setMisses(m); rMisses.current = m;

    const exp  = Math.min(m - 1, P.MAX_EXP);
    const frac = P.BASE * Math.pow(P.SCALE, exp);
    const fine = rMoney.current * frac;
    const nb   = Math.max(0, rMoney.current - fine);

    const wipeRatio     = rMoney.current > 0 ? fine / rMoney.current : 0;
    const wasDeadlocked = isInDeadlock(rBiz.current, nb, 0);
    const isWipeRound   = wipeRatio >= P.DEADLOCK_WIPE_FRAC || nb < 0.01;

    let newStreak = rDeadlockStreak.current;
    if (isWipeRound && wasDeadlocked) {
      newStreak++;
      setDeadlockStreak(newStreak); rDeadlockStreak.current = newStreak;
    } else {
      newStreak = 0;
      setDeadlockStreak(0); rDeadlockStreak.current = 0;
    }

    setMoney(nb); rMoney.current = nb;
    setTotalFines(f => f + fine);
    setFineLog(fl => [...fl.slice(-299), { fine, m, ts: Date.now(), step: rOptimalStep.current }]);

    setShake(true);
    setTimeout(() => setShake(false), 500);
    playBuzzer();

    const severity = m === 1 ? `⚡ Fine: ${fmt(fine)} deducted`
                   : m <= 3  ? `💸 Penalty: ${fmt(fine)} (miss #${m})`
                             : `💀 Escalating fine: ${fmt(fine)} (${m} misses!)`;
    flash(severity);
    log('PUNISHMENT', {
      fine,
      balanceAfter: nb,
      missCount: m,          // post-increment miss count for this timeout
      wipeRatio,
      wasDeadlocked,
      deadlockStreak: newStreak,
      optimalStep: rOptimalStep.current,
    });

    // After punishment, recompute optimal from new state (money may have changed)
    recomputeOptimal(rBiz.current, nb);

    if (newStreak >= P.FREEZE_AFTER) {
      setTimeout(() => applyFreeze(), 200);
    }
  };

  // ── check if a player action matches the current optimal step ──
  const checkAction = (type: string, bizId: string, isFirstEver: boolean, bizListAfter: Biz[], moneyAfter: number) => {
    if (isFirstEver) {
      // Only initialize the optimal-step system and start the timer.
      recomputeOptimal(bizListAfter, moneyAfter, true);
      return;
    }

    const step = rOptimalStep.current;
    if (!step) return;

    if (step.type === type && step.biz === bizId) {
      // Correct — reset misses, recompute next optimal
      setMisses(0); rMisses.current = 0;
      setDeadlockStreak(0); rDeadlockStreak.current = 0;
      log('OPTIMAL_MATCH', { actualType: type, actualBiz: bizId, optimalStep: step });
      recomputeOptimal(bizListAfter, moneyAfter);
    } else {
      // Wrong action — log both what the player did and what was expected
      log('OPTIMAL_MISS', { actualType: type, actualBiz: bizId, optimalStep: step });
    }
  };

  // ── countdown ticker ──
  useEffect(() => {
    if (!started || paused) return;
    const id = setInterval(() => {
      if (!rBotActive.current) return;

      // Unfreeze check
      const fu = rFreezeUntil.current;
      if (fu) {
        if (Date.now() >= fu) {
          setFreezeUntil(null); rFreezeUntil.current = null;
          setIsFrozen(false);
        } else {
          const d = rDeadline.current;
          if (d) setTimeLeft(d - Date.now());
          return;
        }
      }

      const d = rDeadline.current;
      if (!d) { setTimeLeft(null); return; }
      const left = d - Date.now();
      setTimeLeft(left);
      if (left <= 0) {
        setDeadline(null); rDeadline.current = null;
        setTimeLeft(null);
        punish();
      }
    }, 100);
    return () => clearInterval(id);
  }, [started, paused]);

  // ── production loop ──
  useEffect(() => {
    if (!started || paused) return;
    const id = setInterval(() => {
      let gain = 0;
      const next = rBiz.current.map(b => {
        if (b.owned === 0 || !b.isRunning) return b;
        const inc  = (100 / ctime(b)) * 50;
        const prog = b.progress + inc;
        if (prog >= 100) {
          gain += rev(b) * b.owned;
          // Managers auto-restart the cycle; manual runs need a fresh "Start"
          return { ...b, progress: 0, isRunning: b.hasManager };
        }
        return { ...b, progress: prog };
      });
      setBiz(next); rBiz.current = next;
      if (gain > 0) {
        setMoney(m => m + gain);  rMoney.current  += gain;
        setEarned(e => e + gain); rEarned.current += gain;
      }
      setRoiPerSec(calcIPS(next));
    }, 50);
    return () => clearInterval(id);
  }, [started, paused, ascBonus]);

  // ── player actions ──
  const buyBiz = (id: string) => {
    const b = rBiz.current.find(x => x.id === id);
    if (!b) return;
    const c = cost(b);
    if (rMoney.current < c) return;
    const nb          = rMoney.current - c;
    const isFirstEver = rBiz.current.every(x => x.owned === 0);
    const nextBizList = rBiz.current.map(x => x.id === id ? { ...x, owned: x.owned + 1 } : x);

    setMoney(nb); rMoney.current = nb;
    setBiz(nextBizList); rBiz.current = nextBizList;
    playKaching();
    log('PURCHASE', {
      biz: id, cost: c, newOwned: b.owned + 1,
      optimalStep: rOptimalStep.current,
    });
    checkAction('PURCHASE', id, isFirstEver, nextBizList, nb);
  };

  const buyUpg = (id: string) => {
    const b = rBiz.current.find(x => x.id === id);
    if (!b || b.owned === 0) return;
    const c = b.baseCost * 50 * Math.pow(b.upgCostMul, b.upgradeLevel);
    if (rMoney.current < c) return;
    const nb          = rMoney.current - c;
    const nextBizList = rBiz.current.map(x => x.id === id ? { ...x, upgradeLevel: x.upgradeLevel + 1 } : x);

    setMoney(nb); rMoney.current = nb;
    setBiz(nextBizList); rBiz.current = nextBizList;
    playKaching();
    log('UPGRADE', {
      biz: id, cost: c, newLevel: b.upgradeLevel + 1,
      optimalStep: rOptimalStep.current,
    });
    checkAction('UPGRADE', id, false, nextBizList, nb);
  };

  const hireMan = (id: string) => {
    const b = rBiz.current.find(x => x.id === id);
    if (!b || b.owned === 0 || b.hasManager || rMoney.current < b.mgrCost) return;
    const nb          = rMoney.current - b.mgrCost;
    const nextBizList = rBiz.current.map(x => x.id === id ? { ...x, hasManager: true, isRunning: true } : x);

    setMoney(nb); rMoney.current = nb;
    setBiz(nextBizList); rBiz.current = nextBizList;
    playKaching();
    log('HIRE_MANAGER', {
      biz: id, cost: b.mgrCost,
      optimalStep: rOptimalStep.current,
    });
    checkAction('HIRE_MANAGER', id, false, nextBizList, nb);
  };

  const startProd = (id: string) => {
    const b = rBiz.current.find(x => x.id === id);
    if (!b || b.owned === 0 || b.isRunning) return;
    const nextBizList = rBiz.current.map(x => x.id === id ? { ...x, isRunning: true, progress: 0 } : x);
    setBiz(nextBizList); rBiz.current = nextBizList;
    log('START_PROD', { biz: id, optimalStep: rOptimalStep.current });
  };

  const download = () => {
    // Explicit cell helpers — never swallow false or 0 via ||
    const n  = (v: any) => (v === undefined || v === null) ? '' : v;
    const b  = (v: any) => (v === undefined || v === null) ? '' : String(v); // booleans as "true"/"false"
    const r2 = (v: any) => (v === undefined || v === null) ? '' : Number(v).toFixed(2);

    const cols = [
      'Timestamp', 'SessionMs', 'EventType', 'ParticipantName',
      'Balance', 'TotalEarned', 'IncomePerSec',
      'Biz', 'Cost', 'NewOwned', 'NewLevel',
      'Fine', 'BalanceAfter', 'WipeRatio', 'WasDeadlocked',
      'MissCount', 'CurrentMisses', 'DeadlockStreak', 'TriggerStreak',
      'FreezeDuration',
      'OptType', 'OptBiz',
      'ActualType', 'ActualBiz',
    ];

    const rows = rLog.current.map(e => [
      n(e.ts),
      n(e.sMs),
      n(e.type),
      `"${e.name ?? ''}"`,
      r2(e.money),
      r2(e.earned),
      r2(e.ips),
      n(e.biz),
      r2(e.cost),
      n(e.newOwned),
      n(e.newLevel),
      r2(e.fine),
      r2(e.balanceAfter),
      r2(e.wipeRatio),
      b(e.wasDeadlocked),
      n(e.missCount),
      n(e.currentMisses),
      n(e.deadlockStreak),
      n(e.triggerStreak),
      n(e.freezeDuration),
      n(e.optimalStep?.type),
      n(e.optimalStep?.biz),
      n(e.actualType),
      n(e.actualBiz),
    ].join(','));

    const csv = [cols.join(','), ...rows].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `${name}_idle_empire_${Date.now()}.csv`;
    a.click();
  };

  // ── derived display ──
  const warnOn   = botActive && timeLeft !== null && timeLeft <= P.WARN_AT && !isFrozen;
  const urgency  = timeLeft ? Math.max(0, timeLeft / P.WARN_AT) : 1;
  const warnClr  = urgency < 0.3 ? '#ef4444' : urgency < 0.65 ? '#f97316' : '#facc15';

  // ════════ START SCREEN ════════
  if (!started) return (
    <div style={{minHeight:'100vh',background:'#0f172a',display:'flex',alignItems:'center',justifyContent:'center',padding:'1rem',fontFamily:'system-ui,sans-serif'}}>
      <div style={{background:'#1e293b',border:'1px solid #334155',borderRadius:16,padding:'2rem',maxWidth:400,width:'100%'}}>
        <h1 style={{color:'#f8fafc',fontSize:26,fontWeight:800,textAlign:'center',margin:'0 0 4px'}}>💰 Idle Empire</h1>
        <p style={{color:'#475569',textAlign:'center',fontSize:13,margin:'0 0 1.5rem'}}>Research Edition</p>

        <label style={{color:'#cbd5e1',fontSize:14,fontWeight:600,display:'block',marginBottom:6}}>Your name:</label>
        <input
          value={name}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') document.getElementById('start-btn')?.click(); }}
          placeholder="Enter name..."
          style={{width:'100%',boxSizing:'border-box',padding:'10px 14px',background:'#0f172a',border:'1.5px solid #334155',borderRadius:8,color:'#f8fafc',fontSize:15,marginBottom:16}}
        />

        <div style={{background:'#0f172a',borderRadius:8,padding:'1rem',marginBottom:'1.5rem',fontSize:13,color:'#94a3b8',lineHeight:1.75}}>
          <p style={{fontWeight:700,color:'#fbbf24',margin:'0 0 6px'}}>⚠️ Research Notice</p>
          <p style={{margin:0}}>
            This game includes a hidden background evaluation system. You may experience unexpected
            balance deductions during play. These are intentional and part of the study. All decisions are recorded.
          </p>
        </div>

        <button
          id="start-btn"
          onClick={() => {
            if (!name.trim()) { alert('Please enter your name!'); return; }
            const b = freshBiz();
            setMoney(4);           rMoney.current          = 4;
            setEarned(0);          rEarned.current         = 0;
            setBiz(b);             rBiz.current            = b;
            rLog.current = [];     rSession.current        = Date.now();
            setMisses(0);          rMisses.current         = 0;
            setBotActive(false);   rBotActive.current      = false;
            setDeadline(null);     rDeadline.current       = null;
            setFreezeUntil(null);  rFreezeUntil.current    = null;
            setIsFrozen(false);
            setDeadlockStreak(0);  rDeadlockStreak.current = 0;
            setOptimalStep(null);  rOptimalStep.current    = null;
            setFineLog([]); setTotalFines(0);
            setStarted(true); setTutorial(true);
            log('SESSION_START', { name });
          }}
          style={{width:'100%',padding:'12px',background:'#3b82f6',border:'none',borderRadius:8,color:'#fff',fontWeight:700,fontSize:16,cursor:'pointer'}}
        >
          Start Playing 🚀
        </button>
      </div>
    </div>
  );

  // ════════ MAIN GAME ════════
  return (
    <>
      <style>{`
        @keyframes fadeup    { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
        @keyframes shake     { 0%,100%{transform:translateX(0)} 20%,60%{transform:translateX(-8px)} 40%,80%{transform:translateX(8px)} }
        @keyframes pulse     { 0%,100%{opacity:1} 50%{opacity:0.45} }
        @keyframes borderFl  { 0%,100%{box-shadow:0 0 0 2px #ef4444} 50%{box-shadow:0 0 0 2px #fca5a5,0 0 18px #ef444466} }
        @keyframes frozenP   { 0%,100%{box-shadow:0 0 0 2px #38bdf8} 50%{box-shadow:0 0 0 2px #7dd3fc,0 0 18px #38bdf866} }
        @keyframes iceShim   { 0%,100%{opacity:0.7} 50%{opacity:1} }
        .fadeup      { animation: fadeup 0.3s ease forwards }
        .shaking     { animation: shake 0.45s ease }
        .pulsing     { animation: pulse 0.7s ease infinite }
        .flicker     { animation: borderFl 0.55s ease infinite }
        .frozen-ring { animation: frozenP 1.2s ease infinite }
        .ice-blink   { animation: iceShim 2s ease infinite }
      `}</style>

      <div className={shake ? 'shaking' : ''} style={{minHeight:'100vh',background:'#f1f5f9',fontFamily:'system-ui,sans-serif',padding:'0.75rem'}}>

        {/* penalty flash */}
        {flashMsg && (
          <div className="fadeup" style={{
            position:'fixed',top:'42%',left:'50%',transform:'translate(-50%,-50%)',
            zIndex:80,background:'#1e293b',border:`2px solid ${flashMsg.color}`,
            borderRadius:14,padding:'1.25rem 2rem',textAlign:'center',
            color:'#f8fafc',maxWidth:340,pointerEvents:'none',
            boxShadow:'0 8px 40px rgba(0,0,0,0.45)'
          }}>
            <div style={{fontSize:30,marginBottom:6}}>💸</div>
            <div style={{fontWeight:700,fontSize:16,color:'#fca5a5'}}>{flashMsg.msg}</div>
          </div>
        )}

        {/* tutorial */}
        {tutorial && (
          <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.72)',zIndex:60,display:'flex',alignItems:'center',justifyContent:'center',padding:'1rem'}}>
            <div style={{background:'#fff',borderRadius:16,padding:'2rem',maxWidth:460,width:'100%'}}>
              <h2 style={{margin:'0 0 0.75rem',fontSize:20}}>Welcome, {name}! 👋</h2>
              <p style={{color:'#374151',lineHeight:1.7,margin:'0 0 0.75rem'}}>
                Buy businesses, start production, hire managers, upgrade — build your empire.
              </p>
              <p style={{color:'#374151',lineHeight:1.7,margin:'0 0 0.75rem'}}>
                A background system is watching your session. You will sometimes see <strong style={{color:'#ef4444'}}>unexpected deductions</strong> from your balance. This is not a bug. Figure out what the system wants.
              </p>
              <p style={{color:'#94a3b8',fontSize:13,margin:'0 0 1.25rem'}}>All actions are recorded for research purposes.</p>
              <button onClick={() => setTutorial(false)}
                style={{width:'100%',padding:'11px',background:'#1e293b',border:'none',borderRadius:8,color:'#fff',fontWeight:700,fontSize:15,cursor:'pointer'}}>
                Got it — let's go 🚀
              </button>
            </div>
          </div>
        )}

        {/* header */}
        <header
          className={isFrozen ? 'frozen-ring' : warnOn ? 'flicker' : ''}
          style={{
            background:'#1e293b',color:'#fff',borderRadius:14,
            padding:'1rem 1.25rem',marginBottom:'1.25rem',
            position:'sticky',top:8,zIndex:30,
            boxShadow:'0 4px 20px rgba(0,0,0,0.25)',
          }}>
          <div style={{display:'flex',alignItems:'center',flexWrap:'wrap',gap:14}}>
            <div style={{flexShrink:0}}>
              <div style={{fontWeight:700,fontSize:17}}>Idle Empire</div>
              <div style={{fontSize:12,color:'#64748b'}}>{name}</div>
            </div>
            <div style={{display:'flex',gap:20,flex:1,justifyContent:'center',flexWrap:'wrap',alignItems:'center'}}>
              <StatBox label="Balance"   value={fmt(money)}      color="#4ade80" large />
              <StatBox label="Income/s"  value={fmt(roiPerSec)}  color="#fbbf24" />
              <StatBox label="Total"     value={fmt(earned)}     color="#60a5fa" />
              <StatBox label="Fined"     value={fmt(totalFines)} color="#f87171" />
              <StatBox label="Penalties" value={fineLog.length}  color="#fb923c" />
            </div>
            <div style={{display:'flex',gap:8,flexShrink:0}}>
              <IcnBtn onClick={() => setPaused(p => !p)} title={paused ? 'Resume' : 'Pause'}>
                {paused
                  ? <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                  : <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>}
              </IcnBtn>
              <IcnBtn onClick={() => download()} title="Download data">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
              </IcnBtn>
            </div>
          </div>

          {/* tension bar */}
          {botActive && deadline && (
            <div style={{marginTop:12,display:'flex',alignItems:'center',gap:10}}>
              <div style={{flex:1,height:5,background:'#0f172a',borderRadius:3,overflow:'hidden',border:'1px solid #334155'}}>
                {isFrozen ? (
                  <div className="ice-blink" style={{
                    height:'100%',borderRadius:3,background:'#38bdf8',
                    width:`${Math.max(0,Math.min(100,(timeLeft ?? P.WINDOW)/P.WINDOW*100))}%`,
                  }}/>
                ) : (
                  <div style={{
                    height:'100%',borderRadius:3,
                    background: warnOn ? warnClr : '#3b82f6',
                    width:`${Math.max(0,Math.min(100,(timeLeft ?? P.WINDOW)/P.WINDOW*100))}%`,
                    transition:'width 0.1s linear, background 0.3s'
                  }}/>
                )}
              </div>
              {isFrozen ? (
                <span className="ice-blink" style={{color:'#38bdf8',fontWeight:800,fontSize:14,minWidth:50,textAlign:'right'}}>
                  ❄️ {((timeLeft ?? 0)/1000).toFixed(1)}s
                </span>
              ) : warnOn ? (
                <span className="pulsing" style={{color:warnClr,fontWeight:800,fontSize:15,minWidth:40,textAlign:'right'}}>
                  {((timeLeft ?? 0)/1000).toFixed(1)}s
                </span>
              ) : null}
            </div>
          )}
        </header>

        {/* main grid */}
        <div style={{display:'grid',gridTemplateColumns:'1fr 270px',gap:'1.25rem'}}>

          {/* businesses */}
          <div style={{display:'flex',flexDirection:'column',gap:12}}>
            {biz.map(b => {
              const c    = cost(b);
              const r    = rev(b);
              const uc   = b.baseCost * 50 * Math.pow(b.upgCostMul, b.upgradeLevel);
              const canB = money >= c;
              const canU = money >= uc && b.owned > 0;
              const canM = money >= b.mgrCost && b.owned > 0 && !b.hasManager;
              return (
                <div key={b.id} style={{background:'#fff',borderRadius:14,padding:'1rem',border:'1px solid #e2e8f0',boxShadow:'0 1px 4px rgba(0,0,0,0.04)'}}>
                  <div style={{display:'flex',gap:12,alignItems:'flex-start'}}>
                    <div style={{fontSize:36,lineHeight:1,flexShrink:0,width:50,height:50,display:'flex',alignItems:'center',justifyContent:'center',background:'#f8fafc',borderRadius:10}}>{b.icon}</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8}}>
                        <div>
                          <div style={{fontWeight:700,fontSize:15,color:'#1e293b'}}>{b.name}</div>
                          {b.owned > 0 && (
                            <div style={{fontSize:12,marginTop:2}}>
                              <span style={{fontWeight:600,color:'#16a34a'}}>💰 {fmt(r*b.owned)}/cycle</span>
                              {b.hasManager && <span style={{color:'#2563eb',marginLeft:8}}>⚡ {fmt((r*b.owned)/(ctime(b)/1000))}/s</span>}
                            </div>
                          )}
                        </div>
                        <div style={{textAlign:'right',flexShrink:0}}>
                          <div style={{fontSize:22,fontWeight:800,color:'#0f172a'}}>{b.owned}</div>
                          <div style={{fontSize:10,color:'#94a3b8'}}>owned</div>
                          {b.upgradeLevel > 0 && <div style={{fontSize:10,color:'#7c3aed'}}>Lv{b.upgradeLevel}</div>}
                          {b.hasManager && <div style={{fontSize:10,color:'#0891b2'}}>👔</div>}
                        </div>
                      </div>
                      {b.owned > 0 && (
                        <div style={{marginTop:8,background:'#f1f5f9',borderRadius:999,height:14,overflow:'hidden',position:'relative'}}>
                          <div style={{width:`${Math.min(b.progress,100)}%`,height:'100%',background:'#22c55e',transition:'width 0.1s'}}/>
                          <span style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,fontWeight:600,color:'#374151'}}>
                            {b.isRunning ? `${(ctime(b)/1000).toFixed(1)}s` : 'Idle'}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                  <div style={{marginTop:10,display:'grid',gridTemplateColumns: b.owned===0 ? '1fr' : 'repeat(4,1fr)',gap:6}}>
                    {b.owned === 0 ? (
                      <Btn active={canB} onClick={() => buyBiz(b.id)} col={canB?'#16a34a':'#e2e8f0'} tcol={canB?'#fff':'#94a3b8'}>+ Buy {fmt(c)}</Btn>
                    ) : (<>
                      <Btn active={!b.isRunning && !b.hasManager} onClick={() => startProd(b.id)} col={(!b.isRunning && !b.hasManager)?'#2563eb':'#e2e8f0'} tcol={(!b.isRunning && !b.hasManager)?'#fff':'#94a3b8'}>
                        {b.hasManager ? '👔' : b.isRunning ? '▶ Running' : '▶ Start'}
                      </Btn>
                      <Btn active={canB} onClick={() => buyBiz(b.id)} col={canB?'#16a34a':'#e2e8f0'} tcol={canB?'#fff':'#94a3b8'}>+ {fmt(c)}</Btn>
                      <Btn active={canU} onClick={() => buyUpg(b.id)} col={canU?'#7c3aed':'#e2e8f0'} tcol={canU?'#fff':'#94a3b8'}>↑ {fmt(uc)}</Btn>
                      <Btn active={canM} onClick={() => hireMan(b.id)} col={canM?'#0891b2':'#e2e8f0'} tcol={canM?'#fff':'#94a3b8'}>👔 {fmt(b.mgrCost)}</Btn>
                    </>)}
                  </div>
                </div>
              );
            })}
          </div>

          {/* sidebar */}
          <div style={{display:'flex',flexDirection:'column',gap:12}}>
            <div style={{background:'#1e293b',borderRadius:14,padding:'1rem',border:'1px solid #334155',position:'sticky',top:100}}>
              <div style={{fontWeight:700,fontSize:14,color:'#e2e8f0',marginBottom:10,display:'flex',alignItems:'center',gap:6}}>
                <span style={{color:'#f87171',fontSize:16}}>⚡</span> System Log
              </div>
              {fineLog.length === 0 ? (
                <p style={{color:'#475569',fontSize:12,textAlign:'center',padding:'0.5rem 0'}}>No events yet.</p>
              ) : (
                <div style={{display:'flex',flexDirection:'column',gap:4,maxHeight:260,overflowY:'auto'}}>
                  {[...fineLog].reverse().map((e,i) => (
                    <div key={i} style={{background:'#0f172a',borderRadius:8,padding:'6px 10px',border:'1px solid #1e293b'}}>
                      <div style={{fontSize:12,color:'#f87171',fontWeight:700}}>−{fmt(e.fine)}</div>
                      <div style={{fontSize:11,color:'#475569'}}>miss #{e.m} · {new Date(e.ts).toLocaleTimeString()}</div>
                    </div>
                  ))}
                </div>
              )}
              <div style={{marginTop:10,paddingTop:8,borderTop:'1px solid #1e293b',display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                {[
                  { l: 'Total fined',  v: fmt(totalFines), c: '#f87171' },
                  { l: 'Penalties',    v: fineLog.length,  c: '#fb923c' },
                  { l: 'Consec. miss', v: misses,          c: '#facc15' },
                ].map(({l,v,c}) => (
                  <div key={l} style={{background:'#0f172a',borderRadius:8,padding:'6px 8px'}}>
                    <div style={{fontSize:10,color:'#475569'}}>{l}</div>
                    <div style={{fontSize:14,fontWeight:700,color:c}}>{v}</div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{background:'#fff',borderRadius:14,padding:'1rem',border:'1px solid #e2e8f0'}}>
              <div style={{fontWeight:700,fontSize:14,color:'#1e293b',marginBottom:8}}>🏢 Empire</div>
              {biz.filter(b=>b.owned>0).length === 0
                ? <p style={{color:'#94a3b8',fontSize:12,textAlign:'center',padding:'0.5rem 0'}}>Buy a business to start!</p>
                : biz.filter(b=>b.owned>0).map(b => (
                    <div key={b.id} style={{display:'flex',justifyContent:'space-between',fontSize:13,marginBottom:5,color:'#374151'}}>
                      <span>{b.icon} {b.name}</span>
                      <span style={{fontWeight:700,color:'#0f172a'}}>×{b.owned}</span>
                    </div>
                  ))
              }
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

const StatBox = ({label,value,color,large=false}: {label: string; value: string | number; color: string; large?: boolean}) => (
  <div style={{textAlign:'center'}}>
    <div style={{fontSize:10,color:'#94a3b8',textTransform:'uppercase',letterSpacing:0.5}}>{label}</div>
    <div style={{fontSize: large ? 20 : 15,fontWeight:800,color}}>{value}</div>
  </div>
);

const IcnBtn = ({children,onClick,title}: {children: ReactNode; onClick: () => void; title: string}) => (
  <button onClick={onClick} title={title}
    style={{padding:'8px 10px',background:'#334155',border:'none',borderRadius:8,color:'#e2e8f0',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>
    {children}
  </button>
);

const Btn = ({children,onClick,active,col,tcol}: {children: ReactNode; onClick: () => void; active: boolean; col: string; tcol: string}) => (
  <button onClick={active ? onClick : undefined}
    style={{
      padding:'7px 4px',borderRadius:8,border:'none',fontWeight:600,fontSize:12,lineHeight:1.2,
      cursor: active ? 'pointer' : 'not-allowed',
      background: col, color: tcol,
      display:'flex',alignItems:'center',justifyContent:'center',gap:3,
      transition:'opacity 0.15s', opacity: active ? 1 : 0.85,
    }}>
    {children}
  </button>
);
