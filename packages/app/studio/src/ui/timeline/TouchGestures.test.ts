import {describe, expect, it} from "vitest"
import {pinchInterval, TouchPoint, TwoFingerGesture, visibleLength} from "./TouchGestures"

const finger = (id: number, x: number, y: number): TouchPoint => ({id, x, y})

describe("TwoFingerGesture", () => {
    it("ignores zero or one finger", () => {
        const gesture = new TwoFingerGesture()
        expect(gesture.update([]).kind).toBe("idle")
        expect(gesture.update([finger(1, 100, 100)]).kind).toBe("idle")
        expect(gesture.active).toBe(false)
    })

    it("starts when the second finger lands", () => {
        const gesture = new TwoFingerGesture()
        gesture.update([finger(1, 100, 100)])
        const step = gesture.update([finger(1, 100, 100), finger(2, 200, 100)])
        expect(step).toEqual({kind: "start", center: {x: 150, y: 100}})
        expect(gesture.active).toBe(true)
    })

    it("reports scale from the finger distance at the start", () => {
        const gesture = new TwoFingerGesture()
        gesture.update([finger(1, 100, 100), finger(2, 200, 100)])
        const spread = gesture.update([finger(1, 100, 100), finger(2, 300, 100)])
        expect(spread.kind === "move" && spread.update.scale).toBeCloseTo(2.0)
        const pinched = gesture.update([finger(1, 100, 100), finger(2, 150, 100)])
        expect(pinched.kind === "move" && pinched.update.scale).toBeCloseTo(0.5)
    })

    it("reports the midpoint travel as incremental deltas", () => {
        const gesture = new TwoFingerGesture()
        gesture.update([finger(1, 100, 100), finger(2, 200, 100)])
        const first = gesture.update([finger(1, 110, 90), finger(2, 200, 100)])
        expect(first.kind === "move" && first.update.delta).toEqual({x: 5, y: -5})
        const second = gesture.update([finger(1, 110, 90), finger(2, 210, 80)])
        expect(second.kind === "move" && second.update.delta).toEqual({x: 5, y: -10})
        expect(second.kind === "move" && second.update.center).toEqual({x: 160, y: 85})
    })

    it("ends when a finger lifts", () => {
        const gesture = new TwoFingerGesture()
        gesture.update([finger(1, 0, 0), finger(2, 100, 0)])
        expect(gesture.update([finger(1, 0, 0)]).kind).toBe("end")
        expect(gesture.active).toBe(false)
        expect(gesture.update([finger(1, 0, 0)]).kind).toBe("idle")
    })

    it("keeps following the first two fingers when a third one comes and goes", () => {
        const gesture = new TwoFingerGesture()
        gesture.update([finger(1, 0, 0), finger(2, 100, 0)])
        const third = gesture.update([finger(1, 0, 0), finger(2, 100, 0), finger(3, 50, 50)])
        expect(third.kind).toBe("move")
        const gone = gesture.update([finger(1, 0, 0), finger(2, 100, 0)])
        expect(gone.kind).toBe("move")
    })

    it("pairs up again when a finger of the pair lifts but another stays down", () => {
        const gesture = new TwoFingerGesture()
        gesture.update([finger(1, 0, 0), finger(2, 100, 0), finger(3, 50, 50)])
        const step = gesture.update([finger(2, 100, 0), finger(3, 50, 50)])
        expect(step.kind).toBe("start")
        expect(gesture.active).toBe(true)
    })

    it("recovers from a finger the browser stopped reporting", () => {
        const gesture = new TwoFingerGesture()
        gesture.update([finger(1, 0, 0), finger(2, 100, 0)])
        // a later event lists a single finger: nothing is left stuck
        expect(gesture.update([finger(7, 5, 5)]).kind).toBe("end")
        expect(gesture.update([finger(7, 5, 5), finger(8, 105, 5)]).kind).toBe("start")
    })

    it("survives two fingers that start on the same pixel", () => {
        const gesture = new TwoFingerGesture()
        gesture.update([finger(1, 100, 100), finger(2, 100, 100)])
        const step = gesture.update([finger(1, 100, 100), finger(2, 101, 100)])
        expect(step.kind === "move" && Number.isFinite(step.update.scale)).toBe(true)
    })

    it("forgets everything on reset", () => {
        const gesture = new TwoFingerGesture()
        gesture.update([finger(1, 0, 0), finger(2, 100, 0)])
        gesture.reset()
        expect(gesture.active).toBe(false)
    })
})

describe("pinchInterval", () => {
    it("keeps the anchor under the midpoint", () => {
        const [min, max] = pinchInterval(1000, 0.25, 400, 10_000)
        expect(min).toBe(900)
        expect(max).toBe(1300)
    })

    it("pans when only the midpoint moves", () => {
        const left = pinchInterval(1000, 0.5, 400, 10_000)
        const right = pinchInterval(1000, 0.75, 400, 10_000)
        expect(right[0]).toBeLessThan(left[0])
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

describe("visibleLength", () => {
    it("shows less when the fingers spread and more when they pinch", () => {
        expect(visibleLength(1000, 2, 10, 100_000)).toBe(500)
        expect(visibleLength(1000, 0.5, 10, 100_000)).toBe(2000)
    })

    it("stops at the closest zoom and at the whole timeline", () => {
        expect(visibleLength(1000, 1000, 40, 100_000)).toBe(40)
        expect(visibleLength(1000, 0.001, 40, 5_000)).toBe(5_000)
    })

    it("does not collapse when the closest zoom is far below the visible length", () => {
        // regression: the closest zoom was once expressed as a fraction of the whole timeline, so it equalled it
        expect(visibleLength(30_720, 2, 40, 384_000)).toBe(15_360)
    })
})
