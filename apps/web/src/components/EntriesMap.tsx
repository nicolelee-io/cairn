import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { MapDataSchema, type MapPoint } from '@cairn/shared'
import L from '../lib/leaflet.ts'
import 'leaflet/dist/leaflet.css'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import { api } from '../lib/api.ts'
import { fullDate } from '../lib/format.ts'
import { densestArea } from '../lib/mapFocus.ts'
import { keys, useJournals } from '../lib/queries.ts'
import { useServerDown } from '../lib/serverStatus.ts'
import { useBrowseParams } from '../lib/useBrowseParams.ts'
import { Icon } from './Icon.tsx'
import { Spinner } from './Spinner.tsx'

const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'

function pinIcon(color: string) {
  const dot = document.createElement('span')
  if (color) dot.style.background = color
  return L.divIcon({ className: 'cairn-pin', html: dot, iconSize: [22, 22], iconAnchor: [11, 22] })
}

function clusterIcon(count: number) {
  const n = document.createElement('span')
  n.textContent = String(count)
  n.setAttribute('aria-label', `${count} entries`)
  return L.divIcon({ className: 'cairn-cluster', html: n, iconSize: [38, 38] })
}

/** The Entries screen's map view: every entry with a place as a pin, clustered; a pin opens a card. */
export default function EntriesMap() {
  const { journalId, entryId, base } = useBrowseParams()
  const navigate = useNavigate()
  const journals = useJournals()
  const journalById = useMemo(() => new Map(journals.data?.map((j) => [j.id, j])), [journals.data])
  const down = useServerDown()

  // Under 'entries', so saving, moving or deleting an entry refreshes the pins like the list.
  const data = useQuery({
    queryKey: keys.map(journalId),
    queryFn: () =>
      api(`/entries/map${journalId ? `?journalId=${journalId}` : ''}`, { schema: MapDataSchema }),
  })

  const box = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const cluster = useRef<L.MarkerClusterGroup | null>(null)
  const fittedFor = useRef<string | null>(null)
  // Whether the opening view is only part of the pins (then "Show all" has something to show).
  const [partial, setPartial] = useState(false)
  // Popups outlive renders; they open an entry through the latest route (replacing the one open).
  const open = useRef((id: string) => navigate(`${base}/entry/${id}`, { replace: !!entryId }))
  useEffect(() => {
    open.current = (id) => navigate(`${base}/entry/${id}`, { replace: !!entryId })
  })

  useEffect(() => {
    const el = box.current
    if (!el) return
    const m = L.map(el, { attributionControl: false, worldCopyJump: true }).setView([20, 0], 2)
    L.tileLayer(TILES, {
      maxZoom: 19,
      // The default policy (no-referrer) would strip the Referer OpenStreetMap's tile rules want.
      referrerPolicy: 'strict-origin-when-cross-origin',
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
    }).addTo(m)
    // Bottom left: the New entry button covers the bottom right on a phone.
    L.control.attribution({ position: 'bottomleft', prefix: false }).addTo(m)
    const group = L.markerClusterGroup({
      showCoverageOnHover: false,
      maxClusterRadius: 50,
      iconCreateFunction: (c) => clusterIcon(c.getChildCount()),
    })
    m.addLayer(group)
    // The map is created while hidden on a phone (the reader covers it) and resizes with the panes.
    const ro = new ResizeObserver(() => m.invalidateSize())
    ro.observe(el)
    map.current = m
    cluster.current = group
    return () => {
      ro.disconnect()
      m.remove()
      map.current = null
      cluster.current = null
      fittedFor.current = null
    }
  }, [])

  useEffect(() => {
    const m = map.current
    const group = cluster.current
    if (!m || !group || !data.data) return
    group.clearLayers()
    const markers = data.data.points.map((p) => {
      const marker = L.marker([p.latitude, p.longitude], {
        icon: pinIcon(journalById.get(p.journalId)?.color ?? ''),
      })
      // A divIcon has no <img> to carry `alt`, so name the pin for screen readers when it is added.
      marker.on('add', () =>
        marker.getElement()?.setAttribute('aria-label', p.title || p.placeName || 'Entry'),
      )
      marker.bindPopup(() => card(p, (id) => open.current(id)), {
        closeButton: false,
        minWidth: 200,
        maxWidth: 260,
      })
      return marker
    })
    group.addLayers(markers)
    // Frame the pins the first time (and again when the journal changes), not after every refresh,
    // so editing an entry doesn't throw away where the map was panned. The opening view is the most
    // crowded neighbourhood, not the whole globe; "Show all" widens it.
    const key = journalId ?? 'all'
    if (markers.length > 0 && fittedFor.current !== key) {
      const focus = densestArea(data.data.points)
      m.fitBounds(L.latLngBounds(focus.map((p) => [p.latitude, p.longitude] as [number, number])), {
        padding: [48, 48],
        maxZoom: 15,
      })
      fittedFor.current = key
      setPartial(focus.length < markers.length)
    }
  }, [data.data, journalById, journalId])

  const placed = data.data?.points.length ?? 0
  const total = data.data?.total ?? 0

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-on-surface-variant" aria-live="polite">
        {data.isPending ? (
          <Spinner size="sm" />
        ) : data.isError ? (
          down ? (
            'You’re offline. Reconnect to see the map.'
          ) : (
            'Couldn’t load the map.'
          )
        ) : (
          `${placed} of ${total} ${total === 1 ? 'entry has' : 'entries have'} a place`
        )}
      </p>
      <div className="relative isolate">
        <div
          ref={box}
          role="region"
          aria-label="Map of entries"
          className="h-[calc(100dvh-13.75rem)] min-h-72 overflow-hidden rounded-lg bg-surface-container expanded:h-[calc(100dvh-10.25rem)]"
        />
        {partial && (
          <button
            type="button"
            onClick={() => {
              const group = cluster.current
              if (group)
                map.current?.fitBounds(group.getBounds(), { padding: [48, 48], maxZoom: 15 })
              setPartial(false)
            }}
            className="state-layer absolute top-4 right-4 z-[1000] inline-flex h-10 cursor-pointer items-center gap-2 rounded-full bg-surface-container-high px-4 text-sm shadow-md"
          >
            <Icon name="zoom_out_map" className="size-5" />
            Show all
          </button>
        )}
        {data.isSuccess && placed === 0 && (
          <p className="absolute inset-x-4 top-4 z-[1000] rounded-lg bg-surface-container-high/95 p-3 text-center text-sm">
            No entries here have a place yet. Add one in the editor to see it on the map.
          </p>
        )}
      </div>
    </div>
  )
}

/** A pin's card, built from DOM nodes so an entry's text is never parsed as HTML. */
function card(p: MapPoint, onOpen: (id: string) => void): HTMLElement {
  const el = document.createElement('div')
  el.className = 'cairn-card'
  if (p.title) {
    const t = document.createElement('p')
    t.className = 'cairn-card-title'
    t.textContent = p.title
    el.append(t)
  }
  const meta = document.createElement('p')
  meta.className = 'cairn-card-meta'
  meta.textContent = [fullDate(p.createdAt, p.timezone), p.placeName].filter(Boolean).join(' · ')
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.textContent = 'Open entry'
  btn.addEventListener('click', () => onOpen(p.id))
  el.append(meta, btn)
  return el
}
