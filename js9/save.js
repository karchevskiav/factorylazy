// save.js — localStorage persistence + offline progress.
import { GameState } from './gameState.js';
import { RESOURCES } from './data/resources.js';
import { Production } from './production.js';
import { MapGen }    from './map.js';
import { SAVE_KEY, OFFLINE_MAX, OFFLINE_RATE } from './config.js';

export const Save = {
  save() {
    const s = GameState.state;
    s.lastTick = Date.now();
    s.lastSave = Date.now();
    const { stats, ...persist } = s;     // graph buffers are session-only, never persisted
    // strip transient combat fields (turret target ref) so they don't bloat the save
    persist.entities = s.entities.map(({ _aim, _crafting, _progress, _faceAngle, ...keep }) => keep);
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(persist)); } catch (e) { /* quota / private mode */ }
  },

  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  },

  wipe() { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} },

  // is this save compatible with the current (map-based) engine?
  compatible(loaded) { return loaded && loaded.version >= 4 && loaded.map && Array.isArray(loaded.entities); },

  // merge a loaded save onto a fresh structure so new fields are never missing.
  // The map is regenerated deterministically from the stored seed.
  hydrate(loaded) {
    const s = GameState.fresh();
    if (loaded.map && loaded.map.seed != null) s.map = MapGen.generate(loaded.map.seed);
    Object.assign(s.resources, loaded.resources || {});
    s.entities = (loaded.entities || []).map(e => ({
      id: e.id, type: e.type, x: e.x, y: e.y,
      recipe: e.recipe, modules: e.modules || [], _progress: 0,
      ...(e.hp != null ? { hp: e.hp } : {}),       // keep structure damage
      ...(e.ammo != null ? { ammo: e.ammo } : {}), // keep turret ammo
    }));
    GameState.nextId = (s.entities.reduce((m, e) => Math.max(m, e.id || 0), 0) || 0) + 1;
    s.cleared         = loaded.cleared || {};      // obstacles the player already removed
    s.research        = loaded.research || s.research;
    if (!s.research.done) s.research.done = [];
    s.launches        = loaded.launches || 0;
    s.launchBonus     = loaded.launchBonus || 1;
    s.modulesUnlocked = !!loaded.modulesUnlocked;
    s.rocketUnlocked  = !!loaded.rocketUnlocked;
    s.totals          = loaded.totals || { produced: {}, consumed: {} };
    if (loaded.upgrades) Object.assign(s.upgrades, loaded.upgrades);   // manual-craft ranks
    s.pollution       = loaded.pollution || 0;     // standing pollution drives the waves
    s.over            = false;                     // a resumed run is never already-lost
    s.lastTick        = loaded.lastTick || Date.now();
    GameState.state = s;
    return s;
  },

  // simulate elapsed offline time. Returns {hours, gains} or null for short gaps.
  applyOffline() {
    const s = GameState.state;
    let dt = (Date.now() - (s.lastTick || Date.now())) / 1000;
    if (dt < 60) return null;
    dt = Math.min(dt, OFFLINE_MAX);

    const before = {};
    for (const k in RESOURCES) before[k] = s.resources[k] || 0;

    const pollutionBefore = s.pollution || 0;     // offline grants resources, not a war spike
    const chunk = 5; // coarse 5-second steps
    for (let t = 0; t < dt; t += chunk) Production.step(Math.min(chunk, dt - t), OFFLINE_RATE);
    s.pollution = pollutionBefore;

    const gains = {};
    for (const k in RESOURCES) {
      const d = (s.resources[k] || 0) - before[k];
      if (d > 0.5) gains[k] = d;
    }
    return { hours: dt / 3600, gains };
  },
};
