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

// ── Append note to task .md — chronological, timestamped ──
export function appendNoteToMd(raw, noteText) {
  const dateStr = tod();
  const timeStr = new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', hour12:false });
  const logLine = `Log: [${timeStr}] ${noteText}`;
  const todayHeader = `### [[${dateStr}]]`;
  const frontmatter = raw.match(/^---\n[\s\S]*?\n---/);
  const bodyStart = frontmatter ? frontmatter[0].length : 0;

  if (raw.includes(todayHeader)) {
    const headerIdx    = raw.indexOf(todayHeader);
    const headerEnd    = raw.indexOf('\n', headerIdx) + 1;
    let sectionEnd     = raw.length;
    for (const d of ['\n### [[', '\n---\n', '\n## ', '\n# ']) {
      const idx = raw.indexOf(d, headerEnd);
      if (idx !== -1 && idx < sectionEnd) sectionEnd = idx;
    }
    const before = raw.slice(0, sectionEnd).trimEnd();
    const after  = raw.slice(sectionEnd);
    return before + '\n' + logLine + '\n' + after;
  }

  const newEntry  = `\n### [[${dateStr}]]\n${logLine}\n`;
  const sectionRx = /\n### \[\[(\d{4}-\d{2}-\d{2})\]\]/g;
  let m, insertAt = -1;
  while ((m = sectionRx.exec(raw)) !== null) {
    if (m[1] > dateStr) { insertAt = m.index; break; }
  }
  if (insertAt !== -1) return raw.slice(0, insertAt) + newEntry + raw.slice(insertAt);
  const lastSep = raw.lastIndexOf('\n---');
  if (lastSep > bodyStart) return raw.slice(0, lastSep) + newEntry + raw.slice(lastSep);
  return raw.trimEnd() + '\n' + newEntry;
}

// ── Time tracker row ──────────────────────────────────────
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
