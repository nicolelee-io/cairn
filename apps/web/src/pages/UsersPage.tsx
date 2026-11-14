import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import {
  AdminUserSchema,
  MIN_PASSWORD_LENGTH,
  type AdminUser,
  type CreateUser,
  type UpdateUser,
} from '@cairn/shared'
import { useMe } from '../auth/useAuth.ts'
import { Avatar } from '../components/Avatar.tsx'
import { Icon } from '../components/Icon.tsx'
import { ListRow } from '../components/ListRow.tsx'
import { NeedsConnection } from '../components/NeedsConnection.tsx'
import { Button } from '../components/ui/button.tsx'
import { ConfirmDialog, Dialog, DialogActions } from '../components/ui/dialog.tsx'
import { Input } from '../components/ui/input.tsx'
import { Switch } from '../components/ui/switch.tsx'
import { api, errorCode } from '../lib/api.ts'
import { keys, useAdminUsers } from '../lib/queries.ts'
import { autofocusWithMouse } from '../lib/pointer.ts'
import { useServerDown } from '../lib/serverStatus.ts'
import { Page } from './Page.tsx'
import { LoadingState } from '../components/Spinner.tsx'

const MESSAGES: Record<string, string> = {
  username_taken: 'That username is taken.',
  self: 'That’s your own account. Change it in Settings.',
  last_admin: 'There must be at least one admin who can sign in.',
}
const failure = (e: unknown, fallback: string) => MESSAGES[errorCode(e) ?? ''] ?? fallback

/**
 * Manage users (admins only; the server refuses everyone else too). Accounts only: an admin can add
 * people, reset a password, change roles and disable or enable someone, never see their journals.
 */
export function UsersPage() {
  const me = useMe().data
  const isAdmin = me?.role === 'admin'
  const down = useServerDown()
  const users = useAdminUsers(isAdmin)
  // An id, not the user: the dialog then shows the list's copy as soon as a change lands.
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = users.data?.users.find((u) => u.id === selectedId) ?? null
  const [adding, setAdding] = useState(false)

  return (
    <Page title="Manage users" icon="group" back>
      {!isAdmin ? (
        <p className="rounded-lg bg-surface-container-low p-4 text-on-surface-variant">
          Only an admin can manage users.
        </p>
      ) : down ? (
        <NeedsConnection onRetry={() => void users.refetch()}>
          Reconnect to manage users.
        </NeedsConnection>
      ) : (
        <>
          <UserList onSelect={(u) => setSelectedId(u.id)} myId={me.id} />
          <div>
            <Button variant="tonal" onClick={() => setAdding(true)}>
              <Icon name="person_add" className="size-5" />
              Add user
            </Button>
          </div>
          {/* Keyed so each opens with fresh form state. */}
          <AddUserDialog
            key={adding ? 'open' : 'closed'}
            open={adding}
            onClose={() => setAdding(false)}
          />
          <UserDialog
            key={selectedId ?? 'none'}
            user={selected}
            isMe={selectedId === me.id}
            onClose={() => setSelectedId(null)}
          />
        </>
      )}
    </Page>
  )
}

function UserList({ onSelect, myId }: { onSelect: (u: AdminUser) => void; myId: string }) {
  const users = useAdminUsers()
  if (users.isPending) return <LoadingState />
  if (users.isError) return <p role="alert">Couldn’t load users.</p>
  return (
    <ul aria-label="Users" className="flex flex-col gap-2">
      {users.data.users.map((u) => (
        <ListRow
          key={u.id}
          as="button"
          label={`Manage ${u.displayName}`}
          onClick={() => onSelect(u)}
          className="rounded-lg bg-surface-container-low"
          lead={<Avatar name={u.displayName || u.username} className="size-10 text-base" />}
          title={
            <span className={u.disabled ? 'text-on-surface-variant' : undefined}>
              {u.displayName}
              {u.id === myId && <span className="text-on-surface-variant"> (you)</span>}
            </span>
          }
          lines={[u.username]}
          end={
            <>
              {u.role === 'admin' && <Chip>Admin</Chip>}
              {u.disabled && <Chip>Disabled</Chip>}
              <Icon name="chevron_right" className="text-on-surface-variant" />
            </>
          }
        />
      ))}
    </ul>
  )
}

function Chip({ children }: { children: string }) {
  return (
    <span className="shrink-0 rounded-sm border border-outline-variant px-2 py-0.5 text-xs text-on-surface-variant">
      {children}
    </span>
  )
}

/** Writes one user's new state into the list, so the page doesn't wait for a re-read. */
function useSetUser() {
  const qc = useQueryClient()
  return (u: AdminUser) => {
    qc.setQueryData(keys.adminUsers, (old: { users: AdminUser[] } | undefined) =>
      old ? { users: old.users.map((x) => (x.id === u.id ? u : x)) } : old,
    )
    void qc.invalidateQueries({ queryKey: keys.adminUsers })
  }
}

function AddUserDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [displayName, setDisplayName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [admin, setAdmin] = useState(false)
  const create = useMutation({
    mutationFn: (body: CreateUser) =>
      api('/admin/users', { method: 'POST', body, schema: AdminUserSchema }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.adminUsers })
      onClose()
    },
  })
  const ready =
    displayName.trim() !== '' && username.trim() !== '' && password.length >= MIN_PASSWORD_LENGTH
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!ready || create.isPending) return
    create.mutate({
      displayName: displayName.trim(),
      username: username.trim(),
      password,
      role: admin ? 'admin' : 'user',
    })
  }
  return (
    <Dialog open={open} onClose={onClose} title="Add user">
      <form className="flex flex-col gap-3" onSubmit={submit}>
        <Input
          aria-label="Display name"
          data-autofocus={autofocusWithMouse()}
          placeholder="Display name"
          value={displayName}
          maxLength={100}
          autoComplete="off"
          onChange={(e) => setDisplayName(e.target.value)}
        />
        <Input
          aria-label="Username"
          placeholder="Username (what they sign in with)"
          value={username}
          maxLength={200}
          autoComplete="off"
          autoCapitalize="none"
          onChange={(e) => setUsername(e.target.value)}
        />
        {/* Shown as text: the admin reads it off to share it. */}
        <Input
          aria-label="Temporary password"
          placeholder="Temporary password"
          value={password}
          maxLength={1024}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          onChange={(e) => setPassword(e.target.value)}
        />
        <p className="text-sm text-on-surface-variant">
          At least {MIN_PASSWORD_LENGTH} characters. Share it with them, and ask them to change it
          in Settings &gt; Account after they first sign in.
        </p>
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <p>Admin</p>
            <p className="text-sm text-on-surface-variant">
              Can manage settings and users. Can’t read other people’s journals.
            </p>
          </div>
          <Switch checked={admin} label="Admin" onChange={setAdmin} />
        </div>
        {create.isError && (
          <p role="alert" className="text-sm text-error">
            {failure(create.error, 'Couldn’t add the user.')}
          </p>
        )}
        <DialogActions>
          <Button type="button" variant="text" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!ready || create.isPending}>
            Add user
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

type Step = 'main' | 'password' | 'disable'

function UserDialog({
  user,
  isMe,
  onClose,
}: {
  user: AdminUser | null
  isMe: boolean
  onClose: () => void
}) {
  const setUser = useSetUser()
  const [step, setStep] = useState<Step>('main')
  const [password, setPassword] = useState('')
  const update = useMutation({
    mutationFn: (body: UpdateUser) =>
      api(`/admin/users/${user!.id}`, { method: 'PATCH', body, schema: AdminUserSchema }),
    onSuccess: (u) => {
      setUser(u)
      setStep('main')
    },
  })
  const reset = useMutation({
    mutationFn: () =>
      api(`/admin/users/${user!.id}/password`, {
        method: 'POST',
        body: { newPassword: password },
        schema: AdminUserSchema,
      }),
    onSuccess: (u) => {
      setUser(u)
      onClose()
    },
  })
  if (!user) return null
  const busy = update.isPending || reset.isPending

  if (step === 'password')
    return (
      <Dialog open onClose={onClose} title={`Reset ${user.displayName}’s password`}>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (password.length >= MIN_PASSWORD_LENGTH && !busy) reset.mutate()
          }}
        >
          <p className="text-sm text-on-surface-variant">
            They are signed out everywhere. Pick a password of at least {MIN_PASSWORD_LENGTH}{' '}
            characters, share it with them, and ask them to change it in Settings &gt; Account.
          </p>
          <Input
            aria-label="New temporary password"
            data-autofocus={autofocusWithMouse()}
            placeholder="New temporary password"
            value={password}
            maxLength={1024}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            onChange={(e) => setPassword(e.target.value)}
          />
          {reset.isError && (
            <p role="alert" className="text-sm text-error">
              {failure(reset.error, 'Couldn’t reset the password.')}
            </p>
          )}
          <DialogActions>
            <Button type="button" variant="text" onClick={() => setStep('main')}>
              Back
            </Button>
            <Button type="submit" disabled={password.length < MIN_PASSWORD_LENGTH || busy}>
              Reset password
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    )

  if (step === 'disable')
    return (
      <ConfirmDialog
        open
        onClose={onClose}
        title={`Disable ${user.displayName}?`}
        confirmLabel="Disable"
        cancelLabel="Back"
        onCancel={() => setStep('main')}
        pending={busy}
        error={update.isError ? failure(update.error, 'Couldn’t disable the user.') : null}
        onConfirm={() => update.mutate({ disabled: true })}
      >
        <p className="text-on-surface-variant">
          They are signed out everywhere and can’t sign in until you enable them again. Their
          journals stay as they are.
        </p>
      </ConfirmDialog>
    )

  return (
    <Dialog open onClose={onClose} title={user.displayName} showClose>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-on-surface-variant">
          Signs in as <span className="text-on-surface">{user.username}</span>
          {user.disabled && '. Disabled: can’t sign in'}.
        </p>
        {isMe ? (
          <p className="text-sm text-on-surface-variant">
            This is you. Change your details in Settings. Another admin can change your role.
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <p>Role</p>
              <div role="group" aria-label="Role" className="flex gap-2">
                {(['user', 'admin'] as const).map((r) => (
                  <Button
                    key={r}
                    variant={user.role === r ? 'tonal' : 'outlined'}
                    aria-pressed={user.role === r}
                    disabled={busy}
                    onClick={() => user.role !== r && update.mutate({ role: r })}
                  >
                    {r === 'admin' ? 'Admin' : 'User'}
                  </Button>
                ))}
              </div>
              <p className="text-sm text-on-surface-variant">
                Admins manage settings and users. They can’t read other people’s journals.
              </p>
            </div>
            {update.isError && (
              <p role="alert" className="text-sm text-error">
                {failure(update.error, 'Couldn’t save the change.')}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="outlined" disabled={busy} onClick={() => setStep('password')}>
                Reset password
              </Button>
              {user.disabled ? (
                <Button
                  variant="outlined"
                  disabled={busy}
                  onClick={() => update.mutate({ disabled: false })}
                >
                  Enable
                </Button>
              ) : (
                <Button
                  variant="text"
                  className="text-error"
                  disabled={busy}
                  onClick={() => {
                    update.reset()
                    setStep('disable')
                  }}
                >
                  Disable…
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </Dialog>
  )
}
