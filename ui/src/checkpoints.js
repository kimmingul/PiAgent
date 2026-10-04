(function (global) {
  'use strict';

  // Every user message has a git checkpoint of the project just before it (IDE side). Hovering a
  // message offers going back to that state (files and conversation) or a git branch from there.
  let post = null;
  function T(key, ...args) {
    return global.T ? global.T(key, ...args) : key;
  }


  function actions(turn, seq) {
    if (!turn || turn.querySelector('.cp-actions')) return;
    turn.dataset.seq = String(seq);
    const bar = document.createElement('div');
    bar.className = 'cp-actions';
    const add = (label, title, branch) => {
      const b = document.createElement('button');
      b.className = 'cp-btn';
      b.textContent = label;
      b.title = title;
      b.addEventListener('click', () => post({ t: 'restore', seq, branch }));
      bar.appendChild(b);
    };
    add(T('page.checkpoints.revertLabel'), T('page.checkpoints.revertTitle'), false);
    add(T('page.checkpoints.branchLabel'), T('page.checkpoints.branchTitle'), true);
    turn.appendChild(bar);
  }

  // The message just shown.
  function one(msg) {
    const turns = document.querySelectorAll('#log .turn-user');
    actions(turns[turns.length - 1], msg.seq);
  }

  // A reloaded history: the IDE matched each user message to its checkpoint (by when it was sent).
  global.ChatCheckpoints = { init: p => { post = p; }, one, attach: actions };
})(typeof window !== 'undefined' ? window : globalThis);
