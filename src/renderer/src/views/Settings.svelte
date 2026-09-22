<script lang="ts">
  import { onMount } from 'svelte'
  import lockupSvg from '../assets/brand/lockup-full.svg?raw'
  import { platform, type AppInfo } from '$lib/platform'
  import { projectState } from '$lib/state/project.svelte'
  import { ui } from '$lib/state/ui.svelte'
  import { t } from '$lib/i18n/index.svelte'
  import { TOKENIZER_MODES } from '$lib/core/model'
  import {
    Eye,
    FileSpreadsheet,
    FileText,
    FolderOutput,
    Languages,
    Copy,
    Plug,
    Puzzle,
    RefreshCw,
    Scissors,
    Table,
    Trash2
  } from '@lucide/svelte'
  import { updates } from '$lib/state/updates.svelte'
  import GuideLink from '$lib/ui/GuideLink.svelte'
  import AppSettings from '$lib/ui/AppSettings.svelte'
  import HelpDot from '$lib/ui/HelpDot.svelte'
  import { filterRows } from '$lib/ui/filterRows'
  import { pluginHost } from '$lib/plugins/host.svelte'
  import { BUILTIN_PLUGINS } from '$lib/plugins/builtin'
  import { mcpTools } from '$lib/mcp/tools'
  import { mcpLog } from '$lib/mcp/bridge.svelte'
  import { pluginRegistry } from '$lib/plugins/registry.svelte'

  let { inspectorTitle = $bindable('') }: { inspectorTitle?: string } = $props()
  $effect(() => {
    inspectorTitle = t('settings.about')
  })

  const project = $derived(projectState.project!)
  let info = $state<AppInfo | null>(null)
  /** 在这一页点过「立即检查」才显示结果（后台自动检查的结果不在这里出） */
  let checkedNow = $state(false)
  /** Release 上的最新版本：后台自动检查或手动检查问到过才有 */
  const latest = $derived(updates.last?.latest ?? '')
  async function checkNow(): Promise<void> {
    checkedNow = true
    await updates.check(true)
  }
  onMount(async () => {
    info = await platform.info()
    mcpStatus = await platform.mcpStatus()
  })

  // ── MCP ──
  let mcpStatus = $state<{ running: boolean; url?: string; port?: number }>({ running: false })
  let mcpError = $state('')
  const mcpToolCount = $derived(mcpTools().length)
  const mcpConfig = $derived(
    JSON.stringify(
      {
        mcpServers: {
          qonlang: {
            type: 'http',
            url: mcpStatus.url ?? '',
            headers: { Authorization: `Bearer ${ui.prefs.mcpToken ?? ''}` }
          }
        }
      },
      null,
      2
    )
  )
  /** 令牌：够长的随机串就行，本机服务不用更复杂的东西 */
  function newToken(): string {
    const a = new Uint8Array(18)
    crypto.getRandomValues(a)
    return 'qnl_' + [...a].map((x) => x.toString(16).padStart(2, '0')).join('')
  }
  async function startMcp(): Promise<void> {
    mcpError = ''
    if (!ui.prefs.mcpToken) {
      // 令牌是这时候现生成的：先存下来，不然重启后连不上
      ui.prefs.mcpToken = newToken()
      await ui.savePrefs()
    }
    const r = await platform.mcpStart(ui.prefs.mcpPort ?? 7421, ui.prefs.mcpToken)
    if (r.ok) mcpStatus = { running: true, url: r.url, port: r.port }
    else {
      mcpError = r.error ?? ''
      mcpStatus = { running: false }
    }
  }
  async function toggleMcp(e: Event): Promise<void> {
    const on = (e.currentTarget as HTMLInputElement).checked
    ui.prefs.mcpEnabled = on
    await ui.savePrefs()
    if (on) await startMcp()
    else {
      await platform.mcpStop()
      mcpStatus = { running: false }
    }
  }
  async function setMcpPort(port: number): Promise<void> {
    ui.prefs.mcpPort = Number.isFinite(port) ? port : 7421
    await ui.savePrefs()
    if (ui.prefs.mcpEnabled) await startMcp()
  }
  async function regenToken(): Promise<void> {
    ui.prefs.mcpToken = newToken()
    await ui.savePrefs()
    if (ui.prefs.mcpEnabled) await startMcp()
  }
  async function copyCfg(): Promise<void> {
    await navigator.clipboard.writeText(mcpConfig)
    ui.toast(t('mcp.copied'))
  }

  let glossLangs = $state('')
  let boundaries = $state('')
  $effect(() => {
    glossLangs = project.settings.glossLanguages.join(', ')
    boundaries = project.settings.morphemeBoundaries.join(' ')
  })
  function commitGlossLangs(): void {
    project.settings.glossLanguages = glossLangs
      .split(/[,，\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
    projectState.touch()
  }
  /** 可以整块清掉的内容：清之前问一次，清完能撤销 */
  const CLEAR_KINDS = [
    'lexemes',
    'morphemes',
    'sentences',
    'phrasebook',
    'docs',
    'ruleSets',
    'paradigms',
    'posList',
    'categories',
    'customFields',
    'abbreviations',
    'scripts',
    'images'
  ] as const
  type ClearKind = (typeof CLEAR_KINDS)[number]
  let clearKind = $state<'' | ClearKind>('')
  function clearCount(k: ClearKind): number {
    if (k === 'scripts') return project.languages.reduce((n, l) => n + l.scripts.length, 0)
    if (k === 'images') return project.lexemes.reduce((n, l) => n + (l.images?.length ?? 0), 0)
    return ((project as unknown as Record<string, unknown[]>)[k] ?? []).length
  }
  async function doClear(): Promise<void> {
    const k = clearKind
    if (!k) return
    const name = t(`settings.clearKinds.${k}`)
    const n = clearCount(k)
    const ok = await ui.confirm(
      t('settings.clearConfirm', { name }),
      t('settings.clearConfirmBody', { n }),
      t('settings.clearBtn')
    )
    if (!ok) return
    if (k === 'scripts') for (const l of project.languages) l.scripts = []
    else if (k === 'images') for (const l of project.lexemes) l.images = []
    else (project as unknown as Record<string, unknown[]>)[k] = []
    projectState.touch()
    ui.toast(t('settings.cleared', { name, n }))
    clearKind = ''
  }

  function commitBoundaries(): void {
    project.settings.morphemeBoundaries = boundaries.split(/\s+/).filter(Boolean)
    projectState.touch()
  }
</script>

<div class="page">
  <div class="row">
    <h1>{t('settings.title')}</h1>
    <GuideLink section="settings" />
  </div>

  <h2 class="cat">{t('settings.app')}</h2>
  <AppSettings />
  <h2 class="cat">{t('mcp.cat')}</h2>
  <div class="groups">
    <section class="card group" data-tour="mcp-card">
      <h3><Plug size={15} />{t('mcp.title')}<GuideLink section="extending" anchor="mcp" /></h3>
      <p class="small muted">{t('mcp.hint')}</p>
      <div class="grid" data-tour="mcp-conn">
        <label class="row check">
          <input type="checkbox" checked={ui.prefs.mcpEnabled === true} onchange={toggleMcp} />
          {t('mcp.enable')}
        </label>
        <div class="field">
          <label for="mcp-port">{t('mcp.port')}<HelpDot tip={t('mcp.portHint')} /></label>
          <input
            id="mcp-port"
            class="input"
            type="number"
            min="0"
            max="65535"
            value={ui.prefs.mcpPort ?? 7421}
            onchange={(e) => void setMcpPort(Number((e.currentTarget as HTMLInputElement).value))}
          />
        </div>
        <div class="field">
          <label for="mcp-token">{t('mcp.token')}</label>
          <div class="row">
            <input
              id="mcp-token"
              class="input mono grow"
              readonly
              value={ui.prefs.mcpToken ?? ''}
            />
            <button class="btn sm" onclick={() => void regenToken()}>{t('mcp.regen')}</button>
          </div>
        </div>
        <label class="row check">
          <input
            type="checkbox"
            checked={ui.prefs.mcpConfirmWrites !== false}
            onchange={(e) => {
              ui.prefs.mcpConfirmWrites = (e.currentTarget as HTMLInputElement).checked
              void ui.savePrefs()
            }}
          />
          {t('mcp.confirmWrites')}<HelpDot tip={t('mcp.confirmWritesHint')} />
        </label>
      </div>
      <p class="small">
        {#if mcpStatus.running}
          <span class="ok">{t('mcp.running', { url: mcpStatus.url ?? '' })}</span>
        {:else if mcpError}
          <span class="warn">{t('mcp.failed', { error: mcpError })}</span>
        {:else}
          <span class="muted">{t('mcp.stopped')}</span>
        {/if}
        <span class="muted"> · {t('mcp.tools', { n: mcpToolCount })}</span>
      </p>
      {#if mcpStatus.running}
        <div class="field">
          <label for="mcp-cfg">{t('mcp.clientHint')}</label>
          <textarea id="mcp-cfg" class="textarea mono" rows="6" readonly>{mcpConfig}</textarea>
          <button class="btn sm" onclick={() => void copyCfg()}
            ><Copy size={13} />{t('mcp.copy')}</button
          >
        </div>
      {/if}
      {#if mcpLog.length}
        <p class="small muted">{t('mcp.recent')}</p>
        <ul class="mcp-log">
          {#each mcpLog.slice(0, 8) as e (e.at + e.name)}
            <li class:bad={!e.ok}>
              <span class="mono">{new Date(e.at).toLocaleTimeString()}</span>
              <b>{e.name}</b>
              <span class="muted">{e.note}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  </div>

  <h2 class="cat">{t('settings.plugins.cat')}</h2>
  <div class="groups">
    <section class="card group" data-tour="plugins-card">
      <h3>
        <Puzzle size={15} />{t('settings.plugins.title')}<GuideLink
          section="extending"
          anchor="plugins"
        />
      </h3>
      <p class="small muted">{t('settings.plugins.hint')}</p>
      <!-- 自带插件：跟着软件发，不用装，勾上才出现（默认都不勾） -->
      <ul class="plugins">
        {#each BUILTIN_PLUGINS as b (b.id)}
          <li class="card plugin">
            <label class="row check">
              <input
                type="checkbox"
                checked={ui.builtinOn(b.id)}
                onchange={(e) =>
                  void ui.setBuiltin(
                    b.id,
                    (e.currentTarget as HTMLInputElement).checked,
                    b.section
                  )}
              />
              <strong>{t(b.nameKey)}</strong>
              <span class="badge">{t('settings.plugins.builtin')}</span>
            </label>
            <p class="small muted">{t(b.hintKey)}</p>
          </li>
        {/each}
      </ul>
      <div class="row wrap plugin-acts" data-tour="plugins-acts">
        <button class="btn sm" onclick={() => void platform.openPluginsFolder()}
          ><FolderOutput size={13} />{t('settings.plugins.openFolder')}</button
        >
        <button class="btn sm" onclick={() => void pluginHost.loadAll()}
          ><RefreshCw size={13} />{t('settings.plugins.reload')}</button
        >
        <span class="tiny muted path">{pluginHost.dir}</span>
      </div>
      {#if !pluginHost.list.length}
        <p class="small muted">{t('settings.plugins.none')}</p>
      {:else}
        <ul class="plugins">
          {#each pluginHost.list as p (p.manifest.id)}
            {@const n = pluginRegistry.countsOf(p.manifest.id)}
            <li class="card plugin">
              <label class="row check">
                <input
                  type="checkbox"
                  checked={p.enabled}
                  onchange={(e) =>
                    void pluginHost.setEnabled(p, (e.currentTarget as HTMLInputElement).checked)}
                />
                <strong>{p.manifest.name}</strong>
                {#if p.manifest.version}<span class="badge">{p.manifest.version}</span>{/if}
                {#if p.error}<span class="badge warn">{t('settings.plugins.failed')}</span>
                {:else if p.loaded}<span class="badge ok">{t('settings.plugins.loaded')}</span>{/if}
              </label>
              {#if p.manifest.description}
                <p class="small muted">{p.manifest.description}</p>
              {/if}
              {#if p.error}
                <p class="small warn">{p.error}</p>
              {:else if p.loaded}
                <p class="tiny muted">
                  {t('settings.plugins.counts', {
                    views: n.views,
                    commands: n.commands,
                    io: n.io,
                    generators: n.generators
                  })}
                </p>
              {/if}
              <p class="tiny muted">{p.manifest.author ? p.manifest.author + ' · ' : ''}{p.dir}</p>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  </div>

  <h2 class="cat">{t('settings.project')}</h2>
  <div class="groups" data-tour="settings-project">
    <section class="card group" use:filterRows={{ q: ui.search, sel: ':scope > .grid > *' }}>
      <h3><FileText size={15} />{t('settings.groups.info')}</h3>
      <div class="grid">
        <div class="field">
          <label for="p-name">{t('settings.projectName')}</label>
          <input
            id="p-name"
            class="input"
            bind:value={project.meta.name}
            oninput={() => projectState.touch()}
          />
        </div>
        <div class="field">
          <label for="p-author">{t('settings.author')}</label>
          <input
            id="p-author"
            class="input"
            bind:value={project.meta.author}
            oninput={() => projectState.touch()}
          />
        </div>
        <div class="field">
          <label for="p-mark"
            >{t('settings.markSymbol')}<HelpDot tip={t('settings.markSymbolHint')} /></label
          >
          <input
            id="p-mark"
            class="input data"
            maxlength="4"
            placeholder="*"
            value={project.settings.markSymbol ?? ''}
            oninput={(e) => {
              project.settings.markSymbol = (e.currentTarget as HTMLInputElement).value || undefined
              projectState.touch()
            }}
          />
        </div>
        <div class="field wide">
          <label for="p-desc">{t('settings.description')}</label>
          <textarea
            id="p-desc"
            class="textarea"
            bind:value={project.meta.description}
            oninput={() => projectState.touch()}
          ></textarea>
        </div>
      </div>
    </section>
    <section class="card group" use:filterRows={{ q: ui.search, sel: ':scope > .grid > *' }}>
      <h3><Languages size={15} />{t('settings.groups.languages')}</h3>
      <div class="grid">
        <div class="field">
          <label for="p-default">{t('settings.defaultLanguage')}</label>
          <select
            id="p-default"
            class="select"
            bind:value={project.settings.defaultLanguageId}
            onchange={() => projectState.touch()}
          >
            <option value={null}>{t('common.none')}</option>
            {#each project.languages as l (l.id)}<option value={l.id}>{l.name}</option>{/each}
          </select>
        </div>
        <div class="field">
          <label for="p-gloss">{t('settings.glossLanguages')}</label>
          <input id="p-gloss" class="input" bind:value={glossLangs} onchange={commitGlossLangs} />
        </div>
        <div class="field">
          <label for="p-font">{t('settings.dataFont')}</label>
          <input
            id="p-font"
            class="input"
            bind:value={project.settings.dataFont}
            oninput={() => projectState.touch()}
            placeholder="Gentium Plus"
          />
        </div>
        <div class="field">
          <label for="p-imgw">{t('settings.imageSize')}</label>
          <div class="row">
            <input
              id="p-imgw"
              type="number"
              min="32"
              step="8"
              class="input"
              bind:value={project.settings.imageSize.width}
              onchange={() => projectState.touch()}
            />
            <span class="muted">×</span>
            <input
              type="number"
              min="32"
              step="8"
              class="input"
              bind:value={project.settings.imageSize.height}
              onchange={() => projectState.touch()}
            />
          </div>
        </div>
      </div>
    </section>
    <section class="card group" use:filterRows={{ q: ui.search, sel: ':scope > .grid > *' }}>
      <h3><Scissors size={15} />{t('settings.groups.words')}</h3>
      <div class="grid">
        <div class="field">
          <label for="p-bound">{t('settings.morphemeBoundaries')}</label>
          <input
            id="p-bound"
            class="input data"
            bind:value={boundaries}
            onchange={commitBoundaries}
          />
        </div>
        <div class="field">
          <label for="p-token">{t('settings.tokenizer')}</label>
          <select
            id="p-token"
            class="select"
            bind:value={project.settings.tokenizer}
            onchange={() => projectState.touch()}
          >
            {#each TOKENIZER_MODES as m (m)}
              <option value={m}>{t(`settings.tokenizers.${m}`)}</option>
            {/each}
          </select>
          <span class="small muted">{t('settings.tokenizerHint')}</span>
        </div>
        <div class="field">
          <label for="p-token-letters"
            >{t('settings.tokenizerLetters')}
            <HelpDot tip={t('settings.tokenizerLettersHint')} /></label
          >
          <input
            id="p-token-letters"
            class="input data"
            value={project.settings.tokenizerLetters ?? ''}
            placeholder={t('settings.tokenizerLettersPlaceholder')}
            oninput={(e) => {
              project.settings.tokenizerLetters = (e.currentTarget as HTMLInputElement).value
              projectState.touch()
            }}
          />
        </div>
        {#if project.settings.tokenizer === 'custom'}
          <div class="field">
            <label for="p-token-pat">{t('settings.tokenizerPattern')}</label>
            <input
              id="p-token-pat"
              class="input mono"
              placeholder="[\\s·]+"
              bind:value={project.settings.tokenizerPattern}
              onchange={() => projectState.touch()}
            />
            <span class="small muted">{t('settings.tokenizerPatternHint')}</span>
          </div>
        {/if}
      </div>
    </section>

    <section class="card group" use:filterRows={{ q: ui.search, sel: ':scope > .grid > *' }}>
      <h3><Table size={15} />{t('settings.groups.paradigms')}</h3>
      <div class="grid">
        <label class="row check wide">
          <input
            type="checkbox"
            checked={!!project.settings.complexSlots}
            onchange={(e) => {
              project.settings.complexSlots =
                (e.currentTarget as HTMLInputElement).checked || undefined
              projectState.touch()
            }}
          />
          {t('settings.complexSlots')}<HelpDot tip={t('settings.complexSlotsHint')} />
        </label>
      </div>
    </section>
  </div>

  <h2 class="cat">{t('settings.groups.data')}</h2>
  <div class="groups" data-tour="settings-data">
    <section class="card group" use:filterRows={{ q: ui.search, sel: ':scope > .grid > *' }}>
      <h3><FolderOutput size={15} />{t('common.export')}</h3>
      <div class="row">
        <button class="btn" onclick={() => projectState.exportFolder()}
          ><FolderOutput size={16} />{t('settings.exportFolder')}</button
        >
        <span class="small muted">{t('settings.exportFolderDesc')}</span>
      </div>
      <div class="row">
        <button class="btn" onclick={() => projectState.exportCsv()}
          ><FileSpreadsheet size={16} />{t('settings.exportCsv')}</button
        >
        <span class="small muted">{t('settings.exportCsvDesc')}</span>
      </div>
      <div class="row">
        <button class="btn" onclick={() => projectState.exportReadOnly()}
          ><Eye size={16} />{t('readonly.export')}</button
        >
        <span class="small muted">{t('readonly.exportDesc')}</span>
      </div>
    </section>

    <section class="card group" use:filterRows={{ q: ui.search, sel: ':scope > .grid > *' }}>
      <h3><Trash2 size={15} />{t('settings.clear')} <HelpDot tip={t('settings.clearHint')} /></h3>
      <div class="row">
        <select class="select" bind:value={clearKind}>
          <option value="">{t('settings.clearPick')}</option>
          {#each CLEAR_KINDS as k (k)}<option value={k}
              >{t(`settings.clearKinds.${k}`)}（{clearCount(k)}）</option
            >{/each}
        </select>
        <button class="btn sm danger" disabled={!clearKind} onclick={doClear}
          ><Trash2 size={14} />{t('settings.clearBtn')}</button
        >
        <span class="small muted">{t('settings.clearHint')}</span>
      </div>
    </section>
  </div>

  <h2 class="cat">{t('settings.about')}</h2>
  <section class="card group about" use:filterRows={{ q: ui.search, sel: ':scope > .grid > *' }}>
    <div class="lockup" aria-label={t('app.name')}>{@html lockupSvg}</div>
    <p class="versions">
      {t('settings.version')}
      {info?.version ?? ''}
      {#if platform.kind === 'electron'}
        ·
        <span
          class:newer={latest &&
            info &&
            latest !== info.version &&
            updates.last?.status === 'newer'}
          >{latest ? t('settings.latestVersion', { v: latest }) : t('settings.latestUnknown')}</span
        >
      {/if}
      · {t('settings.license')}
    </p>
    {#if platform.kind === 'electron'}
      <div class="row update-now">
        <button class="btn sm" disabled={updates.checking} onclick={checkNow}
          ><RefreshCw size={14} />{t('settings.checkNow')}</button
        >
        {#if updates.checking}
          <span class="small muted">{t('settings.updateChecking')}</span>
        {:else if checkedNow && updates.last}
          {@const r = updates.last}
          <span class="small" class:muted={r.status === 'latest'} class:bad={r.status === 'failed'}
            >{r.status === 'newer'
              ? t('settings.updateNewer', { v: r.latest ?? '' })
              : r.status === 'latest'
                ? t('settings.updateLatest', { v: r.latest ?? info?.version ?? '' })
                : t(`settings.updateFailed.${r.error ?? 'offline'}`)}</span
          >
        {/if}
      </div>
    {/if}
    {#if info?.userDataPath}
      <p class="small muted">{t('settings.userData')}: {info.userDataPath}</p>
    {/if}
  </section>
</div>

<style>
  .mcp-log {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
    font-size: 12px;
  }
  .mcp-log li {
    display: flex;
    gap: 8px;
  }
  .mcp-log li.bad b {
    color: var(--warn);
  }
  .ok {
    color: var(--accent-text);
  }
  .plugins {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 10px;
  }
  .plugin {
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .plugin .badge.ok {
    border-color: var(--accent);
    color: var(--accent-text);
  }
  .plugin .badge.warn,
  .warn {
    color: var(--warn);
  }
  .plugin-acts {
    gap: 8px;
    align-items: center;
  }
  .plugin-acts .path {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .page {
    padding: 24px 28px;
    max-width: var(--page-max, 920px);
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  /* 大类（应用 / 项目 / 数据 / 关于）下面是一张张小卡片，每张一类设置 */
  .cat {
    margin: 14px 0 0;
    font-size: 15px;
    color: var(--text-2);
    letter-spacing: 0.02em;
  }
  .groups {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .group {
    padding: 14px 18px 4px;
  }
  .group.about {
    padding-bottom: 14px;
  }
  .group h3 {
    display: flex;
    align-items: center;
    gap: 7px;
    margin: 0 0 12px;
    font-size: 14px;
  }
  .group h3 :global(svg) {
    color: var(--accent-text);
  }
  .group > .row {
    margin-bottom: 10px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    column-gap: 20px;
  }
  .wide {
    grid-column: 1 / -1;
  }
  .check {
    gap: 8px;
    margin-bottom: 12px;
  }
  /* 关于：整套标志（图标 + Qonlang + 千语集） */
  .lockup {
    margin: 10px 0 16px;
    color: var(--brand-mark);
    line-height: 0;
  }
  .lockup :global(svg) {
    height: 52px;
    max-width: 100%;
    width: auto;
  }
  .versions .newer {
    color: var(--accent-text);
    font-weight: 600;
  }
  .update-now {
    margin: 4px 0 10px;
  }
  .update-now {
    gap: 10px;
    flex-wrap: wrap;
  }
  .update-now .bad {
    color: var(--danger);
  }
</style>
