<script lang="ts">
  import { matchQuery, parseQuery } from '$lib/core/query'
  import { SEARCH_FIELDS } from '$lib/core/searchFields'
  /** 皮肤：预设 / 颜色 / 字体 / 字体库；检视器里是实时预览。 */
  import { ui } from '$lib/state/ui.svelte'
  import { projectState } from '$lib/state/project.svelte'
  import { fontLibrary } from '$lib/state/fonts.svelte'
  import { i18n, t } from '$lib/i18n/index.svelte'
  import HelpDot from '$lib/ui/HelpDot.svelte'
  import {
    SKIN_PRESETS,
    SKIN_VARS,
    FONT_CATALOG,
    COMMON_SYSTEM_FONTS,
    DEFAULT_SKIN,
    EMPTY_FONTS,
    type FontSlot,
    type FontEntry
  } from '$lib/skin/presets'
  import Portal from '$lib/ui/Portal.svelte'
  import Hint from '$lib/ui/Hint.svelte'
  import { flashOn } from '$lib/ui/flash'
  import {
    Download,
    Check,
    Trash2,
    RotateCcw,
    FolderPlus,
    Loader,
    Save,
    Pencil
  } from '@lucide/svelte'
  import { newId } from '$lib/core/factory'
  import GuideLink from '$lib/ui/GuideLink.svelte'

  let { inspectorTitle = $bindable('') }: { inspectorTitle?: string } = $props()
  $effect(() => {
    inspectorTitle = t('skin.preview')
  })

  const skin = $derived(ui.prefs.skin)
  const theme = $derived(ui.resolvedTheme)
  const zh = $derived(i18n.locale === 'zh')
  const SLOTS: FontSlot[] = ['ui', 'data', 'mono', 'corpusText', 'corpusTr', 'gloss', 'script']
  /** 顶栏搜索：字体按名称、说明、标签筛 */
  const fontQuery = $derived(parseQuery(ui.search, SEARCH_FIELDS.skin))
  const catalogShown = $derived(
    FONT_CATALOG.filter((f) =>
      matchQuery(fontQuery, (field) =>
        field === 'name'
          ? [f.family]
          : field === 'tag'
            ? f.tags
            : [f.family, f.desc.zh, f.desc.en, ...f.tags]
      )
    )
  )
  const fontOptions = $derived([
    ...new Set([...fontLibrary.fonts.map((f) => f.family), ...COMMON_SYSTEM_FONTS])
  ])
  let presetFlash = $state(0)
  /** 预览里的高亮：改了哪一项就闪哪一处；悬停左侧某项时右侧对应处描边 */
  let flash = $state<Record<string, number>>({})
  let hoverKey = $state('')
  function bump(key: string): void {
    flash = { ...flash, [key]: (flash[key] ?? 0) + 1 }
  }
  const pvp = (key: string): { key: string; n: number; hover: boolean } => ({
    key,
    n: flash[key] ?? 0,
    hover: hoverKey === key
  })
  /** action：n 变了就闪一下，hover 时描边 */
  function pvMark(
    node: HTMLElement,
    p: { key: string; n: number; hover: boolean }
  ): { update(p: { key: string; n: number; hover: boolean }): void } {
    let last = p.n
    node.dataset.pv = p.key
    const apply = (q: { key: string; n: number; hover: boolean }): void => {
      node.classList.toggle('pv-hover', q.hover)
      if (q.n !== last) {
        last = q.n
        node.classList.remove('pv-hit')
        void node.offsetWidth
        node.classList.add('pv-hit')
        setTimeout(() => node.classList.remove('pv-hit'), 1200)
      }
    }
    apply(p)
    return { update: apply }
  }
  const varLabel = (name: string): string => {
    const v = SKIN_VARS.find((x) => x.name === name)
    return v ? t(`skin.vars.${v.key}`) : name
  }

  /** 读出当前主题下某变量的实际值（未覆盖时取计算样式，供取色器显示） */
  function currentValue(name: string): string {
    const v = skin[theme]?.[name]
    if (v) return v
    if (typeof getComputedStyle === 'undefined') return '#000000'
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#000000'
  }
  function toHex(c: string): string {
    if (/^#[0-9a-f]{6}$/i.test(c)) return c
    if (/^#[0-9a-f]{3}$/i.test(c))
      return (
        '#' +
        c
          .slice(1)
          .split('')
          .map((x) => x + x)
          .join('')
      )
    const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
    if (m)
      return '#' + [m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join('')
    return '#000000'
  }
  function save(): void {
    void ui.savePrefs()
  }
  function setVar(name: string, value: string): void {
    skin[theme][name] = value
    skin.preset = 'custom'
    bump(name)
    save()
  }
  function clearVar(name: string): void {
    delete skin[theme][name]
    skin.preset = 'custom'
    bump(name)
    save()
  }
  function applyPreset(id: string): void {
    const p = SKIN_PRESETS.find((x) => x.id === id)
    if (!p) return
    skin.preset = id
    skin.light = { ...p.light }
    skin.dark = { ...p.dark }
    skin.fonts = { ...EMPTY_FONTS, ...p.fonts }
    presetFlash++
    save()
  }
  const userPresets = $derived(ui.prefs.skinPresets)
  function applyUserPreset(id: string): void {
    const p = userPresets.find((x) => x.id === id)
    if (!p) return
    skin.preset = id
    skin.light = { ...p.light }
    skin.dark = { ...p.dark }
    skin.fonts = { ...EMPTY_FONTS, ...p.fonts }
    presetFlash++
    save()
  }
  async function saveAsPreset(): Promise<void> {
    const name = (await ui.prompt(t('skin.presetName'), ''))?.trim()
    if (!name) return
    const existing = userPresets.find((x) => x.name === name)
    const data = {
      name,
      light: { ...skin.light },
      dark: { ...skin.dark },
      fonts: { ...skin.fonts }
    }
    if (existing) Object.assign(existing, data)
    else ui.prefs.skinPresets.push({ id: newId(), ...data })
    skin.preset = (existing ?? ui.prefs.skinPresets[ui.prefs.skinPresets.length - 1]).id
    save()
    ui.toast(t('skin.presetSaved', { name }))
  }
  async function renamePreset(id: string): Promise<void> {
    const p = userPresets.find((x) => x.id === id)
    if (!p) return
    const name = (await ui.prompt(t('skin.presetName'), p.name))?.trim()
    if (!name) return
    p.name = name
    save()
  }
  function deletePreset(id: string): void {
    const idx = userPresets.findIndex((x) => x.id === id)
    if (idx < 0) return
    const snap = $state.snapshot(userPresets[idx])
    ui.prefs.skinPresets.splice(idx, 1)
    if (skin.preset === id) skin.preset = 'custom'
    save()
    ui.toast(t('skin.presetDeleted', { name: snap.name }), {
      action: {
        label: t('common.undo'),
        run: () => {
          ui.prefs.skinPresets.splice(Math.min(idx, ui.prefs.skinPresets.length), 0, snap)
          save()
        }
      }
    })
  }
  /** 预设卡片的三色：背景 / 强调 / 文字，取浅色配置，缺省回落默认 */
  function swatchOf(p: { light: Record<string, string> }): [string, string, string] {
    return [
      p.light['--bg'] || '#fafaf7',
      p.light['--accent'] || '#0e9f8a',
      p.light['--text'] || '#1f1f1f'
    ]
  }
  function reset(): void {
    ui.prefs.skin = structuredClone(DEFAULT_SKIN)
    save()
    ui.toast(t('skin.resetDone'))
  }
  /** 当前项目里的每套文字，皮肤里可以单独给它换字体 */
  const projectScripts = $derived(
    (projectState.project?.languages ?? []).flatMap((l) =>
      l.scripts.map((sc) => ({ script: sc, lang: l.name }))
    )
  )
  function setScriptFont(id: string, v: string): void {
    const next = { ...(skin.scriptFonts ?? {}) }
    if (v.trim()) next[id] = v.trim()
    else delete next[id]
    skin.scriptFonts = next
    save()
  }
  function setFont(slot: FontSlot, v: string): void {
    skin.fonts[slot] = v
    bump('font:' + slot)
    save()
  }
  async function download(entry: FontEntry): Promise<void> {
    const err = entry.builtin
      ? await fontLibrary.install(entry)
      : await fontLibrary.download(entry, skin.mirror)
    if (err) ui.toast(t('skin.downloadFailed', { err }), { kind: 'error' })
    else ui.toast(t('skin.downloaded', { name: entry.family }))
  }
  async function importLocal(): Promise<void> {
    const n = await fontLibrary.importLocal()
    if (n) ui.toast(t('skin.importedLocal', { n }))
  }
  function pct(file: string): number {
    const p = fontLibrary.progress[file]
    if (!p || !p.total) return 0
    return Math.round((p.received / p.total) * 100)
  }
  function mb(n: number): string {
    return (n / 1048576).toFixed(1) + ' MB'
  }
  const previewLexeme = $derived(projectState.project?.lexemes.find((l) => l.lemma) ?? null)
  const previewSentence = $derived(projectState.project?.sentences.find((s) => s.text) ?? null)
</script>

<div class="page">
  <div class="page-head row">
    <h1>{t('skin.title')}</h1>
    <GuideLink section="skin" />
    <span class="grow"></span>
    <button class="btn ghost sm" onclick={reset}><RotateCcw size={14} />{t('skin.reset')}</button>
  </div>
  <Hint id="skin" text={t('skin.hint')} />

  <div class="scroll">
    <section>
      <h3>{t('skin.presets')} <HelpDot tip={t('skin.presetHint')} /></h3>
      <div class="presets" use:flashOn={presetFlash}>
        {#each SKIN_PRESETS as p (p.id)}
          <button
            class="preset"
            class:active={skin.preset === p.id}
            onclick={() => applyPreset(p.id)}
          >
            <span class="swatch" style:background={p.swatch[0]} style:border-color={p.swatch[1]}>
              <span class="dot" style:background={p.swatch[1]}></span>
              <span class="line" style:background={p.swatch[2]}></span>
              <span class="line short" style:background={p.swatch[2]}></span>
            </span>
            <span class="pname">{zh ? p.name.zh : p.name.en}</span>
          </button>
        {/each}
        {#each userPresets as p (p.id)}
          {@const sw = swatchOf(p)}
          <div class="preset user" class:active={skin.preset === p.id}>
            <button class="preset-main" onclick={() => applyUserPreset(p.id)}>
              <span class="swatch" style:background={sw[0]} style:border-color={sw[1]}>
                <span class="dot" style:background={sw[1]}></span>
                <span class="line" style:background={sw[2]}></span>
                <span class="line short" style:background={sw[2]}></span>
              </span>
              <span class="pname">{p.name}</span>
            </button>
            <span class="preset-tools">
              <button
                class="btn ghost icon sm"
                title={t('skin.renamePreset')}
                onclick={() => renamePreset(p.id)}><Pencil size={11} /></button
              >
              <button
                class="btn ghost icon sm"
                title={t('skin.deletePreset')}
                onclick={() => deletePreset(p.id)}><Trash2 size={11} /></button
              >
            </span>
          </div>
        {/each}
        <button class="preset add" onclick={saveAsPreset}>
          <span class="swatch dashed"><Save size={20} /></span>
          <span class="pname">{t('skin.saveAsPreset')}</span>
        </button>
        {#if skin.preset === 'custom'}<span class="badge accent self">{t('skin.custom')}</span>{/if}
      </div>
    </section>

    <section>
      <h3>
        {t('skin.colors')}
        <span class="small muted"
          >{t('skin.colorsFor', {
            theme: t(theme === 'dark' ? 'settings.themeDark' : 'settings.themeLight')
          })}</span
        >
      </h3>
      <div class="colors">
        {#each SKIN_VARS as v (v.name)}
          {@const cur = currentValue(v.name)}
          <div
            class="color-row"
            class:set={!!skin[theme]?.[v.name]}
            role="group"
            onmouseenter={() => (hoverKey = v.name)}
            onmouseleave={() => (hoverKey = '')}
          >
            <input
              type="color"
              value={toHex(cur)}
              oninput={(e) => setVar(v.name, (e.currentTarget as HTMLInputElement).value)}
            />
            <span class="grow">{t(`skin.vars.${v.key}`)}</span>
            <code class="mono">{cur}</code>
            {#if skin[theme]?.[v.name]}<button
                class="btn ghost icon sm"
                title={t('skin.reset')}
                onclick={() => clearVar(v.name)}><RotateCcw size={12} /></button
              >{/if}
          </div>
        {/each}
      </div>
    </section>

    <section>
      <h3>{t('skin.fonts')}</h3>
      <datalist id="font-options"
        >{#each fontOptions as f (f)}<option value={f}></option>{/each}</datalist
      >
      <div class="fonts">
        {#each SLOTS as slot (slot)}
          <label
            class="font-row"
            onmouseenter={() => (hoverKey = 'font:' + slot)}
            onmouseleave={() => (hoverKey = '')}
          >
            <span class="fl">{t(`skin.fontSlots.${slot}`)}</span>
            <input
              class="input"
              list="font-options"
              value={skin.fonts[slot]}
              placeholder={t('skin.fontPlaceholder')}
              onchange={(e) => setFont(slot, (e.currentTarget as HTMLInputElement).value)}
            />
          </label>
        {/each}
      </div>
      {#if projectScripts.length}
        <p class="small muted">{t('skin.scriptFontsHint')}</p>
        <div class="fonts">
          {#each projectScripts as ps (ps.script.id)}
            <label class="font-row">
              <span class="fl"
                >{t('skin.scriptFontFor', { name: ps.script.name, lang: ps.lang })}</span
              >
              <input
                class="input"
                list="font-options"
                value={skin.scriptFonts?.[ps.script.id] ?? ''}
                placeholder={ps.script.font.fileName ||
                  ps.script.font.family ||
                  t('skin.fontPlaceholder')}
                onchange={(e) =>
                  setScriptFont(ps.script.id, (e.currentTarget as HTMLInputElement).value)}
              />
            </label>
          {/each}
        </div>
      {/if}
    </section>

    <section>
      <h3>{t('skin.library')} <HelpDot tip={t('skin.libraryHint')} /></h3>
      <div class="row wrap">
        <button class="btn sm" onclick={importLocal}
          ><FolderPlus size={14} />{t('skin.importLocal')}</button
        >
        <span class="grow"></span>
        <label class="row small muted mirror" title={t('skin.mirrorHint')}>
          {t('skin.mirror')}
          <input
            class="input"
            bind:value={skin.mirror}
            onchange={save}
            placeholder="https://ghfast.top/"
          />
        </label>
      </div>
      <table class="tbl">
        <tbody>
          {#each catalogShown as f (f.file)}
            {@const inst = fontLibrary.fonts.find((x) => x.file === f.file)}
            <tr>
              <td class="fam" style:font-family={inst ? `"${f.family}"` : ''}>{f.family}</td>
              <td class="muted small">{zh ? f.desc.zh : f.desc.en}</td>
              <td class="act">
                {#if inst}
                  <span class="badge accent"
                    ><Check size={12} />{t('skin.installed')} · {mb(inst.size)}</span
                  >
                  <button
                    class="btn ghost icon sm"
                    title={t('skin.removeFont')}
                    onclick={() => fontLibrary.remove(f.file)}><Trash2 size={13} /></button
                  >
                {:else if fontLibrary.isDownloading(f)}
                  <span class="badge"
                    ><Loader size={12} />{t('skin.downloading', { pct: pct(f.file) })}</span
                  >
                {:else}
                  <button class="btn sm" onclick={() => download(f)}
                    ><Download size={13} />{f.builtin
                      ? t('skin.installBuiltin')
                      : t('skin.download')}</button
                  >
                {/if}
              </td>
            </tr>
          {/each}
          {#each fontLibrary.fonts.filter((x) => !FONT_CATALOG.some((c) => c.file === x.file)) as x (x.file)}
            <tr>
              <td class="fam" style:font-family={`"${x.family}"`}>{x.family}</td>
              <td class="muted small">{x.file}</td>
              <td class="act">
                <span class="badge accent"
                  ><Check size={12} />{t('skin.installed')} · {mb(x.size)}</span
                >
                <button
                  class="btn ghost icon sm"
                  title={t('skin.removeFont')}
                  onclick={() => fontLibrary.remove(x.file)}><Trash2 size={13} /></button
                >
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </section>
  </div>
</div>

<Portal>
  <div class="pv-board" use:pvMark={pvp('--bg')} title={varLabel('--bg')}>
    <div class="pv card" use:pvMark={pvp('--bg-elev')} title={varLabel('--bg-elev')}>
      <div class="pv-ui" use:pvMark={pvp('font:ui')} title={t('skin.fontSlots.ui')}>
        {t('lexicon.title')} · {t('skin.fontSlots.ui')}
      </div>
      <div class="pv-lemma data" use:pvMark={pvp('font:data')} title={t('skin.fontSlots.data')}>
        {previewLexeme?.lemma ?? 'lorem'}
      </div>
      <div class="pv-pos" use:pvMark={pvp('--accent-text')} title={varLabel('--accent-text')}>
        n. · {varLabel('--accent-text')}
      </div>
      <div class="pv-def" use:pvMark={pvp('--text')} title={varLabel('--text')}>
        {previewLexeme?.senses[0]?.definition[i18n.locale] ??
          (zh ? '词条释义示例' : 'sample definition')}
      </div>
      <div class="pv-t2" use:pvMark={pvp('--text-2')} title={varLabel('--text-2')}>
        {varLabel('--text-2')} · {zh ? '次要说明文字' : 'secondary text'}
      </div>
      <div class="pv-t3 small" use:pvMark={pvp('--text-3')} title={varLabel('--text-3')}>
        {varLabel('--text-3')} · {zh ? '弱化提示' : 'muted hint'}
      </div>
    </div>
    <div class="pv card">
      <div
        class="pv-text"
        use:pvMark={pvp('font:corpusText')}
        title={t('skin.fontSlots.corpusText')}
      >
        {previewSentence?.text ?? 'ilenler kasoda jatdu'}
      </div>
      <div class="pv-gl" use:pvMark={pvp('font:corpusText')}>
        <span>ilen-ler</span><span>kaso-da</span><span>jat-du</span>
      </div>
      <div class="pv-gloss" use:pvMark={pvp('font:gloss')} title={t('skin.fontSlots.gloss')}>
        <span>{zh ? '孩子' : 'child'}-PL</span><span>{zh ? '房子' : 'house'}-LOC</span><span
          >{zh ? '睡' : 'sleep'}-PST</span
        >
      </div>
      <div class="pv-tr" use:pvMark={pvp('font:corpusTr')} title={t('skin.fontSlots.corpusTr')}>
        {previewSentence
          ? Object.values(previewSentence.translation)[0]
          : zh
            ? '孩子们在房子里睡了。'
            : 'The children slept in the house.'}
      </div>
      <div class="pv-scr" use:pvMark={pvp('font:script')} title={t('skin.fontSlots.script')}>
        ᛁᛚᛖᚾᛚᛖᚱ ᚲᚨᛊᛟᛞᚨ ᛃᚨᛏᛞᚢ
      </div>
    </div>
    <div class="row wrap pv-row">
      <button class="btn primary sm" use:pvMark={pvp('--accent')} title={varLabel('--accent')}
        >{t('common.save')}</button
      >
      <button
        class="btn primary sm pv-hovered"
        use:pvMark={pvp('--accent-hover')}
        title={varLabel('--accent-hover')}>{varLabel('--accent-hover')}</button
      >
      <button class="btn sm" use:pvMark={pvp('--border')} title={varLabel('--border')}
        >{t('common.cancel')}</button
      >
      <button class="btn sm danger" use:pvMark={pvp('--danger')} title={varLabel('--danger')}
        >{t('common.delete')}</button
      >
      <span class="badge accent" use:pvMark={pvp('--accent-soft')} title={varLabel('--accent-soft')}
        >{varLabel('--accent-soft')}</span
      >
      <span class="chip pv-warn" use:pvMark={pvp('--warn')} title={varLabel('--warn')}
        >{varLabel('--warn')}</span
      >
    </div>
    <div class="pv-list">
      <div class="pv-li" use:pvMark={pvp('--border-strong')} title={varLabel('--border-strong')}>
        {varLabel('--border-strong')}
      </div>
      <div class="pv-li hov" use:pvMark={pvp('--bg-hover')} title={varLabel('--bg-hover')}>
        {varLabel('--bg-hover')}
      </div>
    </div>
    <pre class="pv-mono mono" use:pvMark={pvp('--bg-sunken')} title={varLabel('--bg-sunken')}><span
        use:pvMark={pvp('font:mono')}
        >V=a e i o u
a > e / _i</span
      ></pre>
    <div class="pv-swatches">
      {#each SKIN_VARS as v (v.name)}
        <div class="sw" use:pvMark={pvp(v.name)} title={v.name}>
          <span class="swc" style:background="var({v.name})"></span>
          <span class="swl small">{t(`skin.vars.${v.key}`)}</span>
        </div>
      {/each}
    </div>
  </div>
</Portal>

<style>
  .page {
    padding: 20px 24px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    height: 100%;
  }
  .scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 22px;
    padding-right: 4px;
  }
  section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  h3 {
    display: flex;
    align-items: baseline;
    gap: 10px;
  }
  .presets {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
    border-radius: var(--radius-sm);
  }
  .preset {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 8px 10px 6px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-elev);
    cursor: pointer;
    color: var(--text);
  }
  .preset.user {
    position: relative;
    padding: 0;
  }
  .preset-main {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 8px 10px 6px;
    border: 0;
    background: none;
    cursor: pointer;
    color: inherit;
    font: inherit;
  }
  .preset-tools {
    position: absolute;
    top: 4px;
    right: 4px;
    display: none;
    gap: 0;
    background: var(--bg-elev);
    border-radius: var(--radius-sm);
  }
  .preset.user:hover .preset-tools {
    display: inline-flex;
  }
  .preset.add {
    border-style: dashed;
    color: var(--text-2);
  }
  .swatch.dashed {
    display: grid;
    place-items: center;
    border-style: dashed;
    border-color: var(--border-strong);
    background: var(--bg);
  }
  .preset.active {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }
  .swatch {
    position: relative;
    width: 96px;
    height: 56px;
    border-radius: 6px;
    border: 1px solid;
    overflow: hidden;
  }
  .dot {
    position: absolute;
    left: 8px;
    top: 8px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
  }
  .line {
    position: absolute;
    left: 28px;
    top: 12px;
    width: 56px;
    height: 5px;
    border-radius: 3px;
    opacity: 0.85;
  }
  .line.short {
    top: 24px;
    width: 36px;
    opacity: 0.45;
  }
  .pname {
    font-size: 13px;
  }
  .self {
    align-self: center;
  }
  .colors {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 4px 16px;
  }
  .color-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 6px;
    border-radius: var(--radius-sm);
    font-size: 13px;
  }
  .color-row.set {
    background: var(--accent-soft);
  }
  .color-row input[type='color'] {
    width: 28px;
    height: 22px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: none;
    cursor: pointer;
  }
  .mono {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-3);
  }
  .fonts {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
    gap: 6px 16px;
  }
  .font-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }
  .fl {
    width: 200px;
    flex: none;
    color: var(--text-2);
  }
  .mirror {
    gap: 8px;
  }
  .mirror .input {
    width: 220px;
  }
  .tbl {
    border-collapse: collapse;
    font-size: 13px;
    width: 100%;
  }
  .tbl td {
    padding: 5px 8px;
    border-bottom: 1px solid var(--border);
    vertical-align: middle;
  }
  .fam {
    font-size: 16px;
    white-space: nowrap;
  }
  .act {
    text-align: right;
    white-space: nowrap;
  }
  .act .badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .chip {
    padding: 2px 10px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--bg-elev);
    font-size: 13px;
  }
  /* 预览 */
  .pv {
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    margin-bottom: 10px;
  }
  .pv-lemma {
    font-size: 24px;
  }
  .pv-pos {
    color: var(--accent-text);
    font-style: italic;
    font-size: 13px;
  }
  .pv-def {
    font-size: 14px;
  }
  .pv-text {
    font-family: var(--font-corpus-text);
    font-size: 17px;
  }
  .pv-gl {
    display: flex;
    gap: 12px;
    font-family: var(--font-corpus-text);
    font-size: 14px;
  }
  .pv-gloss {
    display: flex;
    gap: 12px;
    font-family: var(--font-gloss);
    font-size: 12px;
    color: var(--text-2);
  }
  .pv-tr {
    font-family: var(--font-corpus-tr);
    font-style: italic;
    color: var(--text-2);
  }
  .pv-scr {
    font-family: var(--font-script);
    font-size: 20px;
  }
  .pv-board {
    padding: 10px;
    border-radius: var(--radius);
    background: var(--bg);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .pv-ui {
    font-family: var(--font-ui);
    font-size: 12px;
    color: var(--text-2);
  }
  .pv-t2 {
    color: var(--text-2);
    font-size: 13px;
  }
  .pv-t3 {
    color: var(--text-3);
  }
  .pv-row {
    margin: 8px 0;
    gap: 6px;
  }
  .pv-row > * {
    white-space: nowrap;
    flex: none;
  }
  .pv-hovered {
    background: var(--accent-hover);
  }
  .pv-warn {
    border-color: var(--warn);
    color: var(--warn);
  }
  .pv-list {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    overflow: hidden;
    font-size: 13px;
  }
  .pv-li {
    padding: 4px 8px;
  }
  .pv-li.hov {
    background: var(--bg-hover);
  }
  .pv-swatches {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
    gap: 4px;
    margin-top: 10px;
  }
  .sw {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 4px;
    border-radius: var(--radius-sm);
  }
  .swc {
    width: 16px;
    height: 16px;
    border-radius: 4px;
    border: 1px solid var(--border-strong);
    flex: none;
  }
  .swl {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  :global(.pv-hover) {
    outline: 2px dashed var(--accent);
    outline-offset: 2px;
  }
  :global(.pv-hit) {
    animation: pv-hit 1.2s ease-out;
  }
  @keyframes pv-hit {
    0% {
      box-shadow: 0 0 0 4px var(--accent);
    }
    100% {
      box-shadow: 0 0 0 4px transparent;
    }
  }
  .pv-mono {
    margin: 10px 0 0;
    padding: 8px 10px;
    background: var(--bg-sunken);
    border-radius: var(--radius-sm);
    color: var(--text);
  }
</style>
