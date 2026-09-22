<script lang="ts">
  import { orthoIpaLabel } from '$lib/ui/labels'
  import { navScroll } from '$lib/ui/navScroll'
  import { scrollToItem } from '$lib/ui/reveal'
  import type { PageView } from '$lib/state/ui.svelte'
  import { platform } from '$lib/platform'
  import Menu from '$lib/ui/Menu.svelte'
  import TableImportDialog from '$lib/ui/TableImportDialog.svelte'
  import { guideUrl } from '$lib/core/guide'
  import { toCsv } from '$lib/core/csv'
  import { normalizeSentence } from '$lib/core/sentenceDedup'
  import {
    importPhraseRecords,
    importPhrasesJson,
    previewPhrasesJson,
    phraseFields,
    phrasesToJson,
    phrasesToRows
  } from '$lib/importers/corpusIO'
  import { matchQuery, parseQuery } from '$lib/core/query'
  import { SEARCH_FIELDS } from '$lib/core/searchFields'
  /** 短语簿：分类 → 短语；检视器编辑原文、译文、发音、变体、标签。 */
  import { projectState } from '$lib/state/project.svelte'
  import { ui } from '$lib/state/ui.svelte'
  import { t, pickText } from '$lib/i18n/index.svelte'
  import { createPhrase } from '$lib/core/factory'
  import type { Id, Phrase, Token } from '$lib/core/model'
  import { transcribe } from '$lib/core/pronounce'
  import { textScript } from '$lib/script/lexiconScript'
  import { fontCss } from '$lib/script/fonts'
  import { analyzeToken, glossIndexFor } from '$lib/engine/gloss'
  import { WordResolver } from '$lib/engine/gloss/resolve'
  import { tokenSpans, type TokenizeOptions } from '$lib/engine/gloss/tokens'
  import { replaceWordIfSame } from '$lib/engine/gloss/rewrite'
  import {
    wordHover,
    type HoverAssign,
    type HoverChoice,
    type HoverPart
  } from '$lib/state/wordHover.svelte'
  import Portal from '$lib/ui/Portal.svelte'
  import Hint from '$lib/ui/Hint.svelte'
  import TagInput from '$lib/ui/TagInput.svelte'
  import LocalizedInput from '$lib/ui/LocalizedInput.svelte'
  import { Plus, Trash2, X, Wand2, Upload, Download } from '@lucide/svelte'
  import GuideLink from '$lib/ui/GuideLink.svelte'
  import HelpDot from '$lib/ui/HelpDot.svelte'
  import { sortable } from '$lib/ui/sortable.svelte'
  import { moveById } from '$lib/core/move'

  let { inspectorTitle = $bindable('') }: { inspectorTitle?: string } = $props()

  const project = $derived(projectState.project!)
  const glossLangs = $derived(project.settings.glossLanguages)
  const langId = $derived(
    projectState.currentLanguageId ??
      project.settings.defaultLanguageId ??
      project.languages[0]?.id ??
      null
  )
  const language = $derived(project.languages.find((l) => l.id === langId) ?? null)

  /** 回到这一页时接着用上次的分类与选中的短语；换了语言就不恢复 */
  const memo = ui.memo<{ lang: Id | null; selectedId: Id | null; category: string }>('phrasebook')
  const sameLang = memo.lang === projectState.currentLanguageId
  let selectedId = $state<Id | null>(sameLang ? (memo.selectedId ?? null) : null)
  let category = $state<string>(sameLang ? (memo.category ?? '') : '')
  /** 表格导入对话框 */
  let importOpen = $state(false)
  /** 导入面板一打开先去选 JSON（菜单里点的是「从 JSON 导入」）；每点一次菜单都重开一次面板 */
  let importJson = $state(false)
  let importNonce = $state(0)
  const query = $derived(ui.search)

  const inLang = $derived(project.phrasebook.filter((p) => !langId || p.languageId === langId))
  const categories = $derived([...new Set(inLang.map((p) => p.category).filter(Boolean))].sort())
  const list = $derived.by(() => {
    const pq = parseQuery(query, SEARCH_FIELDS.phrasebook)
    return inLang.filter(
      (p) =>
        (!category || p.category === category) &&
        (!pq.terms.length || matchQuery(pq, (f) => phraseFieldValues(p, f)))
    )
  })
  /** 搜索用：短语在某个字段里的文字 */
  function phraseFieldValues(p: Phrase, field: string | null): string[] {
    const tr = Object.values(p.translation)
    switch (field) {
      case 'text':
        return [p.text, ...p.variants.map((v) => v.text)]
      case 'tr':
        return tr
      case 'category':
        return [p.category]
      case 'tag':
        return p.tags
      case 'ipa':
        return Object.values(p.pronunciations).map((x) => x.ipa)
      default:
        return [p.text, ...tr]
    }
  }
  const selected = $derived(project.phrasebook.find((p) => p.id === selectedId) ?? null)
  const allTags = $derived([...new Set(project.phrasebook.flatMap((p) => p.tags))].sort())
  /** 悬浮认词：跟语料页共用一套判断（engine/gloss/resolve.ts）；项目一改就换一个新的 */
  let resolverCache: { key: string; r: WordResolver } | null = null
  function resolver(): WordResolver {
    const key = (langId ?? '') + '|' + project.meta.updatedAt
    if (resolverCache?.key !== key) resolverCache = { key, r: new WordResolver(project, langId) }
    return resolverCache.r
  }
  /** 同一个写法只分析一次：列表里每个词都要判断能不能点 */
  let tokenCache: { key: string; m: Map<string, Token> } | null = null
  /** 把短语里的一个词当成语料里的词看：分析出来交给上面那套认词 */
  function tokenOf(word: string): Token {
    const key = (langId ?? '') + '|' + project.meta.updatedAt
    if (tokenCache?.key !== key) tokenCache = { key, m: new Map() }
    let tk = tokenCache.m.get(word)
    if (!tk) {
      const analyses = langId
        ? analyzeToken(glossIndexFor(project, langId), word, project.settings.morphemeBoundaries)
        : []
      const i = analyses.findIndex((a) => a.lexemeId)
      tk = { surface: word, analyses, chosen: Math.max(0, i), confirmed: false }
      tokenCache.m.set(word, tk)
    }
    return tk
  }
  /** 短语原文切成段：word 为真的那些能悬浮，wi 是它在原文里的第几个词（改写原文按它定位） */
  function spansOf(p: Phrase): { text: string; word: boolean; wi: number }[] {
    let wi = -1
    return tokenSpans(p.text, tokenizeOpts(p.languageId)).map((s) => ({
      ...s,
      wi: s.word ? ++wi : -1
    }))
  }
  /** 跟语料一致的切法 */
  function tokenizeOpts(languageId: Id): TokenizeOptions {
    return {
      mode: project.settings.tokenizer,
      pattern: project.settings.tokenizerPattern,
      letters:
        glossIndexFor(project, languageId).wordChars + (project.settings.tokenizerLetters ?? '')
    }
  }
  const linkable = (word: string): boolean => resolver().linkable(tokenOf(word))
  /**
   * 悬浮卡里「改」：短语不存分析，只改得了原文——把这一处换成挑中词条 / 语素的写法。
   * 按位置核对过原文没变才改；原文变了发音跟着重算（手改过的不动）。
   */
  function rewriteWord(id: Id, wi: number, surface: string, c: HoverChoice): void {
    const p = project.phrasebook.find((x) => x.id === id)
    if (!p) return
    const l = c.lexemeId ? project.lexemes.find((x) => x.id === c.lexemeId) : undefined
    const m = c.morphemeId ? project.morphemes.find((x) => x.id === c.morphemeId) : undefined
    const spelling = (l?.lemma ?? m?.form ?? '').replace(/^[-=·]+|[-=·]+$/g, '').trim()
    if (!spelling) return
    const next = replaceWordIfSame(p.text, wi, surface, spelling, tokenizeOpts(p.languageId))
    if (next === p.text) return
    p.text = next
    derivePron(p)
  }
  function assignOf(p: Phrase, wi: number, surface: string): HoverAssign {
    const id = p.id
    return {
      languageId: p.languageId,
      surface,
      textOnly: true,
      onAssign: (_index, c) => rewriteWord(id, wi, surface, c)
    }
  }
  function hoverWord(e: MouseEvent, p: Phrase, wi: number, word: string): void {
    const tk = tokenOf(word)
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    // 切分只给看：短语改不了单独一段，没认出来的那一段也不标成「点开指定」
    const parts: HoverPart[] = resolver()
      .hoverParts(tk)
      .map((x) => ({ ...x, missing: false }))
    const assign = assignOf(p, wi, word)
    const target = resolver().resolveWord(tk)
    if (target?.lexemeId) wordHover.show(target.lexemeId, rect, parts, assign)
    else if (target?.morphemeId) wordHover.showMorpheme(target.morphemeId, rect, parts, assign)
    else wordHover.showMissing(word, null, rect, parts, assign)
  }
  function clickWord(e: MouseEvent, word: string): void {
    const target = resolver().resolveWord(tokenOf(word))
    if (!target) return
    e.stopPropagation()
    wordHover.hide(true)
    if (target.morphemeId) {
      const m = project.morphemes.find((x) => x.id === target.morphemeId)
      ui.jump('morphemes', 'morpheme', target.morphemeId, m?.languageId)
      return
    }
    const id = target.lexemeId!
    ui.jump('lexicon', 'lexeme', id, project.lexemes.find((l) => l.id === id)?.languageId)
  }

  $effect(() => {
    inspectorTitle = importOpen
      ? t('importPreview.title')
      : selected
        ? t('phrasebook.phrase')
        : t('phrasebook.title')
  })
  $effect(() => {
    const id = ui.takePending('phrase')
    if (id) reveal(id)
  })
  // 「返回」用：报上当前位置，返回时原样恢复
  $effect(() => {
    ui.reportView('phrasebook', {
      kind: 'phrase',
      lang: projectState.currentLanguageId,
      id: selectedId,
      category
    })
  })
  $effect(() => {
    const r = ui.takeRestore('phrasebook')
    if (!r) return
    const v: PageView = r.view ?? {}
    selectedId = v.id ?? null
    category = v.category ?? ''
    ui.restoreScroll('phrasebook', r.scroll)
  })
  $effect(() => {
    Object.assign(memo, { lang: projectState.currentLanguageId, selectedId, category })
  })
  if (sameLang && !ui.restoring('phrasebook'))
    ui.restoreScroll('phrasebook', ui.lastScroll('phrasebook'))
  /** 从别处跳过来：清掉筛选、选中、滚过去闪一下 */
  let flashId = $state<Id | null>(null)
  function reveal(id: Id): void {
    const ph = project.phrasebook.find((x) => x.id === id)
    if (!ph) return
    if (langId && ph.languageId !== langId) projectState.currentLanguageId = ph.languageId
    category = ''
    ui.search = ''
    selectedId = id
    void scrollToItem('phrasebook', `.item[data-id="${id}"]`).then(() => flash(id))
  }
  /** 滚到了再闪：高亮从头到尾都看得见 */
  function flash(id: Id): void {
    flashId = id
    setTimeout(() => {
      if (flashId === id) flashId = null
    }, 1800)
  }

  function touch(): void {
    projectState.touch()
  }
  function add(): void {
    if (!langId) return
    const p = createPhrase(langId, category)
    project.phrasebook.unshift(p)
    selectedId = p.id
    touch()
    queueMicrotask(() => document.getElementById('ph-text')?.focus())
  }
  function remove(p: Phrase): void {
    const idx = project.phrasebook.indexOf(p)
    const snap = $state.snapshot(p) as Phrase
    project.phrasebook.splice(idx, 1)
    if (selectedId === p.id) selectedId = null
    touch()
    ui.toast(t('phrasebook.deleted'), {
      action: {
        label: t('common.undo'),
        run: () => {
          project.phrasebook.splice(Math.min(idx, project.phrasebook.length), 0, snap)
          selectedId = snap.id
          touch()
        }
      }
    })
  }
  /**
   * 按规则标音：手改过（不规则）的默认不动；有没动的，提示条里可以一并按规则重算（force）。
   */
  function derivePron(p: Phrase, force = false): void {
    if (!language) return
    let kept = 0
    for (const o of language.orthographies) {
      const ipa = transcribe(language, o, p.text)
      if (ipa == null) continue
      const cur = p.pronunciations[o.id]
      if (cur?.irregular && !force) {
        if (cur.ipa !== ipa) kept++
        continue
      }
      p.pronunciations[o.id] = { ipa, irregular: false }
    }
    touch()
    if (kept)
      ui.toast(t('phrasebook.pronKept', { n: kept }), {
        action: { label: t('phrasebook.pronOverwrite'), run: () => derivePron(p, true) }
      })
  }
  /** 勾掉「不规则」：这一套正字法马上按规则重算 */
  function setIrregular(p: Phrase, orthoId: string, on: boolean): void {
    const o = language?.orthographies.find((x) => x.id === orthoId)
    if (!language || !o) return
    const cur = p.pronunciations[orthoId]?.ipa ?? ''
    p.pronunciations[orthoId] = on
      ? { ipa: cur, irregular: true }
      : { ipa: transcribe(language, o, p.text) ?? cur, irregular: false }
    touch()
  }
  /** 导出当前列表里的短语（跟着当前语言、分类与搜索走） */
  async function exportPhrases(kind: 'csv' | 'json'): Promise<void> {
    const base = `${language?.name ?? project.meta.name}-phrasebook`
    if (kind === 'csv')
      await platform.saveTextFile(`${base}.csv`, '\ufeff' + toCsv(phrasesToRows(list, glossLangs)))
    else await platform.saveTextFile(`${base}.json`, phrasesToJson(list))
  }
  function openImport(jsonFirst: boolean): void {
    importJson = jsonFirst
    importNonce++
    importOpen = true
  }
  /** 导入面板里选了千语集导出的 JSON */
  function runPhrasesJson(content: string): void {
    if (!langId) return
    const r = importPhrasesJson(project, langId, content)
    if (!r) {
      ui.error(t('io.badJson'))
      return
    }
    importOpen = false
    touch()
    ui.toast(t('io.imported', { n: r.created, skipped: r.skipped }))
  }
  /** 这门语言里已经有的原文（规范化后）：导入样例拿它标「会跳过」 */
  const existingTexts = $derived(
    new Set(
      project.phrasebook
        .filter((p) => p.languageId === langId)
        .map((p) => normalizeSentence(p.text))
    )
  )
  function importPhraseTable(records: Record<string, string>[]): void {
    if (!langId) return
    const r = importPhraseRecords(project, langId, records)
    importOpen = false
    touch()
    ui.toast(t('io.imported', { n: r.created, skipped: r.skipped }))
  }
  async function renameCategory(): Promise<void> {
    if (!category) return
    const name = (await ui.prompt(t('phrasebook.category'), category))?.trim()
    if (!name || name === category) return
    for (const p of inLang) if (p.category === category) p.category = name
    category = name
    touch()
  }
</script>

<div class="page">
  <div class="page-head row">
    <h1>{t('phrasebook.title')}</h1>
    <GuideLink section="phrasebook" />
    <span class="grow"></span>
    {#if language}
      <Menu label={t('lexicon.import')} icon={Download} tour="phrasebook-io">
        <button onclick={() => openImport(false)}>{t('io.importTable')}</button>
        <button onclick={() => openImport(true)}>{t('io.importJson')}</button>
      </Menu>
      <Menu label={t('common.export')} icon={Upload} tour="phrasebook-io">
        <button onclick={() => exportPhrases('csv')}>{t('io.exportCsv')}</button>
        <button onclick={() => exportPhrases('json')}>{t('io.exportJsonPlain')}</button>
      </Menu>
    {/if}
    <button class="btn primary" data-tour="phrasebook-add" onclick={add}
      ><Plus size={16} />{t('phrasebook.add')}</button
    >
  </div>
  <Hint id="phrasebook" text={t('phrasebook.hint')} />
  {#if importOpen && language}
    <div class="scroll">
      {#key importNonce}
        <TableImportDialog
          title={t('io.importPhrases')}
          fields={phraseFields(glossLangs, language)}
          guide={guideUrl('phrasebook', 'table-format')}
          exists={(text) => existingTexts.has(normalizeSentence(text))}
          json={{
            preview: (content) => (langId ? previewPhrasesJson(project, langId, content) : null),
            run: runPhrasesJson
          }}
          startWithJson={importJson}
          onimport={importPhraseTable}
          onclose={() => (importOpen = false)}
        />
      {/key}
    </div>
  {:else if !language}
    <p class="muted">{t('lexicon.noLanguage')}</p>
  {:else}
    <div class="body">
      <aside class="cats" data-tour="phrasebook-cats">
        <button class="cat" class:active={category === ''} onclick={() => (category = '')}
          >{t('phrasebook.allCategories')}<span class="n">{inLang.length}</span></button
        >
        {#each categories as c (c)}
          <button
            class="cat"
            class:active={category === c}
            onclick={() => (category = c)}
            ondblclick={renameCategory}
            >{c}<span class="n">{inLang.filter((p) => p.category === c).length}</span></button
          >
        {/each}
        {#if categories.length === 0}<p class="tiny muted">{t('phrasebook.noCategories')}</p>{/if}
      </aside>
      <div class="scroll" use:navScroll={'phrasebook'}>
        {#if list.length === 0}
          <p class="muted">{t('phrasebook.empty')}</p>
        {:else}
          <div class="list">
            {#each list as p, pi (p.id)}
              <div
                class="card item"
                data-id={p.id}
                class:sel={selectedId === p.id}
                class:flash={flashId === p.id}
                role="button"
                tabindex="0"
                {...sortable('phrases', pi, (from, to) => {
                  if (moveById(project.phrasebook, list[from].id, list[to].id)) touch()
                })}
                onclick={() => (selectedId = p.id)}
                onkeydown={(e) => e.key === 'Enter' && (selectedId = p.id)}
              >
                {#each language.scripts as sc (sc.id)}
                  {@const st = textScript(project, language, sc, p.text)}
                  {#if st}<div
                      class="scr"
                      style={fontCss(sc)}
                      dir={sc.direction === 'rtl' ? 'rtl' : 'ltr'}
                    >
                      {st}
                    </div>{/if}
                {/each}
                <div class="row">
                  <span class="data text grow words"
                    >{#each spansOf(p) as sp, i (i)}{#if sp.word}<span
                          class="w"
                          class:link={linkable(sp.text)}
                          role="link"
                          tabindex="-1"
                          onmouseenter={(e) => hoverWord(e, p, sp.wi, sp.text)}
                          onmouseleave={() => wordHover.hide()}
                          onclick={(e) => clickWord(e, sp.text)}
                          onkeydown={() => {}}>{sp.text}</span
                        >{:else}{sp.text}{/if}{/each}{#if !p.text}—{/if}</span
                  >
                  {#if p.category && !category}<span class="badge">{p.category}</span>{/if}
                </div>
                {#each language.orthographies as o (o.id)}
                  {#if p.pronunciations[o.id]?.ipa}<div class="small data muted">
                      /{p.pronunciations[o.id].ipa}/
                    </div>{/if}
                {/each}
                <div class="small tr">{pickText(p.translation, glossLangs)}</div>
                {#if p.variants.length}<div class="tiny muted">
                    {p.variants.map((v) => v.text).join(' · ')}
                  </div>{/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>

{#if selected && language && !importOpen}
  {@const p = selected}
  <Portal>
    <div class="field">
      <label for="ph-text">{t('phrasebook.text')}</label>
      <textarea
        id="ph-text"
        class="textarea data"
        rows="2"
        bind:value={p.text}
        oninput={touch}
        onchange={() => derivePron(p)}
      ></textarea>
    </div>
    <div class="field">
      <span class="small muted">{t('corpus.translation')}</span>
      <LocalizedInput bind:value={p.translation} languages={glossLangs} onchange={touch} />
    </div>
    <div class="field">
      <label for="ph-cat">{t('phrasebook.category')}</label>
      <input id="ph-cat" class="input" list="ph-cats" bind:value={p.category} oninput={touch} />
      <datalist id="ph-cats"
        >{#each categories as c (c)}<option value={c}></option>{/each}</datalist
      >
    </div>
    <div class="field">
      <div class="row">
        <span class="small muted grow">{t('lexicon.pronunciations')}</span><button
          class="btn ghost sm"
          onclick={() => derivePron(p)}><Wand2 size={13} />{t('phrasebook.derivePron')}</button
        >
      </div>
      {#each language.orthographies as o (o.id)}
        <div class="row kv">
          <span class="small oname" title={o.name}
            >{orthoIpaLabel(o.name, language.orthographies.length)}</span
          >
          <input
            class="input data"
            value={p.pronunciations[o.id]?.ipa ?? ''}
            oninput={(e) => {
              p.pronunciations[o.id] = {
                ipa: (e.currentTarget as HTMLInputElement).value,
                irregular: true
              }
              touch()
            }}
          />
          <label class="row small" title={t('lexicon.irregular')}
            ><input
              type="checkbox"
              checked={p.pronunciations[o.id]?.irregular ?? false}
              onchange={(e) => setIrregular(p, o.id, (e.currentTarget as HTMLInputElement).checked)}
            />!</label
          >
        </div>
      {/each}
    </div>
    <div class="field">
      <div class="row">
        <span class="small muted">{t('phrasebook.variants')}</span><HelpDot key="variants" /><span
          class="grow"
        ></span><button
          class="btn ghost sm"
          onclick={() => {
            p.variants.push({ text: '', note: '' })
            touch()
          }}><Plus size={13} />{t('common.add')}</button
        >
      </div>
      {#each p.variants as v, i (i)}
        <div class="row kv">
          <input
            class="input data grow"
            placeholder={t('phrasebook.variantText')}
            bind:value={v.text}
            oninput={touch}
          />
          <input
            class="input grow"
            placeholder={t('phrasebook.variantNote')}
            bind:value={v.note}
            oninput={touch}
          />
          <button
            class="btn ghost icon sm"
            onclick={() => {
              p.variants.splice(i, 1)
              touch()
            }}><X size={14} /></button
          >
        </div>
      {/each}
    </div>
    <div class="field">
      <span class="small muted">{t('common.tags')}</span>
      <TagInput bind:tags={p.tags} suggestions={allTags} onchange={touch} />
    </div>
    <button class="btn sm danger" onclick={() => remove(p)}
      ><Trash2 size={14} />{t('common.delete')}</button
    >
  </Portal>
{/if}

<style>
  .item.flash {
    animation: jump-flash 1.8s ease-out;
  }
  @keyframes jump-flash {
    0%,
    35% {
      background: color-mix(in srgb, var(--accent) 26%, transparent);
      border-color: var(--accent);
    }
    100% {
      background: var(--bg-elev);
    }
  }
  .link {
    cursor: pointer;
    border-radius: 3px;
  }
  .link:hover {
    background: var(--accent-soft);
    color: var(--accent-text);
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
  }
  .body {
    flex: 1;
    min-height: 0;
    display: flex;
    gap: 16px;
  }
  .cats {
    width: 180px;
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow: auto;
  }
  .cat {
    display: flex;
    align-items: center;
    gap: 6px;
    text-align: left;
    border: 0;
    background: none;
    padding: 5px 8px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    color: var(--text-2);
    font-size: 13px;
  }
  .cat:hover {
    background: var(--bg-hover);
  }
  .cat.active {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .cat.active .n {
    color: var(--text-2);
  }
  .cat .n {
    margin-left: auto;
    font-size: 11px;
    color: var(--text-3);
  }
  .scroll {
    flex: 1;
    min-width: 0;
    overflow: auto;
    padding-right: 4px;
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .item {
    padding: 8px 12px;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .item:hover {
    border-color: var(--border-strong);
  }
  .item.sel {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }
  .text {
    font-size: 15px;
    font-family: var(--font-corpus-text);
  }
  .tr {
    font-family: var(--font-corpus-tr);
    color: var(--text-2);
  }
  .scr {
    font-size: 20px;
    line-height: 1.3;
  }
  .kv {
    gap: 6px;
    margin-bottom: 4px;
  }
  .oname {
    width: 124px;
    flex: none;
    color: var(--text-2);
  }
  .tiny {
    font-size: 11px;
  }
</style>
