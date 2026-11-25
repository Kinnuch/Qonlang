<script lang="ts">
  import { t } from '$lib/i18n/index.svelte'
  import {
    normalizeEditorSettings,
    type GlyphEditorSettings,
    type GlyphEditorProject,
    type GlyphComponent
  } from '$lib/script/glyphEditor'
  import { newId } from '$lib/core/factory'
  import GlyphEditorPopover from './GlyphEditorPopover.svelte'
  let {
    settings,
    onchange,
    library,
    onlibrary,
    components,
    oninsert,
    owner
  }: {
    settings: GlyphEditorSettings
    onchange: (value: GlyphEditorSettings) => void
    library: GlyphEditorProject
    onlibrary: (value: GlyphEditorProject) => void
    components: GlyphComponent[]
    oninsert: (component: GlyphComponent) => void
    owner: string
  } = $props()
  let presetName = $state('')
  let presetId = $state('')
  let openPanel = $state<'grid' | 'presets' | 'components' | null>(null)
  let bar = $state<HTMLDivElement>()
  const chosen = $derived(library.presets.find((p) => p.id === presetId))
  function update(key: keyof GlyphEditorSettings, value: unknown): void {
    onchange(normalizeEditorSettings({ ...settings, [key]: value }))
  }
  function finishAction(): void {
    bar?.querySelector<HTMLButtonElement>(`[data-editor-panel-trigger="${openPanel}"]`)?.focus()
    openPanel = null
  }
  function savePreset(): void {
    const name = presetName.trim()
    if (!name) return
    const preset = { id: newId(), name, settings: normalizeEditorSettings(settings) }
    onlibrary({ ...library, presets: [...library.presets, preset] })
    presetId = preset.id
    presetName = ''
  }
</script>

<div class="editor-panels" bind:this={bar}>
  <GlyphEditorPopover
    name="grid"
    {owner}
    label={t('glyphEditor.gridGuides')}
    hint={t('glyphEditor.snapHint')}
    open={openPanel === 'grid'}
    onchange={(value) => (openPanel = value ? 'grid' : null)}
  >
    <div class="settings-grid">
      <label
        ><input
          type="checkbox"
          checked={settings.showGrid}
          onchange={(e) => update('showGrid', e.currentTarget.checked)}
          data-editor-grid
        />{t('glyphEditor.showGrid')}</label
      >
      <label
        ><input
          type="checkbox"
          checked={settings.snap}
          onchange={(e) => update('snap', e.currentTarget.checked)}
          data-editor-snap
        />{t('glyphEditor.snap')}</label
      >
      {#each ['step', 'originX', 'originY'] as key (key)}
        <label
          >{t(`glyphEditor.${key}`)}<input
            class="input sm"
            type="number"
            min={key === 'step' ? 1 : -5000}
            max={key === 'step' ? 1000 : 5000}
            value={settings[key as 'step' | 'originX' | 'originY']}
            data-editor-param={key}
            onchange={(e) =>
              update(key as keyof GlyphEditorSettings, Number(e.currentTarget.value))}
          /></label
        >
      {/each}
      <label
        ><input
          type="checkbox"
          checked={settings.showGuides}
          onchange={(e) => update('showGuides', e.currentTarget.checked)}
        />{t('glyphEditor.showGuides')}</label
      >
      <button
        class="btn sm"
        data-add-guide
        onclick={() =>
          update('guides', [
            ...settings.guides,
            { id: newId(), name: '', axis: 'y', position: 250 }
          ])}>{t('glyphEditor.addGuide')}</button
      >
    </div>
    {#each settings.guides as guide (guide.id)}
      <div class="guide-row">
        <input
          class="input sm"
          aria-label={t('glyphEditor.guideName')}
          placeholder={t('glyphEditor.guideName')}
          value={guide.name}
          onchange={(e) =>
            update(
              'guides',
              settings.guides.map((g) =>
                g.id === guide.id ? { ...g, name: e.currentTarget.value } : g
              )
            )}
        />
        <select
          class="input sm"
          aria-label={t('glyphEditor.guideAxis')}
          value={guide.axis}
          onchange={(e) =>
            update(
              'guides',
              settings.guides.map((g) =>
                g.id === guide.id ? { ...g, axis: e.currentTarget.value as 'x' | 'y' } : g
              )
            )}
          ><option value="y">{t('glyphEditor.horizontal')}</option><option value="x"
            >{t('glyphEditor.vertical')}</option
          ></select
        >
        <input
          class="input sm"
          type="number"
          min="-5000"
          max="5000"
          aria-label={t('glyphEditor.guidePosition')}
          value={guide.position}
          onchange={(e) =>
            update(
              'guides',
              settings.guides.map((g) =>
                g.id === guide.id ? { ...g, position: Number(e.currentTarget.value) } : g
              )
            )}
        />
        <button
          class="btn ghost sm"
          aria-label={t('common.delete')}
          onclick={() =>
            update(
              'guides',
              settings.guides.filter((g) => g.id !== guide.id)
            )}>×</button
        >
      </div>
    {/each}
  </GlyphEditorPopover>
  <GlyphEditorPopover
    name="presets"
    {owner}
    label={t('glyphEditor.presets')}
    hint={t('glyphEditor.presetHint')}
    open={openPanel === 'presets'}
    onchange={(value) => (openPanel = value ? 'presets' : null)}
  >
    <div class="preset-row">
      <select
        class="input sm"
        aria-label={t('glyphEditor.presets')}
        bind:value={presetId}
        data-editor-preset
      >
        <option value="">{t('glyphEditor.choosePreset')}</option>
        {#each library.presets as preset (preset.id)}<option value={preset.id}
            >{preset.name}{library.defaultPresetId === preset.id ? ' ★' : ''}</option
          >{/each}
      </select>
      <button
        class="btn sm"
        disabled={!chosen}
        data-apply-preset
        onclick={() => {
          if (chosen) {
            onchange(normalizeEditorSettings(chosen.settings))
            finishAction()
          }
        }}>{t('glyphEditor.applyPreset')}</button
      >
      <button
        class="btn sm"
        disabled={!chosen}
        data-default-preset
        onclick={() =>
          onlibrary({
            ...library,
            defaultPresetId: library.defaultPresetId === presetId ? undefined : presetId
          })}
        >{library.defaultPresetId === presetId
          ? t('glyphEditor.clearDefault')
          : t('glyphEditor.makeDefault')}</button
      >
      <button
        class="btn ghost sm"
        disabled={!chosen}
        onclick={() => {
          onlibrary({
            ...library,
            presets: library.presets.filter((p) => p.id !== presetId),
            defaultPresetId:
              library.defaultPresetId === presetId ? undefined : library.defaultPresetId
          })
          presetId = ''
        }}>{t('common.delete')}</button
      >
    </div>
    <div class="preset-row">
      <input
        class="input sm"
        placeholder={t('glyphEditor.presetName')}
        aria-label={t('glyphEditor.presetName')}
        bind:value={presetName}
        data-preset-name
      /><button class="btn sm" disabled={!presetName.trim()} onclick={savePreset} data-save-preset
        >{t('glyphEditor.savePreset')}</button
      ><button class="btn ghost sm" onclick={() => onchange(normalizeEditorSettings())}
        >{t('glyphEditor.resetSettings')}</button
      >
    </div>
  </GlyphEditorPopover>
  <GlyphEditorPopover
    name="components"
    {owner}
    label={t('glyphEditor.insertComponent') + ' (' + components.length + ')'}
    open={openPanel === 'components'}
    onchange={(value) => (openPanel = value ? 'components' : null)}
  >
    <div class="component-list">
      {#each components as component (component.id)}<button
          class="btn sm"
          data-insert-component={component.id}
          onclick={() => {
            oninsert(component)
            finishAction()
          }}>{component.name || t('glyphEditor.unnamedComponent')}</button
        >{:else}<span class="small muted">{t('glyphEditor.noComponents')}</span>{/each}
    </div>
  </GlyphEditorPopover>
</div>

<style>
  .editor-panels {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    flex-shrink: 0;
  }
  .settings-grid,
  .preset-row,
  .component-list {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    margin-block: 6px;
  }
  label {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
  }
  label input[type='number'] {
    width: 75px;
  }
  .guide-row {
    display: flex;
    gap: 4px;
    margin-block: 5px;
    align-items: center;
  }
  .guide-row input {
    min-width: 0;
    width: 32%;
  }
  .guide-row select {
    min-width: 0;
    width: 30%;
  }
  .preset-row .input {
    min-width: 0;
    flex: 1 1 100px;
  }
</style>
