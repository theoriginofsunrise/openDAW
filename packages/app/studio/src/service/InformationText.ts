// What the bottom status line of the app shows on a computer, as the text of the Information window (on a phone the
// line is hidden to leave room for the project).
export type InformationValues = {
    readonly online: boolean
    readonly project: string | null
    readonly sampleRate: number
    // seconds
    readonly outputLatency: number
    readonly build: string
    // milliseconds since 1970, or NaN
    readonly buildTime: number
    // the email signed in to the storage server, "" when not signed in, null when this build has no such server
    readonly signedInAs: string | null
}

export const informationText = (values: InformationValues): string => {
    const latency = values.outputLatency > 0 ? `${(values.outputLatency * 1000).toFixed(1)} ms` : "not known yet"
    const lines = [
        `Online: ${values.online ? "yes" : "no"}`,
        `Project: ${values.project ?? "none open"}`,
        `Sample rate: ${values.sampleRate / 1000} kHz`,
        `Output latency: ${latency}`,
        `Build: ${values.build}${Number.isFinite(values.buildTime) ? ` (${new Date(values.buildTime).toISOString().slice(0, 16).replace("T", " ")} UTC)` : ""}`
    ]
    if (values.signedInAs !== null) {
        lines.push(`Storage server: ${values.signedInAs === "" ? "not signed in" : `signed in as ${values.signedInAs}`}`)
    }
    return lines.join("\n")
}
