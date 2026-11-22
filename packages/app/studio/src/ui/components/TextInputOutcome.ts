export type TextInputOutcome = "commit" | "cancel"

/**
 * What happens when the text field of a floating input loses the focus. On a phone that is how the keyboard's OK or
 * Done key ends the typing (it closes the keyboard, it does not send Enter): what was typed is kept. Nothing typed, or
 * Escape, or a mouse (where clicking away has always meant "never mind"): it is dropped.
 */
export const blurOutcome = ({touch, escaped, value, initial}: {
    touch: boolean, escaped: boolean, value: string, initial: string
}): TextInputOutcome => !escaped && touch && value !== initial ? "commit" : "cancel"
