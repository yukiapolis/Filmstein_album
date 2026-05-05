import sharp from 'sharp'
import { clampWatermarkOpacity, clampWatermarkScale, getWatermarkLayout } from '@/lib/clientWatermark'

export const BRANCH_TYPE_CLIENT_PREVIEW = 'client_preview'

export type WatermarkSettings = {
  enabled?: boolean
  position?: string
  offset_x?: number
  offset_y?: number
  scale?: number
  opacity?: number
}

export function getClientPreviewKey(params: {
  projectId: string
  photoId: string
  versionedBaseName: string
}) {
  return `${params.projectId}/${params.photoId}/client-preview/${params.versionedBaseName}.jpg`
}

export function getClientPreviewFileName(versionedBaseName: string) {
  return `${versionedBaseName}.jpg`
}

export async function buildWatermarkedClientPreview(params: {
  sourceBuffer: Buffer
  logoBuffer: Buffer
  logoAspectRatio?: number
  watermark: WatermarkSettings
  mode?: 'preview' | 'download'
}) {
  const mode = params.mode ?? 'preview'
  const normalizedSource = sharp(params.sourceBuffer).rotate()
  const baseMeta = await normalizedSource.metadata()
  const width = baseMeta.width || 1600
  const height = baseMeta.height || 1200
  const scale = clampWatermarkScale(Number(params.watermark.scale ?? 1))
  const opacity = clampWatermarkOpacity(Number(params.watermark.opacity ?? 1))
  const fallbackLogoMeta = params.logoAspectRatio && params.logoAspectRatio > 0
    ? null
    : await sharp(params.logoBuffer).metadata()
  const resolvedLogoAspectRatio = params.logoAspectRatio && params.logoAspectRatio > 0
    ? params.logoAspectRatio
    : (fallbackLogoMeta?.width || 1) / Math.max(1, fallbackLogoMeta?.height || 1)
  const layout = getWatermarkLayout({
    config: {
      enabled: true,
      position: String(params.watermark.position || 'bottom-right'),
      offsetX: Number(params.watermark.offset_x ?? 0),
      offsetY: Number(params.watermark.offset_y ?? 0),
      scale,
      opacity,
    },
    baseWidth: width,
    baseHeight: height,
    logoAspectRatio: resolvedLogoAspectRatio,
    mode: mode === 'download' ? 'download' : 'preview',
  })

  const resizedLogo = await sharp(params.logoBuffer)
    .resize({ width: layout.width, withoutEnlargement: true })
    .png()
    .toBuffer()

  const logoWithOpacity = await sharp(resizedLogo).ensureAlpha(layout.opacity).png().toBuffer()
  return Buffer.from(await normalizedSource
    .clone()
    .composite([
      { input: logoWithOpacity, left: layout.left, top: layout.top, blend: 'over' },
    ])
    .jpeg({ quality: mode === 'download' ? 92 : 84, mozjpeg: true })
    .toBuffer())
}
