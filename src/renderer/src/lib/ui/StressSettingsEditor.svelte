<script lang="ts">
  /**
   * 词条、语素的「对重音影响」：勾上才出现两个小勾——传递词性、传递特殊重音（附带落在第几个音节）。
   * 语素没有词类，传递词性时另外可以选「算作」哪个词类。
   */
  import { t } from '$lib/i18n/index.svelte'
  import type { Id, StressSettings } from '$lib/core/model'
  import { defaultStressSettings } from '$lib/core/stressInfo'
  import HelpDot from './HelpDot.svelte'

  let {
    value,
    onchange,
    posChoices = null
  }: {
    value: StressSettings | undefined
    onchange: (next: StressSettings) => void
    /** 语素用：「算作」可选的词类；词条不传 */
    posChoices?: { id: Id; label: string }[] | null
  } = $props()

  const set = (patch: Partial<StressSettings>): void =>
    onchange({ ...(value ?? defaultStressSettings()), ...patch })
  type Mode = 'front' | 'back' | 'none'
  const mode = $derived<Mode>(
    !value || value.special > 0 ? 'front' : value.special < 0 ? 'back' : 'none'
  )
  const num = $derived(Math.abs(value?.special ?? 1) || 1)
  const checked = (e: Event): boolean => (e.currentTarget as HTMLInputElement).checked
</script>

<div class="field stress-settings">
  <label class="row check"
    ><input
      type="checkbox"
      checked={!!value?.affects}
      onchange={(e) => set({ affects: checked(e) })}
    />{t('stressSettings.affects')}<HelpDot
      tip={t(posChoices ? 'stressSettings.morphemeHint' : 'stressSettings.hint')}
    /></label
  >
  {#if value?.affects}
    <div class="sub">
      <label class="row check"
        ><input
          type="checkbox"
          checked={value.passPos}
          onchange={(e) => set({ passPos: checked(e) })}
        />{t('stressSettings.passPos')}</label
      >
      {#if value.passPos && posChoices}
        <label class="row small indent"
          >{t('stressSettings.countAs')}
          <select
            class="select tiny"
            value={value.posId ?? ''}
            onchange={(e) => set({ posId: (e.currentTarget as HTMLSelectElement).value || null })}
          >
            <option value="">{t('stressSettings.typeOnly')}</option>
            {#each posChoices as p (p.id)}<option value={p.id}>{p.label}</option>{/each}
          </select></label
        >
      {/if}
      <label class="row check"
        ><input
          type="checkbox"
          checked={value.passSpecial}
          onchange={(e) => set({ passSpecial: checked(e) })}
        />{t('stressSettings.passSpecial')}</label
      >
      {#if value.passSpecial}
        <div class="row small indent">
          <select
            class="select tiny"
            value={mode}
            onchange={(e) => {
              const m = (e.currentTarget as HTMLSelectElement).value as Mode
              set({ special: m === 'none' ? 0 : m === 'back' ? -num : num })
            }}
          >
            <option value="front">{t('stressRule.posFront')}</option>
            <option value="back">{t('stressRule.posBack')}</option>
            <option value="none">{t('stressRule.posNone')}</option>
          </select>
          {#if mode !== 'none'}
            <input
              class="input num"
              type="number"
              min="1"
              value={num}
              oninput={(e) => {
                const n = Math.max(1, Number((e.currentTarget as HTMLInputElement).value) || 1)
                set({ special: mode === 'back' ? -n : n })
              }}
            /><span class="muted">{t('stressRule.syllable')}</span>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .check {
    gap: 6px;
  }
  .sub {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding-left: 22px;
  }
  .indent {
    gap: 6px;
    padding-left: 22px;
  }
  .select.tiny {
    width: auto;
    field-sizing: content;
    padding-top: 2px;
    padding-bottom: 2px;
  }
  .num {
    width: 60px;
    padding-top: 2px;
    padding-bottom: 2px;
  }
</style>
