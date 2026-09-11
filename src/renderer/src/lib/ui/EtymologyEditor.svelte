<script lang="ts">
  /**
   * 词源编辑器：词条与语素共用。
   * 链条读作「来源 > 中间态… > 本身」，选定类别后来源框会给出对应的选择器。
   */
  import { t, pickText } from '$lib/i18n/index.svelte'
  import { morphemeLabel, looseKey } from '$lib/core/etymology'
  import { newId } from '$lib/core/factory'
  import {
    ETYMOLOGY_TYPES,
    type Etymology,
    type EtymologySource,
    type Id,
    type Project
  } from '$lib/core/model'
  import { Plus, X, ArrowRight } from '@lucide/svelte'

  let {
    etymology = $bindable(),
    project,
    ownerId,
    ownerForm,
    glossLangs = [],
    onchange
  }: {
    etymology: Etymology
    project: Project
    ownerId: Id
    ownerForm: string
    glossLangs?: string[]
    onchange: () => void
  } = $props()

  const isCustomType = $derived(!(ETYMOLOGY_TYPES as readonly string[]).includes(etymology.type))
  /** 词根来源按惯例加星号 */
  const star = $derived(etymology.type === 'root' ? '*' : '')

  function sourceText(s: EtymologySource): string {
    if (s.kind === 'morpheme') {
      const m = project.morphemes.find((x) => x.id === s.id)
      return m ? morphemeLabel(m) : ''
    }
    if (s.kind === 'lexeme') return project.lexemes.find((m) => m.id === s.id)?.lemma ?? ''
    return s.form
  }
  /** 正在挑来源的那一条（按序号），以及搜索词 */
  let picking = $state<number | null>(null)
  let query = $state('')
  const matches = $derived.by(() => {
    if (picking === null) return []
    const src = etymology.sources[picking]
    if (!src || src.kind === 'external') return []
    const q = query.trim().toLowerCase()
    const ignores = new Map(project.languages.map((l) => [l.id, l.matchIgnore ?? '']))
    const queryKeys = new Map<string, string>()
    /** 忽略大小写、附加符和那门语言设置的忽略字符再比；查询全是被忽略的字符时不算命中 */
    const looseHit = (text: string, languageId: string): boolean => {
      let k = queryKeys.get(languageId)
      if (k === undefined) {
        k = looseKey(q, ignores.get(languageId) ?? '')
        queryKeys.set(languageId, k)
      }
      return k.length > 0 && looseKey(text, ignores.get(languageId) ?? '').includes(k)
    }
    if (src.kind === 'morpheme') {
      const all = project.morphemes.filter((m) => m.id !== ownerId)
      const hit = q
        ? all.filter(
            (m) =>
              morphemeLabel(m).toLowerCase().includes(q) ||
              // 模糊：H1ANG 用 hang 也能搜到，长音符、成音节符号不用打
              looseHit(morphemeLabel(m), m.languageId) ||
              m.form2.toLowerCase().includes(q) ||
              m.gloss.toLowerCase().includes(q) ||
              // 也能按「环缀」「后缀」这类类型名搜
              t(`morphemes.types.${m.type}`).includes(q) ||
              m.tags.some((x) => x.toLowerCase().includes(q)) ||
              Object.values(m.meaning).some((v) => v.toLowerCase().includes(q))
          )
        : all
      return hit.slice(0, 30).map((m) => ({
        id: m.id,
        label: morphemeLabel(m),
        tag: t(`morphemes.types.${m.type}`),
        note: m.gloss || pickText(m.meaning, glossLangs)
      }))
    }
    const all = project.lexemes.filter((l) => l.id !== ownerId)
    const hit = q
      ? all.filter(
          (l) =>
            l.lemma.toLowerCase().includes(q) ||
            looseHit(l.lemma, l.languageId) ||
            l.senses.some((se) =>
              Object.values(se.definition).some((d) => d.toLowerCase().includes(q))
            )
        )
      : all
    return hit.slice(0, 30).map((l) => ({
      id: l.id,
      label: l.lemma,
      tag: '',
      note: pickText(l.senses[0]?.definition, glossLangs)
    }))
  })
  function startPick(i: number): void {
    picking = picking === i ? null : i
    query = ''
  }
  function choose(i: number, id: Id): void {
    const src = etymology.sources[i]
    if (!src || src.kind === 'external') return
    src.id = id
    picking = null
    syncRelations()
    onchange()
  }
  /** 类别决定新来源默认从哪里挑 */
  function defaultKind(): EtymologySource['kind'] {
    if (etymology.type === 'root') return 'morpheme'
    if (etymology.type === 'borrowing') return 'external'
    return 'lexeme'
  }
  function addSource(kind: EtymologySource['kind'] = defaultKind()): void {
    if (kind === 'external') etymology.sources.push({ kind, language: '', form: '', meaning: '' })
    else etymology.sources.push({ kind, id: '' })
    onchange()
  }
  function removeSource(i: number): void {
    etymology.sources.splice(i, 1)
    onchange()
  }
  function addStage(): void {
    etymology.stages.push({ id: newId(), form: '', type: '', notes: '' })
    onchange()
  }
  function onTypeChange(v: string): void {
    etymology.type = v === '__custom__' ? '' : v
    if (v !== '__custom__' && !etymology.sources.length) addSource()
    syncRelations()
    onchange()
  }
  /** 词条来源自动进入关系图，关系种类就用词源类别 */
  function syncRelations(): void {
    const owner = project.lexemes.find((l) => l.id === ownerId)
    if (!owner) return
    const kind = etymology.type || 'unknown'
    for (const s of etymology.sources) {
      if (s.kind !== 'lexeme' || !s.id) continue
      if (owner.relations.some((r) => r.lexemeId === s.id && r.kind === kind)) continue
      owner.relations.push({ kind, lexemeId: s.id })
    }
  }
  const chain = $derived([
    etymology.sources.map((s) => star + sourceText(s)).filter((x) => x !== star && x),
    ...etymology.stages.map((s) => (s.form ? [s.form] : [])),
    [ownerForm || t('lexicon.etyThisWord')]
  ])
</script>

<div class="ety">
  <div class="row two">
    <select
      class="select"
      value={isCustomType ? '__custom__' : etymology.type}
      onchange={(e) => onTypeChange((e.currentTarget as HTMLSelectElement).value)}
    >
      {#each ETYMOLOGY_TYPES as et (et)}<option value={et}>{t(`lexicon.etyTypes.${et}`)}</option
        >{/each}
      <option value="__custom__">{t('lexicon.customKind')}</option>
    </select>
    {#if isCustomType}
      <input
        class="input"
        placeholder={t('lexicon.etyCustomType')}
        bind:value={etymology.type}
        {onchange}
      />
    {/if}
  </div>

  <div class="chain small">
    {#each chain as step, i (i)}
      {#if i > 0}<ArrowRight size={12} class="arrow" />{/if}
      {#if step.length === 0}
        <span class="pending">{t('lexicon.etyPending')}</span>
      {:else}
        <span class="step data">{step.join(' + ')}</span>
      {/if}
    {/each}
  </div>

  {#each etymology.sources as s, i (i)}
    <div class="row src">
      {#if s.kind === 'external'}
        <span class="badge">{t('lexicon.sourceKinds.external')}</span>
        <input
          class="input lang"
          placeholder={t('lexicon.externalLanguage')}
          bind:value={s.language}
          oninput={onchange}
        />
        <input
          class="input data grow"
          placeholder={t('lexicon.externalForm')}
          bind:value={s.form}
          oninput={onchange}
        />
        <input
          class="input"
          placeholder={t('lexicon.externalMeaning')}
          bind:value={s.meaning}
          oninput={onchange}
        />
      {:else}
        <span class="badge">{t(`lexicon.sourceKinds.${s.kind}`)}</span>
        {#if s.kind === 'morpheme' && star}<span class="star">*</span>{/if}
        <button
          class="input data grow pick"
          class:empty={!sourceText(s)}
          onclick={() => startPick(i)}
          >{sourceText(s) ||
            (s.kind === 'morpheme' ? t('lexicon.pickMorpheme') : t('lexicon.pickLexeme'))}</button
        >
      {/if}
      <button class="btn ghost icon sm" onclick={() => removeSource(i)}><X size={14} /></button>
    </div>
    {#if picking === i}
      <div class="picker card">
        <input
          class="input"
          placeholder={t('lexicon.searchSource')}
          bind:value={query}
          onkeydown={(e) => e.key === 'Escape' && (picking = null)}
        />
        <div class="hits">
          {#each matches as m (m.id)}
            <button class="hit" onclick={() => choose(i, m.id)}>
              <span class="data">{m.label}</span>
              {#if m.tag}<span class="badge">{m.tag}</span>{/if}
              <span class="small muted grow note">{m.note}</span>
            </button>
          {:else}
            <span class="small muted pad">{t('common.noResults')}</span>
          {/each}
        </div>
      </div>
    {/if}
  {/each}

  <div class="row wrap">
    <button class="btn ghost sm" onclick={() => addSource('morpheme')}
      ><Plus size={14} />{t('lexicon.sourceKinds.morpheme')}</button
    >
    <button class="btn ghost sm" onclick={() => addSource('lexeme')}
      ><Plus size={14} />{t('lexicon.sourceKinds.lexeme')}</button
    >
    <button class="btn ghost sm" onclick={() => addSource('external')}
      ><Plus size={14} />{t('lexicon.sourceKinds.external')}</button
    >
    <span class="grow"></span>
    <button class="btn ghost sm" onclick={addStage}
      ><Plus size={14} />{t('lexicon.etyAddStage')}</button
    >
  </div>

  {#each etymology.stages as st, i (st.id)}
    <div class="row src">
      <span class="badge">{t('lexicon.etyStage', { n: i + 1 })}</span>
      <input
        class="input data grow"
        placeholder={t('lexicon.etyStageForm')}
        bind:value={st.form}
        oninput={onchange}
      />
      <input
        class="input lang"
        placeholder={t('lexicon.etyStageType')}
        bind:value={st.type}
        oninput={onchange}
      />
      <button
        class="btn ghost icon sm"
        onclick={() => {
          etymology.stages.splice(i, 1)
          onchange()
        }}><X size={14} /></button
      >
    </div>
  {/each}

  <textarea
    class="textarea"
    rows="2"
    placeholder={t('common.notes')}
    bind:value={etymology.notes}
    oninput={onchange}
  ></textarea>
</div>

<style>
  .ety {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .chain {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
    padding: 4px 6px;
    background: var(--bg-sunken);
    border-radius: 6px;
  }
  .chain :global(.arrow) {
    color: var(--text-3);
    flex: none;
  }
  .step {
    font-weight: 600;
  }
  .pending {
    color: var(--text-3);
    border: 1px dashed var(--border);
    border-radius: 4px;
    padding: 0 4px;
  }
  .src {
    gap: 4px;
  }
  .src .lang {
    width: 84px;
  }
  .star {
    color: var(--text-3);
  }
  .pick {
    text-align: left;
    cursor: pointer;
  }
  .pick.empty {
    color: var(--text-3);
  }
  .picker {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px;
    margin: -2px 0 4px;
  }
  .hits {
    display: flex;
    flex-direction: column;
    max-height: 200px;
    overflow: auto;
  }
  .hit {
    display: flex;
    align-items: baseline;
    gap: 6px;
    padding: 3px 6px;
    border: 0;
    background: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    text-align: left;
    color: inherit;
  }
  .hit:hover {
    background: var(--bg-hover);
  }
  .hit .note {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pad {
    padding: 4px 6px;
  }
  .wrap {
    flex-wrap: wrap;
    gap: 4px;
  }
</style>
