// main.js — entry point. Exposes modules globally for inline HTML handlers and boots the game.
import { UI }        from './ui.js';
import { Research }  from './research.js';
import { MapView }   from './mapview.js';
import { GameState } from './gameState.js';
import { Biters }    from './biters.js';

// inline onclick="UI.x()" / "MapView.toggleWar()" handlers need these on the global scope
window.UI = UI;
window.Research = Research;
window.MapView = MapView;
window.GameState = GameState;
window.Biters = Biters;

window.addEventListener('DOMContentLoaded', () => UI.boot());
