<script lang="ts">
  /**
   * 带分组的书签页签（音变的规则集、构形）：像浏览器的标签页分组，
   * 组名是一枚彩色小签，点一下收起 / 展开组里的页签；右键页签移到别的组，右键组名改名、换色、解散。
   * 分组存在项目设置里；用户没动过时按默认分法显示（音变：共时 / 历时，构形：按词类），一改就把整套写进项目。
   */
  import type { Id, TabGroupSet } from '$lib/core/model'
  import { newId } from '$lib/core/factory'
  import { t, pickText } from '$lib/i18n/index.svelte'
  import { projectState } from '$lib/state/project.svelte'
  import { ui } from '$lib/state/ui.svelte'
  import {
    TAB_GROUP_COLORS,
    defaultParadigmGroups,
    defaultRuleSetGroups,
    groupTabs,
    type TabGroupKind
  } from '$lib/core/tabGroups'
  import { sortable } from './sortable.svelte'
  import { sectionCollapsed, toggleSection } from './section.svelte'
  import { Pencil, Check } from '@lucide/svelte'

  let {
    kind,
    items,
    activeId,
    onselect,
    onrename,
    onmove
  }: {
    kind: TabGroupKind
    items: { id: Id; label: string }[]
    activeId: Id | null
    onselect: (id: Id) => void
    onrename: (id: Id) => void
    /** 拖着换顺序：挪好了返回 true */
    onmove: (from: number, to: number) => boolean
  } = $props()

  const project = $derived(projectState.project!)
  const glossLangs = $derived(project.settings.glossLanguages)
  const set = $derived.by((): TabGroupSet => {
    const stored = project.settings.tabGroups?.[kind]
    if (stored) return stored
    return kind === 'ruleSets'
      ? defaultRuleSetGroups(project, {
          synchronic: t('tabGroups.synchronic'),
          diachronic: t('tabGroups.diachronic')
        })
      : defaultParadigmGroups(project, (name, abbr) => pickText(name, glossLangs) || abbr)
  })
  const rows = $derived(groupTabs(items, set))

  const foldId = (gid: Id): string => `tabs.${kind}:${project.meta.id}:${gid}`

  /** 要改分组时先把正在显示的这套（可能是默认分法）写进项目，再改 */
  function edit(fn: (s: TabGroupSet) => void): void {
    if (projectState.readOnly) return void ui.toast(t('readonly.blocked'))
    const tg = (project.settings.tabGroups ??= {})
    const cur = (tg[kind] ??= JSON.parse(JSON.stringify(set)) as TabGroupSet)
    fn(cur)
    projectState.touch()
  }

  // ── 右键菜单 ──
  let menu = $state<{ x: number; y: number; tab?: Id; group?: Id } | null>(null)
  let menuEl = $state<HTMLDivElement | null>(null)
  function openMenu(e: MouseEvent, target: { tab?: Id; group?: Id }): void {
    e.preventDefault()
    menu = { x: e.clientX, y: e.clientY, ...target }
  }
  $effect(() => {
    if (!menu) return
    const onDown = (e: PointerEvent): void => {
      if (menuEl && !menuEl.contains(e.target as Node)) menu = null
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') menu = null
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  })
  /** 菜单别伸出窗口 */
  const menuPos = $derived.by(() => {
    if (!menu) return ''
    const x = Math.min(menu.x, window.innerWidth - 220)
    const y = Math.min(menu.y, window.innerHeight - 280)
    return `left:${Math.max(4, x)}px;top:${Math.max(4, y)}px`
  })

  function moveTo(tab: Id, gid: Id | null): void {
    menu = null
    edit((s) => {
      if (gid) s.members[tab] = gid
      else delete s.members[tab]
    })
  }
  async function newGroup(tab?: Id): Promise<void> {
    menu = null
    const name = (await ui.prompt(t('tabGroups.name'), ''))?.trim()
    if (!name) return
    edit((s) => {
      const used = new Set(s.groups.map((g) => g.color))
      const color =
        TAB_GROUP_COLORS.find((c) => !used.has(c)) ??
        TAB_GROUP_COLORS[s.groups.length % TAB_GROUP_COLORS.length]
      const id = newId()
      s.groups.push({ id, name, color })
      if (tab) s.members[tab] = id
    })
  }
  async function renameGroup(gid: Id): Promise<void> {
    menu = null
    const g = set.groups.find((x) => x.id === gid)
    const name = (await ui.prompt(t('tabGroups.name'), g?.name ?? ''))?.trim()
    if (!name) return
    edit((s) => {
      const x = s.groups.find((y) => y.id === gid)
      if (x) x.name = name
    })
  }
  function recolor(gid: Id, color: string): void {
    edit((s) => {
      const x = s.groups.find((y) => y.id === gid)
      if (x) x.color = color
    })
  }
  /** 解散：组没了，组里的页签回到不分组 */
  function ungroup(gid: Id): void {
    menu = null
    edit((s) => {
      s.groups = s.groups.filter((g) => g.id !== gid)
      for (const [k, v] of Object.entries(s.members)) if (v === gid) delete s.members[k]
    })
  }
  function shiftGroup(gid: Id, dir: -1 | 1): void {
    edit((s) => {
      const i = s.groups.findIndex((g) => g.id === gid)
      const j = i + dir
      if (i < 0 || j < 0 || j >= s.groups.length) return
      ;[s.groups[i], s.groups[j]] = [s.groups[j], s.groups[i]]
    })
  }
  /** 拖到别的组的页签上：换顺序，顺便进那个组 */
  function drop(from: number, to: number): void {
    const tab = items[from]?.id
    const target = items[to]?.id
    if (!tab || !target) return
    const want = set.members[target] ?? null
    const had = set.members[tab] ?? null
    if (!onmove(from, to)) return
    if (want !== had) moveTo(tab, want)
  }
</script>

<div class="booktabs grow">
  {#each rows as row (row.group?.id ?? '')}
    {@const g = row.group}
    {@const folded = !!g && sectionCollapsed(foldId(g.id))}
    {#if g}
      <button
        class="tg-chip tg-{g.color}"
        class:folded
        title={folded ? t('tabGroups.expand') : t('tabGroups.collapse')}
        aria-expanded={!folded}
        onclick={() => toggleSection(foldId(g.id))}
        oncontextmenu={(e) => openMenu(e, { group: g.id })}
        >{g.name}{#if folded}<span class="tg-n">{row.items.length}</span>{/if}</button
      >
    {/if}
    <!-- 收起的组里只留正在看的那个页签，免得看不出现在开着哪个 -->
    {#each folded ? row.items.filter((x) => x.item.id === activeId) : row.items as { item, index } (item.id)}
      <span
        class="tabwrap tg-{g?.color ?? 'none'}"
        class:grouped={!!g}
        {...sortable(`tabs-${kind}`, index, drop)}
        oncontextmenu={(e) => openMenu(e, { tab: item.id })}
      >
        <button class="tab" class:active={activeId === item.id} onclick={() => onselect(item.id)}
          >{item.label}</button
        >
        <button class="pen" title={t('common.rename')} onclick={() => onrename(item.id)}
          ><Pencil size={11} /></button
        >
      </span>
    {/each}
  {/each}
</div>

{#if menu}
  <div class="tg-menu card" style={menuPos} bind:this={menuEl} role="menu" tabindex="-1">
    {#if menu.tab}
      {@const tab = menu.tab}
      {@const cur = set.members[tab] ?? null}
      <div class="small muted tg-title">{t('tabGroups.moveTo')}</div>
      {#each set.groups as g (g.id)}
        <button onclick={() => moveTo(tab, g.id)}
          ><span class="tg-dot tg-{g.color}"></span>{g.name}{#if cur === g.id}<Check
              size={13}
            />{/if}</button
        >
      {/each}
      <button onclick={() => newGroup(tab)}>{t('tabGroups.newGroup')}</button>
      {#if cur}<button onclick={() => moveTo(tab, null)}>{t('tabGroups.removeFromGroup')}</button
        >{/if}
    {:else if menu.group}
      {@const gid = menu.group}
      {@const g = set.groups.find((x) => x.id === gid)}
      <button onclick={() => renameGroup(gid)}>{t('common.rename')}</button>
      <div class="tg-colors">
        {#each TAB_GROUP_COLORS as c (c)}
          <button
            class="tg-swatch tg-{c}"
            class:on={g?.color === c}
            title={t(`tabGroups.colors.${c}`)}
            aria-label={t(`tabGroups.colors.${c}`)}
            onclick={() => recolor(gid, c)}
          ></button>
        {/each}
      </div>
      <button onclick={() => shiftGroup(gid, -1)}>{t('tabGroups.moveLeft')}</button>
      <button onclick={() => shiftGroup(gid, 1)}>{t('tabGroups.moveRight')}</button>
      <button onclick={() => newGroup()}>{t('tabGroups.newGroup')}</button>
      <button class="danger" onclick={() => ungroup(gid)}>{t('tabGroups.ungroup')}</button>
    {/if}
  </div>
{/if}

<style>
  /* 分组的颜色：同一个色相，浅色主题和深色主题都跟正文色混一下，不刺眼 */
  .tg-blue {
    --tg: #3b82f6;
  }
  .tg-green {
    --tg: #22a55b;
  }
  .tg-purple {
    --tg: #8b5cf6;
  }
  .tg-orange {
    --tg: #f08a24;
  }
  .tg-red {
    --tg: #e5484d;
  }
  .tg-teal {
    --tg: #14a3a0;
  }
  .tg-pink {
    --tg: #e0529c;
  }
  .tg-yellow {
    --tg: #d9a300;
  }
  .tg-grey {
    --tg: #8a8f98;
  }
  .tg-chip {
    flex: none;
    align-self: center;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    margin: 0 2px 5px 6px;
    padding: 2px 9px;
    border: 0;
    border-radius: 999px;
    background: color-mix(in srgb, var(--tg) 20%, var(--bg-elev));
    color: color-mix(in srgb, var(--tg) 70%, var(--text));
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
  }
  .tg-chip:first-child {
    margin-left: 0;
  }
  .tg-chip:hover {
    background: color-mix(in srgb, var(--tg) 32%, var(--bg-elev));
  }
  .tg-chip.folded {
    background: var(--tg);
    color: #fff;
  }
  .tg-n {
    font-size: 11px;
    opacity: 0.85;
  }
  /* 组里的页签：底下一道组的颜色 */
  .tabwrap.grouped :global(.tab) {
    box-shadow: inset 0 -2px 0 color-mix(in srgb, var(--tg) 75%, transparent);
  }
  .tg-menu {
    position: fixed;
    z-index: 60;
    min-width: 180px;
    padding: 4px;
    display: flex;
    flex-direction: column;
  }
  .tg-menu > button {
    display: flex;
    align-items: center;
    gap: 7px;
    border: 0;
    background: none;
    padding: 6px 10px;
    border-radius: 6px;
    text-align: left;
    font: inherit;
    color: var(--text);
    cursor: pointer;
  }
  .tg-menu > button:hover {
    background: var(--bg-hover);
  }
  .tg-menu > button.danger {
    color: var(--danger);
  }
  .tg-title {
    padding: 4px 10px 2px;
  }
  .tg-dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--tg);
  }
  .tg-colors {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 6px 10px;
  }
  .tg-swatch {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    border: 2px solid transparent;
    background: var(--tg);
    padding: 0;
    cursor: pointer;
  }
  .tg-swatch.on {
    border-color: var(--text);
  }
</style>
