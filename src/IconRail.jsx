// IconRail — Pane 1 of the 3-pane glass layout.
//
// Renders a vertical strip of rounded-squircle icon buttons that switch
// the active view. Mirrors the existing TaskDash tab set:
//   mission, tasks, calendar, hours, time, meetings, projects, properties, people
// (plus BD and Health icons at the bottom, sourced from the existing `healthBadges`
// state in App.jsx so the dot/badge still surfaces vault issues.)
//
// Drop into src/ and import from App.jsx. Styles live in glass.css.

import React from 'react';

const TABS = [
  { id: 'mission',    label: 'Today',      icon: 'sun' },
  { id: 'tasks',      label: 'Tasks',      icon: 'check' },
  { id: 'calendar',   label: 'Calendar',   icon: 'calendar' },
  { id: 'hours',      label: 'Hours',      icon: 'clock' },
  { id: 'time',       label: 'Time',       icon: 'pulse' },
  { id: 'meetings',   label: 'Meetings',   icon: 'mic' },
  { id: 'projects',   label: 'Projects',   icon: 'folder' },
  { id: 'properties', label: 'Properties', icon: 'home' },
  { id: 'people',     label: 'People',     icon: 'people' },
  { id: 'organizations', label: 'Organizations', icon: 'org' },
];

const Icon = ({ name, size = 18, stroke = 1.8 }) => {
  const p = {
    width: size, height: size, viewBox: '0 0 20 20', fill: 'none',
    stroke: 'currentColor', strokeWidth: stroke, strokeLinecap: 'round', strokeLinejoin: 'round',
  };
  switch (name) {
    case 'sun':    return (<svg {...p}><circle cx="10" cy="10" r="3.2"/><path d="M10 2v1.5M10 16.5V18M2 10h1.5M16.5 10H18M4.2 4.2l1 1M14.8 14.8l1 1M4.2 15.8l1-1M14.8 5.2l1-1"/></svg>);
    case 'check':  return (<svg {...p}><path d="M3.5 10.5l4 4 9-9"/></svg>);
    case 'calendar': return (<svg {...p}><rect x="3.2" y="4.5" width="13.6" height="12" rx="1.6"/><path d="M6.5 2.8v3.4M13.5 2.8v3.4M3.2 8h13.6M6.4 11h.1M10 11h.1M13.6 11h.1M6.4 14h.1M10 14h.1"/></svg>);
    case 'clock':  return (<svg {...p}><circle cx="10" cy="10" r="6.5"/><path d="M10 6.2v4.3l2.9 1.7"/></svg>);
    case 'pulse':  return (<svg {...p}><path d="M2.5 10h3l2-4 3 8 2-4 2 2h3"/></svg>);
    case 'mic':    return (<svg {...p}><rect x="7.5" y="2.5" width="5" height="9" rx="2.5"/><path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v3M7 18h6"/></svg>);
    case 'folder': return (<svg {...p}><path d="M2.5 5.5a1.5 1.5 0 0 1 1.5-1.5h3.2l1.5 2h7.3a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5h-12a1.5 1.5 0 0 1-1.5-1.5z"/></svg>);
    case 'home':   return (<svg {...p}><path d="M3 10l7-7 7 7v6.5A1.5 1.5 0 0 1 15.5 18h-3v-5h-5v5h-3A1.5 1.5 0 0 1 3 16.5z"/></svg>);
    case 'people': return (<svg {...p}><circle cx="7" cy="8" r="2.6"/><path d="M2.5 16c0-2.4 2-4 4.5-4s4.5 1.6 4.5 4"/><circle cx="14" cy="8.5" r="2.2"/><path d="M13 12.5c2 0 4 1 4.5 3.5"/></svg>);
    case 'org':    return (<svg {...p}><path d="M4 18V4.5A1.5 1.5 0 0 1 5.5 3h6A1.5 1.5 0 0 1 13 4.5V18M13 8h2.5A1.5 1.5 0 0 1 17 9.5V18M2.5 18h15"/><path d="M6.5 6.5h1.5M9.5 6.5H11M6.5 9.5h1.5M9.5 9.5H11M6.5 12.5h1.5M9.5 12.5H11"/></svg>);
    case 'brain':  return (<svg {...p}><path d="M7.2 4.2A2.8 2.8 0 0 0 4.5 7c0 .4.1.8.2 1.1A3.2 3.2 0 0 0 3.5 10.6c0 1.5 1 2.7 2.3 3.1.2 1.5 1.4 2.8 3 2.8H10V3.8H8.8c-.6 0-1.1.1-1.6.4z"/><path d="M12.8 4.2A2.8 2.8 0 0 1 15.5 7c0 .4-.1.8-.2 1.1a3.2 3.2 0 0 1 1.2 2.5c0 1.5-1 2.7-2.3 3.1-.2 1.5-1.4 2.8-3 2.8H10V3.8h1.2c.6 0 1.1.1 1.6.4z"/><path d="M6.4 8.2c.7.1 1.4.5 1.8 1.1M13.6 8.2c-.7.1-1.4.5-1.8 1.1M7.4 12.8c.5-.5 1.1-.8 1.8-.8M12.6 12.8c-.5-.5-1.1-.8-1.8-.8"/></svg>);
    case 'person': return (<svg {...p}><circle cx="10" cy="7" r="3"/><path d="M4 18c0-3.3 2.7-6 6-6s6 2.7 6 6"/></svg>);
    case 'cog':    return (<svg {...p}><circle cx="10" cy="10" r="2.5"/><path d="M10 1.5v2.2M10 16.3v2.2M3.5 10H1.3M18.7 10h-2.2M5.1 5.1L3.6 3.6M16.4 16.4l-1.5-1.5M5.1 14.9l-1.5 1.5M16.4 3.6l-1.5 1.5"/></svg>);
    case 'sparkle':return (<svg {...p}><path d="M10 3v3M10 14v3M3 10h3M14 10h3M5 5l2 2M13 13l2 2M5 15l2-2M13 7l2-2"/></svg>);
    case 'heart':  return (<svg {...p}><path d="M10 16.5s-6-3.5-6-8a3.5 3.5 0 0 1 6-2.4A3.5 3.5 0 0 1 16 8.5c0 4.5-6 8-6 8z"/></svg>);
    default: return null;
  }
};

/**
 * @param view        current view id, e.g. 'mission'
 * @param setView     view setter from App.jsx
 * @param vaultName   string shown as the tooltip on the vault badge
 * @param onSettings  optional callback for the cog button (open Configure folders)
 * @param onHealth    optional callback for the health button
 * @param healthOk    boolean — controls health dot color
 */
export default function IconRail({ view, setView, vaultName = 'Vault', onSettings, onHealth, healthOk = true }) {
  return (
    <div className="pane glass-strong rail">
      {/* Vault badge */}
      <button className="rail-btn" aria-label={vaultName} style={{
        background: 'linear-gradient(150deg,#2bb172,#0f6b3f)',
        borderColor: 'rgba(20,120,72,0.28)',
        color: '#fff',
        boxShadow: '0 8px 18px rgba(15,107,63,0.45), inset 0 1px 0 rgba(255,255,255,0.5)',
      }}>
        <Icon name="sparkle"/>
        <span className="tip">{vaultName}</span>
      </button>
      <div className="rail-sep"/>

      {TABS.map(t => (
        <button key={t.id}
          className={`rail-btn ${view === t.id ? 'on' : ''}`}
          onClick={() => setView(t.id)}
          aria-label={t.label}>
          <Icon name={t.icon}/>
          <span className="tip">{t.label}</span>
        </button>
      ))}

      <div style={{ flex: 1 }}/>
      <div className="rail-sep"/>

      <button className={`rail-btn ${view === 'bd' ? 'on' : ''}`} onClick={() => setView('bd')} aria-label="BD tasks">
        <Icon name="brain"/>
        <span className="tip">BD tasks</span>
      </button>
      <button className={`rail-btn ${view === 'projects-personal' ? 'on' : ''}`} onClick={() => setView('projects-personal')} aria-label="Personal projects">
        <Icon name="person"/>
        <span className="tip">Personal projects</span>
      </button>

      {onHealth && (
        <button className="rail-btn" onClick={onHealth} aria-label="Vault health" style={{
          color: healthOk ? '#13733f' : '#c2533f',
          borderColor: healthOk ? 'rgba(20,120,72,0.28)' : 'rgba(225,91,79,0.28)',
          background: healthOk ? 'rgba(20,120,72,0.08)' : 'rgba(225,91,79,0.08)',
        }}>
          <Icon name="heart"/>
          <span className="tip">{healthOk ? 'Vault healthy' : 'Vault has issues'}</span>
        </button>
      )}
      <button className="rail-btn" onClick={onSettings} aria-label="Configure folders">
        <Icon name="cog"/>
        <span className="tip">Configure folders</span>
      </button>
    </div>
  );
}
