import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { useMe } from '../../auth/useAuth.ts'
import { Icon, type IconName } from '../../components/Icon.tsx'
import { KeyCaps } from '../../components/KeyCaps.tsx'
import { cn } from '../../lib/cn.ts'
import { TWO_PANE } from '../../lib/pane.ts'
import { openShortcutHelp } from '../../lib/shortcutUi.ts'
import { useMediaQuery } from '../../lib/useMediaQuery.ts'

interface Tip {
  icon: IconName
  title: string
  body: ReactNode
  /** Shown only where it can be done: a touch screen, a mouse or trackpad (with a keyboard), or a wide window. */
  only?: 'touch' | 'mouse' | 'wide'
  /** The row opens this page… */
  to?: string
  /** …or runs this. */
  run?: () => void
}

interface Section {
  title: string
  tips: Tip[]
}

/** A placeholder inside a sentence. */
const C = ({ children }: { children: string }) => (
  <code className="rounded bg-surface-container px-1 font-mono text-xs">{children}</code>
)

/** Keys inside a sentence. */
const K = ({ keys }: { keys: string }) => (
  <span className="mx-0.5 inline-flex align-middle">
    <KeyCaps keys={keys} />
  </span>
)

/**
 * The tips, by topic. Keep each one to what it does and where to find it; when a gesture or a menu
 * changes, check its tip here too.
 */
function tipSections(trashDays: number): Section[] {
  return [
    {
      title: 'Writing',
      tips: [
        {
          icon: 'edit',
          title: 'Start in a chosen journal',
          body: 'Press and hold (or right-click) the New entry button to pick the journal to write in. The tick shows where a plain tap goes. It lists your first four journals once you have two or more.',
        },
        {
          icon: 'auto_stories',
          title: 'Where new entries go',
          body: 'While you’re browsing one journal, New entry writes there. Everywhere else it uses your default journal: press and hold a journal in the menu and choose Make default for new entries.',
        },
        {
          icon: 'lightbulb',
          title: 'Write from a prompt',
          body: 'Tap a prompt on the Prompts page to start an entry with it as the heading. Changed your mind? Just leave; nothing is kept until you write something.',
        },
        {
          icon: 'description',
          title: 'Templates',
          body: (
            <>
              Save text you write often with Save as template… in the editor’s Templates menu, then
              insert it from the same menu. <C>{'{{date}}'}</C>, <C>{'{{time}}'}</C>,{' '}
              <C>{'{{weekday}}'}</C> and <C>{'{{datetime}}'}</C> fill themselves in.
            </>
          ),
          to: '/templates',
        },
        {
          icon: 'format_list_bulleted',
          title: 'Slash commands',
          body: 'Type / at the start of a line for headings, lists, a checklist, a table, today’s date or one of your templates. Keep typing to narrow the list.',
          only: 'mouse',
        },
        {
          icon: 'add_photo_alternate',
          title: 'Paste or drop photos',
          body: 'Paste a photo, or drag photos and files onto the text, to add them where the cursor is. Tap a photo in the text to move it up or down, view it or remove it.',
        },
        {
          icon: 'mood',
          title: 'Clear a mood',
          body: 'Tap the chosen mood again to take it off.',
        },
        {
          icon: 'location_on',
          title: 'Name a place',
          body: 'In the Place dialog, give the spot a name of your own, like “Home” or “Grandma’s”.',
        },
        {
          icon: 'edit_note',
          title: 'Drafts',
          body: 'Leave an entry before saving and you can keep it as a draft. Drafts stay on this device and are listed under Drafts in the menu.',
        },
        {
          icon: 'link',
          title: 'Open a link while writing',
          body: 'Put the cursor in a link and tap Open link, or Ctrl-click (Cmd-click on a Mac) it.',
        },
        {
          icon: 'code',
          title: 'See the Markdown',
          body: 'The </> button in the editor shows the plain text with its formatting marks, for when the styling gets in the way.',
        },
        {
          icon: 'fullscreen',
          title: 'Zen mode',
          body: 'The full-screen button in the editor or the reader hides everything but the entry.',
          only: 'wide',
        },
      ],
    },
    {
      title: 'Reading and browsing',
      tips: [
        {
          icon: 'vertical_align_top',
          title: 'Back to the top',
          body: 'Tap the title at the top of a screen to scroll back up.',
        },
        {
          icon: 'swipe',
          title: 'Swipe between views',
          body: 'Swipe sideways on the entry list to move through Details, List, Calendar, Media and Map.',
          only: 'touch',
        },
        {
          icon: 'swipe',
          title: 'Swipe between entries',
          body: 'While reading, swipe left for the older entry and right for the newer one.',
          only: 'touch',
        },
        {
          icon: 'touch_app',
          title: 'Press and hold for more',
          body: 'Press and hold (or right-click) an entry, a calendar day, a photo in Media or a prompt to see what you can do with it: pin, star, move, export, delete and more.',
        },
        {
          icon: 'checklist',
          title: 'Tick off a checklist',
          body: 'Tap a checkbox in an entry to tick it, without opening the editor.',
        },
        {
          icon: 'calendar_month',
          title: 'Jump to a month',
          body: 'In the List, tap a month’s heading to jump to any month you wrote in.',
        },
        {
          icon: 'sell',
          title: 'Browse by tag',
          body: 'Tap a tag under an entry to see every entry with that tag.',
        },
        {
          icon: 'partly_cloudy_day',
          title: 'Place and weather details',
          body: 'Tap the place under an entry for its address, coordinates and a map link, or the weather for humidity and wind.',
        },
        {
          icon: 'zoom_out_map',
          title: 'Photo viewer',
          body: 'Double-tap to zoom, or double-tap and drag up or down to zoom smoothly. Swipe sideways for the next photo and down to close.',
        },
        {
          icon: 'content_copy',
          title: 'Copy an entry’s text',
          body: 'The ⋮ menu beside Edit has Copy markdown, ready to paste anywhere.',
        },
        {
          icon: 'delete',
          title: 'Undo a delete',
          body: `A deleted entry goes to the Trash, and the message that pops up has Undo. The Trash keeps it for ${trashDays} days.`,
          to: '/trash',
        },
      ],
    },
    {
      title: 'Insights and search',
      tips: [
        {
          icon: 'bar_chart',
          title: 'Swipe through Insights',
          body: 'Swipe the Stats card to switch between Week, Month and All time, and the mood calendar to change month.',
          only: 'touch',
        },
        {
          icon: 'info',
          title: 'What the calendar shows',
          body: 'The ⓘ on the mood calendar explains its emoji, the +N badges and the colours.',
        },
        {
          icon: 'history',
          title: 'On this day',
          body: 'Insights shows what you wrote on today’s date in earlier years.',
        },
        {
          icon: 'search',
          title: 'Search more than words',
          body: 'Search also finds tags and place names, and its filters narrow results by journal, tag, mood, dates, starred entries and attachments.',
        },
      ],
    },
    {
      title: 'Organizing',
      tips: [
        {
          icon: 'drag_indicator',
          title: 'Put your journals in order',
          body: 'Drag the handle beside a journal in Manage journals. The menu and the New entry button follow that order.',
          to: '/journals',
        },
        {
          icon: 'add_reaction',
          title: 'Give a journal an emoji',
          body: 'The pencil beside a journal in Manage journals sets its colour and icon, and any emoji you type can be the icon.',
        },
        {
          icon: 'sell',
          title: 'Merge tags',
          body: 'In Manage tags, rename a tag to the name of another and the two become one.',
          to: '/tags',
        },
      ],
    },
    {
      title: 'This device',
      tips: [
        {
          icon: 'mobile',
          title: 'Install Cairn as an app',
          body: 'Choose Install app or Add to Home screen in your browser’s menu to open Cairn full screen, like any other app.',
        },
        {
          icon: 'cloud_off',
          title: 'Write without a connection',
          body: 'What you write offline is saved and sent when you’re back. To read and search offline too, keep journals on this device in Offline & sync.',
          to: '/sync',
        },
        {
          icon: 'palette',
          title: 'Make it yours',
          body: 'Appearance has the theme, the entry font and size (each device keeps its own), and switches for the bottom bar, a word count for the editor and streaks.',
          to: '/settings/appearance',
        },
      ],
    },
    {
      title: 'Keyboard',
      tips: [
        {
          icon: 'help',
          title: 'See every shortcut',
          body: (
            <>
              Press <K keys="?" /> on any screen.
            </>
          ),
          only: 'mouse',
          run: () => openShortcutHelp(true),
        },
        {
          icon: 'search',
          title: 'Command palette',
          body: (
            <>
              <K keys="Mod+K" /> finds an entry, a setting or an action by name.
            </>
          ),
          only: 'mouse',
        },
        {
          icon: 'keyboard',
          title: 'Single-key shortcuts',
          body: (
            <>
              <K keys="j" /> and <K keys="k" /> move through entries, <K keys="e" /> edits,{' '}
              <K keys="n" /> starts a new entry, <K keys="/" /> searches and <K keys="1" /> to{' '}
              <K keys="5" /> switch views.
            </>
          ),
          only: 'mouse',
        },
        {
          icon: 'check',
          title: 'Save as you go',
          body: (
            <>
              <K keys="Mod+S" /> saves and keeps you writing; <K keys="Mod+Shift+S" /> saves and
              closes.
            </>
          ),
          only: 'mouse',
        },
        {
          icon: 'tune',
          title: 'Go-to keys',
          body: (
            <>
              Turn them on in Keyboard settings, then press <K keys="g" /> and a letter to jump
              somewhere: <K keys="g s" /> opens Settings.
            </>
          ),
          only: 'mouse',
          to: '/settings/keyboard',
        },
      ],
    },
  ]
}

function TipRow({ tip }: { tip: Tip }) {
  const body = (
    <>
      <Icon name={tip.icon} className="mt-0.5 shrink-0 text-on-surface-variant" />
      <span className="min-w-0 flex-1">
        <span className="block">{tip.title}</span>
        <span className="block text-sm text-on-surface-variant">{tip.body}</span>
      </span>
      {(tip.to || tip.run) && (
        <Icon name="chevron_right" className="shrink-0 self-center text-on-surface-variant" />
      )}
    </>
  )
  const cls = 'flex items-start gap-4 px-4 py-3 text-left'
  return (
    <li>
      {tip.to ? (
        <Link to={tip.to} className={cn(cls, 'state-layer')}>
          {body}
        </Link>
      ) : tip.run ? (
        <button type="button" onClick={tip.run} className={cn(cls, 'state-layer w-full')}>
          {body}
        </button>
      ) : (
        <div className={cls}>{body}</div>
      )}
    </li>
  )
}

/** Settings > Tips & tricks: the gestures, menus and keys that aren't obvious, for this device. */
export function TipsContent() {
  const days = useMe().data?.trashRetentionDays ?? 60
  const touch = useMediaQuery('(any-pointer: coarse)')
  const mouse = useMediaQuery('(any-pointer: fine)')
  const wide = useMediaQuery(TWO_PANE)
  const fits = (t: Tip) =>
    !t.only ||
    (t.only === 'touch' && touch) ||
    (t.only === 'mouse' && mouse) ||
    (t.only === 'wide' && wide)

  return (
    <>
      {tipSections(days).map((s) => {
        const tips = s.tips.filter(fits)
        return (
          tips.length > 0 && (
            <section key={s.title} aria-label={s.title} className="flex flex-col gap-1">
              <h2 className="px-4 pt-2 text-sm font-medium text-primary">{s.title}</h2>
              <ul className="overflow-hidden rounded-lg bg-surface-container-low">
                {tips.map((t) => (
                  <TipRow key={t.title} tip={t} />
                ))}
              </ul>
            </section>
          )
        )
      })}
    </>
  )
}
