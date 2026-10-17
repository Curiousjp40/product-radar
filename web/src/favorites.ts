import { pullSynced, writeSynced } from "./syncedStorage";
import { emptyFavorites, type Favorites } from "./favoritesLogic";

export async function getFavorites(): Promise<Favorites> {
  return pullSynced<Favorites>("favorites", emptyFavorites());
}

export function saveFavorites(fav: Favorites): void {
  writeSynced("favorites", fav);
}
