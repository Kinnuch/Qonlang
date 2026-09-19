<script lang="ts">
  /**
   * 插件注册的面板：给插件一个 DOM 节点自己画。
   * 页面、当前语言、选中的词条变了就重画一遍（插件的 render 可以返回一个收尾函数）。
   */
  import { projectState } from '$lib/state/project.svelte'
  import { ui } from '$lib/state/ui.svelte'
  import { pluginRegistry } from './registry.svelte'
  import type { PluginView, PluginViewContext } from './types'

  let { where = 'inspector', pageId = '' }: { where?: 'inspector' | 'page'; pageId?: string } =
    $props()

  const views = $derived(
    pluginRegistry.views
      .map((v) => v.item)
      .filter((v) => (v.where ?? 'inspector') === where)
      .filter((v) =>
        where === 'page' ? v.id === pageId : !v.sections || v.sections.includes(ui.section)
      )
  )

  const ctx = $derived<PluginViewContext>({
    project: projectState.project,
    languageId: projectState.currentLanguageId,
    section: ui.section,
    lexeme:
      projectState.project?.lexemes.find(
        (l) => l.id === ui.memo<{ lexemeId?: string }>('lexicon').lexemeId
      ) ?? null
  })

  interface MountArg {
    view: PluginView
    ctx: PluginViewContext
  }
  /** 一块面板：节点挂上去后交给插件画，上下文变了就重画 */
  function mount(
    el: HTMLElement,
    arg: MountArg
  ): { update: (a: MountArg) => void; destroy: () => void } {
    let dispose: (() => void) | void
    const draw = (a: MountArg): void => {
      try {
        dispose?.()
        el.replaceChildren()
        dispose = a.view.render(el, a.ctx)
      } catch (e) {
        el.textContent = String((e as Error).message)
      }
    }
    draw(arg)
    return {
      update: draw,
      destroy() {
        try {
          dispose?.()
        } catch {
          // 插件自己的收尾出错不影响别处
        }
      }
    }
  }
</script>

{#each views as v (v.id)}
  <section class="plugin-view">
    {#if where === 'inspector'}<h4>{v.title}</h4>{/if}
    <div use:mount={{ view: v, ctx }}></div>
  </section>
{/each}

<style>
  .plugin-view {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .plugin-view h4 {
    margin: 0;
    font-size: 13px;
    color: var(--text-3);
  }
</style>
