export const fmt = ms => {
  const s=Math.floor(ms/1000),h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sc=s%60;
  return h>0 ? `${h}h ${String(m).padStart(2,'0')}m` : `${String(m).padStart(2,'0')}m ${String(sc).padStart(2,'0')}s`;
};
export const tod = () => new Date().toISOString().slice(0,10);
export const isToday = d => d === tod();
export const isOver  = d => d && d < tod();
export const minsFromMs = ms => Math.round(ms / 60000) || 1;

// ── Append note to task .md — chronological, timestamped ──
export function appendNoteToMd(raw, noteText) {
  const dateStr = tod();
  const timeStr = new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', hour12:false });
  const logLine = `Log: [${timeStr}] ${noteText}`;
  const todayHeader = `### [[${dateStr}]]`;

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
  if (lastSep !== -1) return raw.slice(0, lastSep) + newEntry + raw.slice(lastSep);
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
  const dateStr     = new Date(startTime).toISOString().slice(0,10);
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
