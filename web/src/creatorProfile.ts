// Design review item 3.11: outreach messages used to hardcode "Roxie,
// @roxm___" as the signature -- not multi-user-ready. This stores her
// name/handle (defaulting to the current real values, so nothing changes
// visibly until someone edits it in Ajustes) synced the same way as
// favorites/saved profiles.
import { pullSynced, writeSynced } from "./syncedStorage";

export interface CreatorProfile {
  name: string;
  handle: string;
}

const DEFAULT_PROFILE: CreatorProfile = { name: "Roxie", handle: "roxm___" };

export async function getCreatorProfile(): Promise<CreatorProfile> {
  return pullSynced<CreatorProfile>("creator_profile", DEFAULT_PROFILE);
}

export function saveCreatorProfile(profile: CreatorProfile): void {
  writeSynced("creator_profile", profile);
}
