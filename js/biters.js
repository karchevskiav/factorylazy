// biters.js — the war engine on the front (the screens above the factory, y<0).
//
// Factory POLLUTION (see production.pollute) drives the assault: below WAR.pollutionTrigger
// the biters just lurk in the biter zone; above it they surge down in waves whose size and
// toughness scale with pollution. They CHEW through whatever blocks the way (walls have the
// most HP, so they fall last) and the instant one crosses into the factory the run is lost.
// Gun turrets shoot the nearest biter in range, burning firearm magazines they auto-reload
// from the shared resource pool — so the factory's ammo output is its own defence.
import { GameState } from './gameState.js';
import { MapGen }    from './map.js';
import { ENEMIES }   from './data/enemies.js';
import { WAR }       from './config.js';
import { I18N }      from './i18n.js';

const TAU = Math.PI * 2;

// movement vector → Factorio direction index (0 = North, clockwise, 16 steps)
function dirOf(vx, vy) {
  let a = Math.atan2(vx, -vy);
  if (a < 0) a += TAU;
  return Math.round(a / (TAU / 16)) % 16;
}

export const Biters = {
  list: [],

  // pollution → war state. intensity 0 at the trigger, +1 per WAR.intensityScale beyond it.
  threat() {
    const p = GameState.state.pollution || 0;
    const active = p >= WAR.pollutionTrigger;
    const intensity = Math.max(0, (p - WAR.pollutionTrigger) / WAR.intensityScale);
    const pop = active ? Math.min(WAR.maxPop, Math.round(WAR.basePop + intensity * WAR.popPerInt)) : 3;
    const hp = WAR.biterBaseHp + intensity * WAR.biterHpPerInt;
    return { active, intensity, pop, hp };
  },

  spawn(atTop, maxHp) {
    const w = GameState.state.map.width;
    const top = MapGen.topRow(), wall = MapGen.wallRow();
    const x = 0.5 + Math.random() * (w - 1);
    const y = atTop ? top + Math.random() * 2 : top + Math.random() * (wall - top - 1);
    this.list.push({
      x, y, col: x, dir: 8, state: 'run', frame: Math.random() * 16,
      speed: WAR.biterSpeed * (0.8 + Math.random() * 0.5),
      hp: maxHp, maxHp, wanderY: top + Math.random() * (wall - top - 2),
    });
  },

  // entity whose footprint covers tile (tx,ty), or null
  entityAtTile(tx, ty) {
    for (const e of GameState.state.entities) {
      const d = GameState.def(e.type); if (!d) continue;
      const w = d.w || 2, h = d.h || 2;
      if (tx >= e.x && tx < e.x + w && ty >= e.y && ty < e.y + h) return e;
    }
    return null;
  },

  // damage a structure; remove it when destroyed
  damageStructure(ent, dmg) {
    if (ent.hp == null) ent.hp = GameState.maxHp(ent.type) || 1;
    ent.hp -= dmg;
    if (ent.hp <= 0) {
      if (window.MapView && MapView.selected === ent) { MapView.selected = null; window.UI && UI.hideInspector(); }
      GameState.removeEntity(ent);
    }
  },

  update(dt) {
    const s = GameState.state;
    if (!s || !s.map || s.over) return;
    const t = this.threat();

    // one-shot alert when the assault first begins (and re-arm once it dies down)
    if (t.active && !s.warAlerted) { s.warAlerted = true; if (window.UI && UI.toast) UI.toast(I18N.t('toast_war_begins')); }
    else if (!t.active && s.pollution < WAR.pollutionTrigger * 0.6) s.warAlerted = false;

    // retire finished death-fades, then keep the field populated with LIVE biters;
    // replacements march in from the very top, and we ease off when pollution drops.
    for (const b of this.list) if (b.gone) b.dying -= dt;
    this.list = this.list.filter(b => !(b.gone && b.dying <= 0));
    let live = this.list.reduce((n, b) => n + (b.gone ? 0 : 1), 0);
    let guard = 0;
    while (live < t.pop && guard++ < 200) { this.spawn(true, t.hp); live++; }
    if (live > t.pop) {
      for (let i = this.list.length - 1; i >= 0 && live > t.pop; i--)
        if (!this.list[i].gone) { this.list[i].gone = true; this.list[i].dying = 0.3; live--; }
    }

    const run = ENEMIES.biter.run, atk = ENEMIES.biter.attack;
    const wall = MapGen.wallRow();

    for (const b of this.list) {
      if (b.gone) continue;                                  // dying — animated/faded only
      if (b.maxHp !== t.hp) b.maxHp = t.hp;                   // wave toughness tracks pollution
      if (!t.active) {                                        // peace: lurk & wander in the biter zone
        this.wander(b, dt, run);
        continue;
      }
      // war: march straight down the column toward the factory, chewing what blocks it
      const footTy = Math.floor(b.y + 0.5);
      const blocker = this.entityAtTile(Math.floor(b.x), footTy);
      if (blocker && GameState.isMilitary(blocker.type)) {    // wall or turret in the way → claw it
        b.state = 'attack'; b.dir = 8;
        b.frame = (b.frame + dt * atk.fps) % atk.frames;
        this.damageStructure(blocker, WAR.biterDps * dt);
        continue;
      }
      if (b.y >= 0) { this.breach(); return; }                // crossed into the factory → run lost
      // advance down
      b.state = 'run'; b.dir = 8;
      b.y += b.speed * dt;
      b.x += (b.col - b.x) * Math.min(1, dt * 2) * 0.3;       // settle onto the target column
      b.frame = (b.frame + dt * run.fps) % run.frames;
    }

    this.fireTurrets(dt);
  },

  // render-loop only: advance leg animation smoothly between simulation ticks
  animate(dt) {
    const run = ENEMIES.biter.run, atk = ENEMIES.biter.attack;
    for (const b of this.list) {
      const a = b.state === 'attack' ? atk : run;
      b.frame = (b.frame + dt * a.fps) % a.frames;
    }
  },

  // peace-time idle drift inside the biter zone (never crosses the wall)
  wander(b, dt, run) {
    const dx = b.col - b.x, dy = b.wanderY - b.y;
    const dist = Math.hypot(dx, dy) || 1;
    if (dist < 0.5) {
      const w = GameState.state.map.width, top = MapGen.topRow(), wall = MapGen.wallRow();
      b.col = 0.5 + Math.random() * (w - 1); b.wanderY = top + Math.random() * (wall - top - 2);
    } else {
      b.dir = dirOf(dx, dy);
      const step = Math.min(dist, b.speed * 0.6 * dt);
      b.x += (dx / dist) * step; b.y += (dy / dist) * step;
    }
    b.state = 'run';
    b.frame = (b.frame + dt * run.fps) % run.frames;
  },

  // gun turrets focus-fire the nearest biter in range, burning auto-reloaded magazines
  fireTurrets(dt) {
    const s = GameState.state;
    for (const e of s.entities) {
      if (e.type !== 'gunTurret') continue;
      // auto-reload from the shared pool
      if ((e.ammo || 0) < WAR.turretAmmoMax) {
        const want = WAR.turretAmmoMax - (e.ammo || 0);
        const have = s.resources.firearmMagazine || 0;
        const take = Math.min(want, have);
        if (take > 0) { s.resources.firearmMagazine = have - take; e.ammo = (e.ammo || 0) + take; }
      }
      e._aim = null;
      if ((e.ammo || 0) <= 0) continue;
      const cx = e.x + 1, cy = e.y + 1, R = WAR.turretRange;
      let best = null, bd = R * R;
      for (const b of this.list) {
        if (b.gone) continue;
        const d2 = (b.x - cx) * (b.x - cx) + (b.y - cy) * (b.y - cy);
        if (d2 < bd) { bd = d2; best = b; }
      }
      if (!best) continue;
      e.ammo = Math.max(0, e.ammo - WAR.turretAmmoPerSec * dt);
      e._aim = best;                                          // for the tracer in the renderer
      best.hp -= WAR.turretDps * dt;
      if (best.hp <= 0) { best.gone = true; best.dying = 0.3; }   // start the death fade
    }
  },

  // a biter reached the factory: lose the run, bank prestige, pop the game-over modal
  breach() {
    const earned = GameState.endRun();
    if (window.UI && UI.gameOver) UI.gameOver(earned);
  },
};
