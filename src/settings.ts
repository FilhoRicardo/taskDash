import { App, PluginSettingTab, Setting } from 'obsidian';
import type TaskDashPlugin from './main';
import { FolderSuggest } from './vault/folderPicker';
import { DEFAULT_COMMENT_SKILL, DEFAULT_TASK_SKILL } from './ai/emailAssistant';

// Folder keys mirror the app's FOLDER_DEFS keys so the adapter can map 1:1.
export const FOLDER_KEYS = [
  'tasks',
  'done',
  'meetings',
  'projects',
  'properties',
  'clients',
  'people',
  'organizations',
  'attachments',
  'daily',
] as const;

export type FolderKey = (typeof FOLDER_KEYS)[number];

export const FOLDER_SETTINGS_META: Record<FolderKey, { label: string; desc: string; required: boolean }> = {
  tasks: { label: 'Tasks folder', desc: 'Where your task .md files live (e.g. TaskNotes/Tasks). Required.', required: true },
  done: { label: 'Done / Archive folder', desc: 'Optional folder for completed or archived task .md files.', required: false },
  meetings: { label: 'Meetings folder', desc: 'Where meeting notes created by TaskDash should be saved.', required: false },
  projects: { label: 'Projects folder', desc: 'For project autocomplete and editing; reads Cover_ files inside subfolders.', required: false },
  properties: { label: 'Properties folder', desc: 'For building autocomplete and property comments.', required: false },
  clients: { label: 'Clients folder', desc: 'For client autocomplete.', required: false },
  people: { label: 'People folder', desc: 'For "waiting for" autocomplete and adding new people.', required: false },
  organizations: { label: 'Organizations folder', desc: 'For organization notes, autocomplete, and adding new organizations.', required: false },
  attachments: { label: 'Attachments folder', desc: 'For property cover images and uploads.', required: false },
  daily: { label: 'Daily notes folder', desc: 'Where TaskDash should auto-create YYYY-MM-DD daily notes.', required: false },
};

export interface TaskDashSettings {
  folders: Record<FolderKey, string>;
  enableStatusBarTimer: boolean;
  emailAssistant: {
    enabled: boolean;
    taskSkill: string;
    commentSkill: string;
  };
}

export const DEFAULT_SETTINGS: TaskDashSettings = {
  folders: {
    tasks: '',
    done: '',
    meetings: '',
    projects: '',
    properties: '',
    clients: '',
    people: '',
    organizations: '',
    attachments: '',
    daily: '',
  },
  enableStatusBarTimer: true,
  emailAssistant: {
    enabled: true,
    taskSkill: DEFAULT_TASK_SKILL,
    commentSkill: DEFAULT_COMMENT_SKILL,
  },
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const validSkill = (value: unknown): value is string =>
  typeof value === 'string' && Boolean(value.trim()) && new TextEncoder().encode(value).byteLength <= 4000;

export function normalizeSettings(data: unknown): TaskDashSettings {
  const source = isRecord(data) ? data : {};
  const savedFolders = isRecord(source.folders) ? source.folders : {};
  const savedAssistant = isRecord(source.emailAssistant) ? source.emailAssistant : {};
  const folders = { ...DEFAULT_SETTINGS.folders };
  for (const key of FOLDER_KEYS) {
    if (typeof savedFolders[key] === 'string') folders[key] = savedFolders[key] as string;
  }
  return {
    folders,
    enableStatusBarTimer:
      typeof source.enableStatusBarTimer === 'boolean' ? source.enableStatusBarTimer : DEFAULT_SETTINGS.enableStatusBarTimer,
    emailAssistant: {
      enabled: typeof savedAssistant.enabled === 'boolean' ? savedAssistant.enabled : DEFAULT_SETTINGS.emailAssistant.enabled,
      taskSkill: validSkill(savedAssistant.taskSkill) ? savedAssistant.taskSkill : DEFAULT_TASK_SKILL,
      commentSkill: validSkill(savedAssistant.commentSkill) ? savedAssistant.commentSkill : DEFAULT_COMMENT_SKILL,
    },
  };
}

export class TaskDashSettingTab extends PluginSettingTab {
  plugin: TaskDashPlugin;

  constructor(app: App, plugin: TaskDashPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName('Folders').setHeading();

    for (const key of FOLDER_KEYS) {
      const meta = FOLDER_SETTINGS_META[key];
      new Setting(containerEl)
        .setName(meta.label)
        .setDesc(meta.desc)
        .addText(text => {
          text
            .setPlaceholder(meta.required ? 'Required — vault folder path' : 'Vault folder path')
            .setValue(this.plugin.settings.folders[key])
            .onChange(async value => {
              this.plugin.settings.folders[key] = value.trim().replace(/^\/+|\/+$/g, '');
              await this.plugin.saveSettings();
            });
          new FolderSuggest(this.app, text.inputEl, async path => {
            this.plugin.settings.folders[key] = path;
            await this.plugin.saveSettings();
          });
        });
    }

    new Setting(containerEl).setName('Behavior').setHeading();

    new Setting(containerEl)
      .setName('Status bar timer')
      .setDesc('Show the running TaskDash timer in the status bar (desktop only).')
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.enableStatusBarTimer).onChange(async value => {
          this.plugin.settings.enableStatusBarTimer = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl).setName('Local email assistant').setHeading();
    containerEl.createEl('p', {
      text: 'Drafts run only when requested, using Ollama at http://127.0.0.1:11434 with qwen3:4b. Install and start Ollama locally to use this feature.',
    });
    new Setting(containerEl)
      .setName('Enable local email assistant')
      .setDesc('Allow explicit email-to-task and email-to-comment drafting.')
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.emailAssistant.enabled).onChange(async value => {
          this.plugin.settings.emailAssistant.enabled = value;
          await this.plugin.saveSettings();
        })
      );

    const skillEditor = (key: 'taskSkill' | 'commentSkill', name: string, description: string, defaultValue: string) => {
      const setting = new Setting(containerEl).setName(name).setDesc(description);
      setting.settingEl.style.display = 'block';
      setting.controlEl.style.marginTop = '8px';
      let resetEditor: ((value: string) => unknown) | null = null;
      setting.addTextArea(area => {
        area.setValue(this.plugin.settings.emailAssistant[key]);
        area.inputEl.rows = 5;
        area.inputEl.style.width = '100%';
        area.inputEl.setAttribute('aria-label', name);
        resetEditor = value => area.setValue(value);
        area.onChange(async value => {
          const bytes = new TextEncoder().encode(value).byteLength;
          if (!value.trim() || bytes > 4000) {
            setting.setDesc(`${description} ${!value.trim() ? 'Text must not be blank.' : `${bytes} / 4000 bytes; shorten this text to save.`}`);
            return;
          }
          this.plugin.settings.emailAssistant[key] = value;
          setting.setDesc(`${description} ${bytes} / 4000 bytes.`);
          await this.plugin.saveSettings();
        });
      });
      setting.addButton(button => {
        button.setButtonText('Reset to default');
        button.buttonEl.setAttribute('aria-label', `Reset ${name} to default`);
        button.onClick(async () => {
          this.plugin.settings.emailAssistant[key] = defaultValue;
          resetEditor?.(defaultValue);
          setting.setDesc(`${description} ${new TextEncoder().encode(defaultValue).byteLength} / 4000 bytes.`);
          await this.plugin.saveSettings();
        });
      });
    };
    skillEditor('taskSkill', 'Task drafting skill', 'Editable task-drafting instructions. Maximum 4000 UTF-8 bytes.', DEFAULT_TASK_SKILL);
    skillEditor('commentSkill', 'Comment drafting skill', 'Editable comment-drafting instructions. Maximum 4000 UTF-8 bytes.', DEFAULT_COMMENT_SKILL);
  }
}
