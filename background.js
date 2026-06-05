/**
 * Smart Tab Organizer — Service Worker (Manifest V3)
 * Handles grouping, sessions, context menus, and keyboard commands.
 */

// ─── Constants ───────────────────────────────────────────────────────────────

const STORAGE_KEYS = {
  SETTINGS: 'settings',
  SESSIONS: 'sessions',
};

const DEFAULT_SETTINGS = {
  excludedDomains: ['chrome://', 'chrome-extension://', 'edge://', 'about:'],
  keywordRules: [
    { id: 'rule-docs', keywords: ['docs', 'documentation', 'readme', 'wiki'], groupName: 'Documentation', color: 'blue' },
    { id: 'rule-admin', keywords: ['admin', 'dashboard', 'console', 'settings'], groupName: 'Admin & Dashboards', color: 'purple' },
    { id: 'rule-work', keywords: ['jira', 'notion', 'linear', 'asana', 'slack'], groupName: 'Work Tools', color: 'green' },
    { id: 'rule-dev', keywords: ['github', 'gitlab', 'stackoverflow', 'npm'], groupName: 'Development', color: 'cyan' },
  ],
};

/** Chrome tab group colors (cycle for auto-assignment) */
const GROUP_COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];

/** Friendly display names for common domains */
const DOMAIN_LABELS = {
  'github.com': 'GitHub',
  'www.github.com': 'GitHub',
  'gitlab.com': 'GitLab',
  'youtube.com': 'YouTube',
  'www.youtube.com': 'YouTube',
  'google.com': 'Google',
  'www.google.com': 'Google',
  'docs.google.com': 'Google Docs',
  'drive.google.com': 'Google Drive',
  'notion.so': 'Notion',
  'www.notion.so': 'Notion',
  'linear.app': 'Linear',
  'figma.com': 'Figma',
  'www.figma.com': 'Figma',
  'twitter.com': 'Twitter / X',
  'x.com': 'Twitter / X',
  'linkedin.com': 'LinkedIn',
  'www.linkedin.com': 'LinkedIn',
  'reddit.com': 'Reddit',
  'www.reddit.com': 'Reddit',
  'stackoverflow.com': 'Stack Overflow',
  'medium.com': 'Medium',
  'amazon.com': 'Amazon',
  'www.amazon.com': 'Amazon',
};

// ─── Storage helpers ───────────────────────────────────────────────────────────

async function getSettings() {
  const { [STORAGE_KEYS.SETTINGS]: stored } = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  const settings = { ...DEFAULT_SETTINGS, ...stored };
  if (!Array.isArray(settings.keywordRules)) {
    settings.keywordRules = DEFAULT_SETTINGS.keywordRules;
  }
  if (!Array.isArray(settings.excludedDomains)) {
    settings.excludedDomains = DEFAULT_SETTINGS.excludedDomains;
  }
  return settings;
}

async function saveSettings(settings) {
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: settings });
}

async function getSessions() {
  const { [STORAGE_KEYS.SESSIONS]: sessions = [] } = await chrome.storage.local.get(STORAGE_KEYS.SESSIONS);
  return Array.isArray(sessions) ? sessions : [];
}

async function saveSessions(sessions) {
  await chrome.storage.local.set({ [STORAGE_KEYS.SESSIONS]: sessions });
}

// ─── URL / domain utilities ────────────────────────────────────────────────────

function extractDomain(url) {
  try {
    const { hostname } = new URL(url);
    return hostname.replace(/^www\./, '') || 'unknown';
  } catch {
    return 'unknown';
  }
}

function getRootDomain(hostname) {
  const parts = hostname.replace(/^www\./, '').split('.');
  if (parts.length <= 2) return parts.join('.');
  return parts.slice(-2).join('.');
}

function isExcluded(url, excludedDomains) {
  if (!url || url.startsWith('chrome://') || url.startsWith('chrome-extension://')) return true;
  const lower = url.toLowerCase();
  return excludedDomains.some((pattern) => {
    const p = pattern.toLowerCase().trim();
    if (!p) return false;
    if (p.includes('://')) return lower.startsWith(p);
    return lower.includes(p) || extractDomain(url).includes(p.replace(/^www\./, ''));
  });
}

function getFriendlyDomainName(domain) {
  const key = domain.toLowerCase();
  if (DOMAIN_LABELS[key]) return DOMAIN_LABELS[key];
  if (DOMAIN_LABELS[`www.${key}`]) return DOMAIN_LABELS[`www.${key}`];
  const root = getRootDomain(key);
  if (DOMAIN_LABELS[root]) return DOMAIN_LABELS[root];
  const label = root.split('.')[0];
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h << 5) - h + str.charCodeAt(i);
  return Math.abs(h);
}

function colorForKey(key) {
  return GROUP_COLORS[hashString(key) % GROUP_COLORS.length];
}

// ─── Tab grouping ──────────────────────────────────────────────────────────────

async function getGroupableTabs(windowId = null) {
  const query = windowId != null ? { windowId } : { currentWindow: true };
  const tabs = await chrome.tabs.query(query);
  const settings = await getSettings();
  return tabs.filter((t) => !isExcluded(t.url, settings.excludedDomains) && !t.pinned);
}

/**
 * Auto-group tabs by domain using chrome.tabGroups API.
 */
async function autoGroupByDomain(windowId = null) {
  const tabs = (await getGroupableTabs(windowId)).filter((t) => t.groupId === -1);
  const byDomain = new Map();

  for (const tab of tabs) {
    const domain = extractDomain(tab.url);
    if (!byDomain.has(domain)) byDomain.set(domain, []);
    byDomain.get(domain).push(tab);
  }

  let groupsCreated = 0;
  for (const [domain, domainTabs] of byDomain) {
    if (domainTabs.length < 1) continue;
    const title = getFriendlyDomainName(domain);
    const color = colorForKey(domain);
    const tabIds = domainTabs.map((t) => t.id);
    const groupId = await chrome.tabs.group({ tabIds });
    await chrome.tabGroups.update(groupId, { title, color, collapsed: false });
    groupsCreated++;
  }

  return { groupsCreated, tabCount: tabs.length };
}

/**
 * Smart group: domain grouping first, then keyword rules for ungrouped tabs.
 */
async function smartGroup(windowId = null) {
  const settings = await getSettings();
  let keywordGroups = 0;

  // Step 1: Keyword rules (cross-domain topics first)
  for (const rule of settings.keywordRules) {
    const ungrouped = (await getGroupableTabs(windowId)).filter((t) => t.groupId === -1);
    const matched = ungrouped.filter((tab) => {
      const haystack = `${tab.title} ${tab.url}`.toLowerCase();
      return rule.keywords.some((kw) => haystack.includes(kw.toLowerCase().trim()));
    });

    if (matched.length === 0) continue;

    const tabIds = matched.map((t) => t.id);
    const groupId = await chrome.tabs.group({ tabIds });
    await chrome.tabGroups.update(groupId, {
      title: rule.groupName,
      color: rule.color || colorForKey(rule.groupName),
      collapsed: false,
    });
    keywordGroups++;
  }

  // Step 2: Domain grouping for remaining ungrouped tabs
  const domainResult = await autoGroupByDomain(windowId);
  return { keywordGroups, ...domainResult };
}

async function collapseAllGroups(windowId = null) {
  const groups = await chrome.tabGroups.query(windowId != null ? { windowId } : {});
  await Promise.all(groups.map((g) => chrome.tabGroups.update(g.id, { collapsed: true })));
  return groups.length;
}

async function expandAllGroups(windowId = null) {
  const groups = await chrome.tabGroups.query(windowId != null ? { windowId } : {});
  await Promise.all(groups.map((g) => chrome.tabGroups.update(g.id, { collapsed: false })));
  return groups.length;
}

async function toggleGroupCollapse(groupId) {
  const group = await chrome.tabGroups.get(groupId);
  await chrome.tabGroups.update(groupId, { collapsed: !group.collapsed });
}

async function groupSelectedTabs(tabIds, title = 'Custom Group') {
  if (!tabIds?.length) throw new Error('No tabs selected');
  const groupId = await chrome.tabs.group({ tabIds });
  await chrome.tabGroups.update(groupId, { title, color: colorForKey(title), collapsed: false });
  return groupId;
}

// ─── Sessions ──────────────────────────────────────────────────────────────────

async function captureCurrentSession(name) {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  if (!tabs.length) throw new Error('No tabs in current window');
  const groups = await chrome.tabGroups.query({ windowId: tabs[0].windowId });

  const groupMap = new Map(groups.map((g) => [g.id, { title: g.title, color: g.color, collapsed: g.collapsed }]));

  const sessionTabs = tabs.map((tab) => ({
    url: tab.url,
    title: tab.title,
    pinned: tab.pinned,
    active: tab.active,
    group: tab.groupId !== -1 ? groupMap.get(tab.groupId) : null,
  }));

  const session = {
    id: `session-${Date.now()}`,
    name: name.trim() || `Session ${new Date().toLocaleString()}`,
    createdAt: Date.now(),
    tabCount: sessionTabs.length,
    tabs: sessionTabs,
  };

  const sessions = await getSessions();
  sessions.unshift(session);
  await saveSessions(sessions);
  return session;
}

async function restoreSession(sessionId, { newWindow = false } = {}) {
  const sessions = await getSessions();
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) throw new Error('Session not found');

  let windowId;
  if (newWindow) {
    const win = await chrome.windows.create({ focused: true });
    windowId = win.id;
    const [defaultTab] = await chrome.tabs.query({ windowId, active: true });
    if (defaultTab) await chrome.tabs.remove(defaultTab.id);
  } else {
    windowId = (await chrome.windows.getCurrent()).id;
  }

  const groupKeyToId = new Map();

  for (const tabData of session.tabs) {
    const created = await chrome.tabs.create({
      windowId,
      url: tabData.url,
      pinned: tabData.pinned,
      active: false,
    });

    if (tabData.group) {
      const key = `${tabData.group.title}|${tabData.group.color}`;
      if (!groupKeyToId.has(key)) {
        const groupId = await chrome.tabs.group({ tabIds: [created.id] });
        await chrome.tabGroups.update(groupId, {
          title: tabData.group.title,
          color: tabData.group.color,
          collapsed: tabData.group.collapsed ?? false,
        });
        groupKeyToId.set(key, groupId);
      } else {
        await chrome.tabs.group({ tabIds: [created.id], groupId: groupKeyToId.get(key) });
      }
    }
  }

  const createdTabs = await chrome.tabs.query({ windowId });
  const activeTab = session.tabs.find((t) => t.active);
  if (activeTab) {
    const match = createdTabs.find((t) => t.url === activeTab.url);
    if (match) await chrome.tabs.update(match.id, { active: true });
  }

  return { tabCount: session.tabs.length, windowId };
}

async function deleteSession(sessionId) {
  const sessions = (await getSessions()).filter((s) => s.id !== sessionId);
  await saveSessions(sessions);
}

// ─── Stats & duplicates ────────────────────────────────────────────────────────

async function getStats() {
  const [tabs, groups, sessions] = await Promise.all([
    chrome.tabs.query({}),
    chrome.tabGroups.query({}),
    getSessions(),
  ]);
  return {
    tabCount: tabs.length,
    groupCount: groups.length,
    sessionCount: sessions.length,
  };
}

function findDuplicateTabs(tabs) {
  const seen = new Map();
  const duplicates = [];

  for (const tab of tabs) {
    const key = tab.url?.split('#')[0] || '';
    if (!key || key === 'chrome://newtab/') continue;
    if (seen.has(key)) {
      duplicates.push({ url: key, tabIds: [seen.get(key), tab.id] });
    } else {
      seen.set(key, tab.id);
    }
  }
  return duplicates;
}

// ─── Context menu ──────────────────────────────────────────────────────────────

/** "tab" context requires Chrome 150+; fall back to "page" only on older builds */
function getContextMenuContexts() {
  const contexts = ['page'];
  // ContextType.TAB is defined when the tab-strip context is supported
  if (chrome.contextMenus?.ContextType?.TAB) {
    contexts.push(chrome.contextMenus.ContextType.TAB);
  }
  return contexts;
}

function registerContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create(
      {
        id: 'smart-group-tab',
        title: 'Add to Smart Group',
        contexts: getContextMenuContexts(),
      },
      () => {
        if (chrome.runtime.lastError) {
          console.warn('[Smart Tab Organizer] context menu:', chrome.runtime.lastError.message);
        }
      }
    );
  });
}

chrome.runtime.onInstalled.addListener(() => {
  registerContextMenu();
  getSettings().then((s) => {
    if (!s.keywordRules?.length) saveSettings(DEFAULT_SETTINGS);
  });
});

chrome.runtime.onStartup.addListener(registerContextMenu);

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'smart-group-tab' || !tab?.id) return;
  try {
    await smartGroup(tab.windowId);
    if (tab.groupId === -1) {
      await groupSelectedTabs([tab.id], 'Smart Group');
    }
  } catch (err) {
    console.error('[Smart Tab Organizer]', err);
  }
});

// ─── Commands ──────────────────────────────────────────────────────────────────

chrome.commands.onCommand.addListener(async (command) => {
  try {
    if (command === 'auto-group-tabs') {
      await autoGroupByDomain();
    } else if (command === 'collapse-all-groups') {
      await collapseAllGroups();
    }
  } catch (err) {
    console.error('[Smart Tab Organizer] command failed:', err);
  }
});

// ─── Message handler (popup ↔ background) ─────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handler = async () => {
    switch (message.type) {
      case 'GET_STATS':
        return getStats();
      case 'GET_TABS':
        return chrome.tabs.query({ currentWindow: true });
      case 'GET_GROUPS':
        return chrome.tabGroups.query(
          message.windowId != null ? { windowId: message.windowId } : {}
        );
      case 'GET_SESSIONS':
        return getSessions();
      case 'GET_SETTINGS':
        return getSettings();
      case 'AUTO_GROUP':
        return autoGroupByDomain(message.windowId);
      case 'SMART_GROUP':
        return smartGroup(message.windowId);
      case 'COLLAPSE_ALL':
        return { count: await collapseAllGroups(message.windowId) };
      case 'EXPAND_ALL':
        return { count: await expandAllGroups(message.windowId) };
      case 'TOGGLE_GROUP':
        return toggleGroupCollapse(message.groupId);
      case 'GROUP_TABS':
        return groupSelectedTabs(message.tabIds, message.title);
      case 'UNGROUP_TABS':
        await chrome.tabs.ungroup(message.tabIds);
        return { ungrouped: message.tabIds.length };
      case 'UNGROUP_ENTIRE_GROUP': {
        const tabs = await chrome.tabs.query({ groupId: message.groupId });
        const tabIds = tabs.map(t => t.id);
        if (tabIds.length) await chrome.tabs.ungroup(tabIds);
        return { ungrouped: tabIds.length };
      }
      case 'SAVE_SESSION':
        return captureCurrentSession(message.name);
      case 'RESTORE_SESSION':
        return restoreSession(message.sessionId, { newWindow: message.newWindow });
      case 'DELETE_SESSION':
        return deleteSession(message.sessionId);
      case 'FIND_DUPLICATES': {
        const tabs = await chrome.tabs.query({ currentWindow: true });
        return findDuplicateTabs(tabs);
      }
      case 'CLOSE_TABS':
        await chrome.tabs.remove(message.tabIds);
        return { closed: message.tabIds.length };
      case 'PIN_TABS':
        await Promise.all(message.tabIds.map((id) => chrome.tabs.update(id, { pinned: true })));
        return { pinned: message.tabIds.length };
      case 'UNPIN_TABS':
        await Promise.all(message.tabIds.map((id) => chrome.tabs.update(id, { pinned: false })));
        return { unpinned: message.tabIds.length };
      case 'MOVE_TO_NEW_WINDOW':
        return moveTabsToNewWindow(message.tabIds);
      default:
        throw new Error(`Unknown message type: ${message.type}`);
    }
  };

  handler()
    .then((result) => sendResponse({ ok: true, data: result }))
    .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));

  return true;
});

async function moveTabsToNewWindow(tabIds) {
  const win = await chrome.windows.create({ tabId: tabIds[0], focused: true });
  for (let i = 1; i < tabIds.length; i++) {
    await chrome.tabs.move(tabIds[i], { windowId: win.id, index: -1 });
  }
  return { windowId: win.id };
}
