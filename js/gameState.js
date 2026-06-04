// gameState.js — owns the mutable game state and derived helpers.
import { RESOURCES } from './data/resources.js';
import { BUILDINGS } from './data/buildings.js';
import { POWER }     from './data/power.js';
import { TECH }      from './data/tech.js';
import { MODULES }   from './data/modules.js';
import { MapGen }    from './map.js';
import { STAT_WINDOWS } from './config.js';

export const GameState = {
  state: null,
  nextId: 1,

  // build a brand-new state object (with a freshly generated map)
  fresh() {
    const s = {
      version: 2,
      launches: 0,
      launchBonus: 1,
      resources: {},
      map: MapGen.generate(Date.now()),
      entities: [],    // [{id, type, x, y, recipe, modules:[]}] — buildings placed on the map
      research: { done: [], current: null, progress: 0 },
      modulesUnlocked: false,
      rocketUnlocked: false,
      lastTick: Date.now(),
      lastSave: Date.now(),
      totals: { produced: {}, consumed: {} },
      // per-window production samples. buf: winId -> resKey -> avg net/sec ring
      // buffer; acc/ticks accumulate the current bucket. Not persisted (rebuilt
      // each session). Resources that never flow get no buffer.
      stats: {
        win: STAT_WINDOWS[0].id,
        buf:   Object.fromEntries(STAT_WINDOWS.map(w => [w.id, {}])),
        acc:   Object.fromEntries(STAT_WINDOWS.map(w => [w.id, {}])),
        ticks: Object.fromEntries(STAT_WINDOWS.map(w => [w.id, 0])),
      },
    };
    for (const k in RESOURCES) { s.resources[k] = 0; }
    // a small starting hand so the first drill + furnace can be built
    s.resources.ironPlate = 20;
    s.resources.stone = 10;
    this.state = s;
    this.nextId = 1;
    return s;
  },

  def(type)  { return BUILDINGS[type] || POWER[type]; },        // unified building/generator lookup
  placedOf(type) { return this.state.entities.filter(e => e.type === type).length; },

  // is the footprint at (x,y) free of other entities? (2×2 default)
  free(x, y, w = 2, h = 2, ignore = null) {
    if (y < 0 || y + h > this.state.map.height || x < 0) return false;
    for (const e of this.state.entities) {
      if (e === ignore) continue;
      const d = this.def(e.type); const ew = d.w || 2, eh = d.h || 2;
      if (x < e.x + ew && x + w > e.x && y < e.y + eh && y + h > e.y) return false;
    }
    return true;
  },

  // beacon speed bonus applied to an entity whose footprint sits at (x,y)
  beaconSpeedAt(x, y) {
    let bonus = 0;
    for (const e of this.state.entities) {
      if (e.type !== 'beacon') continue;
      const def = BUILDINGS.beacon, R = def.radius || 3;
      // Chebyshev distance between the two 2×2 footprints' tile ranges
      const dx = Math.max(0, Math.max(e.x - (x + 1), x - (e.x + 1)));
      const dy = Math.max(0, Math.max(e.y - (y + 1), y - (e.y + 1)));
      if (Math.max(dx, dy) > R) continue;
      for (const m of (e.modules || [])) {
        const mod = m && MODULES[m];
        if (mod && mod.speed > 0) bonus += mod.speed * 0.5;   // beacons apply half effect, like Factorio
      }
    }
    return bonus;
  },

  // global speed / yield multipliers from completed research (+ prestige bonus)
  multipliers() {
    let speed = 1, yld = 1;
    for (const t of this.state.research.done) {
      const e = TECH[t] && TECH[t].effect;
      if (!e) continue;
      if (e.globalSpeed) speed += e.globalSpeed;
      if (e.globalYield) yld += e.globalYield;
    }
    return { speed, yield: yld * this.state.launchBonus };
  },

  isBuildingUnlocked(key) {
    const u = BUILDINGS[key].unlock;
    if (!u) return true;
    return this.state.research.done.includes(u);
  },
  isPowerUnlocked(key) {
    const u = POWER[key].unlock;
    return !u || this.state.research.done.includes(u);
  },
  // true once any power generator has been unlocked by research — the "electric era".
  // Before that there is no power grid, so the energy widget is hidden and
  // buildings are not throttled by a power deficit.
  powerUnlocked() {
    for (const k in POWER) if (this.isPowerUnlocked(k)) return true;
    return false;
  },
};
