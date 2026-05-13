import type { Album, Photo } from "@/data/mockData";

export type FolderMeta = {
  id: string;
  name: string;
  parent_id?: string | null;
  photo_count?: number;
  access_mode?: 'public' | 'hidden' | 'password_protected';
  unlocked?: boolean;
};

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
  const parentById = new Map<string, string | null>(
    (folders ?? []).map((f) => [f.id, f.parent_id ?? null]),
  );

  const counts = new Map<string, number>();
  const countByFolderId = new Map<string, number>((folders ?? []).map((folder) => [folder.id, Number(folder.photo_count) || 0]))
  for (const p of photos) {
    const aid = p.albumId ?? p.folderId;
    if (aid) counts.set(aid, (counts.get(aid) ?? 0) + 1);
  }

  const nodes = new Map<string, Album>();

  for (const folder of folders ?? []) {
    nodes.set(folder.id, {
      id: folder.id,
      name: folder.name,
      photoCount: countByFolderId.get(folder.id) ?? counts.get(folder.id) ?? 0,
      parentId: folder.parent_id ?? undefined,
      accessMode: folder.access_mode ?? 'public',
      unlocked: folder.unlocked === true,
      children: [],
    });
  }

  for (const [id, photoCount] of counts.entries()) {
    if (!nodes.has(id)) {
      nodes.set(id, {
        id,
        name: nameById.get(id) ?? id,
        photoCount,
        parentId: parentById.get(id) ?? undefined,
        accessMode: 'public',
        unlocked: true,
        children: [],
      });
    } else {
      nodes.get(id)!.photoCount = photoCount;
    }
  }

  const roots: Album[] = [];
  for (const album of nodes.values()) {
    const parentId = album.parentId;
    if (parentId && parentId !== 'all' && nodes.has(parentId)) {
      nodes.get(parentId)?.children?.push(album);
    } else {
      roots.push(album);
    }
  }

  const sortAlbums = (albums: Album[]) => {
    albums.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    albums.forEach((album) => {
      if (album.children?.length) sortAlbums(album.children);
      else delete album.children;
    });
  };

  sortAlbums(roots);

  return [all, ...roots];
}
