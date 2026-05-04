export const fmt = ms => {
  const s=Math.floor(ms/1000),h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sc=s%60;
  return h>0 ? `${h}h ${String(m).padStart(2,'0')}m` : `${String(m).padStart(2,'0')}m ${String(sc).padStart(2,'0')}s`;
};
export const tod = (date = new Date()) => {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};
export const isToday = d => d === tod();
export const isOver  = d => d && d < tod();
export const minsFromMs = ms => Math.round(ms / 60000) || 1;

export function longDate(date = new Date()) {
  return date.toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
}

// ── Local ISO timestamp with timezone offset (matches Obsidian/TaskNotes style) ──
export function isoLocal(date = new Date()) {
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  const y = date.getFullYear();
  const mo = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const mi = pad(date.getMinutes());
  const s = pad(date.getSeconds());
  const ms = pad(date.getMilliseconds(), 3);
  const tz = -date.getTimezoneOffset();
  const sign = tz >= 0 ? '+' : '-';
  const tzh = pad(Math.floor(Math.abs(tz) / 60));
  const tzm = pad(Math.abs(tz) % 60);
  return `${y}-${mo}-${d}T${h}:${mi}:${s}.${ms}${sign}${tzh}:${tzm}`;
}

function normalizeLogDate(rawDate) {
  const iso = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return rawDate;
  const slash = rawDate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!slash) return null;
  const [, d, m, y] = slash;
  return `${y}-${String(Number(m)).padStart(2, '0')}-${String(Number(d)).padStart(2, '0')}`;
}

function dateHeaders(raw) {
  const headers = [];
  const rx = /(^|\n)### (?:\[\[)?(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})(?:\]\])?[ \t]*(?=\n|$)/g;
  let m;
  while ((m = rx.exec(raw)) !== null) {
    const date = normalizeLogDate(m[2]);
    if (date) headers.push({ date, start: m.index + m[1].length, end: rx.lastIndex });
  }
  return headers;
}

function firstSeparator(raw, start, end = raw.length) {
  const rx = /(^|\n)---[ \t]*(?=\n|$)/g;
  rx.lastIndex = start;
  let m;
  while ((m = rx.exec(raw)) !== null) {
    const sepStart = m.index + m[1].length;
    if (sepStart >= end) return -1;
    if (sepStart >= start) return sepStart;
  }
  return -1;
}

function withTrailingSeparator(text) {
  const trimmed = text.trimEnd();
  if (!trimmed) return '';
  return /(^|\n)---$/.test(trimmed) ? `${trimmed}\n` : `${trimmed}\n\n---\n`;
}

// Append note to task .md in chronological date sections.
export function appendNoteToMd(raw, noteText) {
  const dateStr = tod();
  const timeStr = new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', hour12:false });
  const logLine = `Log: [${timeStr}] ${noteText}`;
  const headers = dateHeaders(raw);
  const today = headers.find(h => h.date === dateStr);

  if (today) {
    const next = headers.find(h => h.start > today.start);
    const sectionEnd = next?.start ?? raw.length;
    const insertAt = firstSeparator(raw, today.end, sectionEnd);
    if (insertAt !== -1) {
      return `${raw.slice(0, insertAt).trimEnd()}\n${logLine}\n\n${raw.slice(insertAt)}`;
    }
    return `${raw.slice(0, sectionEnd).trimEnd()}\n${logLine}\n\n---\n${raw.slice(sectionEnd).replace(/^\n+/, '')}`;
  }

  const newEntry = `### [[${dateStr}]]\n${logLine}\n\n---\n`;
  const future = headers.find(h => h.date > dateStr);
  if (future) {
    return `${withTrailingSeparator(raw.slice(0, future.start))}${newEntry}${raw.slice(future.start)}`;
  }
  return `${withTrailingSeparator(raw)}${newEntry}`;
}

export function appendPropertyCommentToMd(raw, commentText) {
  const headingRx = /(^|\n)## Property Comments[ \t]*(?=\n|$)/i;
  const match = headingRx.exec(raw);
  if (!match) {
    const seed = '## Property Comments\n\n---\n';
    return `${raw.trimEnd()}\n\n${appendNoteToMd(seed, commentText)}`;
  }
  const sectionStart = match.index + match[1].length;
  return raw.slice(0, sectionStart) + appendNoteToMd(raw.slice(sectionStart), commentText);
}

// ── Time tracker row ──────────────────────────────────────
export function buildDailyNoteMd(dateStr = tod()) {
  const date = new Date(`${dateStr}T12:00:00`);
  return `---
date: ${dateStr}
tags:
  - daily-note
---

# ${longDate(date)}

---

## Due Today

\`\`\`base
filters:
  and:
    - status != "done"
    - file.folder == "TaskNotes/Tasks"
    - due == "${dateStr}"
properties:
  title:
    displayName: Task
  priority:
    displayName: Priority
  due:
    displayName: Due
  status:
    displayName: Status
views:
  - type: table
    name: Due Today
    order:
      - file.name
      - client
      - priority
      - due
    columnSize:
      file.name: 279
      note.client: 145
      note.priority: 152

\`\`\`

## Overdue

\`\`\`base
filters:
  and:
    - status != "done"
    - file.folder == "TaskNotes/Tasks"
    - due < date("${dateStr}")
properties:
  title:
    displayName: Task
  priority:
    displayName: Priority
  due:
    displayName: Due
  status:
    displayName: Status
views:
  - type: table
    name: Overdue
    order:
      - file.name
      - client
      - priority
      - due
    sort:
      - property: prio
        direction: ASC
    columnSize:
      file.name: 285
      note.client: 151
      note.priority: 144

\`\`\`

## Notes

- 

---

## Reflections

- 

---

## Brain dump - issues

- 
`;
}

export function appendDailySectionEntry(raw, section, text) {
  const labels = {
    notes: 'Notes',
    reflections: 'Reflections',
    brainDump: 'Brain dump - issues',
  };
  const label = labels[section] || labels.notes;
  const headingRx = new RegExp(`(^|\\n)##\\s+.*${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*[ \\t]*(?=\\n|$)`, 'i');
  const match = headingRx.exec(raw);
  const entry = `- ${text.trim()}`;

  if (!match) return `${raw.trimEnd()}\n\n## ${label}\n\n${entry}\n`;

  const start = match.index + match[0].length;
  const rest = raw.slice(start);
  const next = rest.search(/\n##\s+/);
  const end = next === -1 ? raw.length : start + next;
  const sectionText = raw.slice(start, end);
  const placeholderRx = /(^|\n)-\s*([ \t]*)(?=\n|$)/;

  if (placeholderRx.test(sectionText)) {
    const replaced = sectionText.replace(placeholderRx, `$1${entry}`);
    return raw.slice(0, start) + replaced + raw.slice(end);
  }
  return `${raw.slice(0, end).trimEnd()}\n${entry}\n${raw.slice(end)}`;
}

const TRACKER_HEADER = '# Time Tracker\n\n| Date | Task | Duration (min) |\n|------|------|----------------|\n';

export function buildTrackerRow(dateStr, taskLabel, isLinked, durationMs) {
  const mins    = minsFromMs(durationMs);
  const taskCol = isLinked ? `[[${taskLabel}]]` : taskLabel;
  return `| [[${dateStr}]] | ${taskCol} | ${mins} |\n`;
}

export function appendTrackerRow(existing, row) {
  if (!existing || !existing.trim()) return TRACKER_HEADER + row;
  return existing.trimEnd() + '\n' + row;
}

// ── Meeting note file ─────────────────────────────────────
export function buildMeetingMd(title, notes, startTime, endTime) {
  const dateStr     = tod(new Date(startTime));
  const fmtT        = d => new Date(d).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', hour12:false });
  const durationMin = Math.round((endTime - startTime) / 60000) || 1;
  const display     = title.trim() || 'Meeting';
  return `---
status: none
priority: normal
due: ${dateStr}
dateCreated: ${new Date(startTime).toISOString()}
tags:
  - task
  - meeting
title: ${display}
---

# ${display}

**Date:** ${dateStr}
**Start:** ${fmtT(startTime)}
**End:** ${fmtT(endTime)}
**Duration:** ${durationMin} min

## Notes

${notes.trim() || '_No notes added_'}
`;
}

// ── New task .md (mirrors TaskNotes intake) ───────────────
export function buildNewTaskMd({
  title, priority = 'normal', status = 'none',
  due, scheduled, contexts, client, building,
  projects = [], waitingfor, extraTags, body, timeEstimate, recurrent,
}) {
  const now = isoLocal();
  const lines = ['---'];
  lines.push(`status: ${status}`);
  lines.push(`priority: ${priority}`);
  if (due) lines.push(`due: ${due}`);
  if (scheduled) lines.push(`scheduled: ${scheduled}`);

  const ctxArr = (contexts || 'work').split(',').map(s => s.trim()).filter(Boolean);
  if (ctxArr.length) {
    lines.push('contexts:');
    ctxArr.forEach(c => lines.push(`  - ${c}`));
  }

  const projArr = projects.filter(Boolean);
  if (projArr.length) {
    lines.push('projects:');
    projArr.forEach(p => lines.push(`  - "[[${p}]]"`));
  }

  lines.push(`dateCreated: ${now}`);
  lines.push(`dateModified: ${now}`);

  const tagArr = ['task'];
  if (extraTags) {
    extraTags.split(',').map(s => s.trim()).filter(Boolean).forEach(t => {
      if (!tagArr.includes(t)) tagArr.push(t);
    });
  }
  lines.push('tags:');
  tagArr.forEach(t => lines.push(`  - ${t}`));

  lines.push(`title: ${title}`);
  if (timeEstimate && Number(timeEstimate) > 0) lines.push(`timeEstimate: ${Number(timeEstimate)}`);
  if (recurrent) lines.push('Recurrent: true');
  if (client) lines.push(`client: "[[${client}]]"`);
  if (building) lines.push(`building: "[[${building}]]"`);
  if (waitingfor) lines.push(`waitingfor: "[[${waitingfor}]]"`);

  lines.push('---');
  lines.push('### Task Log');
  lines.push('---');
  lines.push('### Initial log');
  lines.push('Log: ');
  if (body && body.trim()) lines.push('', body.trim());
  lines.push('', '---');
  return lines.join('\n') + '\n';
}

function yamlQuote(value = '') {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function splitTags(raw) {
  return (raw || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

export function buildNewPropertyMd({ title, client, summary, tags, coverPath, body }) {
  const today = tod();
  const tagArr = ['properties'];
  splitTags(tags).forEach(t => {
    if (!tagArr.includes(t)) tagArr.push(t);
  });

  const lines = ['---'];
  lines.push(`dateCreated: ${today}`);
  lines.push(`dateModified: ${today}`);
  lines.push(`tags: [${tagArr.join(', ')}]`);
  lines.push('sources: []');
  lines.push(`summary: ${yamlQuote(summary || '')}`);
  lines.push('type: entity');
  lines.push(`building: ${yamlQuote(title)}`);
  if (client) lines.push(`client: ${yamlQuote(`[[${client}]]`)}`);
  if (coverPath) lines.push(`cover: ${coverPath}`);
  lines.push('---');
  lines.push(`# ${title}`);
  if (body && body.trim()) lines.push('', body.trim());
  lines.push('', '## Property Comments', '', '---');
  return lines.join('\n') + '\n';
}

export function buildNewProjectMd({ title, client, summary, status = 'active', tags, body }) {
  const today = tod();
  const tagArr = ['project'];
  splitTags(tags).forEach(t => {
    if (!tagArr.includes(t)) tagArr.push(t);
  });

  const lines = ['---'];
  lines.push(`dateCreated: ${today}`);
  lines.push(`dateModified: ${today}`);
  lines.push(`status: ${status || 'active'}`);
  lines.push(`tags: [${tagArr.join(', ')}]`);
  lines.push(`title: ${yamlQuote(title)}`);
  if (client) lines.push(`client: ${yamlQuote(`[[${client}]]`)}`);
  if (summary) lines.push(`summary: ${yamlQuote(summary)}`);
  lines.push('---');
  lines.push(`# ${title}`);
  lines.push('', body && body.trim() ? body.trim() : '## Notes\n');
  return lines.join('\n') + '\n';
}

export function touchDateModified(raw) {
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return raw;
  let fm = fmMatch[1];
  const re = /^dateModified:[ \t]*.*$/m;
  if (re.test(fm)) fm = fm.replace(re, `dateModified: ${tod()}`);
  else fm = fm + (fm.endsWith('\n') ? '' : '\n') + `dateModified: ${tod()}`;
  return raw.replace(/^---\n[\s\S]*?\n---/, `---\n${fm}\n---`);
}

export function setPropertyCover(raw, coverPath) {
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
  const frontmatter = fmMatch?.[1] || '';
  let fm = frontmatter;

  const upsert = (key, value) => {
    const re = new RegExp(`^${key}:[ \\t]*.*$`, 'm');
    if (re.test(fm)) fm = fm.replace(re, `${key}: ${value}`);
    else fm = fm + (fm.endsWith('\n') || !fm ? '' : '\n') + `${key}: ${value}`;
  };

  upsert('cover', coverPath);
  upsert('dateModified', tod());

  if (!fmMatch) return `---\n${fm}\n---\n\n${raw.trimStart()}`;
  return raw.replace(/^---\n[\s\S]*?\n---/, `---\n${fm}\n---`);
}

// ── Mark task done + archived (in-place frontmatter update) ──
export function markTaskDone(raw) {
  const today = tod();
  const nowIso = isoLocal();

  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return raw;
  let fm = fmMatch[1];

  const upsert = (key, value) => {
    const re = new RegExp(`^${key}:[ \\t]*.*$`, 'm');
    if (re.test(fm)) fm = fm.replace(re, `${key}: ${value}`);
    else fm = fm + (fm.endsWith('\n') ? '' : '\n') + `${key}: ${value}`;
  };

  upsert('status', 'done');
  upsert('completedDate', today);
  upsert('dateModified', nowIso);

  const blockRx = /^tags:\s*\n((?:[ \t]+- [^\n]+\n?)+)/m;
  const inlineRx = /^tags:\s*\[([^\]]*)\]/m;
  const blockMatch = fm.match(blockRx);
  if (blockMatch) {
    if (!/^[ \t]+- archived\b/m.test(blockMatch[1])) {
      const block = blockMatch[1];
      const insert = block.endsWith('\n') ? block + '  - archived\n' : block + '\n  - archived\n';
      fm = fm.replace(blockRx, `tags:\n${insert}`);
    }
  } else {
    const inlineMatch = fm.match(inlineRx);
    if (inlineMatch) {
      const items = inlineMatch[1].split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
      if (!items.includes('archived')) items.push('archived');
      fm = fm.replace(inlineRx, `tags: [${items.join(', ')}]`);
    } else {
      fm = fm + (fm.endsWith('\n') ? '' : '\n') + 'tags:\n  - task\n  - archived';
    }
  }

  return raw.replace(/^---\n[\s\S]*?\n---/, `---\n${fm}\n---`);
}
