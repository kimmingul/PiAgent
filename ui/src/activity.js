(function (global) {
  'use strict';

  // Renders omp progress besides the answer text: thinking, tool input being written, live tool
  // output, subagents and the todo list. Rows go into the current tool group (tools.js).
  let ctx = null;
  let thinking = null;
  const drafts = new Map();
  const subagents = new Map();
  let todoPanel = null;
  let pendingFrame = false;
  const dirty = new Set();

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function T(key, ...args) {
    return global.T ? global.T(key, ...args) : key;
  }


  function chars(n) {
    const lang = (typeof document !== 'undefined' && document.documentElement && document.documentElement.lang) || undefined;
    return T('page.activity.chars', n.toLocaleString(lang));
  }

  // Coalesce text updates to one per frame; thinking arrives dozens of times per second.
  function schedule(item) {
    dirty.add(item);
    if (pendingFrame) return;
    pendingFrame = true;
    requestAnimationFrame(() => {
      pendingFrame = false;
      const wasNear = ctx.isNearBottom();
      for (const it of dirty) {
        it.pre.textContent = it.text;
        it.meta.textContent = chars(it.text.length);
      }
      dirty.clear();
      ctx.newContent(wasNear);
    });
  }

  function activityRow(cls, label) {
    const row = el('details', 'activity-row ' + cls);
    const summary = el('summary');
    const labelEl = el('span', 'activity-label', label);
    const meta = el('span', 'activity-meta');
    summary.appendChild(labelEl);
    summary.appendChild(meta);
    const pre = el('pre', 'activity-text');
    row.appendChild(summary);
    row.appendChild(pre);
    return { row, labelEl, meta, pre, text: '' };
  }

  function thinkingDelta(text) {
    if (!thinking) {
      ctx.closeAssistant();
      thinking = activityRow('thinking-row live', T('page.activity.thinkingLive'));
      ctx.ensureGroup('thinking').appendChild(thinking.row);
    }
    thinking.text += text || '';
    schedule(thinking);
  }

  function thinkingEnd() {
    if (!thinking) return;
    thinking.row.classList.remove('live');
    thinking.labelEl.textContent = T('page.activity.thinking');
    thinking = null;
  }

  // Replayed transcript: one finished block.
  function thinkingBlock(text) {
    const item = activityRow('thinking-row', T('page.activity.thinking'));
    item.text = text || '';
    item.pre.textContent = item.text;
    item.meta.textContent = chars(item.text.length);
    ctx.ensureGroup('thinking').appendChild(item.row);
  }

  function toolInputDelta(id, name, text) {
    let item = drafts.get(id);
    if (!item) {
      ctx.closeAssistant();
      item = activityRow('tool-input-row', T('page.activity.writingInput', name || T('page.activity.toolDefault')));
      ctx.ensureGroup('input').appendChild(item.row);
      drafts.set(id, item);
    }
    item.text += text || '';
    schedule(item);
  }

  function takeDraft(id) {
    const item = drafts.get(id);
    if (!item) return '';
    drafts.delete(id);
    dirty.delete(item);
    item.row.remove();
    return item.text;
  }

  function attachInput(row, resultPre, input) {
    if (!input) return;
    const pre = el('pre', 'tool-input', input);
    pre.dataset.label = T('page.activity.input');
    row.insertBefore(pre, resultPre);
  }

  function toolUpdate(tool, text) {
    if (!tool || !tool.resultPre) return;
    const wasNear = ctx.isNearBottom();
    tool.resultPre.textContent = text || '';
    ctx.newContent(wasNear);
  }

  function subagent(msg) {
    const wasNear = ctx.isNearBottom();
    let row = subagents.get(msg.id);
    if (!row) {
      row = el('div', 'subagent-row');
      row.appendChild(el('span', 'subagent-name'));
      row.appendChild(el('span', 'subagent-text'));
      row.appendChild(el('span', 'subagent-meta'));
      // Its transcript, read from omp on click.
      row.title = T('page.activity.subagentLog');
      row.addEventListener('click', () => ctx.post({ t: 'subagentLog', id: msg.id }));
      ctx.ensureGroup('subagent', msg.id).appendChild(row);
      subagents.set(msg.id, row);
    }
    const status = msg.status || '';
    const done = status === 'completed';
    const failed = status === 'failed' || status === 'aborted' || status === 'error';
    row.classList.toggle('done', done);
    row.classList.toggle('failed', failed);
    const icon = done ? '✓' : failed ? '✗' : '⋯';
    row.children[0].textContent = icon + ' ' + (msg.agent || '') + ' ' + (msg.id || '');
    const parts = [msg.description, msg.intent].filter(Boolean);
    row.children[1].textContent = parts.join(' · ');
    row.children[1].title = row.children[1].textContent;
    const tools = parseInt(msg.tools || '0', 10);
    row.children[2].textContent = (tools > 0 ? T('page.activity.toolCount', tools) : '') + (status || '');
    ctx.newContent(wasNear);
  }

  function todos(items) {
    if (!todoPanel) {
      todoPanel = el('div');
      todoPanel.id = 'todo-panel';
      document.body.insertBefore(todoPanel, document.getElementById('log'));
    }
    todoPanel.innerHTML = '';
    if (!Array.isArray(items) || items.length === 0) {
      todoPanel.hidden = true;
      return;
    }
    const doneCount = items.filter(i => i.status === 'completed').length;
    todoPanel.appendChild(el('div', 'todo-title', T('page.activity.todoTitle', doneCount, items.length)));
    let phase = null;
    for (const item of items) {
      if (item.phase && item.phase !== phase) {
        phase = item.phase;
        todoPanel.appendChild(el('div', 'todo-title', phase));
      }
      const mark = item.status === 'completed' ? '☑' : item.status === 'in_progress' ? '▶' :
        item.status === 'abandoned' ? '☒' : '☐';
      const row = el('div', 'todo-item ' + (item.status || ''));
      row.appendChild(el('span', '', mark));
      row.appendChild(el('span', '', item.content || ''));
      todoPanel.appendChild(row);
    }
    todoPanel.hidden = false;
  }

  function display(show) {
    if (!show) return;
    for (const [key, on] of Object.entries(show)) {
      document.body.classList.toggle('hide-' + key, !on);
    }
  }

  // A turn ended or the view was cleared: live rows stop being live.
  function endTurn() {
    thinkingEnd();
    for (const id of Array.from(drafts.keys())) takeDraft(id);
  }

  function clear() {
    thinking = null;
    drafts.clear();
    subagents.clear();
    dirty.clear();
    todos([]);
  }

  global.ChatActivity = {
    init: c => { ctx = c; },
    thinkingDelta, thinkingEnd, thinkingBlock, toolInputDelta, takeDraft, attachInput,
    toolUpdate, subagent, todos, display, endTurn, clear
  };
})(typeof window !== 'undefined' ? window : globalThis);
