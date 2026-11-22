import {describe, expect, it} from "vitest"
import {blurOutcome} from "./TextInputOutcome"

describe("blurOutcome", () => {
    it("keeps what was typed when a phone keyboard is closed with OK", () => {
        expect(blurOutcome({touch: true, escaped: false, value: "My Song 2", initial: "My Song"})).toBe("commit")
    })

    it("drops it when nothing changed", () => {
        expect(blurOutcome({touch: true, escaped: false, value: "My Song", initial: "My Song"})).toBe("cancel")
    })

    it("drops it after Escape", () => {
        expect(blurOutcome({touch: true, escaped: true, value: "changed", initial: "My Song"})).toBe("cancel")
    })

    it("keeps clicking away with a mouse as 'never mind'", () => {
        expect(blurOutcome({touch: false, escaped: false, value: "changed", initial: "My Song"})).toBe("cancel")
    })

    it("accepts an emptied field as a change the caller can judge", () => {
        expect(blurOutcome({touch: true, escaped: false, value: "", initial: "My Song"})).toBe("commit")
    })
})
