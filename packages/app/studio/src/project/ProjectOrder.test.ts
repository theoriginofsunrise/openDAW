import {describe, expect, it} from "vitest"
import {UUID} from "@opendaw/lib-std"
import {ProjectOrder} from "./ProjectOrder"

const project = (n: number, modified: string) => ({
    uuid: UUID.parse(`00000000-0000-0000-0000-00000000000${n}`), meta: {modified}
})
const id = (n: number) => UUID.toString(UUID.parse(`00000000-0000-0000-0000-00000000000${n}`))
const names = (list: ReadonlyArray<{ uuid: UUID.Bytes }>) => list.map(({uuid}) => UUID.toString(uuid).slice(-1))

describe("ProjectOrder.sort", () => {
    const a = project(1, "2026-11-01T10:00:00Z")
    const b = project(2, "2026-11-03T10:00:00Z")
    const c = project(3, "2026-11-02T10:00:00Z")

    it("puts the newest first when no order was saved", () => {
        expect(names(ProjectOrder.sort([a, b, c], []))).toEqual(["2", "3", "1"])
    })

    it("follows the saved order", () => {
        expect(names(ProjectOrder.sort([a, b, c], [id(1), id(3), id(2)]))).toEqual(["1", "3", "2"])
    })

    it("puts a project that is not in the saved order on top", () => {
        expect(names(ProjectOrder.sort([a, b, c], [id(1), id(3)]))).toEqual(["2", "1", "3"])
    })

    it("ignores saved ids of projects that no longer exist", () => {
        expect(names(ProjectOrder.sort([a, c], [id(2), id(3), id(1)]))).toEqual(["3", "1"])
    })
})

describe("ProjectOrder.arrange", () => {
    const list = ["a", "b", "c", "d"]

    it("moves a project up and down by one place", () => {
        expect(ProjectOrder.arrange(list, "c", "up")).toEqual(["a", "c", "b", "d"])
        expect(ProjectOrder.arrange(list, "b", "down")).toEqual(["a", "c", "b", "d"])
    })

    it("moves a project to the top", () => {
        expect(ProjectOrder.arrange(list, "d", "top")).toEqual(["d", "a", "b", "c"])
    })

    it("stays put at the ends and for unknown ids", () => {
        expect(ProjectOrder.arrange(list, "a", "up")).toEqual(list)
        expect(ProjectOrder.arrange(list, "d", "down")).toEqual(list)
        expect(ProjectOrder.arrange(list, "a", "top")).toEqual(list)
        expect(ProjectOrder.arrange(list, "z", "up")).toEqual(list)
    })

    it("does not change the list it was given", () => {
        ProjectOrder.arrange(list, "d", "top")
        expect(list).toEqual(["a", "b", "c", "d"])
    })
})
