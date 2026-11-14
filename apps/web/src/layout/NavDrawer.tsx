import { useEffect, useRef, useState } from 'react'
import { NavContent } from './NavContent.tsx'
import { useSwipe } from '../lib/useSwipe.ts'
import { useNavDrawer } from './useNavDrawer.ts'

/**
 * The sidebar as a modal sheet that slides in from the left (native <dialog>: Esc, focus trap).
 * Closing plays the slide back first (the `closing` class), then closes the dialog.
 */
export function NavDrawer() {
  const { open, setOpen } = useNavDrawer()
  const ref = useRef<HTMLDialogElement>(null)
  // Kept true until the slide-out ends, so the menu doesn't empty while it is leaving.
  const [shown, setShown] = useState(false)
  if (open && !shown) setShown(true)

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open) {
      d.classList.remove('closing')
      d.style.transform = '' // left over from a drag that was let go
      if (!d.open) d.showModal()
      return
    }
    if (!d.open) return
    const finish = () => {
      d.classList.remove('closing')
      d.close()
      setShown(false)
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return d.close()
    d.classList.add('closing')
    d.addEventListener('animationend', finish, { once: true })
    return () => d.removeEventListener('animationend', finish)
  }, [open])

  // A swipe left on the drawer closes it: it follows the finger, and the usual slide-out carries on
  // from where it was (the closing keyframes only name where it ends). Opening stays on the button.
  const swipe = useSwipe((direction) => direction === 'left' && setOpen(false), {
    onDrag: (dx) => {
      const d = ref.current
      if (!d) return
      if (dx !== null) return void (d.style.transform = `translateX(${Math.min(0, dx)}px)`)
      const from = d.style.transform
      d.style.transform = ''
      if (from && !window.matchMedia('(prefers-reduced-motion: reduce)').matches)
        d.animate([{ transform: from }, { transform: 'none' }], {
          duration: 200,
          easing: 'cubic-bezier(0.2, 0, 0, 1)',
        })
    },
  })

  return (
    <dialog
      ref={ref}
      aria-label="Menu"
      {...swipe}
      className="drawer"
      onCancel={(e) => {
        e.preventDefault() // Esc: go through the closing animation
        setOpen(false)
      }}
      // The `close` event of our own d.close() arrives as a later task: if the drawer was opened
      // again in between, it is open now and the event is stale.
      onClose={(e) => !e.currentTarget.open && setOpen(false)}
      onClick={(e) => e.target === ref.current && setOpen(false)} // a click on the backdrop
    >
      {shown && <NavContent onNavigate={() => setOpen(false)} />}
    </dialog>
  )
}
