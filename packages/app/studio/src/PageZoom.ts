import {Terminable} from "@opendaw/lib-std"

// Phone fork: iOS zooms the whole page when a text field gets focus and when two fingers pinch outside the
// timeline, and a zoomed page cannot be undone from inside the app. The studio has its own pinch (the timeline)
// and nothing that needs a magnified page, so the page is kept at its normal size, and if it ever ends up
// zoomed anyway it is snapped back when typing ends.
export namespace PageZoom {
    export const install = (): Terminable => {
        const viewport = document.querySelector<HTMLMetaElement>("meta[name=viewport]")
        const block = (event: Event): void => {event.preventDefault()}
        const isTyping = (): boolean => {
            const active = document.activeElement
            return active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
        }
        const reset = (): void => {
            const scale = window.visualViewport?.scale ?? 1.0
            if (viewport === null || scale <= 1.01 || isTyping()) {return}
            // changing the tag makes iOS read it again, and a minimum scale of 1 pulls the page back
            const content = viewport.content
            viewport.content = `${content}, minimum-scale=1.0`
            requestAnimationFrame(() => {viewport.content = content})
        }
        const afterTyping = (): void => {setTimeout(reset, 80)}
        // The page is wider than the screen in places (the header), and a drag, a focus or a rotation can scroll the
        // whole app sideways with no way back (the document has no scroll bar). Put it back whenever it moves.
        const resetScroll = (): void => {
            const root = document.scrollingElement
            if (window.scrollX !== 0 || window.scrollY !== 0) {window.scrollTo(0, 0)}
            for (const element of [root, document.documentElement, document.body]) {
                if (element !== null && (element.scrollLeft !== 0 || element.scrollTop !== 0)) {
                    element.scrollLeft = 0
                    element.scrollTop = 0
                }
            }
        }
        const afterRotation = (): void => {setTimeout(resetScroll, 300)}
        // Safari's own pinch-zoom gesture events
        document.addEventListener("gesturestart", block, {passive: false})
        document.addEventListener("gesturechange", block, {passive: false})
        document.addEventListener("focusout", afterTyping)
        window.visualViewport?.addEventListener("resize", reset)
        window.addEventListener("scroll", resetScroll, {passive: true})
        document.body.addEventListener("scroll", resetScroll, {passive: true})
        window.visualViewport?.addEventListener("scroll", resetScroll)
        window.addEventListener("pointerup", resetScroll, {capture: true, passive: true})
        window.addEventListener("orientationchange", afterRotation)
        window.addEventListener("resize", resetScroll)
        return {
            terminate: () => {
                document.removeEventListener("gesturestart", block)
                document.removeEventListener("gesturechange", block)
                document.removeEventListener("focusout", afterTyping)
                window.visualViewport?.removeEventListener("resize", reset)
                window.removeEventListener("scroll", resetScroll)
                document.body.removeEventListener("scroll", resetScroll)
                window.visualViewport?.removeEventListener("scroll", resetScroll)
                window.removeEventListener("pointerup", resetScroll, {capture: true})
                window.removeEventListener("orientationchange", afterRotation)
                window.removeEventListener("resize", resetScroll)
            }
        }
    }
}
