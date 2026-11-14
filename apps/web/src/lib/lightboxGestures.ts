/** The least a double tap zooms the photo in. */
export const ZOOM = 2.5
/** A zoomed photo overhangs the screen by at least this factor on both axes, so it can be moved both ways. */
const COVER = 1.2
const MAX_ZOOM = 6

/**
 * How far a double tap zooms: 2.5x, or more when that would leave the photo shorter or narrower than
 * the screen (a landscape photo on a portrait phone is only ~300px tall, so at 2.5x it has nowhere
 * to go up or down). Capped, so a panorama doesn't zoom to a blur.
 */
export function zoomScale(
  photo: { width: number; height: number },
  stage: { width: number; height: number },
): number {
  const cover = Math.max(stage.width / photo.width, stage.height / photo.height)
  return Math.min(MAX_ZOOM, Math.max(ZOOM, cover * COVER))
}

/** Pulled down or up this far (px), a photo is let go of... */
export const DISMISS_PX = 120
/** ...or from this far, if it was a quick flick (px per ms). */
const DISMISS_FLICK_PX = 40
const DISMISS_FLICK_SPEED = 0.5

/** Whether a vertical drag of `dy` px over `elapsedMs` closes the viewer. */
export function dismissOf(dy: number, elapsedMs: number): boolean {
  const far = Math.abs(dy)
  return (
    far >= DISMISS_PX ||
    (far >= DISMISS_FLICK_PX && far / Math.max(elapsedMs, 1) >= DISMISS_FLICK_SPEED)
  )
}

/**
 * How far a zoomed photo may be moved from the centre along one axis while it still covers the
 * stage: half of what it overhangs, or 0 when it is smaller than the stage (it stays centred).
 */
export const panLimit = (photoPx: number, scale: number, stagePx: number): number =>
  Math.max(0, (photoPx * scale - stagePx) / 2)

export const clampPan = (t: number, photoPx: number, scale: number, stagePx: number): number => {
  const limit = panLimit(photoPx, scale, stagePx)
  return Math.min(limit, Math.max(-limit, t))
}

/**
 * The translation that keeps the point `p` (px from the photo's centre) where it is on screen when
 * the photo, scaled about its centre, goes from 1 to `scale`: a zoom that grows from the tap.
 */
export const zoomTranslate = (p: number, scale: number): number => p * (1 - scale)

/** Two taps count as a double tap when this close in time (ms) and place (px). */
export const DOUBLE_TAP_MS = 300
export const DOUBLE_TAP_PX = 30
export const isDoubleTap = (
  a: { x: number; y: number; t: number },
  b: { x: number; y: number; t: number },
): boolean => b.t - a.t <= DOUBLE_TAP_MS && Math.hypot(b.x - a.x, b.y - a.y) <= DOUBLE_TAP_PX

/** Dragging zoom (double tap, hold, then drag): the zoom a vertical drag of `dy` px reaches from `start`. */
const DRAG_ZOOM_PX = 200 // each this many px of drag multiplies the zoom by e
export const DRAG_MAX_ZOOM = 8
/** Let go below this and the photo snaps back to fit. */
export const SNAP_BELOW = 1.05
export const dragZoomScale = (start: number, dy: number): number =>
  Math.min(DRAG_MAX_ZOOM, Math.max(1, start * Math.exp(dy / DRAG_ZOOM_PX)))
