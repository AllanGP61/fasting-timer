'use strict';

const MIN_TARGET_HOURS = 16;
const MAX_TARGET_HOURS = 36;
const DEFAULT_TARGET_HOURS = 20;
const HOUR_MS = 3600000;
const MINUTE_MS = 60000;
const TICK_MS = 10000;

const KEYS = {
  fasts: 'fastingTimer.fasts',
  activeFast: 'fastingTimer.activeFast',
  currentTarget: 'fastingTimer.currentTarget',
};

const $ = (id) => document.getElementById(id);

// ---------- Time helpers ----------
// Every stored time is a whole minute (seconds = 0), so start, end and duration always agree.

function floorToMinute(date) {
  return new Date(Math.floor(date.getTime() / MINUTE_MS) * MINUTE_MS);
}

function toMinuteISO(date) {
  return floorToMinute(date).toISOString();
}

const pad2 = (n) => String(n).padStart(2, '0');

// The <input type="datetime-local"> wants local time as YYYY-MM-DDTHH:MM.
function toLocalInputValue(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDayTime(date) {
  return `${WEEKDAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}, ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function formatElapsed(ms) {
  const totalMinutes = Math.floor(Math.max(0, ms) / MINUTE_MS);
  return `${Math.floor(totalMinutes / 60)}h ${pad2(totalMinutes % 60)}m`;
}

// Returns an error message, or null when the times are acceptable. `end` may be null (running fast).
function validateTimes(start, end) {
  const nowMinute = floorToMinute(new Date());
  if (Number.isNaN(start.getTime())) return 'Please choose a date and time.';
  if (start > nowMinute) return "The start time can't be in the future.";
  if (end !== null) {
    if (Number.isNaN(end.getTime())) return 'Please choose a date and time.';
    if (end > nowMinute) return "The end time can't be in the future.";
    if (end <= start) return 'The end time must be after the start time.';
  }
  return null;
}

// ---------- Storage ----------

function readJSON(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  } catch (err) {
    console.error('Could not read', key, err);
    return null;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    console.error('Could not save', key, err);
    alert("Couldn't save to this phone's storage. Your change was not kept.");
    return false;
  }
}

function removeKey(key) {
  try {
    localStorage.removeItem(key);
  } catch (err) {
    console.error('Could not remove', key, err);
  }
}

function loadTarget() {
  const value = readJSON(KEYS.currentTarget);
  const ok = Number.isInteger(value) && value >= MIN_TARGET_HOURS && value <= MAX_TARGET_HOURS;
  return ok ? value : DEFAULT_TARGET_HOURS;
}

function loadActiveFast() {
  const fast = readJSON(KEYS.activeFast);
  return fast && typeof fast.startISO === 'string' && !Number.isNaN(Date.parse(fast.startISO)) ? fast : null;
}

function loadFasts() {
  const fasts = readJSON(KEYS.fasts);
  return Array.isArray(fasts) ? fasts : [];
}

function makeId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ---------- State ----------

let targetHours = loadTarget();
let activeFast = loadActiveFast();

// ---------- Ring and readout ----------

const ringProgress = $('ring-progress');
const CIRCUMFERENCE = 2 * Math.PI * ringProgress.r.baseVal.value;
ringProgress.style.strokeDasharray = CIRCUMFERENCE;

function renderRing(elapsedMs, hours) {
  const targetMs = hours * HOUR_MS;
  const fraction = Math.min(Math.max(elapsedMs / targetMs, 0), 1);
  ringProgress.style.strokeDashoffset = CIRCUMFERENCE * (1 - fraction);
  ringProgress.classList.toggle('done', elapsedMs >= targetMs);
}

function render() {
  const elapsedMs = activeFast ? Math.max(0, Date.now() - Date.parse(activeFast.startISO)) : 0;
  renderRing(elapsedMs, targetHours);
  $('elapsed').textContent = formatElapsed(elapsedMs);
  $('readout-label').textContent = activeFast ? 'elapsed' : 'not fasting';

  const startTime = $('start-time');
  startTime.disabled = !activeFast;
  startTime.style.visibility = activeFast ? 'visible' : 'hidden';
  if (activeFast) startTime.textContent = `Started ${formatDayTime(new Date(activeFast.startISO))} · Change`;

  const button = $('start-stop');
  button.textContent = activeFast ? 'Stop' : 'Start';
  button.classList.toggle('stop', Boolean(activeFast));

  $('target-hours').textContent = targetHours;
  $('target-minus').disabled = targetHours <= MIN_TARGET_HOURS;
  $('target-plus').disabled = targetHours >= MAX_TARGET_HOURS;
}

// ---------- Time sheet (Start now / earlier time, Stop now / earlier time, edit) ----------

const sheet = $('sheet');
const sheetError = $('sheet-error');
const sheetChoice = $('sheet-choice');
const sheetPicker = $('sheet-picker');
const sheetInput = $('sheet-input');

// Resolves with a whole-minute Date, or null if cancelled.
// With nowLabel/earlierLabel it opens on a "now or earlier" choice; without them it opens straight on the picker.
function openTimeSheet({ title, nowLabel, earlierLabel, initial, validate }) {
  return new Promise((resolve) => {
    if (sheet.open) {
      resolve(null);
      return;
    }
    const finish = (value) => {
      resolve(value);
      if (sheet.open) sheet.close();
    };
    const showError = (message) => {
      sheetError.textContent = message || '';
      sheetError.hidden = !message;
    };
    const commit = (date) => {
      const error = validate(date);
      if (error) {
        showError(error);
        return;
      }
      finish(date);
    };
    const showPicker = (date) => {
      sheetChoice.hidden = true;
      sheetPicker.hidden = false;
      sheetInput.max = toLocalInputValue(floorToMinute(new Date()));
      sheetInput.value = toLocalInputValue(date);
      showError('');
    };

    $('sheet-title').textContent = title;
    showError('');
    const choiceMode = Boolean(nowLabel);
    sheetChoice.hidden = !choiceMode;
    sheetPicker.hidden = choiceMode;
    if (choiceMode) {
      $('sheet-now').textContent = nowLabel;
      $('sheet-earlier').textContent = earlierLabel;
    } else {
      showPicker(initial);
    }

    $('sheet-now').onclick = () => commit(floorToMinute(new Date()));
    $('sheet-earlier').onclick = () => showPicker(floorToMinute(new Date()));
    $('sheet-confirm').onclick = () => commit(floorToMinute(new Date(sheetInput.value)));
    $('sheet-cancel-choice').onclick = () => finish(null);
    $('sheet-cancel-picker').onclick = () => finish(null);
    sheet.onclick = (event) => {
      if (event.target === sheet) finish(null);
    };
    // Covers closing with the Escape key; a no-op if the sheet was already answered.
    sheet.onclose = () => resolve(null);
    sheet.showModal();
  });
}

// ---------- Actions ----------

async function startFast() {
  const start = await openTimeSheet({
    title: 'Start fast',
    nowLabel: 'Start now',
    earlierLabel: 'Start at an earlier time',
    validate: (date) => validateTimes(date, null),
  });
  if (!start) return;
  const fast = { startISO: toMinuteISO(start) };
  if (!writeJSON(KEYS.activeFast, fast)) return;
  activeFast = fast;
  render();
}

async function stopFast() {
  const start = new Date(activeFast.startISO);
  const end = await openTimeSheet({
    title: 'Stop fast',
    nowLabel: 'Stop now',
    earlierLabel: 'Stop at an earlier time',
    validate: (date) => validateTimes(start, date),
  });
  if (!end) return;

  const record = {
    id: makeId(),
    startISO: activeFast.startISO,
    endISO: toMinuteISO(end),
    targetHours,
  };
  const fasts = loadFasts();
  fasts.push(record);
  if (!writeJSON(KEYS.fasts, fasts)) return;

  removeKey(KEYS.activeFast);
  removeKey(KEYS.currentTarget);
  activeFast = null;
  targetHours = DEFAULT_TARGET_HOURS;
  render();
}

async function changeStartTime() {
  const start = await openTimeSheet({
    title: 'Change start time',
    initial: new Date(activeFast.startISO),
    validate: (date) => validateTimes(date, null),
  });
  if (!start) return;
  const fast = { ...activeFast, startISO: toMinuteISO(start) };
  if (!writeJSON(KEYS.activeFast, fast)) return;
  activeFast = fast;
  render();
}

function setTarget(hours) {
  const next = Math.min(MAX_TARGET_HOURS, Math.max(MIN_TARGET_HOURS, hours));
  if (!writeJSON(KEYS.currentTarget, next)) return;
  targetHours = next;
  render();
}

// ---------- Wiring ----------

$('start-stop').addEventListener('click', () => (activeFast ? stopFast() : startFast()));
$('start-time').addEventListener('click', changeStartTime);
$('target-minus').addEventListener('click', () => setTarget(targetHours - 1));
$('target-plus').addEventListener('click', () => setTarget(targetHours + 1));

// Timers pause while the phone is locked, so redraw as soon as the app is visible again.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') render();
});
window.addEventListener('pageshow', render);
setInterval(render, TICK_MS);
render();

// ---------- Offline support ----------

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('sw.js')
      .catch((err) => console.error('Service worker registration failed', err));
  });
}
