import type { Album, Photo } from "@/data/mockData";

export type FolderMeta = { id: string; name: string };

/** Build album list for the sidebar: "All Photos" plus one entry per folder that has photos. */
export function buildAlbumsFromPhotos(
  photos: Photo[],
  folders?: FolderMeta[],
): Album[] {
  const all: Album = {
    id: "all",
    name: "All Photos",
    photoCount: photos.length,
  };

  const nameById = new Map<string, string>(
    (folders ?? []).map((f) => [f.id, f.name]),
  );

  const counts = new Map<string, number>();
  for (const p of photos) {
    const aid = p.albumId ?? p.folderId;
    if (aid) counts.set(aid, (counts.get(aid) ?? 0) + 1);
  }

  const rest: Album[] = Array.from(counts.entries()).map(([id, photoCount]) => ({
    id,
    name: nameById.get(id) ?? id,
    photoCount,
  }));

  rest.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  return [all, ...rest];
}
