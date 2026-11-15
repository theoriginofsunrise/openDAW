// Phone fork: while a finger scrolls a list by hand (or two fingers pan the timeline) the edge auto-scroll must
// stay quiet, otherwise it adds its own scrolling as soon as the finger passes the edge of the area.
// Kept apart from AutoScroll.ts, which needs a browser to load.
let suspended = false

export const suspendAutoScroll = (value: boolean): void => {suspended = value}
export const isAutoScrollSuspended = (): boolean => suspended
