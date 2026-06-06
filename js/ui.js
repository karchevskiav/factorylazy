// ui.js — DOM rendering, number formatting, palette/inspector, prestige and toasts.
// Buildings are placed on the map (see mapview.js); this module renders everything else.
import { GameState }  from './gameState.js';
import { Production } from './production.js';
import { Research }   from './research.js';
import { Save }       from './save.js';
import { MapView }    from './mapview.js';
import { I18N }       from './i18n.js';
import { RESOURCES }  from './data/resources.js';
import { RECIPES }    from './data/recipes.js';
import { BUILDINGS }  from './data/buildings.js';
import { POWER }      from './data/power.js';
import { MODULES }    from './data/modules.js';
import { TECH }       from './data/tech.js';
import { UPGRADES, UPGRADE_GROUPS } from './data/upgrades.js';
import { TICK_MS, TICK_SEC, SAVE_EVERY, STAT_WINDOWS, OFFLINE_RATE, ROCKET_GOAL, BALANCE } from './config.js';

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

  // localized name of a resource/item by key
  rn(k) { const r = RESOURCES[k]; return I18N.name(k, (r && r.name) || k); },

  // inline resource icon — real Factorio PNG when available, else the unicode glyph
  ic(k, sz = 22) {
    const r = RESOURCES[k];
    if (!r) return '';
    if (r.img) return `<img class="ic-img" src="${r.img}" alt="" title="${this.rn(k)}" style="width:${sz}px;height:${sz}px">`;
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
    I18N.init();
    this.applyLang();
    document.getElementById('lp-research').addEventListener('change', () => this.renderResearch());
    document.getElementById('rp-stats').addEventListener('change', () => this.renderSparks(true));
    document.getElementById('rp-map').addEventListener('change', () => MapView.resize());

    const sv = Save.load();
    if (Save.compatible(sv)) document.getElementById('load-modal').classList.remove('hidden');
    else { if (sv) Save.wipe(); GameState.fresh(); this.start(); }   // ignore pre-map saves
  },

  /* ---------------- localization ---------------- */
  cycleLang() { I18N.next(); this.applyLang(); },
  applyLang() {
    I18N.applyStatic();
    const lb = document.getElementById('lang-btn'); if (lb) lb.textContent = '🌐 ' + I18N.label();
    if (!this.booted) return;                       // dynamic panels not built yet
    this.renderResources(); this.renderPalette(); this.renderCraft();
    this.renderResearch(); this.renderStatsTable(); this.renderDynamic();
    if (MapView.selected) this.showInspector(MapView.selected);
  },

  continueGame() {
    Save.hydrate(Save.load());
    document.getElementById('load-modal').classList.add('hidden');
    const off = Save.applyOffline();
    this.start();
    if (off && Object.keys(off.gains).length) {
      const lines = Object.entries(off.gains).sort((a, b) => b[1] - a[1]).slice(0, 8)
        .map(([k, v]) => `${this.rn(k)}: +${this.fmt(v)}`).join('<br>');
      document.getElementById('offline-text').innerHTML =
        I18N.t('offline_text', off.hours.toFixed(1), OFFLINE_RATE * 100 | 0, lines);
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
    if (confirm(I18N.t('confirm_reset'))) {
      this.showTotalsModal();                  // summarise the run before wiping it
      this.stop(); Save.wipe(); GameState.fresh();
      this.start(); this.toast(I18N.t('toast_newgame'));
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
    this.accumulateStats(net, pwr);
    this.renderDynamic();
  },

  // feed this tick's net change into every window's accumulator; when a window's
  // bucket is full, push the bucket's average net/sec into its ring buffer.
  accumulateStats(net, pwr) {
    const s = GameState.state, st = s.stats;
    for (const w of STAT_WINDOWS) {
      const acc = st.acc[w.id];
      for (const k in net) acc[k] = (acc[k] || 0) + net[k];
      // power is an instantaneous rate (MW), not a per-tick amount: accumulate
      // MW·tickSec so the /w.every divide below yields the AVERAGE MW over the bucket.
      acc.__pProd = (acc.__pProd || 0) + (pwr ? pwr.produced : 0) * TICK_SEC;
      acc.__pCons = (acc.__pCons || 0) + (pwr ? pwr.consumed : 0) * TICK_SEC;
      if (++st.ticks[w.id] < w.every / TICK_SEC) continue;
      const buf = st.buf[w.id], points = (w.min * 60) / w.every;
      for (const k in RESOURCES) {
        if ((s.resources[k] || 0) <= 0 && !acc[k]) continue;   // skip never-touched resources
        const arr = buf[k] || (buf[k] = []);
        arr.push((acc[k] || 0) / w.every);                     // avg net/sec over the bucket
        if (arr.length > points) arr.shift();
      }
      // electricity series (separate from resources): avg MW produced / consumed
      for (const pk of ['__pProd', '__pCons']) {
        const arr = buf[pk] || (buf[pk] = []);
        arr.push((acc[pk] || 0) / w.every);
        if (arr.length > points) arr.shift();
      }
      st.acc[w.id] = {};
      st.ticks[w.id] = 0;
    }
  },

  // smoothed net/sec for the resources table. With discrete crafting the raw per-tick
  // net is spiky (0 most ticks, a burst on completion), so we report the same averaged
  // value the graphs are built from. We slide a window of TWO sample intervals over the
  // finest-resolution series: the in-progress bucket plus the last two completed samples,
  // time-weighted so the figure glides instead of jumping.
  deltaRate(k) {
    const st = GameState.state.stats;
    const w = STAT_WINDOWS[0];                       // finest resolution (e.g. 5m / every 3s)
    if (w.every <= 0) return 0;
    const arr = st.buf[w.id] && st.buf[w.id][k];
    const last = (arr && arr.length)     ? arr[arr.length - 1] : 0;
    const prev = (arr && arr.length > 1) ? arr[arr.length - 2] : last;
    const accVal = (st.acc[w.id] && st.acc[w.id][k]) || 0;
    const elapsed = Math.min(w.every, (st.ticks[w.id] || 0) * TICK_SEC);   // secs into current bucket
    // window length = 2·every: partial bucket (accVal) + last sample (every s) + prev sample
    return (accVal + last * w.every + prev * (w.every - elapsed)) / (2 * w.every);
  },

  /* ---------------- static DOM scaffolding ---------------- */
  buildStaticUI() {
    this.renderResources();
    this.renderPalette();
    this.renderCraft();
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
        <div class="name">${this.rn(k)}</div>
        <div class="amt" data-amt>0</div>
        <div class="delta zero" data-delta>0/s</div>`;
      el.appendChild(row);
    }
  },

  /* ---------------- building palette ---------------- */
  // building categories grouped into palette sections (in display order)
  PAL_GROUPS: [
    { id: 'mining',   cats: ['mine', 'pump', 'oil'] },
    { id: 'smelting', cats: ['smelt'] },
    { id: 'crafting', cats: ['craft', 'chem', 'centrifuge'] },
    { id: 'power',    cats: ['boiler'] },                  // every POWER generator + the boiler
    { id: 'military', cats: ['military'] },
    { id: 'other',    cats: ['beacon', 'lab'] },
  ],
  palGroupOf(t) {
    if (POWER[t]) return 'power';
    const c = BUILDINGS[t].cat;
    for (const g of this.PAL_GROUPS) if (g.cats.includes(c)) return g.id;
    return 'other';
  },
  renderPalette() {
    const el = document.getElementById('bld-palette'); if (!el) return;
    el.innerHTML = '';
    for (const g of this.PAL_GROUPS) {
      const wrap = document.createElement('div');
      wrap.className = 'pal-group'; wrap.id = 'palgrp-' + g.id;
      wrap.innerHTML = `<div class="pal-group-title">${I18N.t('pal_group_' + g.id)}</div>`;
      el.appendChild(wrap);
    }
    for (const t of [...Object.keys(BUILDINGS), ...Object.keys(POWER)]) {
      const d = GameState.def(t);
      const btn = document.createElement('button');
      btn.className = 'palette-btn'; btn.id = 'pal-' + t; btn.dataset.type = t;
      btn.innerHTML = `<div class="pi">${this.bic(t, 28)}</div><div class="pn">${I18N.name(t, d.name)}</div><div class="pc" data-cost></div>`;
      btn.onclick = () => { MapView.setPlace(MapView.place === t ? null : t); this.renderDynamic(); };
      document.getElementById('palgrp-' + this.palGroupOf(t)).appendChild(btn);
    }
  },

  /* ---------------- entity inspector ---------------- */
  showInspector(ent) {
    const el = document.getElementById('entity-inspector'); if (!el) return;
    const d = GameState.def(ent.type);
    let body = `<div class="insp-head">${this.bic(ent.type, 24)} <b>${I18N.name(ent.type, d.name)}</b> <span class="dim">@${ent.x},${ent.y}</span><button class="insp-close" onclick="UI.hideInspector()" title="${I18N.t('insp_close')}">✕</button></div>`;

    if (d.place === 'ore') {
      const ores = MapView.oresUnder(ent.x, ent.y, d.w || 2, d.h || 2);
      if (ores.length > 1) {
        const opts = ores.map(o => `<option value="${o}" ${ent.recipe === o ? 'selected' : ''}>${this.rn(o)}</option>`).join('');
        body += `<div class="insp-row">${I18N.t('insp_mining')} <select onchange="UI.assignRecipe(${ent.id}, this.value)">${opts}</select></div>`;
      } else {
        body += `<div class="insp-row">${I18N.t('insp_mining')} ${this.ic(ent.recipe)} ${this.rn(ent.recipe)}</div>`;
      }
    } else if (d.recipes && d.recipes.length) {
      const s = GameState.state;
      const opts = d.recipes.filter(r => (r !== 'rocketPart' || s.rocketUnlocked) && GameState.recipeUnlocked(r) && !GameState.isUpgradeItem(r) && !GameState.isBuildingItem(r) && !GameState.isHandcraftItem(r))
        .map(r => `<option value="${r}" ${ent.recipe === r ? 'selected' : ''}>${this.rn(r)}</option>`).join('');
      body += `<div class="insp-row">${I18N.t('insp_recipe')} <select onchange="UI.assignRecipe(${ent.id}, this.value)">${opts}</select></div>`;
      const rec = RECIPES[ent.recipe];
      if (rec) {
        const ins = Object.entries(rec.inputs).map(([r, v]) => `${this.fmt(v)} ${this.ic(r, 16)}`).join(' + ') || '—';
        body += `<div class="insp-row dim">${ins} → ${this.fmt(rec.out)} ${this.ic(ent.recipe, 16)} (${rec.time}s)</div>`;
      }
    } else if (d.cat === 'beacon') {
      body += `<div class="insp-row dim">${I18N.t('insp_beacon', d.radius)}</div>`;
    } else if (d.cat === 'lab') {
      body += `<div class="insp-row dim">${I18N.t('insp_lab')}</div>`;
    } else if (d.military) {
      body += `<div class="insp-row dim">${ent.type === 'gunTurret'
        ? I18N.t('insp_turret', ent.ammo || 0) : I18N.t('insp_wall')}</div>`;
    } else if (POWER[ent.type]) {
      body += `<div class="insp-row dim">${d.fuel
        ? I18N.t('insp_power_fuel', d.mw, d.fuelPerSec, this.rn(d.fuel))
        : I18N.t('insp_power_nofuel', d.mw)}</div>`;
      if (d.neighborBonus) {
        const adj = GameState.adjacentSameType(ent);
        const eff = +(d.mw * (1 + d.neighborBonus * adj)).toFixed(1);
        body += `<div class="insp-row dim">${I18N.t('insp_reactor_neighbor', Math.round(d.neighborBonus * 100), adj, eff)}</div>`;
      }
    }

    if (d.slots > 0) {
      let slots = `<div class="insp-row">${I18N.t('insp_modules')} <span class="modules">`;
      for (let i = 0; i < d.slots; i++) {
        const m = ent.modules[i];
        slots += `<span class="mod-slot ${m ? 'filled' : ''}" title="${m ? I18N.name(m, MODULES[m].name) : I18N.t('insp_empty')}" onclick="UI.cycleModuleEntity(${ent.id},${i})">${m ? MODULES[m].icon : ''}</span>`;
      }
      slots += '</span></div>';
      body += slots;
    }

    body += `<div class="insp-row"><button class="danger" onclick="UI.removeEntityById(${ent.id})">${I18N.t('insp_remove')}</button></div>`;
    el.innerHTML = body;
    const ov = document.getElementById('inspector-overlay'); if (ov) ov.classList.remove('hidden');
  },
  hideInspector() { const ov = document.getElementById('inspector-overlay'); if (ov) ov.classList.add('hidden'); },

  assignRecipe(id, recipe) {
    const e = this.entById(id); if (!e) return;
    e.recipe = recipe; e._progress = 0;
    this.showInspector(e); MapView.render();
  },
  cycleModuleEntity(id, slot) {
    const e = this.entById(id); if (!e) return;
    if (!GameState.state.modulesUnlocked) return this.toast(I18N.t('toast_research_modules'));
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
      row.innerHTML = `<div class="tier-label">${I18N.t('tier', tier)}</div>`;
      tiers[tier].forEach(k => {
        const t = TECH[k];
        const done = s.research.done.includes(k);
        const active = s.research.current === k;
        const reqMet = t.req.every(r => s.research.done.includes(r));
        const locked = !done && !reqMet;
        const cls = done ? 'done' : active ? 'active' : locked ? 'locked' : '';
        const costStr = Object.entries(t.cost).map(([r, v]) => `${this.fmt(v)} ${this.ic(r)}`).join(' ');
        const status = done ? I18N.t('tech_done') : active ? `${(s.research.progress * 100 | 0)}%` : locked ? I18N.t('tech_locked') : I18N.t('tech_available');
        const btn = (!done && !active && !locked) ? `<button class="accent" style="font-size:10px;margin-top:6px;" onclick="Research.start('${k}')">${I18N.t('tech_research')}</button>` : '';
        const card = document.createElement('div'); card.className = 'tech-card ' + cls; card.id = 'tech-' + k;
        card.innerHTML = `
          <div class="tname">${t.icon} ${I18N.name('tech_' + k, t.name)}</div>
          <div class="tdesc">${I18N.name('techd_' + k, t.desc)}</div>
          <div class="tcost">${costStr}</div>
          ${active ? `<div class="progress"><span style="width:${s.research.progress * 100}%"></span></div>` : ''}
          <div class="status">${status}</div>${btn}`;
        row.appendChild(card);
      });
      el.appendChild(row);
    });
  },

  /* ---------------- manual-craft window (§13.1) ---------------- */
  // build the static list once: one row per upgrade item, grouped by family.
  // Per-tick state (rank / contribution / cost / afford / unlock) is refreshed in
  // updateCraftDynamic().
  renderCraft() {
    const el = document.getElementById('craft-list'); if (!el) return;
    el.innerHTML = '';
    for (const grp of UPGRADE_GROUPS) {
      const title = document.createElement('div');
      title.className = 'craft-fam-title'; title.id = 'craftfam-' + grp;
      title.textContent = I18N.t('craft_grp_' + grp);
      el.appendChild(title);
      for (const id in UPGRADES) {
        if (UPGRADES[id].group !== grp) continue;
        const row = document.createElement('div');
        row.className = 'craft-row'; row.id = 'craft-' + id;
        row.innerHTML =
          `<div class="pi">${this.ic(id, 28)}</div>
           <div class="craft-info">
             <div class="craft-name">${this.rn(id)} <span class="craft-rank" data-rank>×0</span></div>
             <div class="craft-contrib dim" data-contrib></div>
           </div>
           <button class="craft-buy accent" data-buy onclick="UI.craftBuy('${id}')"></button>`;
        el.appendChild(row);
      }
    }
  },

  // refresh the dynamic bits of every craft row; called each tick from renderDynamic
  updateCraftDynamic() {
    const list = document.getElementById('craft-list'); if (!list) return;
    for (const id in UPGRADES) {
      const row = document.getElementById('craft-' + id); if (!row) continue;
      // items whose recipe isn't researched yet are hidden entirely — the player only
      // sees bonuses they can actually craft.
      const unlocked = GameState.upgradeUnlocked(id);
      row.hidden = !unlocked;
      row.classList.toggle('locked', !unlocked);
      if (!unlocked) continue;
      const def = UPGRADES[id], rank = GameState.upgradeRank(id);
      row.querySelector('[data-rank]').textContent = '×' + rank;
      // chests / tank show a flat +cap; everything else shows a per-rank %
      row.querySelector('[data-contrib]').textContent = def.cap != null
        ? I18N.t('craft_cap', this.fmt(def.cap), this.fmt(def.cap * rank))
        : I18N.t('craft_contrib', (def.contrib * 100).toFixed(0), (def.contrib * rank * 100).toFixed(0));
      const btn = row.querySelector('[data-buy]');
      const label = unlocked ? I18N.t('craft_buy') : I18N.t('craft_locked');
      btn.innerHTML = `<span>${label}</span><br>${this.costStr(GameState.upgradeCost(id))}`;
      btn.disabled = !unlocked || !GameState.canAffordUpgrade(id);
    }
    // a group heading is shown only when at least one of its items is unlocked
    for (const grp of UPGRADE_GROUPS) {
      const t = document.getElementById('craftfam-' + grp); if (!t) continue;
      let any = false;
      for (const id in UPGRADES) {
        if (UPGRADES[id].group !== grp) continue;
        if (GameState.upgradeUnlocked(id)) { any = true; break; }
      }
      t.hidden = !any;
    }
  },

  craftBuy(id) {
    if (GameState.craftUpgrade(id)) this.renderDynamic();
    else this.toast(I18N.t('toast_no_res'));
  },

  renderStatsTable() {
    this.renderStatWindows();
    this.renderSparks(true);
  },

  // window picker (5 min / 15 min / 1 h / 4 h) above the production graphs
  renderStatWindows() {
    const host = document.getElementById('stat-window'); if (!host) return;
    host.innerHTML = '';
    for (const w of STAT_WINDOWS) {
      const b = document.createElement('button');
      b.className = 'win-btn' + (GameState.state.stats.win === w.id ? ' active' : '');
      b.textContent = I18N.t('win_' + w.id);
      b.onclick = () => { GameState.state.stats.win = w.id; this.renderStatWindows(); this.renderSparks(true); };
      host.appendChild(b);
    }
  },

  // (re)build the list of graphs — one per resource that has stock or has flowed
  // within the selected window. The DOM is only rebuilt when that set changes.
  renderSparks(rebuild) {
    const s = GameState.state;
    const buf = s.stats.buf[s.stats.win] || {};
    const keys = [];
    for (const k in RESOURCES) if ((s.resources[k] || 0) > 0 || (buf[k] && buf[k].length)) keys.push(k);
    const host = document.getElementById('spark-list'); if (!host) return;
    const sig = s.stats.win + '|' + keys.join(',');
    if (rebuild || sig !== this._sparkSig) {
      this._sparkSig = sig;
      host.innerHTML = keys.length ? '' : `<div class="dim">${I18N.t('stat_empty')}</div>`;
      for (const k of keys) {
        const wrap = document.createElement('div'); wrap.className = 'spark';
        wrap.innerHTML =
          `<span class="lbl">${this.ic(k)} ${this.rn(k)}</span>
           <canvas id="spark-${k}" height="48"></canvas>
           <span class="spark-leg" id="leg-${k}"></span>`;
        host.appendChild(wrap);
      }
    }
    this.drawSparks();
  },

  /* ---------------- per-tick dynamic updates ---------------- */
  renderDynamic() {
    const s = GameState.state;

    for (const k in RESOURCES) {
      const row = document.getElementById('res-' + k); if (!row) continue;
      const amt = s.resources[k] || 0;
      const d = this.deltaRate(k);                   // smoothed /sec, matching the graphs
      row.hidden = amt <= 0 && Math.abs(d) <= 0.05;
      // show "amount / cap" for capped resources (science packs are uncapped); flag when full
      const cap = GameState.capFor(k);
      const amtEl = row.querySelector('[data-amt]');
      amtEl.textContent = isFinite(cap) ? `${this.fmt(amt)} / ${this.fmt(cap)}` : this.fmt(amt);
      amtEl.classList.toggle('full', isFinite(cap) && amt >= cap - 1e-6);
      const dEl = row.querySelector('[data-delta]');
      dEl.textContent = this.fmtDelta(d);
      dEl.className = 'delta ' + (d > 0.05 ? 'pos' : d < -0.05 ? 'neg' : 'zero');
    }

    // palette: visibility (locked tech ⇒ hidden), cost, affordability (⇒ disabled), active highlight
    const palette = document.getElementById('bld-palette');
    if (palette) {
      const warMode = MapView.mode === 'war';
      for (const btn of palette.querySelectorAll('.palette-btn')) {
        const t = btn.dataset.type;
        const unlocked = BUILDINGS[t] ? GameState.isBuildingUnlocked(t) : GameState.isPowerUnlocked(t);
        const mil = !!(BUILDINGS[t] && BUILDINGS[t].military);
        // war screen shows only military buildings; the factory hides them
        btn.hidden = !unlocked || (warMode ? !mil : mil);
        const cost = POWER[t] ? this.powerCost(t, GameState.placedOf(t)) : this.buildingCost(t, GameState.placedOf(t));
        btn.disabled = !this.canAfford(cost);
        btn.classList.toggle('active', MapView.place === t);
        btn.querySelector('[data-cost]').innerHTML = this.costStr(cost);
      }
      for (const grp of palette.querySelectorAll('.pal-group')) {
        grp.hidden = ![...grp.querySelectorAll('.palette-btn')].some(b => !b.hidden);
      }
    }

    this.updateCraftDynamic();

    // nudge the player to pick a technology: blink the research tab while nothing is queued
    const rtab = document.getElementById('lnav-research');
    if (rtab) rtab.classList.toggle('blink', !s.research.current);

    MapView.render();

    // energy tab + header badge appear only once the electric era is unlocked
    const powerOn = GameState.powerUnlocked();
    document.getElementById('lnav-energy').hidden = !powerOn;
    document.getElementById('hdr-power-badge').hidden = !powerOn;

    const pwr = this.lastPwr;
    // warn the player of a power deficit: blink the energy tab red when draw exceeds supply
    document.getElementById('lnav-energy').classList.toggle('blink-red', powerOn && pwr.consumed > pwr.produced + 1e-6);
    document.getElementById('energy-prod').textContent = this.fmt(pwr.produced);
    document.getElementById('energy-cons').textContent = this.fmt(pwr.consumed);
    const fill = document.getElementById('energy-fill');
    const pct = pwr.consumed > 0 ? Math.min(100, pwr.produced / pwr.consumed * 100) : 100;
    fill.style.width = pct + '%';
    fill.style.background = pct >= 99 ? 'var(--green)' : pct >= 50 ? 'var(--orange)' : 'var(--red)';
    const st = document.getElementById('energy-status');
    if (pwr.ratio >= 0.999) { st.textContent = I18N.t('energy_nominal'); st.style.color = 'var(--green)'; }
    else { st.textContent = I18N.t('energy_deficit', (pwr.ratio * 100) | 0); st.style.color = 'var(--red)'; }
    document.getElementById('hdr-power').textContent = `${this.fmt(pwr.produced)} / ${this.fmt(pwr.consumed)} MW`;
    if (powerOn && document.getElementById('lp-energy').checked) this.renderPowerGraph();

    document.getElementById('hdr-launches').textContent = s.launches;
    document.getElementById('hdr-bonus').textContent = '×' + s.launchBonus.toFixed(1);

    const bb = document.getElementById('bonus-body');
    if (bb) {
      const M = GameState.multipliers();
      const cm = GameState.craftMult(), fm = GameState.flowMult();
      const rm = GameState.researchMult(), ps = GameState.powerSupplyMult(), pc = GameState.powerConsumeMult();
      const global = M.speed * M.yield;
      const row = (label, val) => `<div class="bonus-row">${label}: <b>${val}</b></div>`;
      bb.innerHTML =
          row(I18N.t('bonus_launches'), s.launches)
        + row(I18N.t('bonus_multiplier'), '×' + s.launchBonus.toFixed(1))
        + row(I18N.t('bonus_craft'), '×' + cm.toFixed(2))
        + row(I18N.t('bonus_flow'), '×' + fm.toFixed(2))
        + row(I18N.t('bonus_speed'), '×' + M.speed.toFixed(2))
        + row(I18N.t('bonus_yield'), '×' + M.yield.toFixed(2))
        + row(I18N.t('bonus_research'), '×' + rm.toFixed(2))
        + row(I18N.t('bonus_power_supply'), '×' + ps.toFixed(2))
        + row(I18N.t('bonus_power_save'), '÷' + (1 / pc).toFixed(2))
        + row(I18N.t('bonus_storage'), this.fmt(GameState.storageCap()))
        + row(I18N.t('bonus_fluid'), this.fmt(GameState.fluidCap()))
        + `<div class="bonus-row bonus-total">${I18N.t('bonus_global')}: <b>×${this.fmt(global)}</b></div>`;
    }

    if (s.research.current) {
      const card = document.getElementById('tech-' + s.research.current);
      if (card) {
        const bar = card.querySelector('.progress > span'); if (bar) bar.style.width = (s.research.progress * 100) + '%';
        const stt = card.querySelector('.status'); if (stt) stt.textContent = (s.research.progress * 100 | 0) + '%';
      }
    }

    this.checkRocket();
    if (document.getElementById('rp-stats').checked) this.renderSparks(false);
  },

  /* ---------------- electricity statistics ---------------- */
  // generation history in the ENERGY panel — two series (produced vs consumed MW)
  // sharing the same time-window selection as the production graphs.
  renderPowerGraph() {
    const host = document.getElementById('power-list'); if (!host) return;
    if (!host.dataset.built) {
      host.innerHTML =
        `<div class="spark">
           <span class="lbl">⚡ ${I18N.t('energy_history')}</span>
           <canvas id="spark-power" height="48"></canvas>
           <span class="spark-leg" id="leg-power"></span>
         </div>`;
      host.dataset.built = '1';
    }
    this.drawPower();
  },
  drawPower() {
    const s = GameState.state;
    const buf = s.stats.buf[s.stats.win] || {};
    const prod = buf.__pProd || [], cons = buf.__pCons || [];
    const c = document.getElementById('spark-power'); if (!c) return;

    const leg = document.getElementById('leg-power');
    if (leg) {
      const p = prod.length ? prod[prod.length - 1] : 0;
      const q = cons.length ? cons[cons.length - 1] : 0;
      leg.innerHTML =
          `<span class="lg-rate pos">${this.fmt(p)} MW ${I18N.t('energy_prod_leg')}</span>`
        + `<span class="lg-rate neg">${this.fmt(q)} MW ${I18N.t('energy_cons_leg')}</span>`;
    }

    const w = c.clientWidth || 600; if (c.width !== w) c.width = w;
    const ctx = c.getContext('2d'), h = c.height, pad = 3;
    ctx.clearRect(0, 0, c.width, h);

    let max = 0;
    for (const v of prod) if (v > max) max = v;
    for (const v of cons) if (v > max) max = v;
    max = Math.max(1e-9, max);
    const yOf = v => h - pad - (v / max) * (h - 2 * pad);

    ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, yOf(0)); ctx.lineTo(c.width, yOf(0)); ctx.stroke();

    for (const [data, col] of [[prod, '#39d353'], [cons, '#e5534b']]) {
      if (data.length < 2) continue;
      ctx.beginPath();
      data.forEach((v, i) => {
        const x = i / (data.length - 1) * c.width;
        i ? ctx.lineTo(x, yOf(v)) : ctx.moveTo(x, yOf(v));
      });
      ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke();
    }
  },

  /* ---------------- statistics ---------------- */
  drawSparks() {
    const s = GameState.state;
    const buf = s.stats.buf[s.stats.win] || {};
    for (const k in RESOURCES) {
      const c = document.getElementById('spark-' + k); if (!c) continue;
      const data = buf[k] || [];

      const leg = document.getElementById('leg-' + k);
      if (leg) {
        const rate = data.length ? data[data.length - 1] : 0;
        let peak = 0; for (const v of data) { const a = Math.abs(v); if (a > peak) peak = a; }
        leg.innerHTML =
          `<span class="lg-stock">${this.fmt(s.resources[k] || 0)}</span>`
        + `<span class="lg-rate ${rate > 0.001 ? 'pos' : rate < -0.001 ? 'neg' : 'zero'}">${this.fmtDelta(rate)}/s</span>`
        + `<span class="lg-peak dim">↕${this.fmt(peak)}/s</span>`;
      }

      const w = c.clientWidth || 600; if (c.width !== w) c.width = w;
      const ctx = c.getContext('2d'), h = c.height, pad = 3;
      ctx.clearRect(0, 0, c.width, h);
      if (data.length < 2) continue;

      let max = -Infinity, min = Infinity;
      for (const v of data) { if (v > max) max = v; if (v < min) min = v; }
      if (min > 0) min = 0; if (max < 0) max = 0;           // keep the zero line on-chart
      const range = Math.max(1e-9, max - min);
      const yOf = v => h - pad - ((v - min) / range) * (h - 2 * pad);

      ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, yOf(0)); ctx.lineTo(c.width, yOf(0)); ctx.stroke();

      ctx.beginPath();
      data.forEach((v, i) => {
        const x = i / (data.length - 1) * c.width;
        i ? ctx.lineTo(x, yOf(v)) : ctx.moveTo(x, yOf(v));
      });
      ctx.strokeStyle = RESOURCES[k].color; ctx.lineWidth = 1.5; ctx.stroke();

      // endpoint labels: left = oldest stored sample, right = current value
      ctx.font = '10px var(--mono, monospace)';
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#7a7a7a';
      ctx.textAlign = 'left';
      ctx.fillText(this.fmtDelta(data[0]) + '/s', pad, pad);
      ctx.fillStyle = '#c8c8c8';
      ctx.textAlign = 'right';
      ctx.fillText(this.fmtDelta(data[data.length - 1]) + '/s', c.width - pad, pad);
    }
  },
  updateTotals() {
    const el = document.getElementById('stat-table'); if (!el) return;
    const s = GameState.state;
    let html = `<tr><th>${I18N.t('stat_resource')}</th><th>${I18N.t('stat_produced')}</th><th>${I18N.t('stat_consumed')}</th><th>${I18N.t('stat_net')}</th></tr>`;
    for (const k in RESOURCES) {
      const p = s.totals.produced[k] || 0, c = s.totals.consumed[k] || 0, n = s.resources[k] || 0;
      if (!p && !c && !n) continue;                          // skip resources never touched this run
      html += `<tr><td>${this.ic(k)} ${this.rn(k)}</td>
        <td>${this.fmt(p)}</td><td>${this.fmt(c)}</td><td>${this.fmt(n)}</td></tr>`;
    }
    el.innerHTML = html;
  },

  // surface the run's cumulative totals — shown on any reset (rocket launch or
  // hard RESET) just before the factory is wiped. Hidden during normal play.
  showTotalsModal() {
    this.updateTotals();
    document.getElementById('totals-modal').classList.remove('hidden');
  },
  closeTotals() { document.getElementById('totals-modal').classList.add('hidden'); },

  renderAll() {
    this.renderResources(); this.renderPalette(); this.renderCraft();
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
      document.getElementById('rocket-host').appendChild(host);
    }
    host.innerHTML = `
      <div class="rk-head">${I18N.t('rocket_head', ROCKET_GOAL)}</div>
      <div class="progress"><span style="width:${Math.min(100, (s.resources.rocketPart || 0) / ROCKET_GOAL * 100)}%;background:var(--orange)"></span></div>
      <div class="dim">${I18N.t('rocket_parts', this.fmt(s.resources.rocketPart || 0), ROCKET_GOAL)}</div>
      <button class="accent" ${ready ? '' : 'disabled'} onclick="UI.launch()">${I18N.t('rocket_launch')}</button>`;
  },
  launch() {
    const s = GameState.state;
    if ((s.resources.rocketPart || 0) < ROCKET_GOAL) return;
    const launches = s.launches + 1;
    const bonus = Math.pow(BALANCE.rocketBonus, launches);
    if (!confirm(I18N.t('confirm_launch', bonus.toFixed(1), launches))) return;
    this.showTotalsModal();                    // summarise the run before wiping it
    this.stop();
    GameState.fresh();
    GameState.state.launches = launches;
    GameState.state.launchBonus = bonus;
    const card = document.getElementById('rocket-card'); if (card) card.remove();
    Save.save();
    this.start();
    this.toast(I18N.t('toast_rocket_launched', bonus.toFixed(1)));
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
