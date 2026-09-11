<script lang="ts">
  /**
   * 导入样例（放在检视器里）：按现在的设置导入后会是什么样，只列前几条。
   * 设置一改就跟着变，变了的地方先高亮再褪掉；刚换了来源（新文件）的第一屏不闪。
   * 词条、语素用试导入的临时项目来显示；表格记录、字形、规则文本直接给数据。
   */
  import { onMount } from 'svelte'
  import type { Lexeme, LocalizedText, Morpheme, Project } from '$lib/core/model'
  import { t, pickText } from '$lib/i18n/index.svelte'
  import { ui } from '$lib/state/ui.svelte'
  import { flashChange, type FlashChangeArg } from '$lib/ui/flash'
  import { findPos, posText, sensePos } from '$lib/core/pos'
  import { registerShort } from '$lib/core/register'

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
    source = ''
  }: {
    kind: 'lexemes' | 'morphemes' | 'records' | 'glyphs' | 'lines' | 'empty'
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

  // 来源刚换时先不闪，稍等一下再开始标出变化
  let armedFor = $state<string | null>(null)
  $effect(() => {
    const s = source
    const id = setTimeout(() => (armedFor = s), 150)
    return () => clearTimeout(id)
  })
  const fx = (key: unknown): FlashChangeArg => ({
    key: typeof key === 'string' ? key : JSON.stringify(key),
    armed: armedFor === source
  })

  // 样例在检视器里：开始导入时检视器关着、或者正盖着规则语法，都让出来
  onMount(() => {
    ui.inspectorOpen = true
    ui.syntaxOpen = false
  })

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
      [
        t('lexicon.etymology'),
        [
          ...l.etymology.sources.map((s) => (s.kind === 'external' ? s.form : '')),
          l.etymology.notes
        ]
          .filter(Boolean)
          .join(' · ')
      ],
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
      [t('common.notes'), l.notes]
    ])
  }
  function morphemeFacts(p: Project, m: Morpheme): Fact[] {
    return facts([
      [t('lexicon.colTags'), m.tags.join(', ')],
      [t('lexicon.features'), featureText(p, m.features)],
      [t('common.notes'), m.notes]
    ])
  }
</script>

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
  <p class="small muted">{shown ? t('importPreview.hint') : t('importPreview.empty')}</p>

  {#if kind === 'lexemes' && project}
    {@const pj = project}
    {#each lexemes as l, i (i)}
      {@const pos = posText(findPos(pj, l.posId), langs)}
      <article class="ip-item">
        <div class="ip-row">
          <span class="ip-main data" use:flashChange={fx(l.lemma)}>{l.lemma || '—'}</span>
          {#if pos}<span class="ip-pos" use:flashChange={fx(pos)}>{pos}</span>{/if}
          {#if duplicates?.has(l.lemma)}<span class="badge dup">{t('importPreview.duplicate')}</span
            >{/if}
        </div>
        <ol class="ip-senses">
          {#each l.senses as s, si (si)}
            {@const sp = posText(sensePos(pj, l, s), langs)}
            <li use:flashChange={fx([sp, s.registers, s.definition, s.tags])}>
              {#if sp}<span class="ip-spos">{sp}</span>{/if}{#each s.registers as r (r)}<span
                  class="reg"
                  title={r}>{regLabel(r)}</span
                >{/each}{texts(s.definition) || '—'}{#if s.tags.length}<span class="ip-tags"
                  >{s.tags.join(' · ')}</span
                >{/if}
            </li>
          {/each}
        </ol>
        {#each lexemeFacts(pj, l) as f (f.label)}
          <div class="ip-fact" use:flashChange={fx(f.value)}>
            <span class="muted">{f.label}</span>{f.value}
          </div>
        {/each}
      </article>
    {/each}
  {:else if kind === 'morphemes' && project}
    {@const pj = project}
    {#each morphemes as m, i (i)}
      <article class="ip-item">
        <div class="ip-row">
          <span class="ip-main data" use:flashChange={fx(m.form)}>{m.form || '—'}</span>
          <span class="ip-pos" use:flashChange={fx(m.type)}>{t(`morphemes.types.${m.type}`)}</span>
          {#if m.gloss}<span class="ip-gloss" use:flashChange={fx(m.gloss)}>{m.gloss}</span>{/if}
          {#if duplicates?.has(m.form)}<span class="badge dup">{t('importPreview.duplicate')}</span
            >{/if}
        </div>
        {#if texts(m.meaning)}<div class="ip-def" use:flashChange={fx(m.meaning)}>
            {texts(m.meaning)}
          </div>{/if}
        {#each morphemeFacts(pj, m) as f (f.label)}
          <div class="ip-fact" use:flashChange={fx(f.value)}>
            <span class="muted">{f.label}</span>{f.value}
          </div>
        {/each}
      </article>
    {/each}
  {:else if kind === 'records'}
    {#each records as r, i (i)}
      <article class="ip-item" class:skip={!!r.skip}>
        <div class="ip-row">
          <span class="ip-main data" use:flashChange={fx(r.rec.text ?? '')}
            >{r.rec.text || '—'}</span
          >
          {#if r.skip}<span class="badge">{r.skip}</span>{/if}
        </div>
        {#each Object.entries(r.rec).filter(([k, v]) => k !== 'text' && v) as [k, v] (k)}
          <div class="ip-fact" use:flashChange={fx(v)}>
            <span class="muted">{fieldLabel(k)}</span>{v}
          </div>
        {/each}
      </article>
    {/each}
  {:else if kind === 'glyphs'}
    <div class="ip-glyphs">
      {#each glyphs as g, i (i)}
        <div
          class="ip-glyph"
          class:skip={g.skip}
          title={g.skip ? t('importPreview.glyphExists') : g.name}
          use:flashChange={fx([g.char, g.value, g.name, !!g.skip])}
        >
          <span class="ip-gchar" style={glyphStyle}>{g.char || '·'}</span>
          <span class="ip-gval data">{g.value || ' '}</span>
        </div>
      {/each}
    </div>
  {:else if kind === 'lines' && lines.length}
    <div class="ip-lines">
      {#each lines as line, i (i)}<div class="ip-line" use:flashChange={fx(line)}>
          {line || ' '}
        </div>{/each}
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
    padding-left: 20px;
    font-size: 13px;
    line-height: 1.55;
  }
  .ip-senses li::marker {
    color: var(--text-3);
    font-size: 11px;
  }
  /* 义项自己的词类：淡淡地写在释义前面，不抢眼 */
  .ip-spos {
    margin-right: 5px;
    font-style: italic;
    font-size: 0.92em;
    color: var(--text-3);
  }
  .reg {
    display: inline-block;
    min-width: 1.4em;
    padding: 0 3px;
    margin-right: 5px;
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
    margin-left: 6px;
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
    margin-right: 6px;
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
</style>
