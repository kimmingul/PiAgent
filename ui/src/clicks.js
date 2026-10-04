(function (global) {
  'use strict';

  // Page-wide clicks: file references open in the IDE editor, code blocks copy, web links open
  // in the browser. The IDE does the opening.
  const pending = new Map();
  global.ChatClipboard = { done: msg => { const button = pending.get(msg.id); if (!button) return; pending.delete(msg.id); button.disabled = false; if (msg.ok) { button.textContent = global.T('page.chat.copied'); setTimeout(() => { button.textContent = global.T('page.chat.copy'); }, 1500); } } };
  document.addEventListener('click', (e) => {
    const fileRef = e.target.closest('.file-ref');
    if (fileRef) {
      e.preventDefault();
      e.stopPropagation();
      global.chatPost({
        t: 'openFile',
        path: fileRef.getAttribute('data-path') || '',
        line: parseInt(fileRef.getAttribute('data-line') || '0', 10)
      });
      return;
    }

    const copyBtn = e.target.closest('.code-copy-btn');
    if (copyBtn) {
      e.preventDefault();
      e.stopPropagation();
      const code = copyBtn.getAttribute('data-code') || '';
      if (copyBtn.disabled) return;
      const id = 'clipboard-' + Date.now() + '-' + Math.random();
      pending.set(id, copyBtn); copyBtn.disabled = true;
      global.chatPost({ t: 'copy', text: code, id });
      setTimeout(() => global.ChatClipboard.done({id, ok:false}), 10000);
      return;
    }

    const link = e.target.closest('.chat-link');
    if (link) {
      e.preventDefault();
      e.stopPropagation();
      global.chatPost({
        t: 'openUrl',
        url: link.getAttribute('data-url') || ''
      });
      return;
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
