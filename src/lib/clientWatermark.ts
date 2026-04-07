import type { Project } from "@/data/mockData";

export type WatermarkConfig = {
  enabled: boolean;
  logoUrl?: string;
  position: string;
  offsetX: number;
  offsetY: number;
  scale: number;
  opacity: number;
};

export function getClientHeroImage(project: Project | null) {
  return project?.project_assets?.banner?.url || project?.project_assets?.cover?.url || project?.cover_url || "/default-cover.svg";
}

export function getClientWatermarkConfig(project: Project | null): WatermarkConfig {
  const watermark = project?.visual_settings?.watermark;
  return {
    enabled: Boolean(watermark?.enabled && project?.project_assets?.watermark_logo?.url),
    logoUrl: project?.project_assets?.watermark_logo?.url,
    position: watermark?.position || 'bottom-right',
    offsetX: Number(watermark?.offset_x ?? 0),
    offsetY: Number(watermark?.offset_y ?? 0),
    scale: Number(watermark?.scale ?? 1),
    opacity: Number(watermark?.opacity ?? 1),
  };
}

export function getWatermarkStyle(config: WatermarkConfig) {
  const safeScale = Math.max(0.2, config.scale || 1)
  const base: Record<string, string | number> = {
    width: `${120 * safeScale}px`,
    opacity: Math.min(1, Math.max(0, config.opacity || 1)),
  }

  if (config.position === 'custom') {
    return {
      ...base,
      left: `calc(50% + ${config.offsetX}px)`,
      top: `calc(50% + ${config.offsetY}px)`,
      transform: 'translate(-50%, -50%)',
    }
  }

  const vertical = config.position.startsWith('top') ? 'top' : 'bottom'
  const horizontal = config.position.endsWith('left') ? 'left' : 'right'

  return {
    ...base,
    [vertical]: `${16 + config.offsetY}px`,
    [horizontal]: `${16 + config.offsetX}px`,
  }
}
