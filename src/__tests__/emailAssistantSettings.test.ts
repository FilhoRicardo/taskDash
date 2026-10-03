import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings } from '../settings';
import { DEFAULT_COMMENT_SKILL, DEFAULT_TASK_SKILL, LEGACY_COMMENT_SKILL, LEGACY_TASK_SKILL } from '../ai/emailAssistant';

describe('normalizeSettings email assistant migration', () => {
  it('preserves the task owner name without changing custom skills or folders', () => {
    const saved = { folders:{ tasks:'Tasks' }, emailAssistant:{ ownerName:'Jamie Example', taskSkill:'Custom task', commentSkill:'Custom comment' } };
    expect(normalizeSettings(saved).emailAssistant).toMatchObject(saved.emailAssistant);
    expect(normalizeSettings(saved).folders.tasks).toBe('Tasks');
    for (const ownerName of [42, 'é'.repeat(101)]) expect(normalizeSettings({ emailAssistant:{ ownerName } }).emailAssistant.ownerName).toBe('');
  });
  it('replaces only the shipped paragraph prompts with the two email skills', () => {
    const settings = normalizeSettings({ emailAssistant:{ enabled:false, taskSkill:LEGACY_TASK_SKILL, commentSkill:LEGACY_COMMENT_SKILL } });
    expect(settings.emailAssistant).toEqual({ enabled:false, ownerName:'', taskSkill:DEFAULT_TASK_SKILL, commentSkill:DEFAULT_COMMENT_SKILL });
    expect(normalizeSettings({ emailAssistant:{ taskSkill:'Custom task', commentSkill:'Custom comment' } }).emailAssistant)
      .toMatchObject({ taskSkill:'Custom task', commentSkill:'Custom comment' });
  });
  it('adds enabled defaults when loading older settings', () => {
    const settings = normalizeSettings({ folders: { tasks: 'Tasks' } });
    expect(settings.folders.tasks).toBe('Tasks');
    expect(settings.emailAssistant).toEqual({
      enabled: true,
      ownerName: '',
      taskSkill: DEFAULT_TASK_SKILL,
      commentSkill: DEFAULT_COMMENT_SKILL,
    });
  });

  it('preserves valid custom skill text and defaults invalid nested values', () => {
    const settings = normalizeSettings({
      emailAssistant: { enabled: false, taskSkill: 'Custom task skill', commentSkill: '   ' },
      folders: { tasks: 42, done: 'Archive' },
      enableStatusBarTimer: 'yes',
    });
    expect(settings.emailAssistant).toEqual({
      enabled: false,
      ownerName: '',
      taskSkill: 'Custom task skill',
      commentSkill: DEFAULT_COMMENT_SKILL,
    });
    expect(settings.folders.tasks).toBe(DEFAULT_SETTINGS.folders.tasks);
    expect(settings.folders.done).toBe('Archive');
    expect(settings.enableStatusBarTimer).toBe(DEFAULT_SETTINGS.enableStatusBarTimer);
  });
});
