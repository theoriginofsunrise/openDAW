import {StringComparator, UUID} from "@opendaw/lib-std"

// Phone fork: the order of the projects in the dashboard list. Without a saved order the newest project comes
// first. Once the order was changed by hand it is kept on this device (it is not synced to other devices).
export namespace ProjectOrder {
    const Key = "opendaw-project-order"

    export type Action = "up" | "down" | "top"

    export const load = (): ReadonlyArray<string> => {
        try {
            const parsed: unknown = JSON.parse(localStorage.getItem(Key) ?? "[]")
            return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : []
        } catch (_error) {
            return []
        }
    }

    export const save = (order: ReadonlyArray<string>): void => {
        try {localStorage.setItem(Key, JSON.stringify(order))} catch (_error) {/* storage not available */}
    }

    type Entry = { readonly uuid: UUID.Bytes, readonly meta: { readonly modified: string } }

    /**
     * Projects that are not in the saved order (new ones) come first, newest first, then the projects in the
     * saved order. Ids in the saved order that no longer exist are ignored.
     */
    export const sort = <T extends Entry>(projects: ReadonlyArray<T>, order: ReadonlyArray<string> = load()): Array<T> => {
        const position = new Map(order.map((uuid, index) => [uuid, index] as const))
        const fresh = projects
            .filter(({uuid}) => !position.has(UUID.toString(uuid)))
            .toSorted((a, b) => -StringComparator(a.meta.modified, b.meta.modified))
        const ordered = projects
            .filter(({uuid}) => position.has(UUID.toString(uuid)))
            .toSorted((a, b) => (position.get(UUID.toString(a.uuid)) ?? 0) - (position.get(UUID.toString(b.uuid)) ?? 0))
        return [...fresh, ...ordered]
    }

    // The new order after moving one project of the order that is displayed right now.
    export const arrange = (displayed: ReadonlyArray<string>, uuid: string, action: Action): Array<string> => {
        const order = [...displayed]
        const index = order.indexOf(uuid)
        if (index < 0) {return order}
        const target = action === "top" ? 0 : action === "up" ? index - 1 : index + 1
        if (target < 0 || target >= order.length || target === index) {return order}
        order.splice(index, 1)
        order.splice(target, 0, uuid)
        return order
    }
}
