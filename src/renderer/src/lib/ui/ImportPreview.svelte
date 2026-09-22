<script lang="ts">
  /**
   * 导入样例（放在检视器里）：按现在的设置导入后会是什么样，只列前几条。
   * 设置一改就跟着变，变了的地方先高亮再褪掉；刚换了来源（新文件）的第一屏不闪。
   * 词条、语素用试导入的临时项目来显示；表格记录、字形、规则文本直接给数据。
   * 调用方给了 testParse 就在下面出一块测试台：自己敲一段输入，按同一套设置当场解析，结果用样例这一套显示。
   */
  import { onMount } from 'svelte'
  import { ChevronDown, ChevronRight } from '@lucide/svelte'
  import {
    ETYMOLOGY_TYPES,
    type Etymology,
    type Lexeme,
    type LocalizedText,
    type Morpheme,
    type Project,
    type StressSettings
  } from '$lib/core/model'
  import { t, pickText } from '$lib/i18n/index.svelte'
  import { ui } from '$lib/state/ui.svelte'
  import { flashChange, type FlashChangeArg } from '$lib/ui/flash'
  import { findPos, posText, sensePos } from '$lib/core/pos'
  import { registerShort } from '$lib/core/register'
  import { customFieldTitle } from '$lib/core/customFields'
  import { previewKind, type PreviewData, type PreviewKind } from '$lib/importers/preview'
  import HelpDot from './HelpDot.svelte'

  let {
    kind,
    total,
    project = undefined,
    lexemes = [],
    morphemes = [],
    duplicates = undefined,
    records = [],
    fieldLabel = (key: string) => key,
    glyphs = [],
    glyphStyle = '',
    lines = [],
    source = '',
    testParse = undefined,
    testPlaceholder = ''
  }: {
    kind: PreviewKind
    /** 这次一共要导入多少条 */
    total: number
    /** 试导入用的临时项目：词类、维度的名字从这里找 */
    project?: Project
    lexemes?: Lexeme[]
    morphemes?: Morpheme[]
    /** 项目里已经有的单词或形式 */
    duplicates?: Set<string>
    /** 表格记录；skip 写着为什么会跳过 */
    records?: { rec: Record<string, string>; skip?: string }[]
    fieldLabel?: (key: string) => string
    /** skip：已经有这个字形 */
    glyphs?: { char: string; value: string; name: string; skip?: boolean }[]
    glyphStyle?: string
    lines?: string[]
    /** 来源（文件名之类）；换了就当新的一屏，不闪 */
    source?: string
    /** 测试台：把用户敲的一段输入按当前设置解析成样例数据，认不出来给 null；不给就没有测试台 */
    testParse?: (text: string) => PreviewData | null
    /** 测试台输入框里的例子 */
    testPlaceholder?: string
  } = $props()

  const langs = $derived(project?.settings.glossLanguages ?? [])
  const shown = $derived(
    kind === 'lexemes'
      ? lexemes.length
      : kind === 'morphemes'
        ? morphemes.length
        : kind === 'records'
          ? records.length
          : kind === 'glyphs'
            ? glyphs.length
            : kind === 'lines'
              ? lines.length
              : 0
  )
  /** 上面那块样例的数据 */
  const main = $derived<PreviewData>({ project, lexemes, morphemes, records, glyphs, lines })

  // 来源刚换时先不闪，稍等一下再开始标出变化
  let armedFor = $state<string | null>(null)
  $effect(() => {
    const s = source
    const id = setTimeout(() => (armedFor = s), 150)
    return () => clearTimeout(id)
  })
  const fx = (key: unknown, armed: boolean): FlashChangeArg => ({
    key: typeof key === 'string' ? key : JSON.stringify(key),
    armed
  })

  // 样例在检视器里：开始导入时检视器关着、或者正盖着规则语法，都让出来
  onMount(() => {
    ui.inspectorOpen = true
    ui.syntaxOpen = false
  })

  /** 测试台的展开状态与输入按「页面 + 种类」记住 */
  const memo = ui.memo<Record<string, unknown>>(ui.section)
  const memoKey = $derived(`importTest.${kind}`)
  let testOpen = $state(false)
  let testInput = $state('')
  // 种类一开始可能还是 empty（文件还没选），等它定下来再接上那一份记忆；用户已经敲了东西就不动
  let adopted = ''
  $effect(() => {
    const key = memoKey
    if (key === adopted || testOpen || testInput) return
    adopted = key
    testOpen = memo[`${key}.open`] === true
    testInput = String(memo[`${key}.text`] ?? '')
  })
  $effect(() => {
    memo[`${memoKey}.open`] = testOpen
    memo[`${memoKey}.text`] = testInput
  })

  // 敲字停手一会儿再解析，不然每按一个键都要重跑一遍导入
  let testText = $state('')
  $effect(() => {
    const v = testInput
    const id = setTimeout(() => (testText = v), 200)
    return () => clearTimeout(id)
  })
  const testPending = $derived(testInput !== testText)
  /** 测试结果：在这里调 testParse，它读到的设置一变也跟着重算 */
  const testData = $derived.by((): PreviewData | null => {
    if (!testParse || !testText.trim()) return null
    try {
      return testParse(testText)
    } catch {
      return null
    }
  })
  const testKind = $derived(previewKind(testData))

  /** 各语言的文字接起来（释义语言的顺序排前面） */
  function texts(text: LocalizedText): string {
    return [...new Set([...langs, ...Object.keys(text)])]
      .map((g) => text[g]?.trim())
      .filter(Boolean)
      .join(' / ')
  }
  const regLabel = (r: string): string =>
    ui.prefs.registerDisplay === 'full' ? r.trim() : registerShort(r)

  interface Fact {
    label: string
    value: string
  }
  const facts = (pairs: [string, string][]): Fact[] =>
    pairs.filter(([, v]) => v.trim()).map(([label, value]) => ({ label, value }))

  function featureText(p: Project, features: Record<string, string>): string {
    return Object.entries(features)
      .map(([cid, vid]) => {
        const c = p.categories.find((x) => x.id === cid)
        const v = c?.values.find((x) => x.id === vid)
        return c && v ? `${pickText(c.name, langs)} ${pickText(v.name, langs)}` : ''
      })
      .filter(Boolean)
      .join(' · ')
  }
  /** 词源一行：类别 · 来源 > 中间态 · 说明（链到的单词、语素写它们的形式） */
  function etymologyText(p: Project, e: Etymology): string {
    const sources = e.sources
      .map((s) =>
        s.kind === 'external'
          ? [s.language, s.form, s.meaning ? `‘${s.meaning}’` : ''].filter(Boolean).join(' ')
          : s.kind === 'lexeme'
            ? (p.lexemes.find((x) => x.id === s.id)?.lemma ?? '?')
            : (p.morphemes.find((x) => x.id === s.id)?.form ?? '?')
      )
      .join(' + ')
    const chain = [sources, ...e.stages.map((st) => st.form)].filter(Boolean).join(' > ')
    const type =
      e.type === 'unknown'
        ? ''
        : (ETYMOLOGY_TYPES as readonly string[]).includes(e.type)
          ? t(`lexicon.etyTypes.${e.type}`)
          : e.type
    return [type, chain, e.notes].filter(Boolean).join(' · ')
  }
  /** 对重音影响：传递词性、特殊重音落在第几个音节 */
  function stressText(p: Project, s: StressSettings | undefined): string {
    if (!s?.affects) return ''
    const parts: string[] = []
    if (s.passPos) {
      const pos = s.posId ? p.posList.find((x) => x.id === s.posId) : undefined
      parts.push(
        t('stressSettings.passPos') +
          (pos ? ` · ${t('stressSettings.countAs')} ${pickText(pos.name, langs) || pos.abbr}` : '')
      )
    }
    if (s.passSpecial)
      parts.push(
        `${t('stressSettings.passSpecial')} · ${
          s.special === 0
            ? t('stressRule.posNone')
            : s.special > 0
              ? t('stressRule.sumFront', { n: s.special })
              : t('stressRule.sumBack', { n: -s.special })
        }`
      )
    return parts.join('；')
  }
  function lexemeFacts(p: Project, l: Lexeme): Fact[] {
    return facts([
      [
        t('lexicon.colPron'),
        Object.values(l.pronunciations)
          .map((x) => x.ipa)
          .filter(Boolean)
          .map((x) => `/${x}/`)
          .join(' ')
      ],
      [t('lexicon.colTags'), l.tags.join(', ')],
      [t('lexicon.etymology'), etymologyText(p, l.etymology)],
      [
        t('lexicon.stems'),
        Object.entries(l.stems)
          .filter(([, v]) => v)
          .map(([k, v]) => `${k} ${v}`)
          .join(' · ')
      ],
      [
        t('lexicon.forms'),
        Object.entries(l.forms)
          .filter(([, f]) => f.surface)
          .map(([k, f]) => `${k} ${f.surface}`)
          .join(' · ')
      ],
      [t('lexicon.features'), featureText(p, l.features)],
      [t('stressSettings.affects'), stressText(p, l.stress)],
      [t('common.notes'), l.notes],
      // 检视器模块：标题 · 内容
      ...(p.customFields ?? []).map((f): [string, string] => [
        customFieldTitle(f, langs) || '?',
        l.custom?.[f.id] ?? ''
      ])
    ])
  }
  function morphemeFacts(p: Project, m: Morpheme): Fact[] {
    return facts([
      [t('morphemes.form2'), m.form2],
      [
        t('morphemes.allomorphs'),
        m.allomorphs
          .map((a) => (a.environment ? `${a.form} / ${a.environment}` : a.form))
          .join('；')
      ],
      [t('lexicon.etymology'), etymologyText(p, m.etymology)],
      [t('lexicon.colTags'), m.tags.join(', ')],
      [t('lexicon.features'), featureText(p, m.features)],
      [t('stressSettings.affects'), stressText(p, m.stress)],
      [t('common.notes'), m.notes]
    ])
  }
</script>

<!-- 样例与测试结果共用这一段：k 决定按哪种显示；armed 为假时不闪（测试台边敲边变，闪起来太吵） -->
{#snippet items(d: PreviewData, k: PreviewKind, armed: boolean)}
  {#if k === 'lexemes' && d.project}
    {@const pj = d.project}
    {#each d.lexemes ?? [] as l, i (i)}
      {@const pos = posText(findPos(pj, l.posId), langs)}
      <article class="ip-item">
        <div class="ip-row">
          <span class="ip-main data" use:flashChange={fx(l.lemma, armed)}>{l.lemma || '—'}</span>
          {#if pos}<span class="ip-pos" use:flashChange={fx(pos, armed)}>{pos}</span>{/if}
          {#if duplicates?.has(l.lemma)}<span class="badge dup">{t('importPreview.duplicate')}</span
            >{/if}
        </div>
        <ol class="ip-senses">
          {#each l.senses as s, si (si)}
            {@const sp = posText(sensePos(pj, l, s), langs)}
            <li use:flashChange={fx([sp, s.registers, s.definition, s.tags], armed)}>
              {#if sp}<span class="ip-spos">{sp}</span>{/if}{#each s.registers as r (r)}<span
                  class="reg"
                  title={r}>{regLabel(r)}</span
                >{/each}{texts(s.definition) || '—'}{#if s.tags.length}<span class="ip-tags"
                  >{s.tags.join(' · ')}</span
                >{/if}
            </li>
          {/each}
        </ol>
        {#each lexemeFacts(pj, l) as f, fi (fi)}
          <div class="ip-fact" use:flashChange={fx(f.value, armed)}>
            <span class="muted">{f.label}</span>{f.value}
          </div>
        {/each}
      </article>
    {/each}
  {:else if k === 'morphemes' && d.project}
    {@const pj = d.project}
    {#each d.morphemes ?? [] as m, i (i)}
      <article class="ip-item">
        <div class="ip-row">
          <span class="ip-main data" use:flashChange={fx(m.form, armed)}>{m.form || '—'}</span>
          <span class="ip-pos" use:flashChange={fx(m.type, armed)}
            >{t(`morphemes.types.${m.type}`)}</span
          >
          {#if m.gloss}<span class="ip-gloss" use:flashChange={fx(m.gloss, armed)}>{m.gloss}</span
            >{/if}
          {#if duplicates?.has(m.form)}<span class="badge dup">{t('importPreview.duplicate')}</span
            >{/if}
        </div>
        {#if texts(m.meaning)}<div class="ip-def" use:flashChange={fx(m.meaning, armed)}>
            {texts(m.meaning)}
          </div>{/if}
        {#each morphemeFacts(pj, m) as f, fi (fi)}
          <div class="ip-fact" use:flashChange={fx(f.value, armed)}>
            <span class="muted">{f.label}</span>{f.value}
          </div>
        {/each}
      </article>
    {/each}
  {:else if k === 'records'}
    {#each d.records ?? [] as r, i (i)}
      <article class="ip-item" class:skip={!!r.skip}>
        <div class="ip-row">
          <span class="ip-main data" use:flashChange={fx(r.rec.text ?? '', armed)}
            >{r.rec.text || '—'}</span
          >
          {#if r.skip}<span class="badge">{r.skip}</span>{/if}
        </div>
        {#each Object.entries(r.rec).filter(([rk, v]) => rk !== 'text' && v) as [rk, v] (rk)}
          <div class="ip-fact" use:flashChange={fx(v, armed)}>
            <span class="muted">{fieldLabel(rk)}</span>{v}
          </div>
        {/each}
      </article>
    {/each}
  {:else if k === 'glyphs'}
    <div class="ip-glyphs">
      {#each d.glyphs ?? [] as g, i (i)}
        <div
          class="ip-glyph"
          class:skip={g.skip}
          title={g.skip ? t('importPreview.glyphExists') : g.name}
          use:flashChange={fx([g.char, g.value, g.name, !!g.skip], armed)}
        >
          <span class="ip-gchar" style={glyphStyle}>{g.char || '·'}</span>
          <span class="ip-gval data">{g.value || ' '}</span>
        </div>
      {/each}
    </div>
  {:else if k === 'lines'}
    <div class="ip-lines">
      {#each d.lines ?? [] as line, i (i)}<div class="ip-line" use:flashChange={fx(line, armed)}>
          {line || ' '}
        </div>{/each}
    </div>
  {/if}
{/snippet}

<div class="ip">
  <div class="ip-head">
    <strong class="grow">{t('importPreview.title')}</strong>
    {#if kind === 'lines'}
      <span class="small muted">{t('importPreview.lines', { total })}</span>
    {:else if total}
      <span class="small muted"
        >{shown < total
          ? t('importPreview.count', { n: shown, total })
          : t('importPreview.countAll', { total })}</span
      >
    {/if}
  </div>
  {#if !shown}<p class="small muted">{t('importPreview.empty')}</p>{/if}

  {@render items(main, kind, armedFor === source)}

  {#if testParse}
    <div class="ip-test">
      <div class="ip-test-head">
        <button class="fold" onclick={() => (testOpen = !testOpen)}
          >{#if testOpen}<ChevronDown size={13} />{:else}<ChevronRight size={13} />{/if}{t(
            'importPreview.testTitle'
          )}</button
        >
        <HelpDot tip={t('importPreview.testTip')} />
      </div>
      {#if testOpen}
        <textarea
          class="textarea data"
          rows="3"
          placeholder={testPlaceholder}
          bind:value={testInput}
        ></textarea>
        {#if testText.trim()}
          {#if testKind !== 'empty'}
            {@render items(testData ?? {}, testKind, false)}
          {:else if !testPending}
            <p class="small muted">{t('importPreview.testNoMatch')}</p>
          {/if}
        {/if}
      {/if}
    </div>
  {/if}
</div>

<style>
  .ip {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .ip-head {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 8px;
  }
  .ip-item {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-elev);
  }
  .ip-item.skip {
    opacity: 0.5;
  }
  .ip-row {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 8px;
  }
  .ip-main,
  .ip-pos,
  .ip-gloss,
  .ip-def,
  .ip-fact,
  .ip-senses li,
  .ip-line {
    border-radius: 3px;
  }
  .ip-main {
    font-size: 17px;
    font-weight: 500;
    word-break: break-word;
  }
  .ip-pos {
    font-style: italic;
    font-size: 13px;
    color: var(--accent-text);
  }
  .ip-gloss {
    font-family: var(--font-gloss);
    font-size: 12px;
    color: var(--text-2);
  }
  .dup {
    color: var(--warn);
    border-color: currentColor;
  }
  .ip-senses {
    margin: 0;
    padding-inline-start: 20px;
    font-size: 13px;
    line-height: 1.55;
  }
  .ip-senses li::marker {
    color: var(--text-3);
    font-size: 11px;
  }
  /* 义项自己的词类：淡淡地写在释义前面，不抢眼 */
  .ip-spos {
    margin-inline-end: 5px;
    font-style: italic;
    font-size: 0.92em;
    color: var(--text-3);
  }
  .reg {
    display: inline-block;
    min-width: 1.4em;
    padding: 0 3px;
    margin-inline-end: 5px;
    border: 1px solid var(--text-3);
    border-radius: 3px;
    color: var(--text-2);
    font-size: 0.78em;
    line-height: 1.35;
    text-align: center;
    vertical-align: 0.1em;
    white-space: nowrap;
  }
  .ip-tags {
    margin-inline-start: 6px;
    font-size: 11px;
    color: var(--text-3);
  }
  .ip-def {
    font-size: 13px;
  }
  .ip-fact {
    font-size: 12px;
    color: var(--text-2);
    word-break: break-word;
  }
  .ip-fact .muted {
    margin-inline-end: 6px;
  }
  .ip-glyphs {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(60px, 1fr));
    gap: 6px;
  }
  .ip-glyph {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 6px 4px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-elev);
  }
  .ip-glyph.skip {
    opacity: 0.4;
  }
  .ip-gchar {
    font-size: 24px;
    line-height: 1.25;
  }
  .ip-gval {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11px;
    color: var(--text-2);
  }
  .ip-lines {
    max-height: 65vh;
    overflow: auto;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-elev);
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
  }
  /* 测试台：跟样例之间拉一条线，自己敲的输入在上、结果在下 */
  .ip-test {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--border);
  }
  .ip-test-head {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .ip-test-head .fold {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--text-2);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
  }
  .ip-test-head .fold:hover {
    color: var(--accent);
  }
</style>
