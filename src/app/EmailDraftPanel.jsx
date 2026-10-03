import React, { useEffect, useId, useRef, useState } from 'react';

const MAX_EMAIL_BYTES = 8000;

export function emailByteLength(value) {
  return new TextEncoder().encode(value).length;
}

export default function EmailDraftPanel({
  emailAssistant,
  mode,
  targetKey = 'new-task',
  onTransfer,
  onOpenSettings,
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const panelId = useId();
  const requestRef = useRef({ id: 0, controller: null });

  useEffect(() => {
    setEmail('');
    setDraft(null);
    setBusy(false);
    setError('');
    setStatus('');
    requestRef.current.controller?.abort();
    requestRef.current = { id: requestRef.current.id + 1, controller: null };
    return () => {
      requestRef.current.controller?.abort();
      requestRef.current.id += 1;
    };
  }, [targetKey]);

  const cancel = () => {
    requestRef.current.controller?.abort();
    requestRef.current = { id: requestRef.current.id + 1, controller: null };
    setBusy(false);
    setStatus('Draft cancelled.');
  };

  const toggle = () => {
    if (open && busy) cancel();
    setOpen(value => !value);
  };

  const changeEmail = value => {
    if (busy) cancel();
    setEmail(value);
    setDraft(null);
    setError('');
    setStatus('');
  };

  const generate = async () => {
    setError('');
    setStatus('');
    if (emailByteLength(email) > MAX_EMAIL_BYTES) {
      setError('Email text is over the 8,000-byte limit. Shorten it and try again.');
      return;
    }
    if (!email.trim()) {
      setError('Paste email text to draft from.');
      return;
    }
    const controller = new AbortController();
    const id = requestRef.current.id + 1;
    requestRef.current = { id, controller };
    setBusy(true);
    setStatus('Drafting from email…');
    try {
      const result = await emailAssistant.draft({ mode, email, signal:controller.signal });
      if (requestRef.current.id !== id) return;
      setDraft(mode === 'task'
        ? { title:result.title || '', description:result.description || '' }
        : { comment:result.comment || '' });
      setStatus('Draft ready. Review and edit it before using it.');
    } catch (draftError) {
      if (requestRef.current.id !== id || controller.signal.aborted) return;
      setError(draftError?.message || 'Could not draft from this email. You can edit the email and try again.');
      setStatus('');
    } finally {
      if (requestRef.current.id === id) {
        requestRef.current = { id, controller:null };
        setBusy(false);
      }
    }
  };

  const transfer = () => {
    if (!draft) return;
    onTransfer(mode === 'task'
      ? { title:draft.title, description:draft.description }
      : { comment:draft.comment });
    setStatus(mode === 'task' ? 'Task draft copied to the task form.' : 'Comment draft copied to the activity composer.');
  };
  const canTransfer = !!draft && !busy && (mode === 'task' ? !!draft.title.trim() : !!draft.comment.trim());

  return (
    <section className="td-email-draft-panel" style={{ gridColumn:'1 / -1', minWidth:0, marginBottom:12, border:'1px solid var(--td-border)', borderRadius:8, background:'var(--td-subtle)' }}>
      <button type="button" aria-expanded={open} aria-controls={panelId} onClick={toggle}
        style={{ width:'100%', display:'flex', justifyContent:'space-between', alignItems:'center', gap:10, padding:'10px 12px', border:0, background:'transparent', color:'var(--td-text)', textAlign:'left', cursor:'pointer', font: 'inherit', fontSize:13, fontWeight:700 }}>
        <span>{mode === 'task' ? 'Draft task from email' : 'Draft comment from email'}</span>
        <span aria-hidden="true" style={{ color:'var(--td-muted)', fontSize:12 }}>{open ? 'Hide' : 'Show'}</span>
      </button>
      <div id={panelId} hidden={!open} style={{ maxHeight:'min(38vh, 320px)', overflowY:'auto', overscrollBehavior:'contain', padding:'0 12px 12px' }}>
          {!emailAssistant ? (
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexWrap:'wrap', color:'var(--td-muted)', fontSize:12 }}>
              <span>Email drafting is unavailable. Set it up in TaskDash settings; you can keep using the form below.</span>
              {onOpenSettings && <button type="button" onClick={onOpenSettings} style={{ ...buttonStyle, color:'var(--td-accent-text)' }}>Open settings</button>}
            </div>
          ) : (
            <>
              <label htmlFor={`${panelId}-email`} style={labelStyle}>Email text <span style={{ color:'var(--td-muted)', fontWeight:400 }}>(up to 8,000 UTF-8 bytes)</span></label>
              <textarea id={`${panelId}-email`} value={email} onChange={event=>changeEmail(event.target.value)} rows={5}
                placeholder="Paste the email text here…" aria-describedby={`${panelId}-help`}
                style={{ width:'100%', minHeight:110, resize:'vertical', padding:'9px 11px', borderRadius:6, background:'var(--background-primary)', border:'1px solid var(--background-modifier-border)', color:'var(--text-normal)', fontSize:13, lineHeight:1.5, fontFamily:'inherit' }}/>
              <div id={`${panelId}-help`} style={{ marginTop:5, color:'var(--td-muted)', fontSize:11 }}>
                {mode === 'task'
                  ? 'Local Gemma drafts a title, three-sentence recap and an action only if clear. Set your name in TaskDash settings first. Review before using; nothing is saved automatically.'
                  : 'Local Gemma drafts a three-sentence thread recap, not an email reply or prescribed action. Review before using; nothing is saved automatically.'}
              </div>
              <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center', marginTop:9 }}>
                <button type="button" onClick={generate} disabled={busy} style={primaryButtonStyle(busy)}>{busy ? 'Drafting…' : 'Generate draft'}</button>
                {busy && <button type="button" onClick={cancel} style={buttonStyle}>Cancel drafting</button>}
              </div>
              {status && <div role="status" aria-live="polite" style={{ marginTop:8, color:'var(--td-muted)', fontSize:12 }}>{status}</div>}
              {error && <div role="alert" style={{ marginTop:8, color:'var(--td-danger)', fontSize:12 }}>{error}</div>}
              {draft && mode === 'task' && (
                <div style={{ display:'grid', gap:9, marginTop:12 }}>
                  <label style={labelStyle}>Task title
                    <input value={draft.title} onChange={event=>setDraft(value=>({ ...value, title:event.target.value }))} style={fieldStyle}/>
                  </label>
                  <label style={labelStyle}>Task description
                    <textarea value={draft.description} onChange={event=>setDraft(value=>({ ...value, description:event.target.value }))} rows={5} style={{ ...fieldStyle, resize:'vertical', lineHeight:1.5 }}/>
                  </label>
                  <div><button type="button" onClick={transfer} disabled={!canTransfer} style={primaryButtonStyle(!canTransfer)}>Use task draft</button></div>
                </div>
              )}
              {draft && mode === 'comment' && (
                <div style={{ display:'grid', gap:9, marginTop:12 }}>
                  <label style={labelStyle}>Comment draft
                    <textarea value={draft.comment} onChange={event=>setDraft(value=>({ ...value, comment:event.target.value }))} rows={5} style={{ ...fieldStyle, resize:'vertical', lineHeight:1.5 }}/>
                  </label>
                  <div><button type="button" onClick={transfer} disabled={!canTransfer} style={primaryButtonStyle(!canTransfer)}>Use comment draft</button></div>
                </div>
              )}
            </>
          )}
      </div>
    </section>
  );
}

const labelStyle = { display:'grid', gap:5, color:'var(--td-text)', fontSize:12, fontWeight:650 };
const fieldStyle = { width:'100%', minWidth:0, padding:'9px 11px', borderRadius:6, background:'var(--background-primary)', border:'1px solid var(--background-modifier-border)', color:'var(--text-normal)', fontSize:13, fontFamily:'inherit' };
const buttonStyle = { padding:'8px 11px', borderRadius:6, border:'1px solid var(--td-border)', background:'transparent', color:'var(--td-text)', cursor:'pointer', font:'inherit', fontSize:12, fontWeight:650 };
const primaryButtonStyle = disabled => ({ ...buttonStyle, border:'1px solid var(--td-accent)', background:'var(--td-accent)', color:'#fff', opacity:disabled ? 0.55 : 1, cursor:disabled ? 'default' : 'pointer' });
