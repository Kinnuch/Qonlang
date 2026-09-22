<script lang="ts">
  /**
   * 「应用」这一档设置（界面、保存与启动、更新、显示）：跟项目无关，所以设置页和开始页都用它。
   */
  import { ui } from '$lib/state/ui.svelte'
  import { t, LOCALES } from '$lib/i18n/index.svelte'
  import { Eye, Palette, RefreshCw, Save } from '@lucide/svelte'
  import HelpDot from '$lib/ui/HelpDot.svelte'
  import { filterRows } from '$lib/ui/filterRows'
</script>

<div class="groups" data-tour="settings-app">
  <section class="card group" use:filterRows={{ q: ui.search, sel: ':scope > .grid > *' }}>
    <h3><Palette size={15} />{t('settings.groups.ui')}</h3>
    <div class="grid">
      <div class="field">
        <label for="s-locale">{t('settings.uiLanguage')}</label>
        <select
          id="s-locale"
          class="select"
          bind:value={ui.prefs.locale}
          onchange={() => ui.savePrefs()}
        >
          {#each LOCALES as l (l.code)}<option value={l.code}>{l.label}</option>{/each}
        </select>
      </div>
      <div class="field">
        <label for="s-theme">{t('settings.theme')}</label>
        <select
          id="s-theme"
          class="select"
          bind:value={ui.prefs.theme}
          onchange={() => ui.savePrefs()}
        >
          <option value="system">{t('settings.themeSystem')}</option>
          <option value="light">{t('settings.themeLight')}</option>
          <option value="dark">{t('settings.themeDark')}</option>
        </select>
      </div>
      <label class="row check">
        <input
          type="checkbox"
          bind:checked={ui.prefs.showHelpDots}
          onchange={() => ui.savePrefs()}
        />
        {t('settings.showHelpDots')}
      </label>
      <label class="row check" data-tour="settings-guide">
        <input
          type="checkbox"
          bind:checked={ui.prefs.guideTourAlways}
          onchange={() => ui.savePrefs()}
        />
        {t('settings.guideTourAlways')}
      </label>
    </div>
  </section>
  <section class="card group" use:filterRows={{ q: ui.search, sel: ':scope > .grid > *' }}>
    <h3><Save size={15} />{t('settings.groups.saving')}</h3>
    <div class="grid">
      <div class="field">
        <label for="s-autosave">{t('settings.autosave')}</label>
        <input
          id="s-autosave"
          type="number"
          min="0"
          step="5"
          class="input"
          bind:value={ui.prefs.autosaveSeconds}
          onchange={() => ui.savePrefs()}
        />
      </div>
      <div class="field">
        <label for="s-backups">{t('settings.backupCount')}</label>
        <input
          id="s-backups"
          type="number"
          min="0"
          class="input"
          bind:value={ui.prefs.backupCount}
          onchange={() => ui.savePrefs()}
        />
      </div>
      <label class="row check">
        <input type="checkbox" bind:checked={ui.prefs.reopenLast} onchange={() => ui.savePrefs()} />
        {t('settings.reopenLast')}
      </label>
    </div>
  </section>
  <section class="card group" use:filterRows={{ q: ui.search, sel: ':scope > .grid > *' }}>
    <h3><RefreshCw size={15} />{t('settings.groups.updates')}</h3>
    <div class="grid">
      <label class="row check">
        <input
          type="checkbox"
          bind:checked={ui.prefs.checkUpdates}
          onchange={() => {
            ui.prefs.skippedVersion = ''
            void ui.savePrefs()
          }}
        />
        {t('settings.checkUpdates')}
      </label>
      <div class="field">
        <label for="s-update-minutes">{t('settings.updateCheckMinutes')}</label>
        <input
          id="s-update-minutes"
          type="number"
          min="1"
          max="1440"
          class="input"
          disabled={!ui.prefs.checkUpdates}
          bind:value={ui.prefs.updateCheckMinutes}
          onchange={() => ui.savePrefs()}
        />
      </div>
    </div>
  </section>
  <section class="card group" use:filterRows={{ q: ui.search, sel: ':scope > .grid > *' }}>
    <h3><Eye size={15} />{t('settings.groups.display')}</h3>
    <div class="grid">
      <div class="field">
        <label for="s-register">{t('settings.registerDisplay')}</label>
        <select
          id="s-register"
          class="select"
          bind:value={ui.prefs.registerDisplay}
          onchange={() => ui.savePrefs()}
        >
          <option value="short">{t('settings.registerDisplayShort')}</option>
          <option value="full">{t('settings.registerDisplayFull')}</option>
        </select>
      </div>
      <div class="field">
        <label for="s-pron">{t('settings.pronBrackets')}</label>
        <select
          id="s-pron"
          class="select"
          bind:value={ui.prefs.pronBrackets}
          onchange={() => ui.savePrefs()}
        >
          <option value="slash">{t('settings.pronBracketsSlash')}</option>
          <option value="bracket">{t('settings.pronBracketsBracket')}</option>
          <option value="none">{t('settings.pronBracketsNone')}</option>
        </select>
      </div>
      <div class="field">
        <label for="s-examples">{t('settings.examplesPerEntry')}</label>
        <input
          id="s-examples"
          type="number"
          min="0"
          max="20"
          class="input"
          bind:value={ui.prefs.examplesPerEntry}
          onchange={() => ui.savePrefs()}
        />
      </div>
      <label class="row check">
        <input
          type="checkbox"
          bind:checked={ui.prefs.highlightDuplicates}
          onchange={() => ui.savePrefs()}
        />
        {t('settings.highlightDuplicates')}
      </label>
      <label class="row check">
        <input
          type="checkbox"
          bind:checked={ui.prefs.showDerivedMark}
          onchange={() => ui.savePrefs()}
        />
        {t('settings.showDerivedMark')}
      </label>
      <label class="row check">
        <input
          type="checkbox"
          bind:checked={ui.prefs.showHistory}
          onchange={() => ui.savePrefs()}
        />
        {t('settings.showHistory')}<HelpDot tip={t('settings.showHistoryHint')} />
      </label>
      <label class="row check">
        <input
          type="checkbox"
          bind:checked={ui.prefs.examplesShowScript}
          onchange={() => ui.savePrefs()}
        />
        {t('settings.examplesShowScript')}
      </label>
    </div>
  </section>
</div>

<style>
  .groups {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .group {
    padding: 14px 18px 4px;
  }
  .group h3 {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 14px;
    margin-bottom: 10px;
  }
  /* 窄的时候（开始页右边那个面板）一行一个，宽了才两列 */
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    column-gap: 20px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 12px;
  }
  .field label {
    font-size: 12px;
    color: var(--text-2);
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .check {
    gap: 8px;
    margin-bottom: 12px;
  }
</style>
