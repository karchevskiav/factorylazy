// i18n.js — minimal localization: a string table per language plus helpers to
// translate static DOM ([data-i18n] / [data-i18n-html]) and dynamic JS strings.
// UI chrome lives in `dict`; data-driven entity names (resources/buildings/tech/
// modules) are translated by key via `name()` using NAMES_RU (English data is the
// fallback). Selected language is persisted in localStorage.
import { NAMES_RU } from './data/names_ru.js';

export const I18N = {
  LANG_KEY: 'factorio_idle_lang',
  langs: ['en', 'ru'],
  lang: 'en',
  namesRu: NAMES_RU,

  init() {
    try { const s = localStorage.getItem(this.LANG_KEY); if (this.langs.includes(s)) this.lang = s; } catch (e) {}
  },
  set(lang) {
    if (!this.langs.includes(lang)) return;
    this.lang = lang;
    try { localStorage.setItem(this.LANG_KEY, lang); } catch (e) {}
  },
  next() { this.set(this.langs[(this.langs.indexOf(this.lang) + 1) % this.langs.length]); return this.lang; },
  label() { return this.lang.toUpperCase(); },

  // translate `key`, substituting {0},{1},… with the extra args
  t(key, ...args) {
    const table = this.dict[this.lang] || this.dict.en;
    const str = table[key] != null ? table[key] : (this.dict.en[key] != null ? this.dict.en[key] : key);
    return String(str).replace(/\{(\d+)\}/g, (_, i) => (args[i] != null ? args[i] : ''));
  },

  // translate a data-driven entity name by key; falls back to the English data name
  name(key, fallback) {
    if (this.lang === 'ru' && this.namesRu[key] != null) return this.namesRu[key];
    return fallback != null ? fallback : key;
  },

  // refresh every translatable static node currently in the DOM
  applyStatic(root = document) {
    root.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = this.t(el.dataset.i18n); });
    root.querySelectorAll('[data-i18n-html]').forEach(el => { el.innerHTML = this.t(el.dataset.i18nHtml); });
  },

  dict: {
    en: {
      title: '⚙ FACTORIO IDLE',
      hdr_rockets: 'ROCKETS', hdr_bonus: 'BONUS', hdr_pwr: 'PWR', reset: 'RESET',
      tab_factory: 'FACTORY', tab_research: 'RESEARCH', tab_stats: 'STATISTICS',
      ltab_resources: 'RES', ltab_build: 'BUILD', ltab_research: 'TECH', ltab_bonus: 'BONUS', ltab_energy: 'PWR', ltab_leaderboard: 'TOP',
      rtab_map: '🗺 MAP', rtab_stats: '📊 STATISTICS',
      sec_build: '🏗 BUILD', sec_bonus: '🏆 BONUS', sec_leaderboard: '🏅 LEADERBOARD', leaderboard_soon: 'Coming soon',
      pal_group_mining: 'MINING', pal_group_smelting: 'SMELTING', pal_group_crafting: 'CRAFTING', pal_group_power: 'POWER', pal_group_other: 'OTHER',
      bonus_launches: 'Rockets launched', bonus_multiplier: 'Production bonus',
      sec_resources: '📦 RESOURCES', sec_map: '🏭 FACTORY MAP',
      map_hint: '— pick a building, click to place · drag to pan · click trees/rocks to clear for resources · right-click to remove',
      toast_cleared: 'Cleared {0}: {1}', obstacle_tree: 'tree', obstacle_rock: 'boulder',
      sec_energy: '⚡ ENERGY',
      sec_tech: '🔬 TECHNOLOGY TREE — one research at a time',
      sec_prod: '📈 PRODUCTION', sec_totals: '📊 TOTALS',
      win_5m: '5 min', win_15m: '15 min', win_1h: '1 h', win_4h: '4 h',
      stat_empty: 'No production yet — place some buildings.',
      modal_save_h: 'SAVE DETECTED',
      modal_save_p: 'A previous factory was found in your browser.<br>Continue where you left off, or start fresh?',
      btn_continue: 'CONTINUE', btn_newgame: 'NEW GAME',
      modal_welcome_h: 'WELCOME BACK', btn_collect: 'COLLECT',
      modal_totals_h: 'RUN TOTALS', btn_close: 'CLOSE',
      energy_nominal: 'Nominal', energy_deficit: 'Deficit — production at {0}%',
      insp_mining: 'Mining:', insp_recipe: 'Recipe:', insp_modules: 'Modules:',
      insp_empty: 'Empty', insp_remove: '✕ Remove',
      insp_beacon: 'Boosts crafting speed of buildings within {0} tiles.',
      insp_lab: 'Performs research: consumes science packs of the active technology. More labs = faster research.',
      insp_turret: 'Gun turret · {0} ammo magazines loaded. (Defence is not active yet.)',
      insp_wall: 'Defensive wall — holds back the biters.',
      war_to_front: '⚔ To the biter front', war_to_factory: '🏭 Back to factory',
      pal_group_military: 'Military',
      insp_power_fuel: '+{0} MW · burns {1}/s {2}', insp_power_nofuel: '+{0} MW · no fuel',
      insp_reactor_neighbor: 'Neighbor bonus: +{0}% power per adjacent reactor. {1} adjacent → {2} MW (cluster reactors to boost output).',
      rocket_head: '🚀 Rocket Silo — build {0} Rocket Parts, then launch',
      rocket_parts: '{0} / {1} Rocket Parts', rocket_launch: 'LAUNCH ROCKET',
      stat_resource: 'Resource', stat_produced: 'Produced', stat_consumed: 'Consumed', stat_net: 'Net stock',
      tier: 'TIER {0}', tech_done: 'DONE', tech_available: 'AVAILABLE', tech_locked: 'LOCKED', tech_research: 'RESEARCH',
      toast_newgame: 'New game started',
      toast_research_modules: 'Research Modules first',
      toast_rocket_launched: '🚀 Rocket launched! Permanent bonus now ×{0}',
      toast_finish_research: 'Finish current research first',
      toast_req_not_met: 'Requirements not met',
      toast_researching: 'Researching: {0}', toast_researched: '✔ Researched {0}',
      toast_need_lab: 'Place a Lab on the map to run research',
      toast_locked: 'Locked — research required',
      toast_drill_ore: 'Drills must be placed on a matching ore patch',
      toast_pump_oil: 'Pumpjacks must be placed on a crude-oil patch',
      toast_blocked: 'Blocked — tiles occupied', toast_no_res: 'Not enough resources',
      confirm_reset: 'Wipe your save and start a brand-new game (new map)? This cannot be undone.',
      confirm_launch: 'Launch the rocket?\n\nThis RESETS your factory (and generates a NEW map) but grants a permanent ×1.5 production bonus (new total ×{0}). Rockets launched: {1}.',
      offline_text: 'You were away for <b>{0} h</b> (offline rate {1}%).<br><br>Produced:<br>{2}',
    },
    ru: {
      title: '⚙ FACTORIO IDLE',
      hdr_rockets: 'РАКЕТЫ', hdr_bonus: 'БОНУС', hdr_pwr: 'ЭНЕРГ', reset: 'СБРОС',
      tab_factory: 'ФАБРИКА', tab_research: 'НАУКА', tab_stats: 'СТАТИСТИКА',
      ltab_resources: 'РЕС', ltab_build: 'СТРОЙ', ltab_research: 'НАУКА', ltab_bonus: 'БОНУС', ltab_energy: 'ЭНЕРГ', ltab_leaderboard: 'ТОП',
      rtab_map: '🗺 КАРТА', rtab_stats: '📊 СТАТИСТИКА',
      sec_build: '🏗 СТРОИТЕЛЬСТВО', sec_bonus: '🏆 БОНУСЫ', sec_leaderboard: '🏅 ЛИДЕРБОРД', leaderboard_soon: 'Скоро',
      pal_group_mining: 'ДОБЫЧА', pal_group_smelting: 'ПЛАВКА', pal_group_crafting: 'ПРОИЗВОДСТВО', pal_group_power: 'ЭНЕРГИЯ', pal_group_other: 'ПРОЧЕЕ',
      bonus_launches: 'Запущено ракет', bonus_multiplier: 'Бонус производства',
      sec_resources: '📦 РЕСУРСЫ', sec_map: '🏭 КАРТА ФАБРИКИ',
      map_hint: '— выберите здание · клик — поставить · тянуть — двигать · клик по деревьям/камням — убрать за ресурсы · ПКМ — убрать',
      toast_cleared: 'Убрано ({0}): {1}', obstacle_tree: 'дерево', obstacle_rock: 'валун',
      sec_energy: '⚡ ЭНЕРГИЯ',
      sec_tech: '🔬 ДЕРЕВО ТЕХНОЛОГИЙ — по одному исследованию',
      sec_prod: '📈 ПРОИЗВОДСТВО', sec_totals: '📊 ИТОГИ',
      win_5m: '5 мин', win_15m: '15 мин', win_1h: '1 час', win_4h: '4 часа',
      stat_empty: 'Пока нет производства — постройте здания.',
      modal_save_h: 'НАЙДЕНО СОХРАНЕНИЕ',
      modal_save_p: 'В браузере найдена прежняя фабрика.<br>Продолжить с того же места или начать заново?',
      btn_continue: 'ПРОДОЛЖИТЬ', btn_newgame: 'НОВАЯ ИГРА',
      modal_welcome_h: 'С ВОЗВРАЩЕНИЕМ', btn_collect: 'ЗАБРАТЬ',
      modal_totals_h: 'ИТОГИ ЗАБЕГА', btn_close: 'ЗАКРЫТЬ',
      energy_nominal: 'Норма', energy_deficit: 'Дефицит — производство на {0}%',
      insp_mining: 'Добывает:', insp_recipe: 'Рецепт:', insp_modules: 'Модули:',
      insp_empty: 'Пусто', insp_remove: '✕ Убрать',
      insp_beacon: 'Ускоряет крафт зданий в радиусе {0} тайлов.',
      insp_lab: 'Ведёт исследования: тратит научные пакеты активной технологии. Больше лабораторий — быстрее наука.',
      insp_turret: 'Пулемётная турель · заряжено магазинов: {0}. (Оборона пока не активна.)',
      insp_wall: 'Оборонительная стена — сдерживает кусак.',
      war_to_front: '⚔ На экран войны с кусаками', war_to_factory: '🏭 Назад на фабрику',
      pal_group_military: 'Военные',
      insp_power_fuel: '+{0} МВт · сжигает {1}/с {2}', insp_power_nofuel: '+{0} МВт · без топлива',
      insp_reactor_neighbor: 'Бонус соседства: +{0}% мощности за каждый смежный реактор. Смежных: {1} → {2} МВт (стройте реакторы вплотную).',
      rocket_head: '🚀 Ракетная шахта — соберите {0} частей ракеты и запускайте',
      rocket_parts: '{0} / {1} частей ракеты', rocket_launch: 'ЗАПУСТИТЬ РАКЕТУ',
      stat_resource: 'Ресурс', stat_produced: 'Произведено', stat_consumed: 'Потреблено', stat_net: 'Запас',
      tier: 'УРОВЕНЬ {0}', tech_done: 'ГОТОВО', tech_available: 'ДОСТУПНО', tech_locked: 'ЗАКРЫТО', tech_research: 'ИЗУЧИТЬ',
      toast_newgame: 'Новая игра начата',
      toast_research_modules: 'Сначала исследуйте «Модули»',
      toast_rocket_launched: '🚀 Ракета запущена! Постоянный бонус теперь ×{0}',
      toast_finish_research: 'Сначала завершите текущее исследование',
      toast_req_not_met: 'Требования не выполнены',
      toast_researching: 'Исследуется: {0}', toast_researched: '✔ Исследовано: {0}',
      toast_need_lab: 'Постройте лабораторию на карте для исследований',
      toast_locked: 'Заблокировано — нужно исследование',
      toast_drill_ore: 'Бур нужно ставить на месторождение руды',
      toast_pump_oil: 'Качалку нужно ставить на месторождение нефти',
      toast_blocked: 'Занято — тайлы заняты', toast_no_res: 'Недостаточно ресурсов',
      confirm_reset: 'Стереть сохранение и начать новую игру (новая карта)? Действие необратимо.',
      confirm_launch: 'Запустить ракету?\n\nЭто СБРОСИТ фабрику (и создаст НОВУЮ карту), но даст постоянный бонус ×1.5 к производству (новый итог ×{0}). Запущено ракет: {1}.',
      offline_text: 'Вас не было <b>{0} ч</b> (офлайн-ставка {1}%).<br><br>Произведено:<br>{2}',
    },
  },
};
