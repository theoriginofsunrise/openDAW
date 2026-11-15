// Phone fork: "mute all" for the timeline header. Mutes every track (the master output stays as it is) and
// remembers what each track was before, so that pressing it again brings every track back to where it was.
export type Mutable = {
    readonly id: string
    get(): boolean
    set(value: boolean): void
}

export class MuteAll {
    readonly #before = new Map<string, boolean>()

    // True when there is at least one track and all of them are muted.
    isAllMuted(units: ReadonlyArray<Mutable>): boolean {
        return units.length > 0 && units.every(unit => unit.get())
    }

    // muted = true: mute everything. muted = false: restore the state from before, or unmute where nothing is known.
    apply(units: ReadonlyArray<Mutable>, muted: boolean): void {
        if (muted) {
            this.#before.clear()
            units.forEach(unit => {
                this.#before.set(unit.id, unit.get())
                unit.set(true)
            })
        } else {
            units.forEach(unit => unit.set(this.#before.get(unit.id) ?? false))
            this.#before.clear()
        }
    }
}
