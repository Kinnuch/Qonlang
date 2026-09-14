<script lang="ts">
  /**
   * 关系图的对比视图：跟中心词同一个词根来源的几个词并排比。
   * 上面挑词根（几组）和要比的词（最多 6 个）；表里一行一项：发音、意思（几个词共有的意思成分标底色）、
   * 从词根到这个词的来源链、一路加进来的成分（只有部分词有的高亮）、按音变规则集重推的音变，
   * 以及词类、语域、标签、方言（不一样的标出来）。
   * 下面是同一套规则里只有部分词经历的音变，和跨语言时词根里的每个音在各个词里变成了什么。
   */
  import type { Id, Lexeme, Project } from '$lib/core/model'
  import { t, pickText } from '$lib/i18n/index.svelte'
  import {
    compareContext,
    correspondences,
    meaningPieces,
    soundPathOfWord,
    wordPath,
    type CompareGroup,
    type ProgramCache,
    type RootRef
  } from '$lib/core/compare'
  import { etymologyTypeLabel, pronText } from '$lib/ui/labels'
  import { posText } from '$lib/core/pos'
  import { ArrowLeft, TriangleAlert } from '@lucide/svelte'

  let {
    project,
    center,
    groups,
    onselect,
    onback
  }: {
    project: Project
    center: Lexeme
    groups: CompareGroup[]
    onselect: (id: Id) => void
    onback: () => void
  } = $props()

  const MAX_COLS = 6
  const glossLangs = $derived(project.settings.glossLanguages)

  /** 选中的词根（按 key 记，中心词换了、组的顺序变了也不乱） */
  let rootKey = $state('')
  const group = $derived(groups.find((g) => g.root.key === rootKey) ?? groups[0])
  /** 每组勾了哪些词；没动过的组默认中心词和排在前面的三个（别的语言的排在前面） */
  let pickedByRoot = $state<Record<string, Id[]>>({})
  const picks = $derived(
    pickedByRoot[`${center.id}|${group.root.key}`] ?? group.lexemes.slice(0, 4).map((l) => l.id)
  )
  function toggle(id: Id): void {
    const k = `${center.id}|${group.root.key}`
    const cur = picks
    pickedByRoot = {
      ...pickedByRoot,
      [k]: cur.includes(id)
        ? cur.filter((x) => x !== id)
        : cur.length >= MAX_COLS
          ? cur
          : [...cur, id]
    }
  }

  const langName = (id: Id): string => project.languages.find((l) => l.id === id)?.name ?? ''
  const langAbbr = (id: Id): string => {
    const l = project.languages.find((x) => x.id === id)
    return l?.abbr || l?.name || ''
  }

  const cols = $derived.by(() => {
    const ctx = compareContext(project, glossLangs)
    const cache: ProgramCache = new Map()
    const ids = new Set(picks)
    return group.lexemes
      .filter((l) => ids.has(l.id))
      .map((w) => {
        const path = wordPath(ctx, w, group.root.key)
        const sound = soundPathOfWord(ctx, cache, w, path)
        const defs = w.senses.map((s) => pickText(s.definition, glossLangs)).filter(Boolean)
        const lang = project.languages.find((l) => l.id === w.languageId)
        const pos = project.posList.find((p) => p.id === w.posId)
        const ortho = lang?.orthographies.find((o) => o.isPrimary) ?? lang?.orthographies[0]
        return {
          w,
          path,
          sound,
          defs,
          pieces: meaningPieces(defs.join('；')),
          langName: lang?.name ?? '',
          pos: pos ? posText(pos, glossLangs) : '',
          ipa: ortho ? (w.pronunciations[ortho.id]?.ipa ?? '') : '',
          registers: [...new Set(w.senses.flatMap((s) => s.registers ?? []))].join('、'),
          tags: w.tags.join('、'),
          dialects: (lang?.dialects ?? [])
            .filter((d) => w.dialectIds.includes(d.id))
            .map((d) => d.name)
            .join('、')
        }
      })
  })

  /** 几个词共有的意思成分 */
  const shared = $derived(
    cols.length > 1
      ? new Set(cols[0].pieces.filter((p) => cols.every((c) => c.pieces.includes(p))))
      : new Set<string>()
  )
  const SEP = /([，,；;、。．./\s（）()「」“”"'：:！!？?]+)/u
  /** 释义拆成意思成分与分隔符，按原样拼回去，共有的成分标底色 */
  const parts = (d: string): { text: string; mark: boolean }[] =>
    d
      .split(SEP)
      .filter(Boolean)
      .map((text) => ({ text, mark: shared.has(text.trim()) }))

  /** 构成里每个成分出现在几个词里：没有全部都有的高亮 */
  const partCount = $derived.by(() => {
    const m = new Map<string, number>()
    for (const c of cols)
      for (const k of new Set(c.path.components.map((x) => x.ref.key)))
        m.set(k, (m.get(k) ?? 0) + 1)
    return m
  })
  function kindLabel(r: RootRef): string {
    if (r.kind === 'morpheme' && r.morphemeType) return t(`morphemes.types.${r.morphemeType}`)
    if (r.kind === 'lexeme') return t('lexicon.sourceKinds.lexeme')
    return t('lexicon.comparePiece')
  }

  const others = $derived(
    [
      { key: 'pos', vals: cols.map((c) => c.pos) },
      { key: 'registers', vals: cols.map((c) => c.registers) },
      { key: 'tags', vals: cols.map((c) => c.tags) },
      { key: 'dialects', vals: cols.map((c) => c.dialects) }
    ].filter((r) => r.vals.some(Boolean))
  )

  /** 同一套规则推出来的几个词：按规则行合在一起，看哪些音变只有部分词经历了 */
  let allRules = $state(false)
  const ruleDiff = $derived.by(() => {
    const withSound = cols.filter((c) => c.sound)
    if (withSound.length < 2) return null
    const setId = withSound[0].sound!.path.ruleSetId
    if (!withSound.every((c) => c.sound!.path.ruleSetId === setId)) return null
    const rows = new Map<
      number,
      { line: number; rule: string; cells: Map<Id, { before: string; after: string }> }
    >()
    for (const c of withSound)
      for (const r of c.sound!.path.rules) {
        let row = rows.get(r.line)
        if (!row) rows.set(r.line, (row = { line: r.line, rule: r.rule, cells: new Map() }))
        if (!row.cells.has(c.w.id)) row.cells.set(c.w.id, { before: r.before, after: r.after })
      }
    const all = [...rows.values()].sort((a, b) => a.line - b.line)
    return {
      setName: withSound[0].sound!.path.ruleSetName,
      cols: withSound,
      all,
      partial: all.filter((r) => r.cells.size < withSound.length)
    }
  })
  const ruleRows = $derived(ruleDiff ? (allRules ? ruleDiff.all : ruleDiff.partial) : [])

  /** 跨语言：词根的每个音在各个词里变成了什么（只比直接从词根来、没有加别的成分的词） */
  const corr = $derived.by(() => {
    const direct = cols.filter((c) => c.path.components.length === 0)
    if (new Set(direct.map((c) => c.w.languageId)).size < 2) return null
    const src = group.root.label.replace(/[-=*·…\s]/g, '')
    const rows = correspondences(
      src,
      direct.map((c) => ({ id: c.w.id, form: c.w.lemma }))
    )
    return rows.length ? { src, cols: direct, rows } : null
  })
</script>

<div class="cmp">
  <div class="head">
    <button class="btn ghost sm" onclick={onback}
      ><ArrowLeft size={14} />{t('lexicon.compareBack')}</button
    >
    <span class="small muted">{t('lexicon.compareHint')}</span>
  </div>

  {#if groups.length > 1}
    <div class="groups">
      {#each groups as g (g.root.key)}
        <button
          class="group"
          class:on={g.root.key === group.root.key}
          onclick={() => (rootKey = g.root.key)}
        >
          <strong class="data">{g.root.label}</strong>
          {#if g.root.languageName}<span class="tiny">{g.root.languageName}</span>{/if}
          <span class="tiny muted"
            >{g.languageCount > 1
              ? t('lexicon.compareLangs', { n: g.languageCount })
              : t('lexicon.compareSameLang')} · {t('lexicon.compareWords', { n: g.total })}</span
          >
        </button>
      {/each}
    </div>
  {/if}

  <div class="rootline">
    <span class="muted">{t('lexicon.compareRoot')}</span>
    <strong class="data">{group.root.label}</strong>
    {#if group.root.languageName}<span class="badge">{group.root.languageName}</span>{/if}
    {#if group.root.gloss}<span class="muted">‘{group.root.gloss}’</span>{/if}
  </div>

  <div class="picks" title={t('lexicon.comparePickHint', { n: MAX_COLS })}>
    {#each group.lexemes as l (l.id)}
      {@const on = picks.includes(l.id)}
      <label class="pick" class:on>
        <input
          type="checkbox"
          checked={on}
          disabled={!on && picks.length >= MAX_COLS}
          onchange={() => toggle(l.id)}
        />
        <span class="data">{l.lemma}</span>
        <span class="tiny muted">{langAbbr(l.languageId)}</span>
      </label>
    {/each}
    {#if group.total > group.lexemes.length}
      <span class="tiny muted"
        >{t('lexicon.compareMore', { n: group.total - group.lexemes.length })}</span
      >
    {/if}
  </div>

  {#if cols.length}
    <div class="wrap">
      <table class="ct">
        <thead>
          <tr>
            <th></th>
            {#each cols as c (c.w.id)}
              <th>
                <button class="link data word" onclick={() => onselect(c.w.id)}>{c.w.lemma}</button>
                <div class="tiny muted">{[c.langName, c.pos].filter(Boolean).join(' · ')}</div>
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#if cols.some((c) => c.ipa)}
            <tr>
              <th>{t('lexicon.compareRows.pron')}</th>
              {#each cols as c (c.w.id)}<td class="data">{c.ipa ? pronText(c.ipa) : '—'}</td>{/each}
            </tr>
          {/if}
          <tr>
            <th>{t('lexicon.compareRows.meaning')}</th>
            {#each cols as c (c.w.id)}
              <td>
                {#each c.defs as d, i (i)}
                  <p class="def">
                    {#each parts(d) as p, j (j)}{#if p.mark}<mark>{p.text}</mark
                        >{:else}{p.text}{/if}{/each}
                  </p>
                {:else}<span class="muted">—</span>{/each}
              </td>
            {/each}
          </tr>
          <tr>
            <th>{t('lexicon.compareRows.origin')}</th>
            {#each cols as c (c.w.id)}
              <td class="chain">
                <span class="data">{group.root.label}</span>
                {#each c.path.steps as s, i (i)}
                  <span class="arrow">›</span>
                  {#if s.type}<span class="tiny muted">{etymologyTypeLabel(s.type)}</span>{/if}
                  <span class="data">{s.to.label}</span>
                {/each}
              </td>
            {/each}
          </tr>
          <tr>
            <th>{t('lexicon.compareRows.parts')}</th>
            {#each cols as c (c.w.id)}
              <td>
                <div class="parts">
                  {#each c.path.components as p (p.ref.key)}
                    <span class="part" class:only={(partCount.get(p.ref.key) ?? 0) < cols.length}>
                      <span class="data">{p.ref.label}</span>
                      <span class="tiny">{kindLabel(p.ref)}</span>
                      {#if p.ref.gloss}<span class="tiny muted">{p.ref.gloss}</span>{/if}
                    </span>
                  {:else}
                    <span class="muted">—</span>
                  {/each}
                </div>
              </td>
            {/each}
          </tr>
          {#if cols.some((c) => c.sound)}
            <tr>
              <th>{t('lexicon.compareRows.sound')}</th>
              {#each cols as c (c.w.id)}
                <td>
                  {#if c.sound}
                    {@const sp = c.sound.path}
                    <div class="stages data">
                      {sp.input}{#each sp.stages.filter((st, i) => st.form && st.form !== (i === 0 ? sp.input : sp.stages[i - 1].form)) as st (st.name)}<span
                          class="arrow"
                          title={st.name}>›</span
                        >{st.form}{/each}
                    </div>
                    <div class="tiny muted">
                      {t('lexicon.compareSoundBy', {
                        set: sp.ruleSetName,
                        n: sp.rules.length
                      })}{#if c.sound.via}{t('lexicon.compareSoundVia', { w: c.sound.via })}{/if}
                    </div>
                    {#if !sp.matches}
                      <div class="tiny warn">
                        <TriangleAlert size={11} />{t('lexicon.compareMismatch', {
                          form: sp.output
                        })}
                      </div>
                    {/if}
                    {#if sp.rules.length}
                      <details>
                        <summary class="tiny">{t('lexicon.compareShowRules')}</summary>
                        <ol class="rules">
                          {#each sp.rules as r (r.line)}
                            <li>
                              <code>{r.rule}</code>
                              <span class="data tiny">{r.before} → {r.after}</span>
                            </li>
                          {/each}
                        </ol>
                      </details>
                    {/if}
                  {:else}
                    <span class="muted">—</span>
                  {/if}
                </td>
              {/each}
            </tr>
          {/if}
          {#each others as r (r.key)}
            {@const differs = new Set(r.vals).size > 1}
            <tr>
              <th>{t(`lexicon.compareRows.${r.key}`)}</th>
              {#each r.vals as v, i (i)}<td class:diff={differs}>{v || '—'}</td>{/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}

  {#if ruleDiff}
    <section>
      <div class="sec-head">
        <h4>{t('lexicon.compareRuleDiff')}</h4>
        <span class="small muted"
          >{t('lexicon.compareRuleDiffHint', { set: ruleDiff.setName })}</span
        >
        <span class="grow"></span>
        <label class="small row"
          ><input type="checkbox" bind:checked={allRules} />{t('lexicon.compareAllRules')}</label
        >
      </div>
      {#if ruleRows.length}
        <div class="wrap">
          <table class="ct rules-tbl">
            <thead>
              <tr>
                <th></th>
                {#each ruleDiff.cols as c (c.w.id)}<th class="data">{c.w.lemma}</th>{/each}
              </tr>
            </thead>
            <tbody>
              {#each ruleRows as row (row.line)}
                <tr class:partial={row.cells.size < ruleDiff.cols.length}>
                  <th><code>{row.rule}</code></th>
                  {#each ruleDiff.cols as c (c.w.id)}
                    {@const cell = row.cells.get(c.w.id)}
                    <td class="data">{cell ? `${cell.before} → ${cell.after}` : '—'}</td>
                  {/each}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else}
        <p class="small muted">{t('lexicon.compareRuleSame')}</p>
      {/if}
    </section>
  {/if}

  {#if corr}
    <section>
      <div class="sec-head">
        <h4>{t('lexicon.compareCorr')}</h4>
        <span class="small muted">{t('lexicon.compareCorrHint')}</span>
      </div>
      <div class="wrap">
        <table class="ct corr">
          <thead>
            <tr>
              <th class="data">{corr.src}</th>
              {#each corr.cols as c (c.w.id)}<th
                  ><span class="data">{c.w.lemma}</span>
                  <span class="tiny muted">{langName(c.w.languageId)}</span></th
                >{/each}
            </tr>
          </thead>
          <tbody>
            {#each corr.rows as row, i (i)}
              <tr>
                <th class="data">{row.source}</th>
                {#each corr.cols as c (c.w.id)}
                  {@const v = row.reflex[c.w.id]}
                  <td class="data" class:diff={v !== row.source}>{v === '' ? '∅' : v}</td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>
  {/if}
</div>

<style>
  .cmp {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding-bottom: 12px;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .groups {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .group {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    padding: 4px 10px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--bg-elev);
    color: var(--text);
    cursor: pointer;
  }
  .group.on {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .rootline {
    display: flex;
    align-items: baseline;
    gap: 8px;
    flex-wrap: wrap;
    font-size: 15px;
  }
  .picks {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 10px;
    align-items: center;
  }
  .pick {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px 2px 4px;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .pick.on {
    background: var(--bg-sunken);
  }
  .wrap {
    overflow-x: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-elev);
  }
  .ct {
    border-collapse: collapse;
    width: 100%;
    font-size: 13px;
  }
  .ct th,
  .ct td {
    border-bottom: 1px solid var(--border);
    padding: 8px 10px;
    vertical-align: top;
    text-align: left;
  }
  .ct thead th {
    background: var(--bg-sunken);
    font-weight: 600;
    min-width: 170px;
  }
  .ct tbody th {
    position: sticky;
    left: 0;
    background: var(--bg-elev);
    color: var(--text-2);
    font-weight: 500;
    white-space: nowrap;
    width: 1%;
  }
  .ct thead th:first-child {
    position: sticky;
    left: 0;
    min-width: 0;
  }
  .word {
    font-size: 17px;
    border: 0;
    background: none;
    padding: 0;
    color: var(--accent-text);
    cursor: pointer;
  }
  .word:hover {
    text-decoration: underline;
  }
  .def {
    margin: 0 0 2px;
  }
  mark {
    background: var(--accent-soft);
    color: inherit;
    border-radius: 3px;
    padding: 0 2px;
  }
  .chain {
    line-height: 1.8;
  }
  .arrow {
    color: var(--text-3);
    margin: 0 4px;
  }
  .parts {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .part {
    display: inline-flex;
    align-items: baseline;
    gap: 4px;
    padding: 1px 8px;
    border: 1px solid var(--border);
    border-radius: 999px;
    color: var(--text-2);
  }
  .part.only {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--text);
  }
  .stages {
    font-size: 14px;
  }
  .warn {
    display: flex;
    align-items: center;
    gap: 4px;
    color: var(--warn);
  }
  details summary {
    cursor: pointer;
    color: var(--text-2);
    margin-top: 4px;
  }
  .rules {
    margin: 4px 0 0;
    padding-left: 18px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  code {
    font-family: var(--font-mono);
    font-size: 12px;
  }
  td.diff {
    color: var(--accent-text);
    font-weight: 500;
  }
  .rules-tbl tr.partial td {
    background: color-mix(in srgb, var(--accent-soft) 45%, transparent);
  }
  .corr td,
  .corr th {
    text-align: center;
    min-width: 60px;
  }
  .corr td.diff {
    background: var(--accent-soft);
  }
  section {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .sec-head {
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;
  }
  .sec-head h4 {
    margin: 0;
  }
</style>
