import { useState, type ReactNode } from 'react'
import { useParams } from 'react-router'
import { useLogout, useMe, useUpdateMe } from '../../auth/useAuth.ts'
import { Icon, type IconName } from '../../components/Icon.tsx'
import { NeedsConnection, OfflineBanner } from '../../components/NeedsConnection.tsx'
import { TWO_PANE } from '../../lib/pane.ts'
import { useMediaQuery } from '../../lib/useMediaQuery.ts'
import { ListRow } from '../../components/ListRow.tsx'
import { Markdown } from '../../components/Markdown.tsx'
import { ConfirmDialog } from '../../components/ui/dialog.tsx'
import { setBottomBar, useBottomBar } from '../../lib/bottomBar.ts'
import { setWordCount, useWordCount } from '../../lib/wordCount.ts'
import { useServerDown } from '../../lib/serverStatus.ts'
import { setBareKeys, setGoToKeys, useBareKeys, useGoToKeys } from '../../lib/shortcuts.ts'
import { openShortcutHelp } from '../../lib/shortcutUi.ts'
import {
  ENTRY_FONT_OPTIONS,
  ENTRY_SIZE_OPTIONS,
  setEntryText,
  useEntryText,
} from '../../lib/entryText.ts'
import { applyTempUnit, useTempUnit } from '../../lib/tempUnit.ts'
import { setThemeMode, useThemeMode } from '../../lib/theme.ts'
import { NotFound, Page } from '../Page.tsx'
import { AboutCard } from './AboutCard.tsx'
import { AccountCard } from './AccountCard.tsx'
import { AlertsCard } from './AlertsCard.tsx'
import { ExportCard } from './ExportCard.tsx'
import { ImportCard } from './ImportCard.tsx'
import { PhotoQualityCard } from './PhotoQualityCard.tsx'
import { AttachmentLimitCard, BackupCard, GoogleKeyCard } from './ServerCards.tsx'
import { ChoiceButtons, ChoiceSetting, SettingText, SwitchSetting } from './SettingRow.tsx'
import { TipsContent } from './TipsPage.tsx'
import { TrashRetentionCard } from './TrashRetentionCard.tsx'
import { WeatherSourceCard } from './WeatherSourceCard.tsx'

/** A Settings subpage: the page frame with Back (hidden beside the list from 840px). */
function SettingsPage({
  title,
  icon,
  keepBack,
  children,
}: {
  title: string
  icon: IconName
  /** A page under another settings page: Back stays beside the list from 840px. */
  keepBack?: boolean
  children: ReactNode
}) {
  return (
    <Page title={title} icon={icon} back keepBack={keepBack}>
      {children}
    </Page>
  )
}

/** The account's own error line, under settings saved through `useUpdateMe`. */
function SaveError({ show }: { show: boolean }) {
  return show ? (
    <p role="alert" className="px-1 text-sm text-error">
      Couldn’t save that. Try again.
    </p>
  ) : null
}

/** Profile, sign-in and timezone, then Sign out (it asks first). Also the pane at `/settings` from 840px. */
export function AccountSettings() {
  const logout = useLogout()
  const [confirming, setConfirming] = useState(false)
  const down = useServerDown()
  // From 840px the list beside this page carries the banner.
  const wide = useMediaQuery(TWO_PANE)
  return (
    <SettingsPage title="Account" icon="person">
      {down && !wide && (
        <OfflineBanner title="You’re offline">
          The name, username, password and picture need a connection.
        </OfflineBanner>
      )}
      <AccountCard onSignOut={() => setConfirming(true)} />
      <ConfirmDialog
        open={confirming}
        onClose={() => {
          setConfirming(false)
          logout.reset()
        }}
        title="Sign out?"
        confirmLabel="Sign out"
        pending={logout.isPending}
        error={
          logout.isError
            ? 'Couldn’t reach the server, so you’re still signed in. Try again once you’re online.'
            : null
        }
        onConfirm={() => logout.mutate()}
      >
        <p className="text-on-surface-variant">
          You'll need your password to get back in. Unsaved drafts stay on this device.
        </p>
      </ConfirmDialog>
    </SettingsPage>
  )
}

const SAMPLE_TEXT = `# A quiet morning

The kettle was *just* about to boil when I noticed the light on the **garden wall**. Small things, mostly: a half-finished crossword, 7:42 on the clock.

> Write it down while it still feels true.`

/** Entry font and size: a sample of both as the editor and reader show them, above the choices. */
export function EntryTextSettings() {
  const { font, size } = useEntryText()
  return (
    <SettingsPage title="Entry text" icon="text_fields" keepBack>
      <div className="flex flex-col gap-4 rounded-lg bg-surface-container-low p-4">
        <section aria-label="Sample entry" className="rounded-md bg-surface p-4">
          <Markdown body={SAMPLE_TEXT} photos={[]} />
        </section>
        <div className="flex flex-col gap-2">
          <SettingText
            title="Entry font"
            description="The typeface for entries in the editor and reader."
            scope="device"
          />
          <ChoiceButtons
            label="Entry font"
            options={ENTRY_FONT_OPTIONS.map(({ value, label }) => ({ value, label }))}
            value={font}
            onChange={(next) => setEntryText({ font: next })}
          />
        </div>
        <div className="flex flex-col gap-2">
          <SettingText
            title="Entry text size"
            description="Only entry text changes, not the menus. Your browser or device text size still applies on top."
            scope="device"
          />
          <ChoiceButtons
            label="Entry text size"
            options={ENTRY_SIZE_OPTIONS}
            value={size}
            onChange={(next) => setEntryText({ size: next })}
          />
        </div>
      </div>
    </SettingsPage>
  )
}

function AppearanceSettings() {
  const me = useMe().data
  const updateMe = useUpdateMe()
  const theme = useThemeMode()
  const text = useEntryText()
  const bottomBar = useBottomBar()
  const wordCount = useWordCount()
  return (
    <SettingsPage title="Appearance" icon="palette">
      <ChoiceSetting
        title="Theme"
        description="System follows your device's light or dark setting."
        scope="device"
        label="Appearance"
        options={[
          { value: 'system', label: 'System' },
          { value: 'light', label: 'Light' },
          { value: 'dark', label: 'Dark' },
        ]}
        value={theme}
        onChange={setThemeMode}
      />
      <ul className="rounded-lg bg-surface-container-low">
        <ListRow
          as="link"
          to="/settings/appearance/entry-text"
          lead={<Icon name="text_fields" className="text-on-surface-variant" />}
          title={<span className="text-lg">Entry text</span>}
          lines={[
            `${ENTRY_FONT_OPTIONS.find((o) => o.value === text.font)?.label ?? ''} · ${ENTRY_SIZE_OPTIONS.find((o) => o.value === text.size)?.label ?? ''}. Font and size, for this device.`,
          ]}
          end={<Icon name="chevron_right" className="text-on-surface-variant" />}
        />
      </ul>
      <SwitchSetting
        title="Bottom bar"
        description="Tabs along the bottom of small screens. Turn off to use the menu instead."
        scope="device"
        label="Show the bottom bar"
        checked={bottomBar}
        onChange={setBottomBar}
      />
      <SwitchSetting
        title="Word count in the editor"
        description="A quiet count under the text, above the chips."
        scope="device"
        label="Show the word count in the editor"
        checked={wordCount}
        onChange={setWordCount}
      />
      <SwitchSetting
        title="Show archived journals in the menu"
        description="You can still find them in Manage journals."
        scope="account"
        label="Show archived journals in the menu"
        checked={me?.showArchivedInMenu ?? true}
        onChange={(showArchivedInMenu) => updateMe.mutate({ showArchivedInMenu })}
      />
      <SwitchSetting
        title="Show writing streak"
        description="The streak in Insights and in an entry list's Details. Turn off if a streak is more pressure than help."
        scope="account"
        label="Show writing streak"
        checked={me?.showStreak ?? true}
        onChange={(showStreak) => updateMe.mutate({ showStreak })}
      />
      {(me?.showStreak ?? true) && (
        <SwitchSetting
          title="Show best streak"
          description="Your longest run, next to the current one."
          scope="account"
          label="Show best streak"
          checked={me?.showBestStreak ?? true}
          onChange={(showBestStreak) => updateMe.mutate({ showBestStreak })}
        />
      )}
      <SaveError show={updateMe.isError} />
    </SettingsPage>
  )
}

function LocationSettings() {
  const me = useMe().data
  const updateMe = useUpdateMe()
  const unit = useTempUnit()
  return (
    <SettingsPage title="Location & weather" icon="location_on">
      <SwitchSetting
        title="Add location and weather to new entries"
        description={
          <>
            New entries start with your location, and the weather is added when you save. Your
            browser asks permission the first time.
            {!window.isSecureContext && ' Location needs a secure (https) connection.'}
          </>
        }
        scope="account"
        label="Add location and weather to new entries"
        checked={me?.autoLocation ?? false}
        onChange={(autoLocation) => updateMe.mutate({ autoLocation })}
      />
      <ChoiceSetting
        title="Temperature"
        description="Unit for weather."
        scope="account"
        label="Temperature unit"
        options={[
          { value: 'F', label: '°F' },
          { value: 'C', label: '°C' },
        ]}
        value={unit}
        onChange={(u) => {
          const was = unit
          applyTempUnit(u) // at once; the account setting follows
          updateMe.mutate({ tempUnit: u }, { onError: () => applyTempUnit(was) })
        }}
      />
      <SaveError show={updateMe.isError} />
    </SettingsPage>
  )
}

function KeyboardSettings() {
  const bareKeys = useBareKeys()
  const goToKeys = useGoToKeys()
  return (
    <SettingsPage title="Keyboard" icon="keyboard">
      <SwitchSetting
        title="Quick-action keys"
        description="Single-key shortcuts, like n for a new entry or j and k to move through the list. Turn off if they get in your way."
        scope="device"
        label="Use quick-action keys"
        checked={bareKeys}
        onChange={setBareKeys}
      />
      <SwitchSetting
        title="Go-to keys"
        description="Press g, then a letter, to jump somewhere. For example, g then s opens Settings."
        scope="device"
        label="Use go-to keys"
        checked={goToKeys}
        onChange={setGoToKeys}
      />
      <button
        type="button"
        onClick={() => openShortcutHelp(true)}
        className="state-layer flex items-center gap-4 rounded-lg bg-surface-container-low p-4 text-left"
      >
        <div className="min-w-0 flex-1">
          <p className="text-lg">Keyboard shortcuts</p>
          <p className="text-sm text-on-surface-variant">
            See every shortcut. Ctrl or Cmd + K opens the command palette.
          </p>
        </div>
        <Icon name="chevron_right" className="text-on-surface-variant" />
      </button>
    </SettingsPage>
  )
}

/** An admin page: refused to anyone else, and read from the server afresh, so not offline. */
function ServerSettings({
  title,
  icon,
  children,
}: {
  title: string
  icon: IconName
  children: ReactNode
}) {
  const me = useMe()
  const down = useServerDown()
  return (
    <SettingsPage title={title} icon={icon}>
      {me.data?.role !== 'admin' ? (
        <p className="rounded-lg bg-surface-container-low p-4 text-on-surface-variant">
          Only an admin can change these settings.
        </p>
      ) : down ? (
        <NeedsConnection onRetry={() => void me.refetch()} />
      ) : (
        children
      )}
    </SettingsPage>
  )
}

/** `/settings/:section`: the subpages that live under Settings itself. */
export function SettingsSection() {
  const { section } = useParams()
  switch (section) {
    case 'account':
      return <AccountSettings />
    case 'appearance':
      return <AppearanceSettings />
    case 'location':
      return <LocationSettings />
    case 'keyboard':
      return <KeyboardSettings />
    case 'export':
      return (
        <SettingsPage title="Export" icon="download">
          <ExportCard />
        </SettingsPage>
      )
    case 'import':
      return (
        <SettingsPage title="Import" icon="upload_file">
          <ImportCard />
        </SettingsPage>
      )
    case 'tips':
      return (
        <SettingsPage title="Tips & tricks" icon="help">
          <TipsContent />
        </SettingsPage>
      )
    case 'about':
      return (
        <SettingsPage title="About" icon="info">
          <AboutCard />
        </SettingsPage>
      )
    case 'backups':
      return (
        <ServerSettings title="Backups & alerts" icon="backup">
          <BackupCard />
          <AlertsCard />
        </ServerSettings>
      )
    case 'places':
      return (
        <ServerSettings title="Places & weather" icon="travel_explore">
          <GoogleKeyCard />
          <WeatherSourceCard />
        </ServerSettings>
      )
    case 'uploads':
      return (
        <ServerSettings title="Uploads & Trash" icon="tune">
          <PhotoQualityCard />
          <AttachmentLimitCard />
          <TrashRetentionCard />
        </ServerSettings>
      )
    default:
      return <NotFound />
  }
}
