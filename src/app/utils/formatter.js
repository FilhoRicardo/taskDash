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

function readFrontmatter(raw) {
  const match = raw.match(/^---(\r?\n)([\s\S]*?)\r?\n---/);
  if (!match) return null;
  return {
    fm: match[2].replace(/\r\n/g, '\n'),
    write: fm => `${raw.slice(0, match.index)}---${match[1]}${fm.replace(/\n/g, match[1])}${match[1]}---${raw.slice(match.index + match[0].length)}`,
  };
}

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

function replaceLogLine(raw, targetDate, targetText, occurrence = 0, nextText = null) {
  const headers = dateHeaders(raw);
  let seen = 0;

  for (let i = 0; i < headers.length; i++) {
    const header = headers[i];
    if (header.date !== targetDate) continue;

    const sectionEnd = headers[i + 1]?.start ?? raw.length;
    const section = raw.slice(header.end, sectionEnd);
    const rx = /^Log:\s*([\s\S]*?)(?=\nLog:\s|\n---[ \t]*(?=\n|$)|(?![\s\S]))/gm;
    let match;

    while ((match = rx.exec(section)) !== null) {
      if (match[1].trim() !== targetText) continue;
      if (seen !== occurrence) {
        seen += 1;
        continue;
      }

      const lineStart = header.end + match.index;
      const lineEnd = lineStart + match[0].length;
      const replacement = nextText === null ? '' : `Log: ${nextText.trim()}`;
      return `${raw.slice(0, lineStart)}${replacement}${raw.slice(lineEnd)}`;
    }
  }

  return raw;
}

export function updateCommentLog(raw, targetDate, targetText, occurrence, nextText) {
  if (!nextText?.trim()) return raw;
  return replaceLogLine(raw, targetDate, targetText, occurrence, nextText);
}

export function deleteCommentLog(raw, targetDate, targetText, occurrence) {
  return replaceLogLine(raw, targetDate, targetText, occurrence, null);
}

// ── Time tracker row ──────────────────────────────────────
export function buildDailyNoteMd(dateStr = tod()) {
  const date = new Date(`${dateStr}T12:00:00`);
  return `---
date: ${dateStr}
workStatus: workday
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

## Time Clock

| Time | Event |
| --- | --- |

---

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

function timeLabel(date = new Date()) {
  return date.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', hour12:false });
}

function ensureFrontmatter(raw) {
  return /^---\r?\n[\s\S]*?\r?\n---/.test(raw) ? raw : `---\n---\n\n${raw.trimStart()}`;
}

function setFrontmatterValue(raw, key, value) {
  const withFm = ensureFrontmatter(raw);
  const frontmatter = readFrontmatter(withFm);
  if (!frontmatter) return withFm;
  const fm = frontmatter.fm;
  const rx = new RegExp(`^${key}:.*$`, 'm');
  const nextFm = rx.test(fm) ? fm.replace(rx, `${key}: ${value}`) : `${fm.trimEnd()}\n${key}: ${value}`;
  return frontmatter.write(nextFm);
}

function timeClockSection(rows = []) {
  const body = rows
    .filter(row => row?.time && row?.event)
    .map(row => `| ${row.time} | ${row.event} |`)
    .join('\n');
  return `## Time Clock\n\n| Time | Event |\n| --- | --- |\n${body ? `${body}\n` : ''}\n---\n\n`;
}

export function setDailyWorkStatus(raw, status) {
  return setFrontmatterValue(raw, 'workStatus', status || 'workday');
}

export function replaceDailyTimeClockRows(raw, rows = []) {
  const headingRx = /(^|\n)##\s+.*Time Clock[ \t]*(?=\n|$)/i;
  const match = headingRx.exec(raw);
  const section = timeClockSection(rows);

  if (!match) {
    const notesRx = /(^|\n)##\s+.*Notes[ \t]*(?=\n|$)/i;
    const notesMatch = notesRx.exec(raw);
    if (notesMatch) {
      const insertAt = notesMatch.index + notesMatch[1].length;
      return raw.slice(0, insertAt) + section + raw.slice(insertAt);
    }
    return `${raw.trimEnd()}\n\n${section}`;
  }

  const start = match.index + match[1].length;
  const bodyStart = match.index + match[0].length;
  const rest = raw.slice(bodyStart);
  const next = rest.search(/\n##\s+/);
  const end = next === -1 ? raw.length : bodyStart + next;
  return raw.slice(0, start) + section + raw.slice(end).replace(/^\n+/, '');
}

export function appendDailyTimeClockEvent(raw, event, date = new Date()) {
  const row = { time: timeLabel(date), event };
  const headingRx = /(^|\n)##\s+.*Time Clock[ \t]*(?=\n|$)/i;
  const match = headingRx.exec(raw);

  if (!match) {
    return replaceDailyTimeClockRows(raw, [row]);
  }

  const start = match.index + match[0].length;
  const rest = raw.slice(start);
  const next = rest.search(/\n##\s+/);
  const end = next === -1 ? raw.length : start + next;
  const sectionText = raw.slice(start, end);

  if (!/\|\s*Time\s*\|\s*Event\s*\|/i.test(sectionText)) {
    return raw.slice(0, match.index + match[1].length) + timeClockSection([row]) + raw.slice(end).replace(/^\n+/, '');
  }

  const separator = sectionText.search(/\n---[ \t]*(?=\n|$)/);
  if (separator !== -1) {
    const insertAt = start + separator;
    return `${raw.slice(0, insertAt).trimEnd()}\n| ${row.time} | ${row.event} |\n\n${raw.slice(insertAt).replace(/^\n+/, '')}`;
  }
  return `${raw.slice(0, end).trimEnd()}\n| ${row.time} | ${row.event} |\n\n---\n\n${raw.slice(end).replace(/^\n+/, '')}`;
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
export function buildMeetingMd(title, notes, startTime, endTime, links = {}) {
  const dateStr     = tod(new Date(startTime));
  const fmtT        = d => new Date(d).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', hour12:false });
  const durationMin = Math.round((endTime - startTime) / 60000) || 1;
  const display     = title.trim() || 'Meeting';
  const linkRows = [
    ['Clients', links.clients],
    ['Properties', links.properties],
    ['Tasks', links.tasks],
    ['People', links.people],
  ]
    .filter(([, values]) => values?.length)
    .map(([label, values]) => `- **${label}:** ${values.map(v => `[[${v}]]`).join(', ')}`);
  const contextSection = linkRows.length ? `\n## Linked context\n\n${linkRows.join('\n')}\n` : '';
  return `---
status: none
priority: normal
due: ${dateStr}
dateCreated: ${new Date(startTime).toISOString()}
tags:
  - meeting
title: ${display}
---

# ${display}

**Date:** ${dateStr}
**Start:** ${fmtT(startTime)}
**End:** ${fmtT(endTime)}
**Duration:** ${durationMin} min
${contextSection}

## Notes

${notes.trim() || '_No notes added_'}
`;
}

// ── New task .md (mirrors TaskNotes intake) ───────────────
export function buildNewTaskMd({
  title, priority = 'normal', status = 'none',
  due, contexts, client, building,
  projects = [], waitingfor, extraTags, body, timeEstimate, recurrent,
}) {
  const now = isoLocal();
  const lines = ['---'];
  lines.push(`status: ${status}`);
  lines.push(`priority: ${priority}`);
  if (due) lines.push(`due: ${due}`);

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

// Vault naming convention: lowercase kebab-case filenames ("Paula Chipont"
// becomes paula-chipont.md). Used for every note created via the UI.
export function kebabSlug(title, fallback = 'untitled') {
  return String(title || '').trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180) || fallback;
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
  if (coverPath) lines.push(`cover: ${yamlQuote(coverPath)}`);
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

export function buildNewPersonMd({ name, company, role, email, phone, tags, body }) {
  const today = tod();
  const tagArr = ['people'];
  splitTags(tags).forEach(t => {
    if (!tagArr.includes(t)) tagArr.push(t);
  });

  const lines = ['---'];
  lines.push(`dateCreated: ${today}`);
  lines.push(`dateModified: ${today}`);
  lines.push(`tags: [${tagArr.join(', ')}]`);
  lines.push('type: person');
  lines.push(`person: ${yamlQuote(name)}`);
  if (company) lines.push(`company: ${yamlQuote(`[[${company}]]`)}`);
  if (role) lines.push(`role: ${yamlQuote(role)}`);
  if (email) lines.push(`email: ${yamlQuote(email)}`);
  if (phone) lines.push(`phone: ${yamlQuote(phone)}`);
  lines.push('---');
  lines.push(`# ${name}`);
  lines.push('');
  if (body && body.trim()) lines.push(body.trim());
  else lines.push('## Notes', '');
  return lines.join('\n') + '\n';
}

export function buildNewOrganizationMd({ name, industry, website, email, phone, tags, body }) {
  const today = tod();
  const tagArr = ['organizations'];
  splitTags(tags).forEach(t => {
    if (!tagArr.includes(t)) tagArr.push(t);
  });

  const lines = ['---'];
  lines.push(`dateCreated: ${today}`);
  lines.push(`dateModified: ${today}`);
  lines.push(`tags: [${tagArr.join(', ')}]`);
  lines.push('type: organization');
  lines.push(`organization: ${yamlQuote(name)}`);
  if (industry) lines.push(`industry: ${yamlQuote(industry)}`);
  if (website) lines.push(`website: ${yamlQuote(website)}`);
  if (email) lines.push(`email: ${yamlQuote(email)}`);
  if (phone) lines.push(`phone: ${yamlQuote(phone)}`);
  lines.push('---');
  lines.push(`# ${name}`);
  lines.push('');
  if (body && body.trim()) lines.push(body.trim());
  else lines.push('## Notes', '');
  return lines.join('\n') + '\n';
}

export function touchDateModified(raw) {
  const frontmatter = readFrontmatter(raw);
  if (!frontmatter) return raw;
  let fm = frontmatter.fm;
  const re = /^dateModified:[ \t]*.*$/m;
  if (re.test(fm)) fm = fm.replace(re, `dateModified: ${tod()}`);
  else fm = fm + (fm.endsWith('\n') ? '' : '\n') + `dateModified: ${tod()}`;
  return frontmatter.write(fm);
}

export function setPropertyCover(raw, coverPath) {
  const frontmatter = readFrontmatter(raw);
  let fm = frontmatter?.fm || '';

  const upsert = (key, value) => {
    const re = new RegExp(`^${key}:[ \\t]*.*$`, 'm');
    if (re.test(fm)) fm = fm.replace(re, `${key}: ${value}`);
    else fm = fm + (fm.endsWith('\n') || !fm ? '' : '\n') + `${key}: ${value}`;
  };

  upsert('cover', yamlQuote(coverPath));
  upsert('dateModified', tod());

  if (!frontmatter) return `---\n${fm}\n---\n\n${raw.trimStart()}`;
  return frontmatter.write(fm);
}

function addDays(dateStr, days) {
  const d = dateStr ? new Date(`${dateStr}T12:00:00`) : new Date();
  d.setDate(d.getDate() + days);
  return tod(d);
}

function addMonths(dateStr, months) {
  const d = dateStr ? new Date(`${dateStr}T12:00:00`) : new Date();
  const originalDay = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() < originalDay) d.setDate(0);
  return tod(d);
}

export function updateTaskDates(raw, { due, scheduled }) {
  const frontmatter = readFrontmatter(raw);
  if (!frontmatter) return raw;
  let fm = frontmatter.fm;

  const upsertOrRemove = (key, value) => {
    const re = new RegExp(`^${key}:[ \\t]*.*$`, 'm');
    if (value) {
      if (re.test(fm)) fm = fm.replace(re, `${key}: ${value}`);
      else fm = fm + (fm.endsWith('\n') ? '' : '\n') + `${key}: ${value}`;
    } else {
      fm = fm.replace(new RegExp(`^${key}:[ \\t]*.*\\n?`, 'm'), '');
    }
  };

  upsertOrRemove('due', due);
  upsertOrRemove('scheduled', scheduled);
  const modifiedRx = /^dateModified:[ \t]*.*$/m;
  if (modifiedRx.test(fm)) fm = fm.replace(modifiedRx, `dateModified: ${isoLocal()}`);
  else fm = fm + (fm.endsWith('\n') ? '' : '\n') + `dateModified: ${isoLocal()}`;

  return frontmatter.write(fm.trimEnd());
}

function replaceFrontmatterField(fm, key, nextLines = []) {
  const lines = String(fm || '').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (new RegExp(`^${key}:`).test(lines[i])) {
      const hasInlineValue = lines[i].slice(lines[i].indexOf(':') + 1).trim();
      if (!hasInlineValue) {
        while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) i += 1;
      }
    } else {
      out.push(lines[i]);
    }
  }
  if (nextLines.length) out.push(...nextLines);
  return out.filter((line, index, all) => line || (index > 0 && index < all.length - 1)).join('\n');
}

export function updateTaskMetadata(raw, {
  priority = 'normal',
  status = 'none',
  contexts = [],
  client = '',
  building = '',
  projects = [],
  waitingfor = '',
  tags = [],
  timeEstimate = '',
  recurrent = false,
}) {
  const frontmatter = readFrontmatter(raw);
  if (!frontmatter) return raw;
  let fm = frontmatter.fm;
  const cleanList = values => [...new Set((values || []).map(value => String(value).trim()).filter(Boolean))];
  const setScalar = (key, value) => {
    fm = replaceFrontmatterField(fm, key, value ? [`${key}: ${value}`] : []);
  };
  const setList = (key, values, format = value => value) => {
    const clean = cleanList(values);
    fm = replaceFrontmatterField(fm, key, clean.length ? [`${key}:`, ...clean.map(value => `  - ${format(value)}`)] : []);
  };

  setScalar('priority', priority || 'normal');
  setScalar('status', status || 'none');
  setList('contexts', contexts, yamlQuote);
  setScalar('client', client ? yamlQuote(`[[${client.trim()}]]`) : '');
  setScalar('building', building ? yamlQuote(`[[${building.trim()}]]`) : '');
  setList('projects', projects, value => yamlQuote(`[[${value}]]`));
  setScalar('waitingfor', waitingfor ? yamlQuote(`[[${waitingfor.trim()}]]`) : '');
  setList('tags', ['task', ...cleanList(tags).filter(tag => !['task', 'recurrent', 'recurring'].includes(tag.toLowerCase()))]);
  setScalar('timeEstimate', Number(timeEstimate) > 0 ? String(Number(timeEstimate)) : '');
  fm = replaceFrontmatterField(fm, 'recurrent');
  fm = replaceFrontmatterField(fm, 'Recurrent', recurrent ? ['Recurrent: true'] : []);
  setScalar('dateModified', isoLocal());

  return frontmatter.write(fm.trim());
}

export function updateTaskThreadSubject(raw, threadSubject) {
  const frontmatter = readFrontmatter(raw);
  if (!frontmatter) return raw;
  let fm = frontmatter.fm;
  const value = String(threadSubject || '').trim();
  const subjectRx = /^threadSubject:[ \t]*.*\n?/m;

  if (value) {
    const line = `threadSubject: ${yamlQuote(value)}`;
    if (subjectRx.test(fm)) fm = fm.replace(subjectRx, `${line}\n`);
    else fm = fm + (fm.endsWith('\n') ? '' : '\n') + `${line}\n`;
  } else {
    fm = fm.replace(subjectRx, '');
  }

  const modifiedRx = /^dateModified:[ \t]*.*$/m;
  if (modifiedRx.test(fm)) fm = fm.replace(modifiedRx, `dateModified: ${isoLocal()}`);
  else fm = fm + (fm.endsWith('\n') ? '' : '\n') + `dateModified: ${isoLocal()}`;

  return frontmatter.write(fm.trimEnd());
}

export function postponeTaskDates(raw, currentDue, currentScheduled, days = 7) {
  const due = addDays(currentDue || currentScheduled || tod(), days);
  return updateTaskDates(raw, { due, scheduled: '' });
}

export function postponeTaskDatesByMonths(raw, currentDue, currentScheduled, months = 1) {
  const due = addMonths(currentDue || currentScheduled || tod(), months);
  return updateTaskDates(raw, { due, scheduled: '' });
}

function parseLocalDate(dateStr) {
  return new Date(`${dateStr}T12:00:00`);
}

function daysBetween(a, b) {
  return Math.floor((parseLocalDate(b) - parseLocalDate(a)) / 86400000);
}

function compactDateToIso(value) {
  const m = value?.match?.(/^(\d{4})(\d{2})(\d{2})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function parseRecurrenceRule(rule = '') {
  const out = {};
  const normalizedRule = String(rule).trim().replace(/^['"]|['"]$/g, '').replace(/^RRULE:/i, '');
  normalizedRule.split(';').forEach(part => {
    const sep = part.includes(':') ? ':' : '=';
    const [key, ...rest] = part.split(sep);
    if (key) out[key.trim().toUpperCase()] = rest.join(sep).trim();
  });
  return out;
}

function nextRecurrenceDate(rule, afterDate, excluded = []) {
  const parts = parseRecurrenceRule(rule);
  const freq = (parts.FREQ || 'WEEKLY').toUpperCase();
  const interval = Number(parts.INTERVAL || 1);
  const dtstart = compactDateToIso(parts.DTSTART) || afterDate;
  const excludedSet = new Set(excluded);
  const weekDays = { SU:0, MO:1, TU:2, WE:3, TH:4, FR:5, SA:6 };
  const byDay = (parts.BYDAY || '')
    .split(',')
    .map(d => weekDays[d.trim().slice(-2).toUpperCase()])
    .filter(d => Number.isInteger(d));
  const startDate = parseLocalDate(dtstart);
  const startDay = startDate.getDay();

  for (let i = 1; i <= 3700; i++) {
    const candidate = addDays(afterDate, i);
    if (candidate < dtstart || excludedSet.has(candidate)) continue;
    const candDate = parseLocalDate(candidate);
    const diffDays = daysBetween(dtstart, candidate);

    if (freq === 'DAILY' && diffDays % interval === 0) return candidate;

    if (freq === 'WEEKLY') {
      const allowedDays = byDay.length ? byDay : [startDay];
      const weekIndex = Math.floor(diffDays / 7);
      if (allowedDays.includes(candDate.getDay()) && weekIndex % interval === 0) return candidate;
    }

    if (freq === 'MONTHLY') {
      const monthDiff = (candDate.getFullYear() - startDate.getFullYear()) * 12 + candDate.getMonth() - startDate.getMonth();
      if (candDate.getDate() === startDate.getDate() && monthDiff % interval === 0) return candidate;
    }
  }

  return addDays(afterDate, 7);
}

function frontmatterUpsert(fm, key, value) {
  const re = new RegExp(`^${key}:[ \\t]*.*$`, 'm');
  if (re.test(fm)) return fm.replace(re, `${key}: ${value}`);
  return fm + (fm.endsWith('\n') ? '' : '\n') + `${key}: ${value}`;
}

function frontmatterRemove(fm, key) {
  return fm.replace(new RegExp(`^${key}:[ \\t]*.*\\n?`, 'm'), '');
}

function frontmatterArray(fm, key) {
  const field = fm.match(new RegExp(`^${key}:[ \\t]*(.*)(?:\\n((?:(?:[ \\t]*)- [^\\n]+\\n?)+))?`, 'm'));
  if (!field) return [];
  const inline = field[1].trim();
  if (inline.startsWith('[') && inline.endsWith(']')) {
    return inline.slice(1, -1).split(',').map(value => value.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  }
  if (inline) return [];
  return (field[2] || '').split('\n')
    .map(line => line.trim().replace(/^- /, '').trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

function upsertFrontmatterArray(fm, key, values) {
  const clean = [...new Set(values.filter(Boolean))].sort();
  const existingField = fm.match(new RegExp(`^${key}:[^\\n]*(?:\\n(?:(?:[ \\t]*)- [^\\n]+))*`, 'm'))?.[0] || '';
  const quoteValues = /(?:\[[^\]]*['"]|(?:^|\n)[ \t]*- ['"])/.test(existingField);
  const block = `${key}:\n${clean.map(v => `  - ${quoteValues ? `"${v}"` : v}`).join('\n')}\n`;
  const rx = new RegExp(`^${key}:[ \\t]*(?:\\[[^\\n]*\\])?[ \\t]*\\n?(?:(?:[ \\t]*)- [^\\n]+\\n?)*`, 'm');
  if (rx.test(fm)) return fm.replace(rx, block);
  const recurrenceRx = /^recurrence:[ \t]*.*$/m;
  if (key === 'complete_instances' && recurrenceRx.test(fm)) return fm.replace(recurrenceRx, match => `${match}\n${block}`);
  return fm + (fm.endsWith('\n') ? '' : '\n') + block;
}

export function finishRecurrentTaskInstance(raw, currentDue, currentScheduled) {
  const frontmatter = readFrontmatter(raw);
  if (!frontmatter) return raw;
  let fm = frontmatter.fm;
  const recurrence = fm.match(/^recurrence:[ \t]*(.*)$/m)?.[1]?.trim() || '';
  const instanceDate = currentDue || currentScheduled || tod();
  const completed = frontmatterArray(fm, 'complete_instances');
  const skipped = frontmatterArray(fm, 'skipped_instances');
  const completedNext = completed.includes(instanceDate) ? completed : [...completed, instanceDate];
  const nextDate = recurrence ? nextRecurrenceDate(recurrence, instanceDate, [...completedNext, ...skipped]) : addDays(instanceDate, 7);

  fm = upsertFrontmatterArray(fm, 'complete_instances', completedNext);
  fm = frontmatterUpsert(fm, 'due', nextDate);
  fm = frontmatterRemove(fm, 'scheduled');
  fm = frontmatterUpsert(fm, 'dateModified', isoLocal());

  return frontmatter.write(fm.trimEnd());
}

// ── Mark task done + archived (in-place frontmatter update) ──
export function markTaskDone(raw) {
  const today = tod();
  const nowIso = isoLocal();

  const frontmatter = readFrontmatter(raw);
  if (!frontmatter) return raw;
  let fm = frontmatter.fm;

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

  return frontmatter.write(fm);
}
