// Pure touch logic for the timeline (no DOM, so it runs in node tests).
// Two fingers pan and zoom, a single finger keeps doing what it always did (move a region, press a button...).

export type Point = { readonly x: number, readonly y: number }
export type TouchPoint = Point & { readonly id: number }

export type GestureUpdate = {
    // midpoint between the two fingers
    readonly center: Point
    // movement of that midpoint since the previous update
    readonly delta: Point
    // current finger distance / distance when the gesture began (above 1 = fingers spread apart)
    readonly scale: number
}

export type GestureStep =
    | { readonly kind: "idle" }
    | { readonly kind: "start", readonly center: Point }
    | { readonly kind: "move", readonly update: GestureUpdate }
    | { readonly kind: "end" }

const Idle: GestureStep = {kind: "idle"}
const End: GestureStep = {kind: "end"}

/**
 * Feed it the fingers that are currently down (oldest first) after every touch event. Because the caller passes
 * the complete list each time, a finger the browser stopped reporting can never leave this stuck.
 */
export class TwoFingerGesture {
    #pair: ReadonlyArray<number> = []
    #startDistance: number = 1
    #last: Point = {x: 0, y: 0}

    get active(): boolean {return this.#pair.length === 2}

    update(fingers: ReadonlyArray<TouchPoint>): GestureStep {
        if (fingers.length < 2) {
            if (!this.active) {return Idle}
            this.#pair = []
            return End
        }
        if (this.active) {
            const a = fingers.find(finger => finger.id === this.#pair[0])
            const b = fingers.find(finger => finger.id === this.#pair[1])
            if (a !== undefined && b !== undefined) {
                const center = midpoint(a, b)
                const delta = {x: center.x - this.#last.x, y: center.y - this.#last.y}
                this.#last = center
                return {kind: "move", update: {center, delta, scale: distance(a, b) / this.#startDistance}}
            }
            // one finger of the pair lifted while others stayed down: pair up again with the oldest two
        }
        const [a, b] = fingers
        this.#pair = [a.id, b.id]
        this.#startDistance = distance(a, b)
        this.#last = midpoint(a, b)
        return {kind: "start", center: this.#last}
    }

    reset(): void {this.#pair = []}
}

const midpoint = (a: Point, b: Point): Point => ({x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5})

// never below one pixel, so a pinch that starts with touching fingers cannot divide by zero
const distance = (a: Point, b: Point): number => Math.max(1.0, Math.hypot(a.x - b.x, a.y - b.y))

/**
 * The visible interval (in timeline units) after a pinch: the unit that was under the fingers when the gesture
 * began stays under the fingers' midpoint, whatever the zoom and however far the fingers travelled.
 * @param anchor unit under the midpoint when the gesture began
 * @param fraction horizontal position of the midpoint inside the visible area, 0 (left edge) to 1 (right edge)
 * @param length wanted visible length in units
 * @param maxUnits end of the timeline
 */
export const pinchInterval = (anchor: number, fraction: number, length: number,
                              maxUnits: number): readonly [min: number, max: number] => {
    const visible = Math.min(length, maxUnits)
    let min = anchor - fraction * visible
    if (min < 0.0) {min = 0.0}
    if (min + visible > maxUnits) {min = maxUnits - visible}
    return [min, min + visible]
}

/**
 * Visible length (in timeline units) while pinching: the length at the start divided by how far the fingers
 * spread, kept between the closest zoom and the whole timeline.
 */
export const visibleLength = (startLength: number, scale: number, minLength: number, maxUnits: number): number =>
    Math.min(maxUnits, Math.max(minLength, startLength / scale))
