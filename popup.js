/**
 * Smart Tab Organizer — Popup UI
 */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

let allTabs = [];
let allGroups = [];
let selectedTabIds = new Set();
let duplicateUrls = new Set();
let pendingConfirmAction = null;

// ─── Messaging ─────────────────────────────────────────────────────────────────

async function send(type, payload = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, ...payload }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response?.ok) {
        const msg = response?.error;
        reject(new Error(typeof msg === 'string' ? msg : msg?.message || 'Unknown error'));
        return;
      }
      resolve(response.data);
    });
  });
}

// ─── UI helpers ────────────────────────────────────────────────────────────────

function showLoading(active) {
  $('#loading').classList.toggle('active', active);
}

function toast(message, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function formatDate(ts) {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function openModal(id) {
  $(id).classList.add('open');
}

function closeModal(id) {
  $(id).classList.remove('open');
}

async function withLoading(fn) {
  showLoading(true);
  try {
    return await fn();
  } finally {
    showLoading(false);
  }
}

// ─── Stats ─────────────────────────────────────────────────────────────────────

async function refreshStats() {
  const stats = await send('GET_STATS');
  $('#stat-tabs').textContent = stats.tabCount;
  $('#stat-groups').textContent = stats.groupCount;
  $('#stat-sessions').textContent = stats.sessionCount;
}

// ─── Groups panel ──────────────────────────────────────────────────────────────

async function refreshGroups() {
  const groups = await send('GET_GROUPS');
  allGroups = Array.isArray(groups) ? groups : [];
  const list = $('#group-list');
  const empty = $('#groups-empty');
  list.innerHTML = '';

  if (!allGroups.length) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  for (const group of allGroups) {
    const li = document.createElement('li');
    li.className = 'group-item';
    li.innerHTML = `
      <div style="display:flex;align-items:center;min-width:0">
        <span class="group-dot ${group.color}"></span>
        <span style="font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(group.title || 'Untitled')}</span>
      </div>
      <div style="display:flex;gap:4px">
        <button type="button" class="btn btn-icon btn-ghost btn-ungroup-group" data-group-id="${group.id}" title="Ungroup">Ungroup</button>
        <button type="button" class="btn btn-icon btn-ghost btn-toggle-group" data-group-id="${group.id}" title="Toggle collapse">
          ${group.collapsed ? 'Expand' : 'Collapse'}
        </button>
      </div>
    `;
    li.querySelector('.btn-toggle-group').addEventListener('click', async () => {
      await withLoading(() => send('TOGGLE_GROUP', { groupId: group.id }));
      await refreshGroups();
      toast(group.collapsed ? 'Group expanded' : 'Group collapsed', 'success');
    });
    li.querySelector('.btn-ungroup-group').addEventListener('click', async () => {
      await withLoading(() => send('UNGROUP_ENTIRE_GROUP', { groupId: group.id }));
      toast('Group removed', 'success');
      await refreshAll();
    });
    list.appendChild(li);
  }
}

// ─── Tabs panel ────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

/** MV3: only http(s)/data favicons; skip broken chrome-extension URLs (e.g. action_32.png) */
function isSafeFaviconUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    if (u.protocol === 'chrome-extension:') return false;
    return u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'data:';
  } catch {
    return false;
  }
}

function createTabFavicon(tab) {
  const img = document.createElement('img');
  img.className = 'tab-favicon';
  img.alt = '';
  const fallback = chrome.runtime.getURL('icons/icon16.png');
  if (isSafeFaviconUrl(tab.favIconUrl)) {
    img.src = tab.favIconUrl;
    img.addEventListener('error', () => { img.src = fallback; }, { once: true });
  } else {
    img.src = fallback;
  }
  return img;
}

async function refreshTabs() {
  const tabs = await send('GET_TABS');
  allTabs = Array.isArray(tabs) ? tabs : [];
  const duplicates = await send('FIND_DUPLICATES');
  duplicateUrls = new Set((Array.isArray(duplicates) ? duplicates : []).map((d) => d.url));

  const alert = $('#duplicates-alert');
  if (duplicates.length) {
    alert.classList.remove('hidden');
    $('#duplicates-text').textContent = `${duplicates.length} duplicate URL${duplicates.length > 1 ? 's' : ''} found`;
  } else {
    alert.classList.add('hidden');
  }

  renderTabList();
}

function getFilteredTabs() {
  const q = $('#tab-search').value.trim().toLowerCase();
  if (!q) return allTabs;
  return allTabs.filter(
    (t) => t.title?.toLowerCase().includes(q) || t.url?.toLowerCase().includes(q)
  );
}

function renderTabList() {
  const filtered = getFilteredTabs();
  const list = $('#tab-list');
  const empty = $('#tabs-empty');
  list.innerHTML = '';

  if (!filtered.length) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  for (const tab of filtered) {
    const isDup = duplicateUrls.has(tab.url?.split('#')[0]);
    const li = document.createElement('li');
    li.className = `tab-item${selectedTabIds.has(tab.id) ? ' selected' : ''}`;
    li.dataset.tabId = tab.id;
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    if (selectedTabIds.has(tab.id)) checkbox.checked = true;

    const info = document.createElement('div');
    info.className = 'tab-info';
    info.innerHTML = `
      <div class="tab-title">${escapeHtml(tab.title || 'Untitled')}</div>
      <div class="tab-url">${escapeHtml(tab.url || '')}</div>
    `;

    li.appendChild(checkbox);
    li.appendChild(createTabFavicon(tab));
    li.appendChild(info);
    if (isDup) {
      const badge = document.createElement('span');
      badge.className = 'tab-badge';
      badge.textContent = 'DUP';
      li.appendChild(badge);
    }
    if (tab.pinned) {
      const pin = document.createElement('span');
      pin.className = 'tab-badge tab-badge-pin';
      pin.textContent = 'PIN';
      li.appendChild(pin);
    }

    const cb = checkbox;
    cb.addEventListener('change', (e) => {
      e.stopPropagation();
      toggleSelect(tab.id, cb.checked);
    });
    li.addEventListener('click', (e) => {
      if (e.target.tagName === 'INPUT') return;
      cb.checked = !cb.checked;
      toggleSelect(tab.id, cb.checked);
    });
    list.appendChild(li);
  }

  updateBulkBar();
}

function toggleSelect(tabId, on) {
  if (on) selectedTabIds.add(tabId);
  else selectedTabIds.delete(tabId);
  renderTabList();
}

function updateBulkBar() {
  const bar = $('#bulk-bar');
  const n = selectedTabIds.size;
  if (n > 0) {
    bar.classList.remove('hidden');
    $('#selection-count').textContent = `${n} selected`;
  } else {
    bar.classList.add('hidden');
  }
}

// ─── Sessions panel ────────────────────────────────────────────────────────────

async function refreshSessions() {
  const sessions = await send('GET_SESSIONS');
  const sessionItems = Array.isArray(sessions) ? sessions : [];
  const listEl = $('#session-list');
  const empty = $('#sessions-empty');
  listEl.innerHTML = '';

  if (!sessionItems.length) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  for (const session of sessionItems) {
    const li = document.createElement('li');
    li.className = 'session-item';
    li.innerHTML = `
      <div class="session-name">${escapeHtml(session.name)}</div>
      <div class="session-meta">${formatDate(session.createdAt)} · ${session.tabCount} tabs</div>
      <div class="session-actions">
        <button type="button" class="btn btn-primary btn-restore" data-id="${session.id}">Restore</button>
        <button type="button" class="btn btn-restore-new" data-id="${session.id}">New window</button>
        <button type="button" class="btn btn-danger btn-delete" data-id="${session.id}">Delete</button>
      </div>
    `;

    li.querySelector('.btn-restore').addEventListener('click', () => restoreSession(session.id, false));
    li.querySelector('.btn-restore-new').addEventListener('click', () => restoreSession(session.id, true));
    li.querySelector('.btn-delete').addEventListener('click', async () => {
      await send('DELETE_SESSION', { sessionId: session.id });
      toast('Session deleted', 'success');
      await refreshSessions();
      await refreshStats();
    });
    listEl.appendChild(li);
  }
}

async function restoreSession(sessionId, newWindow) {
  await withLoading(async () => {
    const result = await send('RESTORE_SESSION', { sessionId, newWindow });
    toast(`Restored ${result.tabCount} tabs`, 'success');
  });
  await refreshAll();
}

// ─── Refresh all ───────────────────────────────────────────────────────────────

async function refreshAll() {
  await Promise.all([refreshStats(), refreshGroups(), refreshTabs(), refreshSessions()]);
}

// ─── Event bindings ────────────────────────────────────────────────────────────

function initTabs() {
  $$('.tab-nav button').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.tab-nav button').forEach((b) => b.classList.remove('active'));
      $$('.panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      $(`#panel-${btn.dataset.panel}`).classList.add('active');
    });
  });
}

function initActions() {
  $('#btn-auto-group').addEventListener('click', async () => {
    await withLoading(async () => {
      const r = await send('AUTO_GROUP');
      toast(`Created ${r.groupsCreated} groups for ${r.tabCount} tabs`, 'success');
    });
    await refreshAll();
  });

  $('#btn-smart-group').addEventListener('click', async () => {
    await withLoading(async () => {
      const r = await send('SMART_GROUP');
      const extra = r.keywordGroups ? ` + ${r.keywordGroups} keyword groups` : '';
      toast(`Smart grouping complete${extra}`, 'success');
    });
    await refreshAll();
  });

  $('#btn-collapse-all').addEventListener('click', async () => {
    await withLoading(async () => {
      const r = await send('COLLAPSE_ALL');
      toast(`Collapsed ${r.count} groups`, 'success');
    });
    await refreshGroups();
  });

  $('#btn-expand-all').addEventListener('click', async () => {
    await withLoading(async () => {
      const r = await send('EXPAND_ALL');
      toast(`Expanded ${r.count} groups`, 'success');
    });
    await refreshGroups();
  });

  $('#tab-search').addEventListener('input', renderTabList);

  $('#select-all-tabs').addEventListener('change', (e) => {
    const filtered = getFilteredTabs();
    if (e.target.checked) filtered.forEach((t) => selectedTabIds.add(t.id));
    else filtered.forEach((t) => selectedTabIds.delete(t.id));
    renderTabList();
  });

  $('#btn-group-selected').addEventListener('click', async () => {
    const ids = [...selectedTabIds];
    if (!ids.length) return;
    await withLoading(() => send('GROUP_TABS', { tabIds: ids, title: 'Custom Group' }));
    selectedTabIds.clear();
    toast('Tabs grouped', 'success');
    await refreshAll();
  });

  $('#btn-ungroup-selected').addEventListener('click', async () => {
    const ids = [...selectedTabIds];
    if (!ids.length) return;
    await withLoading(() => send('UNGROUP_TABS', { tabIds: ids }));
    selectedTabIds.clear();
    toast('Tabs ungrouped', 'success');
    await refreshAll();
  });

  $('#btn-pin').addEventListener('click', async () => {
    const ids = [...selectedTabIds];
    if (!ids.length) return;
    await send('PIN_TABS', { tabIds: ids });
    toast(`Pinned ${ids.length} tab(s)`, 'success');
    await refreshTabs();
  });

  $('#btn-unpin').addEventListener('click', async () => {
    const ids = [...selectedTabIds];
    if (!ids.length) return;
    await send('UNPIN_TABS', { tabIds: ids });
    toast(`Unpinned ${ids.length} tab(s)`, 'success');
    await refreshTabs();
  });

  $('#btn-new-window').addEventListener('click', async () => {
    const ids = [...selectedTabIds];
    if (!ids.length) return;
    await withLoading(() => send('MOVE_TO_NEW_WINDOW', { tabIds: ids }));
    selectedTabIds.clear();
    toast('Moved to new window', 'success');
    await refreshAll();
  });

  $('#btn-close-selected').addEventListener('click', () => {
    const ids = [...selectedTabIds];
    if (!ids.length) return;
    pendingConfirmAction = async () => {
      await send('CLOSE_TABS', { tabIds: ids });
      selectedTabIds.clear();
      toast(`Closed ${ids.length} tab(s)`, 'success');
      await refreshAll();
    };
    $('#confirm-message').textContent = `Close ${ids.length} tab(s)? This cannot be undone.`;
    openModal('#confirm-modal');
  });

  $('#confirm-cancel').addEventListener('click', () => {
    pendingConfirmAction = null;
    closeModal('#confirm-modal');
  });

  $('#confirm-ok').addEventListener('click', async () => {
    closeModal('#confirm-modal');
    if (pendingConfirmAction) {
      await withLoading(pendingConfirmAction);
      pendingConfirmAction = null;
    }
  });

  $('#btn-save-session').addEventListener('click', () => {
    $('#session-name-input').value = '';
    openModal('#save-modal');
    $('#session-name-input').focus();
  });

  $('#save-modal-cancel').addEventListener('click', () => closeModal('#save-modal'));

  $('#save-modal-confirm').addEventListener('click', async () => {
    const name = $('#session-name-input').value.trim();
    closeModal('#save-modal');
    await withLoading(async () => {
      const session = await send('SAVE_SESSION', { name });
      toast(`Saved "${session.name}"`, 'success');
    });
    await refreshSessions();
    await refreshStats();
  });

  $('#session-name-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#save-modal-confirm').click();
  });

  $('#open-options').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
}

// ─── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  initTabs();
  initActions();

  applyInlineIcons();

  showLoading(true);
  try {
    await refreshAll();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    showLoading(false);
  }
});
