// data/modules.js — modules inserted into building slots.
// speed/yield are additive multipliers · energy is additive consumption modifier.
export const MODULES = {
  speed:        {name:'Speed Module',        icon:'»', speed:+0.5,  yield:0,    energy:+0.3},
  productivity: {name:'Productivity Module',  icon:'+', speed:-0.15, yield:+0.1, energy:+0.0},
  efficiency:   {name:'Efficiency Module',    icon:'⌁', speed:0,     yield:0,    energy:-0.3},
};
