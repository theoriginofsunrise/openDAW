// Phone fork: where the floating tool bar may sit. The grip is at its left end, so the left edge needs room for a
// finger (the notch and the screen edge swallow touches there), and so does the bottom (home indicator). The right
// edge does not need any.
export type Box = { readonly width: number, readonly height: number }
export type Insets = { readonly top: number, readonly left: number, readonly bottom: number }

export namespace TouchToolbarPlacement {
    export const MarginLeft = 56
    export const MarginBottom = 48
    export const MarginTop = 8
    export const MarginRight = 8

    const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), Math.max(min, max))

    export const clampPosition = (left: number, top: number, bar: Box, screen: Box, insets: Insets) => ({
        left: clamp(left, insets.left + MarginLeft, screen.width - bar.width - MarginRight),
        top: clamp(top, insets.top + MarginTop, screen.height - bar.height - insets.bottom - MarginBottom)
    })

    // The same relative place after the screen changed shape (a rotation): the bar keeps its corner of the screen.
    export const fromFraction = (fraction: { x: number, y: number }, screen: Box) =>
        ({left: fraction.x * screen.width, top: fraction.y * screen.height})

    export const toFraction = (left: number, top: number, screen: Box) =>
        ({x: screen.width === 0 ? 0 : left / screen.width, y: screen.height === 0 ? 0 : top / screen.height})
}
