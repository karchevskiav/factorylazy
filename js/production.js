// production.js — the simulation core. Runs every tick; reused for offline catch-up.
// Buildings are individual entities placed on the map; resources live in one shared pool.
import { GameState } from './gameState.js';
import { RESOURCES } from './data/resources.js';
import { RECIPES }   from './data/recipes.js';
import { BUILDINGS } from './data/buildings.js';
import { POWER }     from './data/power.js';
import { MODULES }   from './data/modules.js';
import { TICK_SEC, BALANCE, WAR } from './config.js';
import { Research }  from './research.js';

export const Production = {
  order: null,

  // entities ordered so low-tier recipes resolve before consumers in the same tick
  ordered() {
    const ents = GameState.state.entities;
    const tierOf = (e) => {
      const r = e.recipe && RESOURCES[e.recipe];
      return r ? r.tier : 99;            // generators/beacons (no recipe) sort last
    };
    return [...ents].sort((a, b) => tierOf(a) - tierOf(b));
  },

  // aggregate own-module effect for one entity
  modEffect(ent) {
    let speed = 0, yld = 0, energy = 0;
    for (const m of (ent.modules || [])) {
      if (MODULES[m]) { speed += MODULES[m].speed; yld += MODULES[m].yield; energy += MODULES[m].energy; }
    }
    return { speed, yld, energy };
  },

  // current power production & consumption (MW). Returns the ratio applied to consumers.
  power() {
    const s = GameState.state;
    // pre-electric era: no power generators unlocked yet → no grid, no throttling
    if (!GameState.powerUnlocked()) return { produced: 0, consumed: 0, ratio: 1 };
    let produced = 0, consumed = 0;
    const M = GameState.multipliers();

    // every generator type contributes MW; fuel-burners (steam/nuclear) scale by available fuel
    for (const k in POWER) {
      const ents = s.entities.filter(e => e.type === k);
      const n = ents.length; if (!n) continue;
      const def = POWER[k];
      // total MW-units: 1 per generator, plus the neighbor bonus for reactors in a cluster
      let units = n;
      if (def.neighborBonus) {
        units = 0;
        for (const e of ents) units += 1 + def.neighborBonus * GameState.adjacentSameType(e);
      }
      if (def.fuel) {
        const need = n * def.fuelPerSec * TICK_SEC;   // fuel scales with count, not with the bonus
        const have = s.resources[def.fuel] || 0;
        const ratio = need > 0 ? Math.min(1, have / need) : 1;
        s.resources[def.fuel] = Math.max(0, have - need * ratio);
        produced += units * def.mw * ratio;
      } else {
        produced += units * def.mw;
      }
    }

    // consumption from every powered entity that is actively working this tick:
    // a machine only draws power while it has a craft in progress (or could start one),
    // a lab only while it can fund a research cycle, beacons whenever placed. Idle
    // machines (starved of inputs, output capped, nothing to research) draw nothing.
    for (const e of s.entities) {
      const def = GameState.def(e.type);
      if (!def || !def.energy) continue;
      if (!this.busy(e, def)) continue;
      const me = this.modEffect(e);
      let draw = def.energy * Math.max(BALANCE.minEnergyFactor, 1 + me.energy);
      // a faster machine does proportionally more work per second, so it draws
      // proportionally more power — speed from manipulators/research/speed modules/
      // beacons is NOT a free efficiency win. (Beacons don't craft → flat draw.)
      if (def.cat !== 'beacon') {
        const speedFactor = M.speed + me.speed + GameState.beaconSpeedAt(e.x, e.y);
        draw *= Math.max(BALANCE.minEnergyFactor, speedFactor);
      }
      consumed += draw;
    }
    // manual-craft bonuses: poles raise effective supply, efficiency modules cut draw
    produced *= GameState.powerSupplyMult();
    consumed *= GameState.powerConsumeMult();
    const ratio = consumed > 0 ? Math.min(1, produced / consumed) : 1;
    return { produced, consumed, ratio };
  },

  // accumulate factory POLLUTION: every actively-working machine emits (more if it
  // draws a lot of power); standing pollution is slowly absorbed, so it settles at a
  // level proportional to how hard the factory is running. Drives the biter waves.
  pollute(dt, pwr) {
    const s = GameState.state;
    let emit = 0;
    for (const e of s.entities) {
      const def = GameState.def(e.type);
      if (!def || !this.busy(e, def)) continue;            // only working machines pollute
      emit += WAR.emitBase + WAR.emitPerEnergy * (def.energy || 0);
    }
    s.pollutionRate = emit;                                   // for the readout
    // flat absorption: a small factory (emit < absorbFlat) stays clean; once industry
    // outpaces nature the surplus accumulates and the war escalates. Capped so it's finite.
    s.pollution = Math.max(0, Math.min(WAR.pollutionMax, s.pollution + (emit - WAR.absorbFlat) * dt));
  },

  // resolve an entity's effective recipe: extractors (miner/pumpjack/offshore pump)
  // behave as a 1-second, input-free craft of one unit of their raw resource. Returns
  // null for anything that can't or shouldn't run in the production loop.
  recipeFor(e, def) {
    const cat = def.cat;
    if (cat === 'mine' || cat === 'oil' || cat === 'pump') return { out: 1, time: 1, inputs: {} };
    const rec = RECIPES[e.recipe];
    if (!rec || !GameState.recipeUnlocked(e.recipe)) return null;
    if (GameState.isUpgradeItem(e.recipe)) return null;     // bonus items: manual-craft window only
    if (GameState.isBuildingItem(e.recipe)) return null;    // buildings are placed, never mass-produced
    if (GameState.isHandcraftItem(e.recipe)) return null;   // weapons/armor are hand-crafted only
    return rec;
  },

  // is this powered entity actively working this tick? Used to gate power draw:
  // only machines with a craft in progress (or able to start one) consume electricity.
  busy(e, def) {
    const s = GameState.state;
    const cat = def.cat;
    if (BUILDINGS[e.type] && cat === 'beacon') return true;   // beacons always draw
    if (cat === 'lab') return Research.labBusy(e);
    if (!e.recipe) return false;
    const rec = this.recipeFor(e, def);
    if (!rec) return false;
    if (e._crafting) return true;                             // mid-craft: keep drawing
    for (const ing in rec.inputs) if ((s.resources[ing] || 0) < rec.inputs[ing]) return false;
    const cap = GameState.capFor(e.recipe);
    if (isFinite(cap) && (s.resources[e.recipe] || 0) >= cap) return false;
    return true;
  },

  // one production step over `dt` seconds; `mult` is a global rate multiplier (offline debuff).
  //
  // DISCRETE craft model: a building consumes a recipe's inputs at the START of a craft,
  // advances a per-entity `_progress` bar (0→1) at its craft speed, and emits the output
  // ONLY when that bar fills. Power-starved machines advance proportionally slower.
  step(dt, mult) {
    const s = GameState.state;
    if (s.over) return { net: {}, pwr: this.lastPwr || { produced: 0, consumed: 0, ratio: 1 } };
    const M = GameState.multipliers();
    const pwr = this.power();
    this.lastPwr = pwr;
    this.pollute(dt, pwr);
    const net = {};  // per-resource net change this step (for /sec readouts & history)

    for (const e of this.ordered()) {
      const def = GameState.def(e.type);
      if (!def || !e.recipe) continue;                 // generators / beacons make nothing
      const rec = this.recipeFor(e, def);
      if (!rec) continue;
      const me = this.modEffect(e);
      const catMul = (BALANCE.catSpeed && BALANCE.catSpeed[def.cat]) || 1;   // assemblers/furnaces/labs run slower; ore unaffected
      const speedMul = Math.max(BALANCE.minSpeed, def.speed * catMul * (M.speed + me.speed + GameState.beaconSpeedAt(e.x, e.y)));

      // only electric machines (def.energy > 0) are throttled by the grid; burner
      // drills/furnaces (energy 0) keep running on fuel even with no power.
      const powerFactor = def.energy > 0 ? pwr.ratio : 1;

      const perOut = rec.out * (M.yield + me.yld);
      const cap = GameState.capFor(e.recipe);
      let budget = speedMul / rec.time * dt * mult * powerFactor;   // craft-progress available this tick
      const budgetStart = budget;                                   // for the smooth /sec flow readout
      let guard = 0;

      while (budget > 0 && guard++ < 100000) {
        // bulk fast-path: at a clean craft boundary with ≥1 full craft of headroom,
        // start+finish many crafts at once (keeps offline catch-up cheap).
        if (!e._crafting && (e._progress || 0) === 0 && budget >= 1) {
          let n = Math.floor(budget);
          for (const ing in rec.inputs) {
            const can = Math.floor((s.resources[ing] || 0) / rec.inputs[ing]);
            if (can < n) n = can;
          }
          if (isFinite(cap) && perOut > 0) {
            const can = Math.floor(Math.max(0, cap - (s.resources[e.recipe] || 0)) / perOut);
            if (can < n) n = can;
          }
          if (n > 0) {
            for (const ing in rec.inputs) {
              const used = rec.inputs[ing] * n;
              s.resources[ing] = Math.max(0, (s.resources[ing] || 0) - used);
              s.totals.consumed[ing] = (s.totals.consumed[ing] || 0) + used;
            }
            let made = perOut * n;
            if (isFinite(cap)) made = Math.max(0, Math.min(made, cap - (s.resources[e.recipe] || 0)));
            s.resources[e.recipe] = (s.resources[e.recipe] || 0) + made;
            s.totals.produced[e.recipe] = (s.totals.produced[e.recipe] || 0) + made;
            budget -= n;
            continue;
          }
        }

        // start a single craft: pay inputs up front (resources spent at production START)
        if (!e._crafting) {
          let canStart = true;
          for (const ing in rec.inputs) {
            if ((s.resources[ing] || 0) < rec.inputs[ing]) { canStart = false; break; }
          }
          if (canStart && isFinite(cap) && (s.resources[e.recipe] || 0) >= cap) canStart = false;
          if (!canStart) break;
          for (const ing in rec.inputs) {
            const used = rec.inputs[ing];
            s.resources[ing] = Math.max(0, (s.resources[ing] || 0) - used);
            s.totals.consumed[ing] = (s.totals.consumed[ing] || 0) + used;
          }
          e._crafting = true;
        }

        const remaining = 1 - (e._progress || 0);
        if (budget >= remaining) {
          // craft completes: emit the output (increment only at COMPLETION) and reset
          budget -= remaining;
          e._progress = 0;
          e._crafting = false;
          let made = perOut;
          if (isFinite(cap)) made = Math.max(0, Math.min(made, cap - (s.resources[e.recipe] || 0)));
          s.resources[e.recipe] = (s.resources[e.recipe] || 0) + made;
          s.totals.produced[e.recipe] = (s.totals.produced[e.recipe] || 0) + made;
        } else {
          e._progress = (e._progress || 0) + budget;
          budget = 0;
        }
      }

      // Report the SMOOTH flow this tick for the /sec readouts & graphs: the work actually
      // done (in craft-units) × the recipe's per-craft amounts. Resources still change only
      // in discrete chunks above, but the displayed rate reflects steady throughput — so a
      // craft slower than the sample interval no longer makes the readout flicker/decay.
      const progressDone = budgetStart - budget;
      if (progressDone > 0) {
        for (const ing in rec.inputs) net[ing] = (net[ing] || 0) - rec.inputs[ing] * progressDone;
        net[e.recipe] = (net[e.recipe] || 0) + perOut * progressDone;
      }
    }

    Research.step(dt, pwr.ratio);
    return { net, pwr };
  },
};
