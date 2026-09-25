'use strict';

const MIN_TARGET_HOURS = 16;
const MAX_TARGET_HOURS = 36;
const DEFAULT_TARGET_HOURS = 20;
const HOUR_MS = 3600000;
const MINUTE_MS = 60000;
const TICK_MS = 10000;
const FORGOTTEN_AFTER_MS = 4 * HOUR_MS;
const FAT_BURNING_HOURS = 16; // elapsed time from which the ring shows the orange fat-burning zone

const KEYS = {
  fasts: 'fastingTimer.fasts',
  activeFast: 'fastingTimer.activeFast',
  currentTarget: 'fastingTimer.currentTarget',
  mood: 'fastingTimer.mood',
  lastBackup: 'fastingTimer.lastBackup',
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

const formatDay = (date) => `${WEEKDAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}`;
const formatClock = (date) => `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
const formatDayTime = (date) => `${formatDay(date)}, ${formatClock(date)}`;

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatMinutes(totalMinutes) {
  return `${Math.floor(totalMinutes / 60)}h ${pad2(totalMinutes % 60)}m`;
}

function formatElapsed(ms) {
  return formatMinutes(Math.floor(Math.max(0, ms) / MINUTE_MS));
}

// Whole minutes between a completed fast's start and end (both are whole minutes already).
function durationMinutes(fast) {
  return Math.floor((Date.parse(fast.endISO) - Date.parse(fast.startISO)) / MINUTE_MS);
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

const ringProgress = $('ring-progress'); // blue arc (turns green at the target)
const ringZone = $('ring-zone'); // orange arc: the fat-burning zone
const ringStartCap = $('ring-start-cap');
const ringTick = $('ring-tick'); // thin mark at the 16-hour boundary
const RING_RADIUS = ringProgress.r.baseVal.value;
const RING_CENTRE = 100; // centre of the ring's 200 x 200 drawing
const CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
ringProgress.style.strokeDasharray = CIRCUMFERENCE;

// Where each part of the ring runs, as fractions (0 to 1) of the way round from 12 o'clock.
// The ring spans 0 hours to the target, so the 16-hour boundary sits at 16 / target of the way round.
//   blue:  the blue arc runs from 0 to this.
//   zoneStart..zoneEnd: the orange arc (equal when there is no orange yet).
//   tick:  where the boundary tick sits (null when the target is 16 hours or less, so there is no zone).
//   done:  the target has been reached, so the whole ring goes green.
function ringSegments(elapsedMs, targetHours) {
  const clamp = (value) => Math.min(Math.max(value, 0), 1);
  const targetMs = targetHours * HOUR_MS;
  const zoneStart = clamp((FAT_BURNING_HOURS * HOUR_MS) / targetMs);
  const tick = zoneStart < 1 ? zoneStart : null;
  if (elapsedMs >= targetMs) return { done: true, blue: 1, zoneStart, zoneEnd: zoneStart, tick };
  const elapsed = clamp(elapsedMs / targetMs);
  if (elapsed <= zoneStart) return { done: false, blue: elapsed, zoneStart, zoneEnd: zoneStart, tick };
  return { done: false, blue: zoneStart, zoneStart, zoneEnd: elapsed, tick };
}

function renderRing(elapsedMs, hours) {
  const segments = ringSegments(elapsedMs, hours);
  const hasZone = segments.zoneEnd > segments.zoneStart;

  ringProgress.style.strokeDashoffset = CIRCUMFERENCE * (1 - segments.blue);
  ringProgress.classList.toggle('done', segments.done);
  // While orange shows, the blue arc ends flat exactly on the boundary and the start cap keeps its rounded start.
  ringProgress.classList.toggle('has-zone', hasZone);
  ringStartCap.style.visibility = hasZone ? 'visible' : 'hidden';

  ringZone.style.visibility = hasZone ? 'visible' : 'hidden';
  ringZone.style.strokeDasharray = `${(segments.zoneEnd - segments.zoneStart) * CIRCUMFERENCE} ${CIRCUMFERENCE}`;
  ringZone.style.strokeDashoffset = -segments.zoneStart * CIRCUMFERENCE;

  ringTick.style.visibility = segments.tick === null ? 'hidden' : 'visible';
  if (segments.tick !== null) {
    const angle = segments.tick * 2 * Math.PI;
    const reach = 7 + 4; // half the ring's thickness, plus a little beyond it on each side
    ringTick.setAttribute('x1', RING_CENTRE + (RING_RADIUS - reach) * Math.cos(angle));
    ringTick.setAttribute('y1', RING_CENTRE + (RING_RADIUS - reach) * Math.sin(angle));
    ringTick.setAttribute('x2', RING_CENTRE + (RING_RADIUS + reach) * Math.cos(angle));
    ringTick.setAttribute('y2', RING_CENTRE + (RING_RADIUS + reach) * Math.sin(angle));
  }
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

  renderRingMood();
}

// ---------- Log ----------

function makeEl(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function makeLogRow(fast) {
  const start = new Date(fast.startISO);
  const end = new Date(fast.endISO);
  const minutes = durationMinutes(fast);
  const targetMet = minutes >= fast.targetHours * 60;
  const times = isSameDay(start, end)
    ? `${formatClock(start)} → ${formatClock(end)}`
    : `${formatDay(start)} ${formatClock(start)} → ${formatClock(end)}`;

  const head = makeEl('div', 'log-head');
  head.append(makeEl('span', 'log-date', formatDay(end)), makeEl('span', targetMet ? 'log-duration met' : 'log-duration', formatMinutes(minutes)));
  const detail = makeEl('div', 'log-detail');
  detail.append(makeEl('span', '', times), makeEl('span', '', `Target ${fast.targetHours}h`));

  const button = makeEl('button', 'log-btn');
  button.type = 'button';
  button.dataset.id = fast.id;
  button.append(head, detail);
  const row = makeEl('li', 'log-row');
  row.append(button);
  return row;
}

// Newest first. A fast is filed under the date it ended.
function renderLog() {
  const fasts = loadFasts()
    .slice()
    .sort((a, b) => Date.parse(b.endISO) - Date.parse(a.endISO) || Date.parse(b.startISO) - Date.parse(a.startISO));
  $('log-empty').hidden = fasts.length > 0;
  $('log-hint').hidden = fasts.length === 0;
  $('export-csv').disabled = fasts.length === 0;
  $('log-count').textContent = fasts.length === 0 ? '' : fasts.length === 1 ? '1 fast' : `${fasts.length} fasts`;
  $('log-list').replaceChildren(...fasts.map(makeLogRow));
}

// ---------- CSV export ----------

const CSV_FILENAME = 'fasting-log.csv';
const CSV_COLUMNS = ['Date', 'Start', 'End', 'Hours', 'Minutes', 'Target'];

const formatCsvDate = (date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
const formatCsvDateTime = (date) => `${formatCsvDate(date)} ${formatClock(date)}`;

// The one place the CSV text is produced. Pure: takes the fasts array, returns the file contents.
// One row per completed fast, newest first. Date is the day the fast ended; times are local; no rounding.
function buildCsvFromLog(fasts) {
  const rows = fasts
    .slice()
    .sort((a, b) => Date.parse(b.endISO) - Date.parse(a.endISO) || Date.parse(b.startISO) - Date.parse(a.startISO))
    .map((fast) => {
      const minutes = durationMinutes(fast);
      return [
        formatCsvDate(new Date(fast.endISO)),
        formatCsvDateTime(new Date(fast.startISO)),
        formatCsvDateTime(new Date(fast.endISO)),
        Math.floor(minutes / 60),
        minutes % 60,
        fast.targetHours,
      ];
    });
  return [CSV_COLUMNS, ...rows].map((row) => row.join(',')).join('\r\n') + '\r\n';
}

function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// Opens the iPhone share sheet with the file (choose OneDrive or Files there). Falls back to a plain download.
// Resolves 'shared', 'cancelled' (the share sheet was dismissed) or 'downloaded'.
async function shareOrDownload(file) {
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return 'shared';
    } catch (err) {
      if (err.name === 'AbortError') return 'cancelled';
      console.error('Share failed, downloading instead', err);
    }
  }
  downloadFile(file);
  return 'downloaded';
}

async function exportCsv() {
  const fasts = loadFasts();
  if (fasts.length === 0) return;
  await shareOrDownload(new File([buildCsvFromLog(fasts)], CSV_FILENAME, { type: 'text/csv' }));
}

function showView(name) {
  for (const view of ['timer', 'log', 'more']) {
    $(`view-${view}`).hidden = view !== name;
    $(`tab-${view}`).setAttribute('aria-selected', String(view === name));
  }
  if (name === 'log') renderLog();
  if (name === 'more') {
    renderMoodHistory();
    renderBackupStatus();
  } else {
    $('backup-details').open = false; // Backup starts folded up each time More is opened
  }
  window.scrollTo(0, 0);
}

// ---------- Sheet (bottom pop-up for time choices, editing and confirmations) ----------

const sheet = $('sheet');
const SHEET_VIEWS = ['choice', 'picker', 'edit', 'mood', 'ask'];

function setSheetError(message) {
  $('sheet-error').textContent = message || '';
  $('sheet-error').hidden = !message;
}

function showSheetView(name) {
  for (const view of SHEET_VIEWS) $(`sheet-${view}`).hidden = view !== name;
  setSheetError('');
}

// Opens the sheet and resolves with whatever `finish` is called with, or null if it is dismissed.
function runSheet(title, setup) {
  return new Promise((resolve) => {
    if (sheet.open) {
      resolve(null);
      return;
    }
    const finish = (value) => {
      resolve(value);
      if (sheet.open) sheet.close();
    };
    $('sheet-title').textContent = title;
    setup(finish);
    sheet.onclick = (event) => {
      if (event.target === sheet) finish(null);
    };
    // "cancel" fires only when the user dismisses the sheet (Escape / back gesture). Unlike "close" it is
    // not triggered by our own sheet.close(), whose late event would otherwise cancel the next sheet.
    sheet.oncancel = (event) => {
      event.preventDefault();
      finish(null);
    };
    sheet.showModal();
  });
}

const nowLocalInput = () => toLocalInputValue(floorToMinute(new Date()));

// Resolves with a whole-minute Date, or null if cancelled.
// With nowLabel/earlierLabel it opens on a "now or earlier" choice; without them it opens straight on the picker.
function openTimeSheet({ title, nowLabel, earlierLabel, initial, validate }) {
  return runSheet(title, (finish) => {
    const input = $('sheet-input');
    const commit = (date) => {
      const error = validate(date);
      if (error) setSheetError(error);
      else finish(date);
    };
    const showPicker = (date) => {
      showSheetView('picker');
      input.max = nowLocalInput();
      input.value = toLocalInputValue(date);
    };

    if (nowLabel) {
      showSheetView('choice');
      $('sheet-now').textContent = nowLabel;
      $('sheet-earlier').textContent = earlierLabel;
    } else {
      showPicker(initial);
    }

    $('sheet-now').onclick = () => commit(floorToMinute(new Date()));
    $('sheet-earlier').onclick = () => showPicker(floorToMinute(new Date()));
    $('sheet-confirm').onclick = () => commit(floorToMinute(new Date(input.value)));
    $('sheet-cancel-choice').onclick = () => finish(null);
    $('sheet-cancel-picker').onclick = () => finish(null);
  });
}

// Resolves with {action: 'save', start, end}, {action: 'delete'}, or null if dismissed.
function openEditSheet(fast) {
  return runSheet('Edit fast', (finish) => {
    const startInput = $('edit-start');
    const endInput = $('edit-end');
    showSheetView('edit');
    startInput.max = nowLocalInput();
    endInput.max = nowLocalInput();
    startInput.value = toLocalInputValue(new Date(fast.startISO));
    endInput.value = toLocalInputValue(new Date(fast.endISO));

    $('edit-save').onclick = () => {
      const start = floorToMinute(new Date(startInput.value));
      const end = floorToMinute(new Date(endInput.value));
      const error = validateTimes(start, end);
      if (error) setSheetError(error);
      else finish({ action: 'save', start, end });
    };
    $('edit-cancel').onclick = () => finish(null);
    $('edit-delete').onclick = () => {
      $('sheet-title').textContent = 'Delete fast?';
      showSheetView('ask');
      $('ask-message').textContent = `Delete the fast that ended ${formatDayTime(new Date(fast.endISO))}? This can't be undone.`;
      $('ask-yes').textContent = 'Delete';
      $('ask-yes').className = 'sheet-btn danger-solid';
      $('ask-no').textContent = 'Keep it';
      $('ask-yes').onclick = () => finish({ action: 'delete' });
      $('ask-no').onclick = () => {
        $('sheet-title').textContent = 'Edit fast';
        showSheetView('edit');
      };
    };
  });
}

// Resolves true if the main button is pressed, false for the other button or if dismissed.
async function openAskSheet({ title, message, yesLabel, noLabel }) {
  const answer = await runSheet(title, (finish) => {
    showSheetView('ask');
    $('ask-message').textContent = message;
    $('ask-yes').textContent = yesLabel;
    $('ask-yes').className = 'sheet-btn main';
    $('ask-no').textContent = noLabel;
    $('ask-yes').onclick = () => finish(true);
    $('ask-no').onclick = () => finish(false);
  });
  return answer === true;
}

// ---------- OneDrive connection (the sign-in itself lives in onedrive.js) ----------

let onedriveNotice = '';
let onedriveMessage = '';

const inHomeScreenApp = () => window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;

function describeWhen(timestamp) {
  const date = new Date(timestamp);
  return isSameDay(date, new Date()) ? `today ${formatClock(date)}` : formatDayTime(date);
}

// One line saying where the OneDrive copy has got to.
function syncNote(status) {
  if (!status.connected || status.needsReconnect) return '';
  if (status.uploading) return 'Uploading…';
  if (status.pending) return status.lastError ? `Waiting to upload. ${status.lastError} Will retry.` : 'Waiting to upload…';
  return status.lastUploadAt ? `Uploaded ${describeWhen(status.lastUploadAt)}.` : 'Nothing to upload yet.';
}

function renderOneDrive() {
  const row = $('onedrive-row');
  const alert = $('onedrive-alert');
  row.hidden = !onedriveConfigured();
  if (row.hidden) {
    alert.hidden = true;
    return;
  }

  const connection = getOnedriveConnection();
  const status = oneDriveSyncStatus();
  // Safari and the home-screen icon keep separate storage, so say so if the app was opened the wrong way.
  const where = inHomeScreenApp() ? '' : ' (Safari tab: use the home-screen icon)';
  const action = $('onedrive-action');
  // If Microsoft has refused a quiet renewal, say so plainly, when the sign-in runs out, and offer Reconnect.
  const refusal = connection && !status.needsReconnect ? quietRefusal() : null;
  const expiresAt = onedriveExpiresAt(connection);
  const refusalNote = refusal
    ? `Microsoft refused a quiet renewal (${describeWhen(refusal.at)}), so this sign-in runs out ${describeWhen(expiresAt)}. Tap Reconnect before then.`
    : '';
  const note = [syncNote(status), refusalNote, onedriveMessage].filter(Boolean).join(' ');
  $('onedrive-note').hidden = !note;
  $('onedrive-note').textContent = note;
  $('onedrive-signin').hidden = !connection;
  if (connection) $('onedrive-signin').textContent = `Signed in ${describeWhen(connection.signedInAt)}`;
  $('onedrive-refresh').hidden = !connection || status.needsReconnect || Boolean(refusal);
  $('onedrive-reconnect').hidden = !refusal;

  if (status.needsReconnect) {
    $('onedrive-status').textContent = 'OneDrive: sign-in expired';
    action.textContent = 'Reconnect';
    action.dataset.action = 'connect';
  } else if (connection) {
    $('onedrive-status').textContent = `OneDrive: connected as ${connection.account}${where}`;
    action.textContent = 'Disconnect';
    action.dataset.action = 'disconnect';
  } else {
    $('onedrive-status').textContent = onedriveNotice ? `OneDrive: ${onedriveNotice}` : `OneDrive: not connected${where}`;
    action.textContent = onedriveNotice ? 'Try again' : 'Connect';
    action.dataset.action = 'connect';
  }

  // A problem shows on the Timer tab too, so it isn't missed.
  const runsOutSoon = Boolean(refusal && expiresAt && expiresAt - Date.now() < 4 * 3600000);
  const needsReconnectNow = status.needsReconnect || runsOutSoon;
  alert.hidden = !(needsReconnectNow || (status.connected && status.pending && status.lastError));
  alert.dataset.action = needsReconnectNow ? 'reconnect' : 'log';
  alert.textContent = status.needsReconnect
    ? 'OneDrive: sign-in expired. Tap to reconnect.'
    : runsOutSoon
      ? 'OneDrive: sign-in runs out soon. Tap to reconnect.'
      : 'OneDrive: not uploaded yet. Tap for details.';
}

// Starts a full (visible) Microsoft sign-in. Used by Connect, Reconnect and the amber line.
async function reconnectOneDrive() {
  onedriveNotice = '';
  try {
    await connectOneDrive();
  } catch (err) {
    console.error('Could not start the OneDrive sign-in', err);
    onedriveNotice = "couldn't start the sign-in.";
    renderOneDrive();
  }
}

async function onOneDriveAction() {
  if ($('onedrive-action').dataset.action === 'disconnect') {
    const disconnect = await openAskSheet({
      title: 'Disconnect OneDrive?',
      message: 'The app will stop uploading until you connect again. Your fasts stay on this phone.',
      yesLabel: 'Disconnect',
      noLabel: 'Keep connected',
    });
    if (!disconnect) return;
    disconnectOneDrive();
    onedriveNotice = '';
    onedriveMessage = '';
    renderOneDrive();
    return;
  }
  await reconnectOneDrive();
}

// Runs at load: finishes a sign-in if this page load is Microsoft sending the browser back.
async function initOneDrive() {
  const result = await handleAuthRedirect();
  if (result.handled) {
    if (!result.silent) {
      onedriveNotice = result.error ? `sign-in failed. ${result.error}` : '';
      if (result.connected) markLogChanged();
      showView('log');
    } else if (result.manual) {
      onedriveMessage = result.connected
        ? 'Sign-in refreshed.'
        : "Couldn't refresh quietly.";
      showView('log');
    } else if (result.error) {
      // A background renewal that didn't work is only shown if the sign-in later actually expires.
      console.warn('Quiet OneDrive sign-in renewal did not work:', result.error);
    }
  }
  renderOneDrive();
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

// With pickTime the sheet opens straight on the date/time picker (used by the "forgot to stop" prompt).
async function stopFast({ pickTime = false } = {}) {
  const start = new Date(activeFast.startISO);
  const validate = (date) => validateTimes(start, date);
  const end = await openTimeSheet(
    pickTime
      ? { title: 'Stop fast', initial: floorToMinute(new Date()), validate }
      : { title: 'Stop fast', nowLabel: 'Stop now', earlierLabel: 'Stop at an earlier time', validate }
  );
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
  renderLog();
  markLogChanged();
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

async function editFast(id) {
  const fasts = loadFasts();
  const fast = fasts.find((item) => item.id === id);
  if (!fast) return;
  const result = await openEditSheet(fast);
  if (!result) return;

  const updated =
    result.action === 'delete'
      ? fasts.filter((item) => item.id !== id)
      : fasts.map((item) =>
          item.id === id ? { ...item, startISO: toMinuteISO(result.start), endISO: toMinuteISO(result.end) } : item
        );
  if (!writeJSON(KEYS.fasts, updated)) return;
  renderLog();
  markLogChanged();
}

let forgottenPromptOpen = false;

// If a running fast is more than 4 hours past its target, ask whether the Stop was forgotten.
// Runs when the app opens or comes back to the screen, not on every tick, so "Keep going" isn't nagged.
async function checkForgottenStop() {
  if (!activeFast || forgottenPromptOpen || sheet.open) return;
  const elapsedMs = Date.now() - Date.parse(activeFast.startISO);
  const overMs = elapsedMs - targetHours * HOUR_MS;
  if (overMs <= FORGOTTEN_AFTER_MS) return;

  forgottenPromptOpen = true;
  try {
    const setEnd = await openAskSheet({
      title: 'Did you forget to stop?',
      message: `This fast has been running for ${formatElapsed(elapsedMs)}, which is ${formatMinutes(Math.floor(overMs / MINUTE_MS))} past your ${targetHours}h target.`,
      yesLabel: 'Set the actual end time',
      noLabel: 'Keep going',
    });
    if (setEnd) await stopFast({ pickTime: true });
  } finally {
    forgottenPromptOpen = false;
  }
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
$('mood-btn').addEventListener('click', chooseMood);
$('export-csv').addEventListener('click', exportCsv);
$('onedrive-action').addEventListener('click', onOneDriveAction);
$('onedrive-alert').addEventListener('click', () => ($('onedrive-alert').dataset.action === 'reconnect' ? reconnectOneDrive() : showView('log')));
$('onedrive-reconnect').addEventListener('click', reconnectOneDrive);
$('onedrive-refresh').addEventListener('click', () => {
  onedriveMessage = 'Refreshing…';
  renderOneDrive();
  connectOneDrive({ silent: true, manual: true });
});
onedriveHooks.changed = renderOneDrive;
$('tab-timer').addEventListener('click', () => showView('timer'));
$('tab-log').addEventListener('click', () => showView('log'));
$('tab-more').addEventListener('click', () => showView('more'));
$('backup-btn').addEventListener('click', backUpEverything);
$('restore-btn').addEventListener('click', () => $('restore-file').click());
$('restore-file').addEventListener('change', onRestoreFileChosen);
// The Backup row now sits below the mood list, so bring it fully into view when it opens.
$('backup-details').addEventListener('toggle', () => {
  if ($('backup-details').open) $('backup-details').scrollIntoView({ block: 'nearest' });
});

$('log-list').addEventListener('click', (event) => {
  const row = event.target.closest('.log-btn');
  if (row) editFast(row.dataset.id);
});

// Timers pause while the phone is locked, so redraw as soon as the app is visible again.
function onAppVisible() {
  render();
  checkForgottenStop();
  // Renew an aging OneDrive sign-in first (it leaves the page briefly); otherwise catch up on any waiting upload.
  const renewing = sheet.open ? Promise.resolve(false) : maybeQuietSignIn();
  renewing.then((started) => {
    if (!started) syncOneDrive();
  });
}
window.addEventListener('online', syncOneDrive);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') onAppVisible();
});
window.addEventListener('pageshow', onAppVisible);
setInterval(() => {
  render();
  syncIfDue();
}, TICK_MS);
render();
renderLog();
checkForgottenStop();
initOneDrive();

// ---------- Offline support ----------

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('sw.js')
      .catch((err) => console.error('Service worker registration failed', err));
  });
}
