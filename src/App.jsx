import { useState, useEffect, useRef, useCallback } from 'react';
import { parseTask, readMdFiles } from './utils/parser.js';
import { idbGet, idbSet, lsGet, lsSet, lsDel } from './utils/storage.js';
import { fmt, tod, isToday, isOver, appendNoteToMd, buildTrackerRow, appendTrackerRow } from './utils/formatter.js';

const REFRESH_MS  = 5 * 60 * 1000;
const WARN_MS     = 60 * 60 * 1000;
const WARN_CHK_MS = 30 * 1000;

const STATUS_COLORS = {
  done:          { bg:'rgba(16,185,129,0.12)',  color:'#10b981' },
  'in-progress': { bg:'rgba(99,102,241,0.12)',  color:'#818cf8' },
  todo:          { bg:'rgba(59,130,246,0.12)',  color:'#60a5fa' },
  none:          { bg:'rgba(100,116,139,0.12)', color:'#64748b' },
};

async function writeFile(handle, content) {
  const w = await handle.createWritable();
  await w.write(content); await w.close();
}

function Toast({ msg, onClose }) {
  return (
    <div style={{ position:'fixed', top:16, left:'50%', transform:'translateX(-50%)', zIndex:999,
      padding:'12px 20px', borderRadius:10, background:'rgba(245,158,11,0.12)',
      border:'1px solid rgba(245,158,11,0.35)', color:'#fbbf24', fontSize:13, fontWeight:600,
      display:'flex', alignItems:'center', gap:12, boxShadow:'0 4px 24px rgba(0,0,0,0.4)',
      backdropFilter:'blur(12px)', maxWidth:440, fontFamily:'inherit' }}>
      <span>{msg}</span>
      <button onClick={onClose} style={{ background:'none', border:'none', color:'#fbbf24', cursor:'pointer', fontSize:18, lineHeight:1 }}>x</button>
    </div>
  );
}

function PBadge({ p }) {
  return (
    <span style={{ fontSize:9, fontWeight:700, padding:'2px 7px', borderRadius:20,
      textTransform:'uppercase', letterSpacing:'0.05em',
      background: p==='high' ? 'rgba(239,68,68,0.13)' : 'rgba(99,102,241,0.13)',
      color: p==='high' ? '#f87171' : '#818cf8' }}>{p}</span>
  );
}

function SBadge({ s }) {
  const c = STATUS_COLORS[s] || STATUS_COLORS.none;
  return (
    <span style={{ fontSize:9, fontWeight:700, padding:'2px 7px', borderRadius:20,
      textTransform:'uppercase', letterSpacing:'0.05em',
      background: c.bg, color: c.color }}>{s}</span>
  );
}

export default function App() {
  const [tasks,         setTasks]         = useState([]);
  const [taskHandles,   setTaskHandles]   = useState({});
  const [trackerHandle, setTrackerHandle] = useState(null);
  const [dirHandle,     setDirHandle]     = useState(null);
  const [folder,        setFolder]        = useState(null);
  const [savedHandle,   setSavedHandle]   = useState(null);
  const [loading,       setLoading]       = useState(false);
  const [lastSync,      setLastSync]      = useState(null);
  const [needsRefresh,  setNeedsRefresh]  = useState(false);
  const [timer,         setTimer]         = useState(null);
  const [tick,          setTick]          = useState(0);
  const [sel,           setSel]           = useState(null);
  const [note,          setNote]          = useState('');
  const [filt,          setFilt]          = useState('all');
  const [tab,           setTab]           = useState('log');
  const [toast,         setToast]         = useState(null);
  const [showAdHoc,     setShowAdHoc]     = useState(false);
  const [adHocInput,    setAdHocInput]    = useState('');
  const [adHocName,     setAdHocName]     = useState('');
  const adHocRef  = useRef('');
  const warnedRef = useRef(null);
  const tickRef   = useRef();
  const syncRef   = useRef();
  const nudgeRef  = useRef();

  useEffect(() => {
    (async () => {
      const ah = lsGet('adHocName');
      if (ah) { setAdHocName(ah); adHocRef.current = ah; }
      const at = lsGet('activeTimer');
      if (at && Date.now()-at.start < 86400000) setTimer(at);
      else if (at) lsDel('activeTimer');
      try {
        const h = await idbGet('vault');
        if (h) {
          const perm = await h.queryPermission({ mode:'readwrite' });
          if (perm === 'granted') { setDirHandle(h); setFolder(h.name); loadFiles(h); }
          else setSavedHandle(h);
        }
      } catch {}
    })();
  }, []);

  useEffect(() => {
    if (timer) tickRef.current = setInterval(() => setTick(t=>t+1), 1000);
    else clearInterval(tickRef.current);
    return () => clearInterval(tickRef.current);
  }, [timer]);

  useEffect(() => {
    if (!dirHandle) return;
    syncRef.current = setInterval(() => loadFiles(dirHandle), REFRESH_MS);
    return () => clearInterval(syncRef.current);
  }, [dirHandle]);

  useEffect(() => {
    clearTimeout(nudgeRef.current);
    if (!lastSync) return;
    setNeedsRefresh(false);
    nudgeRef.current = setTimeout(() => setNeedsRefresh(true), REFRESH_MS);
    return () => clearTimeout(nudgeRef.current);
  }, [lastSync]);

  useEffect(() => {
    if (!timer) { warnedRef.current = null; return; }
    const chk = setInterval(() => {
      if (Date.now()-timer.start > WARN_MS && warnedRef.current !== timer.start) {
        warnedRef.current = timer.start;
        const name = timer.taskId==='__email__' ? 'Email'
          : timer.taskId==='__meeting__' ? 'Meeting'
          : timer.taskId==='__adhoc__' ? adHocRef.current
          : tasks.find(t=>t.id===timer.taskId)?.title || 'this task';
        setToast(`Over 1 hour on "${name}" - time to switch?`);
      }
    }, WARN_CHK_MS);
    return () => clearInterval(chk);
  }, [timer, tasks]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 7000);
    return () => clearTimeout(t);
  }, [toast]);

  const loadFiles = useCallback(async (dir) => {
    try {
      const raw = await readMdFiles(dir);
      const parsed = raw.map(f => parseTask(f.name, f.text))
        .sort((a,b) => (a.due||'9999') > (b.due||'9999') ? 1 : -1);
      setTasks(parsed);
      const handles = {};
      raw.forEach(f => { handles[f.name] = f.handle; });
      setTaskHandles(handles);
      try {
        const th = await dir.getFileHandle('timetracker.md', { create: true });
        setTrackerHandle(th);
      } catch {}
      setLastSync(Date.now());
      setNeedsRefresh(false);
      setSel(prev => prev || (parsed[0]?.id || null));
    } catch(e) { console.error(e); }
  }, []);

  const pickFolder = async () => {
    setLoading(true);
    try {
      const dir = await window.showDirectoryPicker({ mode:'readwrite' });
      await idbSet('vault', dir);
      setDirHandle(dir); setFolder(dir.name); setSavedHandle(null);
      await loadFiles(dir);
    } catch(e) { if (e.name !== 'AbortError') alert('Error: '+e.message); }
    setLoading(false);
  };

  const resumeFolder = async () => {
    if (!savedHandle) return;
    setLoading(true);
    try {
      const perm = await savedHandle.requestPermission({ mode:'readwrite' });
      if (perm === 'granted') {
        setDirHandle(savedHandle); setFolder(savedHandle.name); setSavedHandle(null);
        await loadFiles(savedHandle);
      }
    } catch(e) { console.error(e); }
    setLoading(false);
  };

  const getTime = useCallback((id) => {
    return timer?.taskId === id ? Date.now() - timer.start : 0;
  }, [timer, tick]);

  const stop = useCallback(async () => {
    if (!timer) return;
    const dur = Date.now() - timer.start;
    const dateStr = tod();
    if (trackerHandle) {
      try {
        const existing = await (await trackerHandle.getFile()).text();
        const isLinked = !['__email__','__meeting__','__adhoc__'].includes(timer.taskId);
        const label = isLinked
          ? tasks.find(t=>t.id===timer.taskId)?.filename || timer.taskId.replace('.md','')
          : timer.taskId==='__adhoc__' ? adHocRef.current
          : timer.taskId==='__email__' ? 'Email' : 'Meeting';
        const row = buildTrackerRow(dateStr, label, isLinked, dur);
        await writeFile(trackerHandle, appendTrackerRow(existing, row));
      } catch(e) { console.error('timetracker write failed', e); }
    }
    setTimer(null); lsDel('activeTimer');
  }, [timer, tasks, trackerHandle]);

  const start = useCallback(async (id) => {
    if (timer) await stop();
    const at = { taskId:id, start:Date.now() };
    setTimer(at); setSel(id); lsSet('activeTimer', at);
  }, [timer, stop]);

  const startAdHoc = async () => {
    if (!adHocInput.trim()) return;
    const name = adHocInput.trim();
    setAdHocName(name); adHocRef.current = name;
    lsSet('adHocName', name);
    setAdHocInput(''); setShowAdHoc(false);
    await start('__adhoc__');
  };

  const addNote = async () => {
    if (!note.trim() || !sel) return;
    const handle = taskHandles[sel];
    if (handle) {
      try {
        const task = tasks.find(t => t.id===sel);
        const updated = appendNoteToMd(task.raw, note.trim());
        await writeFile(handle, updated);
        setTasks(prev => prev.map(t => t.id===sel ? parseTask(t.id, updated) : t));
      } catch(e) { console.error('note write failed', e); }
    }
    setNote('');
  };

  const task      = tasks.find(t => t.id===sel);
  const selTime   = sel ? getTime(sel) : 0;
  const live      = timer?.taskId === sel;
  const totalToday = [...tasks.map(t=>t.id), '__email__','__meeting__','__adhoc__']
    .reduce((a,id) => a + getTime(id), 0);
  const dueColor  = due => isOver(due)?'#ef4444':isToday(due)?'#f59e0b':'#475569';
  const syncLabel = lastSync
    ? `Synced ${new Date(lastSync).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}`
    : 'Not synced';
  const filtered  = tasks.filter(t => {
    if (filt==='today')   return isToday(t.due);
    if (filt==='overdue') return isOver(t.due);
    if (filt==='done')    return t.status==='done';
    return true;
  });
  const QUICK = [
    { id:'__email__',   label:'Email',   icon:'Email' },
    { id:'__meeting__', label:'Meeting', icon:'Meeting' },
  ];
  const btnPrimary = {
    padding:'13px 34px', borderRadius:12, border:'none', cursor:'pointer',
    fontWeight:700, fontSize:14, fontFamily:'inherit',
    background:'linear-gradient(135deg,#7c3aed,#3b82f6)', color:'#fff',
    boxShadow:'0 4px 24px rgba(124,58,237,0.45)',
  };

  if (!folder) return (
    <div style={{ height:'100vh', display:'flex', flexDirection:'column', alignItems:'center',
      justifyContent:'center', gap:20, color:'#e2e8f0',
      background:'radial-gradient(ellipse at 50% -5%,rgba(124,58,237,0.22) 0%,#09090e 65%)' }}>
      <div style={{ fontSize:52 }}>TaskDash</div>
      <div style={{ textAlign:'center' }}>
        <h1 style={{ margin:'0 0 8px', fontSize:32, fontWeight:800,
          background:'linear-gradient(135deg,#c4b5fd,#60a5fa)',
          WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>TaskDash</h1>
        <p style={{ margin:0, color:'#64748b', fontSize:14 }}>Your Obsidian TaskNotes companion</p>
      </div>
      {savedHandle ? (
        <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:10 }}>
          <button onClick={resumeFolder} disabled={loading} style={btnPrimary}>
            {loading ? 'Loading...' : `Resume - ${savedHandle.name}`}
          </button>
          <button onClick={pickFolder} style={{ background:'none', border:'none', color:'#475569', cursor:'pointer', fontSize:12, fontFamily:'inherit' }}>
            or select a different folder
          </button>
        </div>
      ) : (
        <button onClick={pickFolder} disabled={loading} style={btnPrimary}>
          {loading ? 'Reading files...' : 'Select Vault Folder'}
        </button>
      )}
      <p style={{ color:'#334155', fontSize:12 }}>Chrome only - files stay on your device</p>
    </div>
  );

  return (
    <div style={{ display:'flex', height:'100vh', background:'#09090e', color:'#e2e8f0', overflow:'hidden' }}>
      {toast && <Toast msg={toast} onClose={() => setToast(null)} />}

      <div style={{ width:290, flexShrink:0, borderRight:'1px solid rgba(255,255,255,0.06)', display:'flex', flexDirection:'column' }}>

        <div style={{ padding:'18px 14px 12px', borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:4 }}>
            <div style={{ display:'flex', alignItems:'center', gap:7 }}>
              <span style={{ fontWeight:700, fontSize:13 }}>TaskDash</span>
              <span style={{ fontWeight:400, fontSize:11, color:'#475569' }}>{folder}</span>
            </div>
            <button onClick={() => loadFiles(dirHandle)} style={{
              padding:'4px 10px', borderRadius:7, border:'none', cursor:'pointer',
              fontSize:11, fontWeight:600, fontFamily:'inherit',
              background: needsRefresh ? 'rgba(245,158,11,0.2)' : 'rgba(124,58,237,0.15)',
              color: needsRefresh ? '#fbbf24' : '#a78bfa',
            }}>Sync</button>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:5, marginBottom:10 }}>
            <div style={{ width:6, height:6, borderRadius:3, background:'#10b981' }}/>
            <span style={{ fontSize:10, color:'#10b981' }}>{syncLabel}</span>
          </div>
          <div style={{ padding:'11px 13px', borderRadius:10, background:'rgba(124,58,237,0.08)', border:'1px solid rgba(124,58,237,0.18)' }}>
            <div style={{ fontSize:9, color:'#7c3aed', fontWeight:800, letterSpacing:'0.1em', marginBottom:3 }}>TODAY</div>
            <div style={{ fontWeight:800, fontSize:23, fontVariantNumeric:'tabular-nums' }}>{fmt(totalToday)}</div>
            <div style={{ fontSize:10, color:'#475569', marginTop:2 }}>{tasks.length} tasks loaded</div>
          </div>
        </div>

        <div style={{ padding:'8px 10px', borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ fontSize:9, color:'#475569', fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase', marginBottom:6 }}>Quick Track</div>
          {QUICK.map(({ id, label }) => {
            const running = timer?.taskId===id, time = getTime(id);
            return (
              <div key={id} style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
                padding:'7px 10px', marginBottom:4, borderRadius:9,
                background: running ? 'rgba(16,185,129,0.08)' : 'rgba(255,255,255,0.02)',
                border:`1px solid ${running?'rgba(16,185,129,0.25)':'rgba(255,255,255,0.05)'}` }}>
                <div style={{ display:'flex', alignItems:'center', gap:7 }}>
                  <span style={{ fontSize:12, fontWeight:600, color:running?'#10b981':'#e2e8f0' }}>{label}</span>
                  {time>0 && <span style={{ fontSize:11, fontWeight:700, fontVariantNumeric:'tabular-nums', color:running?'#10b981':'#6366f1' }}>{fmt(time)}</span>}
                  {running && <span style={{ fontSize:9, padding:'1px 5px', borderRadius:20, background:'rgba(16,185,129,0.12)', color:'#10b981', fontWeight:700 }}>LIVE</span>}
                </div>
                <button onClick={running?stop:()=>start(id)} style={{
                  padding:'4px 12px', borderRadius:6, border:'none', cursor:'pointer', fontWeight:700, fontSize:11, fontFamily:'inherit',
                  background: running ? 'rgba(239,68,68,0.1)' : 'linear-gradient(135deg,#7c3aed,#3b82f6)',
                  color: running ? '#f87171' : '#fff',
                  outline: running ? '1px solid rgba(239,68,68,0.25)' : 'none',
                }}>{running ? 'Stop' : 'Start'}</button>
              </div>
            );
          })}

          {timer?.taskId==='__adhoc__' ? (
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
              padding:'7px 10px', borderRadius:9,
              background:'rgba(16,185,129,0.08)', border:'1px solid rgba(16,185,129,0.25)' }}>
              <div style={{ display:'flex', alignItems:'center', gap:7 }}>
                <span style={{ fontSize:12, fontWeight:600, color:'#10b981', maxWidth:100, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{adHocName||'Ad-hoc'}</span>
                <span style={{ fontSize:11, fontWeight:700, fontVariantNumeric:'tabular-nums', color:'#10b981' }}>{fmt(getTime('__adhoc__'))}</span>
                <span style={{ fontSize:9, padding:'1px 5px', borderRadius:20, background:'rgba(16,185,129,0.12)', color:'#10b981', fontWeight:700 }}>LIVE</span>
              </div>
              <button onClick={stop} style={{ padding:'4px 12px', borderRadius:6, border:'none', cursor:'pointer', fontWeight:700, fontSize:11, fontFamily:'inherit', background:'rgba(239,68,68,0.1)', color:'#f87171', outline:'1px solid rgba(239,68,68,0.25)' }}>Stop</button>
            </div>
          ) : showAdHoc ? (
            <div style={{ padding:'8px 10px', borderRadius:9, background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.08)' }}>
              <div style={{ fontSize:11, color:'#64748b', marginBottom:6 }}>What are you working on?</div>
              <div style={{ display:'flex', gap:6 }}>
                <input value={adHocInput} onChange={e=>setAdHocInput(e.target.value)}
                  onKeyDown={e=>e.key==='Enter'&&startAdHoc()} autoFocus
                  placeholder="e.g. Proposal draft..."
                  style={{ flex:1, padding:'6px 10px', borderRadius:7, background:'rgba(255,255,255,0.05)',
                    border:'1px solid rgba(255,255,255,0.1)', color:'#e2e8f0', fontSize:12, outline:'none', fontFamily:'inherit' }}/>
                <button onClick={startAdHoc} disabled={!adHocInput.trim()} style={{ padding:'6px 10px', borderRadius:7, border:'none', cursor:'pointer', fontWeight:700, fontSize:11, fontFamily:'inherit', background:'linear-gradient(135deg,#7c3aed,#3b82f6)', color:'#fff', opacity:adHocInput.trim()?1:0.4 }}>Go</button>
                <button onClick={()=>{setShowAdHoc(false);setAdHocInput('');}} style={{ padding:'6px 8px', borderRadius:7, border:'none', cursor:'pointer', background:'rgba(255,255,255,0.05)', color:'#64748b', fontSize:12 }}>X</button>
              </div>
            </div>
          ) : (
            <button onClick={()=>setShowAdHoc(true)} style={{ width:'100%', padding:'7px 10px', borderRadius:9,
              border:'1px dashed rgba(255,255,255,0.1)', background:'transparent', color:'#475569',
              fontSize:12, fontWeight:600, cursor:'pointer', textAlign:'left', fontFamily:'inherit' }}>
              + Ad-hoc task...
            </button>
          )}
        </div>

        <div style={{ display:'flex', gap:3, padding:'8px 10px', borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
          {['all','today','overdue','done'].map(f => (
            <button key={f} onClick={()=>setFilt(f)} style={{
              flex:1, padding:'5px 0', borderRadius:7, border:'none', cursor:'pointer',
              fontSize:10, fontWeight:600, textTransform:'capitalize', fontFamily:'inherit',
              background: filt===f ? 'rgba(124,58,237,0.15)' : 'transparent',
              color: filt===f ? '#a78bfa' : '#475569',
            }}>{f}</button>
          ))}
        </div>

        <div style={{ flex:1, overflowY:'auto', padding:'6px 8px' }}>
          {!filtered.length && <div style={{ color:'#475569', textAlign:'center', paddingTop:40, fontSize:12 }}>No tasks</div>}
          {filtered.map(t => {
            const running=timer?.taskId===t.id, active=sel===t.id, time=getTime(t.id);
            return (
              <div key={t.id} onClick={()=>setSel(t.id)} style={{
                padding:'10px', marginBottom:4, borderRadius:10, cursor:'pointer',
                background: active ? 'rgba(124,58,237,0.1)' : 'rgba(255,255,255,0.02)',
                border:`1px solid ${active?'rgba(124,58,237,0.28)':'rgba(255,255,255,0.04)'}`,
                boxShadow: running ? '0 0 14px rgba(16,185,129,0.18)' : 'none' }}>
                <div style={{ display:'flex', justifyContent:'space-between', gap:6, marginBottom:5 }}>
                  <span style={{ fontSize:12, fontWeight:500, lineHeight:1.35, flex:1 }}>{t.title}</span>
                  {running && <span style={{ fontSize:9, padding:'2px 6px', borderRadius:20, background:'rgba(16,185,129,0.12)', color:'#10b981', fontWeight:700 }}>LIVE</span>}
                </div>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:4 }}>
                  <div style={{ display:'flex', gap:4, alignItems:'center', flexWrap:'wrap' }}>
                    <PBadge p={t.priority}/>
                    <SBadge s={t.status}/>
                    {t.due && <span style={{ fontSize:10, fontWeight:500, color:dueColor(t.due) }}>
                      {isToday(t.due)?'Today':isOver(t.due)?'Overdue':t.due}
                    </span>}
                  </div>
                  {time>0 && <span style={{ fontSize:11, color:'#6366f1', fontWeight:700, fontVariantNumeric:'tabular-nums' }}>{fmt(time)}</span>}
                </div>
                {t.checklistTotal>0 && (
                  <div style={{ marginTop:7 }}>
                    <div style={{ height:2, borderRadius:2, background:'rgba(255,255,255,0.05)' }}>
                      <div style={{ height:'100%', borderRadius:2, background:'linear-gradient(90deg,#7c3aed,#3b82f6)', width:`${Math.round(t.checklistDone/t.checklistTotal*100)}%` }}/>
                    </div>
                    <div style={{ fontSize:10, color:'#475569', marginTop:2 }}>{t.checklistDone}/{t.checklistTotal} done</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {!task ? (
        <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'#334155', fontSize:13 }}>Select a task</div>
      ) : (
        <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
          <div style={{ padding:'22px 30px 18px', borderBottom:'1px solid rgba(255,255,255,0.06)', flexShrink:0 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:24 }}>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display:'flex', gap:7, alignItems:'center', marginBottom:9, flexWrap:'wrap' }}>
                  <PBadge p={task.priority}/>
                  <SBadge s={task.status}/>
                  {task.due && <span style={{ fontSize:12, color:dueColor(task.due) }}>
                    {isToday(task.due)?'Due Today':isOver(task.due)?`Overdue - ${task.due}`:task.due}
                  </span>}
                  {task.client && <span style={{ fontSize:12, color:'#475569' }}>- {task.client}</span>}
                  {task.building && <span style={{ fontSize:12, color:'#475569' }}>- {task.building}</span>}
                </div>
                <h2 style={{ margin:0, fontSize:19, fontWeight:700, lineHeight:1.35, color:'#f1f5f9' }}>{task.title}</h2>
              </div>
              <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:10, flexShrink:0 }}>
                <div style={{ fontSize:31, fontWeight:800, fontVariantNumeric:'tabular-nums',
                  color:live?'#10b981':'#e2e8f0', textShadow:live?'0 0 28px rgba(16,185,129,0.55)':'none' }}>
                  {fmt(selTime)}
                </div>
                <button onClick={live?stop:()=>start(task.id)} style={{
                  padding:'9px 24px', borderRadius:10, border:'none', cursor:'pointer', fontWeight:700, fontSize:13, fontFamily:'inherit',
                  background: live ? 'rgba(239,68,68,0.1)' : 'linear-gradient(135deg,#7c3aed,#3b82f6)',
                  color: live ? '#f87171' : '#fff',
                  boxShadow: live ? 'inset 0 0 0 1px rgba(239,68,68,0.3)' : '0 4px 16px rgba(124,58,237,0.4)',
                }}>{live ? 'Stop' : 'Start'}</button>
              </div>
            </div>
          </div>

          <div style={{ display:'flex', padding:'0 30px', borderBottom:'1px solid rgba(255,255,255,0.06)', flexShrink:0 }}>
            {['log','checklist'].map(t => (
              <button key={t} onClick={()=>setTab(t)} style={{
                padding:'10px 16px', border:'none', background:'transparent', cursor:'pointer',
                fontSize:13, fontWeight:600, textTransform:'capitalize', marginBottom:-1, fontFamily:'inherit',
                color: tab===t ? '#a78bfa' : '#475569',
                borderBottom:`2px solid ${tab===t?'#7c3aed':'transparent'}`,
              }}>
                {t}{t==='checklist'&&task.checklistTotal>0?` - ${task.checklistDone}/${task.checklistTotal}`:''}
              </button>
            ))}
          </div>

          <div style={{ flex:1, overflowY:'auto', padding:'18px 30px' }}>
            {tab==='log' && (
              <div>
                <div style={{ display:'flex', gap:8, marginBottom:18 }}>
                  <input value={note} onChange={e=>setNote(e.target.value)}
                    onKeyDown={e=>e.key==='Enter'&&!e.shiftKey&&addNote()}
                    placeholder="Add a note... press Enter to save (writes to your .md file)"
                    style={{ flex:1, padding:'10px 14px', borderRadius:10,
                      background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.09)',
                      color:'#e2e8f0', fontSize:13, outline:'none', fontFamily:'inherit' }}/>
                  <button onClick={addNote} disabled={!note.trim()} style={{
                    padding:'10px 20px', borderRadius:10, border:'none', cursor:'pointer',
                    fontWeight:600, fontSize:13, fontFamily:'inherit',
                    background:'linear-gradient(135deg,#7c3aed,#3b82f6)', color:'#fff',
                    opacity:note.trim()?1:0.35,
                  }}>Add</button>
                </div>
                {!task.logs.length && (
                  <div style={{ color:'#334155', textAlign:'center', padding:'60px 0', fontSize:13 }}>
                    <div style={{ fontSize:28, marginBottom:10 }}>Notes you add here write directly to your .md file</div>
                  </div>
                )}
                {task.logs.map((l, i) => (
                  <div key={i} style={{ marginBottom:8, padding:'11px 14px', borderRadius:10,
                    background:'rgba(124,58,237,0.07)', border:'1px solid rgba(124,58,237,0.15)' }}>
                    <div style={{ fontSize:10, color:'#7c3aed', marginBottom:5, fontWeight:700 }}>{l.date}</div>
                    <div style={{ fontSize:13, lineHeight:1.55 }}>{l.text}</div>
                  </div>
                ))}
              </div>
            )}
            {tab==='checklist' && (
              <div>
                {!task.checklist.length && (
                  <div style={{ color:'#334155', textAlign:'center', padding:'60px 0', fontSize:13 }}>No checklist items</div>
                )}
                {task.checklist.map((c, i) => (
                  <div key={i} style={{ display:'flex', gap:11, alignItems:'flex-start',
                    padding:'9px 0', borderBottom:'1px solid rgba(255,255,255,0.04)' }}>
                    <span style={{ flexShrink:0, fontSize:14 }}>{c.done?'âœ“':'â—‹'}</span>
                    <span style={{ fontSize:13, lineHeight:1.5,
                      color: c.done ? '#334155' : '#e2e8f0',
                      textDecoration: c.done ? 'line-through' : 'none' }}>{c.text}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
