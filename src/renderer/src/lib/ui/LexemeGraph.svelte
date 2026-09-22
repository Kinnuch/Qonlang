<script lang="ts">
  /**
   * 词关系图：以一个词为中心，分扇区展示来源、派生 / 复合、同源、标注关系、同义（自动）。
   * 点别的词条节点换中心；按住空白处拖动画布，Ctrl + 滚轮缩放。
   * 右键节点：展开以它为中心的一圈（它自己的来源、派生、同源……），或者收起；已经在图上的词不重复画，只连线。
   * 跟中心词同一个词根来源的词有两个以上时，右上角出现「对比」，换成对比视图（LexemeCompare）。
   */
  import { untrack } from 'svelte'
  import type { Id, Lexeme, Morpheme, Project } from '$lib/core/model'
  import { t, pickText } from '$lib/i18n/index.svelte'
  import { ui } from '$lib/state/ui.svelte'
  import {
    splitSourceForm,
    resolveFormInLanguage,
    findLanguageByName,
    morphemeLabel
  } from '$lib/core/etymology'
  import { etymologyTypeLabel, relationLabel } from '$lib/ui/labels'
  import { compareContext, compareGroups } from '$lib/core/compare'
  import LexemeCompare from './LexemeCompare.svelte'
  import { GitCompareArrows, ZoomIn, ZoomOut, LocateFixed } from '@lucide/svelte'

  let {
    project,
    lexemeId,
    onselect,
    mode = $bindable('graph')
  }: {
    project: Project
    lexemeId: Id
    onselect: (id: Id) => void
    /** 关系图还是对比视图（页面状态里记着） */
    mode?: 'graph' | 'compare'
  } = $props()

  type GroupKey = 'sources' | 'derived' | 'cognates' | 'relations' | 'synonyms'
  interface GNode {
    /** l:词条 id、m:语素 id、x:语言|成分（对不上的自定义来源成分） */
    key: string
    label: string
    sub: string
    lexemeId: Id | null
    morphemeId: Id | null
    kind: 'lexeme' | 'morpheme' | 'external'
  }
  interface Link {
    node: GNode
    edge: string
    group: GroupKey
  }

  const glossLangs = $derived(project.settings.glossLanguages)
  const center = $derived(project.lexemes.find((l) => l.id === lexemeId) ?? null)
  const lexemeOf = (id: Id): Lexeme | undefined => project.lexemes.find((l) => l.id === id)
  const morphemeOf = (id: Id): Morpheme | undefined => project.morphemes.find((m) => m.id === id)
  const defOf = (l: Lexeme): string => pickText(l.senses[0]?.definition, glossLangs)
  const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim()
  const strip = (s: string): string => s.replace(/^[-=*·]+|[-=*·]+$/g, '').trim()

  function lexNode(l: Lexeme): GNode {
    return {
      key: `l:${l.id}`,
      label: l.lemma,
      sub: defOf(l),
      lexemeId: l.id,
      morphemeId: null,
      kind: 'lexeme'
    }
  }
  function morNode(m: Morpheme): GNode {
    return {
      key: `m:${m.id}`,
      label: morphemeLabel(m) || '?',
      sub: m.gloss || pickText(m.meaning, glossLangs),
      lexemeId: null,
      morphemeId: m.id,
      kind: 'morpheme'
    }
  }
  const extKey = (language: string, piece: string): string =>
    `x:${language.trim().toLowerCase()}|${fold(strip(piece))}`

  /**
   * 自定义来源 / 中间态：拼接的形式拆成多个成分，每个成分到那门语言里找对应的词条或语素；
   * 找到了就能点过去（跨语言跳转），找不到的是虚线框。
   */
  function externalLinks(
    language: string,
    form: string,
    meaning: string,
    edge: string,
    group: GroupKey
  ): Link[] {
    const pieces = splitSourceForm(project, form)
    const lang = findLanguageByName(project, language)
    const tag = lang?.abbr || lang?.name || language
    const list = pieces.length > 1 ? pieces : [form.replace(/^\*+/, '').trim() || form]
    return list.map((piece, j) => {
      const e = list.length > 1 ? `${edge} ${j + 1}/${list.length}` : edge
      const hit = resolveFormInLanguage(project, language, piece)
      const l = hit?.kind === 'lexeme' ? lexemeOf(hit.id) : undefined
      if (l) return { node: lexNode(l), edge: e, group }
      const m = hit?.kind === 'morpheme' ? morphemeOf(hit.id) : undefined
      if (m) return { node: morNode(m), edge: e, group }
      return {
        node: {
          key: extKey(language, piece),
          label: (list.length === 1 && form.startsWith('*') ? '*' : '') + piece,
          sub: [tag, list.length === 1 ? meaning : ''].filter(Boolean).join(' · '),
          lexemeId: null,
          morphemeId: null,
          kind: 'external'
        },
        edge: e,
        group
      }
    })
  }

  /** 来源形里有没有这个成分（按那门语言的名字对，写法忽略大小写与附加符） */
  const langIdCache = new Map<string, Id | null>()
  function sourceHasPiece(
    s: { language: string; form: string },
    languageId: Id | null,
    piece: string
  ): boolean {
    if (languageId) {
      const k = s.language.trim().toLowerCase()
      if (!langIdCache.has(k))
        langIdCache.set(k, findLanguageByName(project, s.language)?.id ?? null)
      if (langIdCache.get(k) !== languageId) return false
    }
    return splitSourceForm(project, s.form).some((pc) => fold(strip(pc)) === piece)
  }

  /** 一个词条的一圈：来源（含中间态）、派生 / 复合、同源、标注关系、同义 */
  function lexemeLinks(c: Lexeme): Link[] {
    const out: Link[] = []
    for (const s of c.etymology.sources) {
      if (s.kind === 'morpheme') {
        const m = morphemeOf(s.id)
        if (m) out.push({ node: morNode(m), edge: t('morphemes.title'), group: 'sources' })
      } else if (s.kind === 'lexeme') {
        const x = lexemeOf(s.id)
        if (x)
          out.push({ node: lexNode(x), edge: t('lexicon.sourceKinds.lexeme'), group: 'sources' })
      } else
        out.push(
          ...externalLinks(
            s.language,
            s.form,
            s.meaning,
            t('lexicon.sourceKinds.external'),
            'sources'
          )
        )
    }
    for (const st of c.etymology.stages)
      if (st.form) out.push(...externalLinks('', st.form, '', t('lexicon.etyAddStage'), 'sources'))
    const derived = project.lexemes.filter(
      (x) => x.id !== c.id && x.etymology.sources.some((s) => s.kind === 'lexeme' && s.id === c.id)
    )
    for (const x of derived)
      out.push({ node: lexNode(x), edge: etymologyTypeLabel(x.etymology.type), group: 'derived' })
    const mySources = new Set(
      c.etymology.sources.filter((s) => s.kind !== 'external').map((s) => (s as { id: Id }).id)
    )
    const cognates = project.lexemes
      .filter((x) => x.id !== c.id && !derived.includes(x))
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
    for (const x of cognates)
      out.push({ node: lexNode(x), edge: t('lexicon.groups.cognates'), group: 'cognates' })
    for (const r of c.relations) {
      const x = lexemeOf(r.lexemeId)
      if (x) out.push({ node: lexNode(x), edge: relationLabel(r.kind), group: 'relations' })
    }
    for (const x of project.lexemes) {
      if (x.id === c.id || c.relations.some((r) => r.lexemeId === x.id)) continue
      const back = x.relations.find((r) => r.lexemeId === c.id)
      if (back)
        out.push({ node: lexNode(x), edge: '← ' + relationLabel(back.kind), group: 'relations' })
    }
    const myDefs = new Set(
      c.senses.flatMap((s) =>
        Object.values(s.definition)
          .map((d) => d.trim())
          .filter(Boolean)
      )
    )
    if (myDefs.size) {
      let n = 0
      for (const x of project.lexemes) {
        if (n >= 16) break
        if (x.id === c.id || x.languageId !== c.languageId) continue
        if (c.relations.some((r) => r.lexemeId === x.id)) continue
        if (!x.senses.some((s) => Object.values(s.definition).some((d) => myDefs.has(d.trim()))))
          continue
        out.push({ node: lexNode(x), edge: t('lexicon.groups.synonyms'), group: 'synonyms' })
        n++
      }
    }
    return out
  }

  /** 一个语素的一圈：它自己的来源，和用到它的词条、语素（包括在自定义来源里写到它的） */
  function morphemeLinks(m: Morpheme): Link[] {
    const out: Link[] = []
    const edge = etymologyTypeLabel(m.etymology.type) || t('lexicon.groups.sources')
    for (const s of m.etymology.sources) {
      if (s.kind === 'morpheme') {
        const y = morphemeOf(s.id)
        if (y) out.push({ node: morNode(y), edge, group: 'sources' })
      } else if (s.kind === 'lexeme') {
        const x = lexemeOf(s.id)
        if (x) out.push({ node: lexNode(x), edge, group: 'sources' })
      } else out.push(...externalLinks(s.language, s.form, s.meaning, edge, 'sources'))
    }
    for (const st of m.etymology.stages)
      if (st.form)
        out.push(...externalLinks('', st.form, m.form, t('lexicon.etyAddStage'), 'sources'))
    const piece = fold(strip(m.form))
    let n = 0
    for (const x of project.lexemes) {
      if (n >= 40) break
      const direct = x.etymology.sources.some((s) => s.kind === 'morpheme' && s.id === m.id)
      const written =
        !direct &&
        !!piece &&
        x.etymology.sources.some(
          (s) => s.kind === 'external' && sourceHasPiece(s, m.languageId, piece)
        )
      if (!direct && !written) continue
      out.push({
        node: lexNode(x),
        edge: etymologyTypeLabel(x.etymology.type) || t('lexicon.groups.derived'),
        group: 'derived'
      })
      n++
    }
    for (const y of project.morphemes)
      if (y.id !== m.id && y.etymology.sources.some((s) => s.kind === 'morpheme' && s.id === m.id))
        out.push({
          node: morNode(y),
          edge: etymologyTypeLabel(y.etymology.type) || t('lexicon.groups.derived'),
          group: 'derived'
        })
    return out
  }

  /** 对不上词条、语素的来源成分：来源里写到它的词条 */
  function externalNodeLinks(key: string): Link[] {
    const sep = key.indexOf('|')
    const language = key.slice(2, sep)
    const piece = key.slice(sep + 1)
    const out: Link[] = []
    let n = 0
    for (const x of project.lexemes) {
      if (n >= 40) break
      const s = x.etymology.sources.find(
        (s) =>
          s.kind === 'external' &&
          s.language.trim().toLowerCase() === language &&
          sourceHasPiece(s, null, piece)
      )
      if (!s) continue
      out.push({
        node: lexNode(x),
        edge: etymologyTypeLabel(x.etymology.type) || t('lexicon.groups.derived'),
        group: 'derived'
      })
      n++
    }
    return out
  }

  /** 某个节点的一圈（同一个节点只留第一条） */
  function linksOf(key: string): Link[] {
    let raw: Link[] = []
    if (key.startsWith('l:')) {
      const l = lexemeOf(key.slice(2))
      if (l) raw = lexemeLinks(l)
    } else if (key.startsWith('m:')) {
      const m = morphemeOf(key.slice(2))
      if (m) raw = morphemeLinks(m)
    } else if (key.startsWith('x:')) raw = externalNodeLinks(key)
    const seen = new Set([key])
    return raw.filter((l) => {
      if (seen.has(l.node.key)) return false
      seen.add(l.node.key)
      return true
    })
  }

  // ───── 展开与收起 ─────
  /** 展开着的节点：中心词默认展开；中心词的来源语素如果自己还有来源，也先展开（语素与词条的图连起来） */
  let expanded = $state<Set<string>>(new Set())
  function defaultExpanded(id: Id): Set<string> {
    const set = new Set([`l:${id}`])
    const c = lexemeOf(id)
    for (const s of c?.etymology.sources ?? [])
      if (s.kind === 'morpheme' && (morphemeOf(s.id)?.etymology.sources.length ?? 0) > 0)
        set.add(`m:${s.id}`)
    return set
  }
  let view = $state({ x: 0, y: 0, k: 1 })
  // 右键菜单：key 为空是在空白处点的
  let menu = $state<{ x: number; y: number; key: string | null; links: number } | null>(null)
  $effect(() => {
    const id = lexemeId
    untrack(() => {
      expanded = defaultExpanded(id)
      view = { x: 0, y: 0, k: 1 }
      menu = null
    })
  })
  function expand(key: string): void {
    expanded = new Set([...expanded, key])
  }
  function collapse(key: string): void {
    const next = new Set(expanded)
    next.delete(key)
    expanded = next
  }

  // ───── 布局 ─────
  const SECTOR: Record<GroupKey, number> = {
    sources: 180,
    derived: 0,
    cognates: 270,
    relations: 90,
    synonyms: 135
  }
  interface Placed {
    node: GNode
    x: number
    y: number
    /** 从上一层指向它的方向（弧度）：展开它时一圈往外排 */
    angle: number
  }
  interface Edge {
    key: string
    from: string
    to: string
    label: string
  }
  const NODE_W = 124
  const NODE_H = 46

  /** 挤在一起的节点推开一点（中心词不动） */
  function relax(nodes: Placed[], pinned: string): void {
    for (let it = 0; it < 40; it++) {
      let moved = false
      for (let i = 0; i < nodes.length; i++)
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i]
          const b = nodes[j]
          const dx = b.x - a.x
          const dy = b.y - a.y
          const ox = NODE_W - Math.abs(dx)
          const oy = NODE_H - Math.abs(dy)
          if (ox <= 0 || oy <= 0) continue
          moved = true
          const wa = a.node.key === pinned ? 0 : b.node.key === pinned ? 1 : 0.5
          if (ox < oy) {
            const s = (dx >= 0 ? 1 : -1) * ox
            a.x -= s * wa
            b.x += s * (1 - wa)
          } else {
            const s = (dy >= 0 ? 1 : -1) * oy
            a.y -= s * wa
            b.y += s * (1 - wa)
          }
        }
      if (!moved) break
    }
  }

  const layout = $derived.by(() => {
    if (!center) return null
    const centerKey = `l:${center.id}`
    const placed = new Map<string, Placed>()
    placed.set(centerKey, { node: lexNode(center), x: 0, y: 0, angle: Math.PI })
    const edges: Edge[] = []
    const edgeKeys = new Set<string>()
    const legend: { key: GroupKey; n: number }[] = []
    const queue = [centerKey]
    while (queue.length) {
      const k = queue.shift()!
      if (!expanded.has(k)) continue
      const here = placed.get(k)!
      const links = linksOf(k)
      const fresh = links.filter((l) => !placed.has(l.node.key))
      if (k === centerKey) {
        for (const g of Object.keys(SECTOR) as GroupKey[]) {
          const total = links.filter((l) => l.group === g).length
          if (total) legend.push({ key: g, n: total })
          const list = fresh.filter((l) => l.group === g)
          const m = list.length
          const spread = m <= 1 ? 0 : Math.min(120, 40 * m)
          const r = Math.min(300, 170 + m * 6)
          list.forEach((l, i) => {
            const deg = SECTOR[g] + (m === 1 ? 0 : -spread / 2 + (spread * i) / (m - 1))
            const a = (deg * Math.PI) / 180
            placed.set(l.node.key, {
              node: l.node,
              x: r * Math.cos(a),
              y: r * Math.sin(a),
              angle: a
            })
            queue.push(l.node.key)
          })
        }
      } else {
        const m = fresh.length
        const spread = m <= 1 ? 0 : (Math.min(150, 30 * m) * Math.PI) / 180
        const r = Math.min(320, 150 + m * 6)
        fresh.forEach((l, i) => {
          const a = here.angle + (m === 1 ? 0 : -spread / 2 + (spread * i) / (m - 1))
          placed.set(l.node.key, {
            node: l.node,
            x: here.x + r * Math.cos(a),
            y: here.y + r * Math.sin(a),
            angle: a
          })
          queue.push(l.node.key)
        })
      }
      for (const l of links) {
        const key = [k, l.node.key].sort().join('~')
        if (edgeKeys.has(key)) continue
        edgeKeys.add(key)
        edges.push({ key, from: k, to: l.node.key, label: l.edge })
      }
    }
    const nodes = [...placed.values()]
    relax(nodes, centerKey)
    // 别的语言的词标出语言名，点过去时才知道换了语言
    for (const p of nodes) {
      if (!p.node.lexemeId || p.node.key === centerKey) continue
      const x = lexemeOf(p.node.lexemeId)
      if (!x || x.languageId === center.languageId) continue
      const lg = project.languages.find((y) => y.id === x.languageId)
      const name = lg?.abbr || lg?.name
      if (name && !p.node.sub.startsWith(name))
        p.node = { ...p.node, sub: p.node.sub ? `${name} · ${p.node.sub}` : name }
    }
    return {
      centerKey,
      nodes,
      edges,
      legend,
      byKey: new Map(nodes.map((p) => [p.node.key, p]))
    }
  })

  // ───── 对比 ─────
  const groups = $derived(center ? compareGroups(compareContext(project, glossLangs), center) : [])
  const showCompare = $derived(mode === 'compare' && groups.length > 0 && !!center)
  // 换到一个没得比的词：回到关系图（不然以后点到有得比的词会突然跳进对比）
  $effect(() => {
    if (mode === 'compare' && center && groups.length === 0) mode = 'graph'
  })

  // ───── 画布：拖动、缩放 ─────
  let bw = $state(900)
  let bh = $state(560)
  let pan: { id: number; sx: number; sy: number; vx: number; vy: number } | null = null
  let panning = $state(false)
  function startPan(e: PointerEvent): void {
    if (e.button !== 0 || (e.target as Element).closest('.node')) return
    menu = null
    pan = { id: e.pointerId, sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y }
    panning = true
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  }
  function movePan(e: PointerEvent): void {
    if (!pan || e.pointerId !== pan.id) return
    view = { ...view, x: pan.vx + e.clientX - pan.sx, y: pan.vy + e.clientY - pan.sy }
  }
  function endPan(e: PointerEvent): void {
    if (!pan || e.pointerId !== pan.id) return
    pan = null
    panning = false
  }
  /** Ctrl + 滚轮：以指针为中心缩放（普通滚轮照常滚页面） */
  function onWheel(e: WheelEvent): void {
    if (!e.ctrlKey && !e.metaKey) return
    e.preventDefault()
    const rect = (e.currentTarget as Element).getBoundingClientRect()
    zoomAt(
      e.deltaY < 0 ? 1.12 : 1 / 1.12,
      e.clientX - rect.left - bw / 2,
      e.clientY - rect.top - bh / 2
    )
  }
  function zoomAt(factor: number, px = 0, py = 0): void {
    const k = Math.min(2.5, Math.max(0.3, view.k * factor))
    const wx = (px - view.x) / view.k
    const wy = (py - view.y) / view.k
    view = { x: px - wx * k, y: py - wy * k, k }
  }
  function resetView(): void {
    view = { x: 0, y: 0, k: 1 }
    menu = null
  }

  // ───── 右键菜单 ─────
  function openMenu(e: MouseEvent, key: string | null): void {
    e.preventDefault()
    e.stopPropagation()
    const W = 230
    const H = key ? 170 : 110
    menu = {
      x: Math.min(e.clientX, window.innerWidth - W - 8),
      y: Math.min(e.clientY, window.innerHeight - H - 8),
      key,
      links: key ? linksOf(key).length : 0
    }
  }
  $effect(() => {
    if (!menu) return
    const close = (ev: Event): void => {
      if (ev instanceof KeyboardEvent && ev.key !== 'Escape') return
      if (ev.type === 'pointerdown' && (ev.target as Element).closest?.('.gmenu')) return
      menu = null
    }
    window.addEventListener('pointerdown', close, true)
    window.addEventListener('keydown', close)
    window.addEventListener('wheel', close, { passive: true })
    return () => {
      window.removeEventListener('pointerdown', close, true)
      window.removeEventListener('keydown', close)
      window.removeEventListener('wheel', close)
    }
  })
  const menuNode = $derived(menu?.key ? (layout?.byKey.get(menu.key)?.node ?? null) : null)
  function run(fn: () => void): void {
    fn()
    menu = null
  }

  function activate(n: GNode): void {
    if (n.lexemeId) onselect(n.lexemeId)
    else if (n.morphemeId) ui.jump('morphemes', 'morpheme', n.morphemeId)
  }
  const short = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + '…' : s)
</script>

{#if !center}
  <p class="muted">{t('lexicon.noLanguage')}</p>
{:else if showCompare}
  <LexemeCompare {project} {center} {groups} {onselect} onback={() => (mode = 'graph')} />
{:else if layout && layout.nodes.length === 1 && expanded.has(layout.centerKey)}
  <p class="muted">{t('lexicon.noGraph')}</p>
{:else if layout}
  <div class="lg">
    <div class="legend">
      {#each layout.legend as g (g.key)}<span class="badge"
          >{t(`lexicon.groups.${g.key}`)} {g.n}</span
        >{/each}
      <span class="grow"></span>
      <span class="small muted">{t('lexicon.graphHint')}</span>
    </div>
    <div class="gwrap" bind:clientWidth={bw} bind:clientHeight={bh}>
      <svg
        class="graph"
        class:panning
        width={bw}
        height={bh}
        role="application"
        aria-label={t('lexicon.graph')}
        onpointerdown={startPan}
        onpointermove={movePan}
        onpointerup={endPan}
        onpointercancel={endPan}
        onwheel={onWheel}
        oncontextmenu={(e) => openMenu(e, null)}
      >
        <g transform={`translate(${bw / 2 + view.x} ${bh / 2 + view.y}) scale(${view.k})`}>
          {#each layout.edges as e (e.key)}
            {@const a = layout.byKey.get(e.from)!}
            {@const b = layout.byKey.get(e.to)!}
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} class="edge" />
            <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 4} class="elabel">{e.label}</text>
          {/each}
          {#each layout.nodes as p (p.node.key)}
            {@const n = p.node}
            {@const isCenter = n.key === layout.centerKey}
            <g
              class="node {n.kind}"
              class:center={isCenter}
              class:open={expanded.has(n.key) && !isCenter}
              class:clickable={!isCenter && (!!n.lexemeId || !!n.morphemeId)}
              data-key={n.key}
              transform={`translate(${p.x}, ${p.y})`}
              role="button"
              tabindex="-1"
              onclick={() => !isCenter && activate(n)}
              onkeydown={(e) => e.key === 'Enter' && !isCenter && activate(n)}
              oncontextmenu={(e) => openMenu(e, n.key)}
            >
              {#if isCenter}
                <rect x="-70" y="-24" width="140" height="48" rx="12" />
                <text y="-4" class="label big">{short(n.label, 14)}</text>
                <text y="14" class="sub">{short(n.sub, 18)}</text>
              {:else}
                <rect x="-56" y="-18" width="112" height="36" rx="10" />
                <text y="-2" class="label">{short(n.label, 12)}</text>
                <text y="12" class="sub">{short(n.sub, 16)}</text>
              {/if}
            </g>
          {/each}
        </g>
      </svg>
      <div class="tools">
        <button
          class="btn ghost icon sm"
          title={t('lexicon.graphZoomIn')}
          onclick={() => zoomAt(1.2)}><ZoomIn size={15} /></button
        >
        <button
          class="btn ghost icon sm"
          title={t('lexicon.graphZoomOut')}
          onclick={() => zoomAt(1 / 1.2)}><ZoomOut size={15} /></button
        >
        <button class="btn ghost icon sm" title={t('lexicon.graphReset')} onclick={resetView}
          ><LocateFixed size={15} /></button
        >
      </div>
      {#if groups.length}
        <button
          class="btn sm compare"
          title={t('lexicon.compareTitle')}
          onclick={() => (mode = 'compare')}
          ><GitCompareArrows size={14} />{t('lexicon.compare')}<span class="badge"
            >{groups.length}</span
          ></button
        >
      {/if}
    </div>
  </div>
{/if}

{#if menu}
  <div class="gmenu card" role="menu" style:left={`${menu.x}px`} style:top={`${menu.y}px`}>
    {#if menu.key}
      {@const key = menu.key}
      {#if menuNode}<div class="mhead data">{menuNode.label}</div>{/if}
      <button
        role="menuitem"
        disabled={expanded.has(key) || menu.links === 0}
        onclick={() => run(() => expand(key))}>{t('lexicon.graphExpand')}</button
      >
      <button role="menuitem" disabled={!expanded.has(key)} onclick={() => run(() => collapse(key))}
        >{t('lexicon.graphCollapse')}</button
      >
      {#if menuNode?.lexemeId && key !== layout?.centerKey}
        {@const id = menuNode.lexemeId}
        <hr />
        <button role="menuitem" onclick={() => run(() => onselect(id))}
          >{t('lexicon.graphRecenter')}</button
        >
      {:else if menuNode?.morphemeId}
        {@const id = menuNode.morphemeId}
        <hr />
        <button role="menuitem" onclick={() => run(() => ui.jump('morphemes', 'morpheme', id))}
          >{t('corpus.openInMorphemes')}</button
        >
      {/if}
    {:else}
      <button role="menuitem" onclick={resetView}>{t('lexicon.graphReset')}</button>
      <button role="menuitem" onclick={() => run(() => (expanded = defaultExpanded(lexemeId)))}
        >{t('lexicon.graphCollapseAll')}</button
      >
    {/if}
  </div>
{/if}

<style>
  .lg {
    display: flex;
    flex-direction: column;
    gap: 8px;
    height: 100%;
    min-height: 460px;
  }
  .legend {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    align-items: center;
  }
  .gwrap {
    position: relative;
    flex: 1;
    min-height: 420px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-elev);
    overflow: hidden;
  }
  .graph {
    position: absolute;
    inset: 0;
    display: block;
    font-family: var(--font-data);
    cursor: grab;
    touch-action: none;
    user-select: none;
  }
  .graph.panning {
    cursor: grabbing;
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
  .node.open rect {
    stroke-width: 2;
    stroke: var(--accent);
  }
  .node.center rect {
    fill: var(--accent-soft);
    stroke: var(--accent);
    stroke-width: 2;
  }
  .node {
    cursor: default;
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
  .tools {
    position: absolute;
    top: 8px;
    left: 8px;
    display: flex;
    gap: 2px;
    padding: 2px;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--bg-elev) 85%, transparent);
  }
  .compare {
    position: absolute;
    top: 8px;
    right: 8px;
    box-shadow: var(--shadow);
  }
  .compare .badge {
    margin-inline-start: 2px;
  }
  .gmenu {
    position: fixed;
    z-index: 320;
    min-width: 200px;
    padding: 4px;
    display: flex;
    flex-direction: column;
    box-shadow: var(--shadow-lg);
  }
  .gmenu .mhead {
    padding: 4px 10px 6px;
    font-size: 13px;
    color: var(--text-2);
    border-bottom: 1px solid var(--border);
    margin-bottom: 4px;
  }
  .gmenu button {
    text-align: start;
    padding: 6px 10px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text);
    font-size: 13px;
    cursor: pointer;
  }
  .gmenu button:hover:not(:disabled) {
    background: var(--bg-hover);
  }
  .gmenu button:disabled {
    color: var(--text-3);
    cursor: default;
  }
  .gmenu hr {
    border: 0;
    border-top: 1px solid var(--border);
    margin: 4px 0;
  }
</style>
