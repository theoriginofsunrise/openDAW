export namespace RegionLabel {
    // a phone: 5% bigger, like the rest of the timeline
    const scale = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches ? 1.05 : 1.0
    export const fontSize = (): number => 9 * scale
    export const labelHeight = (): number => Math.ceil(fontSize() * 1.5)
}