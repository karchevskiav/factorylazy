// config.js — tunable constants for the engine and economy.
export const TICK_MS    = 200;          // 5 ticks per second
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
