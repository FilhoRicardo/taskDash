import React from 'react';
import { afterEach, afterAll, describe, expect, it, vi } from 'vitest';
import { Window } from 'happy-dom';

const browser = new Window();
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
Object.assign(globalThis, {
  window:browser,
  document:browser.document,
  HTMLElement:browser.HTMLElement,
  Event:browser.Event,
  MouseEvent:browser.MouseEvent,
  IS_REACT_ACT_ENVIRONMENT:true,
});
Object.defineProperty(globalThis, 'navigator', { configurable:true, value:browser.navigator });

const [{ createRoot }, { default:EmailDraftPanel, emailByteLength }, { act }] = await Promise.all([
  import('react-dom/client'),
  import('../EmailDraftPanel.jsx'),
  import('react'),
]);

let root;
let container;

function mount(props) {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<EmailDraftPanel {...props}/>));
}

function click(label) {
  const button = [...container.querySelectorAll('button')].find(item => item.textContent.includes(label));
  if (!button) throw new Error(`Missing button: ${label}`);
  act(() => button.dispatchEvent(new MouseEvent('click', { bubbles:true })));
}

function setValue(element, value) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')?.set;
  setter.call(element, value);
  act(() => element.dispatchEvent(new Event('input', { bubbles:true })));
}

async function flush() {
  await act(async () => { await Promise.resolve(); });
}

afterEach(() => {
  if (root) act(() => root.unmount());
  container?.remove();
  root = null;
  container = null;
});

afterAll(() => {
  browser.happyDOM.abort();
  if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
  else delete globalThis.navigator;
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.HTMLElement;
  delete globalThis.Event;
  delete globalThis.MouseEvent;
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

describe('EmailDraftPanel', () => {
  it('invalidates an old preview and pending generation when the source changes', async () => {
    let resolvePending;
    const draft = vi.fn().mockResolvedValueOnce({ comment:'Old preview' })
      .mockImplementationOnce(() => new Promise(resolve => { resolvePending = resolve; }));
    const onTransfer = vi.fn();
    mount({ emailAssistant:{ draft }, mode:'comment', onTransfer });
    click('Draft comment from email');
    setValue(container.querySelector('textarea'), 'Original email');
    click('Generate draft');
    await flush();
    setValue(container.querySelector('textarea'), 'Revised email');
    expect([...container.querySelectorAll('button')].some(button=>button.textContent.includes('Use comment draft'))).toBe(false);
    click('Generate draft');
    const signal = draft.mock.calls[1][0].signal;
    setValue(container.querySelector('textarea'), 'Latest email');
    expect(signal.aborted).toBe(true);
    await act(async () => { resolvePending({ comment:'Stale result' }); await Promise.resolve(); });
    expect(container.querySelectorAll('textarea')).toHaveLength(1);
    expect(onTransfer).not.toHaveBeenCalled();
  });

  it('generates, lets the user edit, and transfers without writing', async () => {
    const draft = vi.fn().mockResolvedValue({ title:'Email title', description:'Email details' });
    const onTransfer = vi.fn();
    mount({ emailAssistant:{ draft }, mode:'task', onTransfer });
    click('Draft task from email');
    setValue(container.querySelector('textarea'), 'Please renew the agreement.');
    click('Generate draft');
    await flush();
    expect(container.textContent).toContain('Task title');
    const title = container.querySelector('input');
    setValue(title, 'Review agreement renewal');
    setValue(container.querySelectorAll('textarea')[1], 'Ask legal to confirm the terms.');
    expect(onTransfer).not.toHaveBeenCalled();
    click('Use task draft');
    expect(onTransfer).toHaveBeenCalledWith({ title:'Review agreement renewal', description:'Ask legal to confirm the terms.' });
    expect(draft).toHaveBeenCalledWith(expect.objectContaining({ mode:'task', email:'Please renew the agreement.' }));
    expect(container.querySelector('[role="status"]').textContent).toContain('copied');
  });

  it('keeps a previous draft available after a failed retry and blocks transfer while retrying', async () => {
    const draft = vi.fn()
      .mockResolvedValueOnce({ comment:'First comment' })
      .mockRejectedValueOnce(new Error('Assistant is offline.'));
    mount({ emailAssistant:{ draft }, mode:'comment', onTransfer:vi.fn() });
    click('Draft comment from email');
    setValue(container.querySelector('textarea'), 'Email text');
    click('Generate draft');
    await flush();
    click('Generate draft');
    expect([...container.querySelectorAll('button')].find(button=>button.textContent.includes('Use comment draft')).disabled).toBe(true);
    await flush();
    expect(container.querySelector('textarea').value).toBe('Email text');
    expect([...container.querySelectorAll('textarea')].at(-1).value).toBe('First comment');
    expect(container.querySelector('[role="alert"]').textContent).toContain('Assistant is offline.');
  });

  it('cancels generation and passes its abort signal to the service', () => {
    const draft = vi.fn(({ signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    mount({ emailAssistant:{ draft }, mode:'comment', onTransfer:vi.fn() });
    click('Draft comment from email');
    setValue(container.querySelector('textarea'), 'Email text');
    click('Generate draft');
    const signal = draft.mock.calls[0][0].signal;
    click('Cancel drafting');
    expect(signal.aborted).toBe(true);
    expect(container.querySelector('[role="status"]').textContent).toContain('cancelled');
  });

  it('ignores a result from the previous target after the target changes', async () => {
    let resolveDraft;
    const draft = vi.fn(() => new Promise(resolve => { resolveDraft = resolve; }));
    mount({ emailAssistant:{ draft }, mode:'comment', targetKey:'task-a', onTransfer:vi.fn() });
    click('Draft comment from email');
    setValue(container.querySelector('textarea'), 'Email text');
    click('Generate draft');
    act(() => root.render(<EmailDraftPanel emailAssistant={{ draft }} mode="comment" targetKey="task-b" onTransfer={vi.fn()}/>));
    await act(async () => {
      resolveDraft({ comment:'Stale comment' });
      await Promise.resolve();
    });
    expect(container.textContent).not.toContain('Stale comment');
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it('keeps controls unavailable but explains settings, and rejects oversized UTF-8 input', () => {
    const onOpenSettings = vi.fn();
    mount({ mode:'task', onOpenSettings });
    click('Draft task from email');
    expect(container.textContent).toContain('Set it up in TaskDash settings');
    click('Open settings');
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  it('rejects email over 8,000 UTF-8 bytes before calling the assistant', () => {
    const draft = vi.fn();
    mount({ emailAssistant:{ draft }, mode:'task' });
    click('Draft task from email');
    const email = '😀'.repeat(2001);
    setValue(container.querySelector('textarea'), email);
    expect(emailByteLength(email)).toBeGreaterThan(8000);
    click('Generate draft');
    expect(draft).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]').textContent).toContain('8,000-byte limit');
  });

  it('uses non-submit buttons for panel controls', () => {
    mount({ emailAssistant:{ draft:vi.fn() }, mode:'task' });
    expect([...container.querySelectorAll('button')].every(button => button.type === 'button')).toBe(true);
  });
});
