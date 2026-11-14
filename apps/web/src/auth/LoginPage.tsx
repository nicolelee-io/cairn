import { useState, type FormEvent } from 'react'
import { Button } from '../components/ui/button.tsx'
import { Input } from '../components/ui/input.tsx'
import { PasswordInput } from '../components/ui/password-input.tsx'
import { ApiError } from '../lib/api.ts'
import { useLogin } from './useAuth.ts'

export function LoginPage() {
  const login = useLogin()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  function submit(e: FormEvent) {
    e.preventDefault()
    login.mutate({ username, password })
  }

  const error = login.error
  const message =
    error instanceof ApiError
      ? error.status === 429
        ? 'Too many attempts. Try again in a few minutes.'
        : error.status === 403 // only said once the password is right
          ? 'This account is turned off. Ask an admin.'
          : 'Wrong username or password.'
      : error
        ? 'Can’t connect. Check your connection and try again.'
        : null

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-8 px-6 py-12">
      <div className="flex flex-col items-center gap-3">
        <img src="/icon.svg" alt="" className="size-20 rounded-xl" />
        <h1 className="text-3xl font-medium">Cairn</h1>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Input
          name="username"
          placeholder="Username"
          aria-label="Username"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          required
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <PasswordInput
          name="password"
          placeholder="Password"
          aria-label="Password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {message && (
          <p role="alert" className="text-sm text-error">
            {message}
          </p>
        )}
        <Button type="submit" className="h-12" disabled={login.isPending}>
          {login.isPending ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </main>
  )
}
