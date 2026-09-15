<script lang="ts">
  /** 带重音记号的词形：ˈ ˌ 单独上色，测试台里一眼看得出重音落在哪 */
  let { text }: { text: string } = $props()
  const parts = $derived(text.split(/([ˈˌ])/))
</script>

{#each parts as p, i (i)}{#if p === 'ˈ' || p === 'ˌ'}<b class="stress" class:secondary={p === 'ˌ'}
      >{p}</b
    >{:else}{p}{/if}{/each}

<style>
  .stress {
    color: #c2410c;
    font-weight: 800;
  }
  .stress.secondary {
    opacity: 0.65;
  }
  :global([data-theme='dark']) .stress {
    color: #fdba74;
  }
</style>
