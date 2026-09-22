<script lang="ts">
  /** 词类与语法维度：全部是项目数据，软件不预设任何一个 */
  import { projectState } from '$lib/state/project.svelte'
  import SectionHead from '$lib/ui/SectionHead.svelte'
  import {
    forgetSection,
    sectionCollapsed,
    setSectionsCollapsed,
    toggleSection
  } from '$lib/ui/section.svelte'
  import { lazy, lazyMore } from '$lib/ui/lazy.svelte'
  import { ui } from '$lib/state/ui.svelte'
  import { t, pickText } from '$lib/i18n/index.svelte'
  import { createCustomField, newId } from '$lib/core/factory'
  import {
    CUSTOM_FIELD_KINDS,
    CUSTOM_FIELD_POSITIONS,
    type CustomField,
    type GrammaticalCategory,
    type Id,
    type PartOfSpeech
  } from '$lib/core/model'
  import { customFieldTitle } from '$lib/core/customFields'
  import { compoundLabels, isCompoundPos, ownParadigmIds } from '$lib/core/pos'
  import LocalizedInput from '$lib/ui/LocalizedInput.svelte'
  import TagInput from '$lib/ui/TagInput.svelte'
  import HelpDot from '$lib/ui/HelpDot.svelte'
  import { sortable } from '$lib/ui/sortable.svelte'
  import {
    followSlotLabels,
    followStemRename,
    slotLabels,
    type SlotLabels
  } from '$lib/core/relabel'
  import { moveItem } from '$lib/core/move'
  import {
    Plus,
    Trash2,
    X,
    ChevronUp,
    ChevronDown,
    ChevronRight,
    ChevronsDownUp,
    ChevronsUpDown,
    ArrowDownAZ
  } from '@lucide/svelte'

  const project = $derived(projectState.project!)
  const glossLangs = $derived(project.settings.glossLanguages)

  /** 用这个词类的词条：词条本身是它，或者有义项单独选了它 */
  function posUse(p: PartOfSpeech): number {
    return project.lexemes.filter((l) => l.posId === p.id || l.senses.some((s) => s.posId === p.id))
      .length
  }
  /**
   * 改名跟着走：词干槽、维度取值改名时，词库里按旧名存的词干、屈折形挪到新名下。
   * 输入框聚焦时记下改之前的样子，改完（失焦或回车）再比。
   */
  let stemNameBefore = ''
  function followStem(p: PartOfSpeech, name: string): void {
    const n = followStemRename(project, p.id, stemNameBefore, name)
    stemNameBefore = name
    if (!n) return
    projectState.touch()
    ui.toast(t('taxonomy.followedStems', { n }))
  }
  let labelsBefore: SlotLabels | null = null
  function rememberLabels(): void {
    labelsBefore = slotLabels(project)
  }
  function followLabels(): void {
    if (!labelsBefore) return
    const n = followSlotLabels(project, labelsBefore)
    labelsBefore = slotLabels(project)
    if (!n) return
    projectState.touch()
    ui.toast(t('taxonomy.followedForms', { n }))
  }
  /** 复合词类的组成：名字、缩写还空着或者是按组成拼出来的，就跟着一起更新 */
  function setComponents(p: PartOfSpeech, ids: Id[]): void {
    const labelsOf = (list: Id[]): ReturnType<typeof compoundLabels> | null => {
      const parts = list
        .map((id) => project.posList.find((x) => x.id === id))
        .filter((x): x is PartOfSpeech => !!x)
      return parts.length > 1 ? compoundLabels(parts) : null
    }
    const filled = (name: Record<string, string>): string =>
      JSON.stringify(Object.entries(name).filter(([, v]) => v?.trim()))
    const before = labelsOf(p.components ?? [])
    const after = labelsOf(ids)
    const autoName =
      !Object.values(p.name).some((v) => v?.trim()) ||
      (!!before && filled(p.name) === filled(before.name))
    const autoAbbr = !p.abbr.trim() || (!!before && p.abbr === before.abbr)
    p.components = ids
    if (after) {
      if (autoName) p.name = after.name
      if (autoAbbr) p.abbr = after.abbr
    }
    projectState.touch()
  }
  function catUse(c: GrammaticalCategory): number {
    return (
      project.lexemes.filter((l) => c.id in l.features).length +
      project.morphemes.filter((m) => c.id in m.features).length
    )
  }

  function addPos(): void {
    project.posList.push({ id: newId(), name: {}, abbr: '', paradigmId: null })
    projectState.touch()
  }
  function removePos(p: PartOfSpeech): void {
    const idx = project.posList.indexOf(p)
    const snap = $state.snapshot(p) as PartOfSpeech
    project.posList.splice(idx, 1)
    forgetSection(`tx.pos:${p.id}`)
    projectState.touch()
    ui.toast(t('taxonomy.deletedPos', { name: pickText(snap.name, glossLangs) }), {
      action: {
        label: t('common.undo'),
        run: () => {
          project.posList.splice(Math.min(idx, project.posList.length), 0, snap)
          projectState.touch()
        }
      }
    })
  }
  function addCategory(): void {
    project.categories.push({ id: newId(), name: {}, values: [] })
    projectState.touch()
  }
  function removeCategory(c: GrammaticalCategory): void {
    const idx = project.categories.indexOf(c)
    const snap = $state.snapshot(c) as GrammaticalCategory
    project.categories.splice(idx, 1)
    forgetSection(`tx.cat:${c.id}`)
    projectState.touch()
    ui.toast(t('taxonomy.deletedCategory', { name: pickText(snap.name, glossLangs) }), {
      action: {
        label: t('common.undo'),
        run: () => {
          project.categories.splice(Math.min(idx, project.categories.length), 0, snap)
          projectState.touch()
        }
      }
    })
  }
  function moveIn<T>(arr: T[], item: T, dir: -1 | 1): void {
    const i = arr.indexOf(item)
    const j = i + dir
    if (i < 0 || j < 0 || j >= arr.length) return
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
    projectState.touch()
  }
  // 分批渲染：词类、维度多的时候不要一次全画
  const lzPos = lazy(40)
  const lzCat = lazy(40)
  const posLabel = (id: Id): string => {
    const p = project.posList.find((x) => x.id === id)
    return p ? pickText(p.name, glossLangs) || p.abbr : '?'
  }

  // ───── 每一条可以单独收起：收起后只剩一行（名字 + 几个要点），加的多了不用一直往下翻 ─────
  const sep = (): string => t('taxonomy.listSep')
  function posSummary(p: PartOfSpeech): string {
    const bits: string[] = []
    const paras = ownParadigmIds(p)
      .map((id) => pickText(project.paradigms.find((x) => x.id === id)?.name ?? {}, glossLangs))
      .filter(Boolean)
    if (paras.length) bits.push(t('taxonomy.foldParadigms', { list: paras.join(sep()) }))
    const slots = (p.stemSlots ?? []).map((st) => st.name.trim()).filter(Boolean)
    if (slots.length) bits.push(t('taxonomy.foldStems', { list: slots.join(sep()) }))
    if ((p.components ?? []).length > 1)
      bits.push(t('taxonomy.foldParts', { list: (p.components ?? []).map(posLabel).join(' + ') }))
    return bits.join(' · ')
  }
  function catSummary(c: GrammaticalCategory): string {
    const names = c.values.map((v) => pickText(v.name, glossLangs) || v.abbr).filter(Boolean)
    const shown = names.length > 8 ? [...names.slice(0, 8), '…'] : names
    const bits = [shown.length ? shown.join(sep()) : t('taxonomy.noValues')]
    if (c.posIds?.length)
      bits.push(t('taxonomy.foldScope', { list: c.posIds.map(posLabel).join(sep()) }))
    return bits.join(' · ')
  }
  const fieldSummary = (f: CustomField): string =>
    `${t(`taxonomy.customKinds.${f.kind}`)} · ${t(`taxonomy.customPositions.${f.position}`)}`
  /** 这一块的条目全都收着吗 */
  const allFolded = (ids: string[]): boolean => ids.every((id) => sectionCollapsed(id))

  // ───── 检视器模块 ─────
  function customUse(f: CustomField): number {
    return project.lexemes.filter((l) => !!l.custom?.[f.id]?.trim()).length
  }
  function addCustomField(): void {
    project.customFields.push(createCustomField())
    projectState.touch()
  }
  /** 删模块连同各词条里填的内容一起删；撤销时都放回去 */
  function removeCustomField(f: CustomField): void {
    const idx = project.customFields.indexOf(f)
    const snap = $state.snapshot(f) as CustomField
    const filled = project.lexemes.flatMap((l) =>
      l.custom && f.id in l.custom ? [[l.id, l.custom[f.id]] as const] : []
    )
    project.customFields.splice(idx, 1)
    forgetSection(`tx.field:${f.id}`)
    for (const l of project.lexemes)
      if (l.custom && f.id in l.custom) {
        delete l.custom[f.id]
        if (!Object.keys(l.custom).length) delete l.custom
      }
    projectState.touch()
    ui.toast(t('taxonomy.deletedCustomField', { name: customFieldTitle(snap, glossLangs) }), {
      action: {
        label: t('common.undo'),
        run: () => {
          project.customFields.splice(Math.min(idx, project.customFields.length), 0, snap)
          for (const [id, v] of filled) {
            const l = project.lexemes.find((x) => x.id === id)
            if (l) l.custom = { ...l.custom, [snap.id]: v }
          }
          projectState.touch()
        }
      }
    })
  }
  /** 字体候选：项目里的每套文字，前面带上语言名 */
  const scriptChoices = $derived(
    project.languages.flatMap((lg) =>
      lg.scripts.map((sc) => ({ id: sc.id, label: `${lg.name} · ${sc.name}` }))
    )
  )

  function sortBy<T>(arr: T[], key: (x: T) => string): void {
    const sorted = [...arr].sort((a, b) =>
      key(a).localeCompare(key(b), undefined, { sensitivity: 'base' })
    )
    arr.splice(0, arr.length, ...sorted)
    projectState.touch()
  }
</script>

{#snippet foldBtn(id: string, folded: boolean)}
  <button
    class="fold-btn"
    title={folded ? t('common.expand') : t('common.collapse')}
    aria-expanded={!folded}
    onclick={() => toggleSection(id)}
    >{#if folded}<ChevronRight size={15} />{:else}<ChevronDown size={15} />{/if}</button
  >
{/snippet}

{#snippet foldAll(ids: string[])}
  {#if ids.length > 1}
    {@const all = allFolded(ids)}
    <button class="btn ghost sm" onclick={() => setSectionsCollapsed(ids, !all)}
      >{#if all}<ChevronsUpDown size={14} />{t('taxonomy.expandAll')}{:else}<ChevronsDownUp
          size={14}
        />{t('taxonomy.collapseAll')}{/if}</button
    >
  {/if}
{/snippet}

<div class="tax">
  <section>
    <SectionHead id="taxonomy.pos" title={t('taxonomy.pos')} count={String(project.posList.length)}>
      {@render foldAll(project.posList.map((p) => `tx.pos:${p.id}`))}
      <button
        class="btn ghost sm"
        onclick={() => sortBy(project.posList, (p) => pickText(p.name, glossLangs) || p.abbr)}
        ><ArrowDownAZ size={14} />{t('taxonomy.sortAZ')}</button
      >
      <button class="btn sm" onclick={addPos}><Plus size={14} />{t('taxonomy.addPos')}</button>
    </SectionHead>
    {#if !sectionCollapsed('taxonomy.pos')}
      {#each project.posList.slice(0, lzPos.shown) as p (p.id)}
        {@const fid = `tx.pos:${p.id}`}
        {@const folded = sectionCollapsed(fid)}
        <div class="card item" class:folded>
          {@render foldBtn(fid, folded)}
          {#if folded}
            <button class="fold-title grow" onclick={() => toggleSection(fid)}
              ><strong>{pickText(p.name, glossLangs) || t('taxonomy.untitled')}</strong
              >{#if p.abbr}<span class="mono muted">{p.abbr}</span>{/if}<span
                class="small muted sum">{posSummary(p)}</span
              ></button
            >
          {:else}
            <div class="grow">
              <LocalizedInput
                bind:value={p.name}
                languages={glossLangs}
                placeholder={t('taxonomy.posName')}
                onchange={() => projectState.touch()}
              />
            </div>
            <div class="field abbr">
              <label for={`pos-abbr-${p.id}`}>{t('taxonomy.abbr')}</label>
              <input
                id={`pos-abbr-${p.id}`}
                class="input mono"
                bind:value={p.abbr}
                oninput={() => projectState.touch()}
              />
            </div>
          {/if}
          <span class="small muted use">{t('taxonomy.inUse', { n: posUse(p) })}</span>
          <button
            class="btn ghost icon sm"
            title={t('lexicon.moveUp')}
            onclick={() => moveIn(project.posList, p, -1)}><ChevronUp size={14} /></button
          >
          <button
            class="btn ghost icon sm"
            title={t('lexicon.moveDown')}
            onclick={() => moveIn(project.posList, p, 1)}><ChevronDown size={14} /></button
          >
          <button
            class="btn ghost icon sm danger"
            title={t('common.delete')}
            onclick={() => removePos(p)}><Trash2 size={14} /></button
          >
          {#if !folded}
            <div class="stems">
              <span class="small muted">{t('taxonomy.stemSlots')}</span>
              <HelpDot tip={t('taxonomy.stemSlotsHint')} />
              {#each p.stemSlots ?? [] as st, si (si)}
                <span class="stem-slot">
                  <input
                    class="input data"
                    bind:value={st.name}
                    placeholder={t('taxonomy.stemName')}
                    onfocus={() => (stemNameBefore = st.name)}
                    oninput={() => projectState.touch()}
                    onchange={() => followStem(p, st.name)}
                  />
                  <input
                    class="input"
                    bind:value={st.notes}
                    placeholder={t('taxonomy.stemNotes')}
                    oninput={() => projectState.touch()}
                  />
                  <button
                    class="btn ghost icon sm"
                    title={t('common.delete')}
                    onclick={() => {
                      p.stemSlots?.splice(si, 1)
                      projectState.touch()
                    }}><X size={12} /></button
                  >
                </span>
              {/each}
              <button
                class="btn ghost sm"
                onclick={() => {
                  p.stemSlots = [...(p.stemSlots ?? []), { name: '', notes: '' }]
                  projectState.touch()
                }}><Plus size={12} />{t('taxonomy.addStemSlot')}</button
              >
            </div>
            <div class="stems">
              <span class="small muted">{t('taxonomy.components')}</span>
              <HelpDot tip={t('taxonomy.componentsHint')} />
              {#each p.components ?? [] as cid, ci (cid)}
                {@const c = project.posList.find((x) => x.id === cid)}
                <span
                  class="part-chip"
                  {...sortable(`components-${p.id}`, ci, (from, to) => {
                    const ids = [...(p.components ?? [])]
                    if (moveItem(ids, from, to)) setComponents(p, ids)
                  })}
                  >{c ? pickText(c.name, glossLangs) || c.abbr : '?'}<button
                    class="btn ghost icon sm"
                    title={t('common.delete')}
                    onclick={() =>
                      setComponents(
                        p,
                        (p.components ?? []).filter((x) => x !== cid)
                      )}><X size={12} /></button
                  ></span
                >
              {/each}
              <select
                class="select part-add"
                value=""
                onchange={(e) => {
                  const el = e.currentTarget as HTMLSelectElement
                  if (el.value) setComponents(p, [...(p.components ?? []), el.value])
                  el.value = ''
                }}
              >
                <option value="">{t('taxonomy.addComponent')}</option>
                {#each project.posList.filter((x) => x.id !== p.id && !isCompoundPos(x) && !(p.components ?? []).includes(x.id)) as x (x.id)}<option
                    value={x.id}>{pickText(x.name, glossLangs) || x.abbr}</option
                  >{/each}
              </select>
            </div>
          {/if}
        </div>
      {/each}
      {#if project.posList.length > lzPos.shown}<div use:lazyMore={lzPos}></div>{/if}
    {/if}
  </section>

  <section>
    <SectionHead
      id="taxonomy.categories"
      title={t('taxonomy.categories')}
      tip={t('taxonomy.categoriesHint')}
      count={String(project.categories.length)}
    >
      {@render foldAll(project.categories.map((c) => `tx.cat:${c.id}`))}
      <button
        class="btn ghost sm"
        onclick={() => sortBy(project.categories, (c) => pickText(c.name, glossLangs))}
        ><ArrowDownAZ size={14} />{t('taxonomy.sortAZ')}</button
      >
      <button class="btn sm" onclick={addCategory}
        ><Plus size={14} />{t('taxonomy.addCategory')}</button
      >
    </SectionHead>
    {#if !sectionCollapsed('taxonomy.categories')}
      {#each project.categories.slice(0, lzCat.shown) as c (c.id)}
        {@const fid = `tx.cat:${c.id}`}
        {@const folded = sectionCollapsed(fid)}
        <div class="card cat" class:folded>
          <div class="row">
            {@render foldBtn(fid, folded)}
            {#if folded}
              <button class="fold-title grow" onclick={() => toggleSection(fid)}
                ><strong>{pickText(c.name, glossLangs) || t('taxonomy.untitled')}</strong><span
                  class="small muted sum">{catSummary(c)}</span
                ></button
              >
            {:else}
              <div class="grow">
                <LocalizedInput
                  bind:value={c.name}
                  languages={glossLangs}
                  placeholder={t('taxonomy.categoryName')}
                  onchange={() => projectState.touch()}
                />
              </div>
            {/if}
            <span class="small muted use">{t('taxonomy.inUse', { n: catUse(c) })}</span>
            <button
              class="btn ghost icon sm"
              title={t('lexicon.moveUp')}
              onclick={() => moveIn(project.categories, c, -1)}><ChevronUp size={14} /></button
            >
            <button
              class="btn ghost icon sm"
              title={t('lexicon.moveDown')}
              onclick={() => moveIn(project.categories, c, 1)}><ChevronDown size={14} /></button
            >
            <button
              class="btn ghost sm"
              title={t('taxonomy.sortAZ')}
              onclick={() => sortBy(c.values, (v) => pickText(v.name, glossLangs) || v.abbr)}
              ><ArrowDownAZ size={14} /></button
            >
            <button
              class="btn ghost icon sm danger"
              title={t('common.delete')}
              onclick={() => removeCategory(c)}><Trash2 size={14} /></button
            >
          </div>
          {#if !folded}
            <div class="stems">
              <span class="small muted">{t('taxonomy.catPos')}</span>
              <HelpDot tip={t('taxonomy.catPosHint')} />
              {#if !c.posIds?.length}<span class="small">{t('taxonomy.catPosAll')}</span>{/if}
              {#each c.posIds ?? [] as pid, pi (pid)}
                <span
                  class="part-chip"
                  {...sortable(`catpos-${c.id}`, pi, (from, to) => {
                    if (c.posIds && moveItem(c.posIds, from, to)) projectState.touch()
                  })}
                  >{posLabel(pid)}<button
                    class="btn ghost icon sm"
                    title={t('common.delete')}
                    onclick={() => {
                      c.posIds = (c.posIds ?? []).filter((x) => x !== pid)
                      projectState.touch()
                    }}><X size={12} /></button
                  ></span
                >
              {/each}
              <select
                class="select part-add"
                value=""
                onchange={(e) => {
                  const el = e.currentTarget as HTMLSelectElement
                  if (el.value) {
                    c.posIds = [...(c.posIds ?? []), el.value]
                    projectState.touch()
                  }
                  el.value = ''
                }}
              >
                <option value="">{t('taxonomy.addPosScope')}</option>
                {#each project.posList.filter((x) => !(c.posIds ?? []).includes(x.id)) as x (x.id)}<option
                    value={x.id}>{pickText(x.name, glossLangs) || x.abbr}</option
                  >{/each}
              </select>
            </div>
            <div class="values">
              <span class="small muted">{t('taxonomy.values')}</span>
              {#each c.values as v, i (v.id)}
                <div class="row val">
                  {#each glossLangs as lg (lg)}
                    <input
                      class="input"
                      placeholder={`${t('taxonomy.valueName')} (${lg})`}
                      bind:value={v.name[lg]}
                      onfocus={rememberLabels}
                      oninput={() => projectState.touch()}
                      onchange={followLabels}
                    />
                  {/each}
                  <input
                    class="input mono abbr-in"
                    placeholder={t('taxonomy.valueAbbr')}
                    bind:value={v.abbr}
                    onfocus={rememberLabels}
                    oninput={() => projectState.touch()}
                    onchange={followLabels}
                  />
                  <button
                    class="btn ghost icon sm"
                    title={t('lexicon.moveUp')}
                    onclick={() => moveIn(c.values, v, -1)}><ChevronUp size={14} /></button
                  >
                  <button
                    class="btn ghost icon sm"
                    title={t('lexicon.moveDown')}
                    onclick={() => moveIn(c.values, v, 1)}><ChevronDown size={14} /></button
                  >
                  <button
                    class="btn ghost icon sm"
                    onclick={() => {
                      c.values.splice(i, 1)
                      projectState.touch()
                    }}><X size={14} /></button
                  >
                </div>
              {/each}
              <button
                class="btn ghost sm self-start"
                onclick={() => {
                  c.values.push({ id: newId(), name: {}, abbr: '' })
                  projectState.touch()
                }}><Plus size={14} />{t('taxonomy.addValue')}</button
              >
            </div>
          {/if}
        </div>
      {/each}
      {#if project.categories.length > lzCat.shown}<div use:lazyMore={lzCat}></div>{/if}
    {/if}
  </section>

  <section>
    <SectionHead
      id="taxonomy.customFields"
      title={t('taxonomy.customFields')}
      tip={t('taxonomy.customFieldsHint')}
      count={String(project.customFields.length)}
    >
      {@render foldAll(project.customFields.map((f) => `tx.field:${f.id}`))}
      <button class="btn sm" onclick={addCustomField}
        ><Plus size={14} />{t('taxonomy.addCustomField')}</button
      >
    </SectionHead>
    {#if !sectionCollapsed('taxonomy.customFields')}
      {#each project.customFields as f (f.id)}
        {@const fid = `tx.field:${f.id}`}
        {@const folded = sectionCollapsed(fid)}
        <div class="card item" class:folded>
          {@render foldBtn(fid, folded)}
          {#if folded}
            <button class="fold-title grow" onclick={() => toggleSection(fid)}
              ><strong>{customFieldTitle(f, glossLangs) || t('taxonomy.untitled')}</strong><span
                class="small muted sum">{fieldSummary(f)}</span
              ></button
            >
          {:else}
            <div class="grow">
              <LocalizedInput
                bind:value={f.name}
                languages={glossLangs}
                placeholder={t('taxonomy.customFieldName')}
                onchange={() => projectState.touch()}
              />
            </div>
            <div class="field pick">
              <label for={`cf-kind-${f.id}`}>{t('taxonomy.customKind')}</label>
              <select
                id={`cf-kind-${f.id}`}
                class="select"
                bind:value={f.kind}
                onchange={() => projectState.touch()}
              >
                {#each CUSTOM_FIELD_KINDS as k (k)}<option value={k}
                    >{t(`taxonomy.customKinds.${k}`)}</option
                  >{/each}
              </select>
            </div>
            <div class="field pick">
              <label for={`cf-pos-${f.id}`}>{t('taxonomy.customPosition')}</label>
              <select
                id={`cf-pos-${f.id}`}
                class="select"
                bind:value={f.position}
                onchange={() => projectState.touch()}
              >
                {#each CUSTOM_FIELD_POSITIONS as ps (ps)}<option value={ps}
                    >{t(`taxonomy.customPositions.${ps}`)}</option
                  >{/each}
              </select>
            </div>
          {/if}
          <span class="small muted use">{t('taxonomy.inUse', { n: customUse(f) })}</span>
          <button
            class="btn ghost icon sm"
            title={t('lexicon.moveUp')}
            onclick={() => moveIn(project.customFields, f, -1)}><ChevronUp size={14} /></button
          >
          <button
            class="btn ghost icon sm"
            title={t('lexicon.moveDown')}
            onclick={() => moveIn(project.customFields, f, 1)}><ChevronDown size={14} /></button
          >
          <button
            class="btn ghost icon sm danger"
            title={t('common.delete')}
            onclick={() => removeCustomField(f)}><Trash2 size={14} /></button
          >
          {#if !folded}
            <div class="stems">
              <span class="small muted">{t('taxonomy.customLanguages')}</span>
              {#if !f.languageIds.length}<span class="small"
                  >{t('taxonomy.customAllLanguages')}</span
                >{/if}
              {#each f.languageIds as lid, li (lid)}
                <span
                  class="part-chip"
                  {...sortable(`customlang-${f.id}`, li, (from, to) => {
                    if (moveItem(f.languageIds, from, to)) projectState.touch()
                  })}
                  >{project.languages.find((x) => x.id === lid)?.name ?? '?'}<button
                    class="btn ghost icon sm"
                    title={t('common.delete')}
                    onclick={() => {
                      f.languageIds = f.languageIds.filter((x) => x !== lid)
                      projectState.touch()
                    }}><X size={12} /></button
                  ></span
                >
              {/each}
              <select
                class="select part-add"
                value=""
                onchange={(e) => {
                  const el = e.currentTarget as HTMLSelectElement
                  if (el.value) {
                    f.languageIds = [...f.languageIds, el.value]
                    projectState.touch()
                  }
                  el.value = ''
                }}
              >
                <option value="">{t('taxonomy.addLanguage')}</option>
                {#each project.languages.filter((x) => !f.languageIds.includes(x.id)) as x (x.id)}<option
                    value={x.id}>{x.name}</option
                  >{/each}
              </select>
              <span class="small muted gap-left">{t('taxonomy.customScript')}</span>
              <select
                class="select part-add"
                value={f.scriptId ?? ''}
                onchange={(e) => {
                  f.scriptId = (e.currentTarget as HTMLSelectElement).value || null
                  projectState.touch()
                }}
              >
                <option value="">{t('taxonomy.customScriptNone')}</option>
                {#each scriptChoices as sc (sc.id)}<option value={sc.id}>{sc.label}</option>{/each}
              </select>
            </div>
            <div class="stems">
              <span class="small muted">{t('taxonomy.customAliases')}</span>
              <div class="grow">
                <TagInput
                  bind:tags={f.aliases}
                  placeholder={t('taxonomy.customAliasesPlaceholder')}
                  onchange={() => projectState.touch()}
                />
              </div>
            </div>
          {/if}
        </div>
      {/each}
    {/if}
  </section>
</div>

<style>
  /* 每一条前面的三角：跟板块标题的一样淡，点了收起 / 展开这一条 */
  .fold-btn {
    flex: none;
    border: 0;
    background: none;
    padding: 7px 0 0;
    color: var(--text-3);
    cursor: pointer;
  }
  .fold-btn:hover {
    color: var(--text);
  }
  .cat .row .fold-btn {
    padding-top: 0;
  }
  .fold-title {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
    border: 0;
    background: none;
    padding: 6px 0 0;
    color: inherit;
    font: inherit;
    text-align: start;
    cursor: pointer;
  }
  .cat .fold-title {
    padding-top: 0;
  }
  /* 名字和缩写不许被挤成竖排，挤的是后面那行小字 */
  .fold-title strong,
  .fold-title .mono {
    flex: none;
    white-space: nowrap;
  }
  .cat.folded .use {
    padding-top: 0;
  }
  .fold-title .sum {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .item.folded,
  .cat.folded {
    padding-top: 6px;
    padding-bottom: 6px;
  }
  .item.folded {
    align-items: center;
  }
  .item.folded .use,
  .item.folded .fold-btn,
  .item.folded .fold-title {
    padding-top: 0;
  }
  .stems {
    flex-basis: 100%;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding-top: 6px;
    border-top: 1px dashed var(--border);
  }
  .part-chip {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 0 2px 0 8px;
    border: 1px solid var(--border);
    border-radius: 999px;
    font-size: 12px;
  }
  .part-add {
    width: auto;
    padding-top: 2px;
    padding-bottom: 2px;
    font-size: 12px;
  }
  .stem-slot {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .stem-slot .input {
    width: 120px;
  }
  .stem-slot .input + .input {
    width: 200px;
  }
  .tax {
    display: flex;
    flex-direction: column;
    gap: 24px;
    max-width: var(--page-max, 900px);
  }
  .item {
    flex-wrap: wrap;
    display: flex;
    gap: 12px;
    align-items: flex-start;
    padding: 10px 12px;
    margin-bottom: 8px;
  }
  .abbr {
    width: 120px;
    margin: 0;
  }
  .use {
    white-space: nowrap;
    padding-top: 8px;
  }
  .cat {
    padding: 10px 12px;
    margin-bottom: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .values {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding-inline-start: 12px;
    border-inline-start: 2px solid var(--border);
  }
  .val {
    gap: 6px;
  }
  .abbr-in {
    width: 110px;
  }
  .mono {
    font-family: var(--font-mono);
  }
  .self-start {
    align-self: flex-start;
  }
  .pick {
    width: 150px;
    margin: 0;
  }
  .gap-left {
    margin-inline-start: 12px;
  }
</style>
