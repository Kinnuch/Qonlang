/**
 * 插件注册表：插件 activate 时往这里登记扩展点，界面各处从这里读。
 * 一个插件注册的东西都记着它的 id，关掉 / 重载时整批撤掉。
 */
import type {
  PluginCommand,
  PluginExporter,
  PluginGenerator,
  PluginImporter,
  PluginView
} from './types'

interface Owned<T> {
  pluginId: string
  item: T
}

class PluginRegistry {
  views = $state<Owned<PluginView>[]>([])
  commands = $state<Owned<PluginCommand>[]>([])
  importers = $state<Owned<PluginImporter>[]>([])
  exporters = $state<Owned<PluginExporter>[]>([])
  generators = $state<Owned<PluginGenerator>[]>([])

  add<T extends { id: string }>(list: Owned<T>[], pluginId: string, item: T): Owned<T>[] {
    // 同一个插件重复注册同一个 id：后来的覆盖前面的（插件重载时用得上）
    return [
      ...list.filter((x) => !(x.pluginId === pluginId && x.item.id === item.id)),
      { pluginId, item }
    ]
  }

  addView(pluginId: string, v: PluginView): void {
    this.views = this.add(this.views, pluginId, v)
  }
  addCommand(pluginId: string, c: PluginCommand): void {
    this.commands = this.add(this.commands, pluginId, c)
  }
  addImporter(pluginId: string, i: PluginImporter): void {
    this.importers = this.add(this.importers, pluginId, i)
  }
  addExporter(pluginId: string, e: PluginExporter): void {
    this.exporters = this.add(this.exporters, pluginId, e)
  }
  addGenerator(pluginId: string, g: PluginGenerator): void {
    this.generators = this.add(this.generators, pluginId, g)
  }

  /** 关掉 / 重载一个插件：把它登记过的东西全撤掉 */
  removeAll(pluginId: string): void {
    const drop = <T>(list: Owned<T>[]): Owned<T>[] => list.filter((x) => x.pluginId !== pluginId)
    this.views = drop(this.views)
    this.commands = drop(this.commands)
    this.importers = drop(this.importers)
    this.exporters = drop(this.exporters)
    this.generators = drop(this.generators)
  }

  /** 某个扩展点上一共有几条（设置页里显示） */
  countsOf(pluginId: string): { views: number; commands: number; io: number; generators: number } {
    const n = <T>(list: Owned<T>[]): number => list.filter((x) => x.pluginId === pluginId).length
    return {
      views: n(this.views),
      commands: n(this.commands),
      io: n(this.importers) + n(this.exporters),
      generators: n(this.generators)
    }
  }
}

export const pluginRegistry = new PluginRegistry()

/** 生成器按 id 找（构形推导时用） */
export function pluginGenerator(id: string): PluginGenerator | null {
  return pluginRegistry.generators.find((g) => g.item.id === id)?.item ?? null
}
