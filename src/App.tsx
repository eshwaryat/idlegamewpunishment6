import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, RotateCcw, Download, User, TrendingUp, Plus, Crown, Building2, Target, Sparkles } from 'lucide-react';

// --- TYPES ---
interface BusinessType {
  id: string;
  name: string;
  baseCost: number;
  baseRevenue: number;
  baseTime: number;
  icon: string;
  description: string;
  costMultiplier: number;
  upgradeBonus: number;
  managerCost: number;
  upgradeCostMultiplier: number;
}

interface Business extends BusinessType {
  owned: number;
  totalRevenue: number;
  progress: number;
  isRunning: boolean;
  upgradeLevel: number;
  totalProduced: number;
  hasManager: boolean;
}

interface Dialogue { id: number; message: string; }
interface Achievement { id: string; name: string; description: string; icon: string; }
interface DisplayedAchievement extends Achievement { timestamp: number; }
interface EventLogEntry { timestamp: number; sessionTime: number; eventType: string; [key: string]: any; }

const IdleEmpireGame = () => {
  // --- STATE (Visuals) ---
  const [userName, setUserName] = useState('');
  const [gameStarted, setGameStarted] = useState(false);
  const [money, setMoney] = useState(4);
  const [totalEarned, setTotalEarned] = useState(0);
  const [lifetimeEarned, setLifetimeEarned] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [showTutorial, setShowTutorial] = useState(true);
  
  // --- REFS (Logic & Logging) ---
  // Fix 1: Event Log is a Ref (No re-renders, no memory leak)
  const eventLogRef = useRef<EventLogEntry[]>([]);
  const [sessionStart, setSessionStart] = useState(Date.now());
  
  // Fix 2: Game State Refs (For the Game Loop to read without dependency slippage)
  const businessesRef = useRef<Business[]>([]);
  const moneyRef = useRef(money);
  const totalEarnedRef = useRef(totalEarned);
  const lifetimeEarnedRef = useRef(lifetimeEarned);

  const [dialogues, setDialogues] = useState<Dialogue[]>([]);
  const [achievements, setAchievements] = useState<DisplayedAchievement[]>([]);
  const [unlockedAchievements, setUnlockedAchievements] = useState(new Set<string>());
  const [ascensionCount, setAscensionCount] = useState(0);
  const [ascensionBonus, setAscensionBonus] = useState(1);
  const [showAscensionModal, setShowAscensionModal] = useState(false);
   
  // Background music
  const [backgroundMusic, setBackgroundMusic] = useState<HTMLAudioElement | null>(null);
   
  useEffect(() => {
    const music = new Audio('/sounds/background.mp3');
    music.loop = true;
    music.volume = 0.3019;
    setBackgroundMusic(music);
    return () => { music.pause(); music.src = ''; };
  }, []);
   
  useEffect(() => {
    if (!backgroundMusic) return;
    if (gameStarted && !isPaused) {
      backgroundMusic.play().catch(err => console.log('Music autoplay blocked:', err));
    } else {
      backgroundMusic.pause();
    }
  }, [gameStarted, isPaused, backgroundMusic]);
   
  const playKachingSound = () => {
    try {
      const audio = new Audio('/sounds/kaching.mp3');
      audio.volume = 0.5;
      audio.play().catch(() => { /* ignore blocked audio */ });
    } catch (error) { console.log('Audio error:', error); }
  };

  // const businessTypes: BusinessType[] = [
  //   { id: 'lemonade', name: 'Lemonade Stand', baseCost: 4, baseRevenue: 0.75, baseTime: 2000, icon: '🍋', description: 'Your first venture!', costMultiplier: 1.15, upgradeBonus: 1.5, managerCost: 1000, upgradeCostMultiplier: 5 },
  //   { id: 'newspaper', name: 'Newspaper Route', baseCost: 80, baseRevenue:7.5, baseTime: 4000, icon: '📰', description: 'Deliver news!', costMultiplier: 1.14, upgradeBonus: 1.5, managerCost: 5000, upgradeCostMultiplier: 4.5},
  //   { id: 'carwash', name: 'Car Wash', baseCost: 1600, baseRevenue: 75, baseTime: 6000, icon: '🚗', description: 'Shine wheels!', costMultiplier: 1.13, upgradeBonus: 1.5, managerCost: 25000, upgradeCostMultiplier: 4.0 },
  //   { id: 'pizza', name: 'Pizza Delivery', baseCost: 32000, baseRevenue: 750, baseTime: 8000, icon: '🍕', description: 'Hot profits!', costMultiplier: 1.12, upgradeBonus: 1.5, managerCost: 150000, upgradeCostMultiplier: 3.5 },
  //   { id: 'arcade', name: 'Arcade', baseCost: 640000, baseRevenue: 7500, baseTime: 10000, icon: '🎮', description: 'High scores!', costMultiplier: 1.11, upgradeBonus: 1.5, managerCost: 1000000, upgradeCostMultiplier: 3.0 },
  //   { id: 'cinema', name: 'Movie Theater', baseCost: 12800000, baseRevenue: 75000, baseTime: 12000, icon: '🎬', description: 'Blockbusters!', costMultiplier: 1.10, upgradeBonus: 1.5, managerCost: 10000000, upgradeCostMultiplier: 2.8 },
  //   { id: 'bank', name: 'Bank', baseCost: 128000000, baseRevenue: 750000, baseTime: 14000, icon: '🏦', description: 'Money begets money!', costMultiplier: 1.09, upgradeBonus: 1.5, managerCost: 100000000, upgradeCostMultiplier: 2.6 },
  //   { id: 'oilrig', name: 'Oil Company', baseCost: 128000000, baseRevenue: 7500000, baseTime: 16000, icon: '🛢️', description: 'Black gold!', costMultiplier: 1.08, upgradeBonus: 1.5, managerCost: 1000000000, upgradeCostMultiplier: 2.4 },
  //   { id: 'airline', name: 'Airline', baseCost: 12800000000, baseRevenue: 75000000, baseTime: 18000, icon: '✈️', description: 'Sky high!', costMultiplier: 1.07, upgradeBonus: 1.5, managerCost: 15000000000, upgradeCostMultiplier: 2.2 },
  //   { id: 'spacestation', name: 'Space Station', baseCost: 128000000000, baseRevenue: 750000000, baseTime: 20000, icon: '🚀', description: 'To infinity!', costMultiplier: 1.06, upgradeBonus: 1.5, managerCost: 200000000000, upgradeCostMultiplier: 2.0 }
  // ];

  
  const businessTypes: BusinessType[] = [ // experimental increment in baseRevenue from 0.75 to 1.00
    { id: 'lemonade', name: 'Lemonade Stand', baseCost: 4, baseRevenue: 1.00, baseTime: 2000, icon: '🍋', description: 'Your first venture!', costMultiplier: 1.15, upgradeBonus: 1.5, managerCost: 1000, upgradeCostMultiplier: 5 },
    { id: 'newspaper', name: 'Newspaper Route', baseCost: 80, baseRevenue:10.0, baseTime: 4000, icon: '📰', description: 'Deliver news!', costMultiplier: 1.14, upgradeBonus: 1.5, managerCost: 5000, upgradeCostMultiplier: 4.5},
    { id: 'carwash', name: 'Car Wash', baseCost: 1600, baseRevenue: 100, baseTime: 6000, icon: '🚗', description: 'Shine wheels!', costMultiplier: 1.13, upgradeBonus: 1.5, managerCost: 25000, upgradeCostMultiplier: 4.0 },
    { id: 'pizza', name: 'Pizza Delivery', baseCost: 32000, baseRevenue: 1000, baseTime: 8000, icon: '🍕', description: 'Hot profits!', costMultiplier: 1.12, upgradeBonus: 1.5, managerCost: 150000, upgradeCostMultiplier: 3.5 },
    { id: 'arcade', name: 'Arcade', baseCost: 640000, baseRevenue: 10000, baseTime: 10000, icon: '🎮', description: 'High scores!', costMultiplier: 1.11, upgradeBonus: 1.5, managerCost: 1000000, upgradeCostMultiplier: 3.0 },
    { id: 'cinema', name: 'Movie Theater', baseCost: 12800000, baseRevenue: 100000, baseTime: 12000, icon: '🎬', description: 'Blockbusters!', costMultiplier: 1.10, upgradeBonus: 1.5, managerCost: 10000000, upgradeCostMultiplier: 2.8 },
    { id: 'bank', name: 'Bank', baseCost: 128000000, baseRevenue: 1000000, baseTime: 14000, icon: '🏦', description: 'Money begets money!', costMultiplier: 1.09, upgradeBonus: 1.5, managerCost: 100000000, upgradeCostMultiplier: 2.6 },
    { id: 'oilrig', name: 'Oil Company', baseCost: 128000000, baseRevenue: 10000000, baseTime: 16000, icon: '🛢️', description: 'Black gold!', costMultiplier: 1.08, upgradeBonus: 1.5, managerCost: 1000000000, upgradeCostMultiplier: 2.4 },
    { id: 'airline', name: 'Airline', baseCost: 12800000000, baseRevenue: 100000000, baseTime: 18000, icon: '✈️', description: 'Sky high!', costMultiplier: 1.07, upgradeBonus: 1.5, managerCost: 15000000000, upgradeCostMultiplier: 2.2 },
    { id: 'spacestation', name: 'Space Station', baseCost: 128000000000, baseRevenue: 1000000000, baseTime: 20000, icon: '🚀', description: 'To infinity!', costMultiplier: 1.06, upgradeBonus: 1.5, managerCost: 200000000000, upgradeCostMultiplier: 2.0 }
  ];

  const initialBusinesses = businessTypes.map(b => ({ ...b, owned: 0, totalRevenue: 0, progress: 0, isRunning: false, upgradeLevel: 0, totalProduced: 0, hasManager: false }));
  const [businesses, setBusinesses] = useState<Business[]>(initialBusinesses);

  // --- SYNC REFS (Critical for Game Loop) ---
  useEffect(() => { businessesRef.current = businesses; }, [businesses]);
  useEffect(() => { moneyRef.current = money; }, [money]);
  useEffect(() => { totalEarnedRef.current = totalEarned; }, [totalEarned]);
  useEffect(() => { lifetimeEarnedRef.current = lifetimeEarned; }, [lifetimeEarned]);

  const characterDialogues = {
    firstPurchase: [ "🎉 Your first business! The journey begins!", "💪 That's the spirit! Let's build something great!", "🌟 Every empire starts with a single step!" ],
    unlockBusiness: { newspaper: "📰 Moving up in the world!", carwash: "🚗 Shiny profits ahead!", pizza: "🍕 Mama mia! Spicy move!", arcade: "🎮 Game on! High scores = high profits!", cinema: "🎬 Lights, camera, MONEY!", bank: "🏦 Playing with big money now!", oilrig: "🛢️ Strike oil, strike gold!", airline: "✈️ Sky's the limit!", spacestation: "🚀 TO THE MOON! You legend!" } as Record<string, string>,
    milestones: [ "💰 Cha-ching!", "⚡ Keep hustling!", "🔥 You're on fire!", "😎 Empire's growing!", "🎯 Smart moves!", "⭐ Crushing it!" ],
    firstManager: [ "👔 First manager! Automation time!", "🎩 Hired help!", "💼 That's how pros do it!" ],
    upgrades: [ "📈 Upgraded! Efficiency up!", "⚙️ Turbocharged!", "🚀 Level up!" ],
    ascension: [ "🌟 ASCENSION! You've transcended!", "✨ The universe resets, wisdom remains!", "🎆 Sacrifice brings greater power!" ]
  };
   
  const achievementsList: Achievement[] = [ 
    { id: 'first_purchase', name: 'Entrepreneur', description: 'Buy your first business', icon: '🎯' }, 
    { id: 'five_businesses', name: 'Business Owner', description: 'Own 5 of any business', icon: '🏢' }, 
    { id: 'first_manager', name: 'Delegator', description: 'Hire your first manager', icon: '👔' }, 
    { id: 'millionaire', name: 'Millionaire', description: 'Earn $1,000,000', icon: '💰' }, 
    { id: 'unlock_pizza', name: 'Pizza Tycoon', description: 'Unlock Pizza Delivery', icon: '🍕' }, 
    { id: 'unlock_cinema', name: 'Movie Mogul', description: 'Unlock Movie Theater', icon: '🎬' }, 
    { id: 'unlock_bank', name: 'Banking Boss', description: 'Unlock Bank', icon: '🏦' }, 
    { id: 'unlock_space', name: 'Space Pioneer', description: 'Unlock Space Station', icon: '🚀' }, 
    { id: 'ten_upgrades', name: 'Optimizer', description: 'Purchase 10 upgrades total', icon: '⚙️' }, 
    { id: 'speed_demon', name: 'Speed Demon', description: 'Start 50 productions', icon: '⚡' },
    { id: 'first_ascension', name: 'Transcendent', description: 'Complete your first ascension', icon: '🌟' },
    { id: 'multi_ascension', name: 'Cosmic Entity', description: 'Ascend 5 times', icon: '✨' }
  ];
   
  // Fix 3: Log Event writes to Ref (Instant, no re-render)
  const logEvent = (eventType: string, data: Record<string, any> = {}) => { 
  const now = Date.now();
  const event: EventLogEntry = { 
    timestamp: now, 
    sessionTime: now - sessionStart,
    eventType,
    userName,
    // Fix: Prioritize 'new' values passed from the function call to prevent 1-tick slippage
    currentMoney: data.newBalance !== undefined ? data.newBalance : moneyRef.current,
    totalEarned: data.newTotalEarned !== undefined ? data.newTotalEarned : totalEarnedRef.current,
    lifetimeEarned: data.newLifetimeEarned !== undefined ? data.newLifetimeEarned : lifetimeEarnedRef.current,
    ascensionCount,
    ascensionBonus,
    ...data 
  }; 
  // Fix: Shallow copy prevents future state changes from leaking into old logs
  eventLogRef.current.push({ ...event }); 
};


  const showDialogue = (message: string) => { const id = Date.now(); setDialogues(prev => [...prev, { id, message }]); setTimeout(() => { setDialogues(prev => prev.filter(d => d.id !== id)); }, 4000); };
  
  const unlockAchievement = (achievementId: string) => { 
    if (!unlockedAchievements.has(achievementId)) { 
        const achievement = achievementsList.find(a => a.id === achievementId); 
        if (achievement) { 
            setUnlockedAchievements(prev => new Set(prev).add(achievementId)); 
            setAchievements(prev => [...prev, { ...achievement, timestamp: Date.now() }]); 
            setTimeout(() => { setAchievements(prev => prev.filter(a => a.id !== achievementId)); }, 5000); 
            logEvent('ACHIEVEMENT', { achievementId, achievementName: achievement.name }); 
        } 
    } 
  };
   
  const calculateCost = (business: Business) => Math.floor(business.baseCost * Math.pow(business.costMultiplier, business.owned));
   
  const calculateRevenue = (business: Business) => {
    let baseRevenue = business.baseRevenue * Math.pow(business.upgradeBonus, business.upgradeLevel);
    let multiplier = 1;
    if (business.owned >= 10) multiplier *= 2;
    if (business.owned >= 25) multiplier *= 2;
    if (business.owned >= 50) multiplier *= 3;
    if (business.owned >= 75) multiplier *= 3;
    if (business.owned >= 100) multiplier *= 4;
    if (business.owned >= 150) multiplier *= 4;
    if (business.owned >= 200) multiplier *= 5;
    return baseRevenue * multiplier * ascensionBonus;
  };
   
  const calculateTime = (business: Business) => business.baseTime / (1 + business.upgradeLevel * 0.05);
  const calculateAscensionCost = () => Math.pow(10, 10 + ascensionCount);
  const calculateAscensionBonus = () => 150 * Math.sqrt(lifetimeEarned / Math.pow(10, 15));
  const canAscend = () => lifetimeEarned >= calculateAscensionCost();
   
   
  const buyBusiness = (businessId: string) => { 
  const business = businesses.find(b => b.id === businessId); 
  if (!business) return; 
  const cost = calculateCost(business); 
  
  if (money >= cost) { 
    playKachingSound();
    const newBal = money - cost; // Calculate exactly what the balance will be
    const newOwnedCount = business.owned + 1; // Track what the new amount will be

    setMoney(newBal); 
    setBusinesses(prev => prev.map(b => b.id === businessId ? { ...b, owned: b.owned + 1 } : b)); 

    // --- CALCULATE MILESTONES ---
      const milestones = [10, 25, 50, 75, 100, 150, 200];
      const nextMilestone = milestones.find(m => m >= newOwnedCount);
      const awayFromMilestone = nextMilestone ? nextMilestone - newOwnedCount : null;
      // ----------------------------
    
    // 1. CAPTURE STATE BEFORE UPDATE
      const isFirstPurchase = businesses.every(b => b.owned === 0); 
      const isFirstOfType = business.owned === 0; 
      
      // 2. DIALOGUE & ACHIEVEMENT LOGIC (INSERT THIS BLOCK)
      if (isFirstPurchase) { 
        showDialogue(characterDialogues.firstPurchase[Math.floor(Math.random() * characterDialogues.firstPurchase.length)]); 
        unlockAchievement('first_purchase'); 
      } else if (isFirstOfType) { 
        // Trigger specific dialogue for unlocking a new business type
        if (characterDialogues.unlockBusiness[businessId]) {
            showDialogue(characterDialogues.unlockBusiness[businessId]);
        }
        
        // Unlock specific achievements
        if (businessId === 'pizza') unlockAchievement('unlock_pizza'); 
        if (businessId === 'cinema') unlockAchievement('unlock_cinema'); 
        if (businessId === 'bank') unlockAchievement('unlock_bank'); 
        if (businessId === 'spacestation') unlockAchievement('unlock_space'); 
      } 
      else if (awayFromMilestone === 0) {
        // Exactly hit the milestone!
        showDialogue(`🎉 BOOM! ${business.name} just got a multiplier bonus! 🚀`);
      } 
      // else if (awayFromMilestone !== null && (awayFromMilestone == 5)) { //||  awayFromMilestone == 3 || awayFromMilestone == 1)) {
      //   // 5, 4, 3, 2, or 1 away from the next milestone
      //   showDialogue(`Almost there! Just ${awayFromMilestone} more ${business.name}(s) for a multiplier boost!`);
      // // =============================
      // }
      else if (Math.random() < 0.2) { 
        // 20% chance to show a random "Keep hustling" message on standard purchases
        showDialogue(characterDialogues.milestones[Math.floor(Math.random() * characterDialogues.milestones.length)]); 
      }

    // Pass newBalance explicitly to logEvent
    logEvent('PURCHASE', { 
      businessId, 
      businessName: business.name, 
      cost, 
      owned: business.owned + 1, 
      newBalance: newBal, 
      isFirstOfType: business.owned === 0 
    }); 
  }
};
   
  const buyUpgrade = (businessId: string, event?: React.MouseEvent) => { 
    const business = businesses.find(b => b.id === businessId); 
    if (!business) return; 
    const upgradeCost = business.baseCost * 50 * Math.pow(business.upgradeCostMultiplier, business.upgradeLevel);
    const mouseX = event?.clientX || 0;
    const mouseY = event?.clientY || 0;
    
    if (money >= upgradeCost && business.owned > 0) { 
      playKachingSound();
      setMoney(prev => prev - upgradeCost); 
      setBusinesses(prev => prev.map(b => b.id === businessId ? { ...b, upgradeLevel: b.upgradeLevel + 1 } : b)); 
      if (Math.random() < 0.3) showDialogue(characterDialogues.upgrades[Math.floor(Math.random() * characterDialogues.upgrades.length)]); 
      
      logEvent('UPGRADE', { businessId, businessName: business.name, cost: upgradeCost, upgradeLevel: business.upgradeLevel + 1, newBalance: money - upgradeCost, mouseX, mouseY, reason: 'success' }); 
    } else {
      logEvent('UPGRADE_FAILED', { businessId, businessName: business.name, cost: upgradeCost, mouseX, mouseY, reason: money < upgradeCost ? 'insufficient_funds' : 'no_business_owned' });
    }
  };
   
  const hireManager = (businessId: string, event?: React.MouseEvent) => { 
    const business = businesses.find(b => b.id === businessId); 
    if (!business) return; 
    const mouseX = event?.clientX || 0;
    const mouseY = event?.clientY || 0;
    
    if (money >= business.managerCost && business.owned > 0 && !business.hasManager) { 
      const isFirstManager = businesses.every(b => !b.hasManager); 
      setMoney(prev => prev - business.managerCost); 
      setBusinesses(prev => prev.map(b => b.id === businessId ? { ...b, hasManager: true, isRunning: true } : b)); 
      
      if (isFirstManager) { 
        showDialogue(characterDialogues.firstManager[Math.floor(Math.random() * characterDialogues.firstManager.length)]); 
        unlockAchievement('first_manager'); 
      } 
      
      logEvent('HIRE_MANAGER', { businessId, businessName: business.name, cost: business.managerCost, newBalance: money - business.managerCost, isFirstManager, totalManagers: businesses.filter(b => b.hasManager).length + 1, mouseX, mouseY, reason: 'success' }); 
    } else {
      logEvent('HIRE_MANAGER_FAILED', { businessId, businessName: business.name, cost: business.managerCost, mouseX, mouseY, reason: !business.owned ? 'no_business' : business.hasManager ? 'already_hired' : 'insufficient_funds' });
    }
  };

  const startProduction = (businessId: string, event?: React.MouseEvent) => { 
    const business = businesses.find(b => b.id === businessId); 
    if (!business) return; 
    const mouseX = event?.clientX || 0;
    const mouseY = event?.clientY || 0;
    
    if (business.owned > 0 && !business.isRunning) {
      playKachingSound();
      setBusinesses(prev => prev.map(b => b.id === businessId ? { ...b, isRunning: true, progress: 0 } : b)); 
      
      // Check production start count from Ref
      const productionStarts = eventLogRef.current.filter(e => e.eventType === 'START_PRODUCTION').length; 
      if (productionStarts >= 49 && !unlockedAchievements.has('speed_demon')) unlockAchievement('speed_demon'); 
      
      logEvent('START_PRODUCTION', { businessId, businessName: business.name, expectedRevenue: calculateRevenue(business) * business.owned, cycleTime: calculateTime(business), manualStart: true, hasManager: business.hasManager, owned: business.owned, upgradeLevel: business.upgradeLevel, mouseX, mouseY, reason: 'success' }); 
    }
  };
   
  const resetGame = () => { 
    if (window.confirm('Reset and lose all progress? Data will be downloaded.')) { 
      downloadData(); 
      // 1. Reset State
      setMoney(4); 
      setTotalEarned(0); 
      setLifetimeEarned(0);
      setBusinesses(initialBusinesses); 
      setShowTutorial(true); 
      setUnlockedAchievements(new Set()); 
      setAscensionCount(0);
      setAscensionBonus(1);

      // 2. Fix Ghost Data: Force Reset Refs immediately
      moneyRef.current = 4;
      totalEarnedRef.current = 0;
      lifetimeEarnedRef.current = 0;
      businessesRef.current = initialBusinesses;
      
      // 3. Clear Logs
      eventLogRef.current = [];
      setSessionStart(Date.now());

      logEvent('RESET', { finalMoney: money, totalEarned, lifetimeEarned }); 
    } 
  };
   
  const performAscension = () => {
    if (canAscend()) {
      const newBonus = calculateAscensionBonus();
      const newAscensionCount = ascensionCount + 1;
      logEvent('ASCENSION', { ascensionNumber: newAscensionCount, lifetimeEarned, newBonus, previousBonus: ascensionBonus });
      downloadData();
      
      // 1. Reset State
      setMoney(4);
      setTotalEarned(0);
      setBusinesses(initialBusinesses);
      setAscensionCount(newAscensionCount);
      setAscensionBonus(newBonus);
      setShowAscensionModal(false);

      // 2. Fix Ghost Data: Force Reset Refs
      moneyRef.current = 4;
      totalEarnedRef.current = 0;
      businessesRef.current = initialBusinesses;
      
      // 3. Clear Logs
      eventLogRef.current = [];
      setSessionStart(Date.now());

      showDialogue(characterDialogues.ascension[Math.floor(Math.random() * characterDialogues.ascension.length)]);
      if (newAscensionCount === 1) unlockAchievement('first_ascension');
      if (newAscensionCount === 5) unlockAchievement('multi_ascension');
    }
  };
   
const downloadData = () => { 
  const csvHeader = 'Timestamp,Date/Time,Session Time (ms),Session Time (min),Event Type,User Name,Business ID,Business Name,Cost,Revenue,Owned,Upgrade Level,Current Money,Total Earned,Lifetime Earned,Has Manager,Manual Start,Ascension Count,Ascension Bonus,Total Managers,Is First Purchase,New Balance,Reason\n'; 
  
  const csvRows = eventLogRef.current.map(e => {
    const date = new Date(e.timestamp).toISOString();
    const sessionMin = (e.sessionTime / 60000).toFixed(3);
    
    // Fix: Strictly use e.currentMoney. No fallbacks to live state.
    return `${e.timestamp},"${date}",${e.sessionTime},${sessionMin},${e.eventType},"${userName}",${e.businessId || ''},${e.businessName || ''},${e.cost || ''},${e.revenue || ''},${e.owned || ''},${e.upgradeLevel || ''},${e.currentMoney},${e.totalEarned},${e.lifetimeEarned},${e.hasManager || false},${e.manualStart || false},${e.ascensionCount},${e.ascensionBonus},${e.totalManagers || ''},${e.isFirstOfType || false},${e.newBalance !== undefined ? e.newBalance : ''},"${e.reason || ''}"`;
  }).join('\n'); 
  
  const csv = csvHeader + csvRows; 
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' }); 
  const url = window.URL.createObjectURL(blob); 
  const a = document.createElement('a'); 
  a.href = url; 
  a.download = `${userName}_idle_empire_research_${Date.now()}.csv`; 
  a.click(); 
};
   
  // Fix 4: Stable Game Loop (Ref-based, no dependency tearing)
  useEffect(() => { 
    if (!gameStarted || isPaused) return; 
    
    const interval = setInterval(() => { 
        // 1. Read from Refs (Fresh data, no dependency issues)
        const currentBusinesses = businessesRef.current;
        let earnedInThisTick = 0;
        const autoCollectEvents: any[] = [];

        // 2. Logic (Pure calculation)
        const nextBusinesses = currentBusinesses.map(business => { 
            if (business.owned === 0 || !business.isRunning) return business; 
            
            const cycleTime = calculateTime(business); 
            // 50ms tick
            const increment = (100 / cycleTime) * 50; 
            const newProgress = business.progress + increment; 
            
            if (newProgress >= 100) { 
                const revenue = calculateRevenue(business) * business.owned; 
                earnedInThisTick += revenue;
                
                autoCollectEvents.push({
                    businessId: business.id, 
                    businessName: business.name, 
                    revenue,
                    hasManager: business.hasManager,
                    owned: business.owned,
                    upgradeLevel: business.upgradeLevel,
                    cycleTime: cycleTime,
                });

                return { ...business, progress: 0, isRunning: business.hasManager }; 
            } 
            return { ...business, progress: newProgress }; 
        });

        // 3. Batch Update State (Run ONCE per tick)
        setBusinesses(nextBusinesses);

        if (earnedInThisTick > 0) {
            setMoney(m => m + earnedInThisTick);
            setTotalEarned(t => t + earnedInThisTick);
            setLifetimeEarned(l => l + earnedInThisTick);
            
            // 4. Batch Log (Prevents double logs and race conditions)
            const predictedMoney = moneyRef.current + earnedInThisTick;
            
            autoCollectEvents.forEach(evt => {
                logEvent('AUTO_COLLECT', {
                   ...evt,
                   currentMoney: predictedMoney, 
                   newBalance: predictedMoney
                });
            });
        }
        
    }, 50); 
    return () => clearInterval(interval); 
  }, [gameStarted, isPaused]);

  useEffect(() => { if (!gameStarted) return; if (totalEarned >= 1000000 && !unlockedAchievements.has('millionaire')) unlockAchievement('millionaire'); const totalOwned = businesses.reduce((sum, b) => sum + b.owned, 0); if (totalOwned >= 5 && !unlockedAchievements.has('five_businesses')) unlockAchievement('five_businesses'); const totalUpgrades = businesses.reduce((sum, b) => sum + b.upgradeLevel, 0); if (totalUpgrades >= 10 && !unlockedAchievements.has('ten_upgrades')) unlockAchievement('ten_upgrades'); }, [money, totalEarned, businesses, gameStarted, unlockedAchievements]);

  if (!gameStarted) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center p-4 font-sans">
        <div className="bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl p-8 max-w-md w-full">
          <div className="text-center mb-6">
            <h1 className="text-4xl font-bold text-white mb-2">💰 Idle Empire 💰</h1>
            <p className="text-slate-400">Research Edition</p>
          </div>
          <div className="mb-6">
            <label className="block text-slate-300 font-semibold mb-2">Enter Your Name:</label>
            <input type="text" value={userName} onChange={(e) => setUserName(e.target.value)} className="w-full px-4 py-3 bg-slate-700 border-2 border-slate-600 rounded-lg focus:border-blue-500 focus:outline-none transition" placeholder="Your name here..." />
          </div>
          <div className="bg-slate-700/50 p-4 rounded-lg mb-6 text-sm text-slate-300">
            <h3 className="font-bold mb-2 text-white">🎓 Research Study</h3>
            <p>This game collects data about your playing patterns. All data will be saved to a CSV file.</p>
          </div>
          <button onClick={() => { 
              if (userName.trim()) { 
                  // Atomic Start
                  setMoney(4);
                  setTotalEarned(0);
                  setLifetimeEarned(0);
                  setBusinesses(initialBusinesses);
                  setGameStarted(true);
                  
                  // Force Refs
                  moneyRef.current = 4;
                  totalEarnedRef.current = 0;
                  lifetimeEarnedRef.current = 0;
                  businessesRef.current = initialBusinesses;
                  
                  // Clear Log
                  eventLogRef.current = [];
                  setSessionStart(Date.now());
                  
                  logEvent('SESSION_START', { userName }); 
              } else { alert('Please enter your name to begin!'); } 
          }} className="w-full bg-gradient-to-r from-blue-600 to-purple-600 text-white font-bold py-3 rounded-lg hover:from-blue-700 hover:to-purple-700 transition-transform hover:scale-105">Start Playing! 🚀</button>
        </div>
      </div>
    );
  }

  const unlockedAchievementDetails = achievementsList.filter(ach => unlockedAchievements.has(ach.id));

  // GLOBAL INCOME PER SECOND (sum of all businesses)
  const incomePerSecond = businesses.reduce((total, b) => {
  // income only counts if a manager is hired
  if (b.owned === 0 || !b.hasManager) return total;

  const revenue = calculateRevenue(b) * b.owned;
  const cycleTimeSec = calculateTime(b) / 1000;

  return total + revenue / cycleTimeSec;
}, 0);

  return (
    <>
    <style>{`
      @keyframes soft-popup { 
        from { opacity: 0; transform: translateY(20px); } 
        to { opacity: 1; transform: translateY(0); } 
      } 
      .animate-soft-popup { 
        animation: soft-popup 0.5s ease-out forwards; 
      }
      
      /* Business Animations */
      @keyframes fill-jug {
        0% { transform: scaleY(0); transform-origin: bottom; }
        100% { transform: scaleY(1); transform-origin: bottom; }
      }
      @keyframes open-newspaper {
        0% { transform: rotateY(0deg); }
        50% { transform: rotateY(90deg); }
        100% { transform: rotateY(180deg); }
      }
      @keyframes spin-wheels {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
      @keyframes deliver-pizza {
        0%, 100% { transform: translateX(0); }
        50% { transform: translateX(10px); }
      }
      @keyframes flash-arcade {
        0%, 100% { opacity: 1; filter: brightness(1); }
        50% { opacity: 0.7; filter: brightness(1.5); }
      }
      @keyframes play-movie {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.1); }
      }
      @keyframes count-money {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-5px); }
      }
      @keyframes pump-oil {
        0%, 100% { transform: translateY(0) scaleY(1); }
        50% { transform: translateY(-3px) scaleY(0.95); }
      }
      @keyframes fly-plane {
        0% { transform: translateX(-10px) translateY(5px); }
        50% { transform: translateX(10px) translateY(-5px); }
        100% { transform: translateX(-10px) translateY(5px); }
      }
      @keyframes orbit-space {
        from { transform: rotate(0deg) translateX(5px) rotate(0deg); }
        to { transform: rotate(360deg) translateX(5px) rotate(-360deg); }
      }
      
      .animate-lemonade { animation: fill-jug 2s ease-in-out infinite; }
      .animate-newspaper { animation: open-newspaper 3s ease-in-out infinite; }
      .animate-carwash { animation: spin-wheels 1.5s linear infinite; }
      .animate-pizza { animation: deliver-pizza 2s ease-in-out infinite; }
      .animate-arcade { animation: flash-arcade 1s ease-in-out infinite; }
      .animate-cinema { animation: play-movie 2.5s ease-in-out infinite; }
      .animate-bank { animation: count-money 1.8s ease-in-out infinite; }
      .animate-oilrig { animation: pump-oil 2s ease-in-out infinite; }
      .animate-airline { animation: fly-plane 4s ease-in-out infinite; }
      .animate-spacestation { animation: orbit-space 5s linear infinite; }
    `}</style>
    <div className="min-h-screen bg-slate-100 font-sans p-4 sm:p-6 lg:p-8">
      <div className="fixed bottom-4 left-4 z-40 space-y-2 max-w-sm">
        {dialogues.map(dialogue => (<div key={dialogue.id} className="bg-white rounded-xl shadow-2xl p-4 border-l-4 border-amber-400 animate-soft-popup"><div className="flex items-start gap-3"><div className="text-3xl mt-1">🤵</div><p className="text-slate-700 font-medium text-sm">{dialogue.message}</p></div></div>))}
      </div>
      <div className="fixed top-4 right-4 z-40 space-y-2 max-w-sm">
        {achievements.map(achievement => (<div key={achievement.id} className="bg-gradient-to-br from-purple-600 to-blue-600 text-white rounded-xl shadow-2xl p-4 border-2 border-yellow-300 animate-soft-popup"><div className="flex items-center gap-3"><div className="text-4xl">{achievement.icon}</div><div className="flex-1"><p className="font-bold text-lg">Achievement Unlocked!</p><p className="font-semibold">{achievement.name}</p><p className="text-xs opacity-90">{achievement.description}</p></div></div></div>))}
      </div>
      
      {showTutorial && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setShowTutorial(false)}>
          <div className="bg-white rounded-2xl p-6 max-w-lg w-full" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-2xl font-bold mb-4 text-gray-800">Welcome, {userName}! 👋</h2>
            <div className="space-y-3 text-gray-700 mb-6"><p>🎯 <strong>Goal:</strong> Build an empire and reach ascension!</p><p>💡 <strong>How to play:</strong></p><ul className="list-disc ml-6 space-y-1"><li>Buy businesses to earn money</li><li>Click Start to begin production</li><li>Money auto-collects when progress fills</li><li>Hire managers to automate</li><li>Upgrade for efficiency</li><li>Reach milestones (10, 25, 50, etc.) for big bonuses!</li><li>Progress is SLOW - strategic choices matter!</li></ul><p>📊 All decisions are tracked for research.</p></div>
            <button onClick={() => setShowTutorial(false)} className="w-full bg-gradient-to-r from-green-500 to-blue-500 text-white font-bold py-3 rounded-lg hover:from-green-600 hover:to-blue-600">Let's Go! 🚀</button>
          </div>
        </div>
      )}
      
      {showAscensionModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setShowAscensionModal(false)}>
          <div className="bg-gradient-to-br from-purple-900 to-blue-900 text-white rounded-2xl p-8 max-w-lg w-full border-4 border-yellow-400" onClick={(e) => e.stopPropagation()}>
            <div className="text-center mb-6">
              <div className="text-6xl mb-4">🌟</div>
              <h2 className="text-3xl font-bold mb-2">ASCENSION</h2>
              <p className="text-purple-200">Transcend your reality</p>
            </div>
            
            <div className="bg-black/30 rounded-lg p-4 mb-6 space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-purple-200">Required Lifetime:</span>
                <span className="text-xl font-bold text-yellow-400">${calculateAscensionCost().toExponential(2)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-purple-200">Your Lifetime:</span>
                <span className="text-xl font-bold text-cyan-400">${lifetimeEarned.toExponential(2)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-purple-200">Current Bonus:</span>
                <span className="text-xl font-bold text-green-400">{ascensionBonus.toFixed(1)}x</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-purple-200">New Bonus:</span>
                <span className="text-xl font-bold text-pink-400">{calculateAscensionBonus().toFixed(1)}x</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-purple-200">Ascensions:</span>
                <span className="text-xl font-bold">{ascensionCount}</span>
              </div>
            </div>
            
            <div className="bg-red-900/50 rounded-lg p-4 mb-6">
              <p className="text-sm text-yellow-200"><strong>⚠️ Warning:</strong> Resets all businesses, upgrades, managers. You keep ascension bonus and start with $4.</p>
            </div>
            
            <div className="flex gap-3">
              <button onClick={() => setShowAscensionModal(false)} className="flex-1 bg-gray-700 text-white font-bold py-3 rounded-lg hover:bg-gray-600 transition">Cancel</button>
              <button onClick={performAscension} disabled={!canAscend()} className="flex-1 bg-gradient-to-r from-yellow-500 to-orange-500 text-white font-bold py-3 rounded-lg hover:from-yellow-600 hover:to-orange-600 transition disabled:opacity-50 disabled:cursor-not-allowed">Ascend! ✨</button>
            </div>
          </div>
        </div>
      )}
      
      <div className="max-w-7xl mx-auto">
        <header className="bg-slate-800 text-white rounded-2xl shadow-lg p-5 mb-8 sticky top-4 z-30">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex-shrink-0"><h1 className="text-2xl font-bold tracking-tight">Idle Empire</h1><p className="text-sm text-slate-400">Player: {userName}</p></div>
            <div className="flex items-center gap-3 sm:gap-4 flex-grow justify-center">
              <div className="text-center"><p className="text-sm font-medium text-slate-400">Balance</p><p className="text-2xl sm:text-3xl font-bold text-green-400">${money.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 3})}</p></div>
              <div className="border-l border-slate-600 h-10"></div>
              <div className="text-center"><p className="text-sm font-medium text-slate-400">Lifetime</p><p className="text-lg sm:text-xl font-semibold text-cyan-400">${lifetimeEarned.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 3})}</p></div>
              {ascensionBonus > 1 && (
                <>
                  <div className="border-l border-slate-600 h-10"></div>
                  <div className="text-center"><p className="text-sm font-medium text-slate-400">Bonus</p><p className="text-lg sm:text-xl font-semibold text-purple-400">{ascensionBonus.toFixed(1)}x</p></div>
                </>
              )}
              <div className="border-l border-slate-600 h-10"></div>
              <div className="text-center">
                <p className="text-sm font-medium text-slate-400">Income/sec</p>
                <p className="text-lg sm:text-xl font-semibold text-amber-500">
                  ${incomePerSecond.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                </p>
              </div>

            </div>
            <div className="flex gap-2">
              <button onClick={() => setIsPaused(!isPaused)} className="p-3 bg-slate-700 rounded-lg hover:bg-slate-600 transition" title={isPaused ? "Resume" : "Pause"}>{isPaused ? <Play size={20} /> : <Pause size={20} />}</button>
              <button onClick={() => { logEvent('BUTTON_CLICK', { button: 'download', action: 'download_data' }); downloadData(); }} className="p-3 bg-slate-700 rounded-lg hover:bg-slate-600 transition" title="Download Data"><Download size={20} /></button>
              <button onClick={() => { logEvent('BUTTON_CLICK', { button: 'ascension_open', canAscend: canAscend() }); setShowAscensionModal(true); }} disabled={!canAscend()} className="p-3 bg-purple-700 rounded-lg hover:bg-purple-600 transition disabled:opacity-50 disabled:cursor-not-allowed" title="Ascension"><Sparkles size={20} /></button>
              <button onClick={() => { logEvent('BUTTON_CLICK', { button: 'reset', action: 'reset_attempt' }); resetGame(); }} className="p-3 bg-red-700/50 text-red-300 rounded-lg hover:bg-red-700/80 hover:text-white transition" title="Reset Game"><RotateCcw size={20} /></button>
            </div>
          </div>
        </header>
        <main className="grid grid-cols-1 lg:grid-cols-3 lg:gap-8">
          <div className="lg:col-span-2 grid gap-5">
            {businesses.map((business) => {
              const cost = calculateCost(business);
              const revenue = calculateRevenue(business);
              const upgradeCost = business.baseCost * 50 * Math.pow(business.upgradeCostMultiplier, business.upgradeLevel);
              const canAfford = money >= cost;
              const canUpgrade = money >= upgradeCost && business.owned > 0;
              const canHireManager = money >= business.managerCost && business.owned > 0 && !business.hasManager;
              const totalRevenue = revenue * business.owned;
              const revenuePerSecond = business.owned > 0 ? totalRevenue / (calculateTime(business) / 1000) : 0;
              
              // Determine animation class
              const getAnimationClass = () => {
                if (!business.isRunning || business.owned === 0) return '';
                const animations: Record<string, string> = {
                  lemonade: 'animate-lemonade',
                  newspaper: 'animate-newspaper',
                  carwash: 'animate-carwash',
                  pizza: 'animate-pizza',
                  arcade: 'animate-arcade',
                  cinema: 'animate-cinema',
                  bank: 'animate-bank',
                  oilrig: 'animate-oilrig',
                  airline: 'animate-airline',
                  spacestation: 'animate-spacestation'
                };
                return animations[business.id] || '';
              };
              
              return (
                <div key={business.id} className="bg-white/80 backdrop-blur-sm rounded-xl shadow-md p-4 transition-all duration-300">
                  <div className="flex items-center gap-4">
                    <div className={`text-5xl flex-shrink-0 w-16 h-16 flex items-center justify-center bg-slate-100 rounded-lg ${getAnimationClass()}`}>{business.icon}</div>
                    <div className="flex-1">
                      <div className="flex justify-between items-start">
                        <div>
                          <h3 className="text-lg font-bold text-slate-800">{business.name}</h3>
                          <p className="text-xs text-slate-500">{business.description}</p>
                          {business.owned > 0 && (
                            <div className="mt-1 space-y-0.5">
                              <p className="text-xs font-semibold text-green-600">
                                💰 ${totalRevenue.toLocaleString()} per cycle
                              </p>
                              <p className="text-xs font-semibold text-blue-600">
                                ⚡ ${revenuePerSecond.toFixed(3)}/sec
                              </p>
                            </div>
                          )}
                        </div>
                        <div className="text-right flex-shrink-0 pl-2"><p className="text-2xl font-bold text-slate-800">{business.owned}</p><p className="text-xs text-slate-500 -mt-1">Owned</p></div>
                      </div>
                      {business.owned > 0 && (
                        <div className="mt-2">
                          <div className="bg-slate-200 rounded-full h-5 overflow-hidden relative group"><div className="bg-green-500 h-full transition-all duration-100" style={{ width: `${Math.min(business.progress, 100)}%` }}></div><div className="absolute inset-0 flex items-center justify-center text-xs font-bold text-white drop-shadow-sm pointer-events-none">{business.isRunning ? `${(revenue * business.owned).toLocaleString()} / ${(calculateTime(business)/1000).toFixed(3
                          )}s` : "Idle"}</div></div>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-2">
                    {business.owned === 0 ? (
                      <button 
                        onClick={() => buyBusiness(business.id)} 
                        disabled={!canAfford} 
                        className={`col-span-full py-3 px-4 flex items-center justify-center gap-2 rounded-lg font-bold transition ${
                          canAfford 
                            ? 'bg-green-500 text-white hover:bg-green-600 shadow-lg' 
                            : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                        }`}
                      >
                        <Plus size={16} /> Buy for ${cost.toLocaleString()}
                      </button>
                    ) : (
                      <>
                        <button 
                          onClick={() => startProduction(business.id)} 
                          disabled={business.isRunning || business.hasManager} 
                          className={`py-2 px-3 flex items-center justify-center gap-2 rounded-lg font-bold transition text-sm ${
                            (!business.isRunning && !business.hasManager)
                              ? 'bg-blue-500 text-white hover:bg-blue-600 shadow-md'
                              : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                          }`}
                        >
                          {business.hasManager ? <User size={16}/> : <Play size={16}/>} 
                          {business.hasManager ? 'Managed' : (business.isRunning ? 'Running' : 'Start')}
                        </button>
                        <button 
                          onClick={() => buyBusiness(business.id)} 
                          disabled={!canAfford} 
                          className={`py-2 px-3 flex items-center justify-center gap-2 rounded-lg font-bold transition text-sm ${
                            canAfford 
                              ? 'bg-green-500 text-white hover:bg-green-600 shadow-md' 
                              : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                          }`}
                        >
                          <Plus size={16} /> ${cost.toLocaleString()}
                        </button>
                        <button 
                          onClick={() => buyUpgrade(business.id)} 
                          disabled={!canUpgrade} 
                          className={`py-2 px-3 flex items-center justify-center gap-2 rounded-lg font-bold transition text-sm ${
                            canUpgrade 
                              ? 'bg-purple-500 text-white hover:bg-purple-600 shadow-md' 
                              : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                          }`}
                        >
                          <TrendingUp size={16} /> ${upgradeCost.toLocaleString()}
                        </button>
                        <button 
                          onClick={() => hireManager(business.id)} 
                          disabled={!canHireManager || business.hasManager} 
                          className={`py-2 px-3 flex items-center justify-center gap-2 rounded-lg font-bold transition text-sm ${
                            canHireManager 
                              ? 'bg-teal-500 text-white hover:bg-teal-600 shadow-md' 
                              : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                          }`}
                        >
                          <Crown size={16} /> ${business.managerCost.toLocaleString()}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <aside className="lg:col-span-1 space-y-6 mt-6 lg:mt-0">
            <aside className="lg:col-span-1 space-y-6 mt-6 lg:mt-0">
            
            {/* 1. EMPIRE SUMMARY (Now on Top) */}
            <div className="bg-white/80 backdrop-blur-sm rounded-xl shadow-md p-5 sticky top-28">
              <h3 className="text-lg font-bold text-slate-800 border-b pb-2 mb-3 flex items-center gap-2"><Building2 size={20}/> Empire Summary</h3>
              {businesses.filter(b => b.owned > 0).length > 0 ? (<ul className="space-y-2 text-sm">{businesses.filter(b => b.owned > 0).map(b => (<li key={b.id} className="flex justify-between items-center text-slate-600"><span className="font-medium flex items-center gap-2">{b.icon} {b.name}</span><span className="font-bold text-slate-800">x{b.owned}</span></li>))}</ul>) : (<p className="text-sm text-slate-500 text-center py-4">Buy a business to start!</p>)}
            </div>

            {/* 2. ACHIEVEMENTS (Now on Bottom) */}
            {/* Changed top-28 to top-80 so it sticks below the summary */}
            <div className="bg-white/80 backdrop-blur-sm rounded-xl shadow-md p-5 sticky top-80">
              <h3 className="text-lg font-bold text-slate-800 border-b pb-2 mb-3 flex items-center gap-2"><Target size={20}/> Achievements</h3>
              {unlockedAchievementDetails.length > 0 ? (<ul className="space-y-3 max-h-60 overflow-y-auto pr-2">{unlockedAchievementDetails.map(ach => (<li key={ach.id} className="flex items-center gap-3 bg-slate-100 p-2 rounded-lg"><span className="text-3xl">{ach.icon}</span><div><p className="font-bold text-sm text-slate-700">{ach.name}</p><p className="text-xs text-slate-500">{ach.description}</p></div></li>))}</ul>) : (<p className="text-sm text-slate-500 text-center py-4">No achievements yet. Keep going!</p>)}
            </div>

          </aside>
            
          </aside>
        </main>
      </div>
    </div>
    </>
  );
};
export default IdleEmpireGame;