// Design review follow-up (Ryan): an explicit "save" for a searched
// profile, distinct from the Worker's own auto-save-every-search cache
// (savedSearches.ts/listSavedSearches -- that's Roxie's full research
// history, used here only as "Recientes"). Only profiles saved here show
// in Cuentas -> Guardadas. Synced like Mis Productos (pullSynced/
// writeSynced), so it works across her phone and computer with no new
// Worker deploy (reuses the existing generic /state route).
import { pullSynced, writeSynced } from "./syncedStorage";

export interface SavedProfile {
  handle: string;
  nickname: string;
  avatar: string | null;
  follower_count: number;
  day28_gmv: number;
  saved_at: string;
}

export async function getSavedProfiles(): Promise<SavedProfile[]> {
  return pullSynced<SavedProfile[]>("saved_profiles", []);
}

export async function isProfileSaved(handle: string): Promise<boolean> {
  const list = await getSavedProfiles();
  return list.some((p) => p.handle === handle);
}

export async function toggleSavedProfile(profile: Omit<SavedProfile, "saved_at">): Promise<boolean> {
  const list = await getSavedProfiles();
  const existing = list.findIndex((p) => p.handle === profile.handle);
  if (existing >= 0) {
    const next = list.filter((p) => p.handle !== profile.handle);
    writeSynced("saved_profiles", next);
    return false;
  }
  const next = [...list, { ...profile, saved_at: new Date().toISOString() }];
  writeSynced("saved_profiles", next);
  return true;
}
