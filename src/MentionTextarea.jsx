// MentionTextarea — drop-in <textarea> replacement that opens a dropdown when
// the user types "@" and inserts an Obsidian [[wikilink]] for the picked
// person / project / client / property. Options come from MentionProvider so
// every note input in the app shares the same vault-backed list.

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { mentionQueryAt, insertMention, filterMentionOptions } from './utils/mentions.js';

const MentionContext = createContext([]);

export function MentionProvider({ options, children }) {
  return <MentionContext.Provider value={options}>{children}</MentionContext.Provider>;
}

const TYPE_BADGES = {
  person:   { label: 'Person',   color: '#86efac' },
  project:  { label: 'Project',  color: '#93c5fd' },
  client:   { label: 'Client',   color: '#fcd34d' },
  property: { label: 'Property', color: '#f0abfc' },
  organization: { label: 'Org', color: '#7dd3fc' },
};

const MIRROR_STYLE_PROPS = [
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight',
  'textTransform', 'wordSpacing', 'textIndent', 'paddingTop', 'paddingRight',
  'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth',
  'borderBottomWidth', 'borderLeftWidth', 'boxSizing',
];

// Measure the viewport position of a character index inside a textarea by
// mirroring its text into a hidden div (standard textarea-caret technique).
function caretViewportPosition(textarea, index) {
  const computed = getComputedStyle(textarea);
  const mirror = document.createElement('div');
  for (const prop of MIRROR_STYLE_PROPS) mirror.style[prop] = computed[prop];
  mirror.style.position = 'absolute';
  mirror.style.visibility = 'hidden';
  mirror.style.top = '0';
  mirror.style.left = '-9999px';
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.wordWrap = 'break-word';
  mirror.style.overflow = 'hidden';
  mirror.style.width = `${textarea.clientWidth}px`;
  mirror.textContent = textarea.value.slice(0, index);
  const marker = document.createElement('span');
  marker.textContent = textarea.value.slice(index, index + 1) || '​';
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const top = marker.offsetTop;
  const left = marker.offsetLeft;
  const lineHeight = marker.offsetHeight || 18;
  document.body.removeChild(mirror);
  const rect = textarea.getBoundingClientRect();
  return {
    top: rect.top + top - textarea.scrollTop,
    left: rect.left + left - textarea.scrollLeft,
    lineHeight,
  };
}

const MENU_WIDTH = 280;
const MENU_MAX_HEIGHT = 246;

export default function MentionTextarea({ textareaRef, onChange, onKeyDown, onBlur, ...rest }) {
  const options = useContext(MentionContext);
  const innerRef = useRef(null);
  const taRef = textareaRef || innerRef;
  const [menu, setMenu] = useState(null); // { start, query, top, left }
  const [active, setActive] = useState(0);

  const matches = menu ? filterMentionOptions(options, menu.query) : [];

  const closeMenu = () => setMenu(null);

  const syncMenu = (textarea) => {
    if (!textarea || !options.length) return setMenu(null);
    const caret = textarea.selectionStart;
    if (caret !== textarea.selectionEnd) return setMenu(null);
    const hit = mentionQueryAt(textarea.value, caret);
    if (!hit || !filterMentionOptions(options, hit.query).length) return setMenu(null);
    const pos = caretViewportPosition(textarea, hit.start);
    let left = Math.min(pos.left, window.innerWidth - MENU_WIDTH - 12);
    let top = pos.top + pos.lineHeight + 6;
    if (top + MENU_MAX_HEIGHT > window.innerHeight - 8) top = pos.top - MENU_MAX_HEIGHT - 6;
    setMenu(prev => {
      if (!prev || prev.start !== hit.start) setActive(0);
      return { start: hit.start, query: hit.query, top, left };
    });
  };

  const pick = (option) => {
    const textarea = taRef.current;
    if (!textarea || !menu) return;
    const { text, caret } = insertMention(textarea.value, menu.start, textarea.selectionStart, option.label);
    onChange?.({ target: { value: text } });
    closeMenu();
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(caret, caret);
    });
  };

  const handleKeyDown = (e) => {
    if (menu && matches.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => (a + 1) % matches.length); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setActive(a => (a - 1 + matches.length) % matches.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(matches[Math.min(active, matches.length - 1)]); return; }
      if (e.key === 'Escape') { e.preventDefault(); closeMenu(); return; }
    }
    onKeyDown?.(e);
  };

  useEffect(() => {
    if (!menu) return;
    const onWindowChange = () => closeMenu();
    window.addEventListener('resize', onWindowChange);
    window.addEventListener('scroll', onWindowChange, true);
    return () => {
      window.removeEventListener('resize', onWindowChange);
      window.removeEventListener('scroll', onWindowChange, true);
    };
  }, [menu]);

  return (
    <>
      <textarea
        {...rest}
        ref={taRef}
        onChange={(e) => { onChange?.(e); requestAnimationFrame(() => syncMenu(taRef.current)); }}
        onKeyDown={handleKeyDown}
        onClick={() => syncMenu(taRef.current)}
        onBlur={(e) => { setTimeout(closeMenu, 120); onBlur?.(e); }}
      />
      {menu && matches.length > 0 && createPortal(
        <div className="mention-menu" style={{ top: menu.top, left: Math.max(8, menu.left), width: MENU_WIDTH, maxHeight: MENU_MAX_HEIGHT }}>
          <div className="mention-menu-hint">Link to note · ↑↓ to move · Enter to insert</div>
          {matches.map((option, index) => {
            const badge = TYPE_BADGES[option.type] || TYPE_BADGES.person;
            return (
              <button
                key={`${option.type}:${option.label}`}
                type="button"
                className={`mention-item${index === active ? ' active' : ''}`}
                onMouseDown={(e) => { e.preventDefault(); pick(option); }}
                onMouseEnter={() => setActive(index)}
              >
                <span className="mention-item-label">{option.label}</span>
                <span className="mention-item-type" style={{ color: badge.color }}>{badge.label}</span>
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </>
  );
}
