(function (global) {
  'use strict';

  // Tool rows, grouped per stretch of activity between two answer blocks ("3 tools used ›"),
  // and file cards for edits that reached an IDE buffer. chat.js owns turns.
  let ctx = null;
  let group = null;
  const active = new Map();
  function T(key, ...args) {
    return global.T ? global.T(key, ...args) : key;
  }


  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function label(g) {
    const parts = [];
    if (g.tools) parts.push(T('page.tools.toolsUsed', g.tools));
    if (g.subagents.size) parts.push(T('page.tools.subagentsCount', g.subagents.size));
    if (!parts.length) parts.push(g.thinking ? T('page.tools.thinking') : T('page.tools.working'));
    let text = parts.join(' · ');
    if (g.running.size) text += ' · ' + T('page.tools.running', Array.from(g.running.values()).pop());
    g.labelEl.textContent = text;
    g.failEl.textContent = g.failed ? T('page.tools.failed', g.failed) : '';
    g.el.classList.toggle('only-thinking', !g.tools && !g.subagents.size);
  }

  // kind: 'thinking' | 'subagent' | 'input' | 'tool'; id for subagents.
  function ensureGroup(kind, id) {
    if (!group) {
      ctx.closeAssistant();
      const details = el('details', 'tool-group only-thinking');
      const summary = el('summary');
      const labelEl = el('span');
      const failEl = el('span', 'group-failed');
      summary.appendChild(labelEl);
      summary.appendChild(failEl);
      const body = el('div', 'group-body');
      details.appendChild(summary);
      details.appendChild(body);
      ctx.ensureTurn().appendChild(details);
      group = { el: details, labelEl, failEl, body, tools: 0, failed: 0, thinking: false,
        subagents: new Set(), running: new Map() };
    }
    if (kind === 'thinking') group.thinking = true;
    if (kind === 'subagent' && id) group.subagents.add(id);
    label(group);
    return group.body;
  }

  // Answer text started or the turn ended: the next activity opens a new group.
  function endGroup() { group = null; }

  function start(id, name, detail, input) {
    const wasNear = ctx.isNearBottom();
    const body = ensureGroup('tool');
    const g = group;
    const row = el('details', 'tool-row running');
    const summary = el('summary', 'tool-summary');
    const iconSpan = el('span', 'tool-status-icon');
    iconSpan.appendChild(el('span', 'tool-spinner'));
    summary.appendChild(iconSpan);
    summary.appendChild(el('span', 'tool-name', name));
    summary.appendChild(el('span', 'tool-detail', detail || ''));
    const metaSpan = el('span', 'tool-meta');
    summary.appendChild(metaSpan);
    const resultPre = el('pre', 'tool-result');
    row.appendChild(summary);
    row.appendChild(resultPre);
    global.ChatActivity.attachInput(row, resultPre, input || global.ChatActivity.takeDraft(id));
    body.appendChild(row);
    g.tools++;
    g.running.set(id, name);
    label(g);
    active.set(id, { row, iconSpan, metaSpan, resultPre, group: g });
    ctx.newContent(wasNear);
  }

  function update(id, text) {
    const tool = active.get(id);
    if (tool) global.ChatActivity.toolUpdate(tool, text);
  }

  function duration(ms) {
    if (typeof ms !== 'number' || ms < 0) return '';
    const sec = ms >= 10000 ? Math.round(ms / 1000) : (ms / 1000).toFixed(1);
    return T('page.tools.seconds', sec);
  }

  function end(id, ok, ms, result) {
    const tool = active.get(id);
    if (!tool) return;
    const wasNear = ctx.isNearBottom();
    tool.row.classList.remove('running');
    tool.iconSpan.innerHTML = ok ? '<span class="tool-ok">✓</span>' : '<span class="tool-err">✗</span>';
    tool.metaSpan.textContent = duration(ms);
    const lines = (result || '').split('\n');
    const shown = lines.length > 200
      ? lines.slice(0, 200).join('\n') + '\n\n' + T('page.tools.moreLines', lines.length - 200) : (result || '');
    tool.resultPre.innerHTML = global.Markdown.linkFileRefs(global.Markdown.escapeHtml(shown));
    tool.group.running.delete(id);
    if (!ok) tool.group.failed++;
    label(tool.group);
    active.delete(id);
    ctx.newContent(wasNear);
  }

  // Tools still open when the turn ended were interrupted.
  function endTurn() {
    for (const tool of active.values()) {
      tool.iconSpan.innerHTML = '<span class="tool-warn">!</span>';
      tool.metaSpan.textContent = T('page.tools.interrupted');
      tool.row.classList.remove('running');
      tool.group.running.clear();
      label(tool.group);
    }
    active.clear();
    group = null;
  }

  function fileChange(msg) {
    const wasNear = ctx.isNearBottom();
    const turn = ctx.ensureTurn();
    let card = turn.lastElementChild;
    if (!card || !card.classList.contains('file-card')) {
      card = el('div', 'file-card');
      turn.appendChild(card);
    }
    let row = Array.from(card.children).find(r => r.dataset.path === msg.path);
    if (!row) {
      row = el('div', 'file-row');
      row.dataset.path = msg.path;
      row.dataset.added = '0';
      row.dataset.removed = '0';
      row.appendChild(el('span', 'file-icon', '▤'));
      row.appendChild(el('span', 'file-name', msg.name || msg.path));
      row.appendChild(el('span', 'file-add'));
      row.appendChild(el('span', 'file-del'));
      row.appendChild(el('span', 'file-open', '›'));
      row.title = T('page.tools.openInEditor', msg.path);
      card.appendChild(row);
    }
    row.dataset.added = String(+row.dataset.added + (msg.added || 0));
    row.dataset.removed = String(+row.dataset.removed + (msg.removed || 0));
    if (msg.line) row.dataset.line = String(msg.line);
    row.children[2].textContent = '+' + row.dataset.added;
    row.children[3].textContent = '-' + row.dataset.removed;
    ctx.newContent(wasNear);
  }

  document.addEventListener('click', e => {
    const row = e.target.closest('.file-row');
    if (!row) return;
    ctx.post({ t: 'openFile', path: row.dataset.path, line: parseInt(row.dataset.line || '0', 10) });
  });

  function clear() { active.clear(); group = null; }

  global.ChatTools = {
    init: c => { ctx = c; },
    ensureGroup, endGroup, start, update, end, endTurn, fileChange, clear
  };
})(typeof window !== 'undefined' ? window : globalThis);
