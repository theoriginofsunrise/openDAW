import {beforeEach, describe, expect, it} from "vitest"
import {TouchModifiers} from "./TouchModifiers"

describe("TouchModifiers browse mode", () => {
    beforeEach(() => TouchModifiers.set("move"))

    it("lets a finger edit while a tool is selected", () => {
        expect(TouchModifiers.blocksEditing({pointerType: "touch"})).toBe(false)
        TouchModifiers.set("split")
        expect(TouchModifiers.blocksEditing({pointerType: "touch"})).toBe(false)
    })

    it("stops a finger from editing when no tool is selected", () => {
        TouchModifiers.set("view")
        expect(TouchModifiers.blocksEditing({pointerType: "touch"})).toBe(true)
    })

    it("never restricts the mouse or a pen", () => {
        TouchModifiers.set("view")
        expect(TouchModifiers.blocksEditing({pointerType: "mouse"})).toBe(false)
        expect(TouchModifiers.blocksEditing({pointerType: "pen"})).toBe(false)
    })

    it("tells the toolbar when the tool changes, and only when it does", () => {
        let calls = 0
        const subscription = TouchModifiers.subscribe(() => {calls++})
        TouchModifiers.set("view")
        TouchModifiers.set("view")
        TouchModifiers.set("multi")
        subscription.terminate()
        TouchModifiers.set("move")
        expect(calls).toBe(2)
        expect(TouchModifiers.get()).toBe("move")
    })
})
