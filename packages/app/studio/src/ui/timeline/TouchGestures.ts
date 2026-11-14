// Pure touch logic for the timeline (no DOM, so it runs in node tests).
// Two fingers pan and zoom, a single finger keeps doing what it always did (move a region, press a button...).

export type Point = { readonly x: number, readonly y: number }

export type GestureUpdate = {
    // midpoint between the two fingers
    readonly center: Point
    // movement of that midpoint since the previous update
    readonly delta: Point
    // current finger distance / distance when the second finger landed (above 1 = fingers spread apart)
    readonly scale: number
}

export type TouchStart =
    | "single" // first finger: not ours, let the normal handlers run
    | "gesture-start" // second finger landed: a pan/zoom gesture begins
    | "gesture-extra" // a third finger while gesturing: swallowed

export class TouchTracker {
    readonly #pointers = new Map<number, Point>()
    #pair: ReadonlyArray<number> = []
    #startDistance: number = 1
    #lastCenter: Point = {x: 0, y: 0}

    get gesturing(): boolean {return this.#pair.length === 2}
    // pointer ids of the two fingers of the active gesture (empty when not gesturing)
    get pair(): ReadonlyArray<number> {return this.#pair}
    get center(): Point {return this.#lastCenter}
    isInGesture(id: number): boolean {return this.#pair.includes(id)}

    down(id: number, x: number, y: number): TouchStart {
        this.#pointers.set(id, {x, y})
        if (this.gesturing) {return "gesture-extra"}
        if (this.#pointers.size < 2) {return "single"}
        // pair the new finger with the oldest finger that is still down
        const first = [...this.#pointers.keys()].find(other => other !== id)
        if (first === undefined) {return "single"}
        this.#pair = [first, id]
        this.#startDistance = this.#distance()
        this.#lastCenter = this.#midpoint()
        return "gesture-start"
    }

    move(id: number, x: number, y: number): GestureUpdate | null {
        if (!this.#pointers.has(id)) {return null}
        this.#pointers.set(id, {x, y})
        if (!this.gesturing || !this.isInGesture(id)) {return null}
        const center = this.#midpoint()
        const delta = {x: center.x - this.#lastCenter.x, y: center.y - this.#lastCenter.y}
        this.#lastCenter = center
        return {center, delta, scale: this.#distance() / this.#startDistance}
    }

    // returns true when this lift ended the active gesture
    up(id: number): boolean {
        this.#pointers.delete(id)
        if (!this.isInGesture(id)) {return false}
        this.#pair = []
        return true
    }

    clear(): void {
        this.#pointers.clear()
        this.#pair = []
    }

    #point(id: number): Point {return this.#pointers.get(id) ?? {x: 0, y: 0}}

    #midpoint(): Point {
        const [a, b] = this.#pair.map(id => this.#point(id))
        return {x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5}
    }

    // never below one pixel, so a pinch that starts with touching fingers cannot divide by zero
    #distance(): number {
        const [a, b] = this.#pair.map(id => this.#point(id))
        return Math.max(1.0, Math.hypot(a.x - b.x, a.y - b.y))
    }
}

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
