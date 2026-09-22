<script lang="ts">
  /**
   * 开始页的「最近项目」：一个项目一张卡片，右下角是这个项目自己的文字写的一个词。
   * 文件一个一个读（先把卡片画出来，名字、作者和文字慢慢补上），读不出来的就只显示文件名。
   * 鼠标停上去卡片里有一层跟着指针走的光。
   */
  import { platform, type RecentEntry } from '$lib/platform'
  import { parseProject, readProjectText } from '$lib/core/serialize'
  import { ensureScriptFont, fontCss } from '$lib/script/fonts'
  import { textScript } from '$lib/script/lexiconScript'
  import type { Project, Script } from '$lib/core/model'
  import { t } from '$lib/i18n/index.svelte'
  import { Clock } from '@lucide/svelte'

  let { recent, onopen }: { recent: RecentEntry[]; onopen: (entry: RecentEntry) => void } = $props()

  interface Card {
    entry: RecentEntry
    /** 项目里写的名字（读出来之前先用最近列表里的） */
    name: string
    author: string
    /** 右下角那几个字：用项目自己的文字写的一个词 */
    art?: { text: string; css: string; vertical: boolean; rtl: boolean }
  }

  /** 最多显示几张 */
  const MAX = 8
  let cards = $state.raw<Card[]>([])

  let loadedFor = ''
  $effect(() => {
    const list = recent.slice(0, MAX)
    const key = list.map((r) => r.path ?? r.name).join('\n')
    if (key === loadedFor) return
    loadedFor = key
    cards = list.map((entry) => ({ entry, name: entry.name, author: '' }))
    // 先让卡片画出来，再一个一个读文件补内容
    const timer = setTimeout(() => void fill(list, key), 200)
    return () => clearTimeout(timer)
  })

  async function fill(list: RecentEntry[], key: string): Promise<void> {
    for (let i = 0; i < list.length; i++) {
      let card: Card | null = null
      try {
        const r = await platform.openRecent(list[i])
        if (r) card = cardOf(list[i], parseProject(await readProjectText(r.content)))
      } catch {
        // 文件不在了、或者不是合法的项目：这张卡片就只留文件名
      }
      if (key !== loadedFor) return
      if (card) cards = cards.map((c, j) => (j === i ? card! : c))
    }
  }

  function cardOf(entry: RecentEntry, project: Project): Card {
    return {
      entry,
      name: project.meta.name || entry.name,
      author: project.meta.author || '',
      art: artOf(project)
    }
  }

  /**
   * 挑一门有文字的语言，拿它的词的文字写法当落款：
   * 挑长一点的词（排得满、末端正好淡出去），太长的截一下。
   */
  const ART_MAX = 14
  function artOf(project: Project): Card['art'] {
    for (const lang of project.languages) {
      for (const sc of (lang.scripts ?? []) as Script[]) {
        const words = project.lexemes.filter((l) => l.languageId === lang.id && l.lemma)
        let best = ''
        for (const l of words.slice(0, 120)) {
          const text = textScript(project, lang, sc, l.lemma).trim()
          // 转写不出来的（没给这些字母配字形）会原样返回，跟拼写一样就不算
          if (!text || text === l.lemma) continue
          if ([...text].length > [...best].length) best = text
          if ([...best].length >= ART_MAX) break
        }
        if (!best) continue
        ensureScriptFont(sc)
        return {
          text: [...best].slice(0, ART_MAX).join(''),
          css: fontCss(sc),
          vertical: sc.direction === 'ttb',
          rtl: sc.direction === 'rtl'
        }
      }
    }
    return undefined
  }

  /** 光跟着指针走：把指针在卡片里的位置写成 CSS 变量 */
  function shine(e: PointerEvent): void {
    const el = e.currentTarget as HTMLElement
    const r = el.getBoundingClientRect()
    el.style.setProperty('--mx', `${((e.clientX - r.left) / r.width) * 100}%`)
    el.style.setProperty('--my', `${((e.clientY - r.top) / r.height) * 100}%`)
  }
</script>

{#if cards.length}
  <div class="cards">
    {#each cards as c (c.entry.path ?? c.entry.name)}
      <button
        class="proj card pick"
        onpointermove={shine}
        onclick={() => onopen(c.entry)}
        title={c.entry.path ?? c.name}
      >
        <span class="shine" aria-hidden="true"></span>
        <span class="text">
          <span class="pname">{c.name}</span>
          <span class="pauthor small muted">{c.author || t('welcome.noAuthor')}</span>
        </span>
        {#if c.art}
          <span
            class="art"
            class:vertical={c.art.vertical}
            class:rtl={c.art.rtl}
            style={c.art.css}
            aria-hidden="true">{c.art.text}</span
          >
        {:else}
          <span class="art plain" aria-hidden="true"><Clock size={18} /></span>
        {/if}
      </button>
    {/each}
  </div>
{/if}

<style>
  .cards {
    display: grid;
    /* 一排四个，最多两排（MAX = 8） */
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 10px;
  }
  @media (max-width: 1100px) {
    .cards {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  .proj {
    position: relative;
    overflow: hidden;
    display: flex;
    align-items: flex-start;
    gap: 8px;
    min-height: 116px;
    padding: 12px 14px;
    text-align: start;
    cursor: pointer;
    background: var(--bg-elev);
  }
  .text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    z-index: 1;
  }
  .pname {
    font-family: var(--font-data);
    font-size: 16px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pauthor {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* 落款：这个项目自己的文字，压在右下角，太长的一头淡出去 */
  .art {
    position: absolute;
    right: 12px;
    bottom: 8px;
    max-width: 72%;
    font-size: 34px;
    line-height: 1.1;
    color: var(--text-2);
    opacity: 0.5;
    white-space: nowrap;
    overflow: hidden;
    pointer-events: none;
    -webkit-mask-image: linear-gradient(to left, transparent 0, #000 22%);
    mask-image: linear-gradient(to left, transparent 0, #000 22%);
  }
  /* 从右往左写的：淡出那头也反过来 */
  .art.rtl {
    -webkit-mask-image: linear-gradient(to right, transparent 0, #000 22%);
    mask-image: linear-gradient(to right, transparent 0, #000 22%);
  }
  /* 竖排：往下淡出，高度顶到卡片上边 */
  .art.vertical {
    writing-mode: vertical-rl;
    top: 10px;
    bottom: 8px;
    max-width: none;
    max-height: none;
    -webkit-mask-image: linear-gradient(to top, transparent 0, #000 22%);
    mask-image: linear-gradient(to top, transparent 0, #000 22%);
  }
  .art.plain {
    opacity: 0.25;
  }
  /* 跟着指针走的那层光 */
  .shine {
    position: absolute;
    inset: 0;
    opacity: 0;
    transition: opacity 0.18s;
    background: radial-gradient(
      240px circle at var(--mx, 50%) var(--my, 50%),
      color-mix(in srgb, var(--accent) 22%, transparent),
      transparent 70%
    );
  }
  .proj:hover .shine,
  .proj:focus-visible .shine {
    opacity: 1;
  }
  @media (prefers-reduced-motion: reduce) {
    .shine {
      transition: none;
    }
  }
</style>
