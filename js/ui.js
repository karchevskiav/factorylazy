// ui.js — DOM rendering, number formatting, palette/inspector, prestige and toasts.
// Buildings are placed on the map (see mapview.js); this module renders everything else.
import { GameState }  from './gameState.js';
import { Production } from './production.js';
import { Research }   from './research.js';
import { Save }       from './save.js';
import { MapView }    from './mapview.js';
import { RESOURCES }  from './data/resources.js';
import { RECIPES }    from './data/recipes.js';
import { BUILDINGS }  from './data/buildings.js';
import { POWER }      from './data/power.js';
import { MODULES }    from './data/modules.js';
import { TECH }       from './data/tech.js';
import { TICK_MS, TICK_SEC, SAVE_EVERY, HIST_LEN, OFFLINE_RATE, ROCKET_GOAL } from './config.js';

export const UI = {
  loop: null, saveLoop: null, booted: false,
  lastNet: {}, lastPwr: { produced: 0, consumed: 0, ratio: 1 },

  /* ---------------- number formatting ---------------- */
  fmt(n) {
    if (n === Infinity) return '∞';
    n = Number(n) || 0;
    const neg = n < 0; n = Math.abs(n);
    let out;
    if (n < 1000)      out = (n >= 100 || n === Math.floor(n)) ? String(Math.floor(n)) : n.toFixed(1);
    else if (n < 1e6)  out = (n / 1e3).toFixed(2) + 'K';
    else if (n < 1e9)  out = (n / 1e6).toFixed(2) + 'M';
    else if (n < 1e12) out = (n / 1e9).toFixed(2) + 'B';
    else if (n < 1e15) out = (n / 1e12).toFixed(2) + 'T';
    else               out = n.toExponential(2);
    return (neg ? '-' : '') + out;
  },
  fmtDelta(n) {
    if (Math.abs(n) < 0.05) return '0/s';
    return (n > 0 ? '+' : '') + this.fmt(n) + '/s';
  },

  // inline resource icon — real Factorio PNG when available, else the unicode glyph
  ic(k, sz = 22) {
    const r = RESOURCES[k];
    if (!r) return '';
    if (r.img) return `<img class="ic-img" src="${r.img}" alt="" title="${r.name}" style="width:${sz}px;height:${sz}px">`;
    return `<span style="color:${r.color}">${r.icon}</span>`;
  },
  // building/generator icon
  bic(type, sz = 24) {
    const d = GameState.def(type);
    if (d && d.img) return `<img class="ic-img" src="${d.img}" alt="" style="width:${sz}px;height:${sz}px">`;
    return `<span>${(d && d.icon) || '?'}</span>`;
  },
  entById(id) { return GameState.state.entities.find(e => e.id === id); },

  /* ---------------- boot / lifecycle ---------------- */
  boot() {
    document.getElementById('tab-research').addEventListener('change', () => this.renderResearch());
    document.getElementById('tab-stats').addEventListener('change', () => { this.drawSparks(); this.updateTotals(); });

    const sv = Save.load();
    if (Save.compatible(sv)) document.getElementById('load-modal').classList.remove('hidden');
    else { if (sv) Save.wipe(); GameState.fresh(); this.start(); }   // ignore pre-map saves
  },

  continueGame() {
    Save.hydrate(Save.load());
    document.getElementById('load-modal').classList.add('hidden');
    const off = Save.applyOffline();
    this.start();
    if (off && Object.keys(off.gains).length) {
      const lines = Object.entries(off.gains).sort((a, b) => b[1] - a[1]).slice(0, 8)
        .map(([k, v]) => `${RESOURCES[k].name}: +${this.fmt(v)}`).join('<br>');
      document.getElementById('offline-text').innerHTML =
        `You were away for <b>${off.hours.toFixed(1)} h</b> (offline rate ${OFFLINE_RATE * 100 | 0}%).<br><br>Produced:<br>${lines}`;
      document.getElementById('offline-modal').classList.remove('hidden');
    }
  },
  closeOffline() { document.getElementById('offline-modal').classList.add('hidden'); },
  newGameConfirm() {
    Save.wipe(); GameState.fresh();
    document.getElementById('load-modal').classList.add('hidden');
    this.start();
  },
  confirmHardReset() {
    if (confirm('Wipe your save and start a brand-new game (new map)? This cannot be undone.')) {
      this.stop(); Save.wipe(); GameState.fresh();
      this.start(); this.toast('New game started');
    }
  },

  start() {
    if (this.booted) return;
    this.booted = true;
    this.buildStaticUI();
    this.renderAll();
    this.loop     = setInterval(() => this.tick(), TICK_MS);
    this.saveLoop = setInterval(() => Save.save(), SAVE_EVERY);
    window.addEventListener('beforeunload', () => Save.save());
  },
  stop() {
    clearInterval(this.loop); clearInterval(this.saveLoop);
    this.loop = this.saveLoop = null; this.booted = false;
  },

  /* ---------------- main tick ---------------- */
  tick() {
    const { net, pwr } = Production.step(TICK_SEC, 1);
    this.lastNet = net; this.lastPwr = pwr;
    const s = GameState.state;
    for (const k in RESOURCES) {
      const arr = s.history[k] || (s.history[k] = []);
      arr.push((net[k] || 0) / TICK_SEC);
      if (arr.length > HIST_LEN) arr.shift();
    }
    this.renderDynamic();
  },

  /* ---------------- static DOM scaffolding ---------------- */
  buildStaticUI() {
    const mb = document.getElementById('mine-btns'); mb.innerHTML = '';
    ['ironOre', 'copperOre', 'coal', 'stone'].forEach(k => {
      const b = document.createElement('button');
      b.innerHTML = `${this.ic(k)} ${RESOURCES[k].name}`;
      b.onclick = () => { GameState.state.resources[k] += 1; this.renderDynamic(); };
      mb.appendChild(b);
    });
    this.renderResources();
    this.renderPalette();
    MapView.init();
    this.renderResearch();
    this.renderStatsTable();
  },

  renderResources() {
    const el = document.getElementById('res-list'); el.innerHTML = '';
    for (const k in RESOURCES) {
      const row = document.createElement('div'); row.className = 'res-row'; row.id = 'res-' + k;
      row.innerHTML = `
        <div class="icon" style="background:${RESOURCES[k].color}33;color:${RESOURCES[k].color}">${this.ic(k, 22)}</div>
        <div class="name">${RESOURCES[k].name}</div>
        <div class="amt" data-amt>0</div>
        <div class="delta zero" data-delta>0/s</div>`;
      el.appendChild(row);
    }
  },

  /* ---------------- building palette ---------------- */
  renderPalette() {
    const el = document.getElementById('bld-palette'); if (!el) return;
    el.innerHTML = '';
    const types = [...Object.keys(BUILDINGS), ...Object.keys(POWER)];
    for (const t of types) {
      const d = GameState.def(t);
      const btn = document.createElement('button');
      btn.className = 'palette-btn'; btn.id = 'pal-' + t; btn.dataset.type = t;
      btn.innerHTML = `<div class="pi">${this.bic(t, 26)}</div><div class="pn">${d.name}</div><div class="pc" data-cost></div>`;
      btn.onclick = () => { MapView.setPlace(MapView.place === t ? null : t); this.renderDynamic(); };
      el.appendChild(btn);
    }
  },

  /* ---------------- entity inspector ---------------- */
  showInspector(ent) {
    const el = document.getElementById('entity-inspector'); if (!el) return;
    const d = GameState.def(ent.type);
    let body = `<div class="insp-head">${this.bic(ent.type, 24)} <b>${d.name}</b> <span class="dim">@${ent.x},${ent.y}</span></div>`;

    if (d.place === 'ore') {
      body += `<div class="insp-row">Mining: ${this.ic(ent.recipe)} ${RESOURCES[ent.recipe].name}</div>`;
    } else if (d.recipes && d.recipes.length) {
      const s = GameState.state;
      const opts = d.recipes.filter(r => r !== 'rocketPart' || s.rocketUnlocked)
        .map(r => `<option value="${r}" ${ent.recipe === r ? 'selected' : ''}>${RESOURCES[r].name}</option>`).join('');
      body += `<div class="insp-row">Recipe: <select onchange="UI.assignRecipe(${ent.id}, this.value)">${opts}</select></div>`;
      const rec = RECIPES[ent.recipe];
      if (rec) {
        const ins = Object.entries(rec.inputs).map(([r, v]) => `${this.fmt(v)} ${this.ic(r, 16)}`).join(' + ') || '—';
        body += `<div class="insp-row dim">${ins} → ${this.fmt(rec.out)} ${this.ic(ent.recipe, 16)} (${rec.time}s)</div>`;
      }
    } else if (d.cat === 'beacon') {
      body += `<div class="insp-row dim">Boosts crafting speed of buildings within ${d.radius} tiles.</div>`;
    } else if (POWER[ent.type]) {
      body += `<div class="insp-row dim">+${d.mw} MW${d.fuel ? ` · burns ${d.fuelPerSec}/s ${RESOURCES[d.fuel].name}` : ' · no fuel'}</div>`;
    }

    if (d.slots > 0) {
      let slots = '<div class="insp-row">Modules: <span class="modules">';
      for (let i = 0; i < d.slots; i++) {
        const m = ent.modules[i];
        slots += `<span class="mod-slot ${m ? 'filled' : ''}" title="${m ? MODULES[m].name : 'Empty'}" onclick="UI.cycleModuleEntity(${ent.id},${i})">${m ? MODULES[m].icon : ''}</span>`;
      }
      slots += '</span></div>';
      body += slots;
    }

    body += `<div class="insp-row"><button class="danger" onclick="UI.removeEntityById(${ent.id})">✕ Remove</button></div>`;
    el.innerHTML = body; el.hidden = false;
  },
  hideInspector() { const el = document.getElementById('entity-inspector'); if (el) el.hidden = true; },

  assignRecipe(id, recipe) {
    const e = this.entById(id); if (!e) return;
    e.recipe = recipe; e._progress = 0;
    this.showInspector(e); MapView.render();
  },
  cycleModuleEntity(id, slot) {
    const e = this.entById(id); if (!e) return;
    if (!GameState.state.modulesUnlocked) return this.toast('Research Modules first');
    const types = [null, ...Object.keys(MODULES)];
    e.modules[slot] = types[(types.indexOf(e.modules[slot] || null) + 1) % types.length];
    this.showInspector(e); MapView.render();
  },
  removeEntityById(id) {
    const e = this.entById(id); if (e) MapView.remove(e);
  },

  /* ---------------- research ---------------- */
  renderResearch() {
    const el = document.getElementById('tech-grid'); el.innerHTML = '';
    const s = GameState.state;
    const tiers = {};
    for (const k in TECH) (tiers[TECH[k].tier] = tiers[TECH[k].tier] || []).push(k);
    Object.keys(tiers).sort((a, b) => a - b).forEach(tier => {
      const row = document.createElement('div'); row.className = 'tech-row';
      row.innerHTML = `<div class="tier-label">TIER ${tier}</div>`;
      tiers[tier].forEach(k => {
        const t = TECH[k];
        const done = s.research.done.includes(k);
        const active = s.research.current === k;
        const reqMet = t.req.every(r => s.research.done.includes(r));
        const locked = !done && !reqMet;
        const cls = done ? 'done' : active ? 'active' : locked ? 'locked' : '';
        const costStr = Object.entries(t.cost).map(([r, v]) => `${this.fmt(v)} ${this.ic(r)}`).join(' ');
        const status = done ? 'DONE' : active ? `${(s.research.progress * 100 | 0)}%` : locked ? 'LOCKED' : 'AVAILABLE';
        const btn = (!done && !active && !locked) ? `<button class="accent" style="font-size:10px;margin-top:6px;" onclick="Research.start('${k}')">RESEARCH</button>` : '';
        const card = document.createElement('div'); card.className = 'tech-card ' + cls; card.id = 'tech-' + k;
        card.innerHTML = `
          <div class="tname">${t.icon} ${t.name}</div>
          <div class="tdesc">${t.desc}</div>
          <div class="tcost">${costStr}</div>
          ${active ? `<div class="progress"><span style="width:${s.research.progress * 100}%"></span></div>` : ''}
          <div class="status">${status}</div>${btn}`;
        row.appendChild(card);
      });
      el.appendChild(row);
    });
  },

  renderStatsTable() {
    const el = document.getElementById('spark-list'); el.innerHTML = '';
    for (const k in RESOURCES) {
      const wrap = document.createElement('div'); wrap.className = 'spark';
      wrap.innerHTML = `<span class="lbl">${this.ic(k)} ${RESOURCES[k].name}</span>
        <canvas id="spark-${k}" width="220" height="34"></canvas>`;
      el.appendChild(wrap);
    }
  },

  /* ---------------- per-tick dynamic updates ---------------- */
  renderDynamic() {
    const s = GameState.state;

    for (const k in RESOURCES) {
      const row = document.getElementById('res-' + k); if (!row) continue;
      row.querySelector('[data-amt]').textContent = this.fmt(s.resources[k] || 0);
      const d = (this.lastNet[k] || 0) / TICK_SEC;
      const dEl = row.querySelector('[data-delta]');
      dEl.textContent = this.fmtDelta(d);
      dEl.className = 'delta ' + (d > 0.05 ? 'pos' : d < -0.05 ? 'neg' : 'zero');
    }

    // palette: visibility (unlock), cost, active highlight
    const palette = document.getElementById('bld-palette');
    if (palette) {
      for (const btn of palette.children) {
        const t = btn.dataset.type;
        const unlocked = BUILDINGS[t] ? GameState.isBuildingUnlocked(t) : GameState.isPowerUnlocked(t);
        btn.hidden = !unlocked;
        btn.classList.toggle('active', MapView.place === t);
        const cost = POWER[t] ? this.powerCost(t, GameState.placedOf(t)) : this.buildingCost(t, GameState.placedOf(t));
        btn.querySelector('[data-cost]').innerHTML = this.costStr(cost);
      }
    }

    MapView.render();

    // energy widget + header badge only once the electric era is unlocked
    const powerOn = GameState.powerUnlocked();
    document.getElementById('col-energy').hidden = !powerOn;
    document.getElementById('hdr-power-badge').hidden = !powerOn;

    const pwr = this.lastPwr;
    document.getElementById('energy-prod').textContent = this.fmt(pwr.produced);
    document.getElementById('energy-cons').textContent = this.fmt(pwr.consumed);
    const fill = document.getElementById('energy-fill');
    const pct = pwr.consumed > 0 ? Math.min(100, pwr.produced / pwr.consumed * 100) : 100;
    fill.style.width = pct + '%';
    fill.style.background = pct >= 99 ? 'var(--green)' : pct >= 50 ? 'var(--orange)' : 'var(--red)';
    const st = document.getElementById('energy-status');
    if (pwr.ratio >= 0.999) { st.textContent = 'Nominal'; st.style.color = 'var(--green)'; }
    else { st.textContent = `Deficit — production at ${(pwr.ratio * 100) | 0}%`; st.style.color = 'var(--red)'; }
    document.getElementById('hdr-power').textContent = `${this.fmt(pwr.produced)} / ${this.fmt(pwr.consumed)} MW`;

    document.getElementById('hdr-launches').textContent = s.launches;
    document.getElementById('hdr-bonus').textContent = '×' + s.launchBonus.toFixed(1);

    if (s.research.current) {
      const card = document.getElementById('tech-' + s.research.current);
      if (card) {
        const bar = card.querySelector('.progress > span'); if (bar) bar.style.width = (s.research.progress * 100) + '%';
        const stt = card.querySelector('.status'); if (stt) stt.textContent = (s.research.progress * 100 | 0) + '%';
      }
    }

    this.checkRocket();
    if (document.getElementById('tab-stats').checked) { this.drawSparks(); this.updateTotals(); }
  },

  /* ---------------- statistics ---------------- */
  drawSparks() {
    const s = GameState.state;
    for (const k in RESOURCES) {
      const c = document.getElementById('spark-' + k); if (!c) continue;
      const ctx = c.getContext('2d'); ctx.clearRect(0, 0, c.width, c.height);
      const data = s.history[k] || []; if (data.length < 2) continue;
      const slice = data.slice(-220);
      const max = Math.max(0.0001, ...slice.map(Math.abs));
      ctx.beginPath();
      slice.forEach((v, i) => {
        const x = i / (slice.length - 1) * c.width;
        const y = c.height - (Math.max(0, v) / max) * (c.height - 2) - 1;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      ctx.strokeStyle = RESOURCES[k].color; ctx.lineWidth = 1.5; ctx.stroke();
    }
  },
  updateTotals() {
    const s = GameState.state;
    let html = '<tr><th>Resource</th><th>Produced</th><th>Consumed</th><th>Net stock</th></tr>';
    for (const k in RESOURCES) {
      html += `<tr><td>${this.ic(k)} ${RESOURCES[k].name}</td>
        <td>${this.fmt(s.totals.produced[k] || 0)}</td>
        <td>${this.fmt(s.totals.consumed[k] || 0)}</td>
        <td>${this.fmt(s.resources[k] || 0)}</td></tr>`;
    }
    document.getElementById('stat-table').innerHTML = html;
  },

  renderAll() {
    this.renderResources(); this.renderPalette();
    this.renderResearch(); this.renderStatsTable(); this.renderDynamic();
  },

  /* ---------------- cost helpers ---------------- */
  buildingCost(key, owned) {
    const def = BUILDINGS[key], c = {}, mul = Math.pow(def.costMul, owned);
    for (const r in def.baseCost) c[r] = def.baseCost[r] * mul;
    return c;
  },
  powerCost(key, owned) {
    const def = POWER[key], c = {}, mul = Math.pow(def.costMul, owned);
    for (const r in def.baseCost) c[r] = def.baseCost[r] * mul;
    return c;
  },
  costStr(c) { return Object.entries(c).map(([r, v]) => `${this.fmt(Math.ceil(v))} ${this.ic(r, 16)}`).join(' '); },
  canAfford(c) { const s = GameState.state; for (const r in c) if ((s.resources[r] || 0) < Math.ceil(c[r])) return false; return true; },
  pay(c) { const s = GameState.state; for (const r in c) s.resources[r] -= Math.ceil(c[r]); },

  /* ---------------- prestige / rocket ---------------- */
  checkRocket() {
    const s = GameState.state;
    let host = document.getElementById('rocket-card');
    if (!s.rocketUnlocked) { if (host) host.remove(); return; }
    const ready = (s.resources.rocketPart || 0) >= ROCKET_GOAL;
    if (!host) {
      host = document.createElement('div'); host.id = 'rocket-card'; host.className = 'rocket-card';
      document.querySelector('.col-buildings').appendChild(host);
    }
    host.innerHTML = `
      <div class="rk-head">🚀 <b>Rocket Silo</b> — build ${ROCKET_GOAL} Rocket Parts, then launch</div>
      <div class="progress"><span style="width:${Math.min(100, (s.resources.rocketPart || 0) / ROCKET_GOAL * 100)}%;background:var(--orange)"></span></div>
      <div class="dim">${this.fmt(s.resources.rocketPart || 0)} / ${ROCKET_GOAL} Rocket Parts</div>
      <button class="accent" ${ready ? '' : 'disabled'} onclick="UI.launch()">LAUNCH ROCKET</button>`;
  },
  launch() {
    const s = GameState.state;
    if ((s.resources.rocketPart || 0) < ROCKET_GOAL) return;
    const launches = s.launches + 1;
    const bonus = Math.pow(1.5, launches);
    if (!confirm(`Launch the rocket?\n\nThis RESETS your factory (and generates a NEW map) but grants a permanent ×1.5 production bonus (new total ×${bonus.toFixed(1)}). Rockets launched: ${launches}.`)) return;
    this.stop();
    GameState.fresh();
    GameState.state.launches = launches;
    GameState.state.launchBonus = bonus;
    const card = document.getElementById('rocket-card'); if (card) card.remove();
    Save.save();
    this.start();
    this.toast(`🚀 Rocket launched! Permanent bonus now ×${bonus.toFixed(1)}`);
  },

  /* ---------------- toast ---------------- */
  _toastT: null,
  toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => t.classList.remove('show'), 1800);
  },
};
