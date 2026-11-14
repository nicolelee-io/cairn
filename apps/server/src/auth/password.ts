import { hash, verify } from '@node-rs/argon2'

// @node-rs/argon2 defaults to argon2id.
export const hashPassword = (password: string) => hash(password)

let dummy: Promise<string> | undefined

/**
 * Verifies against `stored`, or against a throwaway hash when there is no such user, so an
 * unknown username costs the same time as a wrong password.
 */
export async function verifyPassword(stored: string | undefined, password: string) {
  if (stored) return verify(stored, password)
  dummy ??= hash('cairn-dummy-password')
  await verify(await dummy, password)
  return false
}
