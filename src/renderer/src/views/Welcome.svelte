<script lang="ts">
  import RuleSyntax from '$lib/ui/RuleSyntax.svelte'
  import appIconSvg from '../assets/brand/app-icon.svg?raw'
  import wordmarkZh from '../assets/brand/wordmark-zh.svg?raw'
  import wordmarkEn from '../assets/brand/wordmark-en.svg?raw'
  import DailyGallery from '$lib/ui/DailyGallery.svelte'
  import RecentProjects from '$lib/ui/RecentProjects.svelte'
  import AppSettings from '$lib/ui/AppSettings.svelte'
  import WordPopover from '$lib/ui/WordPopover.svelte'
  import GuideTour from '$lib/ui/GuideTour.svelte'
  import GamePanel, { type GameId } from '$lib/games/GamePanel.svelte'
  import { tour } from '$lib/state/tour.svelte'
  import { onMount } from 'svelte'
  import { platform, type RecentEntry } from '$lib/platform'
  import { projectState } from '$lib/state/project.svelte'
  import { ui } from '$lib/state/ui.svelte'
  import { i18n, t, pickText, localeOptions } from '$lib/i18n/index.svelte'
  import type { ProjectTemplate } from '$lib/core/model'
  import { createLanguage } from '$lib/core/factory'
  import { mdToHtml } from '$lib/core/markdown'
  import { parseProject } from '$lib/core/serialize'
  import { guideUrl } from '$lib/core/guide'
  import { SKIN_PRESETS, EMPTY_FONTS } from '$lib/skin/presets'
  import { inkTransition } from '$lib/skin/ink'
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
    ChevronDown,
    ExternalLink,
    BookOpen,
    Globe,
    Shirt,
    Settings2,
    Sparkles,
    HeartHandshake,
    BookText,
    Copy
  } from '@lucide/svelte'
  import changelogRaw from '../../../../CHANGELOG.md?raw'
  import wechatQr from '../assets/img/wechat-qr.png'
  import iconGilatod from '../assets/friends/gilatod.png'
  import iconKikomas from '../assets/friends/kikomas.png'
  import iconCathamos from '../assets/friends/cathamos.png'
  import iconScarps from '../assets/credits/scarps.png'
  import logoArt from '../assets/brand/app-icon.svg'

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
    {
      name: '蓝地群岛 Wiki',
      url: 'https://shohna.fandom.com/zh/wiki/%E8%93%9D%E5%9C%B0%E7%BE%A4%E5%B2%9B_Wiki',
      icon: iconKikomas,
      blurb: 'kikomas 的蓝地群岛设定资料库。'
    },
    {
      name: 'Cathamos',
      url: 'https://cathamos.github.io',
      icon: iconCathamos,
      blurb: 'Cathamos 的个人站点。'
    },
    { name: 'Sicusa', url: 'https://github.com/sicusa', icon: null, blurb: 'GitHub 主页。' }
  ]
  /** 致谢：名字原样写，不跟着界面语言翻译 */
  const CREDITS: {
    role: 'logoDesign' | 'pixelArt' | 'sponsors' | 'testing' | 'other'
    /** art：作品图怎么放——像素画按整数倍放大，logo 是矢量图 */
    names: { name: string; icon?: string; art?: 'pixel' | 'logo' }[]
  }[] = [
    {
      role: 'logoDesign',
      names: [{ name: 'kikomas', icon: logoArt, art: 'logo' }, { name: 'sgiofh' }]
    },
    { role: 'pixelArt', names: [{ name: 'scarps', icon: iconScarps, art: 'pixel' }] },
    { role: 'sponsors', names: [{ name: 'Kyiexitah' }, { name: 'kikomas' }, { name: 'Cathamos' }] },
    {
      role: 'testing',
      names: [
        { name: 'Cathamos' },
        { name: 'kikomas' },
        { name: '见坂静安' },
        { name: '呼延式微1997' },
        { name: 'sgiofh' },
        { name: '夏穆' },
        { name: 'Kyiexitah' },
        { name: 'Sicusa' },
        { name: 'Ethan Delanche' }
      ]
    },
    { role: 'other', names: [{ name: '老婆大人' }] }
  ]
  // 第一次打开软件：在开始页先把最基本的几处讲一遍（讲过一次就不再自动弹）
  onMount(() => {
    if (!ui.prefs.seenTours.includes('welcome')) tour.request('welcome')
  })

  /** 右侧面板：打开开始页时默认摊开更新日志 */
  let footerPanel = $state<
    | 'examples'
    | 'coffee'
    | 'changelog'
    | 'dev'
    | 'friends'
    | 'credits'
    | 'syntax'
    | 'locale'
    | 'skin'
    | 'settings'
    | null
  >('changelog')
  /** 「新建项目」点开的起步模板下拉 */
  let pickTemplate = $state(false)
  const togglePanel = (p: typeof footerPanel): void => {
    footerPanel = footerPanel === p ? null : p
  }
  /** 主题三选：文案键写全，别拿模板拼（拼出来的键自检测试查不到） */
  const THEMES = [
    { id: 'system', key: 'settings.themeSystem' },
    { id: 'light', key: 'settings.themeLight' },
    { id: 'dark', key: 'settings.themeDark' }
  ] as const
  /** 开始页上换皮肤：跟皮肤页的「套用预设」是同一件事，这里只要配色和字体 */
  function usePreset(id: string, e?: MouseEvent): void {
    const preset = SKIN_PRESETS.find((x) => x.id === id)
    const skin = ui.prefs.skin
    if (!preset || !skin) return
    inkTransition(e, () => {
      skin.preset = id
      skin.light = { ...preset.light }
      skin.dark = { ...preset.dark }
      skin.fonts = { ...EMPTY_FONTS, ...preset.fonts }
      void ui.savePrefs()
    })
  }

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
  async function openExample(ex: (typeof EXAMPLES)[number], copy = false): Promise<void> {
    if (loadingExample) return
    loadingExample = ex.id
    try {
      const raw = (await ex.load()).default
      const project = parseProject(raw)
      if (copy) {
        // 复制一份：先问存到哪，存下来的就是自己的项目
        if (await projectState.saveCopy(project)) footerPanel = null
        return
      }
      // 示例工程：能改不能存，要留着就复制一份
      projectState.openExample(project)
      footerPanel = null
      ui.toast(t('welcome.exampleOpened', { name: ex.name }))
    } catch (e) {
      ui.error((e as Error).message)
    } finally {
      loadingExample = ''
    }
  }

  /** 小游戏：点一个玩法，面板里先挑项目、再挑语言 */
  const GAMES: GameId[] = ['flashcard', 'sage', 'wordle', 'crossword']
  let game = $state<GameId | null>(null)

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
      <div class="logo">{@html appIconSvg}</div>
      <div>
        <h1 class="wordmark" class:en={!i18n.locale.startsWith('zh')} aria-label={t('app.name')}>
          {@html i18n.locale.startsWith('zh') ? wordmarkZh : wordmarkEn}
        </h1>
        <p class="muted small">{t('app.tagline')}</p>
      </div>
    </div>

    <div class="actions" data-tour="welcome-actions">
      <!-- 新建项目：点开才列起步模板，挑一个就在右边填名字 -->
      <div
        class="new-wrap"
        data-tour="welcome-new"
        role="presentation"
        onmouseleave={() => (pickTemplate = false)}
      >
        <button
          class="btn primary"
          class:active={pickTemplate}
          aria-expanded={pickTemplate}
          onclick={() => (pickTemplate = !pickTemplate)}
          ><FilePlus2 size={16} />{t('welcome.newProject')}<ChevronDown size={13} /></button
        >
        {#if pickTemplate}
          <div class="tpl-list card">
            {#each templates as tp (tp.id)}
              <button
                class="tpl-row"
                class:active={template === tp.id}
                disabled={!tp.available}
                onclick={() => {
                  template = tp.id
                  pickTemplate = false
                }}
              >
                <strong>{t(`welcome.templates.${tp.id}`)}</strong>
                <span class="muted small">{t(`welcome.templates.${tp.id}Desc`)}</span>
              </button>
            {/each}
          </div>
        {/if}
      </div>
      <button class="btn" onclick={() => projectState.open()}
        ><FolderOpen size={16} />{t('welcome.openProject')}</button
      >
      <button
        class="btn"
        class:active={footerPanel === 'examples'}
        onclick={() => togglePanel('examples')}
        ><Sparkles size={16} />{t('welcome.examples')}</button
      >
      <button class="btn" onclick={() => open(guideUrl('welcome'))}
        ><BookOpen size={16} />{t('common.guide')}</button
      >
    </div>

    <div class="recent" data-tour="welcome-recent">
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

    <div class="foot row" data-tour="welcome-foot">
      <button
        class="ico"
        class:active={footerPanel === 'locale'}
        title={t('settings.uiLanguage')}
        onclick={() => togglePanel('locale')}
        ><Globe size={17} /><span>{t('welcome.uiLang')}</span></button
      >
      <button
        class="ico"
        class:active={footerPanel === 'skin'}
        title={t('welcome.personalize')}
        onclick={() => togglePanel('skin')}
        ><Shirt size={17} /><span>{t('welcome.personalize')}</span></button
      >
      <button
        class="ico"
        class:active={footerPanel === 'settings'}
        title={t('settings.title')}
        onclick={() => togglePanel('settings')}
        ><Settings2 size={17} /><span>{t('settings.title')}</span></button
      >
      <span class="grow"></span>
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

    <!-- 从最近打开的项目里抽例句、短语、带配图的词；都抽不到就不显示 -->
    <DailyGallery {recent} />

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

    {#if recent.length}
      <h2>{t('welcome.recentProjects')}</h2>
      <div class="projects"><RecentProjects {recent} onopen={openRecent} /></div>
    {/if}

    <h2>{t('games.title')}</h2>
    <p class="small muted games-hint">{t('games.hint')}</p>
    <div class="templates games" data-tour="welcome-games">
      {#each GAMES as g (g)}
        <button class="tpl card" onclick={() => (game = g)}>
          <strong>{t(`games.${g}.name`)}</strong>
          <span class="muted small">{t(`games.${g}.desc`)}</span>
        </button>
      {/each}
    </div>

    <div class="footer-spacer"></div>
    <div class="footer">
      <div class="row footer-bar" data-tour="welcome-footer">
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
        <button
          class="btn"
          class:active={footerPanel === 'credits'}
          onclick={() => (footerPanel = footerPanel === 'credits' ? null : 'credits')}
          ><HeartHandshake size={16} />{t('welcome.credits')}</button
        >
        <button
          class="btn"
          data-tour="welcome-syntax"
          class:active={footerPanel === 'syntax'}
          onclick={() => (footerPanel = footerPanel === 'syntax' ? null : 'syntax')}
          ><BookText size={16} />{t('welcome.syntax')}</button
        >
      </div>
    </div>
  </main>

  {#if footerPanel}
    <aside class="side-panel">
      <div class="panel-head row">
        <strong class="grow"
          >{footerPanel === 'locale'
            ? t('settings.uiLanguage')
            : footerPanel === 'skin'
              ? t('welcome.personalize')
              : footerPanel === 'settings'
                ? t('settings.title')
                : t(`welcome.${footerPanel === 'dev' ? 'developer' : footerPanel}`)}</strong
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
              <p class="small muted">{t(`welcome.exampleDesc.${ex.id}`)}</p>
              <div class="row">
                <button
                  class="btn primary sm"
                  disabled={!!loadingExample}
                  onclick={() => openExample(ex)}
                  >{loadingExample === ex.id
                    ? t('common.loading')
                    : t('welcome.openExample')}</button
                >
                <button
                  class="btn sm"
                  disabled={!!loadingExample}
                  title={t('example.copyHint')}
                  onclick={() => openExample(ex, true)}
                  ><Copy size={14} />{t('example.copy')}</button
                >
              </div>
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
        {:else if footerPanel === 'locale'}
          <div class="card panel picks">
            {#each localeOptions() as l (l.code)}
              <button
                class="btn"
                class:active={ui.prefs.locale === l.code}
                onclick={() => {
                  ui.prefs.locale = l.code
                  void ui.savePrefs()
                }}>{l.label}</button
              >
            {/each}
          </div>
        {:else if footerPanel === 'skin'}
          <div class="card panel">
            <span class="small muted">{t('settings.theme')}</span>
            <div class="row picks">
              {#each THEMES as th (th.id)}
                <button
                  class="btn"
                  class:active={ui.prefs.theme === th.id}
                  onclick={() => {
                    ui.prefs.theme = th.id
                    void ui.savePrefs()
                  }}>{t(th.key)}</button
                >
              {/each}
            </div>
          </div>
          <div class="card panel">
            <span class="small muted">{t('skin.presets')}</span>
            <div class="swatches">
              {#each SKIN_PRESETS as p (p.id)}
                <button
                  class="swatch"
                  class:active={ui.prefs.skin?.preset === p.id}
                  title={pickText(p.name, [i18n.locale])}
                  style={`--a:${p.swatch[0]};--b:${p.swatch[1]};--c:${p.swatch[2]}`}
                  onclick={(e) => usePreset(p.id, e)}
                >
                  <span class="sw" aria-hidden="true"></span>
                  <span class="small">{pickText(p.name, [i18n.locale])}</span>
                </button>
              {/each}
            </div>
            <p class="small muted">{t('welcome.skinMore')}</p>
          </div>
        {:else if footerPanel === 'settings'}
          <AppSettings />
        {:else if footerPanel === 'syntax'}
          <RuleSyntax />
        {:else if footerPanel === 'credits'}
          <div class="card panel credits">
            {#each CREDITS as c (c.role)}
              <div class="credit">
                <span class="small muted">{t(`welcome.creditRoles.${c.role}`)}</span>
                <div class="names">
                  {#each c.names as n (n.name)}
                    <span class="credit-name"
                      >{#if n.icon}<img
                          class:pixel={n.art === 'pixel'}
                          class:logo-art={n.art === 'logo'}
                          src={n.icon}
                          alt={n.name}
                        />{/if}<strong>{n.name}</strong></span
                    >
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </aside>
  {/if}
</div>

<GuideTour />
<!-- 开始页自己挂一个悬浮词卡：画廊里的词悬浮时用（项目里的那个在 Shell 里） -->
<WordPopover />

{#if game}
  <GamePanel {game} {recent} examples={EXAMPLES} onclose={() => (game = null)} />
{/if}

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
  .credits {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 12px 14px;
  }
  .credit {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .credit .names {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 14px;
  }
  .credit-name {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  /*
   * 千语集的 logo（矢量图）：跟下面的像素画占一样宽——像素画 98px 宽、画面在中间 70px，
   * logo 画 70px、左右各留 14px，图的左边与名字的起点都跟像素画对齐
   */
  .logo-art {
    width: 70px;
    height: 70px;
    margin: 0 14px;
  }
  /* 像素画按整数倍放大，不要糊 */
  .pixel {
    width: 98px;
    height: 116px;
    image-rendering: pixelated;
  }
  .side-panel {
    /* 与检视器同宽，但窗口窄时让主区留得住 */
    width: min(var(--panel-w, 360px), 34vw);
    border-inline-start: 1px solid var(--border);
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
    border-inline-end: 1px solid var(--border);
    /* 底边跟主区一样留 40px：左下的语言选择、版本号跟右边底部那排按钮落在同一条线上 */
    padding: 28px 24px 40px;
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
    flex: none;
  }
  .logo :global(svg) {
    display: block;
    width: 100%;
    height: 100%;
  }
  /* 字标：中文按字高、英文连着 Q 的尾巴和 g 的下伸，高一些才一样大 */
  .wordmark {
    margin: 0 0 4px;
    color: var(--text);
    line-height: 0;
  }
  .wordmark :global(svg) {
    display: block;
    height: 19px;
    width: auto;
  }
  .wordmark.en :global(svg) {
    height: 27px;
  }
  /* 英文字标（中文以外都用它）下面约三分之一是 g 的下伸。原来靠负边距把它塞进副标题的行距里，
     可日文、韩文、俄文、阿拉伯文这些字的上沿比拉丁字母高，副标题就顶到字标上了；
     现在留 2px，各种文字下面看着的空当都跟中文那版差不多 */
  .wordmark.en {
    margin-bottom: 2px;
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
  .recent-item:hover {
    border-color: var(--accent);
  }
  .recent-item {
    width: 100%;
    display: flex;
    gap: 8px;
    align-items: flex-start;
    padding: 6px 8px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    cursor: pointer;
    text-align: start;
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
    text-align: start;
  }
  .foot {
    justify-content: space-between;
  }
  .main {
    /* 上下留白收着点：中间这一栏尽量在常见窗口高度里不出滚动条 */
    padding: 24px clamp(20px, 4vw, 48px) 20px;
    overflow: auto;
    /* 底部那排按钮在英文界面里要 860px 左右：880px 减去两边留白放不下，怎么拉宽窗口都会挤出一个到第二行 */
    max-width: 1000px;
    min-width: 0;
  }
  .restore {
    padding: 12px 16px;
    margin-bottom: 16px;
    border-color: var(--warn);
    background: var(--warn-soft);
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
  }
  h2 {
    margin-bottom: 8px;
  }
  .templates {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 10px;
    margin-bottom: 16px;
  }
  /* 最近项目：按满两排（8 张）留位子，底下的小游戏不会因为项目多少上下跳 */
  .projects {
    min-height: 242px;
    margin-bottom: 18px;
  }
  /* 「新建项目」点开的起步模板：浮在按钮下面，一行一个 */
  .new-wrap {
    position: relative;
  }
  .new-wrap > .btn {
    width: 100%;
  }
  /* 箭头贴右边，文字跟下面几个按钮一样靠左 */
  .new-wrap > .btn :global(svg:last-child) {
    margin-inline-start: auto;
  }
  .tpl-list {
    position: absolute;
    z-index: 20;
    left: 0;
    right: 0;
    top: calc(100% + 4px);
    display: flex;
    flex-direction: column;
    padding: 4px;
    gap: 2px;
    box-shadow: var(--shadow-lg);
  }
  .tpl-row {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 6px 9px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: none;
    text-align: start;
    cursor: pointer;
    color: var(--text);
  }
  .tpl-row strong {
    font-size: 13px;
  }
  .tpl-row .small {
    font-size: 11.5px;
    line-height: 1.35;
  }
  .tpl-row:hover:not(:disabled) {
    border-color: var(--accent);
  }
  .tpl-row.active {
    border-color: var(--accent);
    background: var(--accent-soft);
    box-shadow: var(--ring);
  }
  .tpl-row:disabled {
    opacity: 0.55;
    cursor: default;
  }
  /* 侧栏最下面那排：语言 / 个性化 / 设置 */
  .ico {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 5px 8px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--nav-icon);
    font-size: 11px;
    cursor: pointer;
  }
  .ico:hover {
    border-color: var(--accent);
    color: var(--accent-text);
  }
  .ico.active {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent-text);
    box-shadow: var(--ring);
  }
  .picks {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  /* 个性化面板里的皮肤色板 */
  .swatches {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px;
  }
  .swatch {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 5px 7px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-elev);
    cursor: pointer;
    color: var(--text);
    text-align: start;
  }
  .swatch:hover {
    border-color: var(--accent);
  }
  .swatch.active {
    border-color: var(--accent);
    box-shadow: var(--ring);
  }
  .swatch .sw {
    width: 26px;
    height: 16px;
    flex: none;
    border-radius: 4px;
    border: 1px solid var(--border);
    background: linear-gradient(135deg, var(--a) 0 55%, var(--b) 55% 100%);
  }
  .swatch .small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tpl {
    text-align: start;
    padding: 11px 14px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    cursor: pointer;
    transition: border-color 0.12s;
  }
  .tpl:hover:not(:disabled) {
    border-color: var(--accent);
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
  .footer-spacer {
    flex: 1;
    min-height: 12px;
  }
  .footer {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding-top: 12px;
    border-top: 1px solid var(--border);
  }
  .footer-bar {
    gap: 6px;
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
  .games-hint {
    margin: -4px 0 8px;
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
    padding-inline-start: 20px;
    font-size: 13px;
  }
  .md :global(p) {
    font-size: 13px;
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
    text-align: start;
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
    text-align: start;
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
