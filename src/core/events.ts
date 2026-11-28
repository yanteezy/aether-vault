/**
 * Event emitter with the same public shape as `Events` in obsidian.d.ts:
 * on / off / offref / trigger / tryTrigger, and an opaque `EventRef`.
 */

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface EventRef {}

type Callback = (...data: any[]) => unknown

interface Listener extends EventRef {
  /** the emitter, as in Obsidian: `Component.registerEvent` uses it to unsubscribe */
  e: Events
  name: string
  fn: Callback
  ctx?: unknown
}

export class Events {
  private listeners = new Map<string, Listener[]>()

  on(name: string, callback: Callback, ctx?: any): EventRef {
    const ref: Listener = { e: this, name, fn: callback, ctx }
    const list = this.listeners.get(name)
    if (list) list.push(ref)
    else this.listeners.set(name, [ref])
    return ref
  }

  off(name: string, callback: Callback): void {
    const list = this.listeners.get(name)
    if (list) this.listeners.set(name, list.filter((l) => l.fn !== callback))
  }

  offref(ref: EventRef): void {
    const { name } = ref as Listener
    const list = this.listeners.get(name)
    if (list) this.listeners.set(name, list.filter((l) => l !== ref))
  }

  trigger(name: string, ...data: unknown[]): void {
    // a copy: listeners may unsubscribe while we loop
    for (const ref of [...(this.listeners.get(name) ?? [])]) this.tryTrigger(ref, data)
  }

  /** One failing listener (a buggy plugin) must not stop the others. */
  tryTrigger(evt: EventRef, args: unknown[]): void {
    const { fn, ctx } = evt as Listener
    try {
      fn.apply(ctx, args)
    } catch (e) {
      console.error(e)
    }
  }
}
