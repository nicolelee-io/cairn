import { useEffect, useState } from 'react'

/**
 * How many px of the layout viewport the on-screen keyboard covers (0 when it is closed).
 * iOS Safari leaves the layout viewport alone when the keyboard opens and shrinks only the visual
 * viewport, so anything pinned to the bottom (the editor toolbar) hides behind the keyboard unless
 * it lifts by this amount. Chrome on Android is told to resize the layout viewport instead
 * (`interactive-widget=resizes-content` in index.html), where this stays 0.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const update = () => {
      // Pinch-zoom also shrinks the visual viewport; that is not a keyboard.
      const covered =
        vv.scale > 1.01 ? 0 : Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
      // Ignore small differences (browser chrome sliding in and out).
      setInset(covered > 80 ? Math.round(covered) : 0)
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])
  return inset
}
