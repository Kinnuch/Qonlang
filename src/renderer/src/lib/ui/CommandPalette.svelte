<script lang="ts">
  /** Ctrl+K 命令面板：跨页面搜索词条 / 语素 / 例句 / 短语 / 文档 / 规则集 / 范式，外加导航与常用命令。 */
  import { ui, SECTIONS, type Section } from '$lib/state/ui.svelte'
  import { projectState } from '$lib/state/project.svelte'
  import { chars } from '$lib/state/chars.svelte'
  import { t, pickText } from '$lib/i18n/index.svelte'
  import { Search, CornerDownLeft } from '@lucide/svelte'

  interface Item {
    kind: string
    id: string
    title: string
    sub: string
    section: Section
    run?: () => void
  }

  let query = $state('')
  let cursor = $state(0)
  let inputEl = $state<HTMLInputElement | null>(null)
  const project = $derived(projectState.project)
  const glossLangs = $derived(project?.settings.glossLanguages ?? [])

  $effect(() => {
    if (ui.paletteOpen) {
      query = ''
      cursor = 0
      queueMicrotask(() => inputEl?.focus())
    }
  })

  const commands = $derived.by((): Item[] => {
    const nav = SECTIONS.map((s) => ({ kind: 'nav', id: s, title: t(`nav.${s}`), sub: t('palette.goTo'), section: s }))
    const acts: Item[] = [
      { kind: 'cmd', id: 'save', title: t('palette.save'), sub: 'Ctrl+S', section: ui.section, run: () => void projectState.save() },
      { kind: 'cmd', id: 'saveAs', title: t('palette.saveAs'), sub: 'Ctrl+Shift+S', section: ui.section, run: () => void projectState.save(true) },
      { kind: 'cmd', id: 'chars', title: t('chars.title'), sub: 'Ctrl+I', section: ui.section, run: () => chars.toggle() },
      { kind: 'cmd', id: 'inspector', title: t('nav.inspector'), sub: 'Ctrl+\\', section: ui.section, run: () => (ui.inspectorOpen = !ui.inspectorOpen) },
      { kind: 'cmd', id: 'newLexeme', title: t('lexicon.add'), sub: t('nav.lexicon'), section: 'lexicon', run: () => ui.jump('lexicon', 'new', 'lexeme') }
    ]
    return [...acts, ...nav]
  })

  const results = $derived.by((): Item[] => {
    const q = query.trim().toLowerCase()
    if (!project) return []
    if (!q) return commands.slice(0, 12)
    const hit = (s: string | undefined): boolean => !!s && s.toLowerCase().includes(q)
    const out: Item[] = []
    for (const c of commands) if (hit(c.title)) out.push(c)
    const langName = (id: string | null): string => project.languages.find((l) => l.id === id)?.name ?? ''
    for (const l of project.lexemes) {
      const def = l.senses.map((s) => pickText(s.definition, glossLangs)).filter(Boolean).join('; ')
      if (hit(l.lemma) || hit(def)) out.push({ kind: 'lexeme', id: l.id, title: l.lemma, sub: `${t('nav.lexicon')} · ${langName(l.languageId)} · ${def}`, section: 'lexicon' })
      if (out.length > 60) break
    }
    for (const m of project.morphemes) {
      const meaning = pickText(m.meaning, glossLangs)
      if (hit(m.form) || hit(m.gloss) || hit(meaning)) out.push({ kind: 'morpheme', id: m.id, title: m.form, sub: `${t('nav.morphemes')} · ${m.gloss || meaning}`, section: 'morphemes' })
      if (out.length > 90) break
    }
    for (const s of project.sentences) if (hit(s.text) || Object.values(s.translation).some(hit)) out.push({ kind: 'sentence', id: s.id, title: s.text, sub: `${t('nav.corpus')} · ${pickText(s.translation, glossLangs)}`, section: 'corpus' })
    for (const p of project.phrasebook) if (hit(p.text) || Object.values(p.translation).some(hit)) out.push({ kind: 'phrase', id: p.id, title: p.text, sub: `${t('nav.phrasebook')} · ${pickText(p.translation, glossLangs)}`, section: 'phrasebook' })
    for (const d of project.docs) if (hit(d.title) || hit(d.markdown)) out.push({ kind: 'doc', id: d.id, title: d.title, sub: t('nav.docs'), section: 'docs' })
    for (const r of project.ruleSets) if (hit(r.name)) out.push({ kind: 'ruleSet', id: r.id, title: r.name, sub: t('nav.soundChanges'), section: 'soundChanges' })
    for (const p of project.paradigms) {
      const n = pickText(p.name, glossLangs)
      if (hit(n)) out.push({ kind: 'paradigm', id: p.id, title: n, sub: t('nav.paradigms'), section: 'paradigms' })
    }
    for (const l of project.languages) if (hit(l.name)) out.push({ kind: 'language', id: l.id, title: l.name, sub: t('nav.languages'), section: 'languages' })
    return out.slice(0, 40)
  })
  $effect(() => {
    if (cursor >= results.length) cursor = Math.max(0, results.length - 1)
  })

  function pick(it: Item): void {
    ui.paletteOpen = false
    if (it.run) {
      it.run()
      return
    }
    if (it.kind === 'nav') {
      ui.go(it.section)
      return
    }
    if (it.kind === 'lexeme' || it.kind === 'sentence' || it.kind === 'phrase' || it.kind === 'morpheme') {
      const lang = it.kind === 'lexeme' ? project?.lexemes.find((x) => x.id === it.id)?.languageId : it.kind === 'sentence' ? project?.sentences.find((x) => x.id === it.id)?.languageId : it.kind === 'phrase' ? project?.phrasebook.find((x) => x.id === it.id)?.languageId : project?.morphemes.find((x) => x.id === it.id)?.languageId
      if (lang) projectState.currentLanguageId = lang
    }
    if (it.kind === 'language') projectState.currentLanguageId = it.id
    ui.jump(it.section, it.kind, it.id)
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      ui.paletteOpen = false
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      cursor = Math.min(results.length - 1, cursor + 1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      cursor = Math.max(0, cursor - 1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const it = results[cursor]
      if (it) pick(it)
    }
  }
  const KIND_LABEL: Record<string, string> = { nav: '→', cmd: '⌘', lexeme: 'L', morpheme: 'M', sentence: 'S', phrase: 'P', doc: 'D', ruleSet: 'R', paradigm: 'Π', language: '◎' }
</script>

{#if ui.paletteOpen && project}
  <div class="backdrop" role="presentation" onclick={() => (ui.paletteOpen = false)}></div>
  <div class="palette card" role="dialog" aria-label="command palette">
    <div class="row head">
      <Search size={16} />
      <input bind:this={inputEl} class="q" placeholder={t('palette.placeholder')} bind:value={query} onkeydown={onKey} oninput={() => (cursor = 0)} />
      <span class="kbd">Esc</span>
    </div>
    <ul class="list">
      {#each results as it, i (it.kind + it.id)}
        <li>
          <button class="item" class:active={i === cursor} onmouseenter={() => (cursor = i)} onclick={() => pick(it)}>
            <span class="k">{KIND_LABEL[it.kind] ?? '·'}</span>
            <span class="grow ellip"><span class="ttl" class:data={['lexeme', 'morpheme', 'sentence', 'phrase'].includes(it.kind)}>{it.title || '—'}</span><span class="sub">{it.sub}</span></span>
            {#if i === cursor}<CornerDownLeft size={13} />{/if}
          </button>
        </li>
      {/each}
      {#if results.length === 0}<li class="none muted small">{t('common.none')}</li>{/if}
    </ul>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 80;
    background: rgba(0, 0, 0, 0.18);
  }
  .palette {
    position: fixed;
    z-index: 81;
    left: 50%;
    top: 12vh;
    transform: translateX(-50%);
    width: min(640px, 90vw);
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    box-shadow: var(--shadow-lg);
    overflow: hidden;
    animation: rise 0.12s ease-out;
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(6px);
    }
  }
  .head {
    padding: 10px 14px;
    gap: 10px;
    border-bottom: 1px solid var(--border);
    color: var(--text-3);
  }
  .q {
    flex: 1;
    border: 0;
    background: none;
    font: inherit;
    font-size: 16px;
    color: var(--text);
    outline: none;
  }
  .kbd {
    font-size: 11px;
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0 5px;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 6px;
    overflow: auto;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    text-align: left;
    border: 0;
    background: none;
    padding: 7px 10px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    color: var(--text);
    font: inherit;
  }
  .item.active {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .k {
    width: 22px;
    height: 22px;
    display: grid;
    place-items: center;
    border-radius: 5px;
    background: var(--bg-sunken);
    font-size: 11px;
    color: var(--text-2);
    flex: none;
  }
  .ellip {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .ttl {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sub {
    font-size: 11px;
    color: var(--text-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .none {
    padding: 10px;
  }
</style>
