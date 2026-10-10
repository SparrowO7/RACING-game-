// Entry point: build the game, hide the loading overlay, start the loop.
// Any startup error is surfaced on screen instead of failing silently.

import { Game } from './game.js';

const canvas = document.getElementById('game-canvas');
const loading = document.getElementById('loading');

try {
  const game = new Game(canvas);
  game.start();
  loading.classList.add('hidden');
  window.__game = game; // handy for debugging / automated testing
} catch (err) {
  console.error('NEON STREET RUN failed to start:', err);
  if (loading) loading.innerHTML = 'Failed to load<small>' + (err && err.message) + '</small>';
}
