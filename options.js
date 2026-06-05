/**
 * Smart Tab Organizer — Options page
 */

const STORAGE_KEYS = { SETTINGS: 'settings', SESSIONS: 'sessions' };

const GROUP_COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];

const $ = (sel) => document.querySelector(sel);

function toast(message, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

async function loadSettings() {
  const { settings } = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  return settings || {};
}

async function saveSettings(settings) {
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: settings });
}

function renderRule(rule = {}) {
  const id = rule.id || `rule-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const card = document.createElement('div');
  card.className = 'rule-card';
  card.dataset.ruleId = id;
  card.innerHTML = `
    <input type="text" class="rule-name" placeholder="Group name (e.g. Documentation)" value="${escapeAttr(rule.groupName || '')}" />
    <input type="text" class="rule-keywords" placeholder="Keywords comma-separated (docs, wiki, readme)" value="${escapeAttr((rule.keywords || []).join(', '))}" />
    <select class="rule-color">
      ${GROUP_COLORS.map((c) => `<option value="${c}" ${rule.color === c ? 'selected' : ''}>${c}</option>`).join('')}
    </select>
    <button type="button" class="btn btn-danger btn-remove-rule" style="margin-top:8px">Remove</button>
  `;
  card.querySelector('.btn-remove-rule').addEventListener('click', () => card.remove());
  return card;
}

function escapeAttr(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

function collectRules() {
  return [...document.querySelectorAll('.rule-card')].map((card) => ({
    id: card.dataset.ruleId,
    groupName: card.querySelector('.rule-name').value.trim() || 'Custom',
    keywords: card.querySelector('.rule-keywords').value
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean),
    color: card.querySelector('.rule-color').value,
  }));
}

async function init() {
  const settings = await loadSettings();

  $('#excluded-domains').value = (settings.excludedDomains || []).join('\n');

  const container = $('#rules-container');
  container.innerHTML = '';
  const rules = settings.keywordRules?.length ? settings.keywordRules : [
    { groupName: 'Documentation', keywords: ['docs', 'documentation'], color: 'blue' },
  ];
  rules.forEach((r) => container.appendChild(renderRule(r)));

  $('#add-rule').addEventListener('click', () => {
    container.appendChild(renderRule({ groupName: 'New Group', keywords: [], color: 'blue' }));
  });

  $('#save-excluded').addEventListener('click', async () => {
    const settings = await loadSettings();
    settings.excludedDomains = $('#excluded-domains').value
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    await saveSettings(settings);
    toast('Excluded domains saved', 'success');
  });

  $('#save-rules').addEventListener('click', async () => {
    const settings = await loadSettings();
    settings.keywordRules = collectRules();
    await saveSettings(settings);
    toast('Keyword rules saved', 'success');
  });

  $('#export-sessions').addEventListener('click', async () => {
    const { sessions = [] } = await chrome.storage.local.get(STORAGE_KEYS.SESSIONS);
    const blob = new Blob([JSON.stringify({ version: 1, exportedAt: Date.now(), sessions }, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `smart-tab-organizer-sessions-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast(`Exported ${sessions.length} session(s)`, 'success');
  });

  $('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const imported = data.sessions || (Array.isArray(data) ? data : []);
      if (!imported.length) throw new Error('No sessions in file');

      const { sessions: existing = [] } = await chrome.storage.local.get(STORAGE_KEYS.SESSIONS);
      const merged = [...imported, ...existing];
      const seen = new Set();
      const deduped = merged.filter((s) => {
        if (seen.has(s.id)) return false;
        seen.add(s.id);
        return true;
      });
      await chrome.storage.local.set({ [STORAGE_KEYS.SESSIONS]: deduped });
      toast(`Imported ${imported.length} session(s)`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
    e.target.value = '';
  });

  $('#shortcuts-link').addEventListener('click', (ev) => {
    ev.preventDefault();
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  });
}

document.addEventListener('DOMContentLoaded', init);
