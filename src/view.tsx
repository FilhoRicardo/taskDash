import { ItemView, WorkspaceLeaf } from 'obsidian';
import { createRoot, Root } from 'react-dom/client';
import type TaskDashPlugin from './main';
import { ObsidianVaultAdapter } from './vault/obsidian';
import { pickVaultFolder } from './vault/folderPicker';
import { FOLDER_SETTINGS_META, FolderKey } from './settings';
import App from './app/App.jsx';
import { setStorageScope } from './app/utils/storage.js';

export const TASKDASH_VIEW_TYPE = 'taskdash-2-2-view';

export class TaskDashView extends ItemView {
  plugin: TaskDashPlugin;
  private root: Root | null = null;
  private adapter: ObsidianVaultAdapter | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: TaskDashPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.navigation = false;
  }

  getViewType(): string {
    return TASKDASH_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'TaskDash 2.2';
  }

  getIcon(): string {
    return 'layout-dashboard';
  }

  async onOpen(): Promise<void> {
    // Profiling: time from view open to the app announcing readiness.
    const openedAt = performance.now();
    window.addEventListener(
      'taskdash-2-2-app-ready',
      () => console.debug(`[TaskDash 2.2] view open → app mounted: ${Math.round(performance.now() - openedAt)}ms`),
      { once: true }
    );

    // Device-local app state (timer, filters, backups) is namespaced per
    // vault so two vaults on one device never see each other's state.
    const vaultScope = (this.app as unknown as { appId?: string }).appId ?? this.app.vault.getName();
    setStorageScope(`${vaultScope}:taskdash-2-2`);

    const container = this.contentEl;
    container.empty();
    container.addClass('taskdash-view-content');
    const mount = container.createDiv({ cls: 'taskdash-root' });

    this.adapter = new ObsidianVaultAdapter(this.app, {
      getConfig: () => ({ ...this.plugin.settings.folders }),
      setConfig: async (key, path) => {
        this.plugin.settings.folders[key as FolderKey] = path ?? '';
        await this.plugin.saveSettings();
      },
      pickFolderPath: key => {
        const meta = FOLDER_SETTINGS_META[key as FolderKey];
        return pickVaultFolder(this.app, meta ? `Choose the ${meta.label.toLowerCase()}` : 'Choose a vault folder');
      },
    });

    this.root = createRoot(mount);
    // StrictMode is intentionally off in the plugin: the app's data loading
    // runs in effects and double-invocation would double every vault scan.
    this.root.render(<App vaultAdapter={this.adapter} onOpenSettings={() => this.openPluginSettings()} />);
  }

  private openPluginSettings(): void {
    // Obsidian's settings manager is not in the public typings.
    const setting = (this.app as unknown as { setting: { open(): void; openTabById(id: string): void } }).setting;
    setting.open();
    setting.openTabById(this.plugin.manifest.id);
  }

  async onClose(): Promise<void> {
    this.root?.unmount();
    this.root = null;
    this.adapter?.dispose();
    this.adapter = null;
    this.contentEl.empty();
  }
}
