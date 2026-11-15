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
    const inputField: HTMLInputElement = (<input type="text" value={isDefined(value) ? String(value) : ""}/>)
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
        inputField.onblur = () => {
            remove()
            reject(Errors.AbortError)
        }
        inputField.onkeydown = (event: KeyboardEvent) => {
            if (isDefined(event.key) && event.key.toLowerCase() === "enter") {
                const value = numeric ? inputField.value.replace(",", ".") : inputField.value
                remove()
                resolve(value)
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