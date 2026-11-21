import {describe, expect, it} from "vitest"
import {copyName} from "./ProjectCopyName"

describe("copyName", () => {
    it("adds 'copy' to a name", () => {
        expect(copyName("Song", ["Song"])).toBe("Song copy")
    })

    it("counts on when the copy exists", () => {
        expect(copyName("Song", ["Song", "Song copy"])).toBe("Song copy 2")
        expect(copyName("Song", ["Song", "Song copy", "Song copy 2"])).toBe("Song copy 3")
    })

    it("does not stack the word when copying a copy", () => {
        expect(copyName("Song copy", ["Song", "Song copy"])).toBe("Song copy 2")
        expect(copyName("Song copy 2", ["Song", "Song copy", "Song copy 2"])).toBe("Song copy 3")
    })

    it("ignores case and spaces around names", () => {
        expect(copyName("Song", ["SONG COPY ", "Song"])).toBe("Song copy 2")
    })

    it("fills a gap", () => {
        expect(copyName("Song", ["Song", "Song copy 2"])).toBe("Song copy")
    })

    it("works with nothing else around", () => {
        expect(copyName("My beat", [])).toBe("My beat copy")
    })

    it("keeps names that only contain the word", () => {
        expect(copyName("Copycat", ["Copycat"])).toBe("Copycat copy")
    })
})
