import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { SearchPageSchema, entryLabel } from '@cairn/shared'
import { KeyCaps } from './KeyCaps.tsx'
import { Icon } from './Icon.tsx'
import { api } from '../lib/api.ts'
import { cn } from '../lib/cn.ts'
import { keys } from '../lib/queries.ts'
import { asList } from '../lib/shortcutKeys.ts'
import {
  isLive,
  keysUsable,
  useBareKeys,
  useGoToKeys,
  useShortcutList,
  type Shortcut,
} from '../lib/shortcuts.ts'
import { closePalette, useIsPaletteOpen } from '../lib/shortcutUi.ts'

const RECENT_KEY = 'cairn:palette-recent'
const RECENT_MAX = 6

function recents(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function remember(id: string) {
  try {
    localStorage.setItem(
      RECENT_KEY,
      JSON.stringify([id, ...recents().filter((x) => x !== id)].slice(0, RECENT_MAX)),
    )
  } catch {
    // Not persisted: recent commands just aren't ranked higher next time.
  }
}

/**
 * How well a command matches what was typed: every word must appear in "group label". Higher is
 * better; null is no match. Starting the label, or a word in it, beats appearing inside one.
 */
export function score(s: Pick<Shortcut, 'group' | 'label'>, query: string): number | null {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return 0
  const label = s.label.toLowerCase()
  const hay = `${s.group} ${s.label}`.toLowerCase()
  let total = 0
  for (const w of words) {
    if (label.startsWith(w)) total += 100
    else if (label.includes(` ${w}`)) total += 60
    else if (label.includes(w)) total += 30
    else if (hay.includes(w)) total += 10
    else return null
  }
  return total
}

/** Type to find and run any command in the app (Ctrl/Cmd+K), with its shortcut shown beside it. */
export function CommandPalette() {
  const open = useIsPaletteOpen()
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      aria-label="Command palette"
      onClose={(e) => e.target === ref.current && open && closePalette()}
      onClick={(e) => e.target === ref.current && closePalette()}
      className="m-auto mt-[12vh] max-h-[min(30rem,76dvh)] w-[min(34rem,calc(100vw-2rem))] overflow-hidden rounded-xl bg-surface-container-high p-0 text-on-surface backdrop:bg-scrim/40 open:flex open:flex-col"
    >
      {open && <PaletteBody />}
    </dialog>
  )
}

/** What a row can be: a command, or an entry found by its text. */
type Option = Pick<Shortcut, 'id' | 'label' | 'group' | 'keys' | 'run'>

/** Typing at least this much also searches entry text. */
const ENTRY_SEARCH_MIN = 3

function PaletteBody() {
  const all = useShortcutList()
  const navigate = useNavigate()
  const quick = useBareKeys()
  const goTo = useGoToKeys()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const list = useRef<HTMLUListElement>(null)

  // Entries whose text matches, a short pause after typing stops. Offline it searches the journals kept on
  // this device; with none kept, the palette is just the commands.
  const [settled, setSettled] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setSettled(query.trim()), 250)
    return () => clearTimeout(t)
  }, [query])
  const found = useQuery({
    queryKey: keys.searchResults({ palette: true, q: settled }),
    enabled: settled.length >= ENTRY_SEARCH_MIN,
    queryFn: () =>
      api(`/search?${new URLSearchParams({ q: settled, sort: 'relevance', limit: '5' })}`, {
        schema: SearchPageSchema,
      }),
  })
  const entries: Option[] = useMemo(
    () =>
      settled.length < ENTRY_SEARCH_MIN
        ? []
        : (found.data?.items ?? []).map((item) => ({
            id: `entry.${item.id}`,
            group: 'Entry',
            label: entryLabel(item),
            run: () => void navigate(`/entry/${item.id}?q=${encodeURIComponent(settled)}`),
          })),
    [found.data, settled, navigate],
  )

  const commands = useMemo((): Option[] => {
    const recent = recents()
    return all
      .filter((s) => s.palette !== false && isLive(s))
      .map((s) => {
        const base = score(s, query)
        const r = recent.indexOf(s.id)
        // Recent commands lead when nothing is typed and win ties when something is.
        return { s, rank: base === null ? null : base + (r >= 0 ? RECENT_MAX - r : 0) }
      })
      .filter((x): x is { s: Shortcut; rank: number } => x.rank !== null)
      .sort((a, b) => b.rank - a.rank || a.s.label.localeCompare(b.s.label))
      .map((x) => x.s)
  }, [all, query])
  const results = useMemo(() => [...commands, ...entries], [commands, entries])

  const at = Math.min(active, Math.max(results.length - 1, 0))
  useEffect(() => {
    list.current?.children[at]?.scrollIntoView({ block: 'nearest' })
  }, [at])

  const run = (s: Option) => {
    if (!s.id.startsWith('entry.')) remember(s.id)
    closePalette()
    // After the palette has closed, so a command that opens a dialog doesn't stack on top of it.
    setTimeout(s.run, 0)
  }

  return (
    <>
      <div className="flex items-center gap-3 border-b border-outline-variant px-4">
        <Icon name="search" className="shrink-0 text-on-surface-variant" />
        <input
          autoFocus
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-results"
          aria-activedescendant={results[at] ? `palette-${results[at].id}` : undefined}
          aria-label="Type a command"
          placeholder="Type a command"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) {
              e.preventDefault()
              setActive(Math.min(at + 1, results.length - 1))
            } else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) {
              e.preventDefault()
              setActive(Math.max(at - 1, 0))
            } else if (e.key === 'Enter' && results[at]) {
              e.preventDefault()
              run(results[at])
            }
          }}
          className="h-14 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-on-surface-variant"
        />
      </div>
      <ul
        ref={list}
        id="palette-results"
        role="listbox"
        aria-label="Commands"
        className="min-h-0 flex-1 overflow-y-auto p-2 pb-4"
      >
        {results.map((s, i) => (
          <li
            key={s.id}
            id={`palette-${s.id}`}
            role="option"
            aria-selected={i === at}
            onPointerMove={() => i !== at && setActive(i)}
            onClick={() => run(s)}
            className={cn(
              'flex min-h-11 scroll-my-4 cursor-pointer items-center gap-3 rounded-lg px-3 py-1.5',
              i === at && 'bg-secondary-container text-on-secondary-container',
            )}
          >
            <span className="min-w-0 flex-1 truncate">{s.label}</span>
            <span className="shrink-0 text-xs text-on-surface-variant">{s.group}</span>
            {s.keys && keysUsable(s, quick, goTo) && <KeyCaps keys={asList(s.keys)[0] ?? []} />}
          </li>
        ))}
        {results.length === 0 && (
          <li className="px-3 py-6 text-center text-on-surface-variant">No matching command.</li>
        )}
      </ul>
    </>
  )
}
