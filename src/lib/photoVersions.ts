import { resolvePhotoPublicUrl } from '@/lib/resolvePhotoPublicUrl'

import type { PhotoFileCopyRow } from '@/lib/photoFileCopies'

export type PhotoFileRow = {
  id: string
  photo_id: string
  branch_type: string | null
  version_no: number | null
  file_name?: string | null
  original_file_name?: string | null
  object_key?: string | null
  storage_provider?: string | null
  bucket_name?: string | null
  created_at?: string | null
  file_copies?: PhotoFileCopyRow[] | null
}

export type VersionBundle = {
  versionNo: number
  files: PhotoFileRow[]
  byBranch: Partial<Record<'original' | 'raw' | 'thumb' | 'display' | 'client_preview', PhotoFileRow>>
}

function branchRank(branchType: string | null | undefined): number {
  switch (branchType) {
    case 'client_preview': return 5
    case 'display': return 4
    case 'thumb': return 3
    case 'original': return 2
    case 'raw': return 1
    default: return 0
  }
}

export function groupPhotoFilesByVersion(fileRows: PhotoFileRow[]): VersionBundle[] {
  const grouped = new Map<number, PhotoFileRow[]>()

  for (const row of fileRows) {
    const versionNo = Number(row.version_no) || 1
    const list = grouped.get(versionNo) ?? []
    list.push(row)
    grouped.set(versionNo, list)
  }

  return Array.from(grouped.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([versionNo, files]) => {
      const sortedFiles = [...files].sort((a, b) => {
        const branchDiff = branchRank(b.branch_type) - branchRank(a.branch_type)
        if (branchDiff !== 0) return branchDiff
        return (b.created_at || '').localeCompare(a.created_at || '')
      })

      const byBranch: VersionBundle['byBranch'] = {}
      for (const file of sortedFiles) {
        const branch = file.branch_type
        if (branch === 'original' || branch === 'raw' || branch === 'thumb' || branch === 'display' || branch === 'client_preview') {
          byBranch[branch] ??= file
        }
      }

      return { versionNo, files: sortedFiles, byBranch }
    })
}

export function getLatestVersionNo(fileRows: PhotoFileRow[]): number | null {
  const versions = groupPhotoFilesByVersion(fileRows)
  return versions.length > 0 ? versions[versions.length - 1].versionNo : null
}

export function getFirstVersionNo(fileRows: PhotoFileRow[]): number | null {
  const versions = groupPhotoFilesByVersion(fileRows)
  return versions.length > 0 ? versions[0].versionNo : null
}

export function getVersionFiles(fileRows: PhotoFileRow[], versionNo: number | null | undefined): VersionBundle | null {
  if (!versionNo) return null
  return groupPhotoFilesByVersion(fileRows).find((bundle) => bundle.versionNo === versionNo) ?? null
}

export function getLatestVersionFiles(fileRows: PhotoFileRow[]): VersionBundle | null {
  const latestVersionNo = getLatestVersionNo(fileRows)
  return getVersionFiles(fileRows, latestVersionNo)
}

export function getFirstVersionFiles(fileRows: PhotoFileRow[]): VersionBundle | null {
  const firstVersionNo = getFirstVersionNo(fileRows)
  return getVersionFiles(fileRows, firstVersionNo)
}

export function getPreferredThumbUrl(fileRows: PhotoFileRow[]): string {
  const latest = getLatestVersionFiles(fileRows)
  return latest?.byBranch.thumb ? resolvePhotoPublicUrl(latest.byBranch.thumb) : ''
}
