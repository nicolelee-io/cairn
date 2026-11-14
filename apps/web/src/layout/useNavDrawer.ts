import { createContext, useContext } from 'react'

/** The slide-out menu used below the `large` breakpoint, where there is no permanent sidebar. */
export const NavDrawerContext = createContext<{ open: boolean; setOpen: (open: boolean) => void }>({
  open: false,
  setOpen: () => {},
})

export const useNavDrawer = () => useContext(NavDrawerContext)
