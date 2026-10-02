import { App, PluginSettingTab, Setting } from 'obsidian';
import type TaskDashPlugin from './main';
import { FolderSuggest } from './vault/folderPicker';

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
};

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
  }
}
