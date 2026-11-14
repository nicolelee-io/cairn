import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { loadConfig } from '../config.ts'
import { openDb } from '../db/index.ts'
import { resetPassword } from './resetPassword.ts'

const USAGE = `usage: docker exec -it cairn node reset-password.js <username>
       echo "new password" | docker exec -i cairn node reset-password.js <username> --password-stdin
(dev: npm run reset-password -w @cairn/server -- <username>)`

/** Reads a line from the terminal without echoing it. */
function promptHidden(label: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin
    process.stdout.write(label)
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')
    let text = ''
    const finish = (fn: () => void) => {
      stdin.setRawMode(false)
      stdin.pause()
      stdin.off('data', onData)
      process.stdout.write('\n')
      fn()
    }
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') return finish(() => resolve(text))
        if (ch === '\u0003') return finish(() => reject(new Error('cancelled')))
        if (ch === '\u007f' || ch === '\b') text = text.slice(0, -1)
        else text += ch
      }
    }
    stdin.on('data', onData)
  })
}

async function readStdin(): Promise<string> {
  let data = ''
  for await (const chunk of process.stdin) data += String(chunk)
  return data.replace(/\r?\n$/, '')
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { 'password-stdin': { type: 'boolean' } },
  })
  if (positionals.length !== 1) {
    console.error(USAGE)
    process.exit(2)
  }
  const username = positionals[0]!

  let password: string
  if (values['password-stdin']) {
    password = await readStdin()
  } else if (process.stdin.isTTY) {
    password = await promptHidden('New password: ')
    if (password !== (await promptHidden('Repeat it: '))) {
      console.error('The passwords differ; nothing changed.')
      process.exit(1)
    }
  } else {
    console.error('No terminal: use docker exec -it, or pass --password-stdin.')
    process.exit(2)
  }

  const config = loadConfig()
  mkdirSync(config.dataDir, { recursive: true })
  const handle = openDb(join(config.dataDir, 'cairn.db'))
  try {
    const result = await resetPassword(handle.db, username, password)
    if (!result.ok) {
      console.error(result.message)
      process.exit(1)
    }
  } finally {
    handle.sqlite.close()
  }
  console.log(
    `Password changed for "${username.toLowerCase()}"; every session of theirs has ended.`,
  )
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
