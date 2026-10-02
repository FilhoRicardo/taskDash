export const TARGET_WORK_MINUTES = 7.25 * 60;
export const TARGET_WORK_TOLERANCE = 15;
export const WEEK_TARGET_MINUTES = TARGET_WORK_MINUTES * 5;
export const WORK_CHART_MAX_MINUTES = 600;
export const WORK_EVENT_ORDER = ['Clock in', 'Break start', 'Break finish', 'Clock out'];
export const WORK_STATUS_LABELS = {
  workday: 'Workday',
  'bank-holiday': 'Bank holiday',
  'sick-leave': 'Sick leave',
  holiday: 'Holiday',
};

export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function goalBand(minutes) {
  if (!minutes) return 'empty';
  if (minutes < TARGET_WORK_MINUTES - TARGET_WORK_TOLERANCE) return 'below';
  if (minutes > TARGET_WORK_MINUTES + TARGET_WORK_TOLERANCE) return 'above';
  return 'target';
}

export function minutesFromTime(time) {
  const match = String(time || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function dateFromStr(dateStr) {
  return new Date(`${dateStr}T12:00:00`);
}

function weekdayIndex(dateStr) {
  return (dateFromStr(dateStr).getDay() + 6) % 7;
}

export function workStats(note) {
  const rows = (note?.timeClock || [])
    .map(row => ({ ...row, minutes: minutesFromTime(row.time) }))
    .filter(row => row.minutes !== null)
    .sort((a, b) => a.minutes - b.minutes);
  const status = note?.workStatus || 'workday';
  const clockIn = rows.find(row => row.event === 'Clock in')?.minutes;
  const clockOut = [...rows].reverse().find(row => row.event === 'Clock out')?.minutes;
  let sessionStart = null;
  let sessionBreakMinutes = 0;
  let breakStart = null;
  let breakMinutes = 0;
  let totalMinutes = 0;

  for (const row of rows) {
    if (row.event === 'Clock in' && sessionStart === null) {
      sessionStart = row.minutes;
      sessionBreakMinutes = 0;
    }
    if (row.event === 'Break start' && sessionStart !== null) breakStart = row.minutes;
    if (row.event === 'Break finish' && breakStart !== null && row.minutes > breakStart) {
      const duration = row.minutes - breakStart;
      breakMinutes += duration;
      sessionBreakMinutes += duration;
      breakStart = null;
    }
    if (row.event === 'Clock out' && sessionStart !== null && row.minutes > sessionStart) {
      totalMinutes += row.minutes - sessionStart - sessionBreakMinutes;
      sessionStart = null;
    }
  }

  const creditedDay = status !== 'workday';
  if (sessionStart !== null) {
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    if (currentMinutes > sessionStart) totalMinutes += currentMinutes - sessionStart - sessionBreakMinutes;
  }
  totalMinutes = creditedDay ? TARGET_WORK_MINUTES : Math.max(0, totalMinutes);

  return {
    totalMinutes,
    breakMinutes,
    status,
    label: WORK_STATUS_LABELS[status] || WORK_STATUS_LABELS.workday,
    complete: creditedDay || (sessionStart === null && clockIn !== undefined && clockOut !== undefined),
    creditedDay,
  };
}

export function dashboardStats(notes = [], startDate = '', endDate = '') {
  const days = notes
    .filter(note => /^\d{4}-\d{2}-\d{2}$/.test(note?.date || ''))
    .filter(note => !startDate || note.date >= startDate)
    .filter(note => !endDate || note.date <= endDate)
    .map(note => ({ date:note.date, note, ...workStats(note) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const countedDays = days.filter(day => day.totalMinutes > 0);
  const totalMinutes = countedDays.reduce((sum, day) => sum + day.totalMinutes, 0);
  const weekdays = WEEKDAY_LABELS.map((label, index) => {
    const matches = countedDays.filter(day => weekdayIndex(day.date) === index);
    const minutes = matches.reduce((sum, day) => sum + day.totalMinutes, 0);
    return {
      label,
      count: matches.length,
      averageMinutes: matches.length ? Math.round(minutes / matches.length) : 0,
    };
  });

  return {
    days,
    weekdays,
    summary: {
      dailyNotes: days.length,
      totalDays: countedDays.length,
      totalMinutes,
      averageMinutes: countedDays.length ? Math.round(totalMinutes / countedDays.length) : 0,
      overGoal: countedDays.filter(day => goalBand(day.totalMinutes) === 'above').length,
      underGoal: countedDays.filter(day => goalBand(day.totalMinutes) === 'below').length,
      goalMet: countedDays.filter(day => goalBand(day.totalMinutes) === 'target').length,
    },
  };
}
