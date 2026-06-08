// gameState.js — owns the mutable game state and derived helpers.
import { RESOURCES } from './data/resources.js';
import { RECIPES, HANDCRAFT_ONLY } from './data/recipes.js';
import { BUILDINGS, BUILDING_ITEMS } from './data/buildings.js';
import { POWER }     from './data/power.js';
import { TECH }      from './data/tech.js';
import { MODULES }   from './data/modules.js';
import { UPGRADES, STORAGE_BASE, FLUID_BASE, FLUIDS } from './data/upgrades.js';
import { MapGen }    from './map.js';
import { STAT_WINDOWS, BALANCE, WAR } from './config.js';

const PRESTIGE_KEY = 'factorio_idle_prestige';   // persists across runs (survives a wipe)

export const GameState = {
  state: null,
  nextId: 1,

  // build a brand-new state object (with a freshly generated map)
  fresh() {
    const s = {
      version: 4,
      launches: 0,
      launchBonus: 1,
      prestige: this.loadPrestige(),   // accumulated across runs → permanent global bonus
      pollution: 0,                    // factory emissions hanging over the front
      over: false,                     // set true when biters reach the factory (run lost)
      resources: {},
      map: MapGen.generate(Date.now()),
      entities: [],    // [{id, type, x, y, recipe, modules:[]}] — buildings placed on the map
      cleared: {},     // "x,y" -> 1 for obstacles (trees/rocks) the player has removed
      research: { done: [], current: null, progress: 0 },
      modulesUnlocked: false,
      rocketUnlocked: false,
      lastTick: Date.now(),
      lastSave: Date.now(),
      totals: { produced: {}, consumed: {} },
      // manual-craft upgrade ranks (BALANCE.md §3/§15): item key -> rank (0+).
      // Manipulators feed M.speed, conveyors feed M.yield via multipliers().
      upgrades: Object.fromEntries(Object.keys(UPGRADES).map(k => [k, 0])),
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
    // a starting hand so the first drills + furnaces can be built
    s.resources.ironPlate = 100;
    s.resources.copperPlate = 100;
    s.resources.stone = 10;
    this.state = s;
    this.nextId = 1;
    this.setupWarScreen(s);
    return s;
  },

  // initial war-screen layout: a one-tile-thick wall across the top of the war screen
  // and a single gun turret centred just behind it, pre-loaded with 20 ammo magazines.
  setupWarScreen(s) {
    const wallY = MapGen.wallRow();
    for (let x = 0; x < s.map.width; x++)
      s.entities.push({ id: this.nextId++, type: 'stoneWall', x, y: wallY, recipe: null, modules: [] });
    const tx = Math.floor(s.map.width / 2) - 1;
    s.entities.push({ id: this.nextId++, type: 'gunTurret', x: tx, y: wallY + 1, recipe: null, modules: [], ammo: WAR.turretAmmoMax });
  },

  // ---------------- prestige (persists across runs) & the war's game-over ----------
  loadPrestige() { try { return +localStorage.getItem(PRESTIGE_KEY) || 0; } catch (e) { return 0; } },
  savePrestige(v) { try { localStorage.setItem(PRESTIGE_KEY, String(v)); } catch (e) {} },
  prestigeMult() { return 1 + (this.state ? this.state.prestige : this.loadPrestige()) * WAR.prestigeBonus; },

  // total items the factory produced this run → prestige points earned on a loss
  runOutput() {
    let sum = 0; const p = this.state.totals.produced;
    for (const k in p) sum += p[k];
    return sum;
  },
  prestigeEarned() { return Math.floor(Math.sqrt(Math.max(0, this.runOutput())) * WAR.prestigePerRun); },

  // the biters broke into the factory: end the run, bank prestige, freeze the sim.
  endRun() {
    if (this.state.over) return 0;
    this.state.over = true;
    const earned = this.prestigeEarned();
    this.state.prestige += earned;
    this.savePrestige(this.state.prestige);
    return earned;
  },

  // max HP of a destructible structure (walls/turrets); 0 = not a war target
  maxHp(type) {
    if (type === 'stoneWall') return WAR.wallHp;
    if (type === 'gunTurret') return WAR.turretHp;
    return 0;
  },
  isMilitary(type) { const d = BUILDINGS[type]; return !!(d && d.military); },
  removeEntity(ent) {
    const a = this.state.entities, i = a.indexOf(ent);
    if (i >= 0) a.splice(i, 1);
  },

  def(type)  { return BUILDINGS[type] || POWER[type]; },        // unified building/generator lookup
  // a recipe is craftable once its unlocking technology is researched (none ⇒ from start)
  recipeUnlocked(rk) {
    const r = RECIPES[rk];
    return !r || !r.tech || this.state.research.done.includes(r.tech);
  },
  placedOf(type) { return this.state.entities.filter(e => e.type === type).length; },

  // an uncleared obstacle (tree/rock) at this tile, or null
  obstacleAt(x, y) {
    if (this.state.cleared[x + ',' + y]) return null;
    return MapGen.obstacleAt(this.state.map, x, y);
  },

  // is the footprint at (x,y) free of other entities AND obstacles? (2×2 default)
  free(x, y, w = 2, h = 2, ignore = null) {
    // y may be negative on the war screen; zone/placement rules are enforced by the caller
    if (x < 0 || x + w > this.state.map.width) return false;
    for (let dx = 0; dx < w; dx++) for (let dy = 0; dy < h; dy++) {
      if (this.obstacleAt(x + dx, y + dy)) return false;            // can't build on trees/rocks
      if (MapGen.waterAt(this.state.map, x + dx, y + dy)) return false;  // can't build on water
    }
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
        if (mod && mod.speed > 0) bonus += mod.speed * BALANCE.beaconEffect;   // beacons transmit a fraction (vanilla = half)
      }
    }
    return bonus;
  },

  // ---------------- manual-craft upgrades (BALANCE.md §3, §15, §16) ----------------
  // true if this item is a manual-craft bonus upgrade — such items must NOT be
  // produced by assemblers (they only exist as ranks bought in the craft window).
  isUpgradeItem(key) { return !!UPGRADES[key]; },
  // true if this item is a placeable structure (BUILDINGS/POWER) — such items are
  // built on the map via baseCost, so assemblers must NOT mass-produce them.
  isBuildingItem(key) { return BUILDING_ITEMS.has(key); },
  // true if this item is a personal weapon or armor — these are hand-crafted only,
  // so assemblers must NOT mass-produce them (ammo/shells are still allowed).
  isHandcraftItem(key) { return HANDCRAFT_ONLY.has(key); },
  upgradeRank(id) { return (this.state.upgrades && this.state.upgrades[id]) || 0; },
  // an upgrade item can be ranked up once its (resource) recipe is researched
  upgradeUnlocked(id) { return !!UPGRADES[id] && this.recipeUnlocked(id); },
  // cost of the NEXT rank: baseCost × costMul^rank
  upgradeCost(id) {
    const def = UPGRADES[id]; if (!def) return {};
    const mul = Math.pow(def.costMul, this.upgradeRank(id)), c = {};
    for (const r in def.baseCost) c[r] = def.baseCost[r] * mul;
    return c;
  },
  canAffordUpgrade(id) {
    const c = this.upgradeCost(id), s = this.state;
    for (const r in c) if ((s.resources[r] || 0) < Math.ceil(c[r])) return false;
    return true;
  },
  // pay for and apply one rank; returns true on success
  craftUpgrade(id) {
    if (!this.upgradeUnlocked(id) || !this.canAffordUpgrade(id)) return false;
    const c = this.upgradeCost(id), s = this.state;
    for (const r in c) s.resources[r] = Math.max(0, (s.resources[r] || 0) - Math.ceil(c[r]));
    s.upgrades[id] = this.upgradeRank(id) + 1;
    return true;
  },
  // Σ(contrib × rank) over every upgrade that feeds the given bonus channel.
  effectSum(effect) {
    let sum = 0;
    for (const id in UPGRADES) if (UPGRADES[id].effect === effect) sum += (UPGRADES[id].contrib || 0) * this.upgradeRank(id);
    return sum;
  },
  craftMult()        { return 1 + this.effectSum('speed'); },        // manipulators + speed modules
  flowMult()         { return 1 + this.effectSum('yield'); },        // conveyors + productivity modules
  researchMult()     { return 1 + this.effectSum('research'); },     // radar + combinators → lab speed
  powerSupplyMult()  { return 1 + this.effectSum('powerSupply'); },  // poles → ×produced MW
  powerConsumeMult() { return 1 / (1 + this.effectSum('powerSave')); }, // efficiency module → ÷consumed MW
  // solid-resource cap (BALANCE §5): base + Σ(chest capacity × rank)
  storageCap() {
    let cap = STORAGE_BASE;
    for (const id in UPGRADES) if (UPGRADES[id].effect === 'storage') cap += (UPGRADES[id].cap || 0) * this.upgradeRank(id);
    return cap;
  },
  // fluid cap: base + Σ(storage-tank capacity × rank). Chests do NOT help fluids.
  fluidCap() {
    let cap = FLUID_BASE;
    for (const id in UPGRADES) if (UPGRADES[id].effect === 'fluidStorage') cap += (UPGRADES[id].cap || 0) * this.upgradeRank(id);
    return cap;
  },
  // the cap that applies to one resource: science packs uncapped, fluids on their own
  // track (storage tank), everything else on the solid track (chests).
  capFor(key) {
    if (/Science$/.test(key)) return Infinity;
    return FLUIDS.has(key) ? this.fluidCap() : this.storageCap();
  },

  // global speed / yield multipliers from completed research (+ prestige bonus +
  // manual-craft upgrades: manipulators/speed-modules add to speed, conveyors/
  // productivity-modules add to yield — §16 B).
  multipliers() {
    let speed = 1, yld = 1;
    for (const t of this.state.research.done) {
      const e = TECH[t] && TECH[t].effect;
      if (!e) continue;
      if (e.globalSpeed) speed += e.globalSpeed;
      if (e.globalYield) yld += e.globalYield;
    }
    speed += this.craftMult() - 1;     // manipulators + speed modules
    yld   += this.flowMult()  - 1;     // conveyors + productivity modules
    return { speed, yield: yld * this.state.launchBonus * this.prestigeMult() };
  },

  // number of same-type entities whose footprint shares an edge with `ent` (nuclear neighbors)
  adjacentSameType(ent) {
    const d = this.def(ent.type); if (!d) return 0;
    const w = d.w || 2, h = d.h || 2;
    const ax1 = ent.x, ax2 = ent.x + w, ay1 = ent.y, ay2 = ent.y + h;
    let c = 0;
    for (const o of this.state.entities) {
      if (o === ent || o.id === ent.id || o.type !== ent.type) continue;
      const od = this.def(o.type); const ow = od.w || 2, oh = od.h || 2;
      const bx1 = o.x, bx2 = o.x + ow, by1 = o.y, by2 = o.y + oh;
      const edgeX = (ax2 === bx1 || bx2 === ax1) && Math.max(ay1, by1) < Math.min(ay2, by2);
      const edgeY = (ay2 === by1 || by2 === ay1) && Math.max(ax1, bx1) < Math.min(ax2, bx2);
      if (edgeX || edgeY) c++;
    }
    return c;
  },

  // total research throughput from all placed labs (× lab speed, beacons, research techs)
  labSpeed() {
    const labDef = BUILDINGS.lab; if (!labDef) return 0;
    let sum = 0;
    for (const e of this.state.entities)
      if (e.type === 'lab') sum += labDef.speed * (1 + this.beaconSpeedAt(e.x, e.y));
    return sum * this.multipliers().speed * this.researchMult();
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
