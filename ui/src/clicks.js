(function (global) {
  'use strict';

  // Page-wide clicks: file references open in the IDE editor, code blocks copy, web links open
  // in the browser. The IDE does the opening.
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
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(code).catch(() => {});
      }
      global.chatPost({ t: 'copy', text: code });
      copyBtn.textContent = global.T('page.chat.copied');
      setTimeout(() => { copyBtn.textContent = global.T('page.chat.copy'); }, 1500);
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
