<script lang="ts">
  import { onMount } from 'svelte'
  import { platform, type RecentEntry } from '$lib/platform'
  import { projectState } from '$lib/state/project.svelte'
  import { ui } from '$lib/state/ui.svelte'
  import { i18n, t, LOCALES } from '$lib/i18n/index.svelte'
  import type { ProjectTemplate } from '$lib/core/model'
  import { createLanguage } from '$lib/core/factory'
  import { mdToHtml } from '$lib/core/markdown'
  import { parseProject } from '$lib/core/serialize'
  import { guideUrl } from '$lib/core/guide'
  import {
    X,
    FolderOpen,
    FilePlus2,
    Clock,
    Trash2,
    Coffee,
    ScrollText,
    User,
    Link2,
    ExternalLink,
    BookOpen,
    Sparkles
  } from '@lucide/svelte'
  import changelogRaw from '../../../../CHANGELOG.md?raw'
  import wechatQr from '../assets/img/wechat-qr.png'
  import iconGilatod from '../assets/friends/gilatod.png'
  import iconKikomas from '../assets/friends/kikomas.png'
  import iconCathamos from '../assets/friends/cathamos.png'

  const WIKI_URL = 'https://wiki.gilatod.art'
  const DEV = {
    name: 'Kinnuch',
    site: 'https://kinnuch.github.io',
    github: 'https://github.com/Kinnuch',
    email: 'kinnuch@pku.edu.cn',
    bilibili: 'https://space.bilibili.com/204354828',
    bilibiliName: '凯岩城の冰原狼'
  }
  const FRIENDS = [
    {
      name: '荏苒之境主站',
      url: 'https://gilatod.art',
      icon: iconGilatod,
      blurb: 'Gilatod，长期合作的朋友的主站。'
    },
    { name: 'Kikomas', url: 'https://kikomas.art', icon: iconKikomas, blurb: '插画与视觉创作。' },
    {
      name: 'Cathamos',
      url: 'https://cathamos.github.io',
      icon: iconCathamos,
      blurb: 'Cathamos 的个人站点。'
    },
    { name: 'Sicusa', url: 'https://github.com/sicusa', icon: null, blurb: 'GitHub 主页。' }
  ]
  let footerPanel = $state<'examples' | 'coffee' | 'changelog' | 'dev' | 'friends' | null>(null)

  /**
   * 示例工程：随软件一起带的两个虚构项目，覆盖各模块的功能。
   * 用动态 import 读进来，平时不占主包。
   */
  const EXAMPLES = [
    {
      id: 'aelith',
      name: 'Aelith',
      load: () => import('../../../../examples/Aelith.laim.json?raw')
    },
    {
      id: 'tsahun',
      name: 'Tsahun',
      load: () => import('../../../../examples/Tsahun.laim.json?raw')
    }
  ]
  let loadingExample = $state('')
  async function openExample(ex: (typeof EXAMPLES)[number]): Promise<void> {
    if (loadingExample) return
    loadingExample = ex.id
    try {
      const raw = (await ex.load()).default
      const project = parseProject(raw)
      // 没有文件目标：改动要另存为，示例文件本身不会被覆盖
      projectState.load(project, null)
      projectState.touch()
      footerPanel = null
      ui.toast(t('welcome.exampleOpened', { name: ex.name }))
    } catch (e) {
      ui.error((e as Error).message)
    } finally {
      loadingExample = ''
    }
  }

  /** 极简 Markdown：标题、列表、段落 */
  const changelogHtml = mdToHtml(changelogRaw)
  const open = (url: string): void => void platform.openExternal(url)

  let { snapshot, onsnapshothandled }: { snapshot: string | null; onsnapshothandled: () => void } =
    $props()

  let recent = $state<RecentEntry[]>([])
  let template = $state<ProjectTemplate | null>(null)
  let name = $state('')
  let proto = $state('')
  let daughters = $state('')
  let version = $state('')

  onMount(async () => {
    recent = await platform.getRecent()
    version = (await platform.info()).version
  })

  const templates: { id: ProjectTemplate; available: boolean }[] = [
    { id: 'blank', available: true },
    { id: 'family', available: true },
    { id: 'lexicanter', available: true },
    { id: 'csv', available: true }
  ]
  let definitionLang = $state('')

  async function create(): Promise<void> {
    if (!template) return
    const n = name.trim() || t('app.untitled')
    if (template === 'lexicanter') {
      const [f] = await platform.readTextFiles({ multiple: false, extensions: ['lexc', 'json'] })
      if (!f) return
      try {
        const { parseLexc, lexicanterToProject } = await import('$lib/importers/lexicanter')
        const { project, report } = lexicanterToProject(parseLexc(f.content), {
          definitionLang: definitionLang.trim() || (i18n.locale.startsWith('zh') ? 'zh' : 'en'),
          uiLocale: i18n.locale,
          appVersion: version
        })
        if (name.trim()) project.meta.name = name.trim()
        projectState.load(project, null)
        projectState.touch()
        ui.toast(
          t('lexicon.lexicanterDone', {
            lexemes: report.lexemes,
            languages: report.languages.length
          })
        )
      } catch (e) {
        ui.error((e as Error).message)
      }
      return
    }
    if (template === 'csv') {
      projectState.create({ name: n, template: 'csv', appVersion: version, uiLocale: i18n.locale })
      projectState.project!.languages.push(createLanguage({ name: n }))
      projectState.project!.settings.defaultLanguageId = projectState.project!.languages[0].id
      projectState.currentLanguageId = projectState.project!.languages[0].id
      ui.pendingImport = 'csv'
      ui.section = 'lexicon'
      return
    }
    projectState.create({
      name: n,
      template,
      appVersion: version,
      uiLocale: i18n.locale,
      familyNames:
        template === 'family'
          ? {
              proto: proto.trim() || `Proto-${n}`,
              daughters: daughters.split('\n').map((s) => s.trim())
            }
          : undefined
    })
  }

  async function openRecent(r: RecentEntry): Promise<void> {
    const ok = await projectState.openRecent(r)
    if (!ok) recent = await platform.getRecent()
  }

  async function clearRecent(): Promise<void> {
    await platform.clearRecent()
    recent = []
  }

  function restore(): void {
    if (snapshot && projectState.restoreSnapshot(snapshot)) onsnapshothandled()
  }
  async function discard(): Promise<void> {
    await platform.saveSnapshot(null)
    onsnapshothandled()
  }
</script>

<div class="welcome">
  <aside class="side">
    <div class="brand">
      <div class="logo">千</div>
      <div>
        <h1>{t('app.name')}</h1>
        <p class="muted small">{t('app.tagline')}</p>
      </div>
    </div>

    <div class="actions">
      <button class="btn primary" onclick={() => (template = template ?? 'blank')}
        ><FilePlus2 size={16} />{t('welcome.newProject')}</button
      >
      <button class="btn" onclick={() => projectState.open()}
        ><FolderOpen size={16} />{t('welcome.openProject')}</button
      >
      <button
        class="btn"
        class:active={footerPanel === 'examples'}
        onclick={() => (footerPanel = footerPanel === 'examples' ? null : 'examples')}
        ><Sparkles size={16} />{t('welcome.examples')}</button
      >
      <button class="btn" onclick={() => open(guideUrl('welcome'))}
        ><BookOpen size={16} />{t('common.guide')}</button
      >
    </div>

    <div class="recent">
      <div class="row">
        <h3 class="grow">{t('welcome.recent')}</h3>
        {#if recent.length}
          <button class="btn ghost icon sm" title={t('welcome.clearRecent')} onclick={clearRecent}
            ><Trash2 size={14} /></button
          >
        {/if}
      </div>
      {#if recent.length === 0}
        <p class="muted small">{t('welcome.noRecent')}</p>
      {:else}
        <ul>
          {#each recent as r (r.path ?? r.handleKey ?? r.name)}
            <li>
              <button class="recent-item" onclick={() => openRecent(r)}>
                <Clock size={14} />
                <span class="grow">
                  <span class="rname">{r.name}</span>
                  {#if r.path}<span class="rpath muted small">{r.path}</span>{/if}
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    <div class="foot row">
      <select class="select locale" bind:value={ui.prefs.locale} onchange={() => ui.savePrefs()}>
        {#each LOCALES as l (l.code)}
          <option value={l.code}>{l.label}</option>
        {/each}
      </select>
      <span class="muted small">v{version}</span>
    </div>
  </aside>

  <main class="main">
    {#if snapshot}
      <div class="card restore">
        <p>{t('welcome.restoreSnapshot')}</p>
        <div class="row">
          <button class="btn primary" onclick={restore}>{t('welcome.restore')}</button>
          <button class="btn" onclick={discard}>{t('welcome.discard')}</button>
        </div>
      </div>
    {/if}

    <button class="banner card" onclick={() => open(WIKI_URL)}>
      <span class="banner-mark">✦</span>
      <span class="banner-text">万千世界的历史由图书管理员于此编纂，直至时间终结。</span>
      <span class="banner-link">wiki.gilatod.art <ExternalLink size={13} /></span>
    </button>

    <h2>{t('welcome.templates.title')}</h2>
    <div class="templates">
      {#each templates as tp (tp.id)}
        <button
          class="tpl card"
          class:active={template === tp.id}
          disabled={!tp.available}
          onclick={() => (template = tp.id)}
        >
          <strong>{t(`welcome.templates.${tp.id}`)}</strong>
          <span class="muted small">{t(`welcome.templates.${tp.id}Desc`)}</span>
        </button>
      {/each}
    </div>

    {#if template}
      <form
        class="form card"
        onsubmit={(e) => {
          e.preventDefault()
          create()
        }}
      >
        <div class="field">
          <label for="pname">{t('welcome.projectName')}</label>
          <input id="pname" class="input" bind:value={name} placeholder={t('app.untitled')} />
        </div>
        {#if template === 'lexicanter'}
          <div class="field">
            <label for="deflang">{t('welcome.definitionLang')}</label>
            <input
              id="deflang"
              class="input"
              bind:value={definitionLang}
              placeholder={i18n.locale.startsWith('zh') ? 'zh' : 'en'}
            />
          </div>
        {/if}
        {#if template === 'family'}
          <div class="field">
            <label for="proto">{t('welcome.protoName')}</label>
            <input id="proto" class="input" bind:value={proto} />
          </div>
          <div class="field">
            <label for="daughters">{t('welcome.daughterNames')}</label>
            <textarea id="daughters" class="textarea" bind:value={daughters}></textarea>
          </div>
        {/if}
        <div class="row">
          <button class="btn primary" type="submit"
            >{template === 'lexicanter' ? t('welcome.lexicanterPick') : t('welcome.create')}</button
          >
          <button class="btn ghost" type="button" onclick={() => (template = null)}
            >{t('common.cancel')}</button
          >
        </div>
      </form>
    {/if}

    <div class="footer-spacer"></div>
    <div class="footer">
      <div class="row footer-bar">
        <button class="btn" onclick={() => open(guideUrl('welcome'))}
          ><BookOpen size={16} />{t('common.guide')}</button
        >
        <button
          class="btn"
          class:active={footerPanel === 'coffee'}
          onclick={() => (footerPanel = footerPanel === 'coffee' ? null : 'coffee')}
          ><Coffee size={16} />{t('welcome.coffee')}</button
        >
        <button
          class="btn"
          class:active={footerPanel === 'changelog'}
          onclick={() => (footerPanel = footerPanel === 'changelog' ? null : 'changelog')}
          ><ScrollText size={16} />{t('welcome.changelog')}</button
        >
        <button
          class="btn"
          class:active={footerPanel === 'dev'}
          onclick={() => (footerPanel = footerPanel === 'dev' ? null : 'dev')}
          ><User size={16} />{t('welcome.developer')}</button
        >
        <button
          class="btn"
          class:active={footerPanel === 'friends'}
          onclick={() => (footerPanel = footerPanel === 'friends' ? null : 'friends')}
          ><Link2 size={16} />{t('welcome.friends')}</button
        >
      </div>
    </div>
  </main>

  {#if footerPanel}
    <aside class="side-panel" style:--panel-w={`${ui.prefs.inspectorWidth}px`}>
      <div class="panel-head row">
        <strong class="grow"
          >{t(`welcome.${footerPanel === 'dev' ? 'developer' : footerPanel}`)}</strong
        >
        <button class="btn ghost icon sm" onclick={() => (footerPanel = null)}
          ><X size={16} /></button
        >
      </div>
      <div class="panel-body">
        {#if footerPanel === 'examples'}
          <p class="small muted">{t('welcome.examplesHint')}</p>
          {#each EXAMPLES as ex (ex.id)}
            <div class="card panel example">
              <strong>{ex.name}</strong>
              <p class="small muted">{t(`welcome.example_${ex.id}`)}</p>
              <button
                class="btn primary sm"
                disabled={!!loadingExample}
                onclick={() => openExample(ex)}
                >{loadingExample === ex.id ? t('common.loading') : t('welcome.openExample')}</button
              >
            </div>
          {/each}
        {:else if footerPanel === 'coffee'}
          <div class="card panel coffee">
            <img src={wechatQr} alt="WeChat Pay" />
            <p class="small muted">{t('welcome.scanWechat')}</p>
          </div>
        {:else if footerPanel === 'changelog'}
          <div class="card panel md">{@html changelogHtml}</div>
        {:else if footerPanel === 'dev'}
          <div class="card panel dev">
            <strong>{DEV.name}</strong>
            <button class="link" onclick={() => open(DEV.site)}>{DEV.site}</button>
            <button class="link" onclick={() => open(DEV.github)}>{DEV.github}</button>
            <button class="link" onclick={() => open(DEV.bilibili)}
              >Bilibili · {DEV.bilibiliName}</button
            >
            <span class="small muted">{DEV.email}</span>
            <span class="small muted">{t('settings.license')} · {t('app.name')} v{version}</span>
          </div>
        {:else if footerPanel === 'friends'}
          <div class="card panel friends">
            {#each FRIENDS as f (f.url)}
              <button class="friend" onclick={() => open(f.url)}>
                {#if f.icon}<img src={f.icon} alt={f.name} />{:else}<span class="ficon"
                    >{f.name[0]}</span
                  >{/if}
                <span class="grow"
                  ><strong>{f.name}</strong><span class="small muted">{f.blurb}</span></span
                >
                <ExternalLink size={13} />
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </aside>
  {/if}
</div>

<style>
  .welcome {
    height: 100%;
    display: grid;
    grid-template-columns: 320px 1fr auto;
  }
  .example {
    display: flex;
    flex-direction: column;
    gap: 6px;
    align-items: flex-start;
    padding: 12px 14px;
  }
  .example p {
    margin: 0;
  }
  .side-panel {
    /* 与检视器同宽，但窗口窄时让主区留得住 */
    width: min(var(--panel-w, 360px), 34vw);
    border-left: 1px solid var(--border);
    background: var(--bg-elev);
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow: hidden;
  }
  .panel-head {
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
  }
  .panel-body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 14px 16px;
  }
  .side {
    background: var(--bg-elev);
    border-right: 1px solid var(--border);
    padding: 28px 24px;
    display: flex;
    flex-direction: column;
    gap: 24px;
  }
  .brand {
    display: flex;
    gap: 12px;
    align-items: center;
  }
  .logo {
    width: 44px;
    height: 44px;
    border-radius: 12px;
    background: var(--accent);
    color: #fff;
    display: grid;
    place-items: center;
    font-size: 22px;
    font-weight: 600;
  }
  .actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .actions .btn {
    justify-content: flex-start;
    padding: 9px 12px;
  }
  .recent {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
  .recent ul {
    list-style: none;
    margin: 6px 0 0;
    padding: 0;
  }
  .recent-item {
    width: 100%;
    display: flex;
    gap: 8px;
    align-items: flex-start;
    padding: 6px 8px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    cursor: pointer;
    text-align: left;
  }
  .recent-item:hover {
    background: var(--bg-hover);
  }
  .recent-item .grow {
    display: flex;
    flex-direction: column;
  }
  .rpath {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    direction: rtl;
    text-align: left;
  }
  .foot {
    justify-content: space-between;
  }
  .locale {
    width: auto;
  }
  .main {
    padding: 40px clamp(20px, 4vw, 48px);
    overflow: auto;
    max-width: 880px;
    min-width: 0;
  }
  .restore {
    padding: 14px 16px;
    margin-bottom: 24px;
    border-color: var(--warn);
    background: var(--warn-soft);
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
  }
  h2 {
    margin-bottom: 12px;
  }
  .templates {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
    margin-bottom: 24px;
  }
  .tpl {
    text-align: left;
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    cursor: pointer;
    transition: border-color 0.12s;
  }
  .tpl:hover:not(:disabled) {
    border-color: var(--border-strong);
  }
  .tpl.active {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }
  .tpl:disabled {
    opacity: 0.55;
    cursor: default;
  }
  .form {
    padding: 20px;
    max-width: 520px;
  }
  .main {
    display: flex;
    flex-direction: column;
  }
  .banner {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 14px;
    width: 100%;
    padding: 14px 18px;
    margin-bottom: 24px;
    text-align: left;
    cursor: pointer;
    background: linear-gradient(90deg, var(--accent-soft), var(--bg-elev));
    border-color: var(--accent);
    transition: box-shadow 0.15s;
  }
  .banner:hover {
    box-shadow: 0 0 0 3px var(--accent-soft);
  }
  .banner-mark {
    color: var(--accent);
    font-size: 18px;
  }
  .banner-text {
    flex: 1;
    /* 窄的时候让链接换行，而不是把这句话挤成一行几个字 */
    min-width: 220px;
    font-family: var(--font-data);
    font-size: 16px;
    letter-spacing: 0.02em;
  }
  .banner-link {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: var(--accent-text);
    white-space: nowrap;
  }
  .footer-spacer {
    flex: 1;
    min-height: 24px;
  }
  .footer {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding-top: 16px;
    border-top: 1px solid var(--border);
  }
  .footer-bar {
    gap: 8px;
    flex-wrap: wrap;
  }
  .footer .btn.active {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .panel {
    padding: 0;
    border: 0;
    background: none;
    box-shadow: none;
    animation: rise 0.18s ease-out;
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }
  .coffee {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }
  .coffee img {
    width: 260px;
    border-radius: var(--radius);
  }
  .md :global(h2) {
    font-size: 15px;
    margin: 10px 0 4px;
  }
  .md :global(h3),
  .md :global(h4) {
    font-size: 13px;
    margin: 8px 0 2px;
    color: var(--text-2);
  }
  .md :global(ul) {
    margin: 0 0 6px;
    padding-left: 20px;
    font-size: 13px;
  }
  .md :global(p) {
    font-size: 13px;
  }
  .md {
    max-height: 320px;
    overflow: auto;
  }
  .dev {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .link {
    border: 0;
    background: none;
    padding: 0;
    color: var(--accent-text);
    cursor: pointer;
    text-align: left;
  }
  .friends {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
  }
  .friend {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg);
    cursor: pointer;
    text-align: left;
  }
  .friend:hover {
    border-color: var(--accent);
  }
  .friend img,
  .ficon {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    object-fit: cover;
    flex: none;
  }
  .ficon {
    display: grid;
    place-items: center;
    background: var(--accent-soft);
    color: var(--accent-text);
    font-weight: 600;
  }
  .friend .grow {
    display: flex;
    flex-direction: column;
  }
</style>
