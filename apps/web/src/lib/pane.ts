import { createContext, useContext } from 'react'

/**
 * True for a page shown in Settings' detail pane (`layout/SettingsLayout.tsx`). From 840px the
 * settings list sits beside it, so its top bar drops Back, search and the sync dot there.
 */
export const InSettingsPane = createContext(false)

export const useInSettingsPane = () => useContext(InSettingsPane)

/** From this width Settings shows its list beside the page (the same 840px as Browse's two panes). */
export const TWO_PANE = '(min-width: 840px)'
