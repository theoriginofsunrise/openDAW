import {describe, expect, it} from "vitest"
import {MuteAll, Mutable} from "./MuteAll"

const units = (...states: Array<boolean>): Array<Mutable & { state: boolean }> => states.map((state, index) => {
    const unit = {
        state, id: `unit-${index}`,
        get: () => unit.state,
        set: (value: boolean) => {unit.state = value}
    }
    return unit
})

describe("MuteAll", () => {
    it("is not 'all muted' with no tracks or with one track playing", () => {
        const muteAll = new MuteAll()
        expect(muteAll.isAllMuted([])).toBe(false)
        expect(muteAll.isAllMuted(units(true, false))).toBe(false)
    })

    it("recognises when every track is muted", () => {
        expect(new MuteAll().isAllMuted(units(true, true))).toBe(true)
    })

    it("mutes everything", () => {
        const list = units(false, false, true)
        new MuteAll().apply(list, true)
        expect(list.map(unit => unit.state)).toEqual([true, true, true])
    })

    it("brings every track back to where it was", () => {
        const muteAll = new MuteAll()
        const list = units(false, true, false)
        muteAll.apply(list, true)
        muteAll.apply(list, false)
        expect(list.map(unit => unit.state)).toEqual([false, true, false])
    })

    it("unmutes everything when nothing is known about the earlier state", () => {
        const list = units(true, true)
        new MuteAll().apply(list, false)
        expect(list.map(unit => unit.state)).toEqual([false, false])
    })

    it("treats a track added in between as unmuted when restoring", () => {
        const muteAll = new MuteAll()
        const list = units(false, true)
        muteAll.apply(list, true)
        const added = units(true)
        added[0] = Object.assign(added[0], {id: "unit-new"})
        muteAll.apply([...list, added[0]], false)
        expect([...list, added[0]].map(unit => unit.state)).toEqual([false, true, false])
    })

    it("forgets the earlier state after restoring", () => {
        const muteAll = new MuteAll()
        const list = units(true, false)
        muteAll.apply(list, true)
        muteAll.apply(list, false)
        muteAll.apply(list, false)
        expect(list.map(unit => unit.state)).toEqual([false, false])
    })
})
