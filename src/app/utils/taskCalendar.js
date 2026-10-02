const DAY_MS = 86400000;

function toIsoDate(date = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function cleanIsoDate(value) {
  return String(value || '').match(/\d{4}-\d{2}-\d{2}/)?.[0] || '';
}

function dateFromStr(dateStr) {
  return new Date(`${dateStr}T12:00:00`);
}

function addDays(dateStr, amount) {
  const date = dateFromStr(dateStr);
  date.setDate(date.getDate() + amount);
  return toIsoDate(date);
}

function daysBetween(startDate, endDate) {
  return Math.floor((dateFromStr(endDate) - dateFromStr(startDate)) / DAY_MS);
}

function monthDiff(startDate, endDate) {
  const start = dateFromStr(startDate);
  const end = dateFromStr(endDate);
  return (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth();
}

function compactDateToIso(value) {
  const match = String(value || '').match(/^(\d{4})(\d{2})(\d{2})$/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
}

function parseRecurrenceRule(rule = '') {
  const cleaned = String(rule || '').trim().replace(/^RRULE:/i, '');
  const out = {};
  cleaned.split(';').forEach(part => {
    const sep = part.includes(':') ? ':' : '=';
    const [key, ...rest] = part.split(sep);
    if (key) out[key.trim().toUpperCase()] = rest.join(sep).trim();
  });
  return out;
}

function taskStartDate(task) {
  return [cleanIsoDate(task?.scheduled), cleanIsoDate(task?.due)]
    .filter(Boolean)
    .sort()[0] || cleanIsoDate(task?.dateCreated);
}

function labelsForDate(task, dateStr, recurrent = false) {
  const labels = [];
  if (cleanIsoDate(task.due) === dateStr) labels.push('Due');
  if (cleanIsoDate(task.scheduled) === dateStr) labels.push('Scheduled');
  if (recurrent) labels.push('Recurrent');
  return [...new Set(labels)];
}

function recurrenceMatches(task, dateStr) {
  const parts = parseRecurrenceRule(task.recurrence);
  const activeStart = taskStartDate(task);
  const patternStart = compactDateToIso(parts.DTSTART) || activeStart;
  if (!activeStart || !patternStart || dateStr < activeStart || dateStr < patternStart) return false;

  const diff = daysBetween(patternStart, dateStr);
  if (diff < 0) return false;

  const freq = (parts.FREQ || 'WEEKLY').toUpperCase();
  const interval = Math.max(1, Number(parts.INTERVAL || 1) || 1);
  const candidate = dateFromStr(dateStr);
  const start = dateFromStr(patternStart);
  const weekDays = { SU:0, MO:1, TU:2, WE:3, TH:4, FR:5, SA:6 };
  const byDay = String(parts.BYDAY || '')
    .split(',')
    .map(day => weekDays[day.trim().slice(-2).toUpperCase()])
    .filter(Number.isInteger);

  if (freq === 'DAILY') return diff % interval === 0;

  if (freq === 'WEEKLY') {
    const allowedDays = byDay.length ? byDay : [start.getDay()];
    const weekIndex = Math.floor(diff / 7);
    return allowedDays.includes(candidate.getDay()) && weekIndex % interval === 0;
  }

  if (freq === 'MONTHLY') {
    return candidate.getDate() === start.getDate() && monthDiff(patternStart, dateStr) % interval === 0;
  }

  return diff % 7 === 0;
}

function isOccurrenceOverdue(task, dateStr, today) {
  if (!today) return false;
  const due = cleanIsoDate(task.due);
  return due ? due < today : dateStr < today;
}

function openDate(task) {
  return cleanIsoDate(task?.dateCreated) || '9999-12-31';
}

export function calendarWeekDates(dateStr) {
  const selected = cleanIsoDate(dateStr) || toIsoDate();
  const day = dateFromStr(selected).getDay() || 7;
  const monday = addDays(selected, 1 - day);
  return Array.from({ length:7 }, (_, index) => addDays(monday, index));
}

export function calendarWeekRangeLabel(dates = []) {
  if (!dates.length) return '';
  const first = dateFromStr(dates[0]);
  const last = dateFromStr(dates[dates.length - 1]);
  const startLabel = first.toLocaleDateString('en-US', { month:'short', day:'numeric' });
  const endLabel = last.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
  return `${startLabel} - ${endLabel}`;
}

export function buildTaskCalendarOccurrences(tasks = [], dates = [], today = toIsoDate()) {
  const dateSet = new Set(dates);
  const occurrences = [];

  const addOccurrence = (task, dateStr, labels, recurrent = false) => {
    if (!dateSet.has(dateStr)) return;
    occurrences.push({
      id: `${task.id}::${dateStr}::${labels.join('+')}`,
      taskId: task.id,
      task,
      date: dateStr,
      labels,
      recurrent,
      isOverdue: isOccurrenceOverdue(task, dateStr, today),
    });
  };

  tasks.forEach(task => {
    if (!task || task.archived || task.status === 'done') return;
    const completed = new Set([...(task.completeInstances || []), ...(task.skippedInstances || [])].map(cleanIsoDate).filter(Boolean));

    if (task.recurrent) {
      dates.forEach(dateStr => {
        if (completed.has(dateStr) || !recurrenceMatches(task, dateStr)) return;
        addOccurrence(task, dateStr, labelsForDate(task, dateStr, true), true);
      });
      return;
    }

    const byDate = new Map();
    [['Due', cleanIsoDate(task.due)], ['Scheduled', cleanIsoDate(task.scheduled)]].forEach(([label, dateStr]) => {
      if (!dateSet.has(dateStr)) return;
      byDate.set(dateStr, [...(byDate.get(dateStr) || []), label]);
    });
    byDate.forEach((labels, dateStr) => addOccurrence(task, dateStr, [...new Set(labels)]));
  });

  return occurrences.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    const age = openDate(a.task).localeCompare(openDate(b.task));
    return age || String(a.task.title || '').localeCompare(String(b.task.title || ''));
  });
}

export function groupTaskCalendarOccurrences(occurrences = [], dates = []) {
  const grouped = Object.fromEntries(dates.map(date => [date, []]));
  occurrences.forEach(occurrence => {
    if (!grouped[occurrence.date]) grouped[occurrence.date] = [];
    grouped[occurrence.date].push(occurrence);
  });
  return grouped;
}
