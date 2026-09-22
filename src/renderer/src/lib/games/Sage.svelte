<script lang="ts">
  /**
   * Sage（拼词，照 elfdict 的玩法）：上面列几条释义，下面一堆字母——
   * 这些字母正好能拼出那几个词。点字母组词，点已选的撤回；拼对了就填掉那一条。
   */
  import type { Language, Project } from '$lib/core/model'
  import { t } from '$lib/i18n/index.svelte'
  import { gameWords, makeRandom, todaySeed } from './words'
  import { splitLetters } from './letters'
  import { makeSageRound, submitSage, sageDone, type SageRound } from './sage'
  import { RotateCcw, Eraser, Lightbulb } from '@lucide/svelte'

  let { project, language, units }: { project: Project; language: Language; units: string[] } =
    $props()

  let count = $state(4)
  /** 每天一局；点「再来一局」就 bump 换一局 */
  let bump = $state(0)
  const seed = $derived((todaySeed('sage' + language.id) + bump * 7919) >>> 0)
  let chosen = $state<number[]>([])
  let wrong = $state(false)
  let revealed = $state<number[]>([])

  const pool = $derived(
    gameWords(project, language.id, { singleWord: true, minLen: 3, maxLen: 8 }, (w) =>
      splitLetters(w, units)
    )
  )
  /** 一局（种子变了就重开一局）；答案的 done 会被改，所以用 $state.raw 包一层 */
  let round = $state.raw<SageRound | null>(null)
  $effect(() => {
    const n = count
    const s = seed
    round = pool.length >= n ? makeSageRound(pool, units, n, makeRandom(s)) : null
    chosen = []
    revealed = []
  })

  const letters = $derived(chosen.map((i) => round?.pool[i]?.letter ?? '').join(''))

  function tap(i: number): void {
    if (!round || round.pool[i].usedBy !== null) return
    wrong = false
    chosen = chosen.includes(i) ? chosen.filter((x) => x !== i) : [...chosen, i]
  }
  function submit(): void {
    if (!round || !chosen.length) return
    const at = submitSage(round, chosen)
    round = { ...round }
    if (at < 0) {
      wrong = true
      return
    }
    chosen = []
  }
  function reveal(at: number): void {
    if (!revealed.includes(at)) revealed = [...revealed, at]
  }
  function restart(): void {
    bump++
  }
</script>

{#if !round}
  <p class="muted">{t('games.sage.noWords', { n: count })}</p>
{:else}
  <div class="row bar">
    <span class="small muted">{t('games.sage.count')}</span>
    {#each [3, 4, 5, 6] as n (n)}
      <button class="btn sm" class:primary={n === count} onclick={() => (count = n)}>{n}</button>
    {/each}
    <span class="grow"></span>
    <button class="btn ghost sm" onclick={restart}><RotateCcw size={13} />{t('games.again')}</button
    >
  </div>

  <ol class="answers">
    {#each round.answers as a, i (a.word)}
      <li class:done={a.done}>
        <span class="gloss">{a.gloss}</span>
        <span class="slots">
          {#if a.done}
            <b class="data">{a.word}</b>
          {:else if revealed.includes(i)}
            <b class="data muted">{a.word}</b>
          {:else}
            {#each a.letters as _, k (k)}<span class="slot"></span>{/each}
          {/if}
        </span>
        {#if !a.done && !revealed.includes(i)}
          <button class="btn ghost icon sm" title={t('games.sage.reveal')} onclick={() => reveal(i)}
            ><Lightbulb size={13} /></button
          >
        {/if}
      </li>
    {/each}
  </ol>

  <div class="draft row" class:wrong>
    <b class="data grow">{letters || t('games.sage.tapLetters')}</b>
    <button class="btn ghost sm" onclick={() => (chosen = [])}><Eraser size={13} /></button>
    <button class="btn primary sm" disabled={!chosen.length} onclick={submit}
      >{t('games.sage.check')}</button
    >
  </div>

  <div class="pool">
    {#each round.pool as p, i (i)}
      <button
        class="tile data"
        class:used={p.usedBy !== null}
        class:on={chosen.includes(i)}
        disabled={p.usedBy !== null}
        onclick={() => tap(i)}>{p.letter}</button
      >
    {/each}
  </div>

  {#if sageDone(round)}
    <p class="result ok">{t('games.sage.done')}</p>
  {/if}
{/if}

<style>
  .bar {
    gap: 6px;
  }
  .answers {
    margin: 0;
    padding-inline-start: 20px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .answers li {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .answers li.done .gloss {
    color: var(--text-3);
  }
  .gloss {
    min-width: 34%;
  }
  .slots {
    display: inline-flex;
    gap: 4px;
    align-items: center;
  }
  .slot {
    width: 18px;
    border-bottom: 2px solid var(--border-strong);
    height: 18px;
  }
  .draft {
    gap: 8px;
    padding: 8px 10px;
    border: 1px dashed var(--border-strong);
    border-radius: var(--radius);
    min-height: 40px;
    align-items: center;
  }
  .draft.wrong {
    border-color: var(--danger);
  }
  .draft b {
    font-size: 20px;
  }
  .pool {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    justify-content: center;
  }
  .tile {
    min-width: 38px;
    padding: 8px 10px;
    font-size: 18px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background: var(--bg-elev);
    cursor: pointer;
  }
  .tile.on {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-contrast, #fff);
  }
  .tile.used {
    opacity: 0.25;
    cursor: default;
  }
  .result.ok {
    text-align: center;
    color: var(--accent-text);
  }
</style>
