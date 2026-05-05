export type ProjectAssetKey = 'cover' | 'banner' | 'splash_poster' | 'loading_gif' | 'watermark_logo'

export function buildProjectAssetApiUrl(projectId: string, assetType: ProjectAssetKey, cacheBust?: string | number) {
  const qs = cacheBust === undefined ? '' : `?v=${encodeURIComponent(String(cacheBust))}`
  return `/api/projects/${projectId}/assets/${assetType}${qs}`
}
