'use strict';

const MIN_TARGET_HOURS = 16;
const MAX_TARGET_HOURS = 36;
const DEFAULT_TARGET_HOURS = 20;
const HOUR_MS = 3600000;
const MINUTE_MS = 60000;

// Step 1 preview only: pretend a fast has been running for 13 hours.
const SAMPLE_ELAPSED_MS = 13 * HOUR_MS;

const $ = (id) => document.getElementById(id);

// ---------- Ring ----------

const ringProgress = $('ring-progress');
const CIRCUMFERENCE = 2 * Math.PI * ringProgress.r.baseVal.value;
ringProgress.style.strokeDasharray = CIRCUMFERENCE;

function formatElapsed(ms) {
  const totalMinutes = Math.floor(ms / MINUTE_MS);
  const minutes = String(totalMinutes % 60).padStart(2, '0');
  return `${Math.floor(totalMinutes / 60)}h ${minutes}m`;
}

function renderRing(elapsedMs, targetHours) {
  const targetMs = targetHours * HOUR_MS;
  const fraction = Math.min(Math.max(elapsedMs / targetMs, 0), 1);
  ringProgress.style.strokeDashoffset = CIRCUMFERENCE * (1 - fraction);
  ringProgress.classList.toggle('done', elapsedMs >= targetMs);
  $('elapsed').textContent = formatElapsed(elapsedMs);
}

// ---------- Target stepper ----------

let targetHours = DEFAULT_TARGET_HOURS;

function setTarget(hours) {
  targetHours = Math.min(MAX_TARGET_HOURS, Math.max(MIN_TARGET_HOURS, hours));
  $('target-hours').textContent = targetHours;
  $('target-minus').disabled = targetHours <= MIN_TARGET_HOURS;
  $('target-plus').disabled = targetHours >= MAX_TARGET_HOURS;
  renderRing(SAMPLE_ELAPSED_MS, targetHours);
}

$('target-minus').addEventListener('click', () => setTarget(targetHours - 1));
$('target-plus').addEventListener('click', () => setTarget(targetHours + 1));

setTarget(DEFAULT_TARGET_HOURS);

// ---------- Offline support ----------

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('sw.js')
      .catch((err) => console.error('Service worker registration failed', err));
  });
}
