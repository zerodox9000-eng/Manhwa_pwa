import type {
  AppSettings,
  AppStateSnapshot,
  Feed,
  FeedFolder,
  HomeSource,
  Profile,
  ProfileSessionState,
  ProfileState,
  ProfilesBackup,
  UserLabel,
} from "../domain/types";
import { profileDb } from "../db/appDb";
import { DEFAULT_HOME_SOURCE, normalizeFeedFolders } from "../domain/feedLibrary";

export const LEGACY_STATE_KEY = "manhwa-library-state-v1";
export const ACTIVE_PROFILE_KEY = "manhwa-active-profile-v1";
export const PROFILE_SCHEMA_VERSION = 2 as const;

export function createProfileId() {
  return globalThis.crypto?.randomUUID?.() ?? `profile-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function emptyProfileSession(lastRoute = "#/"): ProfileSessionState {
  return {
    lastRoute,
    scroll: {},
    searchHistory: [],
    openedTitleIds: [],
    searchQuery: "",
  };
}

export function createProfileRecord(name: string, accentColor: string, now = new Date().toISOString()): Profile {
  return {
    id: createProfileId(),
    name: name.trim(),
    accentColor,
    createdAt: now,
    updatedAt: now,
    lastUsedAt: now,
  };
}

export function createProfileState(
  profileId: string,
  input: {
    feeds: Feed[];
    folders?: FeedFolder[];
    homeSource?: HomeSource;
    labels?: UserLabel[];
    settings: AppSettings;
    activeFeedId?: string | null;
    session?: Partial<ProfileSessionState>;
    lastRoute?: string;
  },
): ProfileState {
  const homeSource: HomeSource = input.homeSource?.kind === "folder" && input.homeSource.folderId
    ? { kind: "folder", folderId: input.homeSource.folderId, continuous: Boolean(input.homeSource.continuous) }
    : { ...DEFAULT_HOME_SOURCE, continuous: Boolean(input.homeSource?.continuous) };
  return {
    profileId,
    schemaVersion: PROFILE_SCHEMA_VERSION,
    feeds: input.feeds,
    folders: normalizeFeedFolders(input.folders, new Set(input.feeds.map((feed) => feed.id))),
    homeSource,
    labels: input.labels ?? [],
    settings: input.settings,
    activeFeedId: input.activeFeedId ?? null,
    session: {
      ...emptyProfileSession(input.lastRoute),
      ...input.session,
      scroll: { ...(input.session?.scroll ?? {}) },
      searchHistory: [...(input.session?.searchHistory ?? [])],
      openedTitleIds: [...(input.session?.openedTitleIds ?? [])],
    },
  };
}

export function profileStateFromLegacy(
  profileId: string,
  snapshot: Partial<AppStateSnapshot>,
  fallback: { feeds: Feed[]; settings: AppSettings; session?: Partial<ProfileSessionState> },
): ProfileState {
  return createProfileState(profileId, {
    feeds: snapshot.feeds ?? fallback.feeds,
    folders: normalizeFeedFolders(snapshot.folders, new Set((snapshot.feeds ?? fallback.feeds).map((feed) => feed.id))),
    homeSource: snapshot.homeSource,
    labels: snapshot.labels,
    settings: snapshot.settings ?? fallback.settings,
    activeFeedId: snapshot.activeFeedId,
    session: fallback.session,
    lastRoute: snapshot.lastRoute || fallback.session?.lastRoute || "#/",
  });
}

export async function loadProfiles() {
  const profiles = await profileDb.profiles.toArray();
  return profiles.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export async function loadProfileState(profileId: string) {
  return profileDb.profileStates.get(profileId);
}

export async function saveProfile(profile: Profile, state: ProfileState) {
  await profileDb.transaction("rw", profileDb.profiles, profileDb.profileStates, async () => {
    await profileDb.profiles.put(profile);
    await profileDb.profileStates.put(state);
  });
}

export async function migrateLegacyProfile(
  legacySnapshot: Partial<AppStateSnapshot> | null,
  fallback: { feeds: Feed[]; settings: AppSettings; session?: Partial<ProfileSessionState> },
) {
  return profileDb.transaction("rw", profileDb.profiles, profileDb.profileStates, async () => {
    const existing = await profileDb.profiles.toArray();
    if (existing.length > 0) {
      return existing.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    }

    const profile = createProfileRecord("User 1", (legacySnapshot?.settings ?? fallback.settings).accentColor);
    const state = profileStateFromLegacy(profile.id, legacySnapshot ?? {}, fallback);
    await profileDb.profiles.put(profile);
    await profileDb.profileStates.put(state);
    return [profile];
  });
}

export async function deleteProfileRecord(profileId: string) {
  await profileDb.transaction("rw", profileDb.profiles, profileDb.profileStates, async () => {
    await profileDb.profileStates.delete(profileId);
    await profileDb.profiles.delete(profileId);
  });
}

export async function makeProfilesBackup(activeProfileId: string): Promise<ProfilesBackup> {
  const profiles = await loadProfiles();
  const states = await profileDb.profileStates.bulkGet(profiles.map((profile) => profile.id));
  return {
    kind: "manhwa-profiles-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    activeProfileId,
    profiles: profiles.flatMap((profile, index) => {
      const state = states[index];
      return state ? [{ profile, state }] : [];
    }),
  };
}
