import type { Project } from "@/data/mockData";

export type WatermarkConfig = {
  enabled: boolean;
  logoUrl?: string;
  logoVersion?: string;
  position: string;
  offsetX: number;
  offsetY: number;
  scale: number;
  opacity: number;
};

export const WATERMARK_LAYOUT_VERSION = 'v7'

const WATERMARK_BASE_SHORT_SIDE_RATIO = 0.18
const WATERMARK_MARGIN_SHORT_SIDE_RATIO = 0.04
const MIN_SCALE = 0.2
const MAX_SCALE = 2.5
const LEGACY_CUSTOM_POSITION_OFFSET_THRESHOLD = 5
const LEGACY_CUSTOM_POSITION_SCALE_CAP = 1

export function normalizeWatermarkConfig(config: WatermarkConfig): WatermarkConfig {
  const normalized: WatermarkConfig = {
    ...config,
    position: config.position || 'bottom-right',
    offsetX: Number(config.offsetX || 0),
    offsetY: Number(config.offsetY || 0),
    scale: clampWatermarkScale(config.scale),
    opacity: clampWatermarkOpacity(config.opacity),
  }

  const looksLikeLegacyCenteredCustomPlacement = normalized.position === 'custom'
    && Math.abs(normalized.offsetX) <= LEGACY_CUSTOM_POSITION_OFFSET_THRESHOLD
    && Math.abs(normalized.offsetY) <= LEGACY_CUSTOM_POSITION_OFFSET_THRESHOLD

  if (looksLikeLegacyCenteredCustomPlacement) {
    return {
      ...normalized,
      position: 'bottom-right',
      offsetX: 0,
      offsetY: 0,
      scale: Math.min(normalized.scale, LEGACY_CUSTOM_POSITION_SCALE_CAP),
    }
  }

  return normalized
}

export function getClientHeroImage(project: Project | null) {
  return project?.project_assets?.banner?.url || project?.project_assets?.cover?.url || project?.cover_url || "/default-cover.svg";
}

export function clampWatermarkScale(value: number) {
  if (Number.isNaN(value)) return 1
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value))
}

export function clampWatermarkOpacity(value: number) {
  if (Number.isNaN(value)) return 1
  return Math.min(1, Math.max(0, value))
}

export function getClientWatermarkConfig(project: Project | null): WatermarkConfig {
  const watermark = project?.visual_settings?.watermark;
  const asset = project?.project_assets?.watermark_logo
  return normalizeWatermarkConfig({
    enabled: Boolean(watermark?.enabled && asset?.url),
    logoUrl: asset?.url,
    logoVersion: typeof asset?.version_token === 'string' ? asset.version_token : undefined,
    position: watermark?.position || 'bottom-right',
    offsetX: Number(watermark?.offset_x ?? 0),
    offsetY: Number(watermark?.offset_y ?? 0),
    scale: clampWatermarkScale(Number(watermark?.scale ?? 1)),
    opacity: clampWatermarkOpacity(Number(watermark?.opacity ?? 1)),
  });
}

export function getWatermarkVersionSignature(project: Project | null) {
  const config = getClientWatermarkConfig(project)
  return [
    WATERMARK_LAYOUT_VERSION,
    config.enabled ? '1' : '0',
    config.logoUrl || '',
    config.logoVersion || '',
    config.position,
    config.offsetX,
    config.offsetY,
    config.scale,
    config.opacity,
  ].join('|')
}

export function getWatermarkLayout(params: {
  config: WatermarkConfig
  baseWidth: number
  baseHeight: number
  logoAspectRatio?: number
  mode?: 'preview' | 'download' | 'settings'
}) {
  const { baseWidth, baseHeight } = params
  const config = normalizeWatermarkConfig(params.config)
  const logoAspectRatio = Math.max(0.1, params.logoAspectRatio || 2)
  const shortSide = Math.max(1, Math.min(baseWidth, baseHeight))
  const scale = clampWatermarkScale(config.scale)
  const margin = Math.max(8, Math.round(shortSide * WATERMARK_MARGIN_SHORT_SIDE_RATIO))
  const offsetX = Math.round(baseWidth * (Number(config.offsetX || 0) / 100))
  const offsetY = Math.round(baseHeight * (Number(config.offsetY || 0) / 100))
  const requestedWidth = Math.round(shortSide * Math.min(0.5, Math.max(0.04, WATERMARK_BASE_SHORT_SIDE_RATIO * scale)))
  const maxWidth = Math.max(1, baseWidth - margin * 2)
  const maxHeight = Math.max(1, baseHeight - margin * 2)

  let width = Math.max(12, Math.min(maxWidth, requestedWidth))
  let height = Math.max(6, Math.round(width / logoAspectRatio))

  if (height > maxHeight) {
    height = maxHeight
    width = Math.max(1, Math.min(maxWidth, Math.round(height * logoAspectRatio)))
  }

  if (width > maxWidth) {
    width = maxWidth
    height = Math.max(1, Math.min(maxHeight, Math.round(width / logoAspectRatio)))
  }

  let left = baseWidth - width - margin + offsetX
  let top = baseHeight - height - margin + offsetY

  if (config.position === 'top-left') {
    left = margin + offsetX
    top = margin + offsetY
  } else if (config.position === 'top-right') {
    left = baseWidth - width - margin + offsetX
    top = margin + offsetY
  } else if (config.position === 'bottom-left') {
    left = margin + offsetX
    top = baseHeight - height - margin + offsetY
  } else if (config.position === 'custom' || config.position === 'center') {
    left = Math.round((baseWidth - width) / 2) + offsetX
    top = Math.round((baseHeight - height) / 2) + offsetY
  }

  return {
    width: Math.max(1, Math.min(baseWidth, width)),
    height: Math.max(1, Math.min(baseHeight, height)),
    left: Math.max(0, Math.min(baseWidth - Math.max(1, Math.min(baseWidth, width)), left)),
    top: Math.max(0, Math.min(baseHeight - Math.max(1, Math.min(baseHeight, height)), top)),
    opacity: clampWatermarkOpacity(config.opacity),
  }
}

export function getWatermarkStyle(params: {
  config: WatermarkConfig
  baseWidth?: number
  baseHeight?: number
  logoAspectRatio?: number
  mode?: 'preview' | 'download' | 'settings'
}) {
  const baseWidth = params.baseWidth ?? 1500
  const baseHeight = params.baseHeight ?? 1000
  const layout = getWatermarkLayout({
    config: params.config,
    baseWidth,
    baseHeight,
    logoAspectRatio: params.logoAspectRatio,
    mode: params.mode,
  })

  return {
    width: `${(layout.width / baseWidth) * 100}%`,
    left: `${(layout.left / baseWidth) * 100}%`,
    top: `${(layout.top / baseHeight) * 100}%`,
    opacity: layout.opacity,
  }
}
