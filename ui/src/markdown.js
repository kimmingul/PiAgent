(function (global) {
  'use strict';

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttr(str) {
    return escapeHtml(str);
  }

  const FILE_REF_RE = /(?:([A-Za-z]:[\\/](?:[^\s\\/:*?"<>|()]+[\\/])*[^\s\\/:*?"<>|()]+\.(?:pas|dpr|dproj|dfm|inc|PAS|DPR|DPROJ|DFM|INC))(?:(?:\((\d+)(?:,\s*(\d+))?\))|(?::(\d+)))?)|(?:\b((?:[A-Za-z0-9_.\-]+[\\/])*[A-Za-z0-9_]+\.(?:pas|dpr|dproj|dfm|inc|PAS|DPR|DPROJ|DFM|INC))(?:(?:\((\d+)(?:,\s*(\d+))?\))|(?::(\d+))))/g;

  function linkFileRefs(text) {
    if (!text) return '';
    FILE_REF_RE.lastIndex = 0;
    return text.replace(FILE_REF_RE, (match, p1, l1, c1, l2, p2, l3, c3, l4) => {
      const path = p1 || p2;
      const lineStr = l1 || l2 || l3 || l4;
      const line = lineStr ? parseInt(lineStr, 10) : 0;
      return `<span class="file-ref" data-path="${path}" data-line="${line}">${match}</span>`;
    });
  }

  const PASCAL_KEYWORDS = new Set([
    'and', 'array', 'as', 'asm', 'begin', 'case', 'class', 'const', 'constructor',
    'destructor', 'dispinterface', 'div', 'do', 'downto', 'else', 'end', 'except',
    'exports', 'file', 'finalization', 'finally', 'for', 'function', 'goto', 'if',
    'implementation', 'in', 'inherited', 'initialization', 'inline', 'interface',
    'is', 'label', 'library', 'mod', 'nil', 'not', 'object', 'of', 'or', 'out',
    'packed', 'procedure', 'program', 'property', 'raise', 'record', 'repeat',
    'resourcestring', 'set', 'shl', 'shr', 'string', 'then', 'threadvar', 'to',
    'try', 'type', 'unit', 'until', 'uses', 'var', 'while', 'with', 'xor',
    'absolute', 'abstract', 'assembler', 'cdecl', 'default', 'deprecated', 'dynamic',
    'experimental', 'export', 'external', 'forward', 'index', 'message', 'name',
    'nodefault', 'overload', 'override', 'pascal', 'platform', 'private', 'protected',
    'public', 'published', 'read', 'readonly', 'reference', 'register', 'reintroduce',
    'safecall', 'stdcall', 'strict', 'unsafe', 'varargs', 'virtual', 'write', 'writeonly',
    'true', 'false', 'boolean', 'integer', 'cardinal', 'byte', 'word', 'pointer',
    'pchar', 'ansistring', 'unicodestring', 'widechar', 'char', 'double', 'single',
    'extended', 'comp', 'currency', 'int64', 'uint64', 'variant', 'tobject'
  ]);

  function highlightPascal(code) {
    const TOKEN_RE = /(\/\/[^\r\n]*)|(\{[^}]*\}?)|(\(\*[\s\S]*?(?:\*\)|$))|('([^'\r\n]|'')*(?:'|$))|(\$[0-9A-Fa-f]+|\b0x[0-9A-Fa-f]+\b|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|(\b[A-Za-z_][A-Za-z0-9_]*\b)|([^\sA-Za-z0-9_'$({/]+|\s+|.)/g;
    let out = '';
    let m;
    while ((m = TOKEN_RE.exec(code)) !== null) {
      const [full, lineComm, braceComm, parenComm, str, strBody, num, ident, other] = m;
      if (lineComm || braceComm || parenComm) {
        const comm = lineComm || braceComm || parenComm;
        out += `<span class="tok-comment">${linkFileRefs(escapeHtml(comm))}</span>`;
      } else if (str) {
        out += `<span class="tok-string">${linkFileRefs(escapeHtml(str))}</span>`;
      } else if (num) {
        out += `<span class="tok-number">${escapeHtml(num)}</span>`;
      } else if (ident) {
        if (PASCAL_KEYWORDS.has(ident.toLowerCase())) {
          out += `<span class="tok-keyword">${escapeHtml(ident)}</span>`;
        } else {
          out += linkFileRefs(escapeHtml(ident));
        }
      } else if (other) {
        out += linkFileRefs(escapeHtml(other));
      }
    }
    return out;
  }

  const CPP_KEYWORDS = new Set([
    'alignas', 'alignof', 'auto', 'bool', 'break', 'case', 'catch', 'char', 'class', 'const',
    'constexpr', 'const_cast', 'continue', 'decltype', 'default', 'delete', 'do', 'double',
    'dynamic_cast', 'else', 'enum', 'explicit', 'extern', 'false', 'float', 'for', 'friend', 'goto',
    'if', 'inline', 'int', 'long', 'mutable', 'namespace', 'new', 'noexcept', 'nullptr', 'operator',
    'override', 'private', 'protected', 'public', 'register', 'reinterpret_cast', 'return', 'short',
    'signed', 'sizeof', 'static', 'static_assert', 'static_cast', 'struct', 'switch', 'template',
    'this', 'throw', 'true', 'try', 'typedef', 'typeid', 'typename', 'union', 'unsigned', 'using',
    'virtual', 'void', 'volatile', 'wchar_t', 'while', 'final',
    // C++Builder extensions
    '__fastcall', '__published', '__property', '__closure', '__classid', '__declspec', '__int64',
    '__finally', '__try', '__except', '__automated', '__rtti', 'PACKAGE'
  ]);

  // C and C++ (C++Builder included): comments, strings and chars, preprocessor lines, numbers.
  function highlightCpp(code) {
    const TOKEN_RE = /(\/\/[^\r\n]*)|(\/\*[\s\S]*?(?:\*\/|$))|((?:^|(?<=\n))[ \t]*#[^\r\n]*)|((?:L|u8|u|U)?"(?:[^"\\\r\n]|\\.)*(?:"|$)|'(?:[^'\\\r\n]|\\.)*(?:'|$))|(\b0x[0-9A-Fa-f]+\b|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?[uUlLfF]*\b)|(\b[A-Za-z_][A-Za-z0-9_]*\b)|([^\sA-Za-z0-9_"'\/#]+|\s+|.)/g;
    let out = '';
    let m;
    while ((m = TOKEN_RE.exec(code)) !== null) {
      const [, lineComm, blockComm, pre, str, num, ident, other] = m;
      if (lineComm || blockComm) {
        out += `<span class="tok-comment">${linkFileRefs(escapeHtml(lineComm || blockComm))}</span>`;
      } else if (pre) {
        out += `<span class="tok-keyword">${linkFileRefs(escapeHtml(pre))}</span>`;
      } else if (str) {
        out += `<span class="tok-string">${linkFileRefs(escapeHtml(str))}</span>`;
      } else if (num) {
        out += `<span class="tok-number">${escapeHtml(num)}</span>`;
      } else if (ident) {
        out += CPP_KEYWORDS.has(ident) ? `<span class="tok-keyword">${escapeHtml(ident)}</span>` : linkFileRefs(escapeHtml(ident));
      } else if (other) {
        out += linkFileRefs(escapeHtml(other));
      }
    }
    return out;
  }

  function renderInline(raw) {
    let text = escapeHtml(raw);
    const ph = [];
    const pushPh = (h) => {
      ph.push(h);
      return `\x00PH${ph.length - 1}\x00`;
    };

    // 1. Code spans `code`
    text = text.replace(/`([^`]+)`/g, (_, code) => pushPh(`<code>${linkFileRefs(code)}</code>`));

    // 2. Markdown links [text](url)
    text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) => pushPh(`<a href="#" class="chat-link" data-url="${url}">${label}</a>`));

    // 3. Bare URLs http:// or https://
    text = text.replace(/\b(https?:\/\/[^\s<>()"']+)/g, (_, url) => pushPh(`<a href="#" class="chat-link" data-url="${url}">${url}</a>`));

    // 4. File references
    text = linkFileRefs(text);

    // 5. Bold, italic, strikethrough
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    text = text.replace(/_([^_]+)_/g, '<em>$1</em>');
    text = text.replace(/~~([^~]+)~~/g, '<del>$1</del>');

    // 6. Restore placeholders
    text = text.replace(/\x00PH(\d+)\x00/g, (_, i) => ph[parseInt(i, 10)]);
    return text;
  }

  function parseTable(lines, startIdx) {
    const headerLine = lines[startIdx];
    const delimLine = lines[startIdx + 1];
    if (!delimLine) return null;
    const delimCols = delimLine.trim().replace(/^\||\|$/g, '').split('|').map(s => s.trim());
    if (delimCols.length === 0 || !delimCols.every(c => /^:?-+:?$/.test(c))) return null;

    const aligns = delimCols.map(c => {
      const l = c.startsWith(':');
      const r = c.endsWith(':');
      return l && r ? 'center' : r ? 'right' : l ? 'left' : '';
    });

    const headerCols = headerLine.trim().replace(/^\||\|$/g, '').split('|').map(s => s.trim());
    let html = '<table><thead><tr>';
    for (let i = 0; i < delimCols.length; i++) {
      const align = aligns[i] ? ` style="text-align:${aligns[i]}"` : '';
      html += `<th${align}>${renderInline(headerCols[i] || '')}</th>`;
    }
    html += '</tr></thead><tbody>';

    let nextIdx = startIdx + 2;
    while (nextIdx < lines.length) {
      const line = lines[nextIdx].trim();
      if (!line || !line.includes('|')) break;
      const rowCols = line.replace(/^\||\|$/g, '').split('|').map(s => s.trim());
      html += '<tr>';
      for (let i = 0; i < delimCols.length; i++) {
        const align = aligns[i] ? ` style="text-align:${aligns[i]}"` : '';
        html += `<td${align}>${renderInline(rowCols[i] || '')}</td>`;
      }
      html += '</tr>';
      nextIdx++;
    }
    html += '</tbody></table>';
    return { html, nextIdx };
  }

  function parseList(lines, startIdx) {
    let idx = startIdx;
    const items = [];
    while (idx < lines.length) {
      const line = lines[idx];
      const m = line.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
      if (!m) break;
      items.push({ indent: m[1].length, isOrdered: /^\d+\./.test(m[2]), text: m[3] });
      idx++;
    }
    if (items.length === 0) return null;

    const rootTag = items[0].isOrdered ? 'ol' : 'ul';
    let html = `<${rootTag}>`;
    let inSub = false;
    let subTag = 'ul';

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const isSub = it.indent >= 2;
      if (isSub && !inSub) {
        inSub = true;
        subTag = it.isOrdered ? 'ol' : 'ul';
        html += `<${subTag}>`;
      } else if (!isSub && inSub) {
        html += `</${subTag}></li>`;
        inSub = false;
      } else if (i > 0 && !isSub) {
        html += '</li>';
      }
      html += `<li>${renderInline(it.text)}`;
    }
    if (inSub) html += `</${subTag}></li>`;
    else html += '</li>';
    html += `</${rootTag}>`;
    return { html, nextIdx: idx };
  }

  function render(markdown) {
    if (!markdown) return '';
    const lines = markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    let html = '';
    let idx = 0;

    while (idx < lines.length) {
      const line = lines[idx];

      // Empty line
      if (!line.trim()) {
        idx++;
        continue;
      }

      // Fenced code block; list items indent theirs, so up to 4 leading spaces count.
      const codeMatch = line.match(/^( {0,4})```\s*([a-zA-Z0-9_\-+]*)\s*$/);
      if (codeMatch) {
        const indent = codeMatch[1].length;
        const lang = codeMatch[2].toLowerCase();
        const codeLines = [];
        idx++;
        while (idx < lines.length) {
          if (/^ {0,4}```\s*$/.test(lines[idx])) {
            idx++;
            break;
          }
          const raw = lines[idx];
          codeLines.push(raw.slice(Math.min(indent, raw.length - raw.trimStart().length)));
          idx++;
        }
        const rawCode = codeLines.join('\n');
        const highlighted = ['pascal', 'delphi', 'pas'].includes(lang)
          ? highlightPascal(rawCode)
          : ['cpp', 'c++', 'c', 'h', 'hpp', 'cxx', 'cc'].includes(lang)
            ? highlightCpp(rawCode)
            : linkFileRefs(escapeHtml(rawCode));

        const copyLabel = typeof global.T === 'function' ? global.T('page.markdown.copy') : 'Copy';
        html += `<div class="code-block">` +
          `<div class="code-header">` +
            `<span class="code-lang">${escapeHtml(lang || 'text')}</span>` +
            `<button class="code-copy-btn" data-code="${escapeAttr(rawCode)}" aria-label="${escapeAttr(copyLabel)}">${escapeHtml(copyLabel)}</button>` +
          `</div>` +
          `<pre><code>${highlighted}</code></pre>` +
        `</div>`;
        continue;
      }

      // Heading
      const headMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headMatch) {
        const level = headMatch[1].length;
        html += `<h${level}>${renderInline(headMatch[2])}</h${level}>`;
        idx++;
        continue;
      }

      // Horizontal rule
      if (/^(?:---|\*\*\*|___)\s*$/.test(line)) {
        html += '<hr>';
        idx++;
        continue;
      }

      // Blockquote
      if (/^>\s?/.test(line)) {
        const qLines = [];
        while (idx < lines.length && /^>\s?/.test(lines[idx])) {
          qLines.push(lines[idx].replace(/^>\s?/, ''));
          idx++;
        }
        html += `<blockquote>${qLines.map(l => renderInline(l)).join('<br>')}</blockquote>`;
        continue;
      }

      // Table
      if (line.includes('|') && idx + 1 < lines.length && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(lines[idx + 1])) {
        const tableRes = parseTable(lines, idx);
        if (tableRes) {
          html += tableRes.html;
          idx = tableRes.nextIdx;
          continue;
        }
      }

      // List
      if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
        const listRes = parseList(lines, idx);
        if (listRes) {
          html += listRes.html;
          idx = listRes.nextIdx;
          continue;
        }
      }

      // Paragraph
      const paraLines = [];
      while (idx < lines.length) {
        const pLine = lines[idx];
        if (!pLine.trim()) break;
        // The first line is always taken: a line no block accepted ("# " while streaming) must
        // still move idx forward, or render() never returns.
        if (paraLines.length && (pLine.trimStart().startsWith('```') || /^#{1,6}\s+/.test(pLine) ||
            /^>\s?/.test(pLine) || /^\s*([-*+]|\d+\.)\s+/.test(pLine) || /^(?:---|\*\*\*|___)\s*$/.test(pLine))) {
          break;
        }
        if (paraLines.length && pLine.includes('|') && idx + 1 < lines.length &&
            /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(lines[idx + 1])) {
          break;
        }
        paraLines.push(pLine);
        idx++;
      }
      if (paraLines.length > 0) {
        html += `<p>${paraLines.map(l => renderInline(l)).join('<br>')}</p>`;
      }
    }

    return html;
  }

  const Markdown = {
    escapeHtml,
    escapeAttr,
    linkFileRefs,
    highlightPascal,
    renderInline,
    render
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Markdown;
  }
  global.Markdown = Markdown;
})(typeof window !== 'undefined' ? window : globalThis);
