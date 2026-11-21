// "Song" -> "Song copy" -> "Song copy 2" ... the first of these that no project has yet. Copying a copy does not
// stack the word ("Song copy copy"), it counts on.
export const copyName = (name: string, existing: ReadonlyArray<string>): string => {
    const taken = new Set(existing.map(entry => entry.trim().toLowerCase()))
    const base = name.trim().replace(/ copy( \d+)?$/i, "")
    for (let number = 1; ; number++) {
        const candidate = number === 1 ? `${base} copy` : `${base} copy ${number}`
        if (!taken.has(candidate.toLowerCase())) {return candidate}
    }
}
