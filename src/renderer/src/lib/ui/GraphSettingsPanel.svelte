<script lang="ts">
  import type { Project } from '$lib/core/model'
  import { newId } from '$lib/core/factory'
  import { posName } from '$lib/core/pos'
  import { t } from '$lib/i18n/index.svelte'
  import HelpDot from '$lib/ui/HelpDot.svelte'
  import {
    ChevronDown,
    ChevronRight,
    ArrowUp,
    ArrowDown,
    Plus,
    Trash2,
    RotateCcw,
    SlidersHorizontal
  } from '@lucide/svelte'
  import {
    defaultGraphSettings,
    normalizeGraphSettings,
    GRAPH_RANGES,
    GRAPH_GROUP_LIMIT,
    GRAPH_COLOR_FIELDS,
    GRAPH_NODE_KINDS,
    type GraphColorGroup,
    type GraphSettings,
    type GraphColorField,
    type GraphNodeKind
  } from './graphSettings'

  let {
    project,
    settings,
    onchange,
    collapsed = false,
    oncollapsed
  }: {
    project: Project
    settings: GraphSettings
    onchange: (settings: GraphSettings) => void
    collapsed?: boolean
    oncollapsed: (collapsed: boolean) => void
  } = $props()
  const bodyId = `graph-settings-${newId()}`
  const tags = $derived(
    [
      ...new Set([
        ...project.lexemes.flatMap((word) => word.tags),
        ...project.morphemes.flatMap((morpheme) => morpheme.tags)
      ])
    ].sort((a, b) => a.localeCompare(b))
  )
  let colorProbe = $state<HTMLElement | null>(null)
  let themeTextColor = $state('#8a8a84')
  const fallbackColors = $derived<Record<GraphNodeKind, string>>({
    lexeme: themeTextColor,
    morpheme: '#9973ba',
    external: '#aa8154'
  })
  $effect(() => {
    if (!colorProbe) return
    const probe = colorProbe
    const refresh = (): void => {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 1
      const context = canvas.getContext('2d')
      if (!context) return
      context.fillStyle = getComputedStyle(probe).color
      context.fillRect(0, 0, 1, 1)
      themeTextColor =
        '#' +
        [...context.getImageData(0, 0, 1, 1).data]
          .slice(0, 3)
          .map((n) => n.toString(16).padStart(2, '0'))
          .join('')
    }
    refresh()
    const observer = new MutationObserver(refresh)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style', 'data-theme']
    })
    return () => observer.disconnect()
  })
  const groupPalette = ['#e76f51', '#2a9d8f', '#8b5cf6', '#e9c46a', '#3b82f6', '#ec4899']
  function emit(value: GraphSettings): void {
    onchange(normalizeGraphSettings(value))
  }
  function appearance<K extends keyof GraphSettings['appearance']>(
    key: K,
    value: GraphSettings['appearance'][K]
  ): void {
    emit({ ...settings, appearance: { ...settings.appearance, [key]: value } })
  }
  function force(key: keyof GraphSettings['forces'], value: number): void {
    emit({ ...settings, forces: { ...settings.forces, [key]: value } })
  }
  function group(id: string, patch: Partial<GraphColorGroup>): void {
    emit({
      ...settings,
      groups: settings.groups.map((group) => (group.id === id ? { ...group, ...patch } : group))
    })
  }
  function addGroup(): void {
    if (settings.groups.length >= GRAPH_GROUP_LIMIT) return
    emit({
      ...settings,
      groups: [
        ...settings.groups,
        {
          id: newId(),
          name: t('graph.newGroup', { n: settings.groups.length + 1 }),
          enabled: true,
          color: groupPalette[settings.groups.length % groupPalette.length],
          field: 'tag',
          value: ''
        }
      ]
    })
  }
  function moveGroup(index: number, step: number): void {
    const groups = [...settings.groups],
      target = index + step
    if (!groups[target]) return
    ;[groups[index], groups[target]] = [groups[target], groups[index]]
    emit({ ...settings, groups })
  }
  function nodeColor(kind: GraphNodeKind, value?: string): void {
    const nodeColors = { ...settings.nodeColors }
    if (value) nodeColors[kind] = value
    else delete nodeColors[kind]
    emit({ ...settings, nodeColors })
  }
  function choices(field: GraphColorField): { value: string; label: string }[] {
    if (field === 'pos')
      return project.posList.map((pos) => ({
        value: pos.id,
        label: posName(pos, project.settings.glossLanguages) || pos.abbr
      }))
    if (field === 'language')
      return project.languages.map((language) => ({
        value: language.id,
        label: language.name || language.abbr
      }))
    if (field === 'tag') return tags.map((tag) => ({ value: tag, label: tag }))
    return []
  }
  /** 只拦截图谱手势；按钮click与表单input仍交给Svelte正常处理。 */
  function containGraphEvents(node: HTMLElement): { destroy(): void } {
    const events = ['pointerdown', 'wheel', 'keydown']
    const stop = (event: Event): void => event.stopPropagation()
    for (const event of events) node.addEventListener(event, stop)
    return {
      destroy() {
        for (const event of events) node.removeEventListener(event, stop)
      }
    }
  }
</script>

{#snippet slider(
  key: string,
  label: string,
  value: number,
  range: { min: number; max: number; step: number },
  change: (n: number) => void
)}
  <label class="slider-field">
    <span>{label}</span>
    <span class="slider-controls">
      <input
        type="range"
        min={range.min}
        max={range.max}
        step={range.step}
        {value}
        data-graph-setting={key}
        aria-label={label}
        oninput={(e) => change(Number(e.currentTarget.value))}
      />
      <input
        type="number"
        class="input number"
        min={range.min}
        max={range.max}
        step={range.step}
        {value}
        data-graph-number={key}
        aria-label={label}
        onchange={(e) => change(e.currentTarget.valueAsNumber)}
      />
    </span>
  </label>
{/snippet}

<section
  class="graph-settings"
  class:collapsed
  data-graph-settings
  aria-label={t('graph.settings')}
  use:containGraphEvents
>
  <span bind:this={colorProbe} class="color-probe" style:color="var(--text-3)" aria-hidden="true"
  ></span>
  <div class="panel-head">
    <SlidersHorizontal size={15} /><strong class="grow">{t('graph.settings')}</strong>
    <HelpDot tip={t('graph.localHint')} />
    <button
      class="btn ghost icon sm"
      data-graph-panel-toggle
      aria-expanded={!collapsed}
      aria-controls={bodyId}
      title={t(collapsed ? 'graph.expandSettings' : 'graph.collapseSettings')}
      onclick={() => oncollapsed(!collapsed)}
    >
      {#if collapsed}<ChevronRight size={15} />{:else}<ChevronDown size={15} />{/if}
    </button>
  </div>
  {#if !collapsed}
    <div id={bodyId} class="panel-scroll">
      <fieldset>
        <legend>{t('graph.scope')}</legend>
        {@render slider('depth', t('graph.depth'), settings.depth, GRAPH_RANGES.depth, (value) =>
          emit({ ...settings, depth: value })
        )}
        <label class="check"
          ><input
            type="checkbox"
            data-graph-setting="crossLinks"
            checked={settings.crossLinks}
            onchange={(e) => emit({ ...settings, crossLinks: e.currentTarget.checked })}
          />{t('graph.crossLinks')}</label
        >
      </fieldset>
      <details>
        <summary>{t('graph.appearance')}</summary>
        <fieldset>
          <label class="field-label"
            >{t('graph.shape')}<select
              class="select"
              data-graph-setting="shape"
              value={settings.appearance.shape}
              onchange={(e) =>
                appearance('shape', e.currentTarget.value === 'cards' ? 'cards' : 'dots')}
              ><option value="dots">{t('graph.shapes.dots')}</option><option value="cards"
                >{t('graph.shapes.cards')}</option
              ></select
            ></label
          >
          {@render slider(
            'nodeScale',
            t('graph.nodeScale'),
            settings.appearance.nodeScale,
            GRAPH_RANGES.nodeScale,
            (value) => appearance('nodeScale', value)
          )}
          {#if settings.appearance.shape === 'cards'}
            {@render slider(
              'frameScale',
              t('graph.frameScale'),
              settings.appearance.frameScale,
              GRAPH_RANGES.frameScale,
              (value) => appearance('frameScale', value)
            )}
          {/if}
          {@render slider(
            'labelScale',
            t('graph.labelScale'),
            settings.appearance.labelScale,
            GRAPH_RANGES.labelScale,
            (value) => appearance('labelScale', value)
          )}
          <label class="check"
            ><input
              type="checkbox"
              data-graph-setting="showLabels"
              checked={settings.appearance.showLabels}
              onchange={(e) => appearance('showLabels', e.currentTarget.checked)}
            />{t('graph.showLabels')}</label
          >
          <label class="check"
            ><input
              type="checkbox"
              data-graph-setting="showEdgeLabels"
              checked={settings.appearance.showEdgeLabels}
              onchange={(e) => appearance('showEdgeLabels', e.currentTarget.checked)}
            />{t('graph.showEdgeLabels')}</label
          >
          {@render slider(
            'edgeWidth',
            t('graph.edgeWidth'),
            settings.appearance.edgeWidth,
            GRAPH_RANGES.edgeWidth,
            (value) => appearance('edgeWidth', value)
          )}
        </fieldset>
      </details>
      <details open>
        <summary>{t('graph.forces')}<HelpDot tip={t('graph.forcesHint')} /></summary>
        <fieldset>
          {@render slider(
            'center',
            t('graph.centerForce'),
            settings.forces.center,
            GRAPH_RANGES.center,
            (value) => force('center', value)
          )}
          {@render slider(
            'repel',
            t('graph.repelForce'),
            settings.forces.repel,
            GRAPH_RANGES.repel,
            (value) => force('repel', value)
          )}
          {@render slider(
            'link',
            t('graph.linkForce'),
            settings.forces.link,
            GRAPH_RANGES.link,
            (value) => force('link', value)
          )}
          {@render slider(
            'length',
            t('graph.linkLength'),
            settings.forces.length,
            GRAPH_RANGES.length,
            (value) => force('length', value)
          )}
        </fieldset>
      </details>
      <details>
        <summary>{t('graph.colorGroups')}<HelpDot tip={t('graph.groupsHint')} /></summary>
        <fieldset>
          {#each settings.groups as row, index (row.id)}
            <div class="group-box" data-graph-group={row.id}>
              <div class="group-head">
                <input
                  class="input grow"
                  value={row.name}
                  maxlength="120"
                  aria-label={t('graph.groupName')}
                  placeholder={t('graph.groupName')}
                  onchange={(e) => group(row.id, { name: e.currentTarget.value })}
                />
                <input
                  class="color"
                  type="color"
                  value={row.color}
                  aria-label={t('graph.color')}
                  onchange={(e) => group(row.id, { color: e.currentTarget.value })}
                />
              </div>
              <div class="group-match">
                <select
                  class="select"
                  data-graph-group-field
                  aria-label={t('graph.matchField')}
                  value={row.field}
                  onchange={(e) =>
                    group(row.id, { field: e.currentTarget.value as GraphColorField, value: '' })}
                >
                  {#each GRAPH_COLOR_FIELDS as field (field)}<option value={field}
                      >{t(`graph.fields.${field}`)}</option
                    >{/each}
                </select>
                {#if row.field !== 'all'}
                  {@const options = choices(row.field)}
                  <select
                    class="select"
                    data-graph-group-value
                    aria-label={t('graph.matchValue')}
                    value={row.value}
                    onchange={(e) => group(row.id, { value: e.currentTarget.value })}
                  >
                    <option value="">{t('graph.chooseValue')}</option>
                    {#if row.value && !options.some((option) => option.value === row.value)}<option
                        value={row.value}>{t('graph.missingValue')}</option
                      >{/if}
                    {#each options as option (option.value)}<option value={option.value}
                        >{option.label}</option
                      >{/each}
                  </select>
                {/if}
              </div>
              <div class="group-actions">
                <label class="check grow"
                  ><input
                    type="checkbox"
                    checked={row.enabled}
                    aria-label={t('graph.enabled')}
                    onchange={(e) => group(row.id, { enabled: e.currentTarget.checked })}
                  />{t('graph.enabled')}</label
                >
                <button
                  class="btn ghost icon sm"
                  disabled={index === 0}
                  title={t('graph.moveUp')}
                  aria-label={t('graph.moveUp')}
                  onclick={() => moveGroup(index, -1)}><ArrowUp size={14} /></button
                >
                <button
                  class="btn ghost icon sm"
                  disabled={index === settings.groups.length - 1}
                  title={t('graph.moveDown')}
                  aria-label={t('graph.moveDown')}
                  onclick={() => moveGroup(index, 1)}><ArrowDown size={14} /></button
                >
                <button
                  class="btn ghost icon sm danger"
                  title={t('graph.deleteGroup')}
                  aria-label={t('graph.deleteGroup')}
                  onclick={() =>
                    emit({
                      ...settings,
                      groups: settings.groups.filter((group) => group.id !== row.id)
                    })}><Trash2 size={14} /></button
                >
              </div>
            </div>
          {/each}
          <button
            class="btn sm"
            data-graph-add-group
            disabled={settings.groups.length >= GRAPH_GROUP_LIMIT}
            onclick={addGroup}><Plus size={14} />{t('graph.addGroup')}</button
          >
        </fieldset>
      </details>
      <details>
        <summary>{t('graph.defaultColors')}</summary>
        <fieldset>
          {#each GRAPH_NODE_KINDS as kind (kind)}
            <div class="default-color">
              <label class="grow"
                >{t(`graph.nodeKinds.${kind}`)}<input
                  class="color"
                  type="color"
                  data-graph-node-color={kind}
                  value={settings.nodeColors[kind] ?? fallbackColors[kind]}
                  onchange={(e) => nodeColor(kind, e.currentTarget.value)}
                /></label
              >
              <button
                class="btn ghost icon sm"
                disabled={!settings.nodeColors[kind]}
                title={t('graph.useThemeColor')}
                aria-label={t('graph.useThemeColor')}
                onclick={() => nodeColor(kind)}><RotateCcw size={13} /></button
              >
            </div>
          {/each}
        </fieldset>
      </details>
      <button
        class="btn sm reset"
        data-graph-reset-settings
        title={t('graph.resetHint')}
        onclick={() => emit(defaultGraphSettings())}
        ><RotateCcw size={14} />{t('graph.resetSettings')}</button
      >
    </div>
  {/if}
</section>

<style>
  .graph-settings {
    position: absolute;
    inset-block-start: 8px;
    inset-inline-end: 8px;
    z-index: 5;
    width: 300px;
    max-width: calc(100% - 16px);
    max-height: calc(100% - 16px);
    display: flex;
    flex-direction: column;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius);
    background: var(--bg-elev);
    color: var(--text);
    box-shadow: var(--shadow);
    font-size: 12px;
    text-align: start;
  }
  .graph-settings.collapsed {
    width: auto;
    min-width: 145px;
  }
  .panel-head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px;
    flex: none;
  }
  .color-probe {
    position: absolute;
    width: 0;
    height: 0;
    overflow: hidden;
    pointer-events: none;
  }
  .panel-scroll {
    overflow: auto;
    overscroll-behavior: contain;
    min-height: 0;
    padding: 0 10px 10px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    border-top: 1px solid var(--border);
  }
  fieldset {
    margin: 0;
    padding: 10px 0 0;
    min-width: 0;
    border: 0;
    display: flex;
    flex-direction: column;
    gap: 9px;
  }
  legend {
    font-weight: 650;
    padding: 10px 0 0;
    color: var(--text-2);
  }
  details {
    min-width: 0;
    border-top: 1px solid var(--border);
    padding-block-start: 10px;
  }
  summary {
    cursor: pointer;
    color: var(--text-2);
    font-weight: 650;
  }
  .slider-field,
  .field-label {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
  }
  .slider-controls {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .slider-controls input[type='range'] {
    flex: 1;
    min-width: 0;
    width: 0;
  }
  .number {
    width: 68px;
    min-width: 0;
    flex: none;
    padding: 3px 5px;
    font-size: 12px;
  }
  .check {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    line-height: 1.4;
    cursor: pointer;
  }
  .check input {
    margin: 0;
    flex: none;
  }
  .group-box {
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-sunken);
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }
  .group-head,
  .group-actions {
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
  }
  .group-head .input {
    width: 0;
    min-width: 0;
    padding: 4px 6px;
    font-size: 12px;
  }
  .color {
    width: 34px;
    height: 27px;
    padding: 2px;
    flex: none;
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    background: var(--bg);
  }
  .group-match {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    min-width: 0;
  }
  .select {
    max-width: 100%;
    min-width: 0;
    font-size: 12px;
    padding-block: 4px;
  }
  .group-match .select {
    flex: 1 1 100px;
    width: 0;
  }
  .default-color,
  .default-color label {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .default-color label {
    justify-content: space-between;
  }
  .reset {
    align-self: flex-start;
    margin-block-start: 2px;
  }
</style>
