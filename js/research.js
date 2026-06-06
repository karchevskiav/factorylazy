// research.js — one technology at a time; consumes science packs continuously.
import { GameState } from './gameState.js';
import { TECH }      from './data/tech.js';
import { UI }        from './ui.js';
import { Production } from './production.js';
import { I18N }      from './i18n.js';
import { BALANCE }   from './config.js';

export const Research = {
  // labs are listed here; cache nothing — entity set changes as the player builds.
  labEntities() {
    return GameState.state.entities.filter(e => {
      const def = GameState.def(e.type);
      return def && def.cat === 'lab';
    });
  },

  // science a single lab cycle costs (a fraction of the tech's total cost). One filled
  // progress bar == one cycle == cycleFrac of the whole research.
  cycleFrac() { return BALANCE.labCraftSec / BALANCE.researchSeconds; },

  // can this lab fund / continue a research cycle right now? (gates its power draw)
  labBusy(e) {
    const s = GameState.state;
    const cur = s.research.current;
    if (!cur) return false;
    if (e._crafting) return true;
    const cost = TECH[cur].cost;
    const cf = this.cycleFrac();
    for (const r in cost) if ((s.resources[r] || 0) < cost[r] * cf) return false;
    return true;
  },

  // advance the active research over `dt` seconds. `pwr` = power-satisfaction ratio (0..1).
  //
  // DISCRETE, like assemblers: each lab runs research "cycles". Science packs are spent at
  // the START of a cycle; the lab's own `_progress` bar fills at its (deliberately slower)
  // speed; one filled bar credits `cycleFrac` of the research. Labs run a bit slower than
  // machines via the `lab` catSpeed multiplier.
  step(dt, pwr = 1) {
    const s = GameState.state;
    const labs = this.labEntities();
    const cur = s.research.current;
    if (!cur) { for (const e of labs) { e._progress = 0; e._crafting = false; } return; }

    const cost = TECH[cur].cost;
    const cf = this.cycleFrac();
    const M = GameState.multipliers();
    const researchMult = GameState.researchMult();
    const slow = (BALANCE.catSpeed && BALANCE.catSpeed.lab) || 1;
    const T = BALANCE.labCraftSec;

    for (const e of labs) {
      const def = GameState.def(e.type);
      const me = Production.modEffect(e);
      const speedMul = Math.max(BALANCE.minSpeed,
        def.speed * slow * (M.speed + me.speed + GameState.beaconSpeedAt(e.x, e.y))) * researchMult;
      const powerFactor = def.energy > 0 ? pwr : 1;
      let budget = speedMul / T * dt * powerFactor;   // cycle-progress available this tick
      let guard = 0;

      while (budget > 0 && guard++ < 100000 && s.research.current === cur) {
        if (!e._crafting) {
          // pay this cycle's science up front (resources spent at production START)
          let ok = true;
          for (const r in cost) if ((s.resources[r] || 0) < cost[r] * cf) { ok = false; break; }
          if (!ok) break;
          for (const r in cost) s.resources[r] = Math.max(0, (s.resources[r] || 0) - cost[r] * cf);
          e._crafting = true;
        }
        const remaining = 1 - (e._progress || 0);
        if (budget >= remaining) {
          budget -= remaining;
          e._progress = 0;
          e._crafting = false;
          s.research.progress += cf;            // credit only at cycle COMPLETION
          if (s.research.progress >= 1) {
            this.complete(cur);
            for (const l of labs) { l._progress = 0; l._crafting = false; }
            return;
          }
        } else {
          e._progress = (e._progress || 0) + budget;
          budget = 0;
        }
      }
    }
  },

  start(key) {
    const s = GameState.state;
    if (s.research.current) return UI.toast(I18N.t('toast_finish_research'));
    if (s.research.done.includes(key)) return;
    for (const r of TECH[key].req) if (!s.research.done.includes(r)) return UI.toast(I18N.t('toast_req_not_met'));
    if (GameState.labSpeed() <= 0) UI.toast(I18N.t('toast_need_lab'));
    s.research.current = key;
    s.research.progress = 0;
    UI.toast(I18N.t('toast_researching', I18N.name('tech_' + key, TECH[key].name)));
    UI.renderResearch();
  },

  complete(key) {
    const s = GameState.state;
    s.research.done.push(key);
    s.research.current = null;
    s.research.progress = 0;
    const e = TECH[key].effect || {};
    if (e.unlockModules) s.modulesUnlocked = true;
    if (e.unlockRocket)  s.rocketUnlocked  = true;
    UI.toast(I18N.t('toast_researched', I18N.name('tech_' + key, TECH[key].name)));
    Production.order = null;   // recipe/tier set may have changed
    UI.renderAll();
  },
};
