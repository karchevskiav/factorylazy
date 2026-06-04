// production.js — the simulation core. Runs every tick; reused for offline catch-up.
// Buildings are individual entities placed on the map; resources live in one shared pool.
import { GameState } from './gameState.js';
import { RESOURCES } from './data/resources.js';
import { RECIPES }   from './data/recipes.js';
import { BUILDINGS } from './data/buildings.js';
import { POWER }     from './data/power.js';
import { MODULES }   from './data/modules.js';
import { TICK_SEC }  from './config.js';
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

    // steam engines collectively burn coal from the shared pool; scale by what's available
    const steam = GameState.placedOf('steamEngine');
    if (steam > 0) {
      const def = POWER.steamEngine;
      const need = steam * def.fuelPerSec * TICK_SEC;
      const have = s.resources.coal || 0;
      const ratio = need > 0 ? Math.min(1, have / need) : 1;
      s.resources.coal = Math.max(0, have - need * ratio);
      produced += steam * def.mw * ratio;
    }
    produced += GameState.placedOf('solarPanel') * POWER.solarPanel.mw;

    // consumption from every powered entity (machines + beacons)
    for (const e of s.entities) {
      const def = GameState.def(e.type);
      if (!def || !def.energy) continue;
      if (BUILDINGS[e.type] && BUILDINGS[e.type].cat !== 'beacon' && !e.recipe) continue;
      const me = this.modEffect(e);
      consumed += def.energy * Math.max(0.1, 1 + me.energy);
    }
    const ratio = consumed > 0 ? Math.min(1, produced / consumed) : 1;
    return { produced, consumed, ratio };
  },

  // one production step over `dt` seconds; `mult` is a global rate multiplier (offline debuff).
  step(dt, mult) {
    const s = GameState.state;
    const M = GameState.multipliers();
    const pwr = this.power();
    const rateMods = mult * pwr.ratio;
    const net = {};  // per-resource net change this step (for /sec readouts & history)

    for (const e of this.ordered()) {
      const def = GameState.def(e.type);
      if (!def || !e.recipe) continue;                 // generators / beacons make nothing
      const me = this.modEffect(e);
      const speedMul = Math.max(0.05, def.speed * (M.speed + me.speed + GameState.beaconSpeedAt(e.x, e.y)));

      // extractors (miner / pumpjack / offshore pump): produce raw with no inputs (1 craft/sec)
      if (def.cat === 'mine' || def.cat === 'oil' || def.cat === 'pump') {
        const made = speedMul * dt * rateMods * (M.yield + me.yld);
        s.resources[e.recipe] = (s.resources[e.recipe] || 0) + made;
        net[e.recipe] = (net[e.recipe] || 0) + made;
        s.totals.produced[e.recipe] = (s.totals.produced[e.recipe] || 0) + made;
        e._progress = ((e._progress || 0) + speedMul * dt) % 1;
        continue;
      }

      const rec = RECIPES[e.recipe];
      if (!rec) continue;

      // crafts wanted this step, then clamp by available inputs
      let crafts = speedMul / rec.time * dt * rateMods;
      for (const ing in rec.inputs) {
        const maxByIng = (s.resources[ing] || 0) / rec.inputs[ing];
        if (maxByIng < crafts) crafts = maxByIng;
      }
      if (crafts <= 0) continue;

      for (const ing in rec.inputs) {
        const used = rec.inputs[ing] * crafts;
        s.resources[ing] = Math.max(0, (s.resources[ing] || 0) - used);
        net[ing] = (net[ing] || 0) - used;
        s.totals.consumed[ing] = (s.totals.consumed[ing] || 0) + used;
      }
      const made = rec.out * crafts * (M.yield + me.yld);
      s.resources[e.recipe] = (s.resources[e.recipe] || 0) + made;
      net[e.recipe] = (net[e.recipe] || 0) + made;
      s.totals.produced[e.recipe] = (s.totals.produced[e.recipe] || 0) + made;
      e._progress = ((e._progress || 0) + speedMul / rec.time * dt) % 1;
    }

    Research.step(dt);
    return { net, pwr };
  },
};
