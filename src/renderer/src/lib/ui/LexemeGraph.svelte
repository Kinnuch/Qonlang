<script lang="ts">
  /**
   * 词关系图：以一个词为中心，分扇区展示来源、派生 / 复合、同源、标注关系、同义（自动）。
   * 点其他词位节点即以它为中心。
   */
  import type { Id, Project } from '$lib/core/model'
  import { t, pickText } from '$lib/i18n/index.svelte'

  let { project, lexemeId, onselect }: { project: Project; lexemeId: Id; onselect: (id: Id) => void } = $props()

  interface GNode {
    key: string
    label: string
    sub: string
    lexemeId: Id | null
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
  const relLabel = (kind: string): string => {
    const k = t(`lexicon.relKinds.${kind}`)
    return k === `lexicon.relKinds.${kind}` ? kind : k
  }

  const groups = $derived.by((): Group[] => {
    if (!center) return []
    const c = center
    const sources: GNode[] = c.etymology.sources.map((s, i): GNode => {
      if (s.kind === 'morpheme') {
        const m = project.morphemes.find((x) => x.id === s.id)
        return { key: `src${i}`, label: m?.form ?? '?', sub: m ? m.gloss || pickText(m.meaning, glossLangs) : '', lexemeId: null, kind: 'morpheme', edge: t('morphemes.title'), x: 0, y: 0 }
      }
      if (s.kind === 'lexeme') {
        const x = project.lexemes.find((y) => y.id === s.id)
        return { key: `src${i}`, label: x?.lemma ?? '?', sub: x ? defOf(x.id) : '', lexemeId: x?.id ?? null, kind: 'lexeme', edge: t('lexicon.sourceKinds.lexeme'), x: 0, y: 0 }
      }
      return { key: `src${i}`, label: s.form, sub: [s.language, s.meaning].filter(Boolean).join(' · '), lexemeId: null, kind: 'external', edge: t('lexicon.sourceKinds.external'), x: 0, y: 0 }
    })
    const derived: GNode[] = project.lexemes
      .filter((x) => x.id !== c.id && x.etymology.sources.some((s) => s.kind === 'lexeme' && s.id === c.id))
      .map((x) => ({ key: `der${x.id}`, label: x.lemma, sub: defOf(x.id), lexemeId: x.id, kind: 'lexeme', edge: t(`lexicon.etyTypes.${x.etymology.type}`), x: 0, y: 0 }))
    const mySources = new Set(c.etymology.sources.filter((s) => s.kind !== 'external').map((s) => (s as { id: Id }).id))
    const cognates: GNode[] = project.lexemes
      .filter((x) => x.id !== c.id && !derived.some((d) => d.lexemeId === x.id))
      .filter((x) => x.etymology.sources.some((s) => s.kind !== 'external' && mySources.has((s as { id: Id }).id)) || (!!c.etymology.protoForm && x.etymology.protoForm === c.etymology.protoForm))
      .slice(0, 24)
      .map((x) => ({ key: `cog${x.id}`, label: x.lemma, sub: [project.languages.find((l) => l.id === x.languageId)?.abbr, defOf(x.id)].filter(Boolean).join(' · '), lexemeId: x.id, kind: 'lexeme', edge: t('lexicon.groups.cognates'), x: 0, y: 0 }))
    const relations: GNode[] = [
      ...c.relations.map((r) => ({ key: `rel${r.lexemeId}${r.kind}`, label: project.lexemes.find((x) => x.id === r.lexemeId)?.lemma ?? '?', sub: defOf(r.lexemeId), lexemeId: r.lexemeId, kind: 'lexeme' as const, edge: relLabel(r.kind), x: 0, y: 0 })),
      ...project.lexemes
        .filter((x) => x.id !== c.id && x.relations.some((r) => r.lexemeId === c.id) && !c.relations.some((r) => r.lexemeId === x.id))
        .map((x) => ({ key: `rev${x.id}`, label: x.lemma, sub: defOf(x.id), lexemeId: x.id, kind: 'lexeme' as const, edge: '← ' + relLabel(x.relations.find((r) => r.lexemeId === c.id)!.kind), x: 0, y: 0 }))
    ]
    const myDefs = new Set(c.senses.flatMap((s) => Object.values(s.definition).map((d) => d.trim()).filter(Boolean)))
    const synonyms: GNode[] = myDefs.size
      ? project.lexemes
          .filter((x) => x.id !== c.id && x.languageId === c.languageId && x.senses.some((s) => Object.values(s.definition).some((d) => myDefs.has(d.trim()))))
          .filter((x) => !relations.some((r) => r.lexemeId === x.id))
          .slice(0, 16)
          .map((x) => ({ key: `syn${x.id}`, label: x.lemma, sub: defOf(x.id), lexemeId: x.id, kind: 'lexeme' as const, edge: t('lexicon.groups.synonyms'), x: 0, y: 0 }))
      : []
    return [
      { key: 'sources', nodes: sources, angle: 180 },
      { key: 'derived', nodes: derived, angle: 0 },
      { key: 'cognates', nodes: cognates, angle: 270 },
      { key: 'relations', nodes: relations, angle: 90 },
      { key: 'synonyms', nodes: synonyms, angle: 135 }
    ].filter((g) => g.nodes.length) as Group[]
  })

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
    {#each groups as g (g.key)}<span class="badge">{t(`lexicon.groups.${g.key}`)} {g.nodes.length}</span>{/each}
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
          <g class="node {n.kind}" class:clickable={!!n.lexemeId} transform={`translate(${n.x}, ${n.y})`} role="button" tabindex="-1" onclick={() => n.lexemeId && onselect(n.lexemeId)} onkeydown={(e) => e.key === 'Enter' && n.lexemeId && onselect(n.lexemeId)}>
            <rect x="-56" y="-18" width="112" height="36" rx="10" />
            <text y="-2" class="label">{n.label}</text>
            <text y="12" class="sub">{n.sub.length > 16 ? n.sub.slice(0, 15) + '…' : n.sub}</text>
          </g>
        {/each}
      {/each}
      <g class="node center" transform={`translate(${cx}, ${cy})`}>
        <rect x="-70" y="-24" width="140" height="48" rx="12" />
        <text y="-4" class="label big">{center.lemma}</text>
        <text y="14" class="sub">{pickText(center.senses[0]?.definition, glossLangs).slice(0, 18)}</text>
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
