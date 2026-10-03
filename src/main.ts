import { Plugin, WorkspaceLeaf } from 'obsidian';
import { DEFAULT_SETTINGS, normalizeSettings, TaskDashSettings, TaskDashSettingTab } from './settings';
import { TASKDASH_VIEW_TYPE, TaskDashView } from './view';

interface TimerDetail {
  start: number;
  title: string;
}

export default class TaskDashPlugin extends Plugin {
  settings: TaskDashSettings = DEFAULT_SETTINGS;
  private statusBarEl: HTMLElement | null = null;
  private statusTimer: TimerDetail | null = null;
  private statusIntervalId: number | null = null;
  private pendingCommand: string | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    // Startup rule: register surfaces only. No vault reads, no React mounts —
    // all data loading happens when the TaskDash view opens.
    this.registerView(TASKDASH_VIEW_TYPE, leaf => new TaskDashView(leaf, this));

    this.addRibbonIcon('layout-dashboard', 'Open TaskDash 2.2 Preview', () => {
      void this.activateView();
    });

    // Command names omit the plugin name; the palette already prefixes
    // them with "TaskDash:". Ids stay stable for user hotkey bindings.
    this.addCommand({
      id: 'open',
      name: 'Open dashboard',
      callback: () => void this.activateView(),
    });
    this.addCommand({
      id: 'create-task',
      name: 'Create task',
      callback: () => void this.sendCommand('new-task'),
    });
    this.addCommand({
      id: 'toggle-timer',
      name: 'Start or stop timer',
      callback: () => void this.sendCommand('toggle-timer'),
    });
    this.addCommand({
      id: 'refresh',
      name: 'Refresh data',
      callback: () => void this.sendCommand('refresh'),
    });
    this.addCommand({
      id: 'open-review',
      name: 'Start task review',
      callback: () => void this.sendCommand('open-review'),
    });
    this.addCommand({
      id: 'open-waiting',
      name: 'Open waiting-for queue',
      callback: () => void this.sendCommand('open-waiting'),
    });
    this.addCommand({
      id: 'triage-brain-dump',
      name: 'Triage Brain Dump tasks',
      callback: () => void this.sendCommand('triage-brain-dump'),
    });

    this.addSettingTab(new TaskDashSettingTab(this.app, this));

    this.statusBarEl = this.addStatusBarItem();
    this.statusBarEl.addClass('taskdash-statusbar');

    // Bridge events from the React app (typed loosely; names are plugin-scoped).
    const onReady = () => {
      if (!this.pendingCommand) return;
      const action = this.pendingCommand;
      this.pendingCommand = null;
      window.dispatchEvent(new CustomEvent('taskdash-2-2-command', { detail: { action } }));
    };
    const onTimer = (e: Event) => {
      this.updateStatusTimer((e as CustomEvent<TimerDetail | null>).detail ?? null);
    };
    window.addEventListener('taskdash-2-2-app-ready', onReady);
    window.addEventListener('taskdash-2-2-timer', onTimer);
    this.register(() => {
      window.removeEventListener('taskdash-2-2-app-ready', onReady);
      window.removeEventListener('taskdash-2-2-timer', onTimer);
    });
  }

  onunload(): void {
    if (this.statusIntervalId !== null) window.clearInterval(this.statusIntervalId);
  }

  // Single-instance view: reveal the existing leaf instead of mounting twice.
  async activateView(): Promise<void> {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(TASKDASH_VIEW_TYPE);
    let leaf: WorkspaceLeaf;
    if (existing.length > 0) {
      leaf = existing[0];
    } else {
      leaf = workspace.getLeaf(true);
      await leaf.setViewState({ type: TASKDASH_VIEW_TYPE, active: true });
    }
    await workspace.revealLeaf(leaf);
  }

  /** Route a command into the app, opening the view first when needed. */
  private async sendCommand(action: string): Promise<void> {
    const viewOpen = this.app.workspace.getLeavesOfType(TASKDASH_VIEW_TYPE).length > 0;
    if (viewOpen) {
      await this.activateView();
      window.dispatchEvent(new CustomEvent('taskdash-2-2-command', { detail: { action } }));
    } else {
      // The app dispatches its ready event once mounted; deliver then.
      this.pendingCommand = action;
      await this.activateView();
    }
  }

  private updateStatusTimer(detail: TimerDetail | null): void {
    this.statusTimer = this.settings.enableStatusBarTimer ? detail : null;
    if (this.statusTimer && this.statusIntervalId === null) {
      this.statusIntervalId = window.setInterval(() => this.renderStatusTimer(), 1000);
    }
    if (!this.statusTimer && this.statusIntervalId !== null) {
      window.clearInterval(this.statusIntervalId);
      this.statusIntervalId = null;
    }
    this.renderStatusTimer();
  }

  private renderStatusTimer(): void {
    if (!this.statusBarEl) return;
    if (!this.statusTimer) {
      this.statusBarEl.setText('');
      return;
    }
    const secs = Math.max(0, Math.floor((Date.now() - this.statusTimer.start) / 1000));
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    const elapsed = h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
    this.statusBarEl.setText(`⏱ ${elapsed} ${this.statusTimer.title}`);
  }

  async loadSettings(): Promise<void> {
    const data = (await this.loadData()) as Partial<TaskDashSettings> | null;
    this.settings = normalizeSettings(data);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
