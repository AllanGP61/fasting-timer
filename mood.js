'use strict';

// ---------- Daily mood journal ----------
// One mood per calendar day, kept under its own storage key so the fast log is never touched.
// This file only defines things; app.js wires them up (it uses KEYS, readJSON, writeJSON, runSheet and friends).

const MOODS = [
  { value: 1, face: '\u{1F61E}', label: 'Very low' },
  { value: 2, face: '\u{1F641}', label: 'Low' },
  { value: 3, face: '\u{1F610}', label: 'OK' },
  { value: 4, face: '\u{1F642}', label: 'Good' },
  { value: 5, face: '\u{1F604}', label: 'Very good' },
];

function moodFor(value) {
  return MOODS.find((mood) => mood.value === value) || null;
}

// The whole store: { 'YYYY-MM-DD': { value: 1-5, at: ISO time it was chosen } }. Malformed entries are ignored.
function loadMood() {
  const saved = readJSON(KEYS.mood);
  const clean = {};
  if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
    for (const [day, entry] of Object.entries(saved)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(day) && entry && moodFor(entry.value)) clean[day] = entry;
    }
  }
  return clean;
}

// Today's key is the phone's local calendar date, so it follows GMT/BST and rolls over at local midnight.
const moodDayKey = (date = new Date()) => formatCsvDate(date);

function todaysMood() {
  return loadMood()[moodDayKey()] || null;
}

// Returns true if it was saved.
function setTodaysMood(value) {
  const mood = loadMood();
  mood[moodDayKey()] = { value, at: new Date().toISOString() };
  return writeJSON(KEYS.mood, mood);
}

// The centre of the ring: the word "Mood" until today's mood is logged, then the chosen face.
function renderRingMood() {
  const button = document.getElementById('mood-btn');
  const entry = todaysMood();
  const mood = entry && moodFor(entry.value);
  button.classList.toggle('logged', Boolean(mood));
  button.textContent = mood ? mood.face : 'Mood';
  button.setAttribute('aria-label', mood ? `Today's mood: ${mood.label.toLowerCase()}. Tap to change.` : "Log today's mood");
}

// Resolves with 1-5, or null if the row was dismissed. Tapping a face chooses it straight away.
function openMoodSheet(current) {
  return runSheet('How are you today?', (finish) => {
    showSheetView('mood');
    document.getElementById('mood-row').replaceChildren(
      ...MOODS.map((mood) => {
        const button = makeEl('button', 'mood-choice');
        button.type = 'button';
        button.setAttribute('aria-pressed', String(mood.value === current));
        button.setAttribute('aria-label', mood.label);
        button.append(makeEl('span', 'mood-face', mood.face), makeEl('span', 'mood-label', mood.label));
        button.onclick = () => finish(mood.value);
        return button;
      })
    );
    document.getElementById('mood-cancel').onclick = () => finish(null);
  });
}

async function chooseMood() {
  const current = todaysMood();
  const value = await openMoodSheet(current ? current.value : null);
  if (value === null) return;
  if (setTodaysMood(value)) renderRingMood();
}

// ---------- History (read-only) ----------

const MOOD_HISTORY_DAYS = 30;

// The most recent days that have a mood, newest first. Nothing here can be edited.
function renderMoodHistory() {
  const store = loadMood();
  const days = Object.keys(store).sort().reverse();
  const today = moodDayKey();

  document.getElementById('mood-empty').hidden = days.length > 0;
  document.getElementById('mood-hint').hidden = days.length === 0;
  document.getElementById('mood-count').textContent =
    days.length === 0 ? '' : days.length > MOOD_HISTORY_DAYS ? `Latest ${MOOD_HISTORY_DAYS} of ${days.length} days` : days.length === 1 ? '1 day' : `${days.length} days`;

  document.getElementById('mood-list').replaceChildren(
    ...days.slice(0, MOOD_HISTORY_DAYS).map((day) => {
      const [year, month, date] = day.split('-').map(Number);
      const mood = moodFor(store[day].value);
      const dayName = formatDay(new Date(year, month - 1, date)) + (day === today ? ' \u00b7 today' : '');
      const value = makeEl('span', 'mood-item-value');
      value.append(makeEl('span', 'mood-item-face', mood.face), makeEl('span', 'mood-item-label', mood.label));
      const row = makeEl('li', 'mood-item');
      row.append(makeEl('span', 'mood-item-day', dayName), value);
      return row;
    })
  );
}
