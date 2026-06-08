 // config.js — tunable constants for the engine and economy.
export const TICK_MS    = 50;           // 20 ticks per second (finer steps ⇒ smoother progress bars)
export const TICK_SEC   = TICK_MS / 1000;
export const SAVE_KEY   = 'factorio_idle_save';
export const SAVE_EVERY = 10000;        // autosave interval (ms)
export const OFFLINE_MAX = 8 * 3600;    // max offline seconds credited
export const OFFLINE_RATE = 0.5;        // offline production multiplier (debuff)
// production-graph windows. Each keeps its own ring buffer sampled at `every`
// seconds (averaged over that interval), so longer spans stay cheap: points =
// min*60/every. `every` must be a whole number of ticks (every / TICK_SEC).
export const STAT_WINDOWS = [
  { id: '5m',  min: 5,   every: 3   },   // 100 points
  { id: '15m', min: 15,  every: 10  },   //  90 points
  { id: '1h',  min: 60,  every: 30  },   // 120 points
  { id: '4h',  min: 240, every: 120 },   // 120 points
];
export const ROCKET_GOAL = 100;         // rocket parts required to launch

// ---------------------------------------------------------------------------
// BALANCE — central tuning knobs for the engine & economy. Per-item coefficients
// (contrib / costMul / capacity / baseCost) live in their data tables
// (data/upgrades.js etc.); the scalars here are the ones the engine reads directly.
// ---------------------------------------------------------------------------
export const BALANCE = {
  storageBase:     100,   // starting cap for SOLID resources (chests raise it)
  fluidBase:       100,   // starting cap for FLUIDS (only the storage tank raises it)
  minSpeed:        0.05,  // floor on a building's effective craft speed
  minEnergyFactor: 0.1,   // floor on a machine's energy draw after efficiency modules
  beaconEffect:    0.5,   // fraction of a module's effect a beacon transmits (vanilla = half)
  researchSeconds: 8,     // seconds of lab throughput that fund one full unit of research cost
  labCraftSec:     2,     // base seconds for one lab research cycle (one progress-bar fill)
  rocketBonus:     1.5,   // permanent production multiplier per rocket launched (prestige)
  // per-category craft-speed multiplier. Extractors (mine/oil/pump) keep ore output
  // unchanged; assemblers (craft) and furnaces (smelt) run at half speed; labs run at
  // half speed too (slower, deliberate research). Any cat not listed here defaults to 1.
  catSpeed: { craft: 0.5, smelt: 0.5, lab: 0.5 },
};

// ---------------------------------------------------------------------------
// WAR — biter assault on the war screen. The factory emits POLLUTION while it
// works; once pollution passes `pollutionTrigger`, biters attack in waves whose
// size and strength scale with how polluted the air is. They chew through anything
// in the way (walls last) to reach the factory — the moment one crosses into the
// factory the run ends. Gun turrets auto-reload firearm magazines from the pool.
// ---------------------------------------------------------------------------
export const WAR = {
  pollutionTrigger: 45,      // pollution level at which the assault begins
  absorbFlat:       1.2,     // pollution/sec nature absorbs (a small/burner factory stays clean)
  pollutionMax:     900,     // cap so waves can't become literally infinite
  emitPerEnergy:    0.30,    // pollution/sec per MW drawn by an active machine
  emitBase:         0.10,    // pollution/sec per active machine (covers burners)
  intensityScale:   130,     // pollution-over-trigger that equals one "intensity" unit

  basePop:    4,             // biters on the field right at the trigger
  popPerInt:  8,             // extra biters per intensity unit
  maxPop:     70,
  biterBaseHp:   20,
  biterHpPerInt: 22,         // tougher biters as pollution climbs
  biterSpeed:    1.0,
  biterDps:       5,         // damage/sec a biter deals to a building it claws

  wallHp:   220,
  turretHp: 140,
  turretRange:      7.5,     // tiles
  turretDps:        40,      // damage/sec to the focused biter
  turretAmmoMax:    20,      // magazines a turret holds
  turretAmmoPerSec: 0.40,    // magazines burned per second of firing
  prestigePerRun:   0.04,    // sqrt(items produced) × this = prestige points earned
  prestigeBonus:    0.01,    // +1% global output per accumulated prestige point
};
