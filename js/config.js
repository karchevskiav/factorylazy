// config.js — tunable constants for the engine and economy.
export const TICK_MS    = 200;          // 5 ticks per second
export const TICK_SEC   = TICK_MS / 1000;
export const SAVE_KEY   = 'factorio_idle_save';
export const SAVE_EVERY = 10000;        // autosave interval (ms)
export const OFFLINE_MAX = 8 * 3600;    // max offline seconds credited
export const OFFLINE_RATE = 0.5;        // offline production multiplier (debuff)
export const HIST_LEN   = 1500;         // history samples (~5 min @ 5/s)
export const ROCKET_GOAL = 100;         // rocket parts required to launch
