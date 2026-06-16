import { describe, expect, it } from 'vitest';
import {
  buildTaskCalendarOccurrences,
  calendarWeekDates,
  groupTaskCalendarOccurrences,
} from '../taskCalendar.js';

describe('calendarWeekDates', () => {
  it('returns a Monday to Sunday week for the selected date', () => {
    expect(calendarWeekDates('2026-06-16')).toEqual([
      '2026-06-15',
      '2026-06-16',
      '2026-06-17',
      '2026-06-18',
      '2026-06-19',
      '2026-06-20',
      '2026-06-21',
    ]);
  });
});

describe('buildTaskCalendarOccurrences', () => {
  const week = calendarWeekDates('2026-06-16');

  it('combines due and scheduled labels when a dated task lands on one day', () => {
    const [occurrence] = buildTaskCalendarOccurrences([
      {
        id:'lease.md',
        title:'Review lease',
        status:'none',
        priority:'high',
        due:'2026-06-17',
        scheduled:'2026-06-17',
      },
    ], week, '2026-06-16');

    expect(occurrence.date).toBe('2026-06-17');
    expect(occurrence.labels).toEqual(['Due', 'Scheduled']);
    expect(occurrence.isOverdue).toBe(false);
  });

  it('expands weekly recurrence across multiple days in the selected week', () => {
    const occurrences = buildTaskCalendarOccurrences([
      {
        id:'report.md',
        title:'Send report',
        status:'none',
        priority:'normal',
        due:'2026-06-15',
        scheduled:'2026-06-15',
        recurrent:true,
        recurrence:'FREQ=WEEKLY;BYDAY=MO,WE,FR',
        completeInstances:['2026-06-17'],
      },
    ], week, '2026-06-16');

    expect(occurrences.map(occurrence => occurrence.date)).toEqual(['2026-06-15', '2026-06-19']);
    expect(occurrences.every(occurrence => occurrence.recurrent)).toBe(true);
  });

  it('groups occurrences by date for the week view', () => {
    const grouped = groupTaskCalendarOccurrences(
      buildTaskCalendarOccurrences([
        { id:'one.md', title:'One', status:'none', priority:'normal', due:'2026-06-16' },
        { id:'two.md', title:'Two', status:'none', priority:'normal', scheduled:'2026-06-18' },
      ], week, '2026-06-16'),
      week,
    );

    expect(grouped['2026-06-16']).toHaveLength(1);
    expect(grouped['2026-06-18']).toHaveLength(1);
    expect(grouped['2026-06-21']).toEqual([]);
  });
});
