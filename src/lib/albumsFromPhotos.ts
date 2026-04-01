import type { Album, Photo } from "@/data/mockData";

/** Build a flat album list for the detail UI: "All Photos" plus one entry per distinct photo.albumId. */
export function buildAlbumsFromPhotos(photos: Photo[]): Album[] {
  const all: Album = {
    id: "all",
    name: "All Photos",
    photoCount: photos.length,
  };

  const counts = new Map<string, number>();
  for (const p of photos) {
    const aid = p.albumId;
    if (aid) counts.set(aid, (counts.get(aid) ?? 0) + 1);
  }

  const rest: Album[] = Array.from(counts.entries()).map(([id, photoCount]) => ({
    id,
    name: id,
    photoCount,
  }));

  return [all, ...rest];
}
