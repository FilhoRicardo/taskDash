import { describe, expect, it } from 'vitest';
import { TARGET_WORK_MINUTES, dashboardStats, workStats } from '../timeClock.js';

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

  it('credits non-workday statuses at the daily target', () => {
    expect(workStats({ workStatus:'holiday' }).totalMinutes).toBe(TARGET_WORK_MINUTES);
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
