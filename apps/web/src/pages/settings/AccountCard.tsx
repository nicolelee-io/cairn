import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef, useState, type FormEvent } from 'react'
import { AVATAR_MAX_BYTES, MeSchema, MIN_PASSWORD_LENGTH, type Me } from '@cairn/shared'
import { useMe, useUpdateMe } from '../../auth/useAuth.ts'
import { Avatar } from '../../components/Avatar.tsx'
import { Icon } from '../../components/Icon.tsx'
import { ListRow } from '../../components/ListRow.tsx'
import { TimezoneDialog } from '../../components/editor/TimezoneDialog.tsx'
import { Button } from '../../components/ui/button.tsx'
import { Dialog, DialogActions } from '../../components/ui/dialog.tsx'
import { Input } from '../../components/ui/input.tsx'
import { PasswordInput } from '../../components/ui/password-input.tsx'
import { api, ApiError, errorCode } from '../../lib/api.ts'
import { browserTimezone } from '../../lib/entryTime.ts'
import { keys } from '../../lib/queries.ts'
import { useServerDown } from '../../lib/serverStatus.ts'
import { autofocusWithMouse } from '../../lib/pointer.ts'
import { withTempUnit } from '../../lib/tempUnit.ts'

/** Puts the server's updated Me into the cache (the same step useUpdateMe takes). */
function useSetMe() {
  const qc = useQueryClient()
  return (me: Me) => qc.setQueryData(keys.me, withTempUnit(me))
}

/** One line of the account list: what it is, its current value, and a chevron to change it. */
function Row({
  label,
  value,
  onClick,
  disabled,
}: {
  label: string
  value: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <ListRow
      as="button"
      onClick={onClick}
      disabled={disabled}
      targetClassName="min-h-16 rounded-none py-2"
      title={label}
      lines={[value]}
      end={<Icon name="chevron_right" className="text-on-surface-variant" />}
    />
  )
}

function DisplayNameDialog({ open, me, onClose }: { open: boolean; me: Me; onClose: () => void }) {
  const update = useUpdateMe()
  const [name, setName] = useState(me.displayName)
  const trimmed = name.trim()
  const changed = trimmed !== me.displayName
  const close = () => {
    setName(me.displayName)
    update.reset()
    onClose()
  }
  return (
    <Dialog open={open} onClose={close} title="Display name">
      <form
        className="flex flex-col gap-3 pb-6"
        onSubmit={(e) => {
          e.preventDefault()
          if (trimmed && changed) update.mutate({ displayName: trimmed }, { onSuccess: onClose })
        }}
      >
        <p className="text-sm text-on-surface-variant">
          The name Cairn shows for you, in the menu and here.
        </p>
        <Input
          aria-label="Display name"
          data-autofocus={autofocusWithMouse()}
          value={name}
          maxLength={100}
          autoComplete="name"
          onChange={(e) => setName(e.target.value)}
        />
        {update.isError && (
          <p role="alert" className="text-sm text-error">
            Couldn’t save the name.
          </p>
        )}
        <DialogActions>
          <Button type="button" variant="text" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={!trimmed || !changed || update.isPending}>
            Save
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

/** Header of the card: the picture (tap it to add or change one), the name and the sign-in name. */
function AvatarHeader({ me, offline }: { me: Me; offline: boolean }) {
  const setMe = useSetMe()
  const file = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const upload = useMutation({
    mutationFn: async (f: File) => {
      const res = await fetch('/api/avatar', {
        method: 'PUT',
        headers: { 'content-type': f.type || 'application/octet-stream' },
        body: f,
      })
      const data: unknown = await res.json().catch(() => null)
      if (!res.ok) throw new ApiError(res.status, data)
      return MeSchema.parse(data)
    },
    onSuccess: (m) => {
      setError(null)
      setMe(m)
    },
    onError: (e) =>
      setError(
        errorCode(e) === 'unsupported_image'
          ? 'Use a JPEG, PNG or WebP picture.'
          : errorCode(e) === 'too_large'
            ? 'That picture is over 10 MB.'
            : 'Couldn’t upload the picture.',
      ),
  })
  const remove = useMutation({
    mutationFn: () => api('/avatar', { method: 'DELETE', schema: MeSchema }),
    onSuccess: setMe,
    onError: () => setError('Couldn’t remove the picture.'),
  })
  const busy = upload.isPending || remove.isPending || offline
  return (
    <div className="flex flex-col gap-2 p-4">
      <div className="flex items-center gap-4">
        <button
          type="button"
          disabled={busy}
          aria-label={me.avatarUpdatedAt ? 'Change picture' : 'Add a picture'}
          onClick={() => file.current?.click()}
          className="relative shrink-0 cursor-pointer rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60"
        >
          <Avatar className="size-16 text-2xl" />
          <span className="absolute -right-1 -bottom-1 grid size-7 place-items-center rounded-full border-2 border-surface-container-low bg-primary text-on-primary">
            <Icon name="photo_camera" className="size-4" />
          </span>
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg">{me.displayName}</p>
          <p className="truncate text-sm text-on-surface-variant">Signs in as {me.username}</p>
          {me.avatarUpdatedAt && (
            <button
              type="button"
              disabled={busy}
              onClick={() => remove.mutate()}
              className="cursor-pointer text-sm font-medium text-primary hover:underline disabled:opacity-60"
            >
              Remove picture
            </button>
          )}
        </div>
        <input
          ref={file}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          aria-label="Choose a picture"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (!f) return
            if (f.size > AVATAR_MAX_BYTES) return setError('That picture is over 10 MB.')
            upload.mutate(f)
          }}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
    </div>
  )
}

/** Username and password share one endpoint and always ask for the current password. */
function CredentialsDialog({
  kind,
  me,
  onClose,
}: {
  kind: 'username' | 'password' | null
  me: Me
  onClose: () => void
}) {
  const setMe = useSetMe()
  const [current, setCurrent] = useState('')
  const [username, setUsername] = useState(me.username)
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [error, setError] = useState<string | null>(null)
  const change = useMutation({
    mutationFn: (body: object) =>
      api('/auth/credentials', { method: 'POST', body, schema: MeSchema }),
    onSuccess: (m) => {
      setMe(m)
      onClose()
    },
    onError: (e) => {
      const code = errorCode(e)
      setError(
        code === 'wrong_password'
          ? 'That isn’t your current password.'
          : code === 'username_taken'
            ? 'That username is taken.'
            : code === 'rate_limited'
              ? 'Too many wrong passwords. Try again in a few minutes.'
              : 'Couldn’t save the change.',
      )
    },
  })
  const isPassword = kind === 'password'
  const mismatch = isPassword && again !== '' && next !== again
  const ready = isPassword
    ? next.length >= MIN_PASSWORD_LENGTH && next === again
    : username.trim() !== '' && username.trim().toLowerCase() !== me.username
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!ready || !current) return
    setError(null)
    change.mutate(
      isPassword
        ? { currentPassword: current, newPassword: next }
        : { currentPassword: current, username: username.trim() },
    )
  }
  const close = () => {
    setCurrent('')
    setNext('')
    setAgain('')
    setError(null)
    setUsername(me.username)
    onClose()
  }
  return (
    <Dialog
      open={kind !== null}
      onClose={close}
      title={isPassword ? 'Change password' : 'Change username'}
    >
      <form className="flex flex-col gap-3 pb-6" onSubmit={submit}>
        {isPassword ? (
          <p className="text-sm text-on-surface-variant">
            Every other device is signed out; this one stays signed in.
          </p>
        ) : (
          <p className="text-sm text-on-surface-variant">
            Your username is the name you sign in with. Your other devices stay signed in.
          </p>
        )}
        {!isPassword && (
          <Input
            aria-label="New username"
            data-autofocus={autofocusWithMouse()}
            value={username}
            autoComplete="username"
            autoCapitalize="none"
            onChange={(e) => setUsername(e.target.value)}
          />
        )}
        <PasswordInput
          aria-label="Current password"
          data-autofocus={isPassword ? autofocusWithMouse() : undefined}
          placeholder="Current password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
        {isPassword && (
          <>
            <PasswordInput
              aria-label="New password"
              placeholder={`New password (at least ${MIN_PASSWORD_LENGTH} characters)`}
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
            <PasswordInput
              aria-label="Repeat the new password"
              placeholder="Repeat the new password"
              autoComplete="new-password"
              value={again}
              onChange={(e) => setAgain(e.target.value)}
            />
          </>
        )}
        {mismatch && (
          <p role="alert" className="text-sm text-error">
            The two new passwords differ.
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-error">
            {error}
          </p>
        )}
        <DialogActions>
          <Button type="button" variant="text" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={!ready || !current || change.isPending}>
            {isPassword ? 'Change password' : 'Change username'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

/**
 * Tier 1 of Settings: who you are. A header with the picture, then one row per thing you can change
 * (each opens its own dialog), the role (read-only: only an admin changes it), then Sign out.
 */
export function AccountCard({ onSignOut }: { onSignOut: () => void }) {
  const me = useMe().data
  const qc = useQueryClient()
  const update = useUpdateMe()
  const [dialog, setDialog] = useState<'name' | 'username' | 'password' | 'timezone' | null>(null)
  const [now] = useState(Date.now) // for the zone abbreviations (daylight time or not)
  const offline = useServerDown()
  if (!me) return null
  const setZone = (zone: string) => {
    setDialog(null)
    if (zone === me.defaultTimezone) return
    update.mutate(
      { defaultTimezone: zone },
      { onSuccess: () => void qc.invalidateQueries({ queryKey: keys.insights }) },
    )
  }
  return (
    <div className="overflow-hidden rounded-lg bg-surface-container-low">
      <AvatarHeader me={me} offline={offline} />
      <ul className="border-t border-outline-variant py-1">
        <Row
          label="Display name"
          value={me.displayName}
          disabled={offline}
          onClick={() => setDialog('name')}
        />
        <Row
          label="Username"
          value={me.username}
          disabled={offline}
          onClick={() => setDialog('username')}
        />
        <Row
          label="Password"
          value="Change the password you sign in with"
          disabled={offline}
          onClick={() => setDialog('password')}
        />
        <Row
          label="Default timezone"
          value={me.defaultTimezone.replaceAll('_', ' ')}
          onClick={() => setDialog('timezone')}
        />
        <ListRow
          title="Role"
          targetClassName="min-h-16 rounded-none py-2"
          lines={[me.role === 'admin' ? 'Admin. Manages settings and users.' : 'User']}
        />
      </ul>
      {update.isError && (
        <p role="alert" className="px-4 pb-3 text-sm text-error">
          Couldn’t save the timezone.
        </p>
      )}
      <div className="border-t border-outline-variant py-1">
        {/* Offline the server's session would outlive it: the next load online is signed in again. */}
        <button
          type="button"
          disabled={offline}
          onClick={onSignOut}
          className="state-layer flex min-h-14 w-full cursor-pointer items-center gap-4 px-4 text-left text-error disabled:pointer-events-none disabled:opacity-50"
        >
          <Icon name="logout" className="size-6" />
          <span className="flex-1">Sign out</span>
          {offline && <span className="text-sm text-on-surface-variant">Needs a connection</span>}
        </button>
      </div>
      <DisplayNameDialog
        key={me.displayName}
        open={dialog === 'name'}
        me={me}
        onClose={() => setDialog(null)}
      />
      <CredentialsDialog
        key={dialog === 'username' || dialog === 'password' ? dialog : 'none'}
        kind={dialog === 'username' || dialog === 'password' ? dialog : null}
        me={me}
        onClose={() => setDialog(null)}
      />
      <TimezoneDialog
        open={dialog === 'timezone'}
        title="Default timezone"
        hint="Days in Insights and the Calendar are counted in this zone. Entries keep the timezone they were written in."
        suggest={browserTimezone()}
        value={me.defaultTimezone}
        at={now}
        onClose={() => setDialog(null)}
        onPick={setZone}
      />
    </div>
  )
}
