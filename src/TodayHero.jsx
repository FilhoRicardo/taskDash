// TodayHero — drop-in hero card for the Mission view.
//
// Renders a focus ring (today's worked vs goal) next to a small bar chart
// of the last 5–7 weekdays. Reuses your existing timeClock helpers:
//
//   import { TARGET_WORK_MINUTES, workStats } from './utils/timeClock.js';
//   const today = tod();
//   const week  = weekDates(today);             // array of YYYY-MM-DD
//   const stats = workStats(workNotes[today]);
//
//   <TodayHero
//     workedMinutes={stats.totalMinutes}
//     goalMinutes={TARGET_WORK_MINUTES}
//     clockIn={(workNotes[today]?.workEvents || []).find(e => e.event === 'Clock in')?.time || ''}
//     week={week.map(d => ({ day: shortDow(d), minutes: workStats(workNotes[d]).totalMinutes }))}
//     shippedThisWeek={completedToday.length /* or however you count */}
//   />

import React from 'react';

const fmtHm = (mins) => {
  const m = Math.max(0, Math.round(mins || 0));
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
};

function Ring({ value, max, size = 88, thickness = 8, children }) {
  const r = (size - thickness) / 2;
  const C = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, value / (max || 1)));
  return (
    <div className="tdg-ring-wrap" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.08)" strokeWidth={thickness} fill="none"/>
        <circle cx={size / 2} cy={size / 2} r={r}
          stroke="var(--accent)" strokeWidth={thickness} fill="none"
          strokeDasharray={`${C * pct} ${C}`} strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.6s cubic-bezier(.2,.7,.2,1)' }}/>
      </svg>
      <div className="tdg-ring-label">{children}</div>
    </div>
  );
}

function Bars({ data, target, height = 64 }) {
  const max = Math.max(target || 1, ...data.map(d => d.minutes || 0), 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height }}>
      {data.map((d, i) => {
        const h = ((d.minutes || 0) / max) * height;
        const tone =
          d.minutes >= (target || Infinity) ? 'var(--good)' :
          d.minutes > 0                     ? 'var(--accent)' :
                                              'rgba(255,255,255,0.08)';
        return (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <div className="tdg-bar" style={{
              width: '100%', height: Math.max(2, h), borderRadius: 6,
              background: tone, opacity: tone.startsWith('rgba') ? 0.4 : 0.9,
              animationDelay: `${i * 60}ms`,
            }}/>
            <span style={{ fontSize: 10, color: 'var(--ink-faint)', fontWeight: 600 }}>{d.day}</span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * @param workedMinutes  today's logged minutes (number)
 * @param goalMinutes    target minutes for the day (number, e.g. TARGET_WORK_MINUTES)
 * @param clockIn        first clock-in time today, e.g. "08:42" — optional
 * @param week           array of { day: 'Mon', minutes: 240, date?: 'YYYY-MM-DD' } — typically 5–7 entries
 * @param shippedThisWeek number — count of tasks closed in the trailing 7 days
 * @param streakDays      number — consecutive goal-met days (optional)
 */
export default function TodayHero({
  workedMinutes = 0,
  goalMinutes = 480,
  clockIn = '',
  week = [],
  shippedThisWeek = 0,
  streakDays = 0,
}) {
  const pct = Math.round((workedMinutes / (goalMinutes || 1)) * 100);
  return (
    <div className="glass" style={{
      borderRadius: 'var(--r-lg, 20px)',
      padding: 22,
      marginBottom: 18,
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* accent wash */}
      <div style={{
        position: 'absolute', right: -80, top: -80, width: 280, height: 280, borderRadius: '50%',
        background: 'radial-gradient(circle, oklch(0.65 0.22 var(--accent-h) / 0.5), transparent 70%)',
        filter: 'blur(20px)', pointerEvents: 'none',
      }}/>
      <div style={{
        display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 26,
        alignItems: 'center', position: 'relative',
      }}>
        <Ring value={workedMinutes} max={goalMinutes}>
          <span className="tdg-num">{fmtHm(workedMinutes)}</span>
          <span className="small">of {fmtHm(goalMinutes)}</span>
        </Ring>

        <div>
          <div className="tdg-eyebrow" style={{ marginBottom: 4 }}>Focus today</div>
          <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.025em', lineHeight: 1.05 }}>
            {pct}% of goal
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            {clockIn && <span className="tdg-chip">Clock-in {clockIn}</span>}
            {shippedThisWeek > 0 && <span className="tdg-chip good">{shippedThisWeek} shipped this week</span>}
            {streakDays > 0 && <span className="tdg-chip accent">{streakDays}-day streak</span>}
          </div>
        </div>

        {week.length > 0 && (
          <div style={{ width: 220 }}>
            <div className="tdg-eyebrow" style={{ marginBottom: 8 }}>This week</div>
            <Bars data={week} target={goalMinutes} height={64}/>
          </div>
        )}
      </div>
    </div>
  );
}
