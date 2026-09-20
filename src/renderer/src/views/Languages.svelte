<script lang="ts">
  import { untrack } from 'svelte'
  import { matchQuery, parseQuery } from '$lib/core/query'
  import { SEARCH_FIELDS } from '$lib/core/searchFields'
  import { projectState } from '$lib/state/project.svelte'
  import { ui } from '$lib/state/ui.svelte'
  import { t } from '$lib/i18n/index.svelte'
  import {
    createLanguage,
    languageLineage,
    wouldCreateCycle,
    LANGUAGE_COLORS,
    newId
  } from '$lib/core/factory'
  import {
    LANGUAGE_GROUP_LEVELS,
    type Id,
    type Language,
    type LanguageGroup,
    type LanguageGroupLevel
  } from '$lib/core/model'
  import {
    childGroups,
    effectiveGroupId,
    groupAncestors,
    groupLanguages,
    languageTree,
    nearestCommonNode,
    wouldCreateGroupCycle,
    type TreeRef
  } from '$lib/core/languageTree'
  import {
    draggingRef,
    treeDragProps,
    treeRootDropProps,
    type DropZone
  } from '$lib/ui/treeDrag.svelte'
  import { mergeAsStages, stageChain } from '$lib/core/mergeStages'
  import Portal from '$lib/ui/Portal.svelte'
  import Menu from '$lib/ui/Menu.svelte'
  import LanguageNode from './LanguageNode.svelte'
  import LanguageGraph from './LanguageGraph.svelte'
  import GroupStats from './GroupStats.svelte'
  import {
    Plus,
    Trash2,
    Star,
    X,
    Network,
    ChevronUp,
    ChevronDown,
    GitMerge,
    List,
    ListTree,
    GitCompare
  } from '@lucide/svelte'
  import GuideLink from '$lib/ui/GuideLink.svelte'
  import HelpDot from '$lib/ui/HelpDot.svelte'

  let { inspectorTitle = $bindable('') }: { inspectorTitle?: string } = $props()

  /** 回到这一页时还选着上次那门语言（或那个分类节点）、还是上次那种看法、还比着上次那两门 */
  const memo = ui.memo<{ selectedId: Id | null; view: PageLayout; compareIds: Id[] }>('languages')
  let selectedId = $state<Id | null>(memo.selectedId ?? null)
  type PageLayout = 'list' | 'tree'
  let layout = $state<PageLayout>(memo.view === 'tree' ? 'tree' : 'list')
  /** 挑出来对比的两门语言 */
  let compareIds = $state<Id[]>(memo.compareIds ?? [])

  const project = $derived(projectState.project!)
  const groups = $derived(project.languageGroups ?? [])
  const tree = $derived(languageTree(project))
  /** 顶栏搜索：命中的语言、分类节点与它们往上的一串；命中的节点下面整个都显示。没搜索时为 null（全显示） */
  const visible = $derived.by((): Set<Id> | null => {
    const pq = parseQuery(ui.search, SEARCH_FIELDS.languages)
    if (!pq.terms.length) return null
    const byId = new Map(project.languages.map((l) => [l.id, l]))
    const hit = (x: { name: string; abbr: string; notes?: string }): boolean =>
      matchQuery(pq, (f) =>
        f === 'name'
          ? [x.name]
          : f === 'abbr'
            ? [x.abbr]
            : f === 'note'
              ? [x.notes ?? '']
              : [x.name, x.abbr, x.notes ?? '']
      )
    const out = new Set<Id>()
    const addLanguage = (l: Language): void => {
      let p: Language | null | undefined = l
      while (p && !out.has(p.id)) {
        out.add(p.id)
        const g = effectiveGroupId(project, p.id)
        if (g) for (const a of groupAncestors(groups, g)) out.add(a)
        p = p.parentId ? byId.get(p.parentId) : null
      }
    }
    for (const l of project.languages) if (hit(l)) addLanguage(l)
    for (const g of groups) {
      if (!hit(g)) continue
      for (const a of groupAncestors(groups, g.id)) out.add(a)
      for (const d of groups) if (groupAncestors(groups, d.id).has(g.id)) out.add(d.id)
      for (const l of groupLanguages(project, g.id)) addLanguage(l)
    }
    return out
  })
  const roots = $derived(
    tree.filter((x) => !visible || visible.has(x.kind === 'group' ? x.group.id : x.language.id))
  )
  const selected = $derived(project.languages.find((l) => l.id === selectedId) ?? null)
  const selectedGroup = $derived(groups.find((g) => g.id === selectedId) ?? null)

  $effect(() => {
    inspectorTitle = selected
      ? selected.name || t('app.untitledLanguage')
      : selectedGroup
        ? selectedGroup.name || t('languages.untitledGroup')
        : t('languages.title')
  })
  $effect(() => {
    // 初次进入时选中当前语言
    if (!selectedId && projectState.currentLanguageId) selectedId = projectState.currentLanguageId
  })
  // 顶栏换了当前语言：树里也选中它（跟下面的 pick 是一来一回）
  $effect(() => {
    const cur = projectState.currentLanguageId
    untrack(() => {
      if (cur && cur !== selectedId && project.languages.some((l) => l.id === cur)) selectedId = cur
    })
  })
  /**
   * 在树里、谱系里点一门语言（或者从别处跳过来）：选中它，顶栏右上角的「当前语言」也换成它；点分类节点只选中。
   * 按着 Ctrl / Cmd 点语言是挑出来对比。
   */
  function pick(id: Id, kind: 'group' | 'language' = 'language', addToCompare = false): void {
    if (addToCompare && kind === 'language') return toggleCompare(id)
    selectedId = id
    if (kind === 'language' && projectState.currentLanguageId !== id)
      projectState.currentLanguageId = id
  }
  $effect(() => {
    const id = ui.takePending('language')
    if (id) pick(id)
  })
  // 「返回」用：报上当前位置，返回时原样恢复
  $effect(() => {
    ui.reportView('languages', {
      kind: 'language',
      lang: projectState.currentLanguageId,
      id: selectedId
    })
  })
  $effect(() => {
    const r = ui.takeRestore('languages')
    if (r?.view?.id) selectedId = r.view.id
  })
  $effect(() => {
    memo.selectedId = selectedId
    memo.view = layout
    memo.compareIds = compareIds
  })

  // ── 挑两门语言对比 ──
  /** 点一下加进来 / 再点一下去掉；已经有两门了就顶掉先挑的那门 */
  function toggleCompare(id: Id): void {
    compareIds = compareIds.includes(id)
      ? compareIds.filter((x) => x !== id)
      : [...compareIds, id].slice(-2)
  }
  const compareLangs = $derived(
    compareIds
      .map((id) => project.languages.find((l) => l.id === id))
      .filter((l): l is Language => !!l)
  )
  // 挑着的语言被删了：跟着清掉
  $effect(() => {
    if (compareLangs.length !== compareIds.length) compareIds = compareLangs.map((l) => l.id)
  })
  const common = $derived(
    compareLangs.length === 2
      ? nearestCommonNode(project, compareLangs[0].id, compareLangs[1].id)
      : null
  )
  const refKey = (r: TreeRef): string => (r.kind === 'group' ? 'g:' : 'l:') + r.id
  /** 两条路径上的节点，列表里描虚线、树状图里也描 */
  const hlNodes = $derived(new Set(common ? [...common.pathA, ...common.pathB].map(refKey) : []))
  /** 两条路径上的连线（`父key>子key`），树状图用 */
  const hlEdges = $derived.by(() => {
    const out = new Set<string>()
    if (!common) return out
    for (const p of [common.pathA, common.pathB])
      for (let i = 0; i + 1 < p.length; i++) out.add(refKey(p[i + 1]) + '>' + refKey(p[i]))
    return out
  })
  /** 最近公共祖先那一行（公共祖先一定是语言，分类节点不算） */
  const commonName = $derived(
    common
      ? project.languages.find((l) => l.id === common.node.id)?.name || t('app.untitledLanguage')
      : ''
  )
  const commonLine = $derived(
    common
      ? t('languages.compare.ancestor', { name: commonName })
      : t('languages.compare.noAncestor')
  )

  // ── 拖着换挂靠、换顺序 ──
  const langOf = (id: Id): Language | undefined => project.languages.find((l) => l.id === id)
  const groupOf = (id: Id): LanguageGroup | undefined => groups.find((g) => g.id === id)
  /** 这一下放得下去吗：挂到自己的后代下面、分类节点挂到语言下面都不行 */
  function canDrop(src: TreeRef, target: TreeRef | null, zone: DropZone): boolean {
    if (!target) return true
    if (src.kind === target.kind && src.id === target.id) return false
    if (zone === 'into') {
      if (src.kind === 'language')
        return target.kind === 'group' || !wouldCreateCycle(project.languages, src.id, target.id)
      return target.kind === 'group' && !wouldCreateGroupCycle(groups, src.id, target.id)
    }
    // 插到兄弟中间：跟目标同一级（两边一定是同一类，见 treeDrag 的 zoneOf）
    if (src.kind === 'language')
      return !wouldCreateCycle(project.languages, src.id, langOf(target.id)?.parentId ?? null)
    return !wouldCreateGroupCycle(groups, src.id, groupOf(target.id)?.parentId ?? null)
  }
  /** 把 srcId 那一项挪到 targetId 的前面或后面 */
  function reorderSibling<T extends { id: Id }>(
    arr: T[],
    srcId: Id,
    targetId: Id,
    zone: DropZone
  ): void {
    const from = arr.findIndex((x) => x.id === srcId)
    if (from < 0) return
    const [item] = arr.splice(from, 1)
    const at = arr.findIndex((x) => x.id === targetId)
    if (at < 0) arr.splice(from, 0, item)
    else arr.splice(zone === 'before' ? at : at + 1, 0, item)
  }
  function applyDrop(src: TreeRef, target: TreeRef | null, zone: DropZone): void {
    if (!canDrop(src, target, zone)) return void ui.error(t('languages.cycle'))
    if (!target) {
      // 最外层：谁也不挂
      if (src.kind === 'language') {
        const l = langOf(src.id)
        if (!l) return
        l.parentId = null
        l.groupId = null
      } else {
        const g = groupOf(src.id)
        if (!g) return
        g.parentId = null
      }
    } else if (zone === 'into') {
      if (src.kind === 'language') {
        const l = langOf(src.id)
        if (!l) return
        if (target.kind === 'group') l.groupId = target.id
        else {
          l.parentId = target.id
          // 自己另写着所属节点的话会被挂回那个节点去，看着像没动：跟着父语言算
          l.groupId = null
        }
      } else {
        const g = groupOf(src.id)
        if (!g) return
        g.parentId = target.id
      }
    } else if (src.kind === 'language') {
      const l = langOf(src.id)
      const tg = langOf(target.id)
      if (!l || !tg) return
      l.parentId = tg.parentId
      l.groupId = tg.groupId ?? null
      reorderSibling(project.languages, src.id, target.id, zone)
    } else {
      const g = groupOf(src.id)
      const tg = groupOf(target.id)
      if (!g || !tg) return
      g.parentId = tg.parentId
      reorderSibling(project.languageGroups ?? [], src.id, target.id, zone)
    }
    selectedId = src.id
    projectState.touch()
  }
  const dragOpt = { canDrop, onDrop: applyDrop }
  const dragProps = (ref: TreeRef): ReturnType<typeof treeDragProps> => treeDragProps(ref, dragOpt)

  function counts(l: Language): string {
    return t('languages.counts', {
      lexemes: project.lexemes.filter((x) => x.languageId === l.id).length,
      morphemes: project.morphemes.filter((x) => x.languageId === l.id).length,
      sentences: project.sentences.filter((x) => x.languageId === l.id).length
    })
  }

  // ── 语系 / 语族 / 语支节点 ──
  /** 新建一个分类节点：选着节点时建在它下面，选着语言时建在那门语言所在的节点下 */
  function addGroup(level: LanguageGroupLevel): void {
    const parentId = selectedGroup
      ? selectedGroup.id
      : selected
        ? effectiveGroupId(project, selected.id)
        : null
    const g: LanguageGroup = {
      id: newId(),
      name: t(`languages.groupLevels.${level}`),
      abbr: '',
      level,
      parentId,
      protoLanguageId: null,
      notes: ''
    }
    project.languageGroups = [...groups, g]
    selectedId = g.id
    projectState.touch()
    queueMicrotask(() => document.getElementById('group-name')?.focus())
  }
  /** 删掉节点：下一级节点和挂着的语言提到它的上一级 */
  function removeGroup(g: LanguageGroup): void {
    const snapshot = $state.snapshot(project.languageGroups ?? []) as LanguageGroup[]
    const langsBefore = project.languages.map((l) => [l.id, l.groupId ?? null] as const)
    for (const c of groups) if (c.parentId === g.id) c.parentId = g.parentId
    for (const l of project.languages) if (l.groupId === g.id) l.groupId = g.parentId
    project.languageGroups = groups.filter((x) => x.id !== g.id)
    if (selectedId === g.id) selectedId = null
    projectState.touch()
    ui.toast(t('languages.groupDeleted', { name: g.name }), {
      action: {
        label: t('common.undo'),
        run: () => {
          project.languageGroups = snapshot
          const before = new Map(langsBefore)
          for (const l of project.languages) if (before.has(l.id)) l.groupId = before.get(l.id)
          selectedId = g.id
          projectState.touch()
        }
      }
    })
  }
  function setGroupParent(g: LanguageGroup, parentId: Id | null): void {
    if (wouldCreateGroupCycle(groups, g.id, parentId)) return void ui.error(t('languages.cycle'))
    g.parentId = parentId
    projectState.touch()
  }
  /** 节点的全名，下拉框里用：「语系名 › 语族名」 */
  function groupPath(g: LanguageGroup): string {
    const chain: LanguageGroup[] = []
    const byId = new Map(groups.map((x) => [x.id, x]))
    let cur: LanguageGroup | undefined = g
    const seen = new Set<Id>()
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id)
      chain.unshift(cur)
      cur = cur.parentId ? byId.get(cur.parentId) : undefined
    }
    return chain.map((x) => x.name || t('languages.untitledGroup')).join(' › ')
  }

  // ── 历时阶段 ──
  function addStage(l: Language): void {
    l.stages = [...(l.stages ?? []), { id: newId(), name: '', abbr: '', notes: '' }]
    projectState.touch()
  }
  function moveStage(l: Language, i: number, dir: -1 | 1): void {
    const list = [...(l.stages ?? [])]
    const j = i + dir
    if (j < 0 || j >= list.length) return
    ;[list[i], list[j]] = [list[j], list[i]]
    l.stages = list
    projectState.touch()
  }
  function removeStage(l: Language, id: Id): void {
    l.stages = (l.stages ?? []).filter((s) => s.id !== id)
    for (const x of project.lexemes) if (x.stageId === id) x.stageId = null
    for (const x of project.morphemes) if (x.stageId === id) x.stageId = null
    for (const rs of project.ruleSets)
      for (const [m, sid] of Object.entries(rs.stageLanguageStages ?? {}))
        if (sid === id) rs.stageLanguageStages![m] = null
    projectState.touch()
  }
  /** 合并为阶段：从选中的祖先一直到这门语言 */
  let mergeFrom = $state<Id | ''>('')
  async function mergeStages(l: Language): Promise<void> {
    if (!mergeFrom) return
    const chain = stageChain(project, mergeFrom, l.id)
    if (!chain) return
    const ok = await ui.confirm(
      t('languages.merge.confirm', {
        names: chain.map((x) => x.name).join(' → '),
        target: l.name
      }),
      t('languages.merge.confirmBody'),
      t('languages.merge.do')
    )
    if (!ok) return
    const r = mergeAsStages(project, chain)
    mergeFrom = ''
    selectedId = l.id
    projectState.currentLanguageId = l.id
    projectState.touch()
    ui.toast(
      t('languages.merge.done', {
        stages: r.stages,
        lexemes: r.lexemes,
        morphemes: r.morphemes,
        dropped: r.droppedPronunciations
      }),
      { timeout: 8000 }
    )
  }

  function add(parentId: Id | null = null, groupId: Id | null = null): void {
    const used = new Set(project.languages.map((l) => l.color))
    const color =
      LANGUAGE_COLORS.find((c) => !used.has(c)) ??
      LANGUAGE_COLORS[project.languages.length % LANGUAGE_COLORS.length]
    const l = createLanguage({ name: t('app.untitledLanguage'), parentId, color })
    if (groupId) l.groupId = groupId
    project.languages.push(l)
    if (!project.settings.defaultLanguageId) project.settings.defaultLanguageId = l.id
    if (!projectState.currentLanguageId) projectState.currentLanguageId = l.id
    selectedId = l.id
    projectState.touch()
    queueMicrotask(() => document.getElementById('lang-name')?.focus())
  }

  function remove(l: Language): void {
    const idx = project.languages.indexOf(l)
    if (idx < 0) return
    const snapshot = $state.snapshot(l) as Language
    const orphaned = project.languages.filter((x) => x.parentId === l.id).map((x) => x.id)
    project.languages.splice(idx, 1)
    for (const x of project.languages) if (orphaned.includes(x.id)) x.parentId = null
    const wasDefault = project.settings.defaultLanguageId === l.id
    if (wasDefault) project.settings.defaultLanguageId = project.languages[0]?.id ?? null
    if (projectState.currentLanguageId === l.id)
      projectState.currentLanguageId = project.settings.defaultLanguageId
    if (selectedId === l.id) selectedId = null
    projectState.touch()
    ui.toast(t('languages.deleted', { name: snapshot.name }), {
      action: {
        label: t('common.undo'),
        run: () => {
          project.languages.splice(Math.min(idx, project.languages.length), 0, snapshot)
          for (const x of project.languages) if (orphaned.includes(x.id)) x.parentId = snapshot.id
          if (wasDefault) project.settings.defaultLanguageId = snapshot.id
          selectedId = snapshot.id
          projectState.touch()
        }
      }
    })
  }

  function setParent(l: Language, parentId: Id | null): void {
    if (wouldCreateCycle(project.languages, l.id, parentId)) {
      ui.error(t('languages.cycle'))
      return
    }
    l.parentId = parentId
    projectState.touch()
  }
</script>

<div class="page">
  <div class="page-head row">
    <h1>{t('languages.title')}</h1>
    <GuideLink section="languages" />
    <span class="grow"></span>
    <div class="seg">
      <button class:active={layout === 'list'} onclick={() => (layout = 'list')}
        ><List size={14} />{t('languages.views.list')}</button
      >
      <button class:active={layout === 'tree'} onclick={() => (layout = 'tree')}
        ><ListTree size={14} />{t('languages.views.tree')}</button
      >
    </div>
    <HelpDot tip={t('languages.dragHint')} />
    <Menu label={t('languages.addGroup')} icon={Network}>
      {#each LANGUAGE_GROUP_LEVELS as lv (lv)}
        <button onclick={() => addGroup(lv)}>{t(`languages.groupLevels.${lv}`)}</button>
      {/each}
    </Menu>
    <button class="btn primary" onclick={() => add(null)}
      ><Plus size={16} />{t('languages.addLanguage')}</button
    >
  </div>

  {#if compareLangs.length}
    <div class="card row cbar">
      <GitCompare size={15} />
      {#each compareLangs as l, i (l.id)}
        {#if i}<span class="muted">↔</span>{/if}
        <button class="link data" onclick={() => pick(l.id)}
          >{l.name || t('app.untitledLanguage')}</button
        >
      {/each}
      <span class="small muted"
        >{compareLangs.length < 2 ? t('languages.compare.hint') : commonLine}</span
      >
      <span class="grow"></span>
      <button class="btn ghost sm" onclick={() => (compareIds = [])}
        ><X size={14} />{t('languages.compare.clear')}</button
      >
    </div>
  {/if}

  {#if project.languages.length === 0}
    <p class="muted">{t('languages.empty')}</p>
  {:else if layout === 'tree'}
    <LanguageGraph
      items={roots}
      {visible}
      {selectedId}
      defaultId={project.settings.defaultLanguageId}
      {compareIds}
      {hlNodes}
      {hlEdges}
      onselect={pick}
    />
  {:else}
    <div class="tree">
      {#each roots as x (x.kind === 'group' ? 'g:' + x.group.id : x.language.id)}
        <LanguageNode
          {visible}
          item={x}
          {selectedId}
          defaultId={project.settings.defaultLanguageId}
          {compareIds}
          {hlNodes}
          {dragProps}
          onselect={pick}
          onaddchild={(id, kind) => (kind === 'group' ? add(null, id) : add(id))}
          oncompare={toggleCompare}
        />
      {/each}
      {#if draggingRef()}
        <div class="rootdrop small muted" {...treeRootDropProps(dragOpt)}>
          {t('languages.dropRoot')}
        </div>
      {/if}
    </div>
  {/if}
  {#if compareLangs.length === 2}
    <GroupStats
      {project}
      title={t('languages.compare.title', {
        a: compareLangs[0].name || t('app.untitledLanguage'),
        b: compareLangs[1].name || t('app.untitledLanguage')
      })}
      note={commonLine}
      languages={compareLangs}
      onpicklanguage={(id) => pick(id)}
      onpicklexeme={(id) => {
        const l = project.lexemes.find((x) => x.id === id)
        ui.jump('lexicon', 'lexeme', id, l?.languageId)
      }}
    />
  {:else if selectedGroup}
    <GroupStats
      {project}
      title={t('languages.stats.title', {
        name: selectedGroup.name || t(`languages.groupLevels.${selectedGroup.level}`)
      })}
      languages={groupLanguages(project, selectedGroup.id)}
      onpicklanguage={(id) => pick(id)}
      onpicklexeme={(id) => {
        const l = project.lexemes.find((x) => x.id === id)
        ui.jump('lexicon', 'lexeme', id, l?.languageId)
      }}
    />
  {/if}
</div>

{#if selectedGroup}
  {@const g = selectedGroup}
  <Portal>
    <div class="field">
      <label for="group-name">{t('common.name')}</label>
      <input
        id="group-name"
        class="input"
        bind:value={g.name}
        oninput={() => projectState.touch()}
      />
    </div>
    <div class="row two">
      <div class="field grow">
        <label for="group-abbr">{t('common.abbr')}</label>
        <input
          id="group-abbr"
          class="input"
          bind:value={g.abbr}
          oninput={() => projectState.touch()}
        />
      </div>
      <div class="field grow">
        <label for="group-level">{t('languages.groupLevel')}</label>
        <select
          id="group-level"
          class="select"
          bind:value={g.level}
          onchange={() => projectState.touch()}
        >
          {#each LANGUAGE_GROUP_LEVELS as lv (lv)}<option value={lv}
              >{t(`languages.groupLevels.${lv}`)}</option
            >{/each}
        </select>
      </div>
    </div>
    <div class="field">
      <label for="group-parent">{t('languages.groupParent')}</label>
      <select
        id="group-parent"
        class="select"
        value={g.parentId ?? ''}
        onchange={(e) => setGroupParent(g, (e.currentTarget as HTMLSelectElement).value || null)}
      >
        <option value="">{t('languages.noGroup')}</option>
        {#each groups.filter((x) => !groupAncestors(groups, x.id).has(g.id)) as x (x.id)}
          <option value={x.id}>{groupPath(x)}</option>
        {/each}
      </select>
    </div>
    <div class="field">
      <label for="group-proto"
        >{t('languages.protoLanguage')} <HelpDot tip={t('languages.protoHint')} /></label
      >
      <select
        id="group-proto"
        class="select"
        value={g.protoLanguageId ?? ''}
        onchange={(e) => {
          g.protoLanguageId = (e.currentTarget as HTMLSelectElement).value || null
          projectState.touch()
        }}
      >
        <option value="">{t('common.none')}</option>
        {#each project.languages as l (l.id)}<option value={l.id}>{l.name}</option>{/each}
      </select>
    </div>
    <div class="field">
      <label for="group-notes">{t('common.notes')}</label>
      <textarea
        id="group-notes"
        class="textarea"
        bind:value={g.notes}
        oninput={() => projectState.touch()}
      ></textarea>
    </div>
    <p class="small muted">
      {t('languages.groupCounts', {
        groups: childGroups(project, g.id).length,
        languages: groupLanguages(project, g.id).length
      })}
    </p>
    <div class="actions">
      <button class="btn sm" onclick={() => add(null, g.id)}
        ><Plus size={14} />{t('languages.addLanguageHere')}</button
      >
      <button class="btn sm danger" onclick={() => removeGroup(g)}
        ><Trash2 size={14} />{t('common.delete')}</button
      >
    </div>
  </Portal>
{/if}

{#if selected}
  {@const lang = selected}
  <Portal>
    <div class="field">
      <label for="lang-name">{t('common.name')}</label>
      <input
        id="lang-name"
        class="input data"
        bind:value={lang.name}
        oninput={() => projectState.touch()}
      />
    </div>
    <div class="field">
      <label for="lang-abbr">{t('common.abbr')}</label>
      <input
        id="lang-abbr"
        class="input"
        bind:value={lang.abbr}
        oninput={() => projectState.touch()}
      />
    </div>
    <div class="field">
      <label for="lang-parent">{t('languages.parent')}</label>
      <select
        id="lang-parent"
        class="select"
        value={lang.parentId ?? ''}
        onchange={(e) => setParent(lang, (e.currentTarget as HTMLSelectElement).value || null)}
      >
        <option value="">{t('languages.noParent')}</option>
        {#each project.languages.filter((x) => x.id !== lang.id) as x (x.id)}
          <option value={x.id}>{x.name}</option>
        {/each}
      </select>
    </div>
    <div class="field">
      <label for="lang-group">{t('languages.group')}</label>
      <select
        id="lang-group"
        class="select"
        value={lang.groupId ?? ''}
        onchange={(e) => {
          lang.groupId = (e.currentTarget as HTMLSelectElement).value || null
          projectState.touch()
        }}
      >
        <option value=""
          >{lang.parentId && effectiveGroupId(project, lang.id)
            ? t('languages.groupFromParent')
            : t('languages.noGroup')}</option
        >
        {#each groups as x (x.id)}<option value={x.id}>{groupPath(x)}</option>{/each}
      </select>
    </div>
    <div class="field">
      <div class="row">
        <span class="small muted">{t('languages.stages')}</span><HelpDot
          tip={t('languages.stagesHint')}
        /><span class="grow"></span><button class="btn ghost sm" onclick={() => addStage(lang)}
          ><Plus size={14} />{t('languages.addStage')}</button
        >
      </div>
      {#each lang.stages ?? [] as st, i (st.id)}
        <div class="row dia">
          <input
            class="input"
            placeholder={t('languages.stageName')}
            bind:value={st.name}
            oninput={() => projectState.touch()}
          />
          <input
            class="input abbr"
            placeholder={t('common.abbr')}
            bind:value={st.abbr}
            oninput={() => projectState.touch()}
          />
          <button
            class="btn ghost icon sm"
            title={t('soundChanges.moveUp')}
            disabled={i === 0}
            onclick={() => moveStage(lang, i, -1)}><ChevronUp size={14} /></button
          >
          <button
            class="btn ghost icon sm"
            title={t('soundChanges.moveDown')}
            disabled={i === (lang.stages?.length ?? 0) - 1}
            onclick={() => moveStage(lang, i, 1)}><ChevronDown size={14} /></button
          >
          <button class="btn ghost icon sm" onclick={() => removeStage(lang, st.id)}
            ><X size={14} /></button
          >
        </div>
      {/each}
      {#if lang.parentId}
        {@const ancestors = languageLineage(project.languages, lang.id).slice(0, -1).reverse()}
        <div class="row merge">
          <select class="select sm" bind:value={mergeFrom} title={t('languages.merge.hint')}>
            <option value="">{t('languages.merge.pick')}</option>
            {#each ancestors as a (a.id)}<option value={a.id}>{a.name}</option>{/each}
          </select>
          <button class="btn sm" disabled={!mergeFrom} onclick={() => mergeStages(lang)}
            ><GitMerge size={14} />{t('languages.merge.button')}</button
          >
        </div>
      {/if}
    </div>
    <div class="field">
      <span class="small muted">{t('common.color')}</span>
      <div class="swatches">
        {#each LANGUAGE_COLORS as c (c)}
          <button
            class="swatch"
            class:active={lang.color === c}
            style:background={c}
            aria-label={c}
            onclick={() => {
              lang.color = c
              projectState.touch()
            }}
          ></button>
        {/each}
        <input
          type="color"
          class="swatch custom"
          bind:value={lang.color}
          oninput={() => projectState.touch()}
        />
      </div>
    </div>
    <div class="field">
      <label for="lang-alphabet"
        >{t('languages.alphabet')} <HelpDot tip={t('languages.alphabetHint')} /></label
      >
      <input
        id="lang-alphabet"
        class="input data"
        value={lang.alphabet.join(' ')}
        onchange={(e) => {
          lang.alphabet = (e.currentTarget as HTMLInputElement).value.split(/\s+/).filter(Boolean)
          projectState.touch()
        }}
      />
    </div>
    <div class="field">
      <label for="lang-ignore"
        >{t('languages.matchIgnore')} <HelpDot tip={t('languages.matchIgnoreHint')} /></label
      >
      <input
        id="lang-ignore"
        class="input data"
        placeholder=". 1 2 3"
        bind:value={lang.matchIgnore}
        oninput={() => projectState.touch()}
      />
    </div>
    <div class="field">
      <div class="row">
        <span class="small muted">{t('languages.dialects')}</span><HelpDot key="dialects" /><span
          class="grow"
        ></span><button
          class="btn ghost sm"
          onclick={() => {
            lang.dialects.push({ id: newId(), name: '', abbr: '' })
            projectState.touch()
          }}><Plus size={14} />{t('languages.addDialect')}</button
        >
      </div>
      {#each lang.dialects as d, i (d.id)}
        <div class="row dia">
          <input
            class="input"
            placeholder={t('common.name')}
            bind:value={d.name}
            oninput={() => projectState.touch()}
          />
          <input
            class="input abbr"
            placeholder={t('common.abbr')}
            bind:value={d.abbr}
            oninput={() => projectState.touch()}
          />
          <button
            class="btn ghost icon sm"
            onclick={() => {
              lang.dialects.splice(i, 1)
              projectState.touch()
            }}><X size={14} /></button
          >
        </div>
      {/each}
    </div>
    <div class="field">
      <label for="lang-notes">{t('common.notes')}</label>
      <textarea
        id="lang-notes"
        class="textarea"
        bind:value={lang.notes}
        oninput={() => projectState.touch()}
      ></textarea>
    </div>

    {#if languageLineage(project.languages, lang.id).length > 1}
      <div class="field">
        <span class="small muted">{t('languages.lineage')}</span>
        <div class="lineage">
          {#each languageLineage(project.languages, lang.id) as a, i (a.id)}
            {#if i > 0}<span class="muted">›</span>{/if}
            <button class="link" onclick={() => pick(a.id)}>{a.name}</button>
          {/each}
        </div>
      </div>
    {/if}

    <p class="small muted">{counts(lang)}</p>

    <div class="actions">
      {#if project.settings.defaultLanguageId !== lang.id}
        <button
          class="btn sm"
          onclick={() => {
            project.settings.defaultLanguageId = lang.id
            projectState.touch()
          }}><Star size={14} />{t('languages.setDefault')}</button
        >
      {/if}
      <button class="btn sm" onclick={() => add(lang.id)}
        ><Plus size={14} />{t('languages.addChild')}</button
      >
      <button class="btn sm danger" onclick={() => remove(lang)}
        ><Trash2 size={14} />{t('common.delete')}</button
      >
    </div>
  </Portal>
{/if}

<style>
  .page {
    padding: 24px 28px;
    max-width: var(--page-max, 960px);
  }
  .page-head {
    margin-bottom: 16px;
  }
  .tree {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  /* 对比条：挑了语言才出来 */
  .cbar {
    gap: 8px;
    padding: 8px 12px;
    margin-bottom: 12px;
    flex-wrap: wrap;
  }
  /* 拖东西的时候才露出来的最外层落点 */
  .rootdrop {
    border: 1.5px dashed var(--border-strong);
    border-radius: var(--radius-sm);
    padding: 10px 14px;
    text-align: center;
  }
  .rootdrop[data-drop] {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .rootdrop[data-drop-bad] {
    border-color: var(--danger);
  }
  .swatches {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    align-items: center;
  }
  .swatch {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
    padding: 0;
  }
  .swatch.active {
    border-color: var(--text);
  }
  .swatch.custom {
    width: 26px;
    height: 26px;
    border: 1px solid var(--border);
    background: none;
  }
  .lineage {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
  }
  .link {
    border: 0;
    background: none;
    padding: 0;
    color: var(--accent-text);
    cursor: pointer;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 12px;
  }
  .dia {
    gap: 6px;
    margin-bottom: 4px;
  }
  .dia .abbr {
    width: 90px;
  }
  .two {
    gap: 10px;
    align-items: flex-start;
  }
  .merge {
    gap: 6px;
    margin-top: 4px;
  }
  .merge .select {
    flex: 1;
    min-width: 0;
  }
</style>
