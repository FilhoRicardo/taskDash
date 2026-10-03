// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { normalizeSettings, TaskDashSettingTab } from '../settings';
import { DEFAULT_TASK_SKILL, DEFAULT_COMMENT_SKILL } from '../ai/emailAssistant';

describe('email skill configuration panel', () => {
  it('persists edited skills and resets each editor independently', async () => {
    const plugin = { settings:normalizeSettings(null), saveSettings:vi.fn(async () => {}) };
    const tab = new TaskDashSettingTab({} as never, plugin as never);
    tab.display();
    const task = tab.containerEl.querySelector<HTMLTextAreaElement>('textarea[aria-label="Task drafting skill"]')!;
    const comment = tab.containerEl.querySelector<HTMLTextAreaElement>('textarea[aria-label="Comment drafting skill"]')!;
    expect(task.value).toBe(DEFAULT_TASK_SKILL);
    expect(comment.value).toBe(DEFAULT_COMMENT_SKILL);
    task.value = 'Write one factual paragraph with the next action.';
    task.dispatchEvent(new Event('input', { bubbles:true }));
    comment.value = 'Summarize the latest update in one short paragraph.';
    comment.dispatchEvent(new Event('input', { bubbles:true }));
    await Promise.resolve();
    expect(plugin.settings.emailAssistant.taskSkill).toBe(task.value);
    expect(plugin.settings.emailAssistant.commentSkill).toBe(comment.value);
    expect(plugin.saveSettings).toHaveBeenCalledTimes(2);
    task.parentElement!.querySelector('button')!.click();
    await Promise.resolve();
    expect(task.value).toBe(DEFAULT_TASK_SKILL);
    expect(plugin.settings.emailAssistant.taskSkill).toBe(DEFAULT_TASK_SKILL);
    expect(plugin.settings.emailAssistant.commentSkill).toBe(comment.value);
    comment.parentElement!.querySelector('button')!.click();
    await Promise.resolve();
    expect(comment.value).toBe(DEFAULT_COMMENT_SKILL);
    expect(plugin.saveSettings).toHaveBeenCalledTimes(4);
  });

  it('rejects blank and oversized edits without replacing the saved skill', async () => {
    const plugin = { settings:normalizeSettings(null), saveSettings:vi.fn(async () => {}) };
    const tab = new TaskDashSettingTab({} as never, plugin as never);
    tab.display();
    const area = tab.containerEl.querySelector<HTMLTextAreaElement>('textarea[aria-label="Task drafting skill"]')!;
    for (const value of [' ', 'é'.repeat(2001)]) {
      area.value = value;
      area.dispatchEvent(new Event('input', { bubbles:true }));
      await Promise.resolve();
      expect(plugin.settings.emailAssistant.taskSkill).toBe(DEFAULT_TASK_SKILL);
    }
    expect(tab.containerEl.textContent).toContain('shorten this text to save');
    expect(plugin.saveSettings).not.toHaveBeenCalled();
  });

  it('persists the enable toggle while preserving both skills', async () => {
    const plugin = { settings:normalizeSettings(null), saveSettings:vi.fn(async () => {}) };
    const tab = new TaskDashSettingTab({} as never, plugin as never);
    tab.display();
    const toggle = tab.containerEl.querySelector<HTMLInputElement>('input[aria-label="Enable local email assistant"]')!;
    expect(toggle.checked).toBe(true);
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change', { bubbles:true }));
    await Promise.resolve();
    expect(plugin.settings.emailAssistant.enabled).toBe(false);
    expect(plugin.settings.emailAssistant.taskSkill).toBe(DEFAULT_TASK_SKILL);
    expect(plugin.settings.emailAssistant.commentSkill).toBe(DEFAULT_COMMENT_SKILL);
    expect(plugin.saveSettings).toHaveBeenCalledOnce();
  });
});
