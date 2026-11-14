import {describe, expect, it} from "vitest"
import {pinchInterval, TouchTracker} from "./TouchGestures"

describe("TouchTracker", () => {
    it("leaves a single finger alone", () => {
        const tracker = new TouchTracker()
        expect(tracker.down(1, 100, 100)).toBe("single")
        expect(tracker.gesturing).toBe(false)
        expect(tracker.move(1, 120, 100)).toBeNull()
    })

    it("starts a gesture when the second finger lands, paired with the first", () => {
        const tracker = new TouchTracker()
        tracker.down(1, 100, 100)
        expect(tracker.down(2, 200, 100)).toBe("gesture-start")
        expect(tracker.gesturing).toBe(true)
        expect(tracker.pair).toEqual([1, 2])
        expect(tracker.center).toEqual({x: 150, y: 100})
    })

    it("reports scale from the finger distance at the start", () => {
        const tracker = new TouchTracker()
        tracker.down(1, 100, 100)
        tracker.down(2, 200, 100)
        const update = tracker.move(2, 300, 100)
        expect(update?.scale).toBeCloseTo(2.0) // 100px apart -> 200px apart
        const pinchedIn = tracker.move(2, 150, 100)
        expect(pinchedIn?.scale).toBeCloseTo(0.5)
    })

    it("reports the midpoint travel as incremental deltas", () => {
        const tracker = new TouchTracker()
        tracker.down(1, 100, 100)
        tracker.down(2, 200, 100)
        const first = tracker.move(1, 110, 90)
        expect(first?.delta).toEqual({x: 5, y: -5})
        const second = tracker.move(2, 210, 80)
        expect(second?.delta).toEqual({x: 5, y: -10}) // finger 2 moved up 20, the midpoint 10
        expect(second?.center).toEqual({x: 160, y: 85})
    })

    it("swallows a third finger without disturbing the gesture", () => {
        const tracker = new TouchTracker()
        tracker.down(1, 0, 0)
        tracker.down(2, 100, 0)
        expect(tracker.down(3, 50, 50)).toBe("gesture-extra")
        expect(tracker.move(3, 60, 60)).toBeNull()
        expect(tracker.pair).toEqual([1, 2])
    })

    it("ends the gesture when a gesture finger lifts, and can start another", () => {
        const tracker = new TouchTracker()
        tracker.down(1, 0, 0)
        tracker.down(2, 100, 0)
        expect(tracker.up(2)).toBe(true)
        expect(tracker.gesturing).toBe(false)
        expect(tracker.move(1, 10, 10)).toBeNull()
        expect(tracker.down(4, 100, 0)).toBe("gesture-start")
        expect(tracker.pair).toEqual([1, 4])
    })

    it("does not report a gesture end for a lifted bystander", () => {
        const tracker = new TouchTracker()
        tracker.down(1, 0, 0)
        tracker.down(2, 100, 0)
        tracker.down(3, 50, 50)
        expect(tracker.up(3)).toBe(false)
        expect(tracker.gesturing).toBe(true)
    })

    it("survives two fingers that start on the same pixel", () => {
        const tracker = new TouchTracker()
        tracker.down(1, 100, 100)
        tracker.down(2, 100, 100)
        const update = tracker.move(2, 101, 100)
        expect(Number.isFinite(update?.scale)).toBe(true)
    })

    it("forgets everything on clear", () => {
        const tracker = new TouchTracker()
        tracker.down(1, 0, 0)
        tracker.down(2, 100, 0)
        tracker.clear()
        expect(tracker.gesturing).toBe(false)
        expect(tracker.down(5, 0, 0)).toBe("single")
    })
})

describe("pinchInterval", () => {
    it("keeps the anchor under the midpoint", () => {
        const [min, max] = pinchInterval(1000, 0.25, 400, 10_000)
        expect(min).toBe(900) // anchor sits 25% into a 400 unit wide window
        expect(max).toBe(1300)
    })

    it("pans when only the midpoint moves", () => {
        const left = pinchInterval(1000, 0.5, 400, 10_000)
        const right = pinchInterval(1000, 0.75, 400, 10_000)
        expect(right[0]).toBeLessThan(left[0]) // fingers moved right, content follows, view moves left
        expect(right[1] - right[0]).toBe(400)
    })

    it("stops at the start of the timeline without changing the zoom", () => {
        const [min, max] = pinchInterval(50, 0.5, 400, 10_000)
        expect(min).toBe(0)
        expect(max - min).toBe(400)
    })

    it("stops at the end of the timeline without changing the zoom", () => {
        const [min, max] = pinchInterval(9990, 0.5, 400, 10_000)
        expect(max).toBe(10_000)
        expect(max - min).toBe(400)
    })

    it("never shows more than the whole timeline", () => {
        const [min, max] = pinchInterval(5000, 0.5, 50_000, 10_000)
        expect(min).toBe(0)
        expect(max).toBe(10_000)
    })
})
