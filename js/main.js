// main.js — entry point. Exposes UI/Research globally for inline HTML handlers and boots the game.
import { UI }       from './ui.js';
import { Research } from './research.js';

// inline onclick="UI.x()" / onclick="Research.start()" handlers need these on the global scope
window.UI = UI;
window.Research = Research;

window.addEventListener('DOMContentLoaded', () => UI.boot());
