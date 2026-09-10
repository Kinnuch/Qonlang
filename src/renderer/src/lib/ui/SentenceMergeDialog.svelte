<script lang="ts">
  /**
   * 语料查重的确认框：列出相似但不完全一样的句子对，用户勾选要合并的。
   * 通过 ui.askMerge(pairs) 调用，返回勾选了的那些。
   */
  import { ui } from '$lib/state/ui.svelte'
  import { t, pickText } from '$lib/i18n/index.svelte'
  import { projectState } from '$lib/state/project.svelte'
  import type { DupPair } from '$lib/core/sentenceDedup'

  let picked = $state<Set<number>>(new Set())
  $effect(() => {
    if (ui.mergeReq) picked = new Set(ui.mergeReq.pairs.map((_, i) => i))
  })
  const glossLangs = $derived(projectState.project?.settings.glossLanguages ?? [])
  function toggle(i: number): void {
    const next = new Set(picked)
    if (next.has(i)) next.delete(i)
    else next.add(i)
    picked = next
  }
  function done(ok: boolean): void {
    const req = ui.mergeReq
    if (!req) return
    ui.mergeReq = null
    req.resolve(ok ? req.pairs.filter((_, i) => picked.has(i)) : [])
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault()
      done(false)
    }
  }
  const pct = (p: DupPair): string => `${Math.round(p.similarity * 100)}%`
</script>

<svelte:window onkeydown={ui.mergeReq ? onKey : undefined} />

{#if ui.mergeReq}
  <div class="backdrop" role="presentation" onclick={() => done(false)}></div>
  <div class="dlg card" role="dialog" aria-modal="true" aria-label={t('corpus.dedup.title')}>
    <div class="head">
      <strong>{t('corpus.dedup.title')}</strong>
      <p class="small muted">{t('corpus.dedup.hint', { n: ui.mergeReq.pairs.length })}</p>
    </div>
    <div class="list">
      {#each ui.mergeReq.pairs as p, i (p.drop.id)}
        <label class="pair" class:on={picked.has(i)}>
          <input type="checkbox" checked={picked.has(i)} onchange={() => toggle(i)} />
          <div class="grow">
            <div class="line">
              <span class="data">{p.keep.text}</span>
              <span class="small muted">{pickText(p.keep.translation, glossLangs)}</span>
              {#if p.keep.source}<span class="badge">{p.keep.source}</span>{/if}
            </div>
            <div class="line drop">
              <span class="data">{p.drop.text}</span>
              <span class="small muted">{pickText(p.drop.translation, glossLangs)}</span>
              {#if p.drop.source}<span class="badge">{p.drop.source}</span>{/if}
            </div>
          </div>
          <span class="sim small muted">{pct(p)}</span>
        </label>
      {/each}
    </div>
    <div class="row end">
      <button class="btn ghost sm" onclick={() => (picked = new Set())}
        >{t('table.selectNone')}</button
      >
      <button
        class="btn ghost sm"
        onclick={() => (picked = new Set(ui.mergeReq!.pairs.map((_, i) => i)))}
        >{t('table.selectAll')}</button
      >
      <span class="grow"></span>
      <button class="btn sm" onclick={() => done(false)}>{t('corpus.dedup.skipAll')}</button>
      <button class="btn primary sm" onclick={() => done(true)}
        >{t('corpus.dedup.mergeSelected', { n: picked.size })}</button
      >
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 90;
    background: rgba(0, 0, 0, 0.18);
  }
  .dlg {
    position: fixed;
    z-index: 91;
    left: 50%;
    top: 12vh;
    transform: translateX(-50%);
    width: min(720px, 94vw);
    max-height: 76vh;
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    box-shadow: var(--shadow-lg);
  }
  .head p {
    margin: 4px 0 0;
  }
  .list {
    flex: 1;
    min-height: 0;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .pair {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-elev);
    cursor: pointer;
  }
  .pair.on {
    border-color: var(--accent);
  }
  .pair input {
    margin-top: 3px;
  }
  .line {
    display: flex;
    gap: 8px;
    align-items: baseline;
    flex-wrap: wrap;
  }
  .line.drop {
    opacity: 0.75;
  }
  .line.drop .data {
    text-decoration: line-through;
    text-decoration-color: var(--text-3);
  }
  .sim {
    flex: none;
    align-self: center;
  }
  .end {
    gap: 8px;
  }
</style>
