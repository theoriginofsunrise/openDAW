import {clamp, Terminable} from "@opendaw/lib-std"
import {Events} from "@opendaw/lib-dom"
import {TimelineRange} from "@opendaw/studio-core"
import {ScrollModel} from "@/ui/components/ScrollModel.ts"
import {GestureUpdate, pinchInterval, TouchTracker} from "./TouchGestures"

// Phone fork: two fingers pan and zoom the track area. The studio listens to the mouse wheel for this, which a
// touch screen does not have. One finger is left alone, so regions, knobs and buttons behave as before.
export namespace TouchNavigation {
    export type Construct = {
        // element whose left edge is the start of the visible time range
        regions: HTMLElement
        range: TimelineRange
        // vertical scrolling of the tracks
        scroll: ScrollModel
    }

    export const install = (owner: HTMLElement, {regions, range, scroll}: Construct): Terminable => {
        const tracker = new TouchTracker()
        const origins = new Map<number, EventTarget>()
        let anchor = 0.0
        let startLength = 0.0
        let cancelling = false

        // The first finger may already be dragging a region. Cancelling through the same pointercancel path the
        // browser uses reverts that drag, so adding a second finger never leaves a half-moved region behind.
        const cancelDrag = (id: number): void => {
            const target = origins.get(id)
            if (target === undefined) {return}
            cancelling = true
            try {
                target.dispatchEvent(new PointerEvent("pointercancel", {
                    pointerId: id, pointerType: "touch", isPrimary: true, bubbles: true, composed: true
                }))
            } finally {
                cancelling = false
            }
        }

        const apply = ({center, delta, scale}: GestureUpdate): void => {
            const x = center.x - regions.getBoundingClientRect().left
            const unitRange = range.unitRange
            if (unitRange <= 0.0) {return}
            const length = clamp(startLength / scale, range.toUnits(range.minimum), range.maxUnits)
            const fraction = (range.xToUnit(x) - range.unitMin) / unitRange
            if (!Number.isFinite(fraction)) {return}
            const [min, max] = pinchInterval(anchor, fraction, length, range.maxUnits)
            range.showUnitInterval(min, max)
            scroll.position -= delta.y
        }

        return Terminable.many(
            Events.subscribe(owner, "pointerdown", (event: PointerEvent) => {
                if (event.pointerType !== "touch") {return}
                origins.set(event.pointerId, event.target ?? owner)
                const start = tracker.down(event.pointerId, event.clientX, event.clientY)
                if (start === "single") {return}
                event.preventDefault()
                event.stopPropagation()
                if (start === "gesture-start") {
                    cancelDrag(tracker.pair[0])
                    anchor = range.xToUnit(tracker.center.x - regions.getBoundingClientRect().left)
                    startLength = range.unitRange
                }
            }, {capture: true}),
            Events.subscribe(owner, "pointermove", (event: PointerEvent) => {
                if (event.pointerType !== "touch") {return}
                const update = tracker.move(event.pointerId, event.clientX, event.clientY)
                if (!tracker.gesturing) {return}
                event.preventDefault()
                event.stopPropagation()
                if (update !== null) {apply(update)}
            }, {capture: true}),
            Events.subscribe(owner, "pointerup", (event: PointerEvent) => {
                if (event.pointerType !== "touch") {return}
                const wasGesturing = tracker.gesturing
                tracker.up(event.pointerId)
                origins.delete(event.pointerId)
                // a lift that belongs to a gesture must not count as a tap or click on whatever is underneath
                if (wasGesturing) {event.stopPropagation()}
            }, {capture: true}),
            Events.subscribe(owner, "pointercancel", (event: PointerEvent) => {
                if (event.pointerType !== "touch" || cancelling) {return}
                const wasGesturing = tracker.gesturing
                tracker.up(event.pointerId)
                origins.delete(event.pointerId)
                if (wasGesturing) {event.stopPropagation()}
            }, {capture: true}),
            {terminate: () => {tracker.clear(); origins.clear()}}
        )
    }
}
