import {
  DEFAULT_SETTINGS,
  DEFAULT_BASE_PROMPT,
  MODELS,
  GOALS,
  TONES,
  loadSettings,
  saveSettings
} from '../shared/defaults.js';

const TEXT_FIELDS = [
  'apiKey',
  'model',
  'effort',
  'senderName',
  'senderRole',
  'senderPitch',
  'senderLink',
  'signature',
  'basePrompt',
  'subjectStyle',
  'defaultGoal',
  'defaultTone'
];

const el = (id) => document.getElementById(id);

function fillSelect(id, entries) {
  const select = el(id);
  select.innerHTML = entries
    .map(([value, label]) => `<option value="${value}">${label}</option>`)
    .join('');
}

function showModelNote() {
  const model = MODELS.find((m) => m.id === el('model').value);
  el('modelNote').textContent = model ? model.note : '';
}

function status(message, kind = '') {
  const node = el('status');
  node.textContent = message;
  node.className = kind;
  if (message) setTimeout(() => { if (node.textContent === message) node.textContent = ''; }, 4000);
}

async function init() {
  fillSelect('model', MODELS.map((m) => [m.id, m.label]));
  fillSelect('defaultGoal', GOALS.map((g) => [g.id, g.label]));
  fillSelect('defaultTone', TONES.map((t) => [t.id, t.label]));

  const settings = await loadSettings();
  for (const field of TEXT_FIELDS) {
    if (el(field)) el(field).value = settings[field] ?? '';
  }
  el('wordLimit').value = settings.wordLimit;
  el('gmailAccountIndex').value = String(settings.gmailAccountIndex ?? 0);
  el('autoGenerate').checked = Boolean(settings.autoGenerate);
  el('autoOpenGmail').checked = Boolean(settings.autoOpenGmail);
  showModelNote();

  el('model').addEventListener('change', showModelNote);

  el('save').addEventListener('click', async () => {
    const patch = {};
    for (const field of TEXT_FIELDS) {
      if (el(field)) patch[field] = el(field).value.trim();
    }
    patch.apiKey = el('apiKey').value.trim();
    patch.basePrompt = el('basePrompt').value; // keep the author's line breaks
    patch.wordLimit = Math.min(300, Math.max(40, Number(el('wordLimit').value) || DEFAULT_SETTINGS.wordLimit));
    patch.gmailAccountIndex = Number(el('gmailAccountIndex').value) || 0;
    patch.autoGenerate = el('autoGenerate').checked;
    patch.autoOpenGmail = el('autoOpenGmail').checked;

    if (patch.apiKey && !patch.apiKey.startsWith('sk-ant-')) {
      status('That does not look like a Claude key. It should start with sk-ant-', 'bad');
      return;
    }
    await saveSettings(patch);
    status('Saved. Go back to a LinkedIn profile and click Draft email.', 'good');
  });

  el('reset').addEventListener('click', () => {
    el('basePrompt').value = DEFAULT_BASE_PROMPT;
    status('Base prompt reset. Click Save to keep it.');
  });

  el('test').addEventListener('click', async () => {
    const apiKey = el('apiKey').value.trim();
    const result = el('testResult');
    if (!apiKey) {
      result.textContent = 'Paste a key first.';
      return;
    }
    result.textContent = 'Checking...';
    chrome.runtime.sendMessage(
      { type: 'test-key', payload: { apiKey, model: el('model').value } },
      (response) => {
        if (chrome.runtime.lastError || !response) {
          result.textContent = 'Could not reach the extension. Reload it and try again.';
          return;
        }
        result.textContent = response.ok
          ? 'Working. Claude answered.'
          : response.error?.message || 'The key did not work.';
      }
    );
  });
}

init();
