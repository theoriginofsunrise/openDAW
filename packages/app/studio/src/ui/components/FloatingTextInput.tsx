import {blurOutcome} from "@/ui/components/TextInputOutcome"
import css from "./FloatingTextInput.sass?inline"
import {Errors, isDefined, Point} from "@opendaw/lib-std"
import {createElement} from "@opendaw/lib-jsx"
import {Html} from "@opendaw/lib-dom"

const className = Html.adoptStyleSheet(css, "TextInput")

type Construct = {
    resolvers?: PromiseWithResolvers<string>
    position?: Point
    value?: boolean | number | string
    unit?: string
    numeric?: boolean
}

export const FloatingTextInput = ({resolvers, position, value, unit, numeric}: Construct) => {
    const focusElement = document.activeElement as HTMLElement
    const initial = isDefined(value) ? String(value) : ""
    // enterkeyhint: the return key of a phone keyboard is labelled Done (OK) instead of "return"
    const inputField: HTMLInputElement = (<input type="text" value={initial} enterkeyhint="done"/>)
    requestAnimationFrame(() => {
        inputField.select()
        inputField.focus()
    })
    // iOS opens the keyboard only for a focus() that happens while a tap is being handled. This box is usually
    // created by the pointerdown of a double tap, which does not count, so it is focused again when that finger
    // lifts (touchend, or the click that follows).
    const refocus = (): void => {
        inputField.focus({preventScroll: true})
        inputField.select()
    }
    const once = {capture: true, once: true} as const
    window.addEventListener("touchend", refocus, once)
    window.addEventListener("click", refocus, once)
    setTimeout(() => {
        window.removeEventListener("touchend", refocus, {capture: true})
        window.removeEventListener("click", refocus, {capture: true})
    }, 1500)
    if (isDefined(resolvers)) {
        const {reject, resolve} = resolvers
        const remove = () => {
            inputField.onblur = null
            inputField.onkeydown = null
            element.remove()
            focusElement?.focus()
        }
        let escaped = false
        const touch = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches
        const finish = (): string => numeric ? inputField.value.replace(",", ".") : inputField.value
        inputField.onblur = () => {
            // The OK or Done key of a phone keyboard closes the keyboard without sending Enter: that ends the typing too.
            const outcome = blurOutcome({touch, escaped, value: inputField.value, initial})
            const result = finish()
            remove()
            if (outcome === "commit") {resolve(result)} else {reject(Errors.AbortError)}
        }
        inputField.onkeydown = (event: KeyboardEvent) => {
            const key = isDefined(event.key) ? event.key.toLowerCase() : ""
            if (key === "enter") {
                const result = finish()
                remove()
                resolve(result)
            } else if (key === "escape") {
                escaped = true
                inputField.blur()
            }
        }
    }
    const element: HTMLElement = (
        <div className={className} unit={unit}
             style={isDefined(position) ? {
                 position: "absolute",
                 transform: `translate(${position.x}px, ${position.y}px)`
             } : {}}>
            {inputField}
        </div>
    )
    return element
}