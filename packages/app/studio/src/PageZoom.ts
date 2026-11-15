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
        // Safari's own pinch-zoom gesture events
        document.addEventListener("gesturestart", block, {passive: false})
        document.addEventListener("gesturechange", block, {passive: false})
        document.addEventListener("focusout", afterTyping)
        window.visualViewport?.addEventListener("resize", reset)
        return {
            terminate: () => {
                document.removeEventListener("gesturestart", block)
                document.removeEventListener("gesturechange", block)
                document.removeEventListener("focusout", afterTyping)
                window.visualViewport?.removeEventListener("resize", reset)
            }
        }
    }
}
