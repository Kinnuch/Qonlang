<script lang="ts">
  /** 皮肤：预设 / 颜色 / 字体 / 字体库；检视器里是实时预览。 */
  import { ui } from '$lib/state/ui.svelte'
  import { projectState } from '$lib/state/project.svelte'
  import { fontLibrary } from '$lib/state/fonts.svelte'
  import { i18n, t } from '$lib/i18n/index.svelte'
  import { SKIN_PRESETS, SKIN_VARS, FONT_CATALOG, COMMON_SYSTEM_FONTS, DEFAULT_SKIN, EMPTY_FONTS, type FontSlot, type FontEntry } from '$lib/skin/presets'
  import Portal from '$lib/ui/Portal.svelte'
  import Hint from '$lib/ui/Hint.svelte'
  import { flashOn } from '$lib/ui/flash'
  import { Download, Check, Trash2, RotateCcw, FolderPlus, Loader } from '@lucide/svelte'

  let { inspectorTitle = $bindable('') }: { inspectorTitle?: string } = $props()
  $effect(() => {
    inspectorTitle = t('skin.preview')
  })

  const skin = $derived(ui.prefs.skin)
  const theme = $derived(ui.resolvedTheme)
  const zh = $derived(i18n.locale === 'zh')
  const SLOTS: FontSlot[] = ['ui', 'data', 'mono', 'corpusText', 'corpusTr', 'gloss', 'script']
  const fontOptions = $derived([...new Set([...fontLibrary.fonts.map((f) => f.family), ...COMMON_SYSTEM_FONTS])])
  let presetFlash = $state(0)

  /** 读出当前主题下某变量的实际值（未覆盖时取计算样式，供取色器显示） */
  function currentValue(name: string): string {
    const v = skin[theme]?.[name]
    if (v) return v
    if (typeof getComputedStyle === 'undefined') return '#000000'
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#000000'
  }
  function toHex(c: string): string {
    if (/^#[0-9a-f]{6}$/i.test(c)) return c
    if (/^#[0-9a-f]{3}$/i.test(c)) return '#' + c.slice(1).split('').map((x) => x + x).join('')
    const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
    if (m) return '#' + [m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join('')
    return '#000000'
  }
  function save(): void {
    void ui.savePrefs()
  }
  function setVar(name: string, value: string): void {
    skin[theme][name] = value
    skin.preset = 'custom'
    save()
  }
  function clearVar(name: string): void {
    delete skin[theme][name]
    skin.preset = 'custom'
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
  function reset(): void {
    ui.prefs.skin = structuredClone(DEFAULT_SKIN)
    save()
    ui.toast(t('skin.resetDone'))
  }
  function setFont(slot: FontSlot, v: string): void {
    skin.fonts[slot] = v
    save()
  }
  async function download(entry: FontEntry): Promise<void> {
    const err = await fontLibrary.download(entry, skin.mirror)
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
    <span class="grow"></span>
    <button class="btn ghost sm" onclick={reset}><RotateCcw size={14} />{t('skin.reset')}</button>
  </div>
  <Hint id="skin" text={t('skin.hint')} />

  <div class="scroll">
    <section>
      <h3>{t('skin.presets')}</h3>
      <div class="presets" use:flashOn={presetFlash}>
        {#each SKIN_PRESETS as p (p.id)}
          <button class="preset" class:active={skin.preset === p.id} onclick={() => applyPreset(p.id)}>
            <span class="swatch" style:background={p.swatch[0]} style:border-color={p.swatch[1]}>
              <span class="dot" style:background={p.swatch[1]}></span>
              <span class="line" style:background={p.swatch[2]}></span>
              <span class="line short" style:background={p.swatch[2]}></span>
            </span>
            <span class="pname">{zh ? p.name.zh : p.name.en}</span>
          </button>
        {/each}
        {#if skin.preset === 'custom'}<span class="badge accent self">{t('skin.custom')}</span>{/if}
      </div>
    </section>

    <section>
      <h3>{t('skin.colors')} <span class="small muted">{t('skin.colorsFor', { theme: t(theme === 'dark' ? 'settings.themeDark' : 'settings.themeLight') })}</span></h3>
      <div class="colors">
        {#each SKIN_VARS as v (v.name)}
          {@const cur = currentValue(v.name)}
          <div class="color-row" class:set={!!skin[theme]?.[v.name]}>
            <input type="color" value={toHex(cur)} oninput={(e) => setVar(v.name, (e.currentTarget as HTMLInputElement).value)} />
            <span class="grow">{t(`skin.vars.${v.key}`)}</span>
            <code class="mono">{cur}</code>
            {#if skin[theme]?.[v.name]}<button class="btn ghost icon sm" title={t('skin.reset')} onclick={() => clearVar(v.name)}><RotateCcw size={12} /></button>{/if}
          </div>
        {/each}
      </div>
    </section>

    <section>
      <h3>{t('skin.fonts')}</h3>
      <datalist id="font-options">{#each fontOptions as f (f)}<option value={f}></option>{/each}</datalist>
      <div class="fonts">
        {#each SLOTS as slot (slot)}
          <label class="font-row">
            <span class="fl">{t(`skin.fontSlots.${slot}`)}</span>
            <input class="input" list="font-options" value={skin.fonts[slot]} placeholder={t('skin.fontPlaceholder')} onchange={(e) => setFont(slot, (e.currentTarget as HTMLInputElement).value)} />
          </label>
        {/each}
      </div>
    </section>

    <section>
      <h3>{t('skin.library')}</h3>
      <p class="small muted">{t('skin.libraryHint')}</p>
      <div class="row wrap">
        <button class="btn sm" onclick={importLocal}><FolderPlus size={14} />{t('skin.importLocal')}</button>
        <span class="grow"></span>
        <label class="row small muted mirror" title={t('skin.mirrorHint')}>
          {t('skin.mirror')}
          <input class="input" bind:value={skin.mirror} onchange={save} placeholder="https://ghfast.top/" />
        </label>
      </div>
      <table class="tbl">
        <tbody>
          {#each FONT_CATALOG as f (f.file)}
            {@const inst = fontLibrary.fonts.find((x) => x.file === f.file)}
            <tr>
              <td class="fam" style:font-family={inst ? `"${f.family}"` : ''}>{f.family}</td>
              <td class="muted small">{zh ? f.desc.zh : f.desc.en}</td>
              <td class="act">
                {#if inst}
                  <span class="badge accent"><Check size={12} />{t('skin.installed')} · {mb(inst.size)}</span>
                  <button class="btn ghost icon sm" title={t('skin.removeFont')} onclick={() => fontLibrary.remove(f.file)}><Trash2 size={13} /></button>
                {:else if fontLibrary.isDownloading(f)}
                  <span class="badge"><Loader size={12} />{t('skin.downloading', { pct: pct(f.file) })}</span>
                {:else}
                  <button class="btn sm" onclick={() => download(f)}><Download size={13} />{t('skin.download')}</button>
                {/if}
              </td>
            </tr>
          {/each}
          {#each fontLibrary.fonts.filter((x) => !FONT_CATALOG.some((c) => c.file === x.file)) as x (x.file)}
            <tr>
              <td class="fam" style:font-family={`"${x.family}"`}>{x.family}</td>
              <td class="muted small">{x.file}</td>
              <td class="act">
                <span class="badge accent"><Check size={12} />{t('skin.installed')} · {mb(x.size)}</span>
                <button class="btn ghost icon sm" title={t('skin.removeFont')} onclick={() => fontLibrary.remove(x.file)}><Trash2 size={13} /></button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </section>
  </div>
</div>

<Portal>
  <div class="pv card">
    <div class="pv-lemma data">{previewLexeme?.lemma ?? 'lorem'}</div>
    <div class="pv-pos">n.</div>
    <div class="pv-def">{previewLexeme?.senses[0]?.definition[i18n.locale] ?? (zh ? '词条释义示例' : 'sample definition')}</div>
  </div>
  <div class="pv card">
    <div class="pv-text">{previewSentence?.text ?? 'ilenler kasoda jatdu'}</div>
    <div class="pv-gl"><span>ilen-ler</span><span>kaso-da</span><span>jat-du</span></div>
    <div class="pv-gloss"><span>{zh ? '孩子' : 'child'}-PL</span><span>{zh ? '房子' : 'house'}-LOC</span><span>{zh ? '睡' : 'sleep'}-PST</span></div>
    <div class="pv-tr">{previewSentence ? Object.values(previewSentence.translation)[0] : zh ? '孩子们在房子里睡了。' : 'The children slept in the house.'}</div>
    <div class="pv-scr">ᛁᛚᛖᚾᛚᛖᚱ ᚲᚨᛊᛟᛞᚨ ᛃᚨᛏᛞᚢ</div>
  </div>
  <div class="row wrap">
    <button class="btn primary sm">{t('common.save')}</button>
    <button class="btn sm">{t('common.cancel')}</button>
    <span class="badge accent">{t('skin.preview')}</span>
    <span class="chip">tag</span>
  </div>
  <pre class="pv-mono mono">V=a e i o u
a > e / _i</pre>
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
  .pv-mono {
    margin: 10px 0 0;
    padding: 8px 10px;
    background: var(--bg-sunken);
    border-radius: var(--radius-sm);
    color: var(--text);
  }
</style>
