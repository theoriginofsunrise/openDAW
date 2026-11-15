import {describe, expect, it} from "vitest"
import {TouchToolbarPlacement} from "./TouchToolbarPlacement"

const bar = {width: 360, height: 44}
const landscape = {width: 844, height: 390}
const portrait = {width: 390, height: 844}
const insets = {top: 0, left: 47, bottom: 21}

describe("TouchToolbarPlacement.clampPosition", () => {
    it("leaves a comfortable position alone", () => {
        expect(TouchToolbarPlacement.clampPosition(200, 100, bar, landscape, insets)).toEqual({left: 200, top: 100})
    })

    it("keeps the grip away from the left edge, notch included", () => {
        const {left} = TouchToolbarPlacement.clampPosition(0, 100, bar, landscape, insets)
        expect(left).toBe(47 + TouchToolbarPlacement.MarginLeft)
    })

    it("keeps the bar above the home indicator", () => {
        const {top} = TouchToolbarPlacement.clampPosition(200, 389, bar, landscape, insets)
        expect(top + bar.height).toBeLessThanOrEqual(landscape.height - insets.bottom - TouchToolbarPlacement.MarginBottom)
    })

    it("lets the bar come close to the right edge", () => {
        const {left} = TouchToolbarPlacement.clampPosition(2000, 100, bar, landscape, insets)
        expect(left + bar.width).toBe(landscape.width - TouchToolbarPlacement.MarginRight)
    })

    it("does not break when the bar is wider than the screen", () => {
        const wide = {width: 900, height: 44}
        const result = TouchToolbarPlacement.clampPosition(300, 100, wide, portrait, insets)
        expect(result.left).toBe(insets.left + TouchToolbarPlacement.MarginLeft)
    })
})

describe("TouchToolbarPlacement fractions", () => {
    it("keeps the corner of the screen after a rotation", () => {
        const fraction = TouchToolbarPlacement.toFraction(700, 300, landscape) // bottom right of the landscape screen
        const {left, top} = TouchToolbarPlacement.fromFraction(fraction, portrait)
        expect(left).toBeGreaterThan(portrait.width * 0.7)
        expect(top).toBeGreaterThan(portrait.height * 0.7)
    })

    it("survives a screen of size zero", () => {
        expect(TouchToolbarPlacement.toFraction(10, 10, {width: 0, height: 0})).toEqual({x: 0, y: 0})
    })
})
