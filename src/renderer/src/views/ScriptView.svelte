<script lang="ts">
  /** 文字：字形表 / 映射规则 / 预览；字体导入与内嵌；检视器编辑字形或文字属性并试写。 */
  import { projectState } from '$lib/state/project.svelte'
  import { ui } from '$lib/state/ui.svelte'
  import { t, pickText } from '$lib/i18n/index.svelte'
  import { platform } from '$lib/platform'
  import { createScript, newId } from '$lib/core/factory'
  import type { Glyph, Script, ScriptType } from '$lib/core/model'
  import { parseFont, guessCategory } from '$lib/script/fontParse'
  import { ensureScriptFont, fontCss, fontDataUrl, base64ToBuffer } from '$lib/script/fonts'
  import { autoMappingLines, expandRules, renderScript } from '$lib/script/render'
  import { parseRuleText, runRules, type RuleProgram } from '$lib/engine/sca'
  import { languageParseOptions } from '$lib/engine/phon'
  import Portal from '$lib/ui/Portal.svelte'
  import Hint from '$lib/ui/Hint.svelte'
  import RuleList from '$lib/ui/RuleList.svelte'
  import RuleEditor from '$lib/ui/RuleEditor.svelte'
  import { flashOn } from '$lib/ui/flash'
  import {
    Plus,
    Trash2,
    Upload,
    FileType,
    ClipboardPaste,
    Wand2,
    List,
    Code,
    X
  } from '@lucide/svelte'
  import GuideLink from '$lib/ui/GuideLink.svelte'

  let { inspectorTitle = $bindable('') }: { inspectorTitle?: string } = $props()

  const project = $derived(projectState.project!)
  const glossLangs = $derived(project.settings.glossLanguages)
  const lang = $derived(
    projectState.currentLanguage ??
      project.languages.find((l) => l.id === project.settings.defaultLanguageId) ??
      project.languages[0] ??
      null
  )

  type Tab = 'glyphs' | 'rules' | 'preview'
  const TABS: Tab[] = ['glyphs', 'rules', 'preview']
  const TYPES: ScriptType[] = [
    'alphabet',
    'abjad',
    'abugida',
    'syllabary',
    'logographic',
    'featural',
    'mixed',
    'other'
  ]
  const BUILTIN_CATS = [
    'letter',
    'vowel',
    'consonant',
    'syllable',
    'mark',
    'number',
    'punct',
    'glyph',
    'space',
    'other'
  ]
  let tab = $state<Tab>('glyphs')
  let selectedScript = $state<string | null>(null)
  let selectedGlyph = $state<string | null>(null)
  /** Ctrl / Shift 多选出来的字形 */
  let multiGlyphs = $state<string[]>([])
  let lastGlyphIndex = $state(-1)
  let catFilter = $state<string>('')
  let rulesView = $state<'list' | 'source'>('list')
  let pasteOpen = $state(false)
  let pasteText = $state('')
  let testText = $state('')
  let importedFlash = $state(0)

  const script = $derived(
    lang?.scripts.find((s) => s.id === selectedScript) ?? lang?.scripts[0] ?? null
  )
  const glyph = $derived(script?.glyphs.find((g) => g.id === selectedGlyph) ?? null)
  const categories = $derived.by(() => {
    const set = new Set<string>()
    for (const g of script?.glyphs ?? []) if (g.category) set.add(g.category)
    return [
      ...BUILTIN_CATS.filter((c) => set.has(c)),
      ...[...set].filter((c) => !BUILTIN_CATS.includes(c)).sort()
    ]
  })
  const shownGlyphs = $derived(
    (script?.glyphs ?? []).filter((g) => !catFilter || g.category === catFilter)
  )
  const catLabel = (c: string): string =>
    BUILTIN_CATS.includes(c) ? t(`script.categories.${c}`) : c

  $effect(() => {
    inspectorTitle =
      glyph && tab === 'glyphs' ? glyph.char : script ? script.name : t('script.title')
  })
  $effect(() => {
    if (script) ensureScriptFont(script)
  })

  // 规则程序（防抖）
  let program = $state<RuleProgram | null>(null)
  $effect(() => {
    if (!lang || !script) {
      program = null
      return
    }
    const text = expandRules(script)
    const opts = languageParseOptions(lang, project)
    const id = setTimeout(() => (program = parseRuleText(text, opts)), 120)
    return () => clearTimeout(id)
  })
  const userProgram = $derived.by(() => {
    if (!lang || !script) return null
    return parseRuleText(
      script.rules.replace(/^\s*@glyphs\s*$/m, ''),
      languageParseOptions(lang, project)
    )
  })
  const autoLines = $derived(script ? autoMappingLines(script) : [])
  const testResults = $derived.by(() => {
    if (!program) return []
    return testText
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => ({ w, out: runRules(program!, w, { trace: false }).output }))
  })
  const previewLexemes = $derived(
    lang ? project.lexemes.filter((l) => l.languageId === lang.id).slice(0, 40) : []
  )
  const previewSentences = $derived(
    lang ? project.sentences.filter((s) => s.languageId === lang.id).slice(0, 10) : []
  )

  function touch(): void {
    projectState.touch()
  }
  function addScript(): void {
    if (!lang) return
    const s = createScript(t('script.newName'))
    lang.scripts.push(s)
    selectedScript = s.id
    touch()
  }
  function removeScript(s: Script): void {
    if (!lang) return
    const idx = lang.scripts.indexOf(s)
    const snap = $state.snapshot(s) as Script
    lang.scripts.splice(idx, 1)
    selectedScript = lang.scripts[0]?.id ?? null
    touch()
    ui.toast(t('script.deleted'), {
      action: {
        label: t('common.undo'),
        run: () => {
          lang!.scripts.splice(Math.min(idx, lang!.scripts.length), 0, snap)
          selectedScript = snap.id
          touch()
        }
      }
    })
  }
  function addGlyph(): void {
    if (!script) return
    const g: Glyph = {
      id: newId(),
      char: '',
      name: '',
      value: '',
      category: catFilter || 'letter',
      notes: ''
    }
    script.glyphs.push(g)
    selectedGlyph = g.id
    touch()
    queueMicrotask(() => document.getElementById('g-char')?.focus())
  }
  function pickGlyph(e: MouseEvent, g: Glyph, i: number): void {
    if (e.shiftKey && lastGlyphIndex >= 0) {
      const [a, b] = [Math.min(lastGlyphIndex, i), Math.max(lastGlyphIndex, i)]
      multiGlyphs = shownGlyphs.slice(a, b + 1).map((x) => x.id)
    } else if (e.ctrlKey || e.metaKey) {
      multiGlyphs = multiGlyphs.includes(g.id)
        ? multiGlyphs.filter((x) => x !== g.id)
        : [...multiGlyphs, g.id]
      lastGlyphIndex = i
    } else {
      multiGlyphs = []
      lastGlyphIndex = i
    }
    selectedGlyph = g.id
  }
  function removeSelectedGlyphs(): void {
    if (!script || multiGlyphs.length < 2) return
    const ids = new Set(multiGlyphs)
    const snap = $state.snapshot(script.glyphs) as Glyph[]
    script.glyphs = script.glyphs.filter((g) => !ids.has(g.id))
    if (selectedGlyph && ids.has(selectedGlyph)) selectedGlyph = null
    multiGlyphs = []
    touch()
    ui.toast(t('script.bulkDeleted', { n: ids.size }), {
      action: {
        label: t('common.undo'),
        run: () => {
          if (script) script.glyphs = snap
          touch()
        }
      }
    })
  }
  async function categorizeSelectedGlyphs(): Promise<void> {
    if (!script || !multiGlyphs.length) return
    const cat = (await ui.prompt(t('script.bulkCategoryPrompt'), ''))?.trim()
    if (cat === undefined || cat === null) return
    for (const g of script.glyphs) if (multiGlyphs.includes(g.id)) g.category = cat
    touch()
  }
  function removeGlyph(g: Glyph): void {
    if (!script) return
    script.glyphs.splice(script.glyphs.indexOf(g), 1)
    if (selectedGlyph === g.id) selectedGlyph = null
    touch()
  }
  function autoCategorize(): void {
    if (!script) return
    for (const g of script.glyphs) if (g.char) g.category = guessCategory(g.char)
    touch()
  }
  /** 合并字形：已有相同字符的不重复加 */
  function mergeGlyphs(
    items: { char: string; value?: string; name?: string; category?: string }[]
  ): number {
    if (!script) return 0
    const have = new Set(script.glyphs.map((g) => g.char))
    let n = 0
    for (const it of items) {
      if (!it.char || have.has(it.char)) continue
      have.add(it.char)
      script.glyphs.push({
        id: newId(),
        char: it.char,
        name: it.name ?? '',
        value: it.value ?? '',
        category: it.category ?? guessCategory(it.char),
        notes: ''
      })
      n++
    }
    if (n) {
      touch()
      importedFlash++
    }
    ui.toast(n ? t('script.imported', { n }) : t('script.noGlyphsInFont'))
    return n
  }
  async function importFont(readGlyphs: boolean): Promise<void> {
    if (!script) return
    const files = await platform.readBinaryFiles({
      multiple: false,
      extensions: ['ttf', 'otf', 'ttc', 'woff', 'woff2']
    })
    const f = files[0]
    if (!f) return
    const ext = f.name.toLowerCase().split('.').pop() ?? ''
    script.font = {
      family: script.font.family,
      dataUrl: fontDataUrl(f.name, f.base64),
      fileName: f.name
    }
    ensureScriptFont(script)
    touch()
    if (!readGlyphs || !['ttf', 'otf', 'ttc'].includes(ext)) return
    try {
      const parsed = parseFont(base64ToBuffer(f.base64))
      if (parsed.family && !script.font.family) script.font.family = parsed.family
      mergeGlyphs(
        parsed.glyphs
          .filter((g) => g.codepoint > 0x20 && !(g.codepoint >= 0x7f && g.codepoint <= 0xa0))
          .map((g) => ({
            char: g.char,
            name: g.name,
            value: /^[A-Za-z0-9]$/.test(g.char) ? g.char : ''
          }))
      )
    } catch (e) {
      ui.toast(String(e), { kind: 'error' })
    }
  }
  function importPaste(): void {
    const items = pasteText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [char, value = '', ...rest] = line.split(/\t+| +/)
        return { char, value, name: rest.join(' ') }
      })
    mergeGlyphs(items)
    pasteText = ''
    pasteOpen = false
  }
  async function setCategory(g: Glyph, v: string): Promise<void> {
    if (v === '__custom') {
      const name = await ui.prompt(t('script.category'))
      if (!name) return
      g.category = name.trim()
    } else g.category = v
    touch()
  }
  function clearFont(): void {
    if (!script) return
    script.font = { family: script.font.family, dataUrl: null, fileName: '' }
    touch()
  }
</script>

<div class="page">
  <div class="page-head row">
    <h1>{t('script.title')}</h1>
    <GuideLink section="script" />
    {#if lang}<span class="badge" style:background={lang.color} style:color="#fff">{lang.name}</span
      >{/if}
    {#if lang}
      <div class="row wrap chips">
        {#each lang.scripts as s (s.id)}
          <button
            class="chip big"
            class:active={script?.id === s.id}
            onclick={() => {
              selectedScript = s.id
              selectedGlyph = null
            }}>{s.name}</button
          >
        {/each}
        <button class="btn ghost sm" onclick={addScript}><Plus size={14} />{t('script.add')}</button
        >
      </div>
    {/if}
    <span class="grow"></span>
    {#if script}
      <div class="seg">
        {#each TABS as tb (tb)}<button class:active={tab === tb} onclick={() => (tab = tb)}
            >{t(`script.tabs.${tb}`)}</button
          >{/each}
      </div>
    {/if}
  </div>
  <Hint id="script" text={t('script.hint')} />

  {#if !lang}
    <p class="muted">{t('lexicon.noLanguage')}</p>
  {:else if !script}
    <p class="muted">{t('script.empty')}</p>
  {:else if tab === 'glyphs'}
    <div class="scroll">
      <div class="row wrap tools">
        <button class="btn sm" onclick={() => importFont(true)}
          ><FileType size={14} />{t('script.importFromFont')}</button
        >
        <button class="btn sm" onclick={() => (pasteOpen = !pasteOpen)}
          ><ClipboardPaste size={14} />{t('script.importText')}</button
        >
        <button class="btn ghost sm" onclick={autoCategorize}
          ><Wand2 size={14} />{t('script.autoCategorize')}</button
        >
        <span class="grow"></span>
        <button class="btn primary sm" onclick={addGlyph}
          ><Plus size={14} />{t('script.addGlyph')}</button
        >
      </div>
      {#if pasteOpen}
        <div class="card paste">
          <p class="small muted">{t('script.importTextHint')}</p>
          <textarea class="textarea data" rows="6" bind:value={pasteText}></textarea>
          <div class="row">
            <span class="grow"></span><button
              class="btn ghost sm"
              onclick={() => (pasteOpen = false)}>{t('common.cancel')}</button
            ><button class="btn primary sm" onclick={importPaste}
              >{t('script.importTextRun')}</button
            >
          </div>
        </div>
      {/if}
      {#if categories.length > 1}
        <div class="row wrap">
          <button class="chip" class:active={catFilter === ''} onclick={() => (catFilter = '')}
            >{t('script.allCategories')}</button
          >
          {#each categories as c (c)}<button
              class="chip"
              class:active={catFilter === c}
              onclick={() => (catFilter = c)}>{catLabel(c)}</button
            >{/each}
        </div>
      {/if}
      {#if multiGlyphs.length > 1}
        <div class="row bulk">
          <span class="small">{t('lexicon.selectedN', { n: multiGlyphs.length })}</span>
          <button class="btn ghost sm" onclick={categorizeSelectedGlyphs}
            >{t('script.bulkCategory')}</button
          >
          <button class="btn ghost sm danger" onclick={removeSelectedGlyphs}
            ><Trash2 size={14} />{t('common.delete')}</button
          >
          <button class="btn ghost sm" onclick={() => (multiGlyphs = [])}
            >{t('lexicon.clearSel')}</button
          >
        </div>
      {/if}
      {#if script.glyphs.length === 0}
        <p class="muted">{t('script.noGlyphs')}</p>
      {:else}
        <div class="grid" use:flashOn={importedFlash}>
          {#each shownGlyphs as g, gi (g.id)}
            <button
              class="gcard"
              class:sel={selectedGlyph === g.id || multiGlyphs.includes(g.id)}
              onclick={(e) => pickGlyph(e, g, gi)}
              title={g.name}
            >
              <span class="gchar" style={fontCss(script)}>{g.char || '·'}</span>
              <span class="gval data">{g.value || ' '}</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>
  {:else if tab === 'rules'}
    <div class="scroll">
      <div class="row">
        <p class="small muted grow">{t('script.rulesHint')}</p>
        <div class="seg">
          <button class:active={rulesView === 'list'} onclick={() => (rulesView = 'list')}
            ><List size={14} />{t('soundChanges.viewList')}</button
          >
          <button class:active={rulesView === 'source'} onclick={() => (rulesView = 'source')}
            ><Code size={14} />{t('soundChanges.viewSource')}</button
          >
        </div>
      </div>
      {#if t(`script.typeHints.${script.type}`)}
        <Hint id={`script-type-${script.type}`} text={t(`script.typeHints.${script.type}`)} />
      {/if}
      <div class="editor-area">
        {#if rulesView === 'list'}
          <RuleList bind:text={script.rules} program={userProgram} onchange={touch} />
        {:else}
          <div class="src">
            <RuleEditor
              bind:value={script.rules}
              diagnostics={program?.diagnostics ?? []}
              oninput={touch}
            />
          </div>
        {/if}
      </div>
      <details class="auto">
        <summary class="small muted">{t('script.autoRules', { n: autoLines.length })}</summary>
        <pre class="mono">{autoLines.join('\n')}</pre>
      </details>
    </div>
  {:else}
    <div class="scroll">
      {#if previewLexemes.length === 0 && previewSentences.length === 0}
        <p class="muted">{t('script.previewEmpty')}</p>
      {/if}
      {#if previewLexemes.length}
        <h3>{t('script.previewLexicon')}</h3>
        <table class="tbl">
          <tbody>
            {#each previewLexemes as l (l.id)}
              <tr>
                <td class="data">{l.lemma}</td>
                <td
                  class="scr"
                  style={fontCss(script)}
                  dir={script.direction === 'rtl' ? 'rtl' : 'ltr'}
                  >{l.scriptForms?.[script.id] || renderScript(lang, script, l.lemma)}</td
                >
                <td class="muted small"
                  >{l.senses
                    .map((s) => pickText(s.definition, glossLangs))
                    .filter(Boolean)
                    .join('; ')}</td
                >
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
      {#if previewSentences.length}
        <h3>{t('script.previewCorpus')}</h3>
        {#each previewSentences as s (s.id)}
          <div class="card sent">
            <div
              class="scr big"
              style={fontCss(script)}
              dir={script.direction === 'rtl' ? 'rtl' : 'ltr'}
            >
              {renderScript(lang, script, s.text)}
            </div>
            <div class="data">{s.text}</div>
            <div class="small muted">{pickText(s.translation, glossLangs)}</div>
          </div>
        {/each}
      {/if}
    </div>
  {/if}
</div>

{#if lang && script}
  {@const sc = script}
  <Portal>
    {#if tab === 'glyphs' && glyph}
      {@const g = glyph}
      <div class="preview-glyph" style={fontCss(sc)}>{g.char || '·'}</div>
      <div class="field">
        <label for="g-char">{t('script.char')}</label><input
          id="g-char"
          class="input data"
          bind:value={g.char}
          oninput={touch}
        />
      </div>
      <div class="field">
        <label for="g-val">{t('script.value')}</label><input
          id="g-val"
          class="input data"
          bind:value={g.value}
          oninput={touch}
          placeholder={t('script.valueHint')}
        />
      </div>
      <div class="field">
        <label for="g-name">{t('script.name')}</label><input
          id="g-name"
          class="input"
          bind:value={g.name}
          oninput={touch}
        />
      </div>
      <div class="field">
        <label for="g-cat">{t('script.category')}</label>
        <select
          id="g-cat"
          class="select"
          value={g.category}
          onchange={(e) => setCategory(g, (e.currentTarget as HTMLSelectElement).value)}
        >
          {#each [...new Set( [...BUILTIN_CATS, ...categories, g.category] )].filter(Boolean) as c (c)}<option
              value={c}>{catLabel(c)}</option
            >{/each}
          <option value="__custom">{t('script.categories.custom')}</option>
        </select>
      </div>
      <div class="field">
        <label for="g-notes">{t('common.notes')}</label><textarea
          id="g-notes"
          class="textarea"
          bind:value={g.notes}
          oninput={touch}
        ></textarea>
      </div>
      <button class="btn sm danger" onclick={() => removeGlyph(g)}
        ><Trash2 size={14} />{t('common.delete')}</button
      >
    {:else}
      <div class="field">
        <label for="s-name">{t('common.name')}</label><input
          id="s-name"
          class="input"
          bind:value={sc.name}
          oninput={touch}
        />
      </div>
      <div class="field">
        <label for="s-type">{t('script.type')}</label>
        <select id="s-type" class="select" bind:value={sc.type} onchange={touch}
          >{#each TYPES as ty (ty)}<option value={ty}>{t(`script.types.${ty}`)}</option
            >{/each}</select
        >
      </div>
      <div class="field">
        <label for="s-dir">{t('script.direction')}</label>
        <select id="s-dir" class="select" bind:value={sc.direction} onchange={touch}>
          <option value="ltr">{t('phonology.dir.ltr')}</option><option value="rtl"
            >{t('phonology.dir.rtl')}</option
          ><option value="ttb">{t('phonology.dir.ttb')}</option>
        </select>
      </div>
      <div class="field">
        <span class="small muted">{t('script.font')}</span>
        <input
          class="input"
          bind:value={sc.font.family}
          oninput={touch}
          placeholder={t('script.fontFamily')}
        />
        <div class="row wrap">
          <button class="btn sm" onclick={() => importFont(false)}
            ><Upload size={14} />{t('script.importFont')}</button
          >
          {#if sc.font.dataUrl}<span class="small muted"
              >{t('script.fontEmbedded', { name: sc.font.fileName })}</span
            ><button class="btn ghost icon sm" title={t('script.clearFont')} onclick={clearFont}
              ><X size={14} /></button
            >{/if}
        </div>
        <p class="tiny muted">{t('script.fontHint')}</p>
      </div>
      <div class="field">
        <label for="s-test">{t('script.test')}</label>
        <textarea
          id="s-test"
          class="textarea data"
          rows="3"
          bind:value={testText}
          placeholder={t('script.testPlaceholder')}
        ></textarea>
        {#if testResults.length}
          <table class="res">
            <tbody
              >{#each testResults as r (r.w)}<tr
                  ><td class="data">{r.w}</td><td
                    class="scr"
                    style={fontCss(sc)}
                    dir={sc.direction === 'rtl' ? 'rtl' : 'ltr'}>{r.out}</td
                  ></tr
                >{/each}</tbody
            >
          </table>
        {/if}
      </div>
      <div class="field">
        <label for="s-notes">{t('common.notes')}</label><textarea
          id="s-notes"
          class="textarea"
          bind:value={sc.notes}
          oninput={touch}
        ></textarea>
      </div>
      <button class="btn sm danger" onclick={() => removeScript(sc)}
        ><Trash2 size={14} />{t('common.delete')}</button
      >
    {/if}
  </Portal>
{/if}

<style>
  .bulk {
    gap: 8px;
    padding: 4px 0;
  }
  .page {
    padding: 20px 24px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    height: 100%;
  }
  .page-head {
    gap: 10px;
    flex-wrap: wrap;
  }
  .chips {
    gap: 6px;
  }
  .chip {
    padding: 2px 10px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--bg-elev);
    font-size: 13px;
    cursor: pointer;
    color: var(--text-2);
  }
  .chip.big {
    padding: 4px 12px;
    font-size: 14px;
  }
  .chip.active {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .seg {
    display: inline-flex;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .seg button {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    border: 0;
    background: var(--bg-elev);
    padding: 4px 10px;
    font-size: 13px;
    cursor: pointer;
    color: var(--text-2);
  }
  .seg button.active {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding-right: 4px;
  }
  .tools {
    gap: 8px;
  }
  .paste {
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
    gap: 8px;
    border-radius: var(--radius-sm);
  }
  .gcard {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 8px 4px 6px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-elev);
    cursor: pointer;
    min-width: 0;
  }
  .gcard:hover {
    border-color: var(--border-strong);
  }
  .gcard.sel {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }
  .gchar {
    font-size: 30px;
    line-height: 1.2;
    color: var(--text);
  }
  .gval {
    font-size: 12px;
    color: var(--text-2);
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .editor-area {
    flex: 1;
    min-height: 240px;
    display: flex;
    flex-direction: column;
  }
  .src {
    flex: 1;
    min-height: 240px;
    display: flex;
  }
  .auto pre {
    margin: 6px 0 0;
    padding: 8px 10px;
    background: var(--bg-sunken);
    border-radius: var(--radius-sm);
    font-size: 12px;
    max-height: 240px;
    overflow: auto;
  }
  .mono {
    font-family: var(--font-mono);
  }
  .tbl {
    border-collapse: collapse;
    font-size: 14px;
  }
  .tbl td {
    padding: 4px 10px;
    border-bottom: 1px solid var(--border);
  }
  .scr {
    font-size: 20px;
    line-height: 1.4;
  }
  .scr.big {
    font-size: 26px;
  }
  .sent {
    padding: 10px 14px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .preview-glyph {
    font-size: 64px;
    line-height: 1.2;
    text-align: center;
    padding: 12px;
    border: 1px dashed var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-elev);
  }
  .res {
    border-collapse: collapse;
    font-size: 14px;
    margin-top: 6px;
  }
  .res td {
    padding: 2px 8px 2px 0;
  }
  .tiny {
    font-size: 11px;
  }
  h3 {
    margin: 4px 0 2px;
  }
</style>
