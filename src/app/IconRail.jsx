// IconRail — native-feeling TaskDash navigation pane.
//
// Renders a vertical strip of rounded-squircle icon buttons that switch
// the active view. Mirrors the existing TaskDash tab set:
//   mission, tasks, calendar, hours, time, meetings, projects, properties, people
// (plus BD and Health icons at the bottom, sourced from the existing `healthBadges`
// state in App.jsx so the dot/badge still surfaces vault issues.)
//
// Drop into src/ and import from App.jsx. Styles live in glass.css.

import React from 'react';
import { setIcon } from 'obsidian';

const TAB_GROUPS = [
  ['Work', [
    { id:'mission', label:'Today', icon:'sun' },
    { id:'tasks', label:'Tasks', icon:'check' },
    { id:'review', label:'Review', icon:'review' },
    { id:'waiting', label:'Waiting', icon:'waiting' },
    { id:'calendar', label:'Calendar', icon:'calendar' },
  ]],
  ['Track', [
    { id:'hours', label:'Hours', icon:'clock' },
    { id:'time', label:'Time', icon:'pulse' },
    { id:'meetings', label:'Meetings', icon:'mic' },
  ]],
  ['Reference', [
    { id:'projects', label:'Projects', icon:'folder' },
    { id:'properties', label:'Properties', icon:'home' },
    { id:'people', label:'People', icon:'people' },
    { id:'organizations', label:'Organizations', icon:'org' },
  ]],
];

const ICON_NAMES = {
  sun:'sun', check:'check', calendar:'calendar-days', clock:'clock-3', pulse:'activity',
  mic:'mic', folder:'folder', home:'building-2', people:'users', org:'landmark',
  brain:'brain', review:'clipboard-check', waiting:'user-check', person:'user-round', cog:'settings', sparkle:'layout-dashboard', heart:'heart-pulse',
};

const Icon = ({ name, size = 18 }) => {
  const iconRef = React.useRef(null);
  React.useEffect(() => {
    if (!iconRef.current) return;
    iconRef.current.replaceChildren();
    setIcon(iconRef.current, ICON_NAMES[name] || 'circle');
  }, [name]);
  return <span ref={iconRef} aria-hidden="true" style={{ width:size, height:size, display:'inline-flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}/>
};

/**
 * @param view        current view id, e.g. 'mission'
 * @param setView     view setter from App.jsx
 * @param vaultName   string shown as the tooltip on the vault badge
 * @param onSettings  optional callback for the cog button (open Configure folders)
 * @param onHealth    optional callback for the health button
 * @param healthOk    boolean — controls health dot color
 */
export default function IconRail({ view, setView, vaultName = 'Vault', onSettings, onHealth, healthOk = true, isNarrow = false, onNewTask, onOpenList }) {
  const [mobileMoreOpen, setMobileMoreOpen] = React.useState(false);
  const openView = id => { setMobileMoreOpen(false); setView(id); };
  return (
    <div className="pane glass-strong rail">
      {/* Vault badge */}
      <button className="rail-btn rail-vault-btn" aria-label={vaultName} style={{
        background: 'linear-gradient(150deg,#2bb172,#0f6b3f)',
        borderColor: 'rgba(20,120,72,0.28)',
        color: '#fff',
        boxShadow: '0 8px 18px rgba(15,107,63,0.45), inset 0 1px 0 rgba(255,255,255,0.5)',
      }}>
        <Icon name="sparkle"/>
        <span className="rail-brand-label">TaskDash</span>
        <span className="tip">{vaultName}</span>
      </button>
      <div className="rail-sep"/>

      <div className="rail-desktop-tabs">
        {TAB_GROUPS.map(([group, tabs]) => (
          <div key={group} className="rail-group">
            <span className="rail-group-label">{group}</span>
            {tabs.map(t => (
              <button key={t.id}
                className={`rail-btn ${view === t.id ? 'on' : ''}`}
                onClick={() => setView(t.id)}
                aria-label={t.label}
                aria-current={view === t.id ? 'page' : undefined}>
                <Icon name={t.icon}/>
                <span className="rail-nav-label">{t.label}</span>
                <span className="tip">{t.label}</span>
              </button>
            ))}
          </div>
        ))}
      </div>

      <div className="rail-mobile-tabs">
        <button className={`rail-btn ${view === 'mission' ? 'on' : ''}`} onClick={() => setView('mission')} aria-label="Today">
          <Icon name="sun"/><span className="rail-mobile-label">Today</span>
        </button>
        <button className={`rail-btn ${view === 'tasks' ? 'on' : ''}`} onClick={() => onOpenList?.()} aria-label="Tasks">
          <Icon name="check"/><span className="rail-mobile-label">Tasks</span>
        </button>
        <button className={`rail-btn ${view === 'calendar' ? 'on' : ''}`} onClick={() => setView('calendar')} aria-label="Calendar">
          <Icon name="calendar"/><span className="rail-mobile-label">Calendar</span>
        </button>
        <button className="rail-btn" onClick={onNewTask} aria-label="Capture a new task">
          <Icon name="sparkle"/><span className="rail-mobile-label">Capture</span>
        </button>
        <button className={`rail-btn ${mobileMoreOpen ? 'on' : ''}`} onClick={()=>setMobileMoreOpen(value => !value)} aria-label="More views and settings" aria-expanded={mobileMoreOpen}>
          <Icon name="folder"/><span className="rail-mobile-label">More</span>
        </button>
        {mobileMoreOpen && (
          <div className="rail-mobile-more-menu" role="menu">
            {[
              ['review','Review'], ['waiting','Waiting'], ['meetings','Meetings'], ['hours','Hours'], ['time','Time'],
              ['projects','Projects'], ['projects-personal','Personal projects'],
              ['properties','Properties'], ['people','People'], ['organizations','Organizations'],
              ['bd','Brain Dump'], ['health','Vault health'],
            ].map(([id,label]) => <button key={id} type="button" role="menuitem" onClick={()=>openView(id)}>{label}</button>)}
            <button type="button" role="menuitem" onClick={()=>{ setMobileMoreOpen(false); onSettings?.(); }}>Configure folders</button>
          </div>
        )}
      </div>

      <div style={{ flex: 1 }}/>
      <div className="rail-sep"/>

      <div className="rail-desktop-secondary">
      <button className={`rail-btn ${view === 'bd' ? 'on' : ''}`} onClick={() => setView('bd')} aria-label="BD tasks">
        <Icon name="brain"/>
        <span className="rail-nav-label">Brain Dump</span>
        <span className="tip">BD tasks</span>
      </button>
      <button className={`rail-btn ${view === 'projects-personal' ? 'on' : ''}`} onClick={() => setView('projects-personal')} aria-label="Personal projects">
        <Icon name="person"/>
        <span className="rail-nav-label">Personal</span>
        <span className="tip">Personal projects</span>
      </button>

      {onHealth && (
        <button className="rail-btn" onClick={onHealth} aria-label="Vault health" style={{
          color: healthOk ? '#13733f' : '#c2533f',
          borderColor: healthOk ? 'rgba(20,120,72,0.28)' : 'rgba(225,91,79,0.28)',
          background: healthOk ? 'rgba(20,120,72,0.08)' : 'rgba(225,91,79,0.08)',
        }}>
          <Icon name="heart"/>
          <span className="rail-nav-label">Vault health</span>
          <span className="tip">{healthOk ? 'Vault healthy' : 'Vault has issues'}</span>
        </button>
      )}
      <button className="rail-btn" onClick={onSettings} aria-label="Configure folders">
        <Icon name="cog"/>
        <span className="rail-nav-label">Settings</span>
        <span className="tip">Configure folders</span>
      </button>
      </div>
    </div>
  );
}
