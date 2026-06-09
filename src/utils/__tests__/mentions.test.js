import { describe, it, expect } from 'vitest';
import { mentionQueryAt, insertMention, filterMentionOptions, wikilinksToMarkdown, isWikilinkHref, wikilinkTarget } from '../mentions.js';

describe('mentionQueryAt', () => {
  it('detects @ at start of text', () => {
    expect(mentionQueryAt('@ric', 4)).toEqual({ start: 0, query: 'ric' });
  });

  it('detects @ after whitespace', () => {
    expect(mentionQueryAt('call @Ric', 9)).toEqual({ start: 5, query: 'Ric' });
  });

  it('detects @ after punctuation and newline', () => {
    expect(mentionQueryAt('done.\n@bo', 9)).toEqual({ start: 6, query: 'bo' });
    expect(mentionQueryAt('(see @x', 7)).toEqual({ start: 5, query: 'x' });
  });

  it('allows multi-word queries with spaces', () => {
    expect(mentionQueryAt('@ricardo fil', 12)).toEqual({ start: 0, query: 'ricardo fil' });
  });

  it('ignores email-like @ inside a word', () => {
    expect(mentionQueryAt('mail me at foo@bar', 18)).toBeNull();
  });

  it('ignores @ once the query crosses a newline', () => {
    expect(mentionQueryAt('@ric\nnext', 9)).toBeNull();
  });

  it('ignores @ when query contains brackets or backticks', () => {
    expect(mentionQueryAt('@[[done]]', 9)).toBeNull();
    expect(mentionQueryAt('@a`b', 4)).toBeNull();
  });

  it('returns null when there is no @', () => {
    expect(mentionQueryAt('plain text', 10)).toBeNull();
  });

  it('only looks before the caret', () => {
    expect(mentionQueryAt('@ric trailing', 4)).toEqual({ start: 0, query: 'ric' });
  });
});

describe('insertMention', () => {
  it('replaces the @query and moves the caret past the existing space', () => {
    const result = insertMention('ping @ric about rent', 5, 9, 'Ricardo Filho');
    expect(result.text).toBe('ping [[Ricardo Filho]] about rent');
    expect(result.caret).toBe('ping [[Ricardo Filho]] '.length);
  });

  it('does not double a space that already follows', () => {
    const result = insertMention('@ric next', 0, 4, 'Ricardo');
    expect(result.text).toBe('[[Ricardo]] next');
    expect(result.caret).toBe('[[Ricardo]] '.length);
  });

  it('appends a space at end of text', () => {
    const result = insertMention('see @pro', 4, 8, 'Project - Alpha');
    expect(result.text).toBe('see [[Project - Alpha]] ');
  });
});

describe('filterMentionOptions', () => {
  const options = [
    { label: 'Ricardo Filho', type: 'person' },
    { label: 'Maria Ricardo', type: 'person' },
    { label: 'Project - Rio Tower', type: 'project' },
    { label: 'Bob Stone', type: 'person' },
  ];

  it('returns first options when query is empty', () => {
    expect(filterMentionOptions(options, '', 2)).toHaveLength(2);
  });

  it('ranks prefix matches before word matches before substring matches', () => {
    const labels = filterMentionOptions(options, 'ric').map(o => o.label);
    expect(labels[0]).toBe('Ricardo Filho');
    expect(labels).toContain('Maria Ricardo');
    expect(labels).not.toContain('Bob Stone');
  });

  it('matches words inside hyphenated names', () => {
    const labels = filterMentionOptions(options, 'rio').map(o => o.label);
    expect(labels).toEqual(['Project - Rio Tower']);
  });

  it('is case-insensitive', () => {
    expect(filterMentionOptions(options, 'BOB')).toHaveLength(1);
  });

  it('respects the limit', () => {
    expect(filterMentionOptions(options, 'r', 1)).toHaveLength(1);
  });
});

describe('wikilinksToMarkdown', () => {
  it('converts a plain wikilink', () => {
    expect(wikilinksToMarkdown('met [[Ricardo Filho]] today'))
      .toBe('met [Ricardo Filho](#wikilink:Ricardo%20Filho) today');
  });

  it('uses the alias as label when present', () => {
    expect(wikilinksToMarkdown('[[Project - Alpha|Alpha]]'))
      .toBe('[Alpha](#wikilink:Project%20-%20Alpha)');
  });

  it('converts multiple links in one line', () => {
    const out = wikilinksToMarkdown('[[A]] and [[B]]');
    expect(out).toBe('[A](#wikilink:A) and [B](#wikilink:B)');
  });

  it('leaves code fences and inline code untouched', () => {
    const fenced = '```\n[[not a link]]\n```';
    expect(wikilinksToMarkdown(fenced)).toBe(fenced);
    expect(wikilinksToMarkdown('use `[[raw]]` syntax')).toBe('use `[[raw]]` syntax');
  });

  it('returns text without wikilinks unchanged', () => {
    expect(wikilinksToMarkdown('plain **markdown**')).toBe('plain **markdown**');
  });
});

describe('wikilink href helpers', () => {
  it('round-trips a target through href encoding', () => {
    const href = '#wikilink:Ricardo%20Filho';
    expect(isWikilinkHref(href)).toBe(true);
    expect(wikilinkTarget(href)).toBe('Ricardo Filho');
  });

  it('rejects normal hrefs', () => {
    expect(isWikilinkHref('https://example.com')).toBe(false);
    expect(isWikilinkHref(undefined)).toBe(false);
  });
});
