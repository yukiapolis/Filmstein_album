import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

type ShareAccessSettings = {
  enabled?: boolean
  password_hash?: string
}

export type FolderShareAccessMode = 'public' | 'hidden' | 'password_protected'

export type FolderShareAccessSettings = {
  access_mode: FolderShareAccessMode
  password_hash?: string
}

const SHARE_ACCESS_COOKIE_PREFIX = 'snapflare_share_project_access_'
const SHARE_FOLDER_ACCESS_COOKIE_PREFIX = 'snapflare_share_folder_access_'
const SHARE_ACCESS_COOKIE_MAX_AGE = 60 * 60 * 24 * 30

function getCookieSecret() {
  return process.env.ADMIN_SESSION_SECRET
    || process.env.NEXTAUTH_SECRET
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    || 'snapflare-share-access-secret'
}

export function getProjectShareAccessCookieName(projectId: string) {
  return `${SHARE_ACCESS_COOKIE_PREFIX}${projectId}`
}

export function getFolderShareAccessCookieName(projectId: string, folderId: string) {
  return `${SHARE_FOLDER_ACCESS_COOKIE_PREFIX}${projectId}_${folderId}`
}

export function hashSharePassword(password: string) {
  const salt = randomBytes(16).toString('hex')
  const derived = scryptSync(password, salt, 32).toString('hex')
  return `scrypt:${salt}:${derived}`
}

export function verifySharePassword(password: string, storedHash: string) {
  if (!storedHash) return false

  if (storedHash.startsWith('scrypt:')) {
    const [, salt, expectedHex] = storedHash.split(':')
    if (!salt || !expectedHex) return false
    const actual = scryptSync(password, salt, 32)
    const expected = Buffer.from(expectedHex, 'hex')
    return expected.length === actual.length && timingSafeEqual(expected, actual)
  }

  const legacySha256 = createHash('sha256').update(password).digest('hex')
  const actual = Buffer.from(legacySha256)
  const expected = Buffer.from(storedHash)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

export function extractProjectShareAccessConfig(visualSettings: unknown): ShareAccessSettings {
  if (!visualSettings || typeof visualSettings !== 'object') return {}
  const shareAccess = (visualSettings as { share_access?: unknown }).share_access
  if (!shareAccess || typeof shareAccess !== 'object') return {}

  return {
    enabled: (shareAccess as { enabled?: unknown }).enabled === true,
    password_hash: typeof (shareAccess as { password_hash?: unknown }).password_hash === 'string'
      ? (shareAccess as { password_hash?: string }).password_hash
      : undefined,
  }
}

export function extractFolderShareAccessConfig(folder: unknown): FolderShareAccessSettings {
  if (!folder || typeof folder !== 'object') return { access_mode: 'public' }
  const accessMode = (folder as { access_mode?: unknown }).access_mode
  const normalizedAccessMode: FolderShareAccessMode = accessMode === 'hidden' || accessMode === 'password_protected'
    ? accessMode
    : 'public'

  return {
    access_mode: normalizedAccessMode,
    password_hash: typeof (folder as { password_hash?: unknown }).password_hash === 'string'
      ? (folder as { password_hash?: string }).password_hash
      : undefined,
  }
}

export function sanitizeProjectVisualSettings(visualSettings: unknown) {
  if (!visualSettings || typeof visualSettings !== 'object') return visualSettings
  const source = visualSettings as Record<string, unknown>
  const shareAccess = extractProjectShareAccessConfig(visualSettings)

  return {
    ...source,
    ...(shareAccess.enabled || shareAccess.password_hash
      ? {
          share_access: {
            enabled: shareAccess.enabled === true,
            has_password: Boolean(shareAccess.password_hash),
          },
        }
      : {}),
  }
}

function createAccessToken(scope: string, passwordHash: string) {
  return createHmac('sha256', getCookieSecret())
    .update(`${scope}:${passwordHash}`)
    .digest('hex')
}

function readAccessCookie(request: Request, cookieName: string) {
  const cookieHeader = request.headers.get('cookie') || ''
  const match = cookieHeader.match(new RegExp(`(?:^|; )${cookieName}=([^;]+)`))
  return match?.[1] || null
}

export function createProjectShareAccessToken(projectId: string, passwordHash: string) {
  return createAccessToken(`project:${projectId}`, passwordHash)
}

export function isProjectShareAccessGranted(request: Request, projectId: string, passwordHash: string) {
  const token = readAccessCookie(request, getProjectShareAccessCookieName(projectId))
  if (!token) return false
  return token === createProjectShareAccessToken(projectId, passwordHash)
}

export function buildProjectShareAccessCookie(projectId: string, passwordHash: string) {
  const token = createProjectShareAccessToken(projectId, passwordHash)
  return `${getProjectShareAccessCookieName(projectId)}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SHARE_ACCESS_COOKIE_MAX_AGE}`
}

export function createFolderShareAccessToken(projectId: string, folderId: string, passwordHash: string) {
  return createAccessToken(`folder:${projectId}:${folderId}`, passwordHash)
}

export function isFolderShareAccessGranted(request: Request, projectId: string, folderId: string, passwordHash: string) {
  const token = readAccessCookie(request, getFolderShareAccessCookieName(projectId, folderId))
  if (!token) return false
  return token === createFolderShareAccessToken(projectId, folderId, passwordHash)
}

export function buildFolderShareAccessCookie(projectId: string, folderId: string, passwordHash: string) {
  const token = createFolderShareAccessToken(projectId, folderId, passwordHash)
  return `${getFolderShareAccessCookieName(projectId, folderId)}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SHARE_ACCESS_COOKIE_MAX_AGE}`
}
