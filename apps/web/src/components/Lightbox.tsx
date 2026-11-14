import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react'
import type { Photo } from '@cairn/shared'
import {
  SNAP_BELOW,
  clampPan,
  dismissOf,
  dragZoomScale,
  isDoubleTap,
  zoomScale,
  zoomTranslate,
} from '../lib/lightboxGestures.ts'
import { swipeOf } from '../lib/useSwipe.ts'
import { photoUrl } from '../lib/photos.ts'
import { Icon } from './Icon.tsx'
import { Button } from './ui/button.tsx'

const EASE = 'cubic-bezier(0.2, 0, 0, 1)'
const SLIDE_MS = 200
/** Before this much travel (px) a touch is still a tap. */
const DRAG_SLOP_PX = 8
/** The backdrop's strongest black, and how far a vertical pull (as a share of the height) fades it out. */
const SHADE = 0.9
/** How much of a drag the photos follow when there is no photo that way (a rubber band). */
const RESISTANCE = 0.3
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

type Mode = 'idle' | 'page' | 'dismiss' | 'pan' | 'zoom'

interface Gesture {
  pointer: number
  x: number
  y: number
  t: number
  mode: Mode
  /** This touch is the second tap of a double tap: released in place it toggles the zoom, dragged up or down it sets the zoom. */
  second: boolean
  /** The zoom when the finger went down, which a dragging zoom starts from. */
  startScale: number
  /** The zoomed photo's offset when the finger went down, so a pan moves from there. */
  fromX: number
  fromY: number
}

/**
 * Full-screen photo viewer on the native <dialog> (focus trap, Esc and the top layer come from the
 * browser). Arrow keys, the buttons and a horizontal drag move between the entry's photos (the
 * neighbours sit beside the current one, so the next photo slides in as you drag); a vertical
 * drag lets go of the viewer; a double tap (or double click) zooms in on the tapped spot, and
 * while zoomed a drag moves the photo instead. The display-size copy is shown, with a link to the
 * untouched original. The gestures move elements directly (no render per pointer move).
 */
export function Lightbox({
  photos,
  openId,
  onClose,
  onChange,
}: {
  photos: Photo[]
  /** The photo being shown; null closes the viewer. */
  openId: string | null
  onClose: () => void
  onChange: (id: string) => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const track = useRef<HTMLDivElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const zoom = useRef({ scale: 1, x: 0, y: 0 })
  const lastTap = useRef<{ x: number; y: number; t: number } | null>(null)
  // A drag or a pan ends in a click on the stage, which would close the viewer.
  const suppressClick = useRef(false)
  // The slide-out that holds the old photo off screen until the new one is in place.
  const leaving = useRef<Animation | null>(null)
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(new Set())
  const index = photos.findIndex((p) => p.id === openId)
  const open = index >= 0

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) {
      d.getAnimations().forEach((a) => a.cancel())
      d.style.backgroundColor = ''
      d.showModal()
    }
    if (!open && d.open) d.close()
  }, [open])

  // A different photo (a swipe, a button, an arrow key): everything back to rest.
  useLayoutEffect(() => {
    leaving.current?.cancel()
    leaving.current = null
    if (track.current) track.current.style.transform = ''
    zoom.current = { scale: 1, x: 0, y: 0 }
    stage.current?.querySelectorAll<HTMLElement>('img').forEach((img) => (img.style.transform = ''))
  }, [openId])

  const go = (dir: -1 | 1) => {
    const next = photos[index + dir]
    if (next) onChange(next.id)
  }

  const currentImg = () => track.current?.querySelector<HTMLElement>('[data-current] img') ?? null

  const showZoom = (animate: boolean) => {
    const img = currentImg()
    if (!img) return
    const { scale, x, y } = zoom.current
    const from = img.style.transform || 'none'
    const to = scale === 1 ? '' : `translate(${x}px, ${y}px) scale(${scale})`
    img.style.transform = to
    if (animate && !reducedMotion())
      img.animate([{ transform: from }, { transform: to || 'none' }], {
        duration: SLIDE_MS,
        easing: EASE,
      })
  }

  const toggleZoom = (clientX: number, clientY: number) => {
    const img = currentImg()
    const box = stage.current?.getBoundingClientRect()
    if (!img || !box) return
    if (zoom.current.scale > 1) zoom.current = { scale: 1, x: 0, y: 0 }
    else {
      const px = clientX - (box.left + box.width / 2)
      const py = clientY - (box.top + box.height / 2)
      const scale = zoomScale({ width: img.offsetWidth, height: img.offsetHeight }, box)
      zoom.current = {
        scale,
        x: clampPan(zoomTranslate(px, scale), img.offsetWidth, scale, box.width),
        y: clampPan(zoomTranslate(py, scale), img.offsetHeight, scale, box.height),
      }
    }
    showZoom(true)
  }

  const shade = (dy: number) => {
    const d = ref.current
    if (d)
      d.style.backgroundColor = `rgba(0, 0, 0, ${SHADE * (1 - Math.min(Math.abs(dy) / (d.offsetHeight / 2), 1))})`
  }

  /** Back to rest from wherever the finger let go. */
  const settle = () => {
    const el = track.current
    const d = ref.current
    if (!el || !d) return
    const { transform } = el.style
    const shaded = d.style.backgroundColor
    el.style.transform = ''
    d.style.backgroundColor = ''
    if (reducedMotion()) return
    if (transform)
      el.animate([{ transform }, { transform: 'none' }], { duration: SLIDE_MS, easing: EASE })
    if (shaded)
      d.animate([{ backgroundColor: shaded }, { backgroundColor: `rgba(0, 0, 0, ${SHADE})` }], {
        duration: SLIDE_MS,
      })
  }

  const slideTo = (dir: -1 | 1) => {
    const el = track.current
    if (!el || reducedMotion()) return go(dir)
    // The next photo is already beside this one; the layout effect above cancels this once it is current.
    const out = el.animate(
      [
        { transform: el.style.transform || 'none' },
        { transform: `translateX(${dir === 1 ? '-100%' : '100%'})` },
      ],
      { duration: SLIDE_MS, easing: EASE, fill: 'forwards' },
    )
    leaving.current = out
    out.onfinish = () => go(dir)
  }

  const dismiss = (dy: number) => {
    const el = track.current
    const d = ref.current
    if (!el || !d || reducedMotion()) return onClose()
    const off = `translateY(${dy < 0 ? '-' : ''}${stage.current?.offsetHeight ?? 800}px)`
    el.animate([{ transform: el.style.transform || 'none' }, { transform: off }], {
      duration: SLIDE_MS,
      easing: 'ease-in',
      fill: 'forwards',
    })
    const fade = d.animate(
      [
        { backgroundColor: d.style.backgroundColor || `rgba(0, 0, 0, ${SHADE})` },
        { backgroundColor: 'rgba(0, 0, 0, 0)' },
      ],
      { duration: SLIDE_MS, fill: 'forwards' },
    )
    fade.onfinish = onClose
  }

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    gesture.current = null
    suppressClick.current = false
    if (!e.isPrimary || (e.target as Element).closest('button, a')) return
    const { scale, x, y } = zoom.current
    const here = { x: e.clientX, y: e.clientY, t: e.timeStamp }
    gesture.current = {
      pointer: e.pointerId,
      ...here,
      mode: 'idle',
      second:
        e.target instanceof HTMLImageElement &&
        !!lastTap.current &&
        isDoubleTap(lastTap.current, here),
      startScale: scale,
      fromX: x,
      fromY: y,
    }
  }

  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const g = gesture.current
    if (!g || g.pointer !== e.pointerId) return
    const dx = e.clientX - g.x
    const dy = e.clientY - g.y
    if (g.mode === 'idle') {
      if (Math.hypot(dx, dy) < DRAG_SLOP_PX) return
      // After a double tap a vertical drag sets the zoom; else, zoomed, a drag pans; otherwise the
      // first direction decides.
      if (g.second && Math.abs(dy) > Math.abs(dx)) {
        g.mode = 'zoom'
        lastTap.current = null
      } else
        g.mode = zoom.current.scale > 1 ? 'pan' : Math.abs(dx) >= Math.abs(dy) ? 'page' : 'dismiss'
      suppressClick.current = true
      stage.current?.setPointerCapture(e.pointerId)
    }
    const el = track.current
    if (!el) return
    if (g.mode === 'page') {
      const there = photos[index + (dx < 0 ? 1 : -1)]
      el.style.transform = `translateX(${there ? dx : dx * RESISTANCE}px)`
    } else if (g.mode === 'dismiss') {
      el.style.transform = `translateY(${dy}px)`
      shade(dy)
    } else if (g.mode === 'zoom') {
      const img = currentImg()
      const box = stage.current?.getBoundingClientRect()
      if (!img || !box) return
      const scale = dragZoomScale(g.startScale, dy)
      // The tapped point stays where it is: the spot of the photo under it (q, from the photo's
      // centre, unscaled) is put back under it at the new scale.
      const px = g.x - (box.left + box.width / 2)
      const py = g.y - (box.top + box.height / 2)
      const qx = (px - g.fromX) / g.startScale
      const qy = (py - g.fromY) / g.startScale
      zoom.current = {
        scale,
        x: clampPan(px - scale * qx, img.offsetWidth, scale, box.width),
        y: clampPan(py - scale * qy, img.offsetHeight, scale, box.height),
      }
      showZoom(false)
    } else {
      const img = currentImg()
      const box = stage.current?.getBoundingClientRect()
      if (!img || !box) return
      const { scale } = zoom.current
      zoom.current.x = clampPan(g.fromX + dx, img.offsetWidth, scale, box.width)
      zoom.current.y = clampPan(g.fromY + dy, img.offsetHeight, scale, box.height)
      showZoom(false)
    }
  }

  const onPointerUp = (e: PointerEvent<HTMLElement>) => {
    const g = gesture.current
    if (!g || g.pointer !== e.pointerId) return
    gesture.current = null
    const dx = e.clientX - g.x
    const dy = e.clientY - g.y
    const elapsed = e.timeStamp - g.t
    if (g.mode === 'page') {
      const direction = swipeOf(dx, dy, elapsed)
      const dir = direction === 'left' ? 1 : -1
      if (direction && photos[index + dir]) slideTo(dir)
      else settle()
    } else if (g.mode === 'dismiss') {
      if (dismissOf(dy, elapsed)) dismiss(dy)
      else settle()
    } else if (g.mode === 'zoom') {
      if (zoom.current.scale < SNAP_BELOW) {
        zoom.current = { scale: 1, x: 0, y: 0 }
        showZoom(true)
      }
    } else if (g.mode === 'idle' && e.target instanceof HTMLImageElement) {
      if (g.second) {
        lastTap.current = null
        toggleZoom(e.clientX, e.clientY)
      } else lastTap.current = { x: e.clientX, y: e.clientY, t: e.timeStamp }
    }
  }

  const onPointerCancel = () => {
    const g = gesture.current
    gesture.current = null
    if (g?.mode === 'page' || g?.mode === 'dismiss') settle()
  }

  // The photo being shown and its neighbours, side by side, so a drag can show the next one arrive.
  const slides = [-1, 0, 1].flatMap((offset) => {
    const p = photos[index + offset]
    return p ? [{ photo: p, offset }] : []
  })
  const photo = photos[index]
  return (
    <dialog
      ref={ref}
      aria-label="Photo viewer"
      data-no-swipe="" // it sits inside the reader, whose swipe between entries must leave its drags alone
      onClose={(e) => e.target === ref.current && open && onClose()}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') go(-1)
        else if (e.key === 'ArrowRight') go(1)
      }}
      // The dialog itself is the shade (so a vertical pull can fade it); the browser's backdrop is clear.
      className="m-0 size-full max-h-none max-w-none overflow-hidden bg-black/90 p-0 text-white backdrop:bg-transparent"
    >
      {photo && (
        <div
          ref={stage}
          className="relative size-full touch-none overflow-hidden select-none"
          onClick={(e) => {
            if (suppressClick.current) suppressClick.current = false
            else if (e.target === e.currentTarget) onClose()
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
        >
          <div ref={track} className="absolute inset-0">
            {slides.map(({ photo: p, offset }) => (
              <div
                key={p.id}
                data-current={offset === 0 ? '' : undefined}
                // Only the photo takes pointer events, so a tap on the empty space around it closes the viewer.
                className="pointer-events-none absolute inset-0 flex items-center justify-center"
                style={{ transform: `translateX(${offset * 100}%)` }}
              >
                <img
                  src={photoUrl(p.id, 'display')}
                  alt=""
                  draggable={false}
                  onLoad={() => setLoaded((s) => new Set(s).add(p.id))}
                  className={`pointer-events-auto max-h-full max-w-full object-contain transition-opacity ${
                    loaded.has(p.id) ? 'opacity-100' : 'opacity-0'
                  }`}
                />
              </div>
            ))}
          </div>
          <div className="absolute inset-x-0 top-0 flex items-center gap-1 bg-gradient-to-b from-black/60 to-transparent p-2">
            <Button
              variant="text"
              size="icon"
              aria-label="Close"
              onClick={onClose}
              className="text-white"
            >
              <Icon name="close" />
            </Button>
            <span aria-live="polite" className="flex-1 text-sm">
              {index + 1} of {photos.length}
            </span>
            <a
              href={`${photoUrl(photo.id, 'original')}?download`}
              download
              aria-label="Download the original"
              title="Download the original"
              className="state-layer grid size-10 place-items-center rounded-full"
            >
              <Icon name="download" />
            </a>
          </div>
          {photos.length > 1 && (
            <>
              <Button
                variant="text"
                size="icon"
                aria-label="Previous photo"
                disabled={index === 0}
                onClick={() => go(-1)}
                className="absolute top-1/2 left-2 hidden -translate-y-1/2 text-white medium:inline-flex"
              >
                <Icon name="chevron_left" />
              </Button>
              <Button
                variant="text"
                size="icon"
                aria-label="Next photo"
                disabled={index === photos.length - 1}
                onClick={() => go(1)}
                className="absolute top-1/2 right-2 hidden -translate-y-1/2 text-white medium:inline-flex"
              >
                <Icon name="chevron_right" />
              </Button>
            </>
          )}
        </div>
      )}
    </dialog>
  )
}
