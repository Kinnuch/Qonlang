<script lang="ts">
  /**
   * 词关系图：以一个词为中心，分扇区展示来源、派生 / 复合、同源、标注关系、同义（自动）。
   * 点其他词位节点即以它为中心。
   */
  import type { Id, Project } from '$lib/core/model'
  import { t, pickText } from '$lib/i18n/index.svelte'
  import { ui } from '$lib/state/ui.svelte'
  import { splitSourceForm, resolveFormInLanguage, findLanguageByName } from '$lib/core/etymology'
  import { relationLabel } from '$lib/ui/labels'

  let {
    project,
    lexemeId,
    onselect
  }: { project: Project; lexemeId: Id; onselect: (id: Id) => void } = $props()

  interface GNode {
    key: string
    label: string
    sub: string
    lexemeId: Id | null
    /** 落到语素上的节点：点了跳去语素页 */
    morphemeId?: Id | null
    kind: 'lexeme' | 'morpheme' | 'external'
    edge: string
    x: number
    y: number
  }
  interface Group {
    key: 'sources' | 'derived' | 'cognates' | 'relations' | 'synonyms'
    nodes: GNode[]
    /** 扇区中心角（度，0 = 右，顺时针） */
    angle: number
  }

  const glossLangs = $derived(project.settings.glossLanguages)
  const center = $derived(project.lexemes.find((l) => l.id === lexemeId) ?? null)
  const defOf = (id: Id): string => {
    const x = project.lexemes.find((l) => l.id === id)
    return x ? pickText(x.senses[0]?.definition, glossLangs) : ''
  }
  const relLabel = relationLabel

  /**
   * 自定义来源 / 中间态：拼接的形式拆成多个节点，每个成分都到那门语言里找对应的词条或语素；
   * 找到了就能点过去（跨语言跳转）。
   */
  function externalNodes(
    key: string,
    language: string,
    form: string,
    meaning: string,
    edge: string
  ): GNode[] {
    const pieces = splitSourceForm(project, form)
    const lang = findLanguageByName(project, language)
    const langTag = lang?.abbr || lang?.name || language
    const list = pieces.length > 1 ? pieces : [form.replace(/^\*+/, '').trim() || form]
    return list.map((piece, j) => {
      const hit = resolveFormInLanguage(project, language, piece)
      let meaningOf = list.length === 1 ? meaning : ''
      if (hit?.kind === 'lexeme') meaningOf = defOf(hit.id)
      else if (hit?.kind === 'morpheme') {
        const m = project.morphemes.find((x) => x.id === hit.id)
        meaningOf = m ? m.gloss || pickText(m.meaning, glossLangs) : ''
      }
      return {
        key: `${key}-${j}`,
        label: (list.length === 1 && form.startsWith('*') ? '*' : '') + piece,
        sub: [langTag, meaningOf].filter(Boolean).join(' · '),
        lexemeId: hit?.kind === 'lexeme' ? hit.id : null,
        morphemeId: hit?.kind === 'morpheme' ? hit.id : null,
        kind: hit ? hit.kind : 'external',
        edge: list.length > 1 ? `${edge} ${j + 1}/${list.length}` : edge,
        x: 0,
        y: 0
      }
    })
  }

  const groups = $derived.by((): Group[] => {
    if (!center) return []
    const c = center
    const sourcesNested: GNode[][] = c.etymology.sources.map((s, i): GNode[] => {
      if (s.kind === 'morpheme') {
        const m = project.morphemes.find((x) => x.id === s.id)
        return [
          {
            key: `src${i}`,
            label: m?.form ?? '?',
            sub: m ? m.gloss || pickText(m.meaning, glossLangs) : '',
            lexemeId: null,
            morphemeId: m?.id ?? null,
            kind: 'morpheme',
            edge: t('morphemes.title'),
            x: 0,
            y: 0
          }
        ]
      }
      if (s.kind === 'lexeme') {
        const x = project.lexemes.find((y) => y.id === s.id)
        return [
          {
            key: `src${i}`,
            label: x?.lemma ?? '?',
            sub: x ? defOf(x.id) : '',
            lexemeId: x?.id ?? null,
            kind: 'lexeme',
            edge: t('lexicon.sourceKinds.lexeme'),
            x: 0,
            y: 0
          }
        ]
      }
      return externalNodes(
        `src${i}`,
        s.language,
        s.form,
        s.meaning,
        t('lexicon.sourceKinds.external')
      )
    })
    const sources = sourcesNested.flat()
    // 语素本身的词源：把语素的来源也挂到这一圈，语素与词条的图就连起来了
    for (const [i, s] of c.etymology.sources.entries()) {
      if (s.kind !== 'morpheme') continue
      const m = project.morphemes.find((x) => x.id === s.id)
      for (const [j, ms] of (m?.etymology.sources ?? []).entries()) {
        const form =
          ms.kind === 'morpheme'
            ? (project.morphemes.find((x) => x.id === ms.id)?.form ?? '?')
            : ms.kind === 'lexeme'
              ? (project.lexemes.find((x) => x.id === ms.id)?.lemma ?? '?')
              : ms.form
        if (!form) continue
        const edge = t(`lexicon.etyTypes.${m ? m.etymology.type : 'unknown'}`)
        if (ms.kind === 'external')
          sources.push(...externalNodes(`msrc${i}-${j}`, ms.language, ms.form, ms.meaning, edge))
        else
          sources.push({
            key: `msrc${i}-${j}`,
            label: form,
            sub: m ? m.form : '',
            lexemeId: ms.kind === 'lexeme' ? ms.id : null,
            morphemeId: ms.kind === 'morpheme' ? ms.id : null,
            kind: ms.kind === 'lexeme' ? 'lexeme' : 'morpheme',
            edge,
            x: 0,
            y: 0
          })
      }
      for (const st of m?.etymology.stages ?? [])
        if (st.form)
          sources.push(
            ...externalNodes(
              `mstage${i}-${st.id}`,
              '',
              st.form,
              m?.form ?? '',
              t('lexicon.etyAddStage')
            )
          )
    }
    // 词条自己的中间态：也当作可拆的形式挂上
    for (const st of c.etymology.stages)
      if (st.form)
        sources.push(...externalNodes(`stage${st.id}`, '', st.form, '', t('lexicon.etyAddStage')))
    const derived: GNode[] = project.lexemes
      .filter(
        (x) =>
          x.id !== c.id && x.etymology.sources.some((s) => s.kind === 'lexeme' && s.id === c.id)
      )
      .map((x) => ({
        key: `der${x.id}`,
        label: x.lemma,
        sub: defOf(x.id),
        lexemeId: x.id,
        kind: 'lexeme',
        edge: t(`lexicon.etyTypes.${x.etymology.type}`),
        x: 0,
        y: 0
      }))
    const mySources = new Set(
      c.etymology.sources.filter((s) => s.kind !== 'external').map((s) => (s as { id: Id }).id)
    )
    const cognates: GNode[] = project.lexemes
      .filter((x) => x.id !== c.id && !derived.some((d) => d.lexemeId === x.id))
      .filter(
        (x) =>
          x.etymology.sources.some(
            (s) => s.kind !== 'external' && mySources.has((s as { id: Id }).id)
          ) ||
          x.etymology.sources.some(
            (s) =>
              s.kind === 'external' &&
              !!s.form &&
              c.etymology.sources.some((cs) => cs.kind === 'external' && cs.form === s.form)
          )
      )
      .slice(0, 24)
      .map((x) => ({
        key: `cog${x.id}`,
        label: x.lemma,
        sub: [project.languages.find((l) => l.id === x.languageId)?.abbr, defOf(x.id)]
          .filter(Boolean)
          .join(' · '),
        lexemeId: x.id,
        kind: 'lexeme',
        edge: t('lexicon.groups.cognates'),
        x: 0,
        y: 0
      }))
    const relations: GNode[] = [
      ...c.relations.map((r) => ({
        key: `rel${r.lexemeId}${r.kind}`,
        label: project.lexemes.find((x) => x.id === r.lexemeId)?.lemma ?? '?',
        sub: defOf(r.lexemeId),
        lexemeId: r.lexemeId,
        kind: 'lexeme' as const,
        edge: relLabel(r.kind),
        x: 0,
        y: 0
      })),
      ...project.lexemes
        .filter(
          (x) =>
            x.id !== c.id &&
            x.relations.some((r) => r.lexemeId === c.id) &&
            !c.relations.some((r) => r.lexemeId === x.id)
        )
        .map((x) => ({
          key: `rev${x.id}`,
          label: x.lemma,
          sub: defOf(x.id),
          lexemeId: x.id,
          kind: 'lexeme' as const,
          edge: '← ' + relLabel(x.relations.find((r) => r.lexemeId === c.id)!.kind),
          x: 0,
          y: 0
        }))
    ]
    const myDefs = new Set(
      c.senses.flatMap((s) =>
        Object.values(s.definition)
          .map((d) => d.trim())
          .filter(Boolean)
      )
    )
    const synonyms: GNode[] = myDefs.size
      ? project.lexemes
          .filter(
            (x) =>
              x.id !== c.id &&
              x.languageId === c.languageId &&
              x.senses.some((s) => Object.values(s.definition).some((d) => myDefs.has(d.trim())))
          )
          .filter((x) => !relations.some((r) => r.lexemeId === x.id))
          .slice(0, 16)
          .map((x) => ({
            key: `syn${x.id}`,
            label: x.lemma,
            sub: defOf(x.id),
            lexemeId: x.id,
            kind: 'lexeme' as const,
            edge: t('lexicon.groups.synonyms'),
            x: 0,
            y: 0
          }))
      : []
    const groups = [
      { key: 'sources', nodes: sources, angle: 180 },
      { key: 'derived', nodes: derived, angle: 0 },
      { key: 'cognates', nodes: cognates, angle: 270 },
      { key: 'relations', nodes: relations, angle: 90 },
      { key: 'synonyms', nodes: synonyms, angle: 135 }
    ].filter((g) => g.nodes.length) as Group[]
    // 别的语言的节点标出语言名，点过去时才知道换了语言
    for (const g of groups)
      for (const n of g.nodes) {
        if (!n.lexemeId) continue
        const x = project.lexemes.find((y) => y.id === n.lexemeId)
        if (!x || x.languageId === c.languageId) continue
        const lg = project.languages.find((y) => y.id === x.languageId)
        const name = lg?.abbr || lg?.name
        if (name && !n.sub.startsWith(name)) n.sub = n.sub ? `${name} · ${n.sub}` : name
      }
    return groups
  })

  function activate(n: GNode): void {
    if (n.lexemeId) onselect(n.lexemeId)
    else if (n.morphemeId) ui.jump('morphemes', 'morpheme', n.morphemeId)
  }

  const W = 900
  const H = 620
  const cx = W / 2
  const cy = H / 2

  const laid = $derived.by(() => {
    const out: { group: Group; nodes: GNode[] }[] = []
    for (const g of groups) {
      const n = g.nodes.length
      const spread = n <= 1 ? 0 : Math.min(120, 40 * n)
      const r = Math.min(260, 170 + n * 6)
      const nodes = g.nodes.map((node, i) => {
        const a = ((g.angle + (n === 1 ? 0 : -spread / 2 + (spread * i) / (n - 1))) * Math.PI) / 180
        return { ...node, x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }
      })
      out.push({ group: g, nodes })
    }
    return out
  })
  const total = $derived(groups.reduce((a, g) => a + g.nodes.length, 0))
</script>

{#if !center}
  <p class="muted">{t('lexicon.noLanguage')}</p>
{:else if total === 0}
  <p class="muted">{t('lexicon.noGraph')}</p>
{:else}
  <div class="legend">
    {#each groups as g (g.key)}<span class="badge"
        >{t(`lexicon.groups.${g.key}`)} {g.nodes.length}</span
      >{/each}
  </div>
  <div class="wrap">
    <svg viewBox={`0 0 ${W} ${H}`} class="graph">
      {#each laid as { nodes } (nodes[0]?.key)}
        {#each nodes as n (n.key)}
          <line x1={cx} y1={cy} x2={n.x} y2={n.y} class="edge" />
          <text x={(cx + n.x) / 2} y={(cy + n.y) / 2 - 4} class="elabel">{n.edge}</text>
        {/each}
      {/each}
      {#each laid as { nodes } (nodes[0]?.key + 'n')}
        {#each nodes as n (n.key)}
          <g
            class="node {n.kind}"
            class:clickable={!!n.lexemeId || !!n.morphemeId}
            transform={`translate(${n.x}, ${n.y})`}
            role="button"
            tabindex="-1"
            onclick={() => activate(n)}
            onkeydown={(e) => e.key === 'Enter' && activate(n)}
          >
            <rect x="-56" y="-18" width="112" height="36" rx="10" />
            <text y="-2" class="label">{n.label}</text>
            <text y="12" class="sub">{n.sub.length > 16 ? n.sub.slice(0, 15) + '…' : n.sub}</text>
          </g>
        {/each}
      {/each}
      <g class="node center" transform={`translate(${cx}, ${cy})`}>
        <rect x="-70" y="-24" width="140" height="48" rx="12" />
        <text y="-4" class="label big">{center.lemma}</text>
        <text y="14" class="sub"
          >{pickText(center.senses[0]?.definition, glossLangs).slice(0, 18)}</text
        >
      </g>
    </svg>
  </div>
{/if}

<style>
  .legend {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    margin-bottom: 8px;
  }
  .wrap {
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-elev);
    overflow: auto;
  }
  .graph {
    width: 100%;
    max-width: 1100px;
    display: block;
    font-family: var(--font-data);
  }
  .edge {
    stroke: var(--border-strong);
    stroke-width: 1.2;
  }
  .elabel {
    font-family: var(--font-ui);
    font-size: 10px;
    fill: var(--text-3);
    text-anchor: middle;
    paint-order: stroke;
    stroke: var(--bg-elev);
    stroke-width: 3;
  }
  .node rect {
    fill: var(--bg);
    stroke: var(--border-strong);
  }
  .node.morpheme rect {
    fill: #f3e8ff;
    stroke: #8b5cf6;
  }
  .node.external rect {
    stroke-dasharray: 4 3;
  }
  .node.center rect {
    fill: var(--accent-soft);
    stroke: var(--accent);
    stroke-width: 2;
  }
  .node.clickable {
    cursor: pointer;
  }
  .node.clickable:hover rect {
    stroke: var(--accent);
  }
  .label {
    text-anchor: middle;
    font-size: 15px;
    fill: var(--text);
  }
  .label.big {
    font-size: 20px;
    font-weight: 600;
  }
  .sub {
    text-anchor: middle;
    font-family: var(--font-ui);
    font-size: 10px;
    fill: var(--text-3);
  }
  :global([data-theme='dark']) .node.morpheme rect {
    fill: #2e1f4a;
  }
</style>
