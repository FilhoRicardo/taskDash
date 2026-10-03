import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings } from '../settings';
import { DEFAULT_COMMENT_SKILL, DEFAULT_TASK_SKILL } from '../ai/emailAssistant';

describe('normalizeSettings email assistant migration', () => {
  it('adds enabled defaults when loading older settings', () => {
    const settings = normalizeSettings({ folders: { tasks: 'Tasks' } });
    expect(settings.folders.tasks).toBe('Tasks');
    expect(settings.emailAssistant).toEqual({
      enabled: true,
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
      taskSkill: 'Custom task skill',
      commentSkill: DEFAULT_COMMENT_SKILL,
    });
    expect(settings.folders.tasks).toBe(DEFAULT_SETTINGS.folders.tasks);
    expect(settings.folders.done).toBe('Archive');
    expect(settings.enableStatusBarTimer).toBe(DEFAULT_SETTINGS.enableStatusBarTimer);
  });
});
