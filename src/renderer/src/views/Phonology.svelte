<script lang="ts">
  import { navScroll } from '$lib/ui/navScroll'
  import type { PageView } from '$lib/state/ui.svelte'
  import { matchQuery, parseQuery } from '$lib/core/query'
  import { SEARCH_FIELDS } from '$lib/core/searchFields'
  import { projectState } from '$lib/state/project.svelte'
  import { ui } from '$lib/state/ui.svelte'
  import { i18n, t } from '$lib/i18n/index.svelte'
  import { newId, createLexeme, createOrthography } from '$lib/core/factory'
  import type { Id, Orthography, Phoneme, PhonemeClass, StressPosition } from '$lib/core/model'
  import {
    PULMONIC,
    PLACES,
    MANNERS,
    VOWELS,
    HEIGHTS,
    BACKNESS,
    OTHER_PULMONIC,
    NON_PULMONIC,
    OTHER_VOWELS,
    symbolInfo
  } from '$lib/ipa/data'
  import { inferFeatures } from '$lib/ipa/features'
  import {
    analyzeWord,
    checkWord,
    generateWords,
    languageParseOptions,
    phonemeFeatures,
    type Violation
  } from '$lib/engine/phon'
  import { parseRuleText, runRules, type RuleProgram } from '$lib/engine/sca'
  import { deriveAll, transcribe } from '$lib/core/pronounce'
  import Portal from '$lib/ui/Portal.svelte'
  import RuleList from '$lib/ui/RuleList.svelte'
  import RuleEditor from '$lib/ui/RuleEditor.svelte'
  import Hint from '$lib/ui/Hint.svelte'
  import { Plus, Trash2, X, Wand2, RefreshCw, Copy, List, Code, Check } from '@lucide/svelte'
  import GuideLink from '$lib/ui/GuideLink.svelte'
  import HelpDot from '$lib/ui/HelpDot.svelte'

  let { inspectorTitle = $bindable('') }: { inspectorTitle?: string } = $props()

  const project = $derived(projectState.project!)
  const lang = $derived(
    projectState.currentLanguage ??
      project.languages.find((l) => l.id === project.settings.defaultLanguageId) ??
      project.languages[0] ??
      null
  )

  type Tab = 'phonemes' | 'classes' | 'orthography' | 'syllable' | 'phonotactics'
  const TABS: Tab[] = ['phonemes', 'classes', 'orthography', 'syllable', 'phonotactics']
  /** 回到这一页时接着用上次的子页、选中项和各处的测试输入；换了语言就不恢复选中与滚动 */
  const memo = ui.memo<{
    lang: Id | null
    tab: Tab
    selectedPhoneme: Id | null
    selectedOrtho: Id | null
    orthoDir: 'toIpa' | 'fromIpa'
    orthoView: 'list' | 'source'
    orthoTest: string
    syllTest: string
    queryDim: string
    queryVal: string
    genCount: number
    genMin: number
    genMax: number
  }>('phonology')
  const sameLang = memo.lang === projectState.currentLanguageId
  let tab = $state<Tab>(memo.tab ?? 'phonemes')
  // 「返回」用：报上当前位置，返回时原样恢复
  $effect(() => {
    ui.reportView('phonology', {
      kind: 'phonology',
      lang: projectState.currentLanguageId,
      tab,
      phoneme: selectedPhoneme,
      ortho: selectedOrtho
    })
  })
  $effect(() => {
    const r = ui.takeRestore('phonology')
    if (!r) return
    const v: PageView = r.view ?? {}
    if (v.tab) tab = v.tab as Tab
    selectedPhoneme = v.phoneme ?? null
    selectedOrtho = v.ortho ?? null
    ui.restoreScroll('phonology', r.scroll)
  })
  let selectedPhoneme = $state<Id | null>(sameLang ? (memo.selectedPhoneme ?? null) : null)
  let selectedOrtho = $state<Id | null>(sameLang ? (memo.selectedOrtho ?? null) : null)
  let manualSymbol = $state('')
  let newDimension = $state('')

  const phoneme = $derived(lang?.phonemes.find((p) => p.id === selectedPhoneme) ?? null)
  const ortho = $derived(
    lang?.orthographies.find((o) => o.id === selectedOrtho) ??
      lang?.orthographies.find((o) => o.isPrimary) ??
      lang?.orthographies[0] ??
      null
  )
  const inventory = $derived(new Set(lang?.phonemes.map((p) => p.symbol) ?? []))
  /** 顶栏搜索：音位按符号 / 特征 / 备注，音类按名称与成员 */
  const pq = $derived(parseQuery(ui.search, SEARCH_FIELDS.phonology))
  const phonemeHit = (p: (typeof lang.phonemes)[number]): boolean =>
    matchQuery(pq, (f) => {
      const feats = Object.values(p.features).map((v) => v ?? '')
      if (f === 'symbol') return [p.symbol]
      if (f === 'feature') return feats
      if (f === 'note') return [p.notes]
      if (f === 'class') return []
      return [p.symbol, p.notes, ...feats]
    })
  const classHit = (c: { name: string; members: string[] }): boolean =>
    matchQuery(pq, (f) =>
      f === 'symbol' ? c.members : f === 'class' || f === null ? [c.name, ...c.members] : []
    )
  const dimensions = $derived([
    ...new Set(lang?.phonemes.flatMap((p) => Object.keys(p.features)) ?? [])
  ])
  const groupOf = (p: Phoneme): 'consonant' | 'vowel' | 'other' => {
    const type = phonemeFeatures(p).type
    return type === 'consonant' ? 'consonant' : type === 'vowel' ? 'vowel' : 'other'
  }
  // 造词的音节范围默认取自语言设置
  $effect(() => {
    if (lang) {
      genMin = lang.phonotactics.minSyllables || 1
      genMax = lang.phonotactics.maxSyllables || 3
    }
  })

  $effect(() => {
    inspectorTitle =
      tab === 'phonemes' && phoneme
        ? phoneme.symbol
        : tab === 'orthography' && ortho
          ? ortho.name
          : t('nav.phonology')
  })

  function touch(): void {
    projectState.touch()
  }

  // ───── 音位 ─────
  function addPhoneme(symbol: string): Phoneme | null {
    if (!lang || !symbol.trim()) return null
    const s = symbol.trim()
    if (inventory.has(s)) return lang.phonemes.find((p) => p.symbol === s) ?? null
    const p: Phoneme = {
      id: newId(),
      symbol: s,
      features: inferFeatures(s),
      graphemes: {},
      notes: ''
    }
    lang.phonemes.push(p)
    touch()
    return p
  }
  function togglePhoneme(symbol: string): void {
    if (!lang) return
    const existing = lang.phonemes.find((p) => p.symbol === symbol)
    if (existing) removePhoneme(existing)
    else selectedPhoneme = addPhoneme(symbol)?.id ?? null
  }
  function removePhoneme(p: Phoneme): void {
    if (!lang) return
    const idx = lang.phonemes.indexOf(p)
    if (idx < 0) return
    const snap = $state.snapshot(p) as Phoneme
    lang.phonemes.splice(idx, 1)
    if (selectedPhoneme === p.id) selectedPhoneme = null
    touch()
    ui.toast(t('phonology.removedPhoneme', { s: snap.symbol }), {
      action: {
        label: t('common.undo'),
        run: () => {
          lang!.phonemes.splice(Math.min(idx, lang!.phonemes.length), 0, snap)
          touch()
        }
      }
    })
  }
  function addManual(): void {
    const p = addPhoneme(manualSymbol)
    if (p) selectedPhoneme = p.id
    manualSymbol = ''
  }
  function addDimension(): void {
    if (!phoneme || !newDimension.trim()) return
    phoneme.features[newDimension.trim()] = ''
    newDimension = ''
    touch()
  }
  const valuesFor = (dim: string): string[] => [
    ...new Set(lang?.phonemes.map((p) => p.features[dim]).filter(Boolean) ?? [])
  ]

  // ───── 音类 ─────
  let queryDim = $state(memo.queryDim ?? '')
  let queryVal = $state(memo.queryVal ?? '')
  function classMembersText(c: PhonemeClass): string {
    return c.members.some((m) => Array.from(m).length > 1)
      ? c.members.join(' ')
      : c.members.join('')
  }
  function setClassMembers(c: PhonemeClass, text: string): void {
    const v = text.trim()
    c.members = /[\s,]/.test(v) ? v.split(/[\s,]+/).filter(Boolean) : Array.from(v)
    c.featureQuery = null
    touch()
  }
  function membersFromQuery(q: Record<string, string>): string[] {
    return (lang?.phonemes ?? [])
      .filter((p) => Object.entries(q).every(([k, v]) => p.features[k] === v))
      .map((p) => p.symbol)
  }
  function addClass(
    name = '',
    members: string[] = [],
    featureQuery: Record<string, string> | null = null
  ): void {
    if (!lang) return
    lang.classes.push({ id: newId(), name, members, featureQuery })
    touch()
  }
  function addQueryToClass(c: PhonemeClass): void {
    if (!queryDim || !queryVal) return
    c.featureQuery = { ...(c.featureQuery ?? {}), [queryDim]: queryVal }
    c.members = membersFromQuery(c.featureQuery)
    touch()
  }
  function refreshClass(c: PhonemeClass): void {
    if (!c.featureQuery) return
    c.members = membersFromQuery(c.featureQuery)
    touch()
  }
  function quickClasses(): void {
    if (!lang) return
    if (!lang.classes.some((c) => c.name === 'C'))
      addClass('C', membersFromQuery({ type: 'consonant' }), { type: 'consonant' })
    if (!lang.classes.some((c) => c.name === 'V'))
      addClass('V', membersFromQuery({ type: 'vowel' }), { type: 'vowel' })
  }

  // ───── 正字法 ─────
  let orthoDir = $state<'toIpa' | 'fromIpa'>(memo.orthoDir ?? 'toIpa')
  let orthoView = $state<'list' | 'source'>(memo.orthoView ?? 'list')
  let orthoTest = $state(memo.orthoTest ?? '')
  let orthoProgram = $state<RuleProgram | null>(null)
  $effect(() => {
    if (!lang || !ortho) {
      orthoProgram = null
      return
    }
    const text = orthoDir === 'toIpa' ? ortho.rulesToIpa : ortho.rulesFromIpa
    const opts = languageParseOptions(lang, project)
    const id = setTimeout(() => {
      orthoProgram = parseRuleText(text, opts)
    }, 120)
    return () => clearTimeout(id)
  })
  const orthoResults = $derived.by(() => {
    if (!orthoProgram) return []
    return orthoTest
      .split(/[\s,，、]+/)
      .filter(Boolean)
      .map((w) => ({ w, out: runRules(orthoProgram!, w).output }))
  })
  function addOrtho(): void {
    if (!lang) return
    const o = createOrthography(t('phonology.newOrthography'), lang.orthographies.length === 0)
    lang.orthographies.push(o)
    selectedOrtho = o.id
    touch()
  }
  function removeOrtho(o: Orthography): void {
    if (!lang || lang.orthographies.length <= 1) return
    lang.orthographies.splice(lang.orthographies.indexOf(o), 1)
    if (o.isPrimary && lang.orthographies[0]) lang.orthographies[0].isPrimary = true
    selectedOrtho = lang.orthographies[0]?.id ?? null
    touch()
  }
  function setPrimary(o: Orthography): void {
    if (!lang) return
    for (const x of lang.orthographies) x.isPrimary = x === o
    touch()
  }
  function rederive(): void {
    if (!lang) return
    const n = deriveAll(project, lang)
    touch()
    ui.toast(t('phonology.rederived', { n }))
  }

  // ───── 音节与韵律 ─────
  let syllTest = $state(memo.syllTest ?? '')
  const syllResults = $derived.by(() => {
    if (!lang) return []
    return syllTest
      .split(/[\s,，、]+/)
      .filter(Boolean)
      .map((w) => ({ w, out: analyzeWord(lang!, w).text }))
  })
  const sampleAnalyses = $derived.by(() => {
    if (!lang) return []
    const primary = lang.orthographies.find((o) => o.isPrimary)
    return project.lexemes
      .filter((l) => l.languageId === lang!.id)
      .slice(0, 12)
      .map((l) => {
        const ipa =
          (primary && l.pronunciations[primary.id]?.ipa) ||
          (primary ? transcribe(lang!, primary, l.lemma) : null) ||
          l.lemma
        return { lemma: l.lemma, ipa, out: analyzeWord(lang!, ipa).text }
      })
  })
  const STRESS: StressPosition[] = [
    'initial',
    'second',
    'final',
    'penult',
    'antepenult',
    'weight',
    'manual'
  ]

  // ───── 配列与造词 ─────
  const listText = (a: string[]): string => a.join(' ')
  const setList = (key: 'onsets' | 'nuclei' | 'codas' | 'illegal', text: string): void => {
    if (!lang) return
    lang.phonotactics[key] = text.split(/[\s,，、]+/).filter(Boolean)
    touch()
  }
  const weightsText = $derived(
    lang
      ? Object.entries(lang.phonotactics.weights)
          .map(([k, v]) => `${k}=${v}`)
          .join(' ')
      : ''
  )
  function setWeights(text: string): void {
    if (!lang) return
    const w: Record<string, number> = {}
    for (const part of text.split(/\s+/).filter(Boolean)) {
      const [k, v] = part.split('=')
      if (k && v && !isNaN(Number(v))) w[k] = Number(v)
    }
    lang.phonotactics.weights = w
    touch()
  }
  function fillFromInventory(): void {
    if (!lang) return
    const cons = lang.phonemes
      .filter((p) => phonemeFeatures(p).type === 'consonant')
      .map((p) => p.symbol)
    const vow = lang.phonemes
      .filter((p) => phonemeFeatures(p).type === 'vowel')
      .map((p) => p.symbol)
    if (!lang.phonotactics.onsets.length) lang.phonotactics.onsets = cons
    if (!lang.phonotactics.nuclei.length) lang.phonotactics.nuclei = vow
    if (!lang.phonotactics.codas.length) lang.phonotactics.codas = cons
    touch()
  }
  let violations = $state<{ lemma: string; ipa: string; v: Violation[] }[] | null>(null)
  function runCheck(): void {
    if (!lang) return
    const primary = lang.orthographies.find((o) => o.isPrimary)
    const out: { lemma: string; ipa: string; v: Violation[] }[] = []
    for (const l of project.lexemes) {
      if (l.languageId !== lang.id) continue
      const ipa =
        (primary && l.pronunciations[primary.id]?.ipa) ||
        (primary ? transcribe(lang, primary, l.lemma) : null) ||
        l.lemma
      const a = analyzeWord(lang, ipa)
      const v = checkWord(a.segments, a.syllables, lang.phonotactics)
      if (v.length) out.push({ lemma: l.lemma, ipa, v })
    }
    violations = out
  }
  let genCount = $state(memo.genCount ?? 20)
  let genMin = $state(memo.genMin ?? 1)
  let genMax = $state(memo.genMax ?? 3)
  $effect(() => {
    Object.assign(memo, {
      lang: projectState.currentLanguageId,
      tab,
      selectedPhoneme,
      selectedOrtho,
      orthoDir,
      orthoView,
      orthoTest,
      syllTest,
      queryDim,
      queryVal,
      genCount,
      genMin,
      genMax
    })
  })
  if (sameLang && !ui.restoring('phonology'))
    ui.restoreScroll('phonology', ui.lastScroll('phonology'))
  let generated = $state<{ ipa: string; spelt: string | null }[]>([])
  function generate(): void {
    if (!lang) return
    const primary = lang.orthographies.find((o) => o.isPrimary)
    const fromIpa = primary ? orthoProgramOf(primary, 'fromIpa') : null
    const existing = new Set(
      project.lexemes.filter((l) => l.languageId === lang!.id).map((l) => l.lemma)
    )
    const words = generateWords(lang.phonotactics, {
      count: genCount,
      minSyllables: genMin,
      maxSyllables: genMax
    })
    generated = words
      .map((ipa) => ({ ipa, spelt: fromIpa ? runRules(fromIpa, ipa).output : null }))
      .filter((g) => !existing.has(g.spelt ?? g.ipa))
  }
  function orthoProgramOf(o: Orthography, dir: 'toIpa' | 'fromIpa'): RuleProgram | null {
    if (!lang) return null
    const text = dir === 'toIpa' ? o.rulesToIpa : o.rulesFromIpa
    return text.trim() ? parseRuleText(text, languageParseOptions(lang, project)) : null
  }
  function addGenerated(g: { ipa: string; spelt: string | null }): void {
    if (!lang) return
    const l = createLexeme(lang.id, g.spelt ?? g.ipa)
    const primary = lang.orthographies.find((o) => o.isPrimary)
    if (primary) l.pronunciations[primary.id] = { ipa: g.ipa, irregular: false }
    project.lexemes.push(l)
    generated = generated.filter((x) => x !== g)
    touch()
    ui.toast(t('phonology.addedWord', { w: g.spelt ?? g.ipa }))
  }
  async function copyGenerated(): Promise<void> {
    await navigator.clipboard.writeText(
      generated.map((g) => (g.spelt ? `${g.spelt}\t${g.ipa}` : g.ipa)).join('\n')
    )
    ui.toast(t('soundChanges.copied'))
  }

  const zh = $derived(i18n.locale === 'zh')
</script>

{#snippet chartCell(sym: string | null)}
  {#if sym}
    <button
      class="sym"
      class:in={inventory.has(sym)}
      title={symbolInfo(sym) ? (zh ? symbolInfo(sym)!.zh : symbolInfo(sym)!.en) : sym}
      onclick={() => togglePhoneme(sym)}>{sym}</button
    >
  {:else}
    <span class="ph"></span>
  {/if}
{/snippet}

<div class="page">
  <div class="page-head row">
    <h1>{t('nav.phonology')}</h1>
    <GuideLink section="phonology" />
    {#if lang}<span class="badge" style:background={lang.color} style:color="#fff">{lang.name}</span
      >{/if}
    <div class="seg">
      {#each TABS as tb (tb)}
        <button class:active={tab === tb} onclick={() => (tab = tb)}
          >{t(`phonology.tabs.${tb}`)}</button
        >
      {/each}
    </div>
  </div>

  <Hint id="phonology" text={t('phonology.hint')} />
  {#if !lang}
    <p class="muted">{t('lexicon.noLanguage')}</p>
  {:else if tab === 'phonemes'}
    <div class="scroll" use:navScroll={'phonology'}>
      <section class="block">
        <div class="row">
          <h3 class="grow">
            {t('phonology.inventory')} <span class="badge">{lang.phonemes.length}</span>
          </h3>
          <input
            class="input data manual"
            placeholder={t('phonology.manualAdd')}
            bind:value={manualSymbol}
            onkeydown={(e) => e.key === 'Enter' && addManual()}
          />
          <button class="btn sm" onclick={addManual}><Plus size={14} />{t('common.add')}</button>
        </div>
        {#if lang.phonemes.length === 0}
          <p class="small muted">{t('phonology.inventoryEmpty')}</p>
        {:else}
          {#each ['consonant', 'vowel', 'other'] as g (g)}
            {@const ps = lang.phonemes.filter((p) => groupOf(p) === g && phonemeHit(p))}
            {#if ps.length}
              <div class="inv-row">
                <span class="small muted lbl">{t(`phonology.group.${g}`)}</span>
                <div class="chips">
                  {#each ps as p (p.id)}
                    <button
                      class="chip data"
                      class:active={selectedPhoneme === p.id}
                      onclick={() => (selectedPhoneme = p.id)}>{p.symbol}</button
                    >
                  {/each}
                </div>
              </div>
            {/if}
          {/each}
        {/if}
      </section>

      <section class="block">
        <h3>{t('phonology.chartPulmonic')}</h3>
        <p class="small muted">{t('phonology.chartHint')}</p>
        <div class="table-wrap">
          <table class="chart">
            <thead
              ><tr
                ><th></th>{#each PLACES as p (p.en)}<th>{zh ? p.zh : p.en}</th>{/each}</tr
              ></thead
            >
            <tbody>
              {#each PULMONIC as row, mi (mi)}
                <tr>
                  <th>{zh ? MANNERS[mi].zh : MANNERS[mi].en}</th>
                  {#each row as cell, pi (pi)}<td
                      >{@render chartCell(cell[0])}{@render chartCell(cell[1])}</td
                    >{/each}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        <div class="chips">
          {#each OTHER_PULMONIC as s (s.s)}{@render chartCell(s.s)}{/each}
        </div>
        {#each NON_PULMONIC as g (g.en)}
          <div class="row wrap">
            <span class="small muted lbl">{zh ? g.zh : g.en}</span
            >{#each g.items.filter((x) => x.s.length === 1) as s (s.s)}{@render chartCell(
                s.s
              )}{/each}
          </div>
        {/each}
      </section>

      <section class="block">
        <h3>{t('phonology.chartVowels')}</h3>
        <div class="table-wrap">
          <table class="chart">
            <thead
              ><tr
                ><th></th>{#each BACKNESS as b (b.en)}<th>{zh ? b.zh : b.en}</th>{/each}</tr
              ></thead
            >
            <tbody>
              {#each VOWELS as row, hi (hi)}
                <tr>
                  <th>{zh ? HEIGHTS[hi].zh : HEIGHTS[hi].en}</th>
                  {#each row as cell, bi (bi)}<td
                      >{@render chartCell(cell[0])}{@render chartCell(cell[1])}</td
                    >{/each}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        <div class="chips">
          {#each OTHER_VOWELS as s (s.s)}{@render chartCell(s.s)}{/each}
        </div>
      </section>
    </div>
  {:else if tab === 'classes'}
    <div class="scroll">
      <div class="row">
        <p class="small muted grow">{t('phonology.classesHint')}</p>
        <button class="btn sm" onclick={quickClasses}
          ><Wand2 size={14} />{t('phonology.quickClasses')}</button
        >
        <button class="btn primary sm" onclick={() => addClass()}
          ><Plus size={14} />{t('phonology.addClass')}</button
        >
      </div>
      {#each lang.classes.filter(classHit) as c (c.id)}
        <div class="card cls">
          <div class="row">
            <input
              class="input cname mono"
              placeholder={t('soundChanges.className')}
              bind:value={c.name}
              oninput={touch}
            />
            <span class="muted">=</span>
            <input
              class="input data grow"
              value={classMembersText(c)}
              placeholder={t('soundChanges.classMembers')}
              onchange={(e) => setClassMembers(c, (e.currentTarget as HTMLInputElement).value)}
            />
            <button
              class="btn ghost icon sm danger"
              onclick={() => {
                lang!.classes.splice(lang!.classes.indexOf(c), 1)
                touch()
              }}><Trash2 size={14} /></button
            >
          </div>
          <div class="row small query">
            <span class="muted">{t('phonology.byFeature')}</span>
            {#if c.featureQuery}
              {#each Object.entries(c.featureQuery) as [k, v] (k)}
                <span class="chip"
                  >{k}={v}<button
                    class="x"
                    onclick={() => {
                      delete c.featureQuery![k]
                      if (!Object.keys(c.featureQuery!).length) c.featureQuery = null
                      else refreshClass(c)
                      touch()
                    }}><X size={10} /></button
                  ></span
                >
              {/each}
              <button
                class="btn ghost icon sm"
                title={t('phonology.refresh')}
                onclick={() => refreshClass(c)}><RefreshCw size={13} /></button
              >
            {/if}
            <select class="select tiny" bind:value={queryDim}
              ><option value="">{t('phonology.dimension')}</option
              >{#each dimensions as d (d)}<option value={d}>{d}</option>{/each}</select
            >
            <select class="select tiny" bind:value={queryVal}
              ><option value="">{t('phonology.value')}</option
              >{#each valuesFor(queryDim) as v (v)}<option value={v}>{v}</option>{/each}</select
            >
            <button
              class="btn ghost sm"
              disabled={!queryDim || !queryVal}
              onclick={() => addQueryToClass(c)}
              ><Plus size={13} />{t('phonology.addCondition')}</button
            >
          </div>
        </div>
      {/each}
      {#if lang.classes.length === 0}<p class="muted">{t('phonology.noClasses')}</p>{/if}
    </div>
  {:else if tab === 'orthography'}
    <div class="scroll ortho">
      <div class="row wrap">
        {#each lang.orthographies as o (o.id)}
          <button
            class="chip big"
            class:active={ortho?.id === o.id}
            onclick={() => (selectedOrtho = o.id)}
            >{o.name}{#if o.isPrimary}<span class="badge accent">{t('phonology.primary')}</span
              >{/if}</button
          >
        {/each}
        <button class="btn ghost sm" onclick={addOrtho}
          ><Plus size={14} />{t('phonology.addOrthography')}</button
        >
        <span class="grow"></span>
        <button class="btn sm" onclick={rederive}
          ><RefreshCw size={14} />{t('phonology.rederive')}</button
        >
      </div>
      {#if ortho}
        <div class="row">
          <div class="seg">
            <button class:active={orthoDir === 'toIpa'} onclick={() => (orthoDir = 'toIpa')}
              >{t('phonology.toIpa')}</button
            >
            <button class:active={orthoDir === 'fromIpa'} onclick={() => (orthoDir = 'fromIpa')}
              >{t('phonology.fromIpa')}</button
            >
          </div>
          <span class="grow"></span>
          <div class="seg">
            <button class:active={orthoView === 'list'} onclick={() => (orthoView = 'list')}
              ><List size={14} />{t('soundChanges.viewList')}</button
            >
            <button class:active={orthoView === 'source'} onclick={() => (orthoView = 'source')}
              ><Code size={14} />{t('soundChanges.viewSource')}</button
            >
          </div>
        </div>
        <p class="small muted">{t('phonology.orthoRulesHint')}</p>
        <div class="editor-area">
          {#if orthoDir === 'toIpa'}
            {#if orthoView === 'list'}
              <RuleList bind:text={ortho.rulesToIpa} program={orthoProgram} onchange={touch} />
            {:else}
              <div class="src">
                <RuleEditor
                  bind:value={ortho.rulesToIpa}
                  diagnostics={orthoProgram?.diagnostics ?? []}
                  oninput={touch}
                />
              </div>
            {/if}
          {:else if orthoView === 'list'}
            <RuleList bind:text={ortho.rulesFromIpa} program={orthoProgram} onchange={touch} />
          {:else}
            <div class="src">
              <RuleEditor
                bind:value={ortho.rulesFromIpa}
                diagnostics={orthoProgram?.diagnostics ?? []}
                oninput={touch}
              />
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {:else if tab === 'syllable'}
    <div class="scroll form">
      <section class="block">
        <h3>{t('phonology.syllable')}</h3>
        <label class="row check"
          ><input type="checkbox" bind:checked={lang.syllable.enabled} onchange={touch} />{t(
            'phonology.syllableEnabled'
          )}</label
        >
        <div class="grid2">
          <label class="field"
            ><span>{t('phonology.strategy')}</span>
            <select class="select" bind:value={lang.syllable.strategy} onchange={touch}>
              <option value="maximal-onset">{t('phonology.strategyMax')}</option>
              <option value="template">{t('phonology.strategyTemplate')}</option>
            </select></label
          >
          <label class="field"
            ><span>{t('phonology.template')}</span><input
              class="input mono"
              placeholder="(C)(C)V(C)"
              bind:value={lang.syllable.template}
              oninput={touch}
            /></label
          >
        </div>
        <p class="small muted">{t('phonology.syllableHint')}</p>
      </section>
      <section class="block">
        <h3>{t('phonology.prosody')}</h3>
        <div class="grid2">
          <label class="field"
            ><span>{t('phonology.prosodyType')}</span>
            <select class="select" bind:value={lang.prosody.type} onchange={touch}>
              {#each ['none', 'stress', 'pitch', 'tone'] as p (p)}<option value={p}
                  >{t(`phonology.prosodyTypes.${p}`)}</option
                >{/each}
            </select></label
          >
          {#if lang.prosody.type === 'stress' || lang.prosody.type === 'pitch'}
            <label class="field"
              ><span>{t('phonology.stressPosition')}</span>
              <select class="select" bind:value={lang.prosody.stressPosition} onchange={touch}>
                {#each STRESS as s (s)}<option value={s}>{t(`phonology.stress.${s}`)}</option
                  >{/each}
              </select></label
            >
          {/if}
        </div>
        {#if lang.prosody.type === 'tone'}
          <div class="tones">
            <div class="row">
              <span class="small muted">{t('phonology.tones')}</span><HelpDot key="tones" /><span
                class="grow"
              ></span><button
                class="btn ghost sm"
                onclick={() => {
                  lang!.prosody.tones.push({ id: newId(), name: '', letter: '', digits: '' })
                  touch()
                }}><Plus size={14} />{t('phonology.addTone')}</button
              >
            </div>
            {#each lang.prosody.tones as tone, i (tone.id)}
              <div class="row kv">
                <input
                  class="input"
                  placeholder={t('common.name')}
                  bind:value={tone.name}
                  oninput={touch}
                />
                <input
                  class="input data"
                  placeholder="˧˥"
                  bind:value={tone.letter}
                  oninput={touch}
                />
                <input
                  class="input mono"
                  placeholder="35"
                  bind:value={tone.digits}
                  oninput={touch}
                />
                <button
                  class="btn ghost icon sm"
                  onclick={() => {
                    lang!.prosody.tones.splice(i, 1)
                    touch()
                  }}><X size={14} /></button
                >
              </div>
            {/each}
          </div>
        {/if}
        <label class="field"
          ><span>{t('phonology.prosodyNotes')}</span><textarea
            class="textarea"
            bind:value={lang.prosody.rules}
            oninput={touch}
          ></textarea></label
        >
      </section>
      <section class="block">
        <h3>{t('phonology.test')}</h3>
        <input
          class="input data"
          placeholder={t('phonology.testPlaceholder')}
          bind:value={syllTest}
        />
        {#if syllResults.length}
          <table class="res">
            <tbody
              >{#each syllResults as r (r.w)}<tr
                  ><td class="data">{r.w}</td><td class="data out">{r.out}</td></tr
                >{/each}</tbody
            >
          </table>
        {/if}
        {#if sampleAnalyses.length}
          <p class="small muted">{t('phonology.sampleFromLexicon')}</p>
          <table class="res">
            <tbody
              >{#each sampleAnalyses as r (r.lemma)}<tr
                  ><td class="data">{r.lemma}</td><td class="data muted">{r.ipa}</td><td
                    class="data out">{r.out}</td
                  ></tr
                >{/each}</tbody
            >
          </table>
        {/if}
      </section>
    </div>
  {:else if tab === 'phonotactics'}
    <div class="scroll form">
      <section class="block">
        <div class="row">
          <h3 class="grow">{t('phonology.phonotactics')}</h3>
          <button class="btn sm" onclick={fillFromInventory}
            ><Wand2 size={14} />{t('phonology.fillFromInventory')}</button
          >
        </div>
        <div class="grid2">
          <label class="field"
            ><span>{t('phonology.onsets')}</span><input
              class="input data"
              value={listText(lang.phonotactics.onsets)}
              onchange={(e) => setList('onsets', (e.currentTarget as HTMLInputElement).value)}
            /></label
          >
          <label class="field"
            ><span>{t('phonology.nuclei')}</span><input
              class="input data"
              value={listText(lang.phonotactics.nuclei)}
              onchange={(e) => setList('nuclei', (e.currentTarget as HTMLInputElement).value)}
            /></label
          >
          <label class="field"
            ><span>{t('phonology.codas')}</span><input
              class="input data"
              value={listText(lang.phonotactics.codas)}
              onchange={(e) => setList('codas', (e.currentTarget as HTMLInputElement).value)}
            /></label
          >
          <label class="field"
            ><span>{t('phonology.illegal')}</span><input
              class="input data"
              value={listText(lang.phonotactics.illegal)}
              onchange={(e) => setList('illegal', (e.currentTarget as HTMLInputElement).value)}
            /></label
          >
          <label class="field"
            ><span>{t('phonology.weights')}</span><input
              class="input mono"
              value={weightsText}
              placeholder="k=3 t=2 a=5"
              onchange={(e) => setWeights((e.currentTarget as HTMLInputElement).value)}
            /></label
          >
          <div class="row">
            <label class="field"
              ><span>{t('phonology.minSyl')}</span><input
                type="number"
                min="1"
                class="input num"
                bind:value={lang.phonotactics.minSyllables}
                onchange={touch}
              /></label
            >
            <label class="field"
              ><span>{t('phonology.maxSyl')}</span><input
                type="number"
                min="1"
                class="input num"
                bind:value={lang.phonotactics.maxSyllables}
                onchange={touch}
              /></label
            >
          </div>
        </div>
        <p class="small muted">{t('phonology.phonotacticsHint')}</p>
      </section>
      <section class="block">
        <div class="row">
          <h3 class="grow">{t('phonology.check')}</h3>
          <button class="btn sm" onclick={runCheck}
            ><Check size={14} />{t('phonology.runCheck')}</button
          >
        </div>
        {#if violations}
          {#if violations.length === 0}
            <p class="small muted">{t('phonology.noViolations')}</p>
          {:else}
            <p class="small muted">{t('phonology.violations', { n: violations.length })}</p>
            <table class="res">
              <tbody
                >{#each violations.slice(0, 200) as v (v.lemma + v.ipa)}<tr
                    ><td class="data">{v.lemma}</td><td class="data muted">{v.ipa}</td><td
                      >{#each v.v as x, i (i)}<span class="badge warn"
                          >{t(`phonology.violation.${x.kind}`)} {x.detail}</span
                        >{/each}</td
                    ></tr
                  >{/each}</tbody
              >
            </table>
          {/if}
        {/if}
      </section>
      <section class="block">
        <div class="row">
          <h3 class="grow">{t('phonology.generator')}</h3>
          <label class="row small"
            >{t('phonology.count')}<input
              type="number"
              min="1"
              max="500"
              class="input num"
              bind:value={genCount}
            /></label
          >
          <label class="row small"
            >{t('phonology.minSyl')}<input
              type="number"
              min="1"
              class="input num"
              bind:value={genMin}
            /></label
          >
          <label class="row small"
            >{t('phonology.maxSyl')}<input
              type="number"
              min="1"
              class="input num"
              bind:value={genMax}
            /></label
          >
          <button class="btn primary sm" onclick={generate}
            ><Wand2 size={14} />{t('phonology.generate')}</button
          >
          {#if generated.length}<button class="btn ghost sm" onclick={copyGenerated}
              ><Copy size={14} />{t('soundChanges.copyResults')}</button
            >{/if}
        </div>
        <div class="chips">
          {#each generated as g (g.ipa)}
            <span class="chip gen data"
              >{#if g.spelt && g.spelt !== g.ipa}<b>{g.spelt}</b><span class="muted small"
                  >{g.ipa}</span
                >{:else}{g.ipa}{/if}<button
                class="x add"
                title={t('phonology.addToLexicon')}
                onclick={() => addGenerated(g)}><Plus size={11} /></button
              ></span
            >
          {/each}
        </div>
      </section>
    </div>
  {/if}
</div>

{#if lang && tab === 'phonemes' && phoneme}
  {@const p = phoneme}
  <Portal>
    <div class="field">
      <label for="ph-sym">{t('phonology.symbol')}</label>
      <input id="ph-sym" class="input data big" bind:value={p.symbol} oninput={touch} />
      {#if symbolInfo(p.symbol)}<span class="hint"
          >{zh ? symbolInfo(p.symbol)!.zh : symbolInfo(p.symbol)!.en}</span
        >{/if}
    </div>
    <div class="field">
      <span class="small muted">{t('phonology.features')}</span>
      {#each Object.keys(p.features) as k (k)}
        <div class="row kv">
          <span class="dim small">{k}</span>
          <input class="input" list={`dl-${k}`} bind:value={p.features[k]} oninput={touch} />
          <datalist id={`dl-${k}`}
            >{#each valuesFor(k) as v (v)}<option value={v}></option>{/each}</datalist
          >
          <button
            class="btn ghost icon sm"
            onclick={() => {
              delete p.features[k]
              touch()
            }}><X size={14} /></button
          >
        </div>
      {/each}
      <div class="row kv">
        <input
          class="input"
          placeholder={t('phonology.newDimension')}
          bind:value={newDimension}
          list="dl-dims"
          onkeydown={(e) => e.key === 'Enter' && addDimension()}
        />
        <datalist id="dl-dims"
          >{#each dimensions.filter((d) => !(d in p.features)) as d (d)}<option value={d}
            ></option>{/each}</datalist
        >
        <button class="btn ghost sm" onclick={addDimension}><Plus size={14} /></button>
      </div>
      <button
        class="btn ghost sm self-start"
        onclick={() => {
          p.features = inferFeatures(p.symbol)
          touch()
        }}><Wand2 size={14} />{t('phonology.inferFeatures')}</button
      >
    </div>
    <div class="field">
      <span class="small muted">{t('phonology.graphemes')}</span>
      {#each lang.orthographies as o (o.id)}
        <div class="row kv">
          <span class="dim small">{o.name}</span><input
            class="input data"
            bind:value={p.graphemes[o.id]}
            oninput={touch}
          />
        </div>
      {/each}
    </div>
    <div class="field">
      <label for="ph-notes">{t('common.notes')}</label>
      <textarea id="ph-notes" class="textarea" bind:value={p.notes} oninput={touch}></textarea>
    </div>
    <button class="btn sm danger" onclick={() => removePhoneme(p)}
      ><Trash2 size={14} />{t('common.delete')}</button
    >
  </Portal>
{/if}

{#if lang && tab === 'orthography' && ortho}
  {@const o = ortho}
  <Portal>
    <div class="field">
      <label for="o-name">{t('common.name')}</label><input
        id="o-name"
        class="input"
        bind:value={o.name}
        oninput={touch}
      />
    </div>
    <div class="field">
      <label for="o-font">{t('phonology.font')}</label><input
        id="o-font"
        class="input"
        bind:value={o.font}
        oninput={touch}
        placeholder="Gentium Plus"
      />
    </div>
    <div class="field">
      <label for="o-dir">{t('phonology.direction')}</label>
      <select id="o-dir" class="select" bind:value={o.direction} onchange={touch}>
        <option value="ltr">{t('phonology.dir.ltr')}</option><option value="rtl"
          >{t('phonology.dir.rtl')}</option
        ><option value="ttb">{t('phonology.dir.ttb')}</option>
      </select>
    </div>
    <label class="row check"
      ><input type="radio" name="primary" checked={o.isPrimary} onchange={() => setPrimary(o)} />{t(
        'phonology.primaryHint'
      )}</label
    >
    <div class="field">
      <label for="o-test">{t('phonology.test')}</label>
      <textarea
        id="o-test"
        class="textarea data"
        rows="3"
        bind:value={orthoTest}
        placeholder={t('phonology.testPlaceholder')}
      ></textarea>
      {#if orthoResults.length}
        <table class="res">
          <tbody
            >{#each orthoResults as r (r.w)}<tr
                ><td class="data">{r.w}</td><td class="data out">{r.out}</td></tr
              >{/each}</tbody
          >
        </table>
      {/if}
    </div>
    {#if lang.orthographies.length > 1}
      <button class="btn sm danger" onclick={() => removeOrtho(o)}
        ><Trash2 size={14} />{t('common.delete')}</button
      >
    {/if}
  </Portal>
{/if}

<style>
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
  .scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 18px;
    padding-right: 4px;
  }
  .block {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .manual {
    width: 160px;
  }
  .inv-row {
    display: flex;
    gap: 10px;
    align-items: flex-start;
  }
  .lbl {
    width: 60px;
    flex: none;
    padding-top: 6px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 10px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--bg-elev);
    cursor: pointer;
    font-size: 15px;
  }
  .chip:hover,
  .chip.active {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .chip.big {
    font-size: 14px;
    padding: 4px 12px;
  }
  .chip .x {
    border: 0;
    background: none;
    padding: 0 0 0 2px;
    cursor: pointer;
    color: var(--text-3);
    display: grid;
    place-items: center;
  }
  .chip.gen {
    cursor: default;
  }
  .chip .x.add {
    color: var(--accent-text);
  }
  .sym {
    min-width: 30px;
    height: 28px;
    padding: 0 4px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-elev);
    font-family: var(--font-data);
    font-size: 16px;
    cursor: pointer;
    color: var(--text-3);
  }
  .sym:hover {
    border-color: var(--accent);
  }
  .sym.in {
    background: var(--accent-soft);
    color: var(--accent-text);
    border-color: var(--accent);
    font-weight: 600;
  }
  .ph {
    display: inline-block;
    width: 30px;
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
  .wrap {
    flex-wrap: wrap;
    gap: 4px;
  }
  .cls {
    padding: 8px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .cname {
    width: 110px;
  }
  .mono {
    font-family: var(--font-mono);
  }
  .query {
    gap: 6px;
    flex-wrap: wrap;
  }
  .query .chip {
    font-size: 12px;
    padding: 1px 6px;
  }
  .select.tiny {
    width: 130px;
    padding-top: 2px;
    padding-bottom: 2px;
  }
  .ortho {
    gap: 10px;
  }
  .editor-area {
    flex: 1;
    min-height: 300px;
    display: flex;
    flex-direction: column;
  }
  .src {
    height: 420px;
    display: flex;
  }
  .form {
    max-width: 900px;
  }
  .grid2 {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px 16px;
  }
  .field {
    margin: 0;
  }
  .field > span {
    font-size: 12px;
    color: var(--text-2);
  }
  .check {
    gap: 8px;
  }
  .kv {
    gap: 6px;
    margin-bottom: 4px;
  }
  .dim {
    width: 90px;
    flex: none;
    color: var(--text-2);
    font-family: var(--font-mono);
  }
  .num {
    width: 80px;
  }
  .res {
    border-collapse: collapse;
    font-size: 13px;
  }
  .res td {
    padding: 2px 10px 2px 0;
  }
  .res .out {
    color: var(--accent-text);
  }
  .badge.warn {
    background: var(--warn-soft);
    color: var(--warn);
    margin-right: 4px;
  }
  .big {
    font-size: 22px;
  }
  .self-start {
    align-self: flex-start;
  }
  .tones {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
</style>
