export const fmt = ms => {
  const s=Math.floor(ms/1000),h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sc=s%60;
  return h>0 ? `${h}h ${String(m).padStart(2,'0')}m` : `${String(m).padStart(2,'0')}m ${String(sc).padStart(2,'0')}s`;
};
export const tod = () => new Date().toISOString().slice(0,10);
export const isToday = d => d === tod();
export const isOver  = d => d && d < tod();
export const minsFromMs = ms => Math.round(ms / 60000) || 1;

export function appendNoteToMd(raw, noteText) {
  const dateStr = tod();
  const entry = `\n### [[${dateStr}]]\nLog: ${noteText}\n`;
  if (raw.includes('\n---\n')) {
    const idx = raw.lastIndexOf('\n---\n');
    return raw.slice(0, idx) + entry + raw.slice(idx);
  }
  return raw.trimEnd() + '\n' + entry;
}

const HEADER = '# Time Tracker\n\n| Date | Task | Duration (min) |\n|------|------|----------------|\n';

export function buildTrackerRow(dateStr, taskLabel, isLinked, durationMs) {
  const mins = minsFromMs(durationMs);
  const taskCol = isLinked ? `[[${taskLabel}]]` : taskLabel;
  return `| [[${dateStr}]] | ${taskCol} | ${mins} |\n`;
}

export function appendTrackerRow(existing, row) {
  if (!existing || !existing.trim()) return HEADER + row;
  return existing.trimEnd() + '\n' + row;
}
