import { afterEach, describe, expect, it, vi } from 'vitest';
import { TARGET_WORK_MINUTES, dashboardStats, workStats } from '../timeClock.js';
import { parseDailyNote } from '../parser.js';

afterEach(() => vi.useRealTimers());

describe('workStats', () => {
  it('subtracts completed breaks from a daily time clock', () => {
    const stats = workStats({
      timeClock: [
        { time:'09:00', event:'Clock in' },
        { time:'12:30', event:'Break start' },
        { time:'13:00', event:'Break finish' },
        { time:'17:15', event:'Clock out' },
      ],
    });

    expect(stats.totalMinutes).toBe(465);
    expect(stats.breakMinutes).toBe(30);
  });

  it('sums separate clocked-in sessions without counting the gap', () => {
    const stats = workStats({
      timeClock: [
        { time:'09:00', event:'Clock in' },
        { time:'12:00', event:'Clock out' },
        { time:'13:00', event:'Clock in' },
        { time:'17:00', event:'Clock out' },
      ],
    });

    expect(stats.totalMinutes).toBe(420);
  });

  it('counts an incomplete trailing session through the current time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 18, 14, 0));

    const stats = workStats({
      timeClock: [
        { time:'09:00', event:'Clock in' },
        { time:'12:00', event:'Clock out' },
        { time:'13:00', event:'Clock in' },
      ],
    });

    expect(stats.totalMinutes).toBe(240);
    expect(stats.complete).toBe(false);
  });

  it('credits non-workday statuses at the daily target', () => {
    expect(workStats({ workStatus:'holiday' }).totalMinutes).toBe(TARGET_WORK_MINUTES);
  });

  it('calculates separate sessions from a parsed daily note', () => {
    const note = parseDailyNote('2026-05-18.md', [
      '---', 'date: 2026-05-18', '---', '# Monday', '', '## Time Clock', '',
      '| Time | Event |', '| --- | --- |', '| 09:00 | Clock in |',
      '| 12:00 | Clock out |', '| 13:00 | Clock in |', '| 17:00 | Clock out |',
    ].join('\n'));

    expect(workStats(note).totalMinutes).toBe(420);
  });
});

describe('dashboardStats', () => {
  it('filters daily notes and averages tracked days by weekday', () => {
    const dashboard = dashboardStats([
      { date:'2026-05-18', timeClock:[{ time:'09:00', event:'Clock in' }, { time:'17:00', event:'Clock out' }] },
      { date:'2026-05-19', timeClock:[{ time:'09:00', event:'Clock in' }, { time:'15:30', event:'Clock out' }] },
      { date:'2026-05-25', timeClock:[{ time:'09:00', event:'Clock in' }, { time:'18:00', event:'Clock out' }] },
      { date:'2026-05-26', timeClock:[] },
      { date:'Loose note', timeClock:[{ time:'09:00', event:'Clock in' }, { time:'17:00', event:'Clock out' }] },
    ], '2026-05-18', '2026-05-25');

    expect(dashboard.days).toHaveLength(3);
    expect(dashboard.summary).toMatchObject({
      dailyNotes: 3,
      totalDays: 3,
      overGoal: 2,
      underGoal: 1,
      goalMet: 0,
    });
    expect(dashboard.weekdays[0]).toMatchObject({ label:'Mon', count:2, averageMinutes:510 });
    expect(dashboard.weekdays[1]).toMatchObject({ label:'Tue', count:1, averageMinutes:390 });
  });
});
