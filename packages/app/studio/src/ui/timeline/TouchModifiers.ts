import {Terminable} from "@opendaw/lib-std"
import {Events} from "@opendaw/lib-dom"

// Phone fork: the region tools that the desktop studio reaches with the Shift, Ctrl and Alt keys.
// A touch screen has no keys, so the toolbar picks a tool and touch events inside the timeline then report the
// matching key as pressed. Nothing else in the studio has to know.
export type EditTool = "move" | "multi" | "split"

export namespace TouchModifiers {
    // multi: Shift (add to the selection), split: Alt (cut the region in two where it is tapped)
    const Keys: Record<EditTool, ReadonlyArray<string>> = {
        move: [],
        multi: ["shiftKey"],
        split: ["altKey"]
    }

    const observers = new Set<() => void>()
    let current: EditTool = "move"

    export const get = (): EditTool => current

    export const set = (tool: EditTool): void => {
        if (tool === current) {return}
        current = tool
        observers.forEach(observer => observer())
    }

    export const subscribe = (observer: () => void): Terminable => {
        observers.add(observer)
        return {terminate: () => {observers.delete(observer)}}
    }

    // Only events inside `scope` are touched, so buttons and menus elsewhere never see a phantom key.
    export const install = (view: Window, scope: HTMLElement): Terminable => {
        const patch = (event: PointerEvent): void => {
            if (event.pointerType !== "touch" || current === "move") {return}
            if (!(event.target instanceof Node) || !scope.contains(event.target)) {return}
            for (const key of Keys[current]) {
                Object.defineProperty(event, key, {value: true, configurable: true})
            }
        }
        const options = {capture: true} as const
        return Terminable.many(
            Events.subscribe(view, "pointerdown", patch, options),
            Events.subscribe(view, "pointermove", patch, options),
            Events.subscribe(view, "pointerup", patch, options),
            Events.subscribe(view, "pointercancel", patch, options)
        )
    }
}
