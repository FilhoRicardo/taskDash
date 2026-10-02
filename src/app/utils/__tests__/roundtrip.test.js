import { describe, expect, it } from 'vitest';
import { finishRecurrentTaskInstance, markTaskDone, setPropertyCover, touchDateModified, updateTaskDates, updateTaskMetadata, updateTaskThreadSubject, appendNoteToMd } from '../formatter.js';

// Markdown safety: mutations must be surgical. Unknown frontmatter fields and
// user-written content survive a parse → edit → write round-trip untouched.

const RAW = `---
title: Quarterly report
status: in-progress
due: 2026-07-10
customField: keep me
nested_unknown:
  - alpha
  - beta
tags:
  - work
---
# Quarterly report

Some careful user prose that must never be rewritten.

- [ ] draft outline
- [x] collect data

### 2026-07-01
Log: kicked off
`;

describe('markdown round-trip safety', () => {
  it('updates CRLF frontmatter dates without changing other content or line endings', () => {
    const raw = '---\ntitle: Example\nstatus: done\ndue: 2026-10-02\nRecurrent: true\ncustomField: keep me\n---\nBody stays as written.\n';
    const crlf = raw.replace(/\n/g, '\r\n');
    const updated = updateTaskDates(crlf, { due: '2026-10-03', scheduled: '' });

    expect(updated).toContain('due: 2026-10-03\r\n');
    expect(updated).not.toContain('due: 2026-07-10');
    expect(updated).toContain('customField: keep me\r\n');
    expect(updated).toContain('Body stays as written.\r\n');
    expect(updated).toContain('Recurrent: true\r\n');
    expect(updated.replace(/\r\n/g, '')).not.toContain('\n');
    expect(updated.match(/^---\r?$/gm)).toHaveLength(2);
  });

  it('marks CRLF frontmatter done without duplicating frontmatter', () => {
    const updated = markTaskDone(RAW.replace(/\n/g, '\r\n'));
    expect(updated).toContain('status: done\r\n');
    expect(updated).toContain('completedDate: ');
    expect(updated).toContain('tags:\r\n');
    expect(updated.replace(/\r\n/g, '')).not.toContain('\n');
    expect(updated.match(/^---\r?$/gm)).toHaveLength(2);
  });

  it('mutates other CRLF frontmatter through the existing public helpers', () => {
    const raw = RAW.replace(/\n/g, '\r\n');
    const modified = touchDateModified(raw);
    const covered = setPropertyCover(raw, 'assets/cover image.png');
    const recurrent = finishRecurrentTaskInstance(raw, '2026-07-10', '');
    const metadata = updateTaskMetadata(raw, { status: 'done', recurrent: true });
    const thread = updateTaskThreadSubject(raw, 'Quarterly review');

    for (const updated of [modified, covered, recurrent, metadata, thread]) {
      expect(updated.replace(/\r\n/g, '')).not.toContain('\n');
      expect(updated.match(/^---\r?$/gm)).toHaveLength(2);
      expect(updated).toContain('customField: keep me\r\n');
      expect(updated).toContain('Some careful user prose that must never be rewritten.\r\n');
    }
    expect(covered).toContain('cover: "assets/cover image.png"\r\n');
    expect(recurrent).toContain('due: ');
    expect(recurrent).toContain('complete_instances:\r\n');
    expect(metadata).toContain('status: done\r\n');
    expect(thread).toContain('threadSubject: "Quarterly review"\r\n');
  });

  it('markTaskDone changes only status/completedDate/dateModified/tags', () => {
    const updated = markTaskDone(RAW);
    expect(updated).toContain('customField: keep me');
    expect(updated).toContain('nested_unknown:');
    expect(updated).toContain('  - alpha');
    expect(updated).toContain('Some careful user prose that must never be rewritten.');
    expect(updated).toContain('Log: kicked off');
    expect(updated).toContain('status: done');
    expect(updated).toMatch(/completedDate: \d{4}-\d{2}-\d{2}/);
    expect(updated).toMatch(/tags:\n(?:.*\n)*? {2}- archived/);

    const changedLines = updated.split('\n').filter(line => !RAW.includes(line));
    for (const line of changedLines) {
      expect(line).toMatch(/^(status:|completedDate:|dateModified:| {2}- archived)/);
    }
  });

  it('updateTaskDates rewrites only due/scheduled/dateModified', () => {
    const updated = updateTaskDates(RAW, { due: '2026-08-01', scheduled: '2026-07-20' });
    expect(updated).toContain('due: 2026-08-01');
    expect(updated).toContain('customField: keep me');
    expect(updated).toContain('# Quarterly report');
    const changedLines = updated.split('\n').filter(line => !RAW.includes(line));
    for (const line of changedLines) {
      expect(line).toMatch(/^(due:|scheduled:|dateModified:)/);
    }
  });

  it('appendNoteToMd only appends, never rewrites existing content', () => {
    const updated = appendNoteToMd(RAW, 'new log entry', '2026-07-06');
    expect(updated.startsWith(RAW.slice(0, RAW.indexOf('### ')))).toBe(true);
    expect(updated).toContain('new log entry');
    expect(updated).toContain('Log: kicked off');
  });
});
