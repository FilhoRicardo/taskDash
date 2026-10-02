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
  const start = dateFromStr(startDate);
  const end = dateFromStr(endDate);
  const startDay = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const endDay = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return (endDay - startDay) / 86400000;
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

export function recurrenceMatches(task, dateStr) {
  const parts = parseRecurrenceRule(task.recurrence);
  const activeStart = taskStartDate(task);
  const patternStart = compactDateToIso(parts.DTSTART) || activeStart;
  if (!activeStart || !patternStart || dateStr < activeStart || dateStr < patternStart) return false;
  const freq = (parts.FREQ || 'WEEKLY').toUpperCase();
  const interval = Number(parts.INTERVAL || 1);
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq) || !Number.isInteger(interval) || interval < 1 || interval > 100) return false;
  if (Object.keys(parts).some(key => !['DTSTART', 'FREQ', 'INTERVAL', 'BYDAY', 'UNTIL', 'COUNT'].includes(key))) return false;
  const until = compactDateToIso(parts.UNTIL) || parts.UNTIL || '';
  const count = parts.COUNT === undefined ? Infinity : Number(parts.COUNT);
  if ((count !== Infinity && (!Number.isInteger(count) || count < 1)) || (until && dateStr > until)) return false;
  const diff = daysBetween(patternStart, dateStr);
  if (diff < 0) return false;
  const candidate = dateFromStr(dateStr);
  const start = dateFromStr(patternStart);
  const byDay = String(parts.BYDAY || '').split(',').filter(Boolean);
  const weekdays = { SU:0, MO:1, TU:2, WE:3, TH:4, FR:5, SA:6 };
  const matchesDay = (value, dayStr) => {
    const match = value.match(/^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/);
    if (!match) return false;
    const weekday = weekdays[match[2]];
    const ordinal = match[1] ? Number(match[1]) : null;
    const selected = dateFromStr(dayStr);
    if (!ordinal) return !match[1] && selected.getDay() === weekday;
    if (ordinal < -5 || ordinal > 5 || ordinal === 0) return false;
    const day = selected.getDate();
    if (ordinal > 0) return Math.floor((day - 1) / 7) + 1 === ordinal && selected.getDay() === weekday;
    const lastDay = new Date(selected.getFullYear(), selected.getMonth() + 1, 0).getDate();
    return Math.ceil((lastDay - day + 1) / 7) === -ordinal && selected.getDay() === weekday;
  };
  let matches = false;
  const monthDelta = (candidate.getFullYear() - start.getFullYear()) * 12 + candidate.getMonth() - start.getMonth();
  if (freq === 'DAILY') matches = !byDay.length && diff % interval === 0;
  if (freq === 'WEEKLY') {
    const weekIndex = Math.floor(diff / 7);
    matches = weekIndex % interval === 0 && (byDay.length ? byDay.every(value => !/^([+-]?\d{1,2})/.test(value)) && byDay.some(value => matchesDay(value, dateStr)) : candidate.getDay() === start.getDay());
  }
  if (freq === 'MONTHLY') {
    matches = monthDelta >= 0 && monthDelta % interval === 0 && (byDay.length ? byDay.every(value => /^([+-]?\d{1,2})/.test(value)) && byDay.some(value => matchesDay(value, dateStr)) : candidate.getDate() === start.getDate());
  }
  if (freq === 'YEARLY') matches = !byDay.length && monthDelta >= 0 && monthDelta % (12 * interval) === 0 && candidate.getDate() === start.getDate();
  if (!matches || count === Infinity) return matches;
  let occurrences = 0;
  if (freq === 'DAILY') occurrences = Math.floor(diff / interval) + 1;
  if (freq === 'WEEKLY') {
    const allowed = byDay.length ? byDay.map(value => weekdays[value]) : [start.getDay()];
    for (let week = 0; week <= Math.floor(diff / 7); week += interval) {
      for (const weekday of allowed) {
        const offset = week * 7 + (weekday - start.getDay() + 7) % 7;
        if (offset <= diff) occurrences++;
      }
    }
  }
  if (freq === 'MONTHLY') {
    for (let months = 0; months <= monthDelta; months += interval) {
      const monthStart = new Date(start.getFullYear(), start.getMonth() + months, 1);
      const lastDay = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
      for (let day = 1; day <= lastDay; day++) {
        const selected = `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        if (selected <= dateStr && (byDay.length ? byDay.some(value => matchesDay(value, selected)) : day === start.getDate())) occurrences++;
      }
    }
  }
  if (freq === 'YEARLY') occurrences = Math.floor((candidate.getFullYear() - start.getFullYear()) / interval) + 1;
  return occurrences <= count;
}

function isOccurrenceOverdue(task, dateStr, today) {
  if (!today) return false;
  if (task.recurrent) return dateStr < today;
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
