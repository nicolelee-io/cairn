/**
 * For a dialog's `data-autofocus` on its text field: focus the field when there is a mouse and
 * keyboard, but not on a touch screen, where it would raise the on-screen keyboard at once (there
 * focus starts on the title instead, see ui/dialog.tsx).
 */
export const autofocusWithMouse = (): '' | undefined =>
  window.matchMedia('(pointer: fine)').matches ? '' : undefined

/** A touch screen is the main pointer (menus open as a sheet, haptics apply). */
export const isCoarse = (): boolean => window.matchMedia('(pointer: coarse)').matches

/**
 * iPhone and iPad (iPadOS says it is a Mac, so look for a touch screen too). Safari sends no
 * `contextmenu` on a long press, so the cards show a ⋮ button there; elsewhere right-click and
 * long-press are enough.
 */
export const isIos = (): boolean =>
  /iP(hone|ad|od)/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
