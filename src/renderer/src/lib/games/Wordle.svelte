<script lang="ts">
  /** 猜词：用这门语言的字母表出题判分；th 这类多字母的字母算一格 */
  import type { Language, Project } from '$lib/core/model'
  import { t } from '$lib/i18n/index.svelte'
  import { gameWords, makeRandom, shuffle, todaySeed } from './words'
  import { splitLetters } from './letters'
  import { judgeGuess, keyboardMarks, isWin, type LetterMark } from './wordle'
  import { Delete, CornerDownLeft, RotateCcw } from '@lucide/svelte'

  let { project, language, units }: { project: Project; language: Language; units: string[] } =
    $props()

  const TRIES = 6
  let len = $state(5)
  /** 每天一局；点「再来一局」就 bump 换一局 */
  let bump = $state(0)
  const seed = $derived((todaySeed(language.id) + bump * 7919) >>> 0)
  let guesses = $state<string[][]>([])
  let draft = $state<string[]>([])

  const pool = $derived(
    gameWords(project, language.id, { singleWord: true, minLen: len, maxLen: len }, (w) =>
      splitLetters(w, units)
    )
  )
  const pick = $derived(shuffle(pool, makeRandom(seed))[0] ?? null)
  const answer = $derived(pick ? splitLetters(pick.word, units) : [])
  const rows = $derived(
    guesses.map((g) => ({ letters: g, marks: judgeGuess(answer, g) as LetterMark[] }))
  )
  const kb = $derived(keyboardMarks(rows))
  const won = $derived(rows.some((r) => isWin(r.marks)))
  const lost = $derived(!won && guesses.length >= TRIES)
  /** 键盘：字母表里的字母，没写字母表就用词库里出现过的 */
  const keys = $derived(
    units.length
      ? units.slice().sort((a, b) => a.localeCompare(b))
      : [...new Set(pool.flatMap((w) => splitLetters(w.word, units)))].sort()
  )

  function tap(l: string): void {
    if (won || lost || draft.length >= answer.length) return
    draft = [...draft, l]
  }
  function del(): void {
    draft = draft.slice(0, -1)
  }
  function submit(): void {
    if (won || lost || draft.length !== answer.length) return
    guesses = [...guesses, draft]
    draft = []
  }
  function restart(): void {
    bump++
    guesses = []
    draft = []
  }
  function setLen(n: number): void {
    len = n
    restart()
  }
</script>

{#if !pool.length}
  <p class="muted">{t('games.wordle.noWords', { n: len })}</p>
  <div class="row lens">
    {#each [3, 4, 5, 6, 7] as n (n)}
      <button class="btn sm" class:primary={n === len} onclick={() => setLen(n)}>{n}</button>
    {/each}
  </div>
{:else}
  <div class="row bar">
    <span class="small muted">{t('games.wordle.len')}</span>
    {#each [3, 4, 5, 6, 7] as n (n)}
      <button class="btn sm" class:primary={n === len} onclick={() => setLen(n)}>{n}</button>
    {/each}
    <span class="grow"></span>
    <button class="btn ghost sm" onclick={restart}><RotateCcw size={13} />{t('games.again')}</button
    >
  </div>

  <div class="grid" style:--cols={answer.length}>
    {#each Array(TRIES) as _, r (r)}
      {@const row = rows[r]}
      {#each Array(answer.length) as _, c (c)}
        <div
          class="cell data"
          class:hit={row?.marks[c] === 'hit'}
          class:near={row?.marks[c] === 'near'}
          class:miss={row?.marks[c] === 'miss'}
        >
          {row ? row.letters[c] : r === guesses.length ? (draft[c] ?? '') : ''}
        </div>
      {/each}
    {/each}
  </div>

  {#if won}
    <p class="result ok">
      {t('games.wordle.won', { n: guesses.length })} · <b class="data">{pick?.word}</b>
      {pick?.gloss}
    </p>
  {:else if lost}
    <p class="result">{t('games.wordle.lost')} <b class="data">{pick?.word}</b> {pick?.gloss}</p>
  {/if}

  <div class="keys">
    {#each keys as k (k)}
      <button
        class="key data"
        class:hit={kb.get(k.toLocaleLowerCase()) === 'hit'}
        class:near={kb.get(k.toLocaleLowerCase()) === 'near'}
        class:miss={kb.get(k.toLocaleLowerCase()) === 'miss'}
        onclick={() => tap(k)}>{k}</button
      >
    {/each}
    <button class="key wide" onclick={del}><Delete size={14} /></button>
    <button class="key wide" onclick={submit}><CornerDownLeft size={14} /></button>
  </div>
{/if}

<style>
  .bar,
  .lens {
    gap: 6px;
    align-items: center;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(var(--cols), 46px);
    gap: 6px;
    justify-content: center;
    margin: 8px 0;
  }
  .cell {
    height: 46px;
    display: grid;
    place-items: center;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    font-size: 20px;
  }
  .cell.hit {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-contrast, #fff);
  }
  .cell.near {
    background: var(--warn);
    border-color: var(--warn);
    color: #fff;
  }
  .cell.miss {
    background: var(--bg-sunken);
    color: var(--text-3);
  }
  .keys {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    justify-content: center;
  }
  .key {
    min-width: 34px;
    padding: 7px 9px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-elev);
    cursor: pointer;
  }
  .key.wide {
    min-width: 52px;
  }
  .key.hit {
    background: var(--accent);
    color: var(--accent-contrast, #fff);
  }
  .key.near {
    background: var(--warn);
    color: #fff;
  }
  .key.miss {
    opacity: 0.45;
  }
  .result {
    text-align: center;
    margin: 4px 0;
  }
  .result.ok {
    color: var(--accent-text);
  }
</style>
