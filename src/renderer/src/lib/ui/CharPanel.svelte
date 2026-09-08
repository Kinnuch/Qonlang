<script lang="ts">
  /**
   * 全局字符面板：浮在所有页面之上，点符号插到最后聚焦的输入框光标处。
   */
  import { chars } from '$lib/state/chars.svelte'
  import { ui } from '$lib/state/ui.svelte'
  import { projectState } from '$lib/state/project.svelte'
  import { i18n, t } from '$lib/i18n/index.svelte'
  import {
    PLACES,
    MANNERS,
    PULMONIC,
    OTHER_PULMONIC,
    NON_PULMONIC,
    HEIGHTS,
    BACKNESS,
    VOWELS,
    OTHER_VOWELS,
    DIACRITICS,
    SUPRASEGMENTALS,
    TONES,
    SYMBOLS,
    LATIN_EXTRA,
    allSymbols,
    symbolInfo,
    codepoints,
    consonantName,
    vowelName,
    type Sym
  } from '$lib/ipa/data'
  import { X, Search, GripHorizontal, Star, Copy, CornerDownLeft, Trash2 } from '@lucide/svelte'
  import { fontCss } from '$lib/script/fonts'

  type Tab =
    | 'pulmonic'
    | 'nonPulmonic'
    | 'vowels'
    | 'diacritics'
    | 'supra'
    | 'tones'
    | 'symbols'
    | 'latin'
    | 'compose'
    | 'recent'
    | 'saved'
    | 'project'
  const TABS: Tab[] = [
    'pulmonic',
    'nonPulmonic',
    'vowels',
    'diacritics',
    'supra',
    'tones',
    'symbols',
    'latin',
    'compose',
    'recent',
    'saved',
    'project'
  ]
  let tab = $state<Tab>('pulmonic')
  let query = $state('')
  let normalize = $state(true)

  const all = allSymbols()
  const matches = $derived.by(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const seen = new Set<string>()
    return all.filter((s) => {
      if (seen.has(s.s)) return false
      const hit = s.s === q || s.zh.toLowerCase().includes(q) || s.en.toLowerCase().includes(q)
      if (hit) seen.add(s.s)
      return hit
    })
  })

  function label(s: Sym | undefined): string {
    if (!s) return ''
    return i18n.locale === 'zh' ? `${s.zh} · ${s.en}` : `${s.en} · ${s.zh}`
  }
  function title(sym: string, info?: Sym): string {
    const i = info ?? symbolInfo(sym)
    return (i ? label(i) + '\n' : '') + codepoints(sym).join(' ')
  }
  function show(sym: Sym | string): string {
    const s = typeof sym === 'string' ? sym : sym.s
    const info = typeof sym === 'string' ? symbolInfo(sym) : sym
    return info?.combining ? '◌' + s : s
  }

  async function insert(s: string): Promise<void> {
    const ok = await chars.insert(s)
    if (!ok) ui.toast(t('chars.noTarget'))
  }
  function keepFocus(e: Event): void {
    e.preventDefault()
  }
  function onContext(e: MouseEvent, s: string): void {
    e.preventDefault()
    chars.save(s)
  }

  // 组合区
  const composed = $derived(normalize ? chars.compose.normalize('NFC') : chars.compose)
  function appendMark(s: string): void {
    chars.compose += s
  }
  async function insertComposed(): Promise<void> {
    if (!composed) return
    await insert(composed)
  }
  async function copyComposed(): Promise<void> {
    if (!composed) return
    await navigator.clipboard.writeText(composed)
    ui.toast(t('soundChanges.copied'))
  }

  // 拖动
  function startDrag(e: PointerEvent): void {
    if ((e.target as HTMLElement).closest('button')) return
    e.preventDefault()
    const sx = e.clientX
    const sy = e.clientY
    const start = { ...chars.pos }
    const move = (ev: PointerEvent): void => {
      chars.pos = {
        x: Math.max(0, Math.min(window.innerWidth - 200, start.x + ev.clientX - sx)),
        y: Math.max(0, Math.min(window.innerHeight - 60, start.y - (ev.clientY - sy)))
      }
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const projectPhonemes = $derived(projectState.currentLanguage?.phonemes ?? [])
  const projectScripts = $derived(
    (projectState.currentLanguage?.scripts ?? []).filter((s) => s.glyphs.length)
  )
</script>

{#snippet symButton(s: string, info: Sym | undefined, big = false)}
  <button
    class="sym"
    class:big
    title={title(s, info)}
    onmousedown={keepFocus}
    onclick={() => insert(s)}
    oncontextmenu={(e) => onContext(e, s)}>{show(info ?? s)}</button
  >
{/snippet}

{#snippet grid(items: Sym[])}
  <div class="grid">
    {#each items as s (s.s)}
      {@render symButton(s.s, s)}
    {/each}
  </div>
{/snippet}

{#if chars.open}
  <div
    class="char-panel card"
    style:left={`${chars.pos.x}px`}
    style:bottom={`${chars.pos.y}px`}
    role="dialog"
    aria-label={t('chars.title')}
  >
    <div
      class="head"
      role="toolbar"
      aria-label={t('chars.title')}
      tabindex="-1"
      onpointerdown={startDrag}
    >
      <GripHorizontal size={14} />
      <strong>{t('chars.title')}</strong>
      <label class="search row grow">
        <Search size={14} />
        <input class="input" bind:value={query} placeholder={t('chars.search')} />
      </label>
      <button
        class="btn ghost icon sm"
        onclick={() => (chars.open = false)}
        title={t('common.close')}><X size={14} /></button
      >
    </div>

    {#if query.trim()}
      <div class="body">
        {#if matches.length === 0}
          <p class="muted small">{t('common.none')}</p>
        {:else}
          <ul class="results">
            {#each matches as s (s.s)}
              <li>
                {@render symButton(s.s, s)}
                <span class="small">{label(s)}</span>
                <span class="small muted mono">{codepoints(s.s).join(' ')}</span>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    {:else}
      <div class="tabs">
        {#each TABS as tb (tb)}
          <button
            class="tab"
            class:active={tab === tb}
            onmousedown={keepFocus}
            onclick={() => (tab = tb)}>{t(`chars.tabs.${tb}`)}</button
          >
        {/each}
      </div>
      <div class="body">
        {#if tab === 'pulmonic'}
          <div class="table-wrap">
            <table class="chart">
              <thead>
                <tr
                  ><th></th>{#each PLACES as p (p.en)}<th>{i18n.locale === 'zh' ? p.zh : p.en}</th
                    >{/each}</tr
                >
              </thead>
              <tbody>
                {#each PULMONIC as row, mi (mi)}
                  <tr>
                    <th>{i18n.locale === 'zh' ? MANNERS[mi].zh : MANNERS[mi].en}</th>
                    {#each row as cell, pi (pi)}
                      <td>
                        {#if cell[0]}{@render symButton(cell[0], {
                            s: cell[0],
                            ...consonantName(mi, pi, false)
                          })}{:else}<span class="ph"></span>{/if}
                        {#if cell[1]}{@render symButton(cell[1], {
                            s: cell[1],
                            ...consonantName(mi, pi, true)
                          })}{:else}<span class="ph"></span>{/if}
                      </td>
                    {/each}
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
          <h4>{t('chars.others')}</h4>
          {@render grid(OTHER_PULMONIC)}
        {:else if tab === 'nonPulmonic'}
          {#each NON_PULMONIC as g (g.en)}
            <h4>{i18n.locale === 'zh' ? g.zh : g.en}</h4>
            {@render grid(g.items)}
          {/each}
        {:else if tab === 'vowels'}
          <div class="table-wrap">
            <table class="chart">
              <thead>
                <tr
                  ><th></th>{#each BACKNESS as b (b.en)}<th>{i18n.locale === 'zh' ? b.zh : b.en}</th
                    >{/each}</tr
                >
              </thead>
              <tbody>
                {#each VOWELS as row, hi (hi)}
                  <tr>
                    <th>{i18n.locale === 'zh' ? HEIGHTS[hi].zh : HEIGHTS[hi].en}</th>
                    {#each row as cell, bi (bi)}
                      <td>
                        {#if cell[0]}{@render symButton(cell[0], {
                            s: cell[0],
                            ...vowelName(hi, bi, false)
                          })}{:else}<span class="ph"></span>{/if}
                        {#if cell[1]}{@render symButton(cell[1], {
                            s: cell[1],
                            ...vowelName(hi, bi, true)
                          })}{:else}<span class="ph"></span>{/if}
                      </td>
                    {/each}
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
          <p class="small muted">{t('chars.unrounded')} · {t('chars.rounded')}</p>
          <h4>{t('chars.others')}</h4>
          {@render grid(OTHER_VOWELS)}
        {:else if tab === 'diacritics'}
          <div class="grid labeled">
            {#each DIACRITICS as s (s.s)}
              <div class="cell">
                {@render symButton(s.s, s)}
                <span class="small muted">{i18n.locale === 'zh' ? s.zh : s.en}</span>
              </div>
            {/each}
          </div>
        {:else if tab === 'supra'}
          <div class="grid labeled">
            {#each SUPRASEGMENTALS as s (s.s)}
              <div class="cell">
                {@render symButton(s.s, s)}<span class="small muted"
                  >{i18n.locale === 'zh' ? s.zh : s.en}</span
                >
              </div>
            {/each}
          </div>
        {:else if tab === 'tones'}
          <div class="grid labeled">
            {#each TONES as s (s.s)}
              <div class="cell">
                {@render symButton(s.s, s)}<span class="small muted"
                  >{i18n.locale === 'zh' ? s.zh : s.en}</span
                >
              </div>
            {/each}
          </div>
        {:else if tab === 'symbols'}
          <div class="grid labeled">
            {#each SYMBOLS as s (s.s)}
              <div class="cell">
                {@render symButton(s.s, s)}<span class="small muted"
                  >{i18n.locale === 'zh' ? s.zh : s.en}</span
                >
              </div>
            {/each}
          </div>
        {:else if tab === 'latin'}
          {#each LATIN_EXTRA as g (g.en)}
            <h4>{i18n.locale === 'zh' ? g.zh : g.en}</h4>
            <div class="grid">
              {#each g.items as s, i (s + i)}{@render symButton(s, undefined)}{/each}
            </div>
          {/each}
        {:else if tab === 'compose'}
          <div class="compose">
            <label class="f">
              <span>{t('chars.composeBase')}</span>
              <input class="input data" bind:value={chars.compose} />
            </label>
            <div class="preview">
              <span class="glyph data">{composed || '◌'}</span>
              <div class="cps">
                <span class="small muted">{t('chars.codepoints')}</span>
                {#each Array.from(composed) as c, i (i)}
                  <span class="cp small"
                    ><span class="mono">{codepoints(c)[0]}</span>
                    {symbolInfo(c)
                      ? i18n.locale === 'zh'
                        ? symbolInfo(c)!.zh
                        : symbolInfo(c)!.en
                      : ''}</span
                  >
                {/each}
              </div>
            </div>
            <div class="row">
              <button
                class="btn primary sm"
                disabled={!composed}
                onmousedown={keepFocus}
                onclick={insertComposed}><CornerDownLeft size={14} />{t('chars.insert')}</button
              >
              <button class="btn sm" disabled={!composed} onclick={copyComposed}
                ><Copy size={14} />{t('chars.copy')}</button
              >
              <button class="btn sm" disabled={!composed} onclick={() => chars.save(composed)}
                ><Star size={14} />{t('chars.saveCombo')}</button
              >
              <button class="btn ghost sm" onclick={() => (chars.compose = '')}
                >{t('chars.clear')}</button
              >
              <label class="row small muted grow" style="justify-content:flex-end"
                ><input type="checkbox" bind:checked={normalize} />{t('chars.normalize')}</label
              >
            </div>
            <p class="small muted">{t('chars.composeHint')}</p>
            <div class="grid labeled">
              {#each DIACRITICS as s (s.s)}
                <div class="cell">
                  <button class="sym" title={title(s.s, s)} onclick={() => appendMark(s.s)}
                    >{show(s)}</button
                  >
                  <span class="small muted">{i18n.locale === 'zh' ? s.zh : s.en}</span>
                </div>
              {/each}
              {#each TONES.filter((x) => x.combining) as s (s.s)}
                <div class="cell">
                  <button class="sym" title={title(s.s, s)} onclick={() => appendMark(s.s)}
                    >{show(s)}</button
                  >
                  <span class="small muted">{i18n.locale === 'zh' ? s.zh : s.en}</span>
                </div>
              {/each}
              <div class="cell">
                <button class="sym" onclick={() => appendMark('ː')}>ː</button><span
                  class="small muted">{i18n.locale === 'zh' ? '长' : 'long'}</span
                >
              </div>
            </div>
          </div>
        {:else if tab === 'recent'}
          {#if ui.prefs.recentSymbols.length === 0}
            <p class="muted small">{t('chars.recentEmpty')}</p>
          {:else}
            <div class="grid">
              {#each ui.prefs.recentSymbols as s (s)}{@render symButton(s, undefined)}{/each}
            </div>
          {/if}
        {:else if tab === 'saved'}
          {#if ui.prefs.savedSymbols.length === 0}
            <p class="muted small">{t('chars.savedEmpty')}</p>
          {:else}
            <div class="grid">
              {#each ui.prefs.savedSymbols as s (s)}
                <span class="saved">
                  {@render symButton(s, undefined)}
                  <button class="rm" title={t('chars.removeSaved')} onclick={() => chars.unsave(s)}
                    ><Trash2 size={11} /></button
                  >
                </span>
              {/each}
            </div>
          {/if}
        {:else if tab === 'project'}
          {#if projectPhonemes.length === 0 && projectScripts.length === 0}
            <p class="muted small">{t('chars.projectEmpty')}</p>
          {:else}
            {#if projectPhonemes.length}
              <p class="small muted">{t('chars.projectPhonemes')}</p>
              <div class="grid">
                {#each projectPhonemes as p (p.id)}{@render symButton(p.symbol, undefined)}{/each}
              </div>
            {/if}
            {#each projectScripts as sc (sc.id)}
              <p class="small muted">{t('chars.projectScript')} · {sc.name}</p>
              <div class="grid" style={fontCss(sc)}>
                {#each sc.glyphs as g (g.id)}
                  <button
                    class="sym"
                    title={[g.value, g.name].filter(Boolean).join(' · ')}
                    onmousedown={keepFocus}
                    onclick={() => insert(g.char)}
                    oncontextmenu={(e) => onContext(e, g.char)}>{g.char}</button
                  >
                {/each}
              </div>
            {/each}
          {/if}
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .char-panel {
    position: fixed;
    z-index: 60;
    width: 640px;
    height: 460px;
    min-width: 380px;
    min-height: 260px;
    max-width: calc(100vw - 80px);
    max-height: calc(100vh - 40px);
    resize: both;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    box-shadow: var(--shadow-lg);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px 6px 10px;
    border-bottom: 1px solid var(--border);
    cursor: move;
    user-select: none;
    color: var(--text-2);
  }
  .head strong {
    color: var(--text);
  }
  .search {
    gap: 6px;
    cursor: default;
  }
  .search .input {
    padding: 3px 8px;
  }
  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
    padding: 6px 8px 0;
  }
  .tab {
    border: 0;
    background: transparent;
    padding: 3px 8px;
    border-radius: var(--radius-sm);
    font-size: 12px;
    color: var(--text-2);
    cursor: pointer;
  }
  .tab:hover {
    background: var(--bg-hover);
  }
  .tab.active {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .body {
    flex: 1;
    overflow: auto;
    padding: 8px 10px 12px;
  }
  h4 {
    margin: 10px 0 4px;
    font-size: 12px;
    color: var(--text-2);
  }
  .sym {
    min-width: 34px;
    height: 32px;
    padding: 0 6px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-elev);
    font-family: var(--font-data);
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
  }
  .sym:hover {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .sym:active {
    transform: translateY(1px);
  }
  .grid {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .grid.labeled {
    gap: 6px 10px;
  }
  .cell {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 150px;
  }
  .cell .small {
    max-width: 120px;
    line-height: 1.2;
  }
  .table-wrap {
    overflow-x: auto;
  }
  .chart {
    border-collapse: collapse;
    font-size: 11px;
  }
  .chart th {
    font-weight: 500;
    color: var(--text-2);
    padding: 2px 4px;
    text-align: left;
    white-space: nowrap;
  }
  .chart thead th {
    text-align: center;
    border-bottom: 1px solid var(--border);
  }
  .chart td {
    padding: 2px 3px;
    white-space: nowrap;
    border-bottom: 1px solid var(--border);
  }
  .chart td .sym {
    min-width: 30px;
    height: 28px;
    font-size: 17px;
    padding: 0 3px;
  }
  .ph {
    display: inline-block;
    width: 30px;
  }
  .results {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .results li {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .mono {
    font-family: var(--font-mono);
  }
  .compose {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .f {
    display: flex;
    flex-direction: column;
    gap: 3px;
    max-width: 320px;
  }
  .f > span {
    font-size: 12px;
    color: var(--text-2);
  }
  .preview {
    display: flex;
    gap: 16px;
    align-items: center;
  }
  .glyph {
    font-size: 48px;
    line-height: 1;
    min-width: 72px;
    text-align: center;
    padding: 8px;
    border: 1px dashed var(--border);
    border-radius: var(--radius);
  }
  .cps {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .saved {
    position: relative;
    display: inline-block;
  }
  .saved .rm {
    position: absolute;
    top: -6px;
    right: -6px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    border: 1px solid var(--border);
    background: var(--bg-elev);
    display: none;
    place-items: center;
    padding: 0;
    cursor: pointer;
    color: var(--danger);
  }
  .saved:hover .rm {
    display: grid;
  }
</style>
