<script lang="ts">
  /**
   * 界面翻译（自带插件）：把软件里所有能翻的文案按模块列出来逐条翻，
   * 翻好的作为一种新的界面语言出现在语言选单里。译文存在本机偏好（prefs.uiLocales），不进项目文件。
   */
  import { ui } from '$lib/state/ui.svelte'
  import {
    i18n,
    t,
    LOCALES,
    localeDict,
    type CustomLocale,
    type LocaleCode
  } from '$lib/i18n/index.svelte'
  import { allTextEntries, flattenDict, groupsOf, paramsMatch } from '$lib/i18n/keys'
  import { fontLibrary } from '$lib/state/fonts.svelte'
  import { platform } from '$lib/platform'
  import GuideLink from '$lib/ui/GuideLink.svelte'
  import HelpDot from '$lib/ui/HelpDot.svelte'
  import { flashOn } from '$lib/ui/flash'
  import { Plus, Trash2, Upload, Download, Check, X, Image as ImageIcon } from '@lucide/svelte'
  import type { PageView } from '$lib/state/ui.svelte'

  let { inspectorTitle = $bindable('') }: { inspectorTitle?: string } = $props()

  const memo = ui.memo<{ code: string | null; group: string; onlyTodo: string }>('uiTranslate')
  /** 正在翻的是哪一种 */
  let code = $state<string | null>(memo.code ?? null)
  let group = $state<string>(memo.group ?? '')
  let onlyTodo = $state(memo.onlyTodo === '1')
  /** 只看原文改过、译文可能跟不上的那几条 */
  let onlyStale = $state(false)
  let query = $state('')
  /** 原文用哪种语言显示（默认跟着这一种的兜底语言） */
  let sourceLocale = $state<LocaleCode | ''>('')
  let adding = $state(false)

  const list = $derived(ui.prefs.uiLocales ?? [])
  const current = $derived(list.find((l) => l.code === code) ?? null)
  const entries = allTextEntries()
  const groups = groupsOf(entries)

  /** 原文：默认是这一种的兜底语言，用户也可以挑另一种对照着翻 */
  const sourceDict = $derived.by(() =>
    flattenDict(localeDict((sourceLocale || current?.base || 'zh') as LocaleCode))
  )

  const shown = $derived.by(() => {
    const q = query.trim().toLowerCase()
    return entries.filter((e) => {
      if (group && e.group !== group) return false
      if (onlyTodo && current?.values[e.key]?.trim()) return false
      if (onlyStale && !staleOf(e.key, e.source)) return false
      if (!q) return true
      const src = sourceDict[e.key] ?? e.source
      return (
        e.key.toLowerCase().includes(q) ||
        src.toLowerCase().includes(q) ||
        (current?.values[e.key] ?? '').toLowerCase().includes(q)
      )
    })
  })
  const doneCount = $derived(
    current ? entries.filter((e) => current.values[e.key]?.trim()).length : 0
  )
  /**
   * 这一条的原文在译完之后改过没有（软件更新改了文案）：改过就给出当时的原文，没改过给 null。
   * 译文写下时记了当时的简体原文（seen），跟现在的比
   */
  function staleOf(key: string, source: string): string | null {
    if (!current?.values[key]?.trim()) return null
    const was = current.seen?.[key]
    return was !== undefined && was !== source ? was : null
  }
  const staleCount = $derived(
    current ? entries.filter((e) => staleOf(e.key, e.source) !== null).length : 0
  )

  // 新建表单
  let form = $state({
    name: '',
    base: 'zh' as LocaleCode,
    rtl: false,
    script: 'latin',
    font: '',
    wordmarkText: '',
    wordmarkImage: ''
  })

  function newCode(name: string): string {
    const slug =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 12) || 'lang'
    let c = `x-${slug}`
    for (let i = 2; list.some((l) => l.code === c); i++) c = `x-${slug}-${i}`
    return c
  }

  async function create(): Promise<void> {
    const name = form.name.trim()
    if (!name) return
    const made: CustomLocale = {
      code: newCode(name),
      name,
      base: form.base,
      rtl: form.rtl,
      font: form.script === 'font' ? form.font.trim() : '',
      wordmarkText: form.wordmarkText.trim(),
      wordmarkImage: form.wordmarkImage,
      values: {},
      seen: {}
    }
    ui.prefs.uiLocales = [...list, made]
    await ui.savePrefs()
    code = made.code
    adding = false
    form = {
      name: '',
      base: 'zh',
      rtl: false,
      script: 'latin',
      font: '',
      wordmarkText: '',
      wordmarkImage: ''
    }
    ui.toast(t('uiTranslate.created', { name }))
  }

  /** 改一条译文：存在偏好里，界面立刻跟着变（正用着这一种的话） */
  function setValue(key: string, value: string, source: string): void {
    if (!current) return
    const next = list.map((l) =>
      l.code === current.code
        ? {
            ...l,
            values: { ...l.values, [key]: value },
            seen: { ...(l.seen ?? {}), [key]: source }
          }
        : l
    )
    ui.prefs.uiLocales = next
    i18n.setCustomLocales($state.snapshot(next))
    ui.savePrefsSoon()
  }

  function patch(p: Partial<CustomLocale>): void {
    if (!current) return
    const next = list.map((l) => (l.code === current.code ? { ...l, ...p } : l))
    ui.prefs.uiLocales = next
    i18n.setCustomLocales($state.snapshot(next))
    ui.savePrefsSoon()
  }

  async function remove(): Promise<void> {
    if (!current) return
    if (!(await ui.confirm(t('uiTranslate.deleteConfirm', { name: current.name })))) return
    const gone = current.code
    ui.prefs.uiLocales = list.filter((l) => l.code !== gone)
    if (ui.prefs.locale === gone) ui.prefs.locale = current.base
    code = null
    await ui.savePrefs()
  }

  /** 用这一种看看：直接切过去（不喜欢再切回来） */
  async function useIt(): Promise<void> {
    if (!current) return
    ui.prefs.locale = current.code
    await ui.savePrefs()
  }

  async function exportFile(): Promise<void> {
    if (!current) return
    const doc = {
      qonlangUiLocale: 1,
      name: current.name,
      base: current.base,
      rtl: current.rtl,
      font: current.font ?? '',
      wordmarkText: current.wordmarkText ?? '',
      wordmarkImage: current.wordmarkImage ?? '',
      values: current.values,
      seen: current.seen ?? {}
    }
    await platform.saveTextFile(
      `${current.name || current.code}.qonlang-ui.json`,
      JSON.stringify(doc, null, 1)
    )
  }

  async function importFile(): Promise<void> {
    const [got] = await platform.readTextFiles({ multiple: false, extensions: ['json'] })
    if (!got) return
    try {
      const doc = JSON.parse(got.content) as Partial<CustomLocale> & { qonlangUiLocale?: number }
      if (!doc.values || typeof doc.values !== 'object') throw new Error('values')
      const name = (doc.name || t('uiTranslate.untitled')).toString()
      const made: CustomLocale = {
        code: newCode(name),
        name,
        base: (LOCALES.some((l) => l.code === doc.base) ? doc.base : 'zh') as LocaleCode,
        rtl: !!doc.rtl,
        font: typeof doc.font === 'string' ? doc.font : '',
        wordmarkText: typeof doc.wordmarkText === 'string' ? doc.wordmarkText : '',
        wordmarkImage:
          typeof doc.wordmarkImage === 'string' && doc.wordmarkImage.startsWith('data:image/')
            ? doc.wordmarkImage
            : '',
        // 只收还在用的键，免得旧文件把不存在的条目带进来
        values: Object.fromEntries(
          entries.map((e) => [e.key, String((doc.values as Record<string, unknown>)[e.key] ?? '')])
        ),
        seen:
          doc.seen && typeof doc.seen === 'object'
            ? Object.fromEntries(
                entries
                  .filter((e) => typeof (doc.seen as Record<string, unknown>)[e.key] === 'string')
                  .map((e) => [e.key, (doc.seen as Record<string, string>)[e.key]])
              )
            : {}
      }
      ui.prefs.uiLocales = [...list, made]
      await ui.savePrefs()
      code = made.code
      ui.toast(
        t('uiTranslate.imported', { name, n: Object.values(made.values).filter(Boolean).length })
      )
    } catch {
      ui.error(t('uiTranslate.importBad'))
    }
  }

  /** 字标换成一张图：PNG / SVG / JPG / WebP，存成 data URL（太大的不收，免得偏好文件撑得很大） */
  async function pickWordmark(): Promise<string | null> {
    const [f] = await platform.readBinaryFiles({
      multiple: false,
      extensions: ['png', 'svg', 'jpg', 'jpeg', 'webp']
    })
    if (!f) return null
    if (f.base64.length > 400_000) {
      ui.error(t('uiTranslate.wordmarkTooBig'))
      return null
    }
    const ext = f.name.split('.').pop()?.toLowerCase() ?? 'png'
    const mime =
      ext === 'svg'
        ? 'image/svg+xml'
        : ext === 'jpg' || ext === 'jpeg'
          ? 'image/jpeg'
          : `image/${ext}`
    return `data:${mime};base64,${f.base64}`
  }

  // 只有一份（或者刚进页面还没挑）时直接摊开第一份，免得进来一片空白
  $effect(() => {
    if (!current && list.length) code = list[0].code
  })
  $effect(() => {
    inspectorTitle = t('uiTranslate.title')
  })
  $effect(() => {
    ui.reportView('uiTranslate', { kind: 'locale', id: code, group } as PageView)
  })
  $effect(() => {
    Object.assign(memo, { code, group, onlyTodo: onlyTodo ? '1' : '' })
  })
</script>

<div class="page">
  <div class="row page-head">
    <h1>{t('uiTranslate.title')}<GuideLink section="extending" anchor="ui-translate" /></h1>
    <span class="badge">{t('uiTranslate.builtin')}</span>
    <div class="grow"></div>
    <button class="btn sm" onclick={() => void importFile()}
      ><Upload size={13} />{t('io.import')}</button
    >
    <button class="btn sm primary" onclick={() => (adding = true)}
      ><Plus size={13} />{t('uiTranslate.add')}</button
    >
  </div>
  <p class="small muted">{t('uiTranslate.hint')}</p>

  {#if adding}
    <div class="card form" use:flashOn={{ key: 'new' }}>
      <div class="field">
        <label for="tl-name">{t('uiTranslate.name')}</label>
        <input
          id="tl-name"
          class="input"
          bind:value={form.name}
          placeholder={t('uiTranslate.namePlaceholder')}
        />
      </div>
      <div class="grid2">
        <div class="field">
          <label for="tl-base"
            >{t('uiTranslate.base')}<HelpDot tip={t('uiTranslate.baseHint')} /></label
          >
          <select id="tl-base" class="select" bind:value={form.base}>
            {#each LOCALES as l (l.code)}<option value={l.code}>{l.label}</option>{/each}
          </select>
        </div>
        <div class="field">
          <label for="tl-script"
            >{t('uiTranslate.script')}<HelpDot tip={t('uiTranslate.scriptHint')} /></label
          >
          <select id="tl-script" class="select" bind:value={form.script}>
            <option value="latin">{t('uiTranslate.scriptLatin')}</option>
            <option value="font">{t('uiTranslate.scriptCustom')}</option>
          </select>
        </div>
      </div>
      {#if form.script === 'font'}
        <div class="field">
          <label for="tl-font">{t('uiTranslate.font')}</label>
          <input
            id="tl-font"
            class="input"
            list="tl-fonts"
            bind:value={form.font}
            placeholder={t('uiTranslate.fontPlaceholder')}
          />
          <datalist id="tl-fonts">
            {#each fontLibrary.fonts as f (f.file)}<option value={f.family}></option>{/each}
          </datalist>
        </div>
      {/if}
      <label class="row check"
        ><input type="checkbox" bind:checked={form.rtl} />{t('uiTranslate.rtl')}<HelpDot
          tip={t('uiTranslate.rtlHint')}
        /></label
      >
      <div class="field">
        <label for="tl-wordmark"
          >{t('uiTranslate.wordmark')}<HelpDot tip={t('uiTranslate.wordmarkHint')} /></label
        >
        <div class="row wrap wm-row">
          <input
            id="tl-wordmark"
            class="input wm-text"
            bind:value={form.wordmarkText}
            placeholder={t('uiTranslate.wordmarkPlaceholder')}
            style={form.script === 'font' && form.font ? `font-family: "${form.font}"` : ''}
          />
          <button
            class="btn sm"
            onclick={async () => {
              const img = await pickWordmark()
              if (img) form.wordmarkImage = img
            }}><ImageIcon size={13} />{t('uiTranslate.wordmarkImage')}</button
          >
          {#if form.wordmarkImage}
            <img class="wm-preview" src={form.wordmarkImage} alt="" />
            <button
              class="btn ghost icon sm"
              title={t('uiTranslate.wordmarkClear')}
              onclick={() => (form.wordmarkImage = '')}><X size={13} /></button
            >
          {/if}
        </div>
      </div>
      <div class="row">
        <button class="btn primary sm" onclick={() => void create()} disabled={!form.name.trim()}
          >{t('common.new')}</button
        >
        <button class="btn sm" onclick={() => (adding = false)}>{t('common.cancel')}</button>
      </div>
    </div>
  {/if}

  {#if !list.length && !adding}
    <p class="muted">{t('uiTranslate.empty')}</p>
  {:else if list.length}
    <div class="row wrap picks">
      {#each list as l (l.code)}
        <button class="btn sm" class:active={l.code === code} onclick={() => (code = l.code)}>
          {l.name}
          <span class="tiny muted"
            >{Object.values(l.values).filter(Boolean).length}/{entries.length}</span
          >
        </button>
      {/each}
    </div>
  {/if}

  {#if current}
    <div class="row wrap tools">
      <input
        class="input name"
        value={current.name}
        oninput={(e) => patch({ name: (e.currentTarget as HTMLInputElement).value })}
      />
      <span class="badge">{current.code}</span>
      <label class="row small check"
        ><input
          type="checkbox"
          checked={current.rtl}
          onchange={(e) => patch({ rtl: (e.currentTarget as HTMLInputElement).checked })}
        />{t('uiTranslate.rtl')}</label
      >
      <label class="row small"
        >{t('uiTranslate.font')}
        <input
          class="input auto"
          list="tl-fonts-cur"
          value={current.font ?? ''}
          placeholder={t('uiTranslate.scriptLatin')}
          oninput={(e) => patch({ font: (e.currentTarget as HTMLInputElement).value })}
        />
        <datalist id="tl-fonts-cur">
          {#each fontLibrary.fonts as f (f.file)}<option value={f.family}></option>{/each}
        </datalist>
      </label>
      <span class="small muted"
        >{t('uiTranslate.progress', { done: doneCount, total: entries.length })}</span
      >
      <div class="grow"></div>
      {#if ui.prefs.locale !== current.code}
        <button class="btn sm" onclick={() => void useIt()}
          ><Check size={13} />{t('uiTranslate.use')}</button
        >
      {/if}
      <button class="btn sm" onclick={() => void exportFile()}
        ><Download size={13} />{t('common.export')}</button
      >
      <button class="btn sm danger" onclick={() => void remove()}
        ><Trash2 size={13} />{t('common.delete')}</button
      >
    </div>

    <div class="row wrap tools">
      <span class="small muted"
        >{t('uiTranslate.wordmark')}<HelpDot tip={t('uiTranslate.wordmarkHint')} /></span
      >
      <input
        class="input wm-text"
        value={current.wordmarkText ?? ''}
        placeholder={t('uiTranslate.wordmarkPlaceholder')}
        style={current.font ? `font-family: "${current.font}"` : ''}
        oninput={(e) => patch({ wordmarkText: (e.currentTarget as HTMLInputElement).value })}
      />
      <button
        class="btn sm"
        onclick={async () => {
          const img = await pickWordmark()
          if (img) patch({ wordmarkImage: img })
        }}><ImageIcon size={13} />{t('uiTranslate.wordmarkImage')}</button
      >
      {#if current.wordmarkImage}
        <img class="wm-preview" src={current.wordmarkImage} alt="" />
        <button
          class="btn ghost icon sm"
          title={t('uiTranslate.wordmarkClear')}
          onclick={() => patch({ wordmarkImage: '' })}><X size={13} /></button
        >
      {/if}
    </div>

    <div class="row wrap tools">
      <input class="input find" bind:value={query} placeholder={t('uiTranslate.search')} />
      <label class="row small"
        >{t('uiTranslate.showSource')}
        <select
          class="select auto"
          value={sourceLocale || current.base}
          onchange={(e) =>
            (sourceLocale = (e.currentTarget as HTMLSelectElement).value as LocaleCode)}
        >
          {#each LOCALES as l (l.code)}<option value={l.code}>{l.label}</option>{/each}
        </select>
      </label>
      <label class="row small check"
        ><input type="checkbox" bind:checked={onlyTodo} />{t('uiTranslate.onlyTodo')}</label
      >
      {#if staleCount}
        <label class="row small check stale-filter"
          ><input type="checkbox" bind:checked={onlyStale} />{t('uiTranslate.onlyStale', {
            n: staleCount
          })}</label
        >
      {/if}
    </div>

    <div class="split">
      <aside class="groups">
        <button class="grp" class:on={!group} onclick={() => (group = '')}>
          {t('uiTranslate.allGroups')}<span class="tiny muted">{entries.length}</span>
        </button>
        {#each groups as g (g.group)}
          {@const done = entries.filter(
            (e) => e.group === g.group && current.values[e.key]?.trim()
          ).length}
          {@const label = t(`uiTranslate.groups.${g.group}`)}
          {@const named = label !== `uiTranslate.groups.${g.group}`}
          <button class="grp" class:on={group === g.group} onclick={() => (group = g.group)}>
            <!-- 没起名字的那些小类就写键名本身（mcp、csv 这种），看着像键名才不会以为是漏译 -->
            <span class="grow" class:raw={!named}>{named ? label : g.group}</span>
            <span class="tiny muted">{done}/{g.count}</span>
          </button>
        {/each}
      </aside>

      <div class="rows">
        {#if !shown.length}
          <p class="small muted">{t('uiTranslate.noneShown')}</p>
        {/if}
        {#each shown.slice(0, 400) as e (e.key)}
          {@const value = current.values[e.key] ?? ''}
          {@const was = staleOf(e.key, e.source)}
          <div class="tl card" class:stale={was !== null}>
            <div class="src">
              <span class="tiny muted key">{e.key}</span>
              <span class="text">{sourceDict[e.key] ?? e.source}</span>
              {#if was !== null}
                <span class="row stale-row">
                  <span class="tiny warn" title={t('uiTranslate.staleWas', { text: was })}
                    >{t('uiTranslate.stale')}</span
                  >
                  <!-- 原文改了但译文照样对：只记下现在的原文，译文不动 -->
                  <button
                    class="btn sm"
                    title={t('uiTranslate.staleKeepHint')}
                    onclick={() => setValue(e.key, value, e.source)}
                    >{t('uiTranslate.staleKeep')}</button
                  >
                </span>
              {/if}
            </div>
            <div class="to">
              <input
                class="input"
                dir={current.rtl ? 'rtl' : 'auto'}
                style={current.font ? `font-family: "${current.font}"` : ''}
                {value}
                oninput={(ev) =>
                  setValue(e.key, (ev.currentTarget as HTMLInputElement).value, e.source)}
                placeholder={e.source}
              />
              {#if !paramsMatch(e.source, value)}
                <span class="tiny warn"
                  >{t('uiTranslate.paramsOff', { list: e.params.join(' ') })}</span
                >
              {/if}
            </div>
          </div>
        {/each}
        {#if shown.length > 400}
          <p class="small muted">{t('uiTranslate.more', { n: shown.length - 400 })}</p>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: 10px;
    height: 100%;
    min-height: 0;
    padding: 16px;
    overflow: hidden;
  }
  .form {
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .grid2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .picks {
    gap: 6px;
  }
  .tools {
    gap: 8px;
  }
  .find {
    max-width: 320px;
  }
  .name {
    width: 160px;
  }
  .input.auto {
    width: 140px;
  }
  .select.auto {
    width: auto;
  }
  .check {
    gap: 6px;
  }
  .split {
    display: grid;
    grid-template-columns: 200px 1fr;
    gap: 12px;
    flex: 1;
    min-height: 0;
  }
  .groups {
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow: auto;
    padding-inline-end: 4px;
  }
  .grp {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 5px 8px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: none;
    cursor: pointer;
    text-align: start;
  }
  .grp:hover {
    background: var(--bg-hover);
  }
  .grp.on {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .raw {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-2);
  }
  .rows {
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-inline-end: 4px;
  }
  .tl {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    padding: 8px 10px;
    align-items: center;
  }
  .src {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .src .text {
    white-space: pre-wrap;
  }
  .key {
    font-family: var(--font-mono);
  }
  .to {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .warn {
    color: var(--warn);
  }
  .tl.stale {
    border-color: var(--warn);
  }
  .stale-row {
    gap: 8px;
  }
  .stale-row .btn {
    padding-block: 0;
  }
  .wm-row {
    gap: 6px;
  }
  .input.wm-text {
    width: 200px;
  }
  .wm-preview {
    height: 28px;
    max-width: 180px;
    object-fit: contain;
    border: 1px dashed var(--border);
    border-radius: var(--radius-sm);
    padding: 2px;
    background: var(--bg-elev);
  }
</style>
