import crypto from 'node:crypto'

export type UploadClassification = 'duplicate_original' | 'retouch_upload' | 'new_original' | 'unknown' | 'invalid_retouch_reference'

export type UploadAnalysisResult = {
  fileName: string
  checksumSha256: string
  classification: UploadClassification
  matchedPhotoId: string | null
  matchedVersionNo: number | null
  normalizedBaseName: string
  reason: string
  nextVersionNo: number | null
}

const GLOBAL_PHOTO_ID_RE = /GP-[A-Z0-9]{12,}/i
const VERSION_SEGMENT_RE = /(?:^|[_-])v(\d+)(?:$|[_-])/i
const RETOUCH_HINT_RE = /(retouch|retouched|edit|edited|final|deliver|delivery|export|修图)/i

export async function sha256Hex(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const hash = crypto.createHash('sha256')
  hash.update(Buffer.from(buffer))
  return hash.digest('hex')
}

export function extractPhotoIdFromFileName(fileName: string): string | null {
  return fileName.match(GLOBAL_PHOTO_ID_RE)?.[0]?.toUpperCase() ?? null
}

export function extractVersionNoFromFileName(fileName: string): number | null {
  const raw = fileName.replace(/\.[^.]+$/, '')
  const match = raw.match(VERSION_SEGMENT_RE)
  return match ? Number(match[1]) || null : null
}

export function stripSystemDownloadPrefixes(fileName: string): string {
  const ext = fileName.match(/\.[^.]+$/)?.[0] ?? ''
  let base = fileName.slice(0, fileName.length - ext.length)

  base = base.replace(/^GP-[A-Z0-9]{12,}[_-]v\d+[_-]?/i, '')
  base = base.replace(/^GP-[A-Z0-9]{12,}[_-]?/i, '')
  base = base.replace(/^v\d+[_-]?/i, '')
  return `${base || 'file'}${ext}`
}

export function normalizeBaseName(fileName: string): string {
  const stripped = stripSystemDownloadPrefixes(fileName)
  return stripped.replace(/\.[^.]+$/, '')
}

export function looksLikeRetouchFile(fileName: string): boolean {
  return RETOUCH_HINT_RE.test(fileName)
}
