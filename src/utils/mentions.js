// @-mention helpers — detect an "@query" being typed in a textarea, insert
// Obsidian [[wikilinks]], and convert [[wikilinks]] for markdown rendering.

const MAX_QUERY_LENGTH = 60;

// Characters allowed immediately before the "@" for it to count as a mention
// trigger (start of text, whitespace, or common punctuation/brackets).
const BOUNDARY_BEFORE_AT = /[\s([{'"“‘\-–—:;,./>]/;

export function mentionQueryAt(text, caret) {
  const upto = String(text || '').slice(0, caret);
  const at = upto.lastIndexOf('@');
  if (at === -1) return null;
  if (at > 0 && !BOUNDARY_BEFORE_AT.test(upto[at - 1])) return null;
  const query = upto.slice(at + 1);
  if (query.length > MAX_QUERY_LENGTH) return null;
  if (/[\n@[\]#`]/.test(query)) return null;
  return { start: at, query };
}

export function insertMention(text, start, caret, label) {
  const before = String(text || '').slice(0, start);
  const after = String(text || '').slice(caret);
  const needsSpace = !(after.startsWith(' ') || after.startsWith('\n'));
  const inserted = `[[${label}]]${needsSpace ? ' ' : ''}`;
  return {
    text: before + inserted + after,
    caret: before.length + inserted.length + (needsSpace ? 0 : 1),
  };
}

export function filterMentionOptions(options, query, limit = 8) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return options.slice(0, limit);
  const ranked = [];
  for (const option of options) {
    const label = option.label.toLowerCase();
    let rank;
    if (label.startsWith(q)) rank = 0;
    else if (label.split(/[\s\-–—_/]+/).some(word => word.startsWith(q))) rank = 1;
    else if (label.includes(q)) rank = 2;
    else continue;
    ranked.push({ option, rank });
  }
  return ranked
    .sort((a, b) => a.rank - b.rank || a.option.label.localeCompare(b.option.label))
    .slice(0, limit)
    .map(entry => entry.option);
}

const WIKILINK_RE = /\[\[([^[\]\n|]+?)(?:\|([^[\]\n]+?))?\]\]/g;

// Rewrite [[Target]] / [[Target|Alias]] as standard markdown links pointing at
// a #wikilink fragment so MarkdownBody can render them as styled chips.
// Code fences and inline code spans are left untouched.
export function wikilinksToMarkdown(text) {
  const source = String(text || '');
  if (!source.includes('[[')) return source;
  return source
    .split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/g)
    .map((segment, index) => {
      if (index % 2 === 1) return segment;
      return segment.replace(WIKILINK_RE, (match, target, alias) => {
        const label = (alias || target).trim();
        if (!label) return match;
        return `[${label}](#wikilink:${encodeURIComponent(target.trim())})`;
      });
    })
    .join('');
}

export function isWikilinkHref(href) {
  return typeof href === 'string' && href.startsWith('#wikilink:');
}

export function wikilinkTarget(href) {
  try {
    return decodeURIComponent(String(href || '').slice('#wikilink:'.length));
  } catch {
    return String(href || '').slice('#wikilink:'.length);
  }
}
