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

  it('includes the next due date after a skipped recurrence in the calendar', () => {
    const occurrences = buildTaskCalendarOccurrences([
      {
        id:'weekly.md',
        title:'Weekly task',
        status:'none',
        priority:'normal',
        due:'2026-10-12',
        recurrent:true,
        recurrence:'FREQ=WEEKLY;BYDAY=MO;DTSTART=20260928',
        skippedInstances:['2026-10-05'],
      },
    ], calendarWeekDates('2026-10-12'), '2026-10-12');

    expect(occurrences.map(occurrence => occurrence.date)).toContain('2026-10-12');
  });
  it('counts daily recurrence by calendar day across spring DST', () => {
    const dates = calendarWeekDates('2026-03-30');
    const occurrences = buildTaskCalendarOccurrences([
      {
        id:'dst-daily.md',
        title:'DST daily',
        status:'none',
        priority:'normal',
        due:'2026-03-28',
        recurrent:true,
        recurrence:'DTSTART:20260328;FREQ=DAILY;INTERVAL=2',
      },
    ], dates, '2026-03-30');

    expect(occurrences.map(occurrence => occurrence.date)).toEqual(['2026-03-30', '2026-04-01', '2026-04-03', '2026-04-05']);
  });

  it('counts daily and weekly recurrence by calendar day across fall and spring DST', () => {
    const fallDaily = buildTaskCalendarOccurrences([
      {
        id:'fall-daily.md', title:'Fall daily', status:'none', priority:'normal', due:'2026-10-24', recurrent:true,
        recurrence:'DTSTART:20261024;FREQ=DAILY;INTERVAL=2',
      },
    ], calendarWeekDates('2026-10-26'), '2026-10-26');
    const springWeekly = buildTaskCalendarOccurrences([
      {
        id:'spring-weekly.md', title:'Spring weekly', status:'none', priority:'normal', due:'2026-03-21', recurrent:true,
        recurrence:'DTSTART:20260321;FREQ=WEEKLY;INTERVAL=2',
      },
    ], calendarWeekDates('2026-03-30'), '2026-03-30');
    const fallWeekly = buildTaskCalendarOccurrences([
      {
        id:'fall-weekly.md', title:'Fall weekly', status:'none', priority:'normal', due:'2026-10-24', recurrent:true,
        recurrence:'DTSTART:20261024;FREQ=WEEKLY;INTERVAL=2',
      },
    ], calendarWeekDates('2026-11-02'), '2026-11-02');

    expect(fallDaily.map(occurrence => occurrence.date)).toContain('2026-10-26');
    expect(fallDaily.map(occurrence => occurrence.date)).not.toContain('2026-10-27');
    expect(springWeekly.map(occurrence => occurrence.date)).toContain('2026-04-04');
    expect(fallWeekly.map(occurrence => occurrence.date)).toContain('2026-11-07');
  });
  it('calculates overdue status from each recurring occurrence date', () => {
    const occurrences = buildTaskCalendarOccurrences([
      {
        id:'weekly.md',
        title:'Weekly review',
        status:'none',
        priority:'normal',
        due:'2026-09-28',
        recurrent:true,
        recurrence:'FREQ=WEEKLY;BYDAY=MO',
      },
      {
        id:'daily.md',
        title:'Daily review',
        status:'none',
        priority:'normal',
        due:'2026-09-30',
        recurrent:true,
        recurrence:'FREQ=DAILY',
      },
      {
        id:'ordinary.md',
        title:'Ordinary task',
        status:'none',
        priority:'normal',
        due:'2026-09-28',
      },
    ], ['2026-09-28', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-05'], '2026-10-02');

    expect(occurrences.map(({ taskId, date, isOverdue }) => [taskId, date, isOverdue])).toEqual([
      ['ordinary.md', '2026-09-28', true],
      ['weekly.md', '2026-09-28', true],
      ['daily.md', '2026-10-01', true],
      ['daily.md', '2026-10-02', false],
      ['daily.md', '2026-10-03', false],
      ['daily.md', '2026-10-05', false],
      ['weekly.md', '2026-10-05', false],
    ]);
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

  it('sorts each day by oldest open task first', () => {
    const occurrences = buildTaskCalendarOccurrences([
      { id:'new.md', title:'New', status:'none', priority:'high', due:'2026-06-16', dateCreated:'2026-06-12T09:00:00.000+01:00' },
      { id:'old.md', title:'Old', status:'none', priority:'low', due:'2026-06-16', dateCreated:'2026-05-01T09:00:00.000+01:00' },
      { id:'middle.md', title:'Middle', status:'none', priority:'normal', due:'2026-06-16', dateCreated:'2026-06-01T09:00:00.000+01:00' },
    ], week, '2026-06-16');

    expect(occurrences.map(occurrence => occurrence.taskId)).toEqual(['old.md', 'middle.md', 'new.md']);
  });

  it('uses the last Monday for a monthly ordinal weekday recurrence', () => {
    const dates = ['2026-10-26', '2026-10-28'];
    const occurrences = buildTaskCalendarOccurrences([{
      id: 'month-end.md', title: 'Month end', status: 'none', priority: 'normal',
      due: '2026-09-28', recurrent: true,
      recurrence: 'DTSTART:20260928;FREQ=MONTHLY;BYDAY=-1MO',
    }], dates, '2026-10-01');

    expect(occurrences.map(item => item.date)).toEqual(['2026-10-26']);
  });

  it('uses the second Monday for monthly ordinal weekdays', () => {
    const occurrences = buildTaskCalendarOccurrences([{
      id: 'second-monday.md', title: 'Second Monday', status: 'none', priority: 'normal',
      due: '2026-10-12', recurrent: true,
      recurrence: 'DTSTART:20261012;FREQ=MONTHLY;BYDAY=2MO',
    }], ['2026-10-12', '2026-10-26'], '2026-10-01');

    expect(occurrences.map(item => item.date)).toEqual(['2026-10-12']);
  });

  it('honors UNTIL and COUNT and steps yearly rules by year', () => {
    const dates = ['2026-10-02', '2026-10-03', '2027-10-01', '2027-10-03'];
    const tasks = [
      { id: 'until.md', title: 'Until', status: 'none', recurrent: true, due: '2026-10-01', recurrence: 'DTSTART:20261001;FREQ=DAILY;UNTIL=20261002' },
      { id: 'count.md', title: 'Count', status: 'none', recurrent: true, due: '2026-10-01', recurrence: 'DTSTART:20261001;FREQ=DAILY;COUNT=2' },
      { id: 'yearly.md', title: 'Yearly', status: 'none', recurrent: true, due: '2026-10-01', recurrence: 'DTSTART:20261001;FREQ=YEARLY' },
    ];

    expect(buildTaskCalendarOccurrences(tasks, dates, '2026-10-01').map(item => `${item.taskId}:${item.date}`)).toEqual([
      'count.md:2026-10-02', 'until.md:2026-10-02', 'yearly.md:2027-10-01',
    ]);
  });
});
