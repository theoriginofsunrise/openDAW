import {clamp, Terminable} from "@opendaw/lib-std"
import {Events} from "@opendaw/lib-dom"
import {TimelineRange} from "@opendaw/studio-core"
import {GestureStep, pinchInterval, TouchPoint, TwoFingerGesture} from "./TouchGestures"

// Phone fork: two fingers pan and zoom the timeline. The studio listens to the mouse wheel for this, which a
// touch screen does not have. One finger is left alone, so regions, knobs and buttons behave as before.
//
// The fingers are tracked with touch events, because every touch event carries the COMPLETE list of fingers on
// the screen. Pointer events report one finger at a time, and a lift that happens outside the timeline was never
// seen, which left a phantom finger behind and froze every tap.
export namespace TouchNavigation {
    export type Construct = {
        // element whose left edge is the start of the visible time range
        regions: HTMLElement
        range: TimelineRange
        // scroll the tracks by this many pixels (positive = further down)
        scrollTracksBy: (deltaY: number) => void
    }

    export const install = (owner: HTMLElement,
                            {regions, range, scrollTracksBy}: Construct): Terminable => {
        const view: Window = owner.ownerDocument.defaultView ?? window
        const gesture = new TwoFingerGesture()
        // identifiers of the fingers that landed inside the timeline, oldest first
        const owned: Array<number> = []
        // the element each active finger pressed, so a drag it started can be cancelled
        const pressed = new Map<number, EventTarget>()
        let anchor = 0.0
        let startLength = 0.0
        let cancelling = false
        const debug = installDebug(view)

        // A finger may already be dragging a region. Cancelling through the same pointercancel path the browser
        // uses reverts that drag (and stops a pending long-press menu), so a second finger never leaves a
        // half-moved region behind.
        const cancelPointers = (): void => {
            cancelling = true
            try {
                pressed.forEach((target, pointerId) => target.dispatchEvent(new PointerEvent("pointercancel", {
                    pointerId, pointerType: "touch", isPrimary: false, bubbles: true, composed: true
                })))
            } finally {
                cancelling = false
            }
            pressed.clear()
        }

        const apply = (center: { x: number }, delta: { y: number }, scale: number): void => {
            const unitRange = range.unitRange
            if (unitRange <= 0.0) {return}
            const x = center.x - regions.getBoundingClientRect().left
            const length = clamp(startLength / scale, range.toUnits(range.minimum), range.maxUnits)
            const fraction = (range.xToUnit(x) - range.unitMin) / unitRange
            if (!Number.isFinite(fraction)) {return}
            const [min, max] = pinchInterval(anchor, fraction, length, range.maxUnits)
            range.showUnitInterval(min, max)
            if (delta.y !== 0.0) {scrollTracksBy(-delta.y)}
        }

        const handle = (step: GestureStep, event: TouchEvent): void => {
            debug.show(event, owned.length, gesture.active, step)
            switch (step.kind) {
                case "start": {
                    cancelPointers()
                    anchor = range.xToUnit(step.center.x - regions.getBoundingClientRect().left)
                    startLength = range.unitRange
                    break
                }
                case "move": {
                    if (event.cancelable) {event.preventDefault()}
                    apply(step.update.center, step.update.delta, step.update.scale)
                    break
                }
            }
        }

        // The browser's own list is the truth: forget every finger it no longer reports.
        const sync = (event: TouchEvent): void => {
            const touches: ReadonlyArray<TouchPoint> = Array.from(event.touches,
                touch => ({id: touch.identifier, x: touch.clientX, y: touch.clientY}))
            for (let index = owned.length - 1; index >= 0; index--) {
                if (!touches.some(touch => touch.id === owned[index])) {owned.splice(index, 1)}
            }
            const fingers = owned.flatMap(id => touches.filter(touch => touch.id === id))
            handle(gesture.update(fingers), event)
        }

        const options = {capture: true, passive: false} as const
        return Terminable.many(
            Events.subscribe(view, "touchstart", (event: TouchEvent) => {
                const inside = event.target instanceof Node && owner.contains(event.target)
                if (inside) {
                    for (const touch of Array.from(event.changedTouches)) {
                        if (!owned.includes(touch.identifier)) {owned.push(touch.identifier)}
                    }
                }
                sync(event)
            }, options),
            Events.subscribe(view, "touchmove", sync, options),
            Events.subscribe(view, "touchend", sync, options),
            Events.subscribe(view, "touchcancel", sync, options),
            Events.subscribe(owner, "pointerdown", (event: PointerEvent) => {
                if (event.pointerType !== "touch") {return}
                if (event.isPrimary) {
                    // the first finger of a new touch: nothing else can be down, drop any stale bookkeeping
                    owned.length = 0
                    pressed.clear()
                    gesture.reset()
                }
                pressed.set(event.pointerId, event.target ?? owner)
                // a finger that lands while another one is down belongs to the gesture, not to the controls below
                if (!event.isPrimary && owned.length > 0) {event.stopPropagation()}
            }, {capture: true}),
            Events.subscribe(owner, "pointermove", (event: PointerEvent) => {
                if (event.pointerType === "touch" && gesture.active) {event.stopPropagation()}
            }, {capture: true}),
            Events.subscribe(owner, "pointerup", (event: PointerEvent) => {
                // the lift that ends a gesture must not count as a tap on whatever is underneath
                if (event.pointerType === "touch" && gesture.active) {event.stopPropagation()}
            }, {capture: true}),
            Events.subscribe(view, "pointerup", (event: PointerEvent) => {
                pressed.delete(event.pointerId)
            }, {capture: true}),
            Events.subscribe(view, "pointercancel", (event: PointerEvent) => {
                if (!cancelling) {pressed.delete(event.pointerId)}
            }, {capture: true}),
            {
                terminate: () => {
                    owned.length = 0
                    pressed.clear()
                    gesture.reset()
                    debug.terminate()
                }
            }
        )
    }

    // Open the studio with ?touchdebug in a Safari tab to see what the touch layer sees.
    const installDebug = (view: Window) => {
        if (!view.location.search.includes("touchdebug")) {
            return {show: (_event: TouchEvent, _owned: number, _gesturing: boolean, _step: GestureStep) => {}, terminate: () => {}}
        }
        const panel = view.document.createElement("pre")
        panel.style.cssText = "position:fixed;top:4px;left:4px;z-index:99999;margin:0;padding:6px 8px;" +
            "font:11px monospace;color:#0f0;background:rgba(0,0,0,.7);pointer-events:none;border-radius:6px"
        view.document.body.appendChild(panel)
        return {
            show: (event: TouchEvent, owned: number, gesturing: boolean, step: GestureStep) => {
                panel.textContent = `${event.type} touches=${event.touches.length} owned=${owned}\n` +
                    `gesturing=${gesturing} step=${step.kind}` +
                    (step.kind === "move" ? ` scale=${step.update.scale.toFixed(2)}` : "")
            },
            terminate: () => panel.remove()
        }
    }
}
