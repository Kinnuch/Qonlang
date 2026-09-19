<script lang="ts">
  /** 填字：用词库排盘，提示是释义；可以导出成单文件 HTML（别人能玩）或 PNG（打印） */
  import type { Language, Project } from '$lib/core/model'
  import { t } from '$lib/i18n/index.svelte'
  import { platform } from '$lib/platform'
  import { gameWords, makeRandom, todaySeed } from './words'
  import { splitLetters } from './letters'
  import { buildCrossword, checkCrossword, type Crossword } from './crossword'
  import { crosswordHtml, crosswordPng, numberMap } from './crosswordExport'
  import { RotateCcw, Check, Eye, FileCode2, ImageDown } from '@lucide/svelte'

  let {
    project,
    language,
    units,
    onerror
  }: {
    project: Project
    language: Language
    units: string[]
    onerror?: (msg: string) => void
  } = $props()

  let count = $state(10)
  /** 每天一局；点「再来一局」就 bump 换一局 */
  let bump = $state(0)
  const seed = $derived((todaySeed('crossword' + language.id) + bump * 7919) >>> 0)
  let filled = $state<string[][]>([])
  let message = $state('')
  let busy = $state(false)

  const pool = $derived(
    gameWords(project, language.id, { singleWord: true, minLen: 3, maxLen: 12 }, (w) =>
      splitLetters(w, units)
    )
  )
  const cw = $derived<Crossword | null>(
    pool.length >= 4
      ? buildCrossword(pool, units, { size: 13, count, rand: makeRandom(seed) })
      : null
  )
  const nums = $derived(cw ? numberMap(cw) : new Map<string, number>())
  const across = $derived(
    cw?.placed.filter((p) => p.dir === 'across').sort((a, b) => a.num - b.num) ?? []
  )
  const down = $derived(
    cw?.placed.filter((p) => p.dir === 'down').sort((a, b) => a.num - b.num) ?? []
  )

  $effect(() => {
    const c = cw
    filled = c ? c.grid.map((row) => row.map(() => '')) : []
    message = ''
  })

  function check(): void {
    if (!cw) return
    message = checkCrossword(cw, filled)
      ? t('games.crossword.allRight')
      : t('games.crossword.notYet')
  }
  function reveal(): void {
    if (!cw) return
    filled = cw.grid.map((row) => row.map((c) => c ?? ''))
    message = ''
  }
  function restart(): void {
    bump++
  }
  const info = $derived({
    title: t('games.crossword.exportTitle', { lang: language.name }),
    language: language.name,
    project: project.meta.name
  })
  async function exportHtml(): Promise<void> {
    if (!cw || busy) return
    busy = true
    try {
      await platform.saveTextFile(`${language.name}-crossword.html`, crosswordHtml(cw, info))
    } catch (e) {
      onerror?.((e as Error).message)
    } finally {
      busy = false
    }
  }
  async function exportPng(): Promise<void> {
    if (!cw || busy) return
    busy = true
    try {
      const blob = await crosswordPng(cw, info)
      const buf = new Uint8Array(await blob.arrayBuffer())
      await platform.saveBinaryFile(`${language.name}-crossword.png`, buf)
    } catch (e) {
      onerror?.((e as Error).message)
    } finally {
      busy = false
    }
  }
</script>

{#if !cw || !cw.placed.length}
  <p class="muted">{t('games.crossword.noWords')}</p>
{:else}
  <div class="row bar">
    <span class="small muted">{t('games.crossword.count')}</span>
    {#each [6, 10, 14, 18] as n (n)}
      <button class="btn sm" class:primary={n === count} onclick={() => (count = n)}>{n}</button>
    {/each}
    <span class="small muted">{t('games.crossword.placed', { n: cw.placed.length })}</span>
    <span class="grow"></span>
    <button class="btn ghost sm" onclick={restart}><RotateCcw size={13} />{t('games.again')}</button
    >
  </div>

  <div class="play">
    <table class="grid">
      <tbody>
        {#each cw.grid as row, r (r)}
          <tr>
            {#each row as cell, c (c)}
              {#if cell}
                <td>
                  {#if nums.get(`${r},${c}`)}<span class="n">{nums.get(`${r},${c}`)}</span>{/if}
                  <input
                    class="data"
                    maxlength="2"
                    value={filled[r]?.[c] ?? ''}
                    oninput={(e) => {
                      filled[r][c] = (e.currentTarget as HTMLInputElement).value
                      message = ''
                    }}
                  />
                </td>
              {:else}
                <td class="blank"></td>
              {/if}
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>

    <div class="clues">
      <div>
        <h4>{t('games.crossword.across')}</h4>
        <ol>
          {#each across as p (p.num)}
            <li><b>{p.num}.</b> {p.gloss} <span class="tiny muted">({p.letters.length})</span></li>
          {/each}
        </ol>
      </div>
      <div>
        <h4>{t('games.crossword.down')}</h4>
        <ol>
          {#each down as p (p.num)}
            <li><b>{p.num}.</b> {p.gloss} <span class="tiny muted">({p.letters.length})</span></li>
          {/each}
        </ol>
      </div>
    </div>
  </div>

  <div class="row acts">
    <button class="btn primary sm" onclick={check}
      ><Check size={13} />{t('games.crossword.check')}</button
    >
    <button class="btn sm" onclick={reveal}><Eye size={13} />{t('games.crossword.reveal')}</button>
    <span class="grow"></span>
    <button class="btn sm" disabled={busy} onclick={exportHtml}
      ><FileCode2 size={13} />{t('games.crossword.exportHtml')}</button
    >
    <button class="btn sm" disabled={busy} onclick={exportPng}
      ><ImageDown size={13} />{t('games.crossword.exportPng')}</button
    >
  </div>
  {#if message}<p class="result">{message}</p>{/if}
{/if}

<style>
  .bar {
    gap: 6px;
    align-items: center;
  }
  .play {
    display: flex;
    gap: 22px;
    flex-wrap: wrap;
    align-items: flex-start;
  }
  .grid {
    border-collapse: collapse;
  }
  .grid td {
    width: 32px;
    height: 32px;
    border: 1px solid var(--border-strong);
    position: relative;
    padding: 0;
  }
  .grid td.blank {
    border: 0;
    background: transparent;
  }
  .n {
    position: absolute;
    top: 0;
    left: 2px;
    font-size: 9px;
    color: var(--text-3);
  }
  .grid input {
    width: 100%;
    height: 100%;
    border: 0;
    background: transparent;
    text-align: center;
    font-size: 16px;
    color: inherit;
  }
  .grid input:focus {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .clues {
    display: flex;
    gap: 20px;
    flex-wrap: wrap;
  }
  .clues h4 {
    margin: 0 0 4px;
    font-size: 13px;
    color: var(--text-3);
  }
  .clues ol {
    margin: 0;
    padding-left: 0;
    max-width: 260px;
    /* 题号自己写在每条前面，不要列表再编一遍号 */
    list-style: none;
  }
  .acts {
    gap: 8px;
  }
  .result {
    text-align: center;
    color: var(--accent-text);
  }
</style>
