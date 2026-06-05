// biters.js — alien "biters" on the war front (the screens above the factory, y<0).
// They spawn in the biter zone (screen -1), march DOWN toward the defensive wall, and
// play the attack animation when they reach it. Purely cosmetic for now: NO damage and
// no shooting yet — combat comes on the dedicated military pass.
import { GameState } from './gameState.js';
import { MapGen }    from './map.js';
import { ENEMIES }   from './data/enemies.js';

const TAU = Math.PI * 2;

// movement vector → Factorio direction index (0 = North, clockwise, 16 steps)
function dirOf(vx, vy) {
  let a = Math.atan2(vx, -vy);
  if (a < 0) a += TAU;
  return Math.round(a / (TAU / 16)) % 16;
}

export const Biters = {
  list: [],
  POP: 16,            // biters kept alive on the front
  SPEED: 1.1,         // tiles / second marching down
  ATTACK_HOLD: 6,     // seconds a biter claws the wall before being recycled to the top

  spawnOne() {
    const w = GameState.state.map.width;
    const top = MapGen.topRow(), wall = MapGen.wallRow();
    const x = 0.5 + Math.random() * (w - 1);
    const y = top + Math.random() * (wall - top - 1);              // somewhere in the biter zone
    this.list.push({
      x, y, tx: x + (Math.random() - 0.5) * 4, ty: wall - 0.4,     // target: just above the wall
      dir: 8, state: 'run', frame: Math.random() * 16,
      speed: this.SPEED * (0.8 + Math.random() * 0.5), atk: 0,
    });
  },

  ensure() {
    while (this.list.length < this.POP) this.spawnOne();
  },

  recycle(b) {
    const w = GameState.state.map.width;
    const top = MapGen.topRow(), wall = MapGen.wallRow();
    b.x = 0.5 + Math.random() * (w - 1);
    b.y = top + Math.random() * 2;                                 // reappear at the very top
    b.tx = b.x + (Math.random() - 0.5) * 4; b.ty = wall - 0.4;
    b.state = 'run'; b.frame = 0; b.atk = 0;
  },

  update(dt) {
    if (!GameState.state || !GameState.state.map) return;
    this.ensure();
    const run = ENEMIES.biter.run, atk = ENEMIES.biter.attack;
    const wall = MapGen.wallRow();
    for (const b of this.list) {
      if (b.y >= wall - 0.6) {                                     // reached the wall → claw at it
        b.state = 'attack'; b.dir = 8;                             // facing south (down, toward the factory)
        b.frame = (b.frame + dt * atk.fps) % atk.frames;
        b.atk += dt;
        if (b.atk > this.ATTACK_HOLD) this.recycle(b);            // recycle so the assault keeps flowing
        continue;
      }
      b.state = 'run';
      let dx = b.tx - b.x, dy = b.ty - b.y;
      const dist = Math.hypot(dx, dy) || 1;
      b.dir = dirOf(dx, dy);
      const step = Math.min(dist, b.speed * dt);
      b.x += (dx / dist) * step; b.y += (dy / dist) * step;
      b.frame = (b.frame + dt * run.fps) % run.frames;
    }
  },
};
