import { createHash, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'

function scrypt(password: string, salt: Buffer, keyLength: number, options: { N: number; r: number; p: number }) {
  return new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) {
        reject(error)
        return
      }
      resolve(Buffer.from(derivedKey))
    })
  })
}

const HASH_PREFIX = 'scrypt'
const LEGACY_MD5_RE = /^[a-f0-9]{32}$/

function fromBase64Url(value: string) {
  return Buffer.from(value, 'base64url')
}

export function hashLegacyMd5(value: string) {
  return createHash('md5').update(value, 'utf8').digest('hex')
}

async function verifyScryptPassword(password: string, storedHash: string) {
  const [prefix, nRaw, rRaw, pRaw, saltRaw, expectedRaw] = storedHash.split('$')
  if (prefix !== HASH_PREFIX || !nRaw || !rRaw || !pRaw || !saltRaw || !expectedRaw) {
    return false
  }

  const N = Number(nRaw)
  const r = Number(rRaw)
  const p = Number(pRaw)
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) {
    return false
  }

  const salt = fromBase64Url(saltRaw)
  const expected = fromBase64Url(expectedRaw)
  const derived = await scrypt(password, salt, expected.length, { N, r, p }) as Buffer

  return derived.length === expected.length && timingSafeEqual(derived, expected)
}

export async function verifyPassword(password: string, storedPassword: string) {
  const normalizedStoredPassword = storedPassword.trim()

  if (LEGACY_MD5_RE.test(normalizedStoredPassword)) {
    return hashLegacyMd5(password) === normalizedStoredPassword
  }

  if (normalizedStoredPassword.startsWith(`${HASH_PREFIX}$`)) {
    return verifyScryptPassword(password, normalizedStoredPassword)
  }

  return false
}
