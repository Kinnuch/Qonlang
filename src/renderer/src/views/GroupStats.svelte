<script lang="ts">
  /**
   * 几门语言的统计与对比（语言页主区）：数量、音位对照、同源比例、对应词表。算得慢的两项切到那一页才算。
   * 谁进来都行：选中分类节点时是它下面的全部语言，挑了两门对比时就是这两门。
   */
  import type { Id, Language, Project } from '$lib/core/model'
  import { t } from '$lib/i18n/index.svelte'
  import { ui } from '$lib/state/ui.svelte'
  import {
    cognateMatrix,
    correspondenceTable,
    groupCounts,
    phonemeTable
  } from '$lib/core/groupStats'
  import { Check } from '@lucide/svelte'

  let {
    project,
    title,
    note = '',
    languages,
    onpicklanguage,
    onpicklexeme
  }: {
    project: Project
    /** 卡片标题 */
    title: string
    /** 标题下面多加的一行（对比时写最近公共祖先） */
    note?: string
    languages: Language[]
    onpicklanguage: (id: Id) => void
    onpicklexeme: (id: Id) => void
  } = $props()

  type Tab = 'counts' | 'phonemes' | 'cognates' | 'table'
  /** 回到语言页时停在上次看的那一项（跟语言页共用一份页面记忆） */
  const memo = ui.memo<{ statsTab?: Tab }>('languages')
  let tab = $state<Tab>(memo.statsTab ?? 'counts')
  $effect(() => {
    memo.statsTab = tab
  })

  const counts = $derived(groupCounts(project, languages))
  const totals = $derived(
    counts.reduce(
      (a, r) => ({
        lexemes: a.lexemes + r.lexemes,
        morphemes: a.morphemes + r.morphemes,
        sentences: a.sentences + r.sentences,
        phrases: a.phrases + r.phrases
      }),
      { lexemes: 0, morphemes: 0, sentences: 0, phrases: 0 }
    )
  )
  const phonemes = $derived(tab === 'phonemes' ? phonemeTable(languages) : [])
  const cognates = $derived(tab === 'cognates' ? cognateMatrix(project, languages) : null)
  /** 对应词表只看勾上的几门语言（默认全勾） */
  let unchecked = $state<Set<Id>>(new Set())
  const tableLangs = $derived(languages.filter((l) => !unchecked.has(l.id)))
  const table = $derived(
    tab === 'table' && tableLangs.length >= 2 ? correspondenceTable(project, tableLangs) : null
  )
  /** 正好两门语言时，音位表上面多报一句共有 / 各自独有多少 */
  const pairPhonemes = $derived.by(() => {
    if (languages.length !== 2 || !phonemes.length) return null
    const [a, b] = languages
    const only = (x: Language, y: Language): number =>
      phonemes.filter((p) => p.in.has(x.id) && !p.in.has(y.id)).length
    return {
      shared: phonemes.filter((p) => p.in.size === 2).length,
      onlyA: only(a, b),
      onlyB: only(b, a),
      a,
      b
    }
  })
  const pct = (x: number): string => `${Math.round(x * 100)}%`
  /** 比例越高底色越深 */
  const heat = (x: number): string =>
    `background: color-mix(in srgb, var(--accent) ${Math.round(x * 45)}%, transparent)`
</script>

<section class="stats card">
  <div class="row head">
    <strong class="grow">{title}</strong>
    <div class="seg">
      {#each ['counts', 'phonemes', 'cognates', 'table'] as const as k (k)}
        <button class:active={tab === k} onclick={() => (tab = k)}
          >{t(`languages.stats.tabs.${k}`)}</button
        >
      {/each}
    </div>
  </div>

  {#if note}<p class="small muted anc">{note}</p>{/if}

  {#if languages.length === 0}
    <p class="small muted">{t('languages.stats.noLanguages')}</p>
  {:else if tab === 'counts'}
    <div class="table-wrap">
      <table class="tbl small">
        <thead>
          <tr>
            <th>{t('languages.stats.language')}</th>
            <th class="num">{t('languages.stats.lexemes')}</th>
            <th class="num">{t('languages.stats.morphemes')}</th>
            <th class="num">{t('languages.stats.sentences')}</th>
            <th class="num">{t('languages.stats.phrases')}</th>
          </tr>
        </thead>
        <tbody>
          {#each counts as r (r.language.id)}
            <tr>
              <td
                ><button class="link" onclick={() => onpicklanguage(r.language.id)}
                  ><span class="dot" style:background={r.language.color}></span>{r.language
                    .name}</button
                >{#if r.language.stages?.length}<span class="small muted">
                    · {t('languages.stats.stageCount', { n: r.language.stages.length })}</span
                  >{/if}</td
              >
              <td class="num">{r.lexemes}</td>
              <td class="num">{r.morphemes}</td>
              <td class="num">{r.sentences}</td>
              <td class="num">{r.phrases}</td>
            </tr>
          {/each}
        </tbody>
        <tfoot>
          <tr>
            <th>{t('languages.stats.total', { n: languages.length })}</th>
            <th class="num">{totals.lexemes}</th>
            <th class="num">{totals.morphemes}</th>
            <th class="num">{totals.sentences}</th>
            <th class="num">{totals.phrases}</th>
          </tr>
        </tfoot>
      </table>
    </div>
  {:else if tab === 'phonemes'}
    {#if phonemes.length === 0}
      <p class="small muted">{t('languages.stats.noPhonemes')}</p>
    {:else}
      {#if pairPhonemes}
        <p class="small muted">
          {t('languages.stats.pairPhonemes', {
            shared: pairPhonemes.shared,
            a: pairPhonemes.a.name,
            onlyA: pairPhonemes.onlyA,
            b: pairPhonemes.b.name,
            onlyB: pairPhonemes.onlyB
          })}
        </p>
      {/if}
      <div class="table-wrap">
        <table class="tbl small ph">
          <thead>
            <tr>
              <th></th>
              {#each languages as l (l.id)}<th title={l.name}>{l.abbr || l.name}</th>{/each}
            </tr>
          </thead>
          <tbody>
            {#each phonemes as p (p.symbol)}
              <tr class:shared={p.in.size === languages.length}>
                <th class="data">{p.symbol}</th>
                {#each languages as l (l.id)}<td
                    >{#if p.in.has(l.id)}<Check size={12} />{/if}</td
                  >{/each}
              </tr>
            {/each}
          </tbody>
          <tfoot>
            <tr>
              <th>{t('languages.stats.phonemeCount')}</th>
              {#each languages as l (l.id)}<th>{l.phonemes.length}</th>{/each}
            </tr>
          </tfoot>
        </table>
      </div>
    {/if}
  {:else if tab === 'cognates' && cognates}
    {#if languages.length < 2}
      <p class="small muted">{t('languages.stats.needTwo')}</p>
    {:else}
      <p class="small muted">{t('languages.stats.cognatesHint')}</p>
      <div class="table-wrap">
        <table class="tbl small matrix">
          <thead>
            <tr>
              <th></th>
              {#each languages as l (l.id)}<th title={l.name}>{l.abbr || l.name}</th>{/each}
            </tr>
          </thead>
          <tbody>
            {#each languages as a (a.id)}
              <tr>
                <th title={a.name}>{a.abbr || a.name}</th>
                {#each languages as b (b.id)}
                  {#if a.id === b.id}
                    <td class="self">—</td>
                  {:else}
                    {@const c = cognates.get(`${a.id}|${b.id}`)}
                    <td
                      style={heat(c?.ratio ?? 0)}
                      title={t('languages.stats.cognateCell', {
                        a: a.name,
                        b: b.name,
                        n: c?.shared ?? 0
                      })}>{pct(c?.ratio ?? 0)}</td
                    >
                  {/if}
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  {:else if tab === 'table'}
    <div class="row wrap picks">
      {#each languages as l (l.id)}
        <label class="row small"
          ><input
            type="checkbox"
            checked={!unchecked.has(l.id)}
            onchange={(e) => {
              const next = new Set(unchecked)
              if ((e.currentTarget as HTMLInputElement).checked) next.delete(l.id)
              else next.add(l.id)
              unchecked = next
            }}
          />{l.name}</label
        >
      {/each}
    </div>
    {#if tableLangs.length < 2}
      <p class="small muted">{t('languages.stats.needTwo')}</p>
    {:else if table && table.rows.length === 0}
      <p class="small muted">{t('languages.stats.noCognates')}</p>
    {:else if table}
      <p class="small muted">
        {t('languages.stats.tableCount', { n: table.total, shown: table.rows.length })}
      </p>
      <div class="table-wrap corr">
        <table class="tbl small">
          <thead>
            <tr>
              <th>{t('languages.stats.root')}</th>
              {#each tableLangs as l (l.id)}<th title={l.name}>{l.abbr || l.name}</th>{/each}
            </tr>
          </thead>
          <tbody>
            {#each table.rows as r (r.root.key)}
              <tr>
                <td
                  ><span class="data">{r.root.label}</span>{#if r.root.languageName}<span
                      class="small muted"
                    >
                      · {r.root.languageName}</span
                    >{/if}{#if r.root.gloss}<div class="small muted">{r.root.gloss}</div>{/if}</td
                >
                {#each tableLangs as l (l.id)}
                  <td
                    >{#each r.cells.get(l.id) ?? [] as w, i (w.id)}{#if i}<span class="muted"
                          >,
                        </span>{/if}<button class="link data" onclick={() => onpicklexeme(w.id)}
                        >{w.lemma}</button
                      >{/each}</td
                  >
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  {/if}
</section>

<style>
  .stats {
    margin-top: 18px;
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .head {
    gap: 10px;
    flex-wrap: wrap;
  }
  .anc {
    margin: -6px 0 0;
  }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-right: 6px;
  }
  .link {
    border: 0;
    background: none;
    padding: 0;
    color: var(--accent-text);
    cursor: pointer;
    font: inherit;
  }
  .ph td,
  .matrix td {
    text-align: center;
    color: var(--accent-text);
  }
  .ph tr.shared th {
    color: var(--text-3);
  }
  .matrix td {
    color: var(--text);
    font-variant-numeric: tabular-nums;
  }
  .matrix td.self {
    color: var(--text-3);
  }
  .picks {
    gap: 12px;
  }
  .picks label {
    gap: 4px;
  }
  .corr {
    max-height: 60vh;
    overflow: auto;
  }
</style>
