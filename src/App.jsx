import { useState, useEffect, useRef, useCallback } from 'react';
import { parseTask, parseProperty, parseProject, parseDailyNote, readMdFiles, readDirNames, readImageFiles } from './utils/parser.js';
import { idbGet, idbSet, idbDel, lsGet, lsSet, lsDel } from './utils/storage.js';
import { fmt, tod, isToday, isOver, longDate, appendNoteToMd, appendPropertyCommentToMd, appendDailySectionEntry, buildDailyNoteMd, buildTrackerRow, appendTrackerRow, buildMeetingMd, buildNewTaskMd, buildNewPropertyMd, buildNewProjectMd, markTaskDone, postponeTaskDates, setPropertyCover, touchDateModified, updateTaskDates } from './utils/formatter.js';

const REFRESH_MS  = 5 * 60 * 1000;
const WARN_MS     = 60 * 60 * 1000;
const WARN_CHK_MS = 30 * 1000;

const FOLDER_DEFS = [
  { key:'tasks',      label:'Tasks',      mode:'readwrite', required:true,  desc:'Where your task .md files live (e.g. TaskNotes/Tasks)' },
  { key:'projects',   label:'Projects',   mode:'readwrite', required:false, desc:'For project autocomplete and project editing' },
  { key:'properties', label:'Properties', mode:'readwrite', required:false, desc:'For building autocomplete and property comments' },
  { key:'clients',    label:'Clients',    mode:'read',      required:false, desc:'For client autocomplete' },
  { key:'people',     label:'People',     mode:'read',      required:false, desc:'For "waiting for" autocomplete' },
  { key:'attachments', label:'Attachments', mode:'readwrite', required:false, desc:'For property cover images and uploads' },
  { key:'daily',      label:'Daily Notes', mode:'readwrite', required:false, desc:'Where TaskDash should auto-create YYYY-MM-DD daily notes' },
];
const REF_KEYS = ['projects','properties','clients','people'];
const FOLDER_SETUP_SEEN = 'folderSetupV2Seen';

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
      <button onClick={onClose} style={{ background:'none', border:'none', color:'#fbbf24', cursor:'pointer', fontSize:18, lineHeight:1 }}>×</button>
    </div>
  );
}

function PBadge({ p }) {
  return <span style={{ fontSize:9, fontWeight:700, padding:'2px 7px', borderRadius:20, textTransform:'uppercase', letterSpacing:'0.05em',
    background:p==='high'?'rgba(239,68,68,0.13)':'rgba(99,102,241,0.13)', color:p==='high'?'#f87171':'#818cf8' }}>{p}</span>;
}

function SBadge({ s }) {
  const c = STATUS_COLORS[s] || STATUS_COLORS.none;
  return <span style={{ fontSize:9, fontWeight:700, padding:'2px 7px', borderRadius:20, textTransform:'uppercase', letterSpacing:'0.05em', background:c.bg, color:c.color }}>{s}</span>;
}

function parseLogText(text) {
  const m = text.match(/^\[(\d{2}:\d{2})\]\s*(.*)/);
  return m ? { time:m[1], body:m[2] } : { time:null, body:text };
}

function safeFilename(title) {
  return title.trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .slice(0, 180) || 'Untitled task';
}

function propertySlug(title) {
  return title.trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180) || 'new-property';
}

function projectFilename(title) {
  const name = safeFilename(title).replace(/^project\s*-\s*/i, '');
  return `Project - ${name || 'Untitled project'}.md`;
}

function coverExtension(file) {
  const fromName = file?.name?.match(/\.(png|jpe?g|gif|webp|avif)$/i)?.[1]?.toLowerCase();
  if (fromName) return fromName === 'jpeg' ? 'jpg' : fromName;
  const byType = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/avif': 'avif',
  };
  return byType[file?.type] || 'png';
}

async function uniqueFileNameInDir(dir, preferredName) {
  const dot = preferredName.lastIndexOf('.');
  const stem = dot === -1 ? preferredName : preferredName.slice(0, dot);
  const ext = dot === -1 ? '' : preferredName.slice(dot);
  let name = preferredName;
  let suffix = 2;
  while (true) {
    try {
      await dir.getFileHandle(name);
      name = `${stem}-${suffix++}${ext}`;
    } catch (e) {
      if (e.name === 'NotFoundError') return name;
      throw e;
    }
  }
}

const inputBase = {
  width:'100%', padding:'8px 11px', borderRadius:8,
  background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.1)',
  color:'#e2e8f0', fontSize:13, outline:'none', fontFamily:'inherit',
};
const labelBase = { fontSize:10, color:'#64748b', fontWeight:700, letterSpacing:'0.08em', textTransform:'uppercase', display:'block', marginBottom:5 };

function Field({ label, children }) {
  return (
    <div style={{ marginBottom:11 }}>
      <label style={labelBase}>{label}</label>
      {children}
    </div>
  );
}

function ChipMulti({ value, onChange, options, placeholder }) {
  const [input, setInput] = useState('');
  const id = `dl_${Math.random().toString(36).slice(2,8)}`;
  const add = () => {
    const v = input.trim();
    if (!v) return;
    if (!value.includes(v)) onChange([...value, v]);
    setInput('');
  };
  return (
    <div style={{ ...inputBase, display:'flex', flexWrap:'wrap', gap:5, padding:'5px 6px' }}>
      {value.map(p => (
        <span key={p} style={{ fontSize:11, fontWeight:600, padding:'3px 8px', borderRadius:14, background:'rgba(124,58,237,0.18)', color:'#c4b5fd', display:'inline-flex', alignItems:'center', gap:5 }}>
          {p}
          <button type="button" onClick={() => onChange(value.filter(x => x !== p))} style={{ background:'none', border:'none', color:'#c4b5fd', cursor:'pointer', fontSize:14, lineHeight:1, padding:0 }}>×</button>
        </span>
      ))}
      <input list={id} value={input} onChange={e=>setInput(e.target.value)}
        onKeyDown={e=>{ if(e.key==='Enter'){e.preventDefault();add();} else if(e.key==='Backspace'&&!input&&value.length){onChange(value.slice(0,-1));}}}
        onBlur={add}
        placeholder={placeholder||'Type and press Enter'}
        style={{ flex:1, minWidth:120, background:'transparent', border:'none', color:'#e2e8f0', fontSize:13, outline:'none', fontFamily:'inherit', padding:'4px' }}/>
      <datalist id={id}>
        {options.map(o => <option key={o} value={o}/>)}
      </datalist>
    </div>
  );
}

export default function App() {
  // ── Folder handles (one per folder type) ──
  const [dirs,      setDirs]      = useState({});           // { tasks: handle, ... }
  const [savedDirs, setSavedDirs] = useState({});           // pending permission (resume)
  const [setupBusy, setSetupBusy] = useState(false);
  const [bootDone,  setBootDone]  = useState(false);
  const [folderSetupOpen, setFolderSetupOpen] = useState(false);

  // ── Reference autocomplete lists (filenames without .md) ──
  const [refs, setRefs] = useState({ projects:[], properties:[], clients:[], people:[] });
  const [view, setView] = useState('mission');

  // ── Property library state ──
  const [properties,       setProperties]       = useState([]);
  const [propertyHandles,  setPropertyHandles]  = useState({});
  const [propertyImages,   setPropertyImages]   = useState({});
  const [propertySel,      setPropertySel]      = useState(null);
  const [propertySearch,   setPropertySearch]   = useState('');
  const [propertyComment,  setPropertyComment]  = useState('');

  // â”€â”€ Project library state â”€â”€
  const [projects,       setProjects]       = useState([]);
  const [projectHandles, setProjectHandles] = useState({});
  const [projectSel,     setProjectSel]     = useState(null);
  const [projectSearch,  setProjectSearch]  = useState('');
  const [projectDraft,   setProjectDraft]   = useState('');
  const [newProjectOpen, setNewProjectOpen] = useState(false);

  // â”€â”€ Daily note state â”€â”€
  const [dailyNote,   setDailyNote]   = useState(null);
  const [dailyHandle, setDailyHandle] = useState(null);
  const [dailyInputs, setDailyInputs] = useState({ notes:'', reflections:'', brainDump:'' });

  // ── Tasks / timer / UI state ──
  const [tasks,         setTasks]         = useState([]);
  const [taskHandles,   setTaskHandles]   = useState({});
  const [trackerHandle, setTrackerHandle] = useState(null);
  const [loading,       setLoading]       = useState(false);
  const [lastSync,      setLastSync]      = useState(null);
  const [needsRefresh,  setNeedsRefresh]  = useState(false);
  const [timer,         setTimer]         = useState(null);
  const [tick,          setTick]          = useState(0);
  const [sel,           setSel]           = useState(null);
  const [note,          setNote]          = useState('');
  const [filt,          setFilt]          = useState('all');
  const [toast,         setToast]         = useState(null);
  const [showAdHoc,     setShowAdHoc]     = useState(false);
  const [adHocInput,    setAdHocInput]    = useState('');
  const [adHocName,     setAdHocName]     = useState('');
  const [meetingOpen,   setMeetingOpen]   = useState(false);
  const [meetingTitle,  setMeetingTitle]  = useState('');
  const [meetingNotes,  setMeetingNotes]  = useState('');
  const [newTaskOpen,   setNewTaskOpen]   = useState(false);
  const [newPropertyOpen, setNewPropertyOpen] = useState(false);

  const adHocRef        = useRef('');
  const meetingTitleRef = useRef('');
  const meetingNotesRef = useRef('');
  const meetingStartRef = useRef(null);
  const warnedRef       = useRef(null);
  const tickRef         = useRef();
  const syncRef         = useRef();
  const nudgeRef        = useRef();
  const imageUrlsRef    = useRef({});

  // ── Load saved handles on boot, query permissions ──
  useEffect(() => {
    (async () => {
      const ah = lsGet('adHocName');
      if (ah) { setAdHocName(ah); adHocRef.current = ah; }
      const at = lsGet('activeTimer');
      if (at && Date.now()-at.start < 86400000) setTimer(at);
      else if (at) lsDel('activeTimer');

      try {
        // Migrate legacy single-folder key
        const legacy = await idbGet('vault');
        if (legacy && !(await idbGet('vault_tasks'))) {
          await idbSet('vault_tasks', legacy);
          await idbDel('vault');
        }

        const live = {}, saved = {};
        for (const def of FOLDER_DEFS) {
          const h = await idbGet(`vault_${def.key}`);
          if (!h) continue;
          try {
            const perm = await h.queryPermission({ mode: def.mode });
            if (perm === 'granted') live[def.key] = h;
            else saved[def.key] = h;
          } catch {
            saved[def.key] = h;
          }
        }
        setDirs(live);
        setSavedDirs(saved);
        if (live.tasks) await loadAll(live);
        if (live.tasks && REF_KEYS.every(k => !live[k] && !saved[k]) && !lsGet(FOLDER_SETUP_SEEN)) {
          setFolderSetupOpen(true);
        }
      } catch(e) { console.error(e); }
      setBootDone(true);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (timer) tickRef.current = setInterval(() => setTick(t=>t+1), 1000);
    else clearInterval(tickRef.current);
    return () => clearInterval(tickRef.current);
  }, [timer]);

  useEffect(() => {
    return () => Object.values(imageUrlsRef.current).forEach(URL.revokeObjectURL);
  }, []);

  useEffect(() => {
    if (!dirs.tasks) return;
    syncRef.current = setInterval(() => loadFiles(dirs.tasks), REFRESH_MS);
    return () => clearInterval(syncRef.current);
  }, [dirs.tasks]);

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
          : timer.taskId==='__meeting__' ? (meetingTitleRef.current || 'Meeting')
          : timer.taskId==='__adhoc__' ? adHocRef.current
          : tasks.find(t=>t.id===timer.taskId)?.title || 'this task';
        setToast(`⏰ Over 1 hour on "${name}" — time to switch?`);
      }
    }, WARN_CHK_MS);
    return () => clearInterval(chk);
  }, [timer, tasks]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 7000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const project = projects.find(p => p.id === projectSel);
    setProjectDraft(project?.raw || '');
  }, [projectSel, projects]);

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
        const th = await dir.getFileHandle('timetracker.md', { create:true });
        setTrackerHandle(th);
      } catch {}
      setLastSync(Date.now());
      setNeedsRefresh(false);
      setSel(prev => {
        if (prev && parsed.some(t => t.id === prev && !t.archived)) return prev;
        return parsed.find(t => !t.archived)?.id || parsed[0]?.id || null;
      });
    } catch(e) { console.error(e); }
  }, []);

  const loadProperties = useCallback(async (dir) => {
    try {
      const raw = await readMdFiles(dir);
      const parsed = raw.map(f => parseProperty(f.name, f.text))
        .sort((a,b) => a.title.localeCompare(b.title));
      setProperties(parsed);
      const handles = {};
      raw.forEach(f => { handles[f.name] = f.handle; });
      setPropertyHandles(handles);
      setPropertySel(prev => prev && parsed.some(p => p.id === prev) ? prev : (parsed[0]?.id || null));
    } catch(e) { console.error('properties load failed', e); }
  }, []);

  const loadProjects = useCallback(async (dir) => {
    try {
      const raw = (await readMdFiles(dir)).filter(f => /^project\b/i.test(f.name.replace(/\.md$/i, '').trim()));
      const parsed = raw.map(f => parseProject(f.name, f.text))
        .sort((a,b) => a.title.localeCompare(b.title));
      setProjects(parsed);
      const handles = {};
      raw.forEach(f => { handles[f.name] = f.handle; });
      setProjectHandles(handles);
      setProjectSel(prev => prev && parsed.some(p => p.id === prev) ? prev : (parsed[0]?.id || null));
    } catch(e) { console.error('projects load failed', e); }
  }, []);

  const ensureDailyNote = useCallback(async (dir) => {
    if (!dir) return null;
    const dateStr = tod();
    const filename = `${dateStr}.md`;
    try {
      const fh = await dir.getFileHandle(filename, { create:true });
      const file = await fh.getFile();
      let text = await file.text();
      if (!text.trim()) {
        text = buildDailyNoteMd(dateStr);
        await writeFile(fh, text);
      }
      const parsed = parseDailyNote(filename, text);
      setDailyHandle(fh);
      setDailyNote(parsed);
      return parsed;
    } catch(e) {
      console.error('daily note load failed', e);
      return null;
    }
  }, []);

  const loadAttachmentImages = useCallback(async (dir) => {
    try {
      const raw = await readImageFiles(dir);
      const next = {};
      for (const item of raw) {
        const file = await item.handle.getFile();
        if (file.size > 0) next[item.name.toLowerCase()] = URL.createObjectURL(file);
      }
      Object.values(imageUrlsRef.current).forEach(URL.revokeObjectURL);
      imageUrlsRef.current = next;
      setPropertyImages(next);
    } catch(e) { console.error('attachment image load failed', e); }
  }, []);

  const loadRefs = useCallback(async (liveDirs) => {
    const out = { projects:[], properties:[], clients:[], people:[] };
    for (const k of REF_KEYS) {
      if (!liveDirs[k]) continue;
      try {
        const names = await readDirNames(liveDirs[k], { projectOnly: k === 'projects' });
        out[k] = [...new Set(names)].sort();
      } catch(e) { console.error(`failed to read ${k}`, e); }
    }
    setRefs(out);
  }, []);

  const loadAll = useCallback(async (liveDirs) => {
    if (liveDirs.tasks) await loadFiles(liveDirs.tasks);
    await loadRefs(liveDirs);
    if (liveDirs.projects) await loadProjects(liveDirs.projects);
    if (liveDirs.properties) await loadProperties(liveDirs.properties);
    if (liveDirs.attachments) await loadAttachmentImages(liveDirs.attachments);
    if (liveDirs.daily) await ensureDailyNote(liveDirs.daily);
  }, [loadFiles, loadRefs, loadProjects, loadProperties, loadAttachmentImages, ensureDailyNote]);

  // ── Setup & permission flow ──
  const pickFolder = async (key) => {
    const def = FOLDER_DEFS.find(d => d.key===key);
    setSetupBusy(true);
    try {
      const dir = await window.showDirectoryPicker({ mode: def.mode });
      await idbSet(`vault_${key}`, dir);
      const next = { ...dirs, [key]: dir };
      setDirs(next);
      setSavedDirs(prev => { const c = {...prev}; delete c[key]; return c; });
      if (key === 'tasks') {
        setFolderSetupOpen(true);
        await loadFiles(dir);
      }
      else {
        if (key === 'projects') await loadProjects(dir);
        if (key === 'properties') await loadProperties(dir);
        if (key === 'attachments') await loadAttachmentImages(dir);
        if (key === 'daily') await ensureDailyNote(dir);
        await loadRefs(next);
      }
    } catch(e) { if (e.name!=='AbortError') alert('Error: '+e.message); }
    setSetupBusy(false);
  };

  const resumeFolder = async (key) => {
    const def = FOLDER_DEFS.find(d => d.key===key);
    const h = savedDirs[key]; if (!h) return;
    setSetupBusy(true);
    try {
      const perm = await h.requestPermission({ mode: def.mode });
      if (perm === 'granted') {
        const next = { ...dirs, [key]: h };
        setDirs(next);
        setSavedDirs(prev => { const c = {...prev}; delete c[key]; return c; });
        if (key === 'tasks') {
          setFolderSetupOpen(true);
          await loadFiles(h);
        }
        else {
          if (key === 'projects') await loadProjects(h);
          if (key === 'properties') await loadProperties(h);
          if (key === 'attachments') await loadAttachmentImages(h);
          if (key === 'daily') await ensureDailyNote(h);
          await loadRefs(next);
        }
      }
    } catch(e) { console.error(e); }
    setSetupBusy(false);
  };

  const resumeAll = async () => {
    setSetupBusy(true);
    const next = { ...dirs };
    for (const def of FOLDER_DEFS) {
      const h = savedDirs[def.key]; if (!h) continue;
      try {
        const perm = await h.requestPermission({ mode: def.mode });
        if (perm === 'granted') next[def.key] = h;
      } catch(e) { console.error(e); }
    }
    setDirs(next);
    setSavedDirs({});
    await loadAll(next);
    if (next.tasks && REF_KEYS.every(k => !next[k])) setFolderSetupOpen(true);
    setSetupBusy(false);
  };

  const clearFolder = async (key) => {
    await idbDel(`vault_${key}`);
    setDirs(prev => { const c = {...prev}; delete c[key]; return c; });
    setSavedDirs(prev => { const c = {...prev}; delete c[key]; return c; });
    if (key === 'tasks') { setTasks([]); setTaskHandles({}); setTrackerHandle(null); }
    else if (key === 'projects') { setProjects([]); setProjectHandles({}); setProjectSel(null); setProjectDraft(''); }
    else if (key === 'properties') { setProperties([]); setPropertyHandles({}); setPropertySel(null); }
    else if (key === 'daily') { setDailyNote(null); setDailyHandle(null); setDailyInputs({ notes:'', reflections:'', brainDump:'' }); }
    else if (key === 'attachments') {
      Object.values(imageUrlsRef.current).forEach(URL.revokeObjectURL);
      imageUrlsRef.current = {};
      setPropertyImages({});
    }
    else setRefs(prev => ({ ...prev, [key]: [] }));
  };

  const resetAll = async () => {
    if (!confirm('Forget all configured folders on this device?')) return;
    for (const def of FOLDER_DEFS) await idbDel(`vault_${def.key}`);
    lsDel(FOLDER_SETUP_SEEN);
    setDirs({}); setSavedDirs({});
    setTasks([]); setTaskHandles({}); setTrackerHandle(null);
    setProjects([]); setProjectHandles({}); setProjectSel(null); setProjectDraft('');
    setProperties([]); setPropertyHandles({}); setPropertySel(null);
    setDailyNote(null); setDailyHandle(null); setDailyInputs({ notes:'', reflections:'', brainDump:'' });
    Object.values(imageUrlsRef.current).forEach(URL.revokeObjectURL);
    imageUrlsRef.current = {};
    setPropertyImages({});
    setRefs({ projects:[], properties:[], clients:[], people:[] });
  };

  const finishFolderSetup = () => {
    if (!dirs.tasks) return;
    lsSet(FOLDER_SETUP_SEEN, true);
    setFolderSetupOpen(false);
  };

  // ── Timer logic ──
  const getTime = useCallback((id) => {
    return timer?.taskId===id ? Date.now()-timer.start : 0;
  }, [timer, tick]);

  const stop = useCallback(async () => {
    if (!timer) return;
    const dur = Date.now()-timer.start;
    if (trackerHandle) {
      try {
        const existing = await (await trackerHandle.getFile()).text();
        const isLinked = !['__email__','__meeting__','__adhoc__'].includes(timer.taskId);
        const label = isLinked
          ? tasks.find(t=>t.id===timer.taskId)?.filename || timer.taskId.replace('.md','')
          : timer.taskId==='__adhoc__' ? adHocRef.current
          : timer.taskId==='__email__' ? 'Email' : meetingTitleRef.current||'Meeting';
        await writeFile(trackerHandle, appendTrackerRow(existing, buildTrackerRow(tod(), label, isLinked, dur)));
      } catch(e) { console.error('timetracker write failed', e); }
    }
    setTimer(null); lsDel('activeTimer');
  }, [timer, tasks, trackerHandle]);

  const saveMeetingFile = useCallback(async () => {
    if (!dirs.tasks || !meetingStartRef.current) return;
    const title     = meetingTitleRef.current.trim();
    const startTime = meetingStartRef.current;
    const endTime   = Date.now();
    const timeLabel = new Date(startTime).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',hour12:false}).replace(':','');
    const filename  = `Meeting - ${tod()} - ${title || timeLabel}.md`;
    const content   = buildMeetingMd(title || `Meeting ${timeLabel}`, meetingNotesRef.current, startTime, endTime);
    try {
      const fh = await dirs.tasks.getFileHandle(filename, { create:true });
      await writeFile(fh, content);
      await loadFiles(dirs.tasks);
    } catch(e) { console.error('meeting save failed', e); }
  }, [dirs.tasks, loadFiles]);

  const start = useCallback(async (id) => {
    if (meetingOpen) { await saveMeetingFile(); setMeetingOpen(false); }
    if (timer) await stop();
    const at = { taskId:id, start:Date.now() };
    setTimer(at); setSel(id); lsSet('activeTimer', at);
  }, [timer, stop, meetingOpen, saveMeetingFile]);

  const startMeeting = useCallback(async () => {
    meetingTitleRef.current = ''; meetingNotesRef.current = '';
    meetingStartRef.current = Date.now();
    setMeetingTitle(''); setMeetingNotes('');
    if (timer && timer.taskId!=='__meeting__') await stop();
    const at = { taskId:'__meeting__', start:Date.now() };
    setTimer(at); lsSet('activeTimer', at);
    setMeetingOpen(true);
  }, [timer, stop]);

  const stopMeeting = useCallback(async () => {
    await saveMeetingFile();
    await stop();
    setMeetingOpen(false);
  }, [saveMeetingFile, stop]);

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

  // ── New task creation ──
  const createTask = async (form) => {
    if (!dirs.tasks || !form.title.trim()) return;
    const baseName = safeFilename(form.title);
    let filename = `${baseName}.md`;
    let suffix = 2;
    while (taskHandles[filename]) filename = `${baseName} ${suffix++}.md`;
    const content  = buildNewTaskMd(form);
    try {
      const fh = await dirs.tasks.getFileHandle(filename, { create:true });
      await writeFile(fh, content);
      await loadFiles(dirs.tasks);
      setNewTaskOpen(false);
      setSel(filename);
      setToast(`✅ Created "${form.title.trim()}"`);
    } catch(e) {
      console.error('create task failed', e);
      alert('Failed to create task: ' + e.message);
    }
  };

  // ── Mark task done + archived ──
  const closeTask = async () => {
    if (!sel) return;
    const handle = taskHandles[sel];
    const task = tasks.find(t => t.id===sel);
    if (!handle || !task) return;
    if (!confirm(`Mark "${task.title}" as done and archived?`)) return;
    try {
      if (timer?.taskId === sel) await stop();
      const updated = markTaskDone(task.raw);
      await writeFile(handle, updated);
      const updatedTask = parseTask(task.id, updated);
      const nextTasks = tasks.map(t => t.id===sel ? updatedTask : t);
      setTasks(nextTasks);
      const nextSelected = nextTasks.find(t => !t.archived && t.id !== sel)?.id || nextTasks.find(t => !t.archived)?.id || null;
      setSel(nextSelected);
      setToast(`✅ "${task.title}" marked done & archived`);
    } catch(e) {
      console.error('close task failed', e);
      alert('Failed to close task: ' + e.message);
    }
  };

  const writeTaskUpdate = async (taskId, updated, toastMsg) => {
    const handle = taskHandles[taskId];
    if (!handle) return;
    await writeFile(handle, updated);
    const updatedTask = parseTask(taskId, updated);
    setTasks(prev => prev.map(t => t.id === taskId ? updatedTask : t));
    setToast(toastMsg);
  };

  const changeTaskDates = async (taskId, nextDates) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    try {
      const updated = updateTaskDates(task.raw, {
        due: nextDates.due ?? task.due ?? '',
        scheduled: nextDates.scheduled ?? task.scheduled ?? '',
      });
      await writeTaskUpdate(taskId, updated, 'Updated task dates');
    } catch(e) {
      console.error('task date update failed', e);
      alert('Failed to update task dates: ' + e.message);
    }
  };

  const postponeTaskByWeek = async (taskId) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    try {
      const updated = postponeTaskDates(task.raw, task.due, task.scheduled, 7);
      await writeTaskUpdate(taskId, updated, 'Postponed task by 1 week');
    } catch(e) {
      console.error('task postpone failed', e);
      alert('Failed to postpone task: ' + e.message);
    }
  };

  const addPropertyComment = async () => {
    if (!propertySel || !propertyComment.trim()) return;
    const handle = propertyHandles[propertySel];
    const property = properties.find(p => p.id === propertySel);
    if (!handle || !property) return;
    try {
      const updated = appendPropertyCommentToMd(property.raw, propertyComment.trim());
      await writeFile(handle, updated);
      const updatedProperty = parseProperty(property.id, updated);
      setProperties(prev => prev.map(p => p.id === propertySel ? updatedProperty : p));
      setPropertyComment('');
      setToast(`Saved property comment for "${property.title}"`);
    } catch(e) {
      console.error('property comment write failed', e);
      alert('Failed to add property comment: ' + e.message);
    }
  };

  const saveCoverFile = async (file, label) => {
    if (!dirs.attachments) throw new Error('Pick an Attachments folder first.');
    const ext = coverExtension(file);
    const preferred = `${propertySlug(label)}-cover.${ext}`;
    const filename = await uniqueFileNameInDir(dirs.attachments, preferred);
    const fh = await dirs.attachments.getFileHandle(filename, { create:true });
    await writeFile(fh, file);
    return filename;
  };

  const createProperty = async (form) => {
    if (!dirs.properties || !form.title.trim()) return;
    if (form.coverFile && !dirs.attachments) {
      alert('Pick an Attachments folder before uploading a cover.');
      return;
    }

    try {
      const slug = propertySlug(form.title);
      const filename = await uniqueFileNameInDir(dirs.properties, `${slug}.md`);
      let coverPath = '';
      if (form.coverFile) {
        const coverName = await saveCoverFile(form.coverFile, form.title);
        coverPath = `${dirs.attachments.name}/${coverName}`;
        await loadAttachmentImages(dirs.attachments);
      }

      const content = buildNewPropertyMd({ ...form, coverPath });
      const fh = await dirs.properties.getFileHandle(filename, { create:true });
      await writeFile(fh, content);
      await loadProperties(dirs.properties);
      await loadRefs(dirs);
      setPropertySearch('');
      setPropertySel(filename);
      setNewPropertyOpen(false);
      setToast(`Created property "${form.title.trim()}"`);
    } catch(e) {
      console.error('create property failed', e);
      alert('Failed to create property: ' + e.message);
    }
  };

  const uploadPropertyCover = async (id, file) => {
    if (!file) return;
    if (!dirs.attachments) {
      alert('Pick an Attachments folder before uploading a cover.');
      return;
    }

    const handle = propertyHandles[id];
    const property = properties.find(p => p.id === id);
    if (!handle || !property) return;

    try {
      const coverName = await saveCoverFile(file, property.title);
      const coverPath = `${dirs.attachments.name}/${coverName}`;
      const updated = setPropertyCover(property.raw, coverPath);
      await writeFile(handle, updated);
      await loadAttachmentImages(dirs.attachments);
      const updatedProperty = parseProperty(property.id, updated);
      setProperties(prev => prev.map(p => p.id === id ? updatedProperty : p));
      setToast(`Updated cover for "${property.title}"`);
    } catch(e) {
      console.error('property cover upload failed', e);
      alert('Failed to upload cover: ' + e.message);
    }
  };

  const createProject = async (form) => {
    if (!dirs.projects || !form.title.trim()) return;
    try {
      const filename = await uniqueFileNameInDir(dirs.projects, projectFilename(form.title));
      const content = buildNewProjectMd(form);
      const fh = await dirs.projects.getFileHandle(filename, { create:true });
      await writeFile(fh, content);
      await loadProjects(dirs.projects);
      await loadRefs(dirs);
      setProjectSearch('');
      setProjectSel(filename);
      setNewProjectOpen(false);
      setToast(`Created project "${form.title.trim()}"`);
    } catch(e) {
      console.error('create project failed', e);
      alert('Failed to create project: ' + e.message);
    }
  };

  const saveProject = async () => {
    if (!projectSel) return;
    const handle = projectHandles[projectSel];
    if (!handle) return;
    try {
      const updated = touchDateModified(projectDraft);
      await writeFile(handle, updated);
      const updatedProject = parseProject(projectSel, updated);
      setProjects(prev => prev.map(p => p.id === projectSel ? updatedProject : p));
      setProjectDraft(updated);
      setToast(`Saved "${updatedProject.title}"`);
    } catch(e) {
      console.error('save project failed', e);
      alert('Failed to save project: ' + e.message);
    }
  };

  const addDailyEntry = async (section) => {
    const text = dailyInputs[section]?.trim();
    if (!text) return;
    if (!dirs.daily || !dailyHandle || !dailyNote) {
      alert('Pick a Daily Notes folder first.');
      return;
    }

    try {
      const updated = appendDailySectionEntry(dailyNote.raw, section, text);
      await writeFile(dailyHandle, updated);
      setDailyNote(parseDailyNote(`${tod()}.md`, updated));
      setDailyInputs(prev => ({ ...prev, [section]: '' }));
      setToast('Saved to today\'s daily note');
    } catch(e) {
      console.error('daily note write failed', e);
      alert('Failed to update daily note: ' + e.message);
    }
  };

  const task      = tasks.find(t => t.id===sel);
  const property  = properties.find(p => p.id===propertySel);
  const project   = projects.find(p => p.id===projectSel);
  const selTime   = sel ? getTime(sel) : 0;
  const live      = timer?.taskId===sel;
  const totalToday = [...tasks.map(t=>t.id),'__email__','__meeting__','__adhoc__'].reduce((a,id)=>a+getTime(id),0);
  const dueColor  = due => isOver(due)?'#ef4444':isToday(due)?'#f59e0b':'#475569';
  const syncLabel = lastSync ? `Synced ${new Date(lastSync).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}` : 'Not synced';
  const filtered  = tasks.filter(t => !t.archived).filter(t => filt==='today'?isToday(t.due):filt==='overdue'?isOver(t.due):filt==='done'?t.status==='done':true);
  const openTasks = tasks.filter(t => !t.archived && t.status !== 'done');
  const byOldestCreated = (a, b) => (a.dateCreated || '9999').localeCompare(b.dateCreated || '9999') || a.title.localeCompare(b.title);
  const missionToday = openTasks.filter(t => !t.recurrent && (isToday(t.due) || isToday(t.scheduled))).sort(byOldestCreated);
  const missionOverdue = openTasks.filter(t => !t.recurrent && isOver(t.due)).sort(byOldestCreated);
  const missionRecurrent = openTasks.filter(t => t.recurrent).sort(byOldestCreated);
  const filteredProperties = properties.filter(p => {
    const q = propertySearch.trim().toLowerCase();
    if (!q) return true;
    return [p.title, p.filename, p.client, p.summary].filter(Boolean).some(v => v.toLowerCase().includes(q));
  });
  const filteredProjects = projects.filter(p => {
    const q = projectSearch.trim().toLowerCase();
    if (!q) return true;
    return [p.title, p.filename, p.client, p.summary, p.status].filter(Boolean).some(v => v.toLowerCase().includes(q));
  });
  const headerLabel = view === 'mission' ? 'MISSION CONTROL' : view === 'tasks' ? "TODAY'S TOTAL" : view === 'projects' ? 'PROJECT LIBRARY' : 'PROPERTY LIBRARY';
  const headerMetric = view === 'mission' ? missionToday.length + missionOverdue.length : view === 'tasks' ? fmt(totalToday) : view === 'projects' ? projects.length : properties.length;
  const headerDetail = view === 'mission'
    ? `${missionToday.length} today · ${missionOverdue.length} overdue · ${dirs.daily ? 'daily on' : 'daily off'}`
    : view === 'tasks'
      ? `${tasks.filter(t=>!t.archived).length} tasks · ${Object.values(refs).reduce((a,r)=>a+r.length,0)} refs`
      : view === 'projects'
        ? `${dirs.projects ? dirs.projects.name : 'No folder'} · editable`
        : `${dirs.properties ? dirs.properties.name : 'No folder'} · ${dirs.attachments ? 'covers on' : 'covers off'}`;

  const btnPrimary = { padding:'13px 34px', borderRadius:12, border:'none', cursor:'pointer', fontWeight:700, fontSize:14, fontFamily:'inherit', background:'linear-gradient(135deg,#7c3aed,#3b82f6)', color:'#fff', boxShadow:'0 4px 24px rgba(124,58,237,0.45)' };

  const QuickItem = ({ id, label, onStart, onStop }) => {
    const running = timer?.taskId===id, time = getTime(id);
    return (
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'7px 10px', marginBottom:4, borderRadius:9, transition:'all 0.2s',
        background:running?'rgba(16,185,129,0.08)':'rgba(255,255,255,0.02)',
        border:`1px solid ${running?'rgba(16,185,129,0.25)':'rgba(255,255,255,0.05)'}`,
        boxShadow:running?'0 0 12px rgba(16,185,129,0.15)':'none' }}>
        <div style={{ display:'flex', alignItems:'center', gap:7 }}>
          <span style={{ fontSize:12, fontWeight:600, color:running?'#10b981':'#e2e8f0' }}>{label}</span>
          {time>0 && <span style={{ fontSize:11, fontWeight:700, fontVariantNumeric:'tabular-nums', color:running?'#10b981':'#6366f1' }}>{fmt(time)}</span>}
          {running && <span style={{ fontSize:9, padding:'1px 5px', borderRadius:20, background:'rgba(16,185,129,0.12)', color:'#10b981', fontWeight:700 }}>● LIVE</span>}
        </div>
        <button onClick={running?onStop:onStart} style={{ padding:'4px 12px', borderRadius:6, border:'none', cursor:'pointer', fontWeight:700, fontSize:11, fontFamily:'inherit',
          background:running?'rgba(239,68,68,0.1)':'linear-gradient(135deg,#7c3aed,#3b82f6)',
          color:running?'#f87171':'#fff', outline:running?'1px solid rgba(239,68,68,0.25)':'none' }}>
          {running?'⏹ Stop':'▶ Start'}
        </button>
      </div>
    );
  };

  // ── Setup screen / folder manager ──
  const showSetup = bootDone && (!dirs.tasks || folderSetupOpen);
  const allSavedReady = bootDone && Object.keys(savedDirs).length > 0;

  if (showSetup) return (
    <div style={{ minHeight:'100vh', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'40px 20px', gap:18, color:'#e2e8f0', background:'radial-gradient(ellipse at 50% -5%,rgba(124,58,237,0.22) 0%,#09090e 65%)' }}>
      <div style={{ fontSize:52, filter:'drop-shadow(0 0 20px rgba(124,58,237,0.6))' }}>⚡</div>
      <div style={{ textAlign:'center' }}>
        <h1 style={{ margin:'0 0 8px', fontSize:32, fontWeight:800, background:'linear-gradient(135deg,#c4b5fd,#60a5fa)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>TaskDash</h1>
        <p style={{ margin:0, color:'#64748b', fontSize:14 }}>Connect your Obsidian vault folders — one time per device</p>
      </div>

      {allSavedReady && (
        <button onClick={resumeAll} disabled={setupBusy} style={btnPrimary}>
          {setupBusy ? 'Loading…' : `▶  Resume — reconnect ${Object.keys(savedDirs).length} folder${Object.keys(savedDirs).length>1?'s':''}`}
        </button>
      )}

      <div style={{ width:'100%', maxWidth:520, display:'flex', flexDirection:'column', gap:8 }}>
        {FOLDER_DEFS.map(def => {
          const live = dirs[def.key];
          const saved = savedDirs[def.key];
          const status = live ? 'connected' : saved ? 'saved' : 'empty';
          return (
            <div key={def.key} style={{ padding:'12px 14px', borderRadius:11, background:'rgba(255,255,255,0.03)', border:`1px solid ${live?'rgba(16,185,129,0.3)':saved?'rgba(245,158,11,0.3)':'rgba(255,255,255,0.06)'}`, display:'flex', alignItems:'center', justifyContent:'space-between', gap:12 }}>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:3 }}>
                  <span style={{ fontWeight:700, fontSize:13 }}>{def.label}</span>
                  {def.required && <span style={{ fontSize:9, padding:'1px 6px', borderRadius:10, background:'rgba(239,68,68,0.15)', color:'#f87171', fontWeight:700 }}>REQUIRED</span>}
                  {status==='connected' && <span style={{ fontSize:10, color:'#10b981', fontWeight:600 }}>● {live.name}</span>}
                  {status==='saved' && <span style={{ fontSize:10, color:'#fbbf24', fontWeight:600 }}>● needs permission · {saved.name}</span>}
                </div>
                <div style={{ fontSize:11, color:'#64748b' }}>{def.desc}</div>
              </div>
              <div style={{ display:'flex', gap:6, flexShrink:0 }}>
                {status==='saved' && (
                  <button onClick={()=>resumeFolder(def.key)} disabled={setupBusy} style={{ padding:'6px 12px', borderRadius:8, border:'none', cursor:'pointer', fontWeight:700, fontSize:11, fontFamily:'inherit', background:'rgba(245,158,11,0.15)', color:'#fbbf24' }}>Resume</button>
                )}
                <button onClick={()=>pickFolder(def.key)} disabled={setupBusy} style={{ padding:'6px 12px', borderRadius:8, border:'none', cursor:'pointer', fontWeight:700, fontSize:11, fontFamily:'inherit', background:status==='connected'?'rgba(255,255,255,0.05)':'linear-gradient(135deg,#7c3aed,#3b82f6)', color:status==='connected'?'#94a3b8':'#fff' }}>
                  {status==='connected' ? 'Change' : status==='saved' ? 'Re-pick' : 'Pick folder'}
                </button>
                {status==='connected' && (
                  <button onClick={()=>clearFolder(def.key)} disabled={setupBusy} style={{ padding:'6px 9px', borderRadius:8, border:'none', cursor:'pointer', fontSize:11, fontFamily:'inherit', background:'rgba(239,68,68,0.08)', color:'#f87171' }}>✕</button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p style={{ color:'#334155', fontSize:11, marginTop:8 }}>Chrome only · files stay on your device · pick once, remembered forever</p>
      {dirs.tasks && (
        <div style={{ display:'flex', gap:10, alignItems:'center' }}>
          <button onClick={finishFolderSetup} disabled={setupBusy} style={btnPrimary}>Done</button>
          <button onClick={resetAll} disabled={setupBusy} style={{ padding:'10px 16px', borderRadius:10, border:'1px solid rgba(239,68,68,0.22)', cursor:'pointer', fontWeight:700, fontSize:12, fontFamily:'inherit', background:'rgba(239,68,68,0.08)', color:'#f87171' }}>
            Forget all folders
          </button>
        </div>
      )}
    </div>
  );

  if (!bootDone) return <div style={{ height:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#09090e', color:'#475569' }}>Loading…</div>;

  // ── Main UI ──
  return (
    <div style={{ display:'flex', height:'100vh', background:'#09090e', color:'#e2e8f0', overflow:'hidden' }}>
      {toast && <Toast msg={toast} onClose={() => setToast(null)} />}

      {/* ─── Sidebar ─── */}
      <div style={{ width:290, flexShrink:0, borderRight:'1px solid rgba(255,255,255,0.06)', display:'flex', flexDirection:'column' }}>
        <div style={{ padding:'18px 14px 12px', borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:4 }}>
            <div style={{ display:'flex', alignItems:'center', gap:7 }}>
              <span style={{ fontSize:15 }}>⚡</span>
              <span style={{ fontWeight:700, fontSize:13, maxWidth:155, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{dirs.tasks?.name}</span>
            </div>
            <button onClick={() => loadAll(dirs)} style={{ padding:'4px 10px', borderRadius:7, border:'none', cursor:'pointer', fontSize:11, fontWeight:600, fontFamily:'inherit',
              background:needsRefresh?'rgba(245,158,11,0.2)':'rgba(124,58,237,0.15)',
              color:needsRefresh?'#fbbf24':'#a78bfa', boxShadow:needsRefresh?'0 0 10px rgba(245,158,11,0.3)':'none', transition:'all 0.3s' }}>
              ↺ {needsRefresh?'Stale':'Sync'}
            </button>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:5, marginBottom:10 }}>
            <div style={{ width:6, height:6, borderRadius:3, background:'#10b981', boxShadow:'0 0 6px rgba(16,185,129,0.6)' }}/>
            <span style={{ fontSize:10, color:'#10b981' }}>{syncLabel} · auto every 5 min</span>
          </div>
          <div style={{ padding:'11px 13px', borderRadius:10, background:'rgba(124,58,237,0.08)', border:'1px solid rgba(124,58,237,0.18)' }}>
            <div style={{ fontSize:9, color:'#7c3aed', fontWeight:800, letterSpacing:'0.1em', marginBottom:3 }}>{headerLabel}</div>
            <div style={{ fontWeight:800, fontSize:23, letterSpacing:'-0.03em', fontVariantNumeric:'tabular-nums' }}>{headerMetric}</div>
            <div style={{ fontSize:10, color:'#475569', marginTop:2 }}>{headerDetail}</div>
          </div>
          <div style={{ display:'flex', gap:4, marginTop:10, padding:3, borderRadius:10, background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.06)' }}>
            {['mission','tasks','projects','properties'].map(v => (
              <button key={v} onClick={()=>{ setView(v); setNewTaskOpen(false); setNewPropertyOpen(false); setNewProjectOpen(false); }} style={{ flex:1, padding:'6px 5px', borderRadius:8, border:'none', cursor:'pointer', fontWeight:700, fontSize:10, fontFamily:'inherit', textTransform:'capitalize', background:view===v?'rgba(124,58,237,0.2)':'transparent', color:view===v?'#c4b5fd':'#64748b' }}>
                {v === 'mission' ? 'Today' : v}
              </button>
            ))}
          </div>
        </div>

        {view === 'tasks' ? (
          <>
            <div style={{ padding:'8px 10px', borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ fontSize:9, color:'#475569', fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase', marginBottom:6 }}>Quick Track</div>
              <QuickItem id="__email__"   label="📧 Email"   onStart={()=>start('__email__')} onStop={stop}/>
              <QuickItem id="__meeting__" label="📅 Meeting" onStart={startMeeting}            onStop={stopMeeting}/>

              {timer?.taskId==='__adhoc__' ? (
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'7px 10px', borderRadius:9, background:'rgba(16,185,129,0.08)', border:'1px solid rgba(16,185,129,0.25)', boxShadow:'0 0 12px rgba(16,185,129,0.15)' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:7 }}>
                    <span style={{ fontSize:12, fontWeight:600, color:'#10b981', maxWidth:100, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>🎯 {adHocName||'Ad-hoc'}</span>
                    <span style={{ fontSize:11, fontWeight:700, fontVariantNumeric:'tabular-nums', color:'#10b981' }}>{fmt(getTime('__adhoc__'))}</span>
                    <span style={{ fontSize:9, padding:'1px 5px', borderRadius:20, background:'rgba(16,185,129,0.12)', color:'#10b981', fontWeight:700 }}>● LIVE</span>
                  </div>
                  <button onClick={stop} style={{ padding:'4px 12px', borderRadius:6, border:'none', cursor:'pointer', fontWeight:700, fontSize:11, fontFamily:'inherit', background:'rgba(239,68,68,0.1)', color:'#f87171', outline:'1px solid rgba(239,68,68,0.25)' }}>⏹ Stop</button>
                </div>
              ) : showAdHoc ? (
                <div style={{ padding:'8px 10px', borderRadius:9, background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.08)' }}>
                  <div style={{ fontSize:11, color:'#64748b', marginBottom:6 }}>🎯 What are you working on?</div>
                  <div style={{ display:'flex', gap:6 }}>
                    <input value={adHocInput} onChange={e=>setAdHocInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&startAdHoc()} autoFocus placeholder="e.g. Proposal draft…"
                      style={{ flex:1, padding:'6px 10px', borderRadius:7, background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.1)', color:'#e2e8f0', fontSize:12, outline:'none', fontFamily:'inherit' }}/>
                    <button onClick={startAdHoc} disabled={!adHocInput.trim()} style={{ padding:'6px 10px', borderRadius:7, border:'none', cursor:'pointer', fontWeight:700, fontSize:11, fontFamily:'inherit', background:'linear-gradient(135deg,#7c3aed,#3b82f6)', color:'#fff', opacity:adHocInput.trim()?1:0.4 }}>▶</button>
                    <button onClick={()=>{setShowAdHoc(false);setAdHocInput('');}} style={{ padding:'6px 8px', borderRadius:7, border:'none', cursor:'pointer', background:'rgba(255,255,255,0.05)', color:'#64748b', fontSize:12 }}>✕</button>
                  </div>
                </div>
              ) : (
                <button onClick={()=>setShowAdHoc(true)} style={{ width:'100%', padding:'7px 10px', borderRadius:9, border:'1px dashed rgba(255,255,255,0.1)', background:'transparent', color:'#475569', fontSize:12, fontWeight:600, cursor:'pointer', textAlign:'left', fontFamily:'inherit' }}>
                  🎯 + Ad-hoc task…
                </button>
              )}
            </div>

            <div style={{ padding:'8px 10px 4px', display:'flex', gap:6, alignItems:'center' }}>
              <button onClick={()=>{ setMeetingOpen(false); setNewTaskOpen(true); }} style={{ flex:1, padding:'8px 10px', borderRadius:9, border:'none', cursor:'pointer', fontWeight:700, fontSize:12, fontFamily:'inherit', background:'linear-gradient(135deg,#7c3aed,#3b82f6)', color:'#fff', boxShadow:'0 2px 12px rgba(124,58,237,0.35)' }}>
                +  New Task
              </button>
            </div>

            <div style={{ display:'flex', gap:3, padding:'4px 10px 8px', borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
              {['all','today','overdue','done'].map(f => (
                <button key={f} onClick={()=>setFilt(f)} style={{ flex:1, padding:'5px 0', borderRadius:7, border:'none', cursor:'pointer', fontSize:10, fontWeight:600, textTransform:'capitalize', fontFamily:'inherit', background:filt===f?'rgba(124,58,237,0.15)':'transparent', color:filt===f?'#a78bfa':'#475569' }}>{f}</button>
              ))}
            </div>

            <div style={{ flex:1, overflowY:'auto', padding:'6px 8px' }}>
              {!filtered.length && <div style={{ color:'#475569', textAlign:'center', paddingTop:40, fontSize:12 }}>No tasks</div>}
              {filtered.map(t => {
                const running=timer?.taskId===t.id, active=sel===t.id, time=getTime(t.id);
                return (
                  <div key={t.id} onClick={()=>setSel(t.id)} style={{ padding:'10px', marginBottom:4, borderRadius:10, cursor:'pointer', background:active?'rgba(124,58,237,0.1)':'rgba(255,255,255,0.02)', border:`1px solid ${active?'rgba(124,58,237,0.28)':'rgba(255,255,255,0.04)'}`, boxShadow:running?'0 0 14px rgba(16,185,129,0.18)':'none', transition:'all 0.15s' }}>
                    <div style={{ display:'flex', justifyContent:'space-between', gap:6, marginBottom:5 }}>
                      <span style={{ fontSize:12, fontWeight:500, lineHeight:1.35, flex:1 }}>{t.title}</span>
                      {running && <span style={{ fontSize:9, padding:'2px 6px', borderRadius:20, background:'rgba(16,185,129,0.12)', color:'#10b981', fontWeight:700, flexShrink:0 }}>● LIVE</span>}
                    </div>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:4 }}>
                      <div style={{ display:'flex', gap:4, alignItems:'center', flexWrap:'wrap' }}>
                        <PBadge p={t.priority}/><SBadge s={t.status}/>
                        {t.due && <span style={{ fontSize:10, fontWeight:500, color:dueColor(t.due) }}>{isToday(t.due)?'Today':isOver(t.due)?'Overdue':t.due}</span>}
                      </div>
                      {time>0 && <span style={{ fontSize:11, color:'#6366f1', fontWeight:700, fontVariantNumeric:'tabular-nums' }}>{fmt(time)}</span>}
                    </div>
                    {t.checklistTotal>0 && (
                      <div style={{ marginTop:7 }}>
                        <div style={{ height:2, borderRadius:2, background:'rgba(255,255,255,0.05)' }}>
                          <div style={{ height:'100%', borderRadius:2, background:'linear-gradient(90deg,#7c3aed,#3b82f6)', width:`${Math.round(t.checklistDone/t.checklistTotal*100)}%`, transition:'width 0.4s' }}/>
                        </div>
                        <div style={{ fontSize:10, color:'#475569', marginTop:2 }}>{t.checklistDone}/{t.checklistTotal} done</div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        ) : view === 'projects' ? (
          <>
            <div style={{ padding:'8px 10px 4px', display:'flex', gap:6, alignItems:'center' }}>
              <button onClick={()=>setNewProjectOpen(true)} disabled={!dirs.projects} style={{ flex:1, padding:'8px 10px', borderRadius:9, border:'none', cursor:dirs.projects?'pointer':'not-allowed', fontWeight:700, fontSize:12, fontFamily:'inherit', background:'linear-gradient(135deg,#7c3aed,#3b82f6)', color:'#fff', boxShadow:'0 2px 12px rgba(124,58,237,0.35)', opacity:dirs.projects?1:0.35 }}>
                +  New Project
              </button>
            </div>
            <div style={{ padding:'10px', borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
              <input value={projectSearch} onChange={e=>setProjectSearch(e.target.value)} placeholder="Search projects..." style={{ ...inputBase, padding:'8px 10px', fontSize:12 }}/>
            </div>
            <div style={{ flex:1, overflowY:'auto', padding:'6px 8px' }}>
              {!dirs.projects && <div style={{ color:'#475569', textAlign:'center', paddingTop:40, fontSize:12 }}>Pick your Projects folder in Configure folders</div>}
              {filteredProjects.map(p => {
                const active = projectSel === p.id;
                return (
                  <div key={p.id} onClick={()=>setProjectSel(p.id)} style={{ padding:'10px', marginBottom:4, borderRadius:10, cursor:'pointer', background:active?'rgba(124,58,237,0.1)':'rgba(255,255,255,0.02)', border:`1px solid ${active?'rgba(124,58,237,0.28)':'rgba(255,255,255,0.04)'}` }}>
                    <div style={{ fontSize:12, fontWeight:700, lineHeight:1.35, color:'#e2e8f0' }}>{p.title}</div>
                    <div style={{ fontSize:10, color:'#475569', marginTop:3 }}>{p.status || p.filename}</div>
                  </div>
                );
              })}
            </div>
            <div style={{ padding:'8px 10px', borderTop:'1px solid rgba(255,255,255,0.04)' }}>
              <button onClick={()=>setFolderSetupOpen(true)} style={{ width:'100%', padding:'7px 10px', borderRadius:8, border:'1px solid rgba(255,255,255,0.06)', background:'rgba(255,255,255,0.02)', color:'#64748b', fontSize:11, cursor:'pointer', fontFamily:'inherit' }}>
                Configure project folders
              </button>
            </div>
          </>
        ) : view === 'properties' ? (
          <>
            <div style={{ padding:'8px 10px 4px', display:'flex', gap:6, alignItems:'center' }}>
              <button onClick={()=>setNewPropertyOpen(true)} disabled={!dirs.properties} style={{ flex:1, padding:'8px 10px', borderRadius:9, border:'none', cursor:dirs.properties?'pointer':'not-allowed', fontWeight:700, fontSize:12, fontFamily:'inherit', background:'linear-gradient(135deg,#7c3aed,#3b82f6)', color:'#fff', boxShadow:'0 2px 12px rgba(124,58,237,0.35)', opacity:dirs.properties?1:0.35 }}>
                +  New Property
              </button>
            </div>
            <div style={{ padding:'10px', borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
              <input value={propertySearch} onChange={e=>setPropertySearch(e.target.value)} placeholder="Search properties…" style={{ ...inputBase, padding:'8px 10px', fontSize:12 }}/>
            </div>
            <div style={{ flex:1, overflowY:'auto', padding:'6px 8px' }}>
              {!dirs.properties && <div style={{ color:'#475569', textAlign:'center', paddingTop:40, fontSize:12 }}>Pick your Properties folder in Configure folders</div>}
              {filteredProperties.map(p => {
                const active = propertySel === p.id;
                return (
                  <div key={p.id} onClick={()=>setPropertySel(p.id)} style={{ padding:'10px', marginBottom:4, borderRadius:10, cursor:'pointer', background:active?'rgba(124,58,237,0.1)':'rgba(255,255,255,0.02)', border:`1px solid ${active?'rgba(124,58,237,0.28)':'rgba(255,255,255,0.04)'}` }}>
                    <div style={{ fontSize:12, fontWeight:700, lineHeight:1.35, color:'#e2e8f0' }}>{p.title}</div>
                    <div style={{ fontSize:10, color:'#475569', marginTop:3 }}>{p.client || p.filename}</div>
                    {p.comments.length > 0 && <div style={{ fontSize:10, color:'#818cf8', marginTop:4 }}>{p.comments.length} comment{p.comments.length===1?'':'s'}</div>}
                  </div>
                );
              })}
            </div>
            <div style={{ padding:'8px 10px', borderTop:'1px solid rgba(255,255,255,0.04)' }}>
              <button onClick={()=>setFolderSetupOpen(true)} style={{ width:'100%', padding:'7px 10px', borderRadius:8, border:'1px solid rgba(255,255,255,0.06)', background:'rgba(255,255,255,0.02)', color:'#64748b', fontSize:11, cursor:'pointer', fontFamily:'inherit' }}>
                Configure property folders
              </button>
            </div>
          </>
        ) : (
          <div style={{ flex:1, overflowY:'auto', padding:'10px' }}>
            <div style={{ fontSize:9, color:'#475569', fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase', marginBottom:8 }}>Mission queues</div>
            {[
              ['Overdue', missionOverdue, '#f87171'],
              ['Today', missionToday, '#fbbf24'],
              ['Recurrent', missionRecurrent, '#818cf8'],
            ].map(([label, list, color]) => (
              <div key={label} style={{ marginBottom:12 }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:5 }}>
                  <span style={{ fontSize:11, color, fontWeight:800 }}>{label}</span>
                  <span style={{ fontSize:10, color:'#475569', fontWeight:700 }}>{list.length}</span>
                </div>
                {list.slice(0, 4).map(t => (
                  <div key={t.id} onClick={()=>{ setView('tasks'); setSel(t.id); }} style={{ padding:'8px 9px', marginBottom:4, borderRadius:9, cursor:'pointer', background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.04)' }}>
                    <div style={{ fontSize:12, fontWeight:650, lineHeight:1.3 }}>{t.title}</div>
                    <div style={{ fontSize:10, color:'#475569', marginTop:3 }}>{t.dateCreated ? `created ${t.dateCreated.slice(0,10)}` : 'created date unknown'}</div>
                  </div>
                ))}
              </div>
            ))}
            <button onClick={()=>{ setView('tasks'); setNewTaskOpen(true); }} style={{ width:'100%', padding:'8px 10px', borderRadius:9, border:'none', cursor:'pointer', fontWeight:700, fontSize:12, fontFamily:'inherit', background:'linear-gradient(135deg,#7c3aed,#3b82f6)', color:'#fff' }}>+ New Task</button>
          </div>
        )}

        {(view === 'tasks' || view === 'mission') && (
          <div style={{ padding:'6px 10px 9px', borderTop:'1px solid rgba(255,255,255,0.04)' }}>
            <button onClick={()=>setFolderSetupOpen(true)} style={{ width:'100%', padding:'5px 10px', background:'transparent', border:'none', color:'#334155', fontSize:10, cursor:'pointer', fontFamily:'inherit', textAlign:'center' }}>
              ⚙  Configure folders
            </button>
          </div>
        )}
      </div>

      {/* ─── Main panel ─── */}
      {view === 'mission' ? (
        <MissionControlPanel
          today={missionToday}
          overdue={missionOverdue}
          recurrent={missionRecurrent}
          selectedId={sel}
          liveId={timer?.taskId}
          getTime={getTime}
          onSelectTask={(id)=>{ setSel(id); setView('tasks'); }}
          onStart={start}
          onStop={stop}
          onNewTask={()=>{ setView('tasks'); setNewTaskOpen(true); }}
          dailyNote={dailyNote}
          dailyInputs={dailyInputs}
          setDailyInputs={setDailyInputs}
          onAddDailyEntry={addDailyEntry}
          hasDailyFolder={!!dirs.daily}
          onConfigure={()=>setFolderSetupOpen(true)}
        />
      ) : view === 'projects' ? (
        newProjectOpen ? (
          <NewProjectPanel onCancel={()=>setNewProjectOpen(false)} onCreate={createProject} refs={refs}/>
        ) : (
          <ProjectPanel
            projects={filteredProjects}
            selected={project}
            selectedId={projectSel}
            draft={projectDraft}
            setDraft={setProjectDraft}
            onSelect={setProjectSel}
            onSave={saveProject}
            onNewProject={()=>setNewProjectOpen(true)}
            hasProjectsFolder={!!dirs.projects}
            onConfigure={()=>setFolderSetupOpen(true)}
          />
        )
      ) : view === 'properties' ? (
        newPropertyOpen ? (
          <NewPropertyPanel
            onCancel={()=>setNewPropertyOpen(false)}
            onCreate={createProperty}
            refs={refs}
            hasAttachmentsFolder={!!dirs.attachments}
            onConfigure={()=>setFolderSetupOpen(true)}
          />
        ) : (
        <PropertyPanel
          properties={filteredProperties}
          selected={property}
          selectedId={propertySel}
          images={propertyImages}
          onSelect={setPropertySel}
          comment={propertyComment}
          setComment={setPropertyComment}
          onAddComment={addPropertyComment}
          onNewProperty={()=>setNewPropertyOpen(true)}
          onUploadCover={uploadPropertyCover}
          hasPropertiesFolder={!!dirs.properties}
          hasAttachmentsFolder={!!dirs.attachments}
          onConfigure={()=>setFolderSetupOpen(true)}
        />
        )
      ) : newTaskOpen ? (
        <NewTaskPanel onCancel={()=>setNewTaskOpen(false)} onCreate={createTask} refs={refs}/>
      ) : meetingOpen ? (
        <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
          <div style={{ padding:'22px 30px 20px', borderBottom:'1px solid rgba(255,255,255,0.06)', flexShrink:0 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:24 }}>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:10, color:'#10b981', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:10 }}>📅 Meeting in Progress</div>
                <input value={meetingTitle} onChange={e => { setMeetingTitle(e.target.value); meetingTitleRef.current = e.target.value; }}
                  placeholder="Meeting title…"
                  style={{ width:'100%', padding:'6px 0', background:'transparent', border:'none', borderBottom:'2px solid rgba(255,255,255,0.1)', color:'#f1f5f9', fontSize:20, fontWeight:700, outline:'none', fontFamily:'inherit' }}/>
              </div>
              <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:10, flexShrink:0 }}>
                <div style={{ fontSize:30, fontWeight:800, fontVariantNumeric:'tabular-nums', color:'#10b981', textShadow:'0 0 28px rgba(16,185,129,0.55)' }}>{fmt(getTime('__meeting__'))}</div>
                <button onClick={stopMeeting} style={{ padding:'9px 20px', borderRadius:10, border:'1px solid rgba(239,68,68,0.3)', cursor:'pointer', fontWeight:700, fontSize:13, fontFamily:'inherit', background:'rgba(239,68,68,0.1)', color:'#f87171' }}>💾 Save & Stop</button>
              </div>
            </div>
          </div>
          <div style={{ flex:1, padding:'20px 30px', display:'flex', flexDirection:'column', gap:8 }}>
            <div style={{ fontSize:10, color:'#475569', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em' }}>Notes</div>
            <textarea value={meetingNotes} onChange={e => { setMeetingNotes(e.target.value); meetingNotesRef.current = e.target.value; }}
              placeholder="Type your meeting notes here… markdown supported"
              style={{ flex:1, padding:'14px', borderRadius:10, resize:'none', background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.08)', color:'#e2e8f0', fontSize:13, lineHeight:1.7, outline:'none', fontFamily:'inherit' }}/>
            <div style={{ fontSize:11, color:'#334155' }}>
              Will save as: Meeting - {tod()} - {meetingTitle.trim() || new Date(meetingStartRef.current||Date.now()).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',hour12:false}).replace(':','')}.md
            </div>
          </div>
        </div>

      ) : !task ? (
        <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'#334155', fontSize:13 }}>← Select a task</div>

      ) : (
        <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
          <div style={{ padding:'22px 30px 18px', borderBottom:'1px solid rgba(255,255,255,0.06)', flexShrink:0 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:24 }}>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display:'flex', gap:7, alignItems:'center', marginBottom:9, flexWrap:'wrap' }}>
                  <PBadge p={task.priority}/><SBadge s={task.status}/>
                  {task.due && <span style={{ fontSize:12, color:dueColor(task.due) }}>📅 {isToday(task.due)?'Due Today':isOver(task.due)?`Overdue · ${task.due}`:task.due}</span>}
                  {task.scheduled && <span style={{ fontSize:12, color:'#818cf8' }}>Scheduled {task.scheduled}</span>}
                  {task.client && <span style={{ fontSize:12, color:'#475569' }}>· 👤 {task.client}</span>}
                  {task.building && <span style={{ fontSize:12, color:'#475569' }}>· 🏢 {task.building}</span>}
                </div>
                <h2 style={{ margin:0, fontSize:19, fontWeight:700, lineHeight:1.35, color:'#f1f5f9' }}>{task.title}</h2>
                <div style={{ display:'flex', gap:9, alignItems:'end', flexWrap:'wrap', marginTop:13 }}>
                  <label style={{ display:'flex', flexDirection:'column', gap:4, minWidth:145 }}>
                    <span style={{ fontSize:9, color:'#64748b', fontWeight:800, letterSpacing:'0.08em', textTransform:'uppercase' }}>Due</span>
                    <input type="date" value={task.due || ''} onChange={e=>changeTaskDates(task.id, { due:e.target.value })} style={{ ...inputBase, padding:'7px 9px', fontSize:12 }}/>
                  </label>
                  <label style={{ display:'flex', flexDirection:'column', gap:4, minWidth:145 }}>
                    <span style={{ fontSize:9, color:'#64748b', fontWeight:800, letterSpacing:'0.08em', textTransform:'uppercase' }}>Scheduled</span>
                    <input type="date" value={task.scheduled || ''} onChange={e=>changeTaskDates(task.id, { scheduled:e.target.value })} style={{ ...inputBase, padding:'7px 9px', fontSize:12 }}/>
                  </label>
                  <button onClick={()=>postponeTaskByWeek(task.id)} title="Move due and scheduled dates forward by 7 days" style={{ padding:'8px 12px', borderRadius:9, border:'1px solid rgba(245,158,11,0.28)', cursor:'pointer', fontWeight:800, fontSize:12, fontFamily:'inherit', background:'rgba(245,158,11,0.08)', color:'#fbbf24' }}>
                    Postpone 1w
                  </button>
                </div>
              </div>
              <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:10, flexShrink:0 }}>
                <div style={{ fontSize:31, fontWeight:800, letterSpacing:'-0.03em', fontVariantNumeric:'tabular-nums', color:live?'#10b981':'#e2e8f0', textShadow:live?'0 0 28px rgba(16,185,129,0.55)':'none', transition:'color 0.3s,text-shadow 0.3s' }}>{fmt(selTime)}</div>
                <div style={{ display:'flex', gap:7 }}>
                  <button onClick={live?stop:()=>start(task.id)} style={{ padding:'9px 22px', borderRadius:10, border:'none', cursor:'pointer', fontWeight:700, fontSize:13, fontFamily:'inherit', background:live?'rgba(239,68,68,0.1)':'linear-gradient(135deg,#7c3aed,#3b82f6)', color:live?'#f87171':'#fff', boxShadow:live?'inset 0 0 0 1px rgba(239,68,68,0.3)':'0 4px 16px rgba(124,58,237,0.4)', transition:'all 0.2s' }}>{live?'⏹  Stop':'▶  Start'}</button>
                  {!task.archived && (
                    <button onClick={closeTask} title="Mark done & archived"
                      style={{ padding:'9px 14px', borderRadius:10, border:'1px solid rgba(16,185,129,0.3)', cursor:'pointer', fontWeight:700, fontSize:13, fontFamily:'inherit', background:'rgba(16,185,129,0.08)', color:'#10b981' }}>
                      {task.status==='done' ? '✓  Archive' : '✓  Close'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div style={{ flex:1, overflowY:'auto', padding:'18px 30px' }}>
            <div>
              <div style={{ display:'flex', gap:8, marginBottom:18 }}>
                <input value={note} onChange={e=>setNote(e.target.value)} onKeyDown={e=>e.key==='Enter'&&!e.shiftKey&&addNote()}
                  placeholder="Add a note… Enter to save · writes directly to your .md file"
                  style={{ flex:1, padding:'10px 14px', borderRadius:10, background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.09)', color:'#e2e8f0', fontSize:13, outline:'none', fontFamily:'inherit' }}/>
                <button onClick={addNote} disabled={!note.trim()} style={{ padding:'10px 20px', borderRadius:10, border:'none', cursor:'pointer', fontWeight:600, fontSize:13, fontFamily:'inherit', background:'linear-gradient(135deg,#7c3aed,#3b82f6)', color:'#fff', opacity:note.trim()?1:0.35 }}>Add</button>
              </div>
              {!task.logs.length && (
                <div style={{ color:'#334155', textAlign:'center', padding:'60px 0', fontSize:13 }}>
                  <div style={{ fontSize:28, marginBottom:10 }}>📝</div>Notes you add here write directly to your .md file
                </div>
              )}
              {task.logs.map((l, i) => {
                const { time, body } = parseLogText(l.text);
                return (
                  <div key={i} style={{ marginBottom:8, padding:'11px 14px', borderRadius:10, background:'rgba(124,58,237,0.07)', border:'1px solid rgba(124,58,237,0.15)' }}>
                    <div style={{ fontSize:10, color:'#7c3aed', marginBottom:5, fontWeight:700 }}>{l.date}{time?` · ${time}`:''}</div>
                    <div style={{ fontSize:13, lineHeight:1.55 }}>{body}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MissionControlPanel({ today, overdue, recurrent, selectedId, liveId, getTime, onSelectTask, onStart, onStop, onNewTask, dailyNote, dailyInputs, setDailyInputs, onAddDailyEntry, hasDailyFolder, onConfigure }) {
  const renderTask = t => {
    const running = liveId === t.id;
    return (
      <div key={t.id} style={{ padding:'12px 14px', borderRadius:8, background:running?'rgba(16,185,129,0.08)':'rgba(255,255,255,0.025)', border:`1px solid ${selectedId===t.id?'rgba(124,58,237,0.45)':running?'rgba(16,185,129,0.25)':'rgba(255,255,255,0.06)'}`, marginBottom:8 }}>
        <div onClick={()=>onSelectTask(t.id)} style={{ cursor:'pointer' }}>
          <div style={{ display:'flex', justifyContent:'space-between', gap:12, marginBottom:7 }}>
            <div style={{ fontSize:13, fontWeight:750, lineHeight:1.35, color:'#f1f5f9' }}>{t.title}</div>
            {running && <span style={{ fontSize:10, fontWeight:800, color:'#10b981', flexShrink:0 }}>{fmt(getTime(t.id))}</span>}
          </div>
          <div style={{ display:'flex', gap:6, alignItems:'center', flexWrap:'wrap' }}>
            <PBadge p={t.priority}/><SBadge s={t.status}/>
            {t.due && <span style={{ fontSize:10, color:isOver(t.due)?'#f87171':isToday(t.due)?'#fbbf24':'#64748b', fontWeight:700 }}>due {t.due}</span>}
            {t.scheduled && <span style={{ fontSize:10, color:'#818cf8', fontWeight:700 }}>scheduled {t.scheduled}</span>}
            <span style={{ fontSize:10, color:'#475569' }}>{t.dateCreated ? `created ${t.dateCreated.slice(0,10)}` : 'created date unknown'}</span>
          </div>
        </div>
        <div style={{ display:'flex', justifyContent:'flex-end', marginTop:10 }}>
          <button onClick={()=>running ? onStop() : onStart(t.id)} style={{ padding:'6px 12px', borderRadius:8, border:'none', cursor:'pointer', fontWeight:800, fontSize:11, fontFamily:'inherit', background:running?'rgba(239,68,68,0.1)':'linear-gradient(135deg,#7c3aed,#3b82f6)', color:running?'#f87171':'#fff' }}>
            {running ? 'Stop' : 'Start'}
          </button>
        </div>
      </div>
    );
  };

  const sections = [
    { title:'Overdue', subtitle:'Oldest created first', items:overdue, color:'#f87171' },
    { title:'Today', subtitle:'Due or scheduled today, oldest created first', items:today, color:'#fbbf24' },
    { title:'Recurrent', subtitle:'Separated from dated work', items:recurrent, color:'#818cf8' },
  ];

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <div style={{ padding:'22px 30px 16px', borderBottom:'1px solid rgba(255,255,255,0.06)', flexShrink:0, display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:20 }}>
        <div>
          <div style={{ fontSize:10, color:'#a78bfa', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:8 }}>Today Mission Control</div>
          <h2 style={{ margin:0, fontSize:20, fontWeight:750, color:'#f1f5f9' }}>{longDate(new Date())}</h2>
          <div style={{ fontSize:12, color:'#64748b', marginTop:5 }}>{dailyNote ? dailyNote.filename : hasDailyFolder ? 'Creating today daily note...' : 'Daily notes folder not configured'}</div>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={onConfigure} style={{ padding:'9px 13px', borderRadius:10, border:'1px solid rgba(255,255,255,0.08)', cursor:'pointer', fontWeight:800, fontSize:12, fontFamily:'inherit', background:'rgba(255,255,255,0.03)', color:'#94a3b8' }}>{hasDailyFolder ? 'Daily folder set' : 'Set Daily folder'}</button>
          <button onClick={onNewTask} style={{ padding:'9px 16px', borderRadius:10, border:'none', cursor:'pointer', fontWeight:800, fontSize:13, fontFamily:'inherit', background:'linear-gradient(135deg,#7c3aed,#3b82f6)', color:'#fff' }}>+ New Task</button>
        </div>
      </div>
      <div style={{ flex:1, overflowY:'auto', padding:'20px 24px' }}>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,minmax(220px,1fr))', gap:12, marginBottom:18 }}>
          {[
            ['notes', 'Notes', dailyNote?.notes || []],
            ['reflections', 'Reflections', dailyNote?.reflections || []],
            ['brainDump', 'Brain dump - issues', dailyNote?.brainDump || []],
          ].map(([key, label, items]) => (
            <section key={key} style={{ borderRadius:8, border:'1px solid rgba(255,255,255,0.06)', background:'rgba(255,255,255,0.025)', padding:'13px' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:10 }}>
                <h3 style={{ margin:0, fontSize:14, color:'#f1f5f9' }}>{label}</h3>
                <span style={{ fontSize:10, color:'#64748b', fontWeight:800 }}>{items.length}</span>
              </div>
              <div style={{ minHeight:58, marginBottom:10 }}>
                {items.length ? items.slice(-3).map((item, i) => (
                  <div key={i} style={{ fontSize:12, color:'#cbd5e1', lineHeight:1.45, marginBottom:6 }}>- {item}</div>
                )) : <div style={{ fontSize:12, color:'#334155', paddingTop:10 }}>Nothing written yet</div>}
              </div>
              <div style={{ display:'flex', gap:7 }}>
                <input value={dailyInputs[key] || ''} onChange={e=>setDailyInputs(prev => ({ ...prev, [key]: e.target.value }))} onKeyDown={e=>{ if(e.key==='Enter') onAddDailyEntry(key); }} disabled={!hasDailyFolder}
                  placeholder={hasDailyFolder ? `Add ${label.toLowerCase()}...` : 'Set daily folder first'}
                  style={{ flex:1, minWidth:0, padding:'8px 10px', borderRadius:8, background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)', color:'#e2e8f0', fontSize:12, outline:'none', fontFamily:'inherit', opacity:hasDailyFolder?1:0.45 }}/>
                <button onClick={()=>onAddDailyEntry(key)} disabled={!hasDailyFolder || !dailyInputs[key]?.trim()} style={{ padding:'8px 10px', borderRadius:8, border:'none', cursor:hasDailyFolder?'pointer':'not-allowed', fontWeight:800, fontSize:11, fontFamily:'inherit', background:'rgba(124,58,237,0.18)', color:'#c4b5fd', opacity:hasDailyFolder && dailyInputs[key]?.trim()?1:0.4 }}>Add</button>
              </div>
            </section>
          ))}
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,minmax(220px,1fr))', gap:14, alignItems:'start' }}>
          {sections.map(s => (
            <section key={s.title} style={{ minWidth:0 }}>
              <div style={{ padding:'0 2px 10px', borderBottom:`2px solid ${s.color}`, marginBottom:10 }}>
                <div style={{ display:'flex', justifyContent:'space-between', gap:10, alignItems:'baseline' }}>
                  <h3 style={{ margin:0, fontSize:16, color:'#f1f5f9' }}>{s.title}</h3>
                  <span style={{ fontSize:20, fontWeight:850, color:s.color }}>{s.items.length}</span>
                </div>
                <div style={{ fontSize:11, color:'#64748b', marginTop:3 }}>{s.subtitle}</div>
              </div>
              {!s.items.length && <div style={{ color:'#334155', fontSize:13, padding:'32px 8px', textAlign:'center' }}>Clear</div>}
              {s.items.map(renderTask)}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

function ProjectPanel({ projects, selected, selectedId, draft, setDraft, onSelect, onSave, onNewProject, hasProjectsFolder, onConfigure }) {
  if (!hasProjectsFolder) {
    return (
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'#475569', fontSize:13 }}>
        <button onClick={onConfigure} style={{ padding:'10px 18px', borderRadius:10, border:'none', cursor:'pointer', fontWeight:700, fontSize:13, fontFamily:'inherit', background:'linear-gradient(135deg,#7c3aed,#3b82f6)', color:'#fff' }}>Configure Projects folder</button>
      </div>
    );
  }

  return (
    <div style={{ flex:1, display:'grid', gridTemplateColumns:'minmax(260px, 0.38fr) minmax(420px, 1fr)', minHeight:0, overflow:'hidden' }}>
      <div style={{ borderRight:'1px solid rgba(255,255,255,0.06)', overflowY:'auto', padding:'18px 16px' }}>
        <button onClick={onNewProject} style={{ width:'100%', padding:'9px 12px', borderRadius:9, border:'none', cursor:'pointer', fontWeight:800, fontSize:12, fontFamily:'inherit', background:'linear-gradient(135deg,#7c3aed,#3b82f6)', color:'#fff', marginBottom:12 }}>+ New Project</button>
        {!projects.length && <div style={{ color:'#475569', textAlign:'center', paddingTop:35, fontSize:12 }}>No project files</div>}
        {projects.map(p => (
          <button key={p.id} onClick={()=>onSelect(p.id)} style={{ width:'100%', textAlign:'left', padding:'11px 12px', marginBottom:6, borderRadius:9, border:`1px solid ${selectedId===p.id?'rgba(124,58,237,0.45)':'rgba(255,255,255,0.05)'}`, background:selectedId===p.id?'rgba(124,58,237,0.1)':'rgba(255,255,255,0.02)', color:'#e2e8f0', cursor:'pointer', fontFamily:'inherit' }}>
            <div style={{ fontSize:13, fontWeight:800, lineHeight:1.3 }}>{p.title}</div>
            <div style={{ fontSize:10, color:'#64748b', marginTop:4 }}>{p.status || p.filename}</div>
          </button>
        ))}
      </div>
      <div style={{ display:'flex', flexDirection:'column', minWidth:0, minHeight:0 }}>
        <div style={{ padding:'20px 28px 14px', borderBottom:'1px solid rgba(255,255,255,0.06)', display:'flex', justifyContent:'space-between', gap:18, alignItems:'flex-start' }}>
          <div style={{ minWidth:0 }}>
            <div style={{ fontSize:10, color:'#a78bfa', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:7 }}>Projects</div>
            <h2 style={{ margin:0, fontSize:20, color:'#f1f5f9' }}>{selected ? selected.title : 'Select a project'}</h2>
            {selected && <div style={{ fontSize:11, color:'#64748b', marginTop:5 }}>{selected.filename}</div>}
          </div>
          <button onClick={onSave} disabled={!selected} style={{ padding:'9px 18px', borderRadius:10, border:'none', cursor:selected?'pointer':'not-allowed', fontWeight:800, fontSize:13, fontFamily:'inherit', background:'linear-gradient(135deg,#7c3aed,#3b82f6)', color:'#fff', opacity:selected?1:0.35 }}>Save</button>
        </div>
        {selected ? (
          <textarea value={draft} onChange={e=>setDraft(e.target.value)} spellCheck={false} style={{ flex:1, width:'100%', resize:'none', padding:'18px 22px', background:'rgba(255,255,255,0.025)', border:'none', color:'#e2e8f0', outline:'none', fontFamily:'ui-monospace, SFMono-Regular, Consolas, monospace', fontSize:13, lineHeight:1.65 }}/>
        ) : (
          <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'#334155', fontSize:13 }}>Select or create a project</div>
        )}
      </div>
    </div>
  );
}

function PropertyPanel({ properties, selected, selectedId, images, onSelect, comment, setComment, onAddComment, onNewProperty, onUploadCover, hasPropertiesFolder, hasAttachmentsFolder, onConfigure }) {
  const coverInputRef = useRef(null);
  const imageFor = p => p?.coverName ? images[p.coverName.toLowerCase()] : null;
  if (!hasPropertiesFolder) {
    return (
      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'#475569', fontSize:13 }}>
        <div style={{ textAlign:'center' }}>
          <div style={{ fontSize:32, marginBottom:10 }}>🏢</div>
          <button onClick={onConfigure} style={{ padding:'10px 18px', borderRadius:10, border:'none', cursor:'pointer', fontWeight:700, fontSize:13, fontFamily:'inherit', background:'linear-gradient(135deg,#7c3aed,#3b82f6)', color:'#fff' }}>Configure Properties folder</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <div style={{ padding:'20px 28px 16px', borderBottom:'1px solid rgba(255,255,255,0.06)', flexShrink:0, display:'flex', justifyContent:'space-between', alignItems:'center', gap:18 }}>
        <div>
          <div style={{ fontSize:10, color:'#a78bfa', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:7 }}>Properties</div>
          <h2 style={{ margin:0, fontSize:19, fontWeight:700, color:'#f1f5f9' }}>Property management</h2>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <button onClick={onNewProperty} style={{ padding:'8px 13px', borderRadius:9, border:'none', background:'linear-gradient(135deg,#7c3aed,#3b82f6)', color:'#fff', cursor:'pointer', fontWeight:700, fontSize:12, fontFamily:'inherit' }}>
            + New Property
          </button>
          <button onClick={onConfigure} style={{ padding:'8px 13px', borderRadius:9, border:'1px solid rgba(255,255,255,0.08)', background:'rgba(255,255,255,0.03)', color:'#94a3b8', cursor:'pointer', fontWeight:700, fontSize:12, fontFamily:'inherit' }}>
            {hasAttachmentsFolder ? 'Folders configured' : 'Add Attachments folder'}
          </button>
        </div>
      </div>

      <div style={{ flex:1, minHeight:0, display:'grid', gridTemplateColumns:'minmax(340px, 1.1fr) minmax(320px, 0.9fr)', gap:0 }}>
        <div style={{ overflowY:'auto', padding:'18px 20px', borderRight:'1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(170px,1fr))', gap:12 }}>
            {properties.map(p => {
              const img = imageFor(p);
              const active = selectedId === p.id;
              return (
                <button key={p.id} onClick={()=>onSelect(p.id)}
                  style={{ textAlign:'left', borderRadius:8, overflow:'hidden', border:`1px solid ${active?'rgba(124,58,237,0.55)':'rgba(255,255,255,0.07)'}`, background:active?'rgba(124,58,237,0.12)':'rgba(255,255,255,0.025)', cursor:'pointer', padding:0, fontFamily:'inherit', color:'#e2e8f0' }}>
                  <div style={{ aspectRatio:'1 / 0.9', background:'rgba(255,255,255,0.035)', display:'flex', alignItems:'center', justifyContent:'center', overflow:'hidden' }}>
                    {img ? <img src={img} alt="" style={{ width:'100%', height:'100%', objectFit:'contain' }}/> : <span style={{ fontSize:30, color:'#334155' }}>🏢</span>}
                  </div>
                  <div style={{ padding:'9px 10px 10px' }}>
                    <div style={{ fontSize:12, fontWeight:800, lineHeight:1.25, color:'#f1f5f9' }}>{p.title}</div>
                    <div style={{ fontSize:10, color:'#64748b', marginTop:4, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.client || p.filename}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ overflowY:'auto', padding:'20px 26px' }}>
          {!selected ? (
            <div style={{ color:'#334155', textAlign:'center', paddingTop:90, fontSize:13 }}>Select a property</div>
          ) : (
            <div>
              <div style={{ height:190, borderRadius:8, overflow:'hidden', marginBottom:16, background:'rgba(255,255,255,0.035)', border:'1px solid rgba(255,255,255,0.07)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                {imageFor(selected)
                  ? <img src={imageFor(selected)} alt="" style={{ width:'100%', height:'100%', objectFit:'contain' }}/>
                  : <span style={{ fontSize:12, color:'#475569', fontWeight:700 }}>No cover</span>}
              </div>
              <div style={{ display:'flex', justifyContent:'space-between', gap:16, alignItems:'flex-start', marginBottom:16 }}>
                <div>
                  <div style={{ fontSize:10, color:'#64748b', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:6 }}>{selected.filename}</div>
                  <h2 style={{ margin:0, fontSize:22, lineHeight:1.25, color:'#f1f5f9' }}>{selected.title}</h2>
                  {selected.client && <div style={{ fontSize:12, color:'#94a3b8', marginTop:7 }}>Client: {selected.client}</div>}
                </div>
                <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:8, flexShrink:0 }}>
                  <span style={{ fontSize:10, fontWeight:800, padding:'4px 8px', borderRadius:20, background:'rgba(99,102,241,0.13)', color:'#818cf8' }}>{selected.comments.length} notes</span>
                  <button onClick={()=>hasAttachmentsFolder ? coverInputRef.current?.click() : onConfigure()} style={{ padding:'7px 10px', borderRadius:8, border:'1px solid rgba(255,255,255,0.08)', background:'rgba(255,255,255,0.03)', color:'#c4b5fd', cursor:'pointer', fontWeight:700, fontSize:11, fontFamily:'inherit' }}>
                    Upload cover
                  </button>
                  <input ref={coverInputRef} type="file" accept="image/*" style={{ display:'none' }} onChange={e=>{ const file = e.target.files?.[0]; if (file) onUploadCover(selected.id, file); e.target.value = ''; }}/>
                </div>
              </div>

              {selected.summary && <p style={{ margin:'0 0 18px', color:'#64748b', fontSize:13, lineHeight:1.55 }}>{selected.summary}</p>}

              <div style={{ display:'flex', gap:8, marginBottom:18 }}>
                <textarea value={comment} onChange={e=>setComment(e.target.value)} placeholder="Add a property comment…" rows={3}
                  style={{ flex:1, padding:'10px 12px', borderRadius:10, resize:'vertical', background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.09)', color:'#e2e8f0', fontSize:13, lineHeight:1.5, outline:'none', fontFamily:'inherit' }}/>
                <button onClick={onAddComment} disabled={!comment.trim()} style={{ alignSelf:'stretch', padding:'0 18px', borderRadius:10, border:'none', cursor:'pointer', fontWeight:700, fontSize:13, fontFamily:'inherit', background:'linear-gradient(135deg,#7c3aed,#3b82f6)', color:'#fff', opacity:comment.trim()?1:0.35 }}>Add</button>
              </div>

              {!selected.comments.length && <div style={{ color:'#334155', textAlign:'center', padding:'40px 0', fontSize:13 }}>No property comments yet</div>}
              {selected.comments.map((l, i) => {
                const { time, body } = parseLogText(l.text);
                return (
                  <div key={`${l.date}-${i}`} style={{ marginBottom:8, padding:'11px 14px', borderRadius:10, background:'rgba(124,58,237,0.07)', border:'1px solid rgba(124,58,237,0.15)' }}>
                    <div style={{ fontSize:10, color:'#7c3aed', marginBottom:5, fontWeight:700 }}>{l.date}{time?` · ${time}`:''}</div>
                    <div style={{ fontSize:13, lineHeight:1.55 }}>{body}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── New Property Panel ───────────────────────────────────
function NewProjectPanel({ onCancel, onCreate, refs }) {
  const [form, setForm] = useState({
    title:'',
    status:'active',
    client:'',
    summary:'',
    tags:'project',
    body:'',
  });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));
  const dlClients = `dl_project_clients_${Math.random().toString(36).slice(2,8)}`;

  const submit = async (e) => {
    e?.preventDefault?.();
    if (!form.title.trim()) return;
    setBusy(true);
    await onCreate(form);
    setBusy(false);
  };

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <div style={{ padding:'22px 30px 16px', borderBottom:'1px solid rgba(255,255,255,0.06)', flexShrink:0, display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:24 }}>
        <div>
          <div style={{ fontSize:10, color:'#a78bfa', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:8 }}>+ New Project</div>
          <h2 style={{ margin:0, fontSize:19, fontWeight:700, color:'#f1f5f9' }}>Create a project note</h2>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={onCancel} style={{ padding:'9px 16px', borderRadius:10, border:'1px solid rgba(255,255,255,0.1)', cursor:'pointer', fontWeight:700, fontSize:13, fontFamily:'inherit', background:'transparent', color:'#94a3b8' }}>Cancel</button>
          <button onClick={submit} disabled={busy || !form.title.trim()} style={{ padding:'9px 22px', borderRadius:10, border:'none', cursor:'pointer', fontWeight:700, fontSize:13, fontFamily:'inherit', background:'linear-gradient(135deg,#7c3aed,#3b82f6)', color:'#fff', opacity:(busy||!form.title.trim())?0.4:1 }}>
            {busy ? 'Creating...' : 'Create Project'}
          </button>
        </div>
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:'20px 30px' }}>
        <form onSubmit={submit} style={{ maxWidth:720 }}>
          <Field label="Project name">
            <input autoFocus value={form.title} onChange={e=>set('title', e.target.value)} placeholder="e.g. Union Module 4" style={{ ...inputBase, fontSize:16, fontWeight:600, padding:'10px 14px' }}/>
            <div style={{ fontSize:10, color:'#475569', marginTop:4 }}>Filename will be <code style={{ color:'#94a3b8' }}>{form.title.trim() ? projectFilename(form.title) : 'Project - <title>.md'}</code></div>
          </Field>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:11 }}>
            <Field label="Status">
              <select value={form.status} onChange={e=>set('status', e.target.value)} style={inputBase}>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="done">Done</option>
                <option value="archived">Archived</option>
              </select>
            </Field>
            <Field label={`Client${refs.clients.length?` · ${refs.clients.length} available`:''}`}>
              <input list={dlClients} value={form.client} onChange={e=>set('client', e.target.value)} placeholder="Pick or type..." style={inputBase}/>
              <datalist id={dlClients}>
                {refs.clients.map(c => <option key={c} value={c}/>)}
              </datalist>
            </Field>
          </div>
          <Field label="Summary">
            <textarea value={form.summary} onChange={e=>set('summary', e.target.value)} placeholder="Short project summary" rows={3} style={{ ...inputBase, resize:'vertical', lineHeight:1.55 }}/>
          </Field>
          <Field label="Tags (comma-separated)">
            <input value={form.tags} onChange={e=>set('tags', e.target.value)} placeholder="project, union" style={inputBase}/>
          </Field>
          <Field label="Initial notes">
            <textarea value={form.body} onChange={e=>set('body', e.target.value)} placeholder="Project notes, scope, next actions..." rows={8} style={{ ...inputBase, resize:'vertical', lineHeight:1.55 }}/>
          </Field>
        </form>
      </div>
    </div>
  );
}

function NewPropertyPanel({ onCancel, onCreate, refs, hasAttachmentsFolder, onConfigure }) {
  const [form, setForm] = useState({
    title:'',
    client:'',
    summary:'',
    tags:'properties',
    body:'',
    coverFile:null,
  });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));
  const dlClients = `dl_property_clients_${Math.random().toString(36).slice(2,8)}`;

  const submit = async (e) => {
    e?.preventDefault?.();
    if (!form.title.trim()) return;
    setBusy(true);
    await onCreate(form);
    setBusy(false);
  };

  const slug = form.title.trim() ? propertySlug(form.title) : '<property-name>';

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <div style={{ padding:'22px 30px 16px', borderBottom:'1px solid rgba(255,255,255,0.06)', flexShrink:0, display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:24 }}>
        <div>
          <div style={{ fontSize:10, color:'#a78bfa', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:8 }}>+ New Property</div>
          <h2 style={{ margin:0, fontSize:19, fontWeight:700, color:'#f1f5f9' }}>Create a property note</h2>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={onCancel} style={{ padding:'9px 16px', borderRadius:10, border:'1px solid rgba(255,255,255,0.1)', cursor:'pointer', fontWeight:700, fontSize:13, fontFamily:'inherit', background:'transparent', color:'#94a3b8' }}>Cancel</button>
          <button onClick={submit} disabled={busy || !form.title.trim()} style={{ padding:'9px 22px', borderRadius:10, border:'none', cursor:'pointer', fontWeight:700, fontSize:13, fontFamily:'inherit', background:'linear-gradient(135deg,#7c3aed,#3b82f6)', color:'#fff', opacity:(busy||!form.title.trim())?0.4:1, boxShadow:'0 4px 16px rgba(124,58,237,0.4)' }}>
            {busy ? 'Creating...' : 'Create Property'}
          </button>
        </div>
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:'20px 30px' }}>
        <form onSubmit={submit} style={{ maxWidth:720 }}>
          <Field label="Property name">
            <input autoFocus value={form.title} onChange={e=>set('title', e.target.value)} placeholder="e.g. 20 Kildare Street" style={{ ...inputBase, fontSize:16, fontWeight:600, padding:'10px 14px' }}/>
            <div style={{ fontSize:10, color:'#475569', marginTop:4 }}>Filename will be <code style={{ color:'#94a3b8' }}>{slug}.md</code></div>
          </Field>

          <Field label={`Client${refs.clients.length?` · ${refs.clients.length} available`:''}`}>
            <input list={dlClients} value={form.client} onChange={e=>set('client', e.target.value)} placeholder="Pick or type..." style={inputBase}/>
            <datalist id={dlClients}>
              {refs.clients.map(c => <option key={c} value={c}/>)}
            </datalist>
          </Field>

          <Field label="Summary">
            <textarea value={form.summary} onChange={e=>set('summary', e.target.value)} placeholder="Short property summary for the card/library view" rows={3} style={{ ...inputBase, resize:'vertical', lineHeight:1.55 }}/>
          </Field>

          <Field label="Tags (comma-separated)">
            <input value={form.tags} onChange={e=>set('tags', e.target.value)} placeholder="properties, dublin" style={inputBase}/>
          </Field>

          <Field label="Cover image">
            {hasAttachmentsFolder ? (
              <label style={{ ...inputBase, display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, cursor:'pointer' }}>
                <span style={{ color:form.coverFile?'#e2e8f0':'#64748b', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {form.coverFile ? form.coverFile.name : 'Choose an image...'}
                </span>
                <span style={{ color:'#c4b5fd', fontWeight:800, fontSize:11, flexShrink:0 }}>Browse</span>
                <input type="file" accept="image/*" onChange={e=>set('coverFile', e.target.files?.[0] || null)} style={{ display:'none' }}/>
              </label>
            ) : (
              <button type="button" onClick={onConfigure} style={{ ...inputBase, cursor:'pointer', textAlign:'left', color:'#c4b5fd', fontWeight:700 }}>
                Add Attachments folder to upload covers
              </button>
            )}
          </Field>

          <Field label="Initial notes (optional)">
            <textarea value={form.body} onChange={e=>set('body', e.target.value)} placeholder="Optional property details..." rows={7} style={{ ...inputBase, resize:'vertical', lineHeight:1.55 }}/>
          </Field>
        </form>
      </div>
    </div>
  );
}

// ─── New Task Panel ───────────────────────────────────────
function NewTaskPanel({ onCancel, onCreate, refs }) {
  const [form, setForm] = useState({
    title:'', priority:'normal', status:'none',
    due:'', scheduled:'', contexts:'work',
    client:'', building:'', waitingfor:'',
    projects:[], extraTags:'', body:'',
    timeEstimate:'', recurrent:false,
  });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  const submit = async (e) => {
    e?.preventDefault?.();
    if (!form.title.trim()) return;
    setBusy(true);
    await onCreate(form);
    setBusy(false);
  };

  const dlClients   = `dl_clients_${Math.random().toString(36).slice(2,8)}`;
  const dlBuildings = `dl_buildings_${Math.random().toString(36).slice(2,8)}`;
  const dlPeople    = `dl_people_${Math.random().toString(36).slice(2,8)}`;

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <div style={{ padding:'22px 30px 16px', borderBottom:'1px solid rgba(255,255,255,0.06)', flexShrink:0, display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:24 }}>
        <div>
          <div style={{ fontSize:10, color:'#a78bfa', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:8 }}>+ New Task</div>
          <h2 style={{ margin:0, fontSize:19, fontWeight:700, color:'#f1f5f9' }}>Create a task in your Tasks folder</h2>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={onCancel} style={{ padding:'9px 16px', borderRadius:10, border:'1px solid rgba(255,255,255,0.1)', cursor:'pointer', fontWeight:700, fontSize:13, fontFamily:'inherit', background:'transparent', color:'#94a3b8' }}>Cancel</button>
          <button onClick={submit} disabled={busy || !form.title.trim()} style={{ padding:'9px 22px', borderRadius:10, border:'none', cursor:'pointer', fontWeight:700, fontSize:13, fontFamily:'inherit', background:'linear-gradient(135deg,#7c3aed,#3b82f6)', color:'#fff', opacity:(busy||!form.title.trim())?0.4:1, boxShadow:'0 4px 16px rgba(124,58,237,0.4)' }}>
            {busy ? 'Creating…' : 'Create Task'}
          </button>
        </div>
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:'20px 30px' }}>
        <form onSubmit={submit} style={{ maxWidth:720 }}>
          <Field label="Title">
            <input autoFocus value={form.title} onChange={e=>set('title', e.target.value)} placeholder="e.g. Admin - BER dashboard fixes" style={{ ...inputBase, fontSize:16, fontWeight:600, padding:'10px 14px' }}/>
            <div style={{ fontSize:10, color:'#475569', marginTop:4 }}>Filename will be <code style={{ color:'#94a3b8' }}>{form.title.trim() ? safeFilename(form.title) : '<title>'}.md</code></div>
          </Field>

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:11 }}>
            <Field label="Priority">
              <select value={form.priority} onChange={e=>set('priority', e.target.value)} style={inputBase}>
                <option value="none">None</option>
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
              </select>
            </Field>
            <Field label="Status">
              <select value={form.status} onChange={e=>set('status', e.target.value)} style={inputBase}>
                <option value="none">None</option>
                <option value="done">Done</option>
              </select>
            </Field>
            <Field label="Due">
              <input type="date" value={form.due} onChange={e=>set('due', e.target.value)} style={inputBase}/>
            </Field>
            <Field label="Scheduled">
              <input type="date" value={form.scheduled} onChange={e=>set('scheduled', e.target.value)} style={inputBase}/>
            </Field>
          </div>

          <Field label="Contexts (comma-separated)">
            <input value={form.contexts} onChange={e=>set('contexts', e.target.value)} placeholder="work" style={inputBase}/>
          </Field>

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:11 }}>
            <Field label="Time estimate (minutes)">
              <input type="number" min="0" value={form.timeEstimate} onChange={e=>set('timeEstimate', e.target.value)} placeholder="0" style={inputBase}/>
            </Field>
            <Field label="Recurrent">
              <label style={{ ...inputBase, display:'flex', alignItems:'center', gap:9, cursor:'pointer', minHeight:34 }}>
                <input type="checkbox" checked={form.recurrent} onChange={e=>set('recurrent', e.target.checked)} style={{ accentColor:'#7c3aed' }}/>
                <span style={{ color:'#94a3b8', fontSize:13 }}>Mark as recurrent</span>
              </label>
            </Field>
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:11 }}>
            <Field label={`Client${refs.clients.length?` · ${refs.clients.length} available`:''}`}>
              <input list={dlClients} value={form.client} onChange={e=>set('client', e.target.value)} placeholder="Pick or type…" style={inputBase}/>
              <datalist id={dlClients}>
                {refs.clients.map(c => <option key={c} value={c}/>)}
              </datalist>
            </Field>
            <Field label={`Building${refs.properties.length?` · ${refs.properties.length} available`:''}`}>
              <input list={dlBuildings} value={form.building} onChange={e=>set('building', e.target.value)} placeholder="Pick or type…" style={inputBase}/>
              <datalist id={dlBuildings}>
                {refs.properties.map(p => <option key={p} value={p}/>)}
              </datalist>
            </Field>
          </div>

          <Field label={`Projects${refs.projects.length?` · ${refs.projects.length} available`:''}`}>
            <ChipMulti value={form.projects} onChange={v=>set('projects', v)} options={refs.projects} placeholder="Type project name + Enter…"/>
          </Field>

          <Field label={`Waiting for${refs.people.length?` · ${refs.people.length} available`:''}`}>
            <input list={dlPeople} value={form.waitingfor} onChange={e=>set('waitingfor', e.target.value)} placeholder="Pick or type…" style={inputBase}/>
            <datalist id={dlPeople}>
              {refs.people.map(p => <option key={p} value={p}/>)}
            </datalist>
          </Field>

          <Field label="Extra tags (comma-separated)">
            <input value={form.extraTags} onChange={e=>set('extraTags', e.target.value)} placeholder="admin, urgent…" style={inputBase}/>
            <div style={{ fontSize:10, color:'#475569', marginTop:4 }}>The tag <code style={{ color:'#94a3b8' }}>task</code> is added automatically.</div>
          </Field>

          <Field label="Details / initial log (optional)">
            <textarea value={form.body} onChange={e=>set('body', e.target.value)} placeholder="Initial task details…" rows={6} style={{ ...inputBase, resize:'vertical', lineHeight:1.55 }}/>
          </Field>
        </form>
      </div>
    </div>
  );
}
