'use strict';

// ---------- Back up everything / restore ----------
// One JSON file holding every fast and every mood. It never contains the OneDrive sign-in, the running fast
// or any settings. Restore only ever adds: nothing on the phone is deleted or overwritten.
// This file only defines things; app.js wires the buttons.

const BACKUP_APP = 'fasting-timer';
const BACKUP_VERSION = 1;

const validIso = (text) => typeof text === 'string' && !Number.isNaN(Date.parse(text));

// Pure: the text of the backup file.
function buildBackupJson(fasts, mood, now = new Date()) {
  const cleanFasts = fasts
    .map(({ id, startISO, endISO, targetHours }) => ({ id, startISO, endISO, targetHours }))
    .sort((a, b) => Date.parse(a.endISO) - Date.parse(b.endISO));
  return JSON.stringify({ app: BACKUP_APP, version: BACKUP_VERSION, exportedAt: now.toISOString(), fasts: cleanFasts, mood }, null, 2) + '\n';
}

function isValidBackupFast(fast) {
  return (
    Boolean(fast) &&
    typeof fast.id === 'string' &&
    fast.id.length > 0 &&
    fast.id.length <= 100 &&
    validIso(fast.startISO) &&
    validIso(fast.endISO) &&
    Date.parse(fast.endISO) > Date.parse(fast.startISO) &&
    Number.isInteger(fast.targetHours) &&
    fast.targetHours >= MIN_TARGET_HOURS &&
    fast.targetHours <= MAX_TARGET_HOURS
  );
}

function isValidBackupMoodDay(day, entry) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !entry || !moodFor(entry.value)) return false;
  const [year, month, date] = day.split('-').map(Number);
  const check = new Date(year, month - 1, date);
  return check.getFullYear() === year && check.getMonth() === month - 1 && check.getDate() === date;
}

// Pure: checks the file's text. Returns {ok: true, fasts, mood, skipped} or {ok: false, error}.
// Records that don't look right are dropped and counted rather than trusted.
function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: "That file couldn't be read as a backup." };
  }
  if (!data || typeof data !== 'object' || data.app !== BACKUP_APP) {
    return { ok: false, error: "That doesn't look like a Fasting Timer backup." };
  }
  if (!Number.isInteger(data.version) || data.version < 1 || data.version > BACKUP_VERSION) {
    return { ok: false, error: 'That backup was made by a different version of the app.' };
  }

  const rawFasts = Array.isArray(data.fasts) ? data.fasts : [];
  const rawMood = data.mood && typeof data.mood === 'object' && !Array.isArray(data.mood) ? data.mood : {};

  const seen = new Set();
  const fasts = [];
  for (const fast of rawFasts) {
    if (!isValidBackupFast(fast) || seen.has(fast.id)) continue;
    seen.add(fast.id);
    fasts.push({ id: fast.id, startISO: fast.startISO, endISO: fast.endISO, targetHours: fast.targetHours });
  }

  const mood = {};
  let badMood = 0;
  for (const [day, entry] of Object.entries(rawMood)) {
    if (isValidBackupMoodDay(day, entry)) mood[day] = { value: entry.value, at: typeof entry.at === 'string' ? entry.at : '' };
    else badMood += 1;
  }
  return { ok: true, fasts, mood, skipped: rawFasts.length - fasts.length + badMood };
}

// What restoring would add. Anything already on the phone (same fast id, same mood day) is left exactly as it is.
function planMerge(parsed) {
  const haveIds = new Set(loadFasts().map((fast) => fast.id));
  const haveDays = loadMood();
  return {
    newFasts: parsed.fasts.filter((fast) => !haveIds.has(fast.id)),
    newMood: Object.entries(parsed.mood).filter(([day]) => !haveDays[day]),
  };
}

// Adds the planned records. Returns true if everything was saved.
function applyMerge({ newFasts, newMood }) {
  if (newFasts.length > 0 && !writeJSON(KEYS.fasts, [...loadFasts(), ...newFasts])) return false;
  if (newMood.length > 0) {
    const mood = loadMood();
    for (const [day, entry] of newMood) mood[day] = entry;
    if (!writeJSON(KEYS.mood, mood)) return false;
  }
  return true;
}

function countsText(fastCount, moodCount) {
  const parts = [];
  if (fastCount > 0) parts.push(`${fastCount} ${fastCount === 1 ? 'fast' : 'fasts'}`);
  if (moodCount > 0) parts.push(`${moodCount} mood ${moodCount === 1 ? 'day' : 'days'}`);
  return parts.join(' and ');
}

function showBackupMessage(text) {
  const box = document.getElementById('backup-message');
  box.textContent = text;
  box.hidden = !text;
}

async function backUpEverything() {
  const fasts = loadFasts();
  const mood = loadMood();
  const moodDays = Object.keys(mood).length;
  if (fasts.length === 0 && moodDays === 0) {
    showBackupMessage("There's nothing to back up yet.");
    return;
  }
  const name = `fasting-timer-backup-${formatCsvDate(new Date())}.json`;
  const result = await shareOrDownload(new File([buildBackupJson(fasts, mood)], name, { type: 'application/json' }));
  const summary = countsText(fasts.length, moodDays);
  if (result !== 'cancelled') {
    writeJSON(KEYS.lastBackup, Date.now());
    renderBackupStatus();
  }
  showBackupMessage(result === 'cancelled' ? '' : result === 'shared' ? `Backup shared: ${summary}.` : `Backup downloaded: ${summary}.`);
}

async function restoreFromFile(file) {
  showBackupMessage('');
  let text;
  try {
    text = await file.text();
  } catch (err) {
    showBackupMessage("Couldn't open that file.");
    return;
  }
  const parsed = parseBackup(text);
  if (!parsed.ok) {
    showBackupMessage(parsed.error);
    return;
  }

  const plan = planMerge(parsed);
  const skippedNote =
    parsed.skipped === 0
      ? ''
      : parsed.skipped === 1
        ? ' (1 record in the file looked wrong and was skipped.)'
        : ` (${parsed.skipped} records in the file looked wrong and were skipped.)`;
  if (plan.newFasts.length === 0 && plan.newMood.length === 0) {
    showBackupMessage(`Nothing to add: everything in this backup is already on this phone.${skippedNote}`);
    return;
  }

  const summary = countsText(plan.newFasts.length, plan.newMood.length);
  const yes = await openAskSheet({
    title: 'Restore from backup?',
    message: `Add ${summary} from this backup? Nothing on this phone will be changed or removed.`,
    yesLabel: 'Add them',
    noLabel: 'Cancel',
  });
  if (!yes) {
    showBackupMessage('Restore cancelled. Nothing was changed.');
    return;
  }
  if (!applyMerge(plan)) return;

  render();
  renderLog();
  renderMoodHistory();
  if (plan.newFasts.length > 0) markLogChanged();
  showBackupMessage(`Restored: added ${summary}.${skippedNote}`);
}

async function onRestoreFileChosen(event) {
  const input = event.target;
  const file = input.files && input.files[0];
  try {
    if (file) await restoreFromFile(file);
  } finally {
    input.value = ''; // so the same file can be chosen again
  }
}

// ---------- When the last backup was made (shown on the folded Backup row) ----------

// Plain-English age of a moment, counted in calendar days: today, yesterday, 3 days ago, 2 weeks ago...
function backupAgeText(timestamp, now = new Date()) {
  const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.round((startOfDay(now) - startOfDay(new Date(timestamp))) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
}

function lastBackupAt() {
  const saved = readJSON(KEYS.lastBackup);
  return Number.isFinite(saved) && saved > 0 ? saved : null;
}

function renderBackupStatus() {
  const saved = lastBackupAt();
  document.getElementById('backup-status').textContent = saved ? `Last backed up ${backupAgeText(saved)}` : 'Not backed up yet';
}
