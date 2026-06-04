// research.js — one technology at a time; consumes science packs continuously.
import { GameState } from './gameState.js';
import { TECH }      from './data/tech.js';
import { UI }        from './ui.js';
import { Production } from './production.js';

export const Research = {
  // advance the active research over `dt` seconds
  step(dt) {
    const s = GameState.state;
    const cur = s.research.current;
    if (!cur) return;
    const cost = TECH[cur].cost;

    // fraction of total cost we can fund this tick (limited by the scarcest pack), min ~8s research
    let frac = dt / 8;
    for (const r in cost) {
      const need = cost[r] * frac;
      if ((s.resources[r] || 0) < need) {
        const possible = (s.resources[r] || 0) / cost[r];
        if (possible < frac) frac = possible;
      }
    }
    if (frac <= 0) return;

    for (const r in cost) s.resources[r] = Math.max(0, (s.resources[r] || 0) - cost[r] * frac);
    s.research.progress += frac;
    if (s.research.progress >= 1) this.complete(cur);
  },

  start(key) {
    const s = GameState.state;
    if (s.research.current) return UI.toast('Finish current research first');
    if (s.research.done.includes(key)) return;
    for (const r of TECH[key].req) if (!s.research.done.includes(r)) return UI.toast('Requirements not met');
    s.research.current = key;
    s.research.progress = 0;
    UI.toast('Researching: ' + TECH[key].name);
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
    UI.toast('✔ Researched ' + TECH[key].name);
    Production.order = null;   // recipe/tier set may have changed
    UI.renderAll();
  },
};
