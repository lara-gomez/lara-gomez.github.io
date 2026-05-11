import {
  ref,
  computed,
  watch,
  onMounted,
  onUnmounted,
  nextTick,
} from "vue";
import { useRoute, useRouter } from "vue-router";
import { contentSearchHaystack } from "./linkify.js";
import {
  useGraffiti,
  useGraffitiSession,
  useGraffitiDiscover,
} from "@graffiti-garden/wrapper-vue";

/** Shared discover channel for chat Create objects (assets/graffiti.md). */
const DIRECTORY = "hw10-messages-v3-participants";

const NO_CHAT = "hw10-no-chat-selected";

/**
 * Max length for shared chat titles and private labels (~1–2 short lines in the UI).
 * Matches JSON schema `maxLength` on directory `title` fields.
 */
const CHAT_LABEL_MAX_LENGTH = 100;

const schemaDirectoryCreate = {
  properties: {
    value: {
      required: ["published", "channel", "activity", "type"],
      properties: {
        published: { type: "number" },
        channel: { type: "string" },
        activity: { const: "Create" },
        type: { const: "Chat" },
        participants: { type: "array", items: { type: "string" } },
        title: { type: "string", maxLength: CHAT_LABEL_MAX_LENGTH },
      },
    },
  },
};

const schemaDirectoryUpdate = {
  properties: {
    value: {
      required: ["published", "channel", "activity", "type", "participants"],
      properties: {
        published: { type: "number" },
        channel: { type: "string" },
        activity: { const: "Update" },
        type: { const: "Chat" },
        participants: { type: "array", items: { type: "string" } },
        title: { type: "string", maxLength: CHAT_LABEL_MAX_LENGTH },
      },
    },
  },
};

const schemaDirectoryLeave = {
  properties: {
    value: {
      required: ["published", "channel", "activity", "type"],
      properties: {
        published: { type: "number" },
        channel: { type: "string" },
        activity: { const: "LeaveChat" },
        type: { const: "Chat" },
      },
    },
  },
};

const schemaMessage = {
  properties: {
    value: {
      required: ["content", "published"],
      properties: {
        content: { type: "string" },
        published: { type: "number" },
        mediaType: { type: "string" },
        activity: { type: "string" },
        type: { type: "string" },
        sender: { type: "string" },
        /** URL from `graffiti.postMedia` (see assets/graffiti.md). */
        attachmentUrl: { type: "string" },
      },
    },
  },
};

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

const schemaRecentSearch = {
  properties: {
    value: {
      required: ["published", "activity", "query"],
      properties: {
        published: { type: "number" },
        activity: { const: "RecentSearch" },
        query: { type: "string" },
      },
    },
  },
};

const schemaSaveSearchResult = {
  properties: {
    value: {
      required: ["published", "activity", "name", "querySnapshot", "snippet"],
      properties: {
        published: { type: "number" },
        activity: { const: "SaveSearchResult" },
        name: { type: "string" },
        querySnapshot: { type: "string" },
        snippet: { type: "string" },
        messageUrl: { type: "string" },
        /** Optional source thread channel — enables click-through from the Pinned page. */
        threadChannel: { type: "string" },
      },
    },
  },
};

function base64UrlFromUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/=+/g, "");
}

function personalPrefsChannel(actor) {
  if (!actor) return NO_CHAT;
  return `personal-prefs-${base64UrlFromUtf8(actor)}`;
}

function dayStartMs(isoDate) {
  if (!isoDate) return null;
  return new Date(`${isoDate}T00:00:00`).getTime();
}

function dayEndMs(isoDate) {
  if (!isoDate) return null;
  return new Date(`${isoDate}T23:59:59.999`).getTime();
}

export function formatHandle(handleOrActor) {
  if (!handleOrActor) return "";
  const s = String(handleOrActor).trim();
  if (!s) return "";
  if (s.startsWith("at://")) {
    const m = s.match(/^at:\/\/([^/]+)/i);
    return m?.[1] || s;
  }
  if (s.startsWith("did:")) {
    const tail = s.split(":").pop() || s;
    return tail.length > 20 ? `${tail.slice(0, 12)}…${tail.slice(-6)}` : tail;
  }
  const m = s.match(/^([a-z0-9._-]+)\.graffiti\.actor$/i);
  if (m) return m[1];
  return s;
}

/** Resolved labels from `UserName` / prefetch — keeps `<select>` labels in sync with the chat list. */
const actorDisplayCache = new Map();
export const actorDisplayVersion = ref(0);

export function syncActorDisplayCache(actor, display) {
  if (!actor || typeof display !== "string") return;
  const t = display.trim();
  if (!t) return;
  if (actorDisplayCache.get(actor) === t) return;
  actorDisplayCache.set(actor, t);
  actorDisplayVersion.value++;
}

export function clearActorDisplayCache() {
  actorDisplayCache.clear();
  actorDisplayVersion.value++;
}

function peekActorDisplayCache(actor) {
  return actor ? actorDisplayCache.get(actor) ?? null : null;
}

/**
 * Whether a lowercase contact query matches an actor for chip filtering.
 * Uses raw id, `formatHandle`, and cached display from `UserName` / prefetch
 * so typing visible names works, not only DIDs.
 */
export function actorMatchesContactSearch(actor, queryLower) {
  if (!queryLower) return true;
  if (!actor) return false;
  const id = String(actor).toLowerCase();
  if (id.includes(queryLower)) return true;
  if (formatHandle(actor).toLowerCase().includes(queryLower)) return true;
  const cached = peekActorDisplayCache(actor);
  if (cached && String(cached).toLowerCase().includes(queryLower)) return true;
  return false;
}

function messageActor(obj) {
  return obj.value.sender || obj.actor;
}

function messageThreadId(obj) {
  const chs = obj.channels;
  if (Array.isArray(chs) && chs.length) return chs[0];
  return null;
}

function isExplicitActorId(l) {
  return (
    l.startsWith("graffiti:") || l.startsWith("at://") || l.startsWith("did:")
  );
}

async function resolveRecipientLine(graffiti, line) {
  const raw = line.replace(/^@/, "").trim();
  if (!raw) return null;
  if (isExplicitActorId(raw)) return raw;

  let l = raw;
  if (
    !/\.graffiti\.actor$/i.test(raw) &&
    /^[a-z0-9._-]+$/i.test(raw)
  ) {
    l = `${raw}.graffiti.actor`;
  }

  try {
    const resolved = await graffiti.handleToActor(l);
    if (resolved) return resolved;
  } catch (_) {
    /* ignore */
  }
  return null;
}

function sameParticipantSet(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  const sa = new Set(a);
  for (const x of b) if (!sa.has(x)) return false;
  return true;
}

function filterChatsForActor(chats, actor, effectiveFn) {
  if (!actor) return [];
  return chats.filter((c) => {
    const p = effectiveFn ? effectiveFn(c) : c.value?.participants;
    if (Array.isArray(p) && p.length > 0) {
      return p.includes(actor) || c.actor === actor;
    }
    if (Array.isArray(c.allowed) && c.allowed.length && c.allowed.includes(actor)) {
      return true;
    }
    return c.actor === actor;
  });
}

function mineOnly(objs, actor) {
  if (!actor) return [];
  return objs.filter((o) => o.actor === actor);
}

function buildCreateChatPost(channelId, participants) {
  return {
    value: {
      activity: "Create",
      type: "Chat",
      channel: channelId,
      participants,
      published: Date.now(),
    },
    channels: [DIRECTORY],
  };
}

function buildSendMessagePost(threadChannel, content, senderActor, attachmentUrl) {
  const value = {
    activity: "Send",
    type: "Message",
    content: content || "",
    sender: senderActor,
    mediaType: attachmentUrl ? "image" : "text",
    published: Date.now(),
  };
  if (attachmentUrl) {
    value.attachmentUrl = attachmentUrl;
  }
  return {
    value,
    channels: [threadChannel],
  };
}

function isStorageForbiddenError(err) {
  if (!err) return false;
  if (err.name === "GraffitiErrorForbidden") return true;
  const s = String(err.message ?? err);
  return /403|Forbidden/i.test(s);
}

function alertGraffitiPostFailed(kind, err) {
  const detail = err?.message || String(err);
  if (isStorageForbiddenError(err)) {
    window.alert(
      `Graffiti refused to write to your storage (HTTP 403). Each user’s posts upload to that user’s bucket on graffiti.actor first.\n\nTry: log out, clear site data for this origin, log in again. If only some accounts fail, ask course staff whether those Graffiti accounts have storage enabled.\n\nDetails: ${detail}`,
    );
    return;
  }
  window.alert(`${kind} failed: ${detail}`);
}

export function useMessagesState() {
  const graffiti = useGraffiti();
  const session = useGraffitiSession();

  watch(
    () => session.value?.actor,
    (actor, prev) => {
      if (actor !== prev) clearActorDisplayCache();
    },
  );
  const route = useRoute();
  const router = useRouter();

  const channel = ref(null);
  const myMessage = ref("");
  /** Pending image for the next send (`File` from `<input type="file">`). */
  const selectedImageFile = ref(null);
  /** Bumps to reset the file input after send/clear. */
  const imageInputKey = ref(0);
  /** Resolved actor ids (excluding me) chosen one-at-a-time in compose. */
  const pendingRecipients = ref([]);
  const pendingRecipientInput = ref("");
  const isAddingRecipient = ref(false);
  const composeOpen = ref(false);
  const isSending = ref(false);
  const isDeleting = ref(new Set());
  const isDeletingChat = ref(new Set());
  const isCreatingChat = ref(false);
  const isManagingPeople = ref(false);
  const manageRecipientInput = ref("");
  const isManageAdding = ref(false);

  const searchQuery = ref("");
  const mediaFilter = ref("any");
  /** Actor ids for "From person" search; empty = anyone. OR semantics when multiple. */
  const peopleFilterActors = ref([]);
  const dateFrom = ref("");
  const dateTo = ref("");
  const searchResults = ref([]);

  /** Lightweight global toast: { text, key } shown by the layout shell. */
  const toast = ref(null);
  let toastTimer;
  function showToast(text, ms = 2400) {
    if (!text) return;
    toast.value = { text, key: (toast.value?.key ?? 0) + 1 };
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.value = null;
      toastTimer = undefined;
    }, ms);
  }

  function handleImageSelect(event) {
    const file = event.target.files?.[0];
    if (!file) {
      selectedImageFile.value = null;
      return;
    }
    if (!file.type.startsWith("image/")) {
      window.alert("Please choose an image file.");
      selectedImageFile.value = null;
      event.target.value = "";
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      window.alert("Images must be 25 MB or smaller (Graffiti media limit).");
      selectedImageFile.value = null;
      event.target.value = "";
      return;
    }
    selectedImageFile.value = file;
  }

  function clearPendingImage() {
    selectedImageFile.value = null;
    imageInputKey.value += 1;
  }

  const pendingImageName = computed(() => selectedImageFile.value?.name ?? "");

  watch(channel, (ch, prev) => {
    if (prev !== ch) clearPendingImage();
  });

  /** `?thread=` on Chats (home) / results — null means all conversations. */
  function normalizeThreadQuery(t) {
    if (typeof t !== "string") return null;
    const s = t.trim();
    return s || null;
  }

  const searchThreadScopeSelect = computed({
    get() {
      const t = normalizeThreadQuery(route.query.thread);
      return t ? chatChannelMapKey(t) : "";
    },
    set(v) {
      const raw = v && String(v).trim() ? String(v).trim() : null;
      const tid = raw ? chatChannelMapKey(raw) : null;
      const q = { ...route.query };
      if (tid) q.thread = tid;
      else delete q.thread;
      if (route.name === "search-results") {
        router.replace({ name: "search-results", query: q });
      } else {
        router.replace({ name: "home", query: q });
      }
    },
  });

  /** `<select>` model: canonical key so it always matches an `<option value>`. */
  const searchScopeSelectValue = computed(() => searchThreadScopeSelect.value);

  function chatScopeOptionValue(chat) {
    return chatChannelMapKey(chat?.value?.channel);
  }

  /** Set search scope (channel id or empty for all); used by scope picker UI. */
  function pickSearchScope(channelId) {
    searchThreadScopeSelect.value = channelId ? String(channelId) : "";
  }

  const searchRunButtonLabel = computed(() =>
    normalizeThreadQuery(route.query.thread)
      ? "Search this chat only"
      : "Search all my chats",
  );

  /** Search is allowed with an empty text box when filters narrow results (media, people, dates). */
  const searchCanSubmit = computed(() => {
    if (searchQuery.value.trim()) return true;
    if (mediaFilter.value !== "any") return true;
    if (peopleFilterActors.value.length > 0) return true;
    if (String(dateFrom.value || "").trim()) return true;
    if (String(dateTo.value || "").trim()) return true;
    return false;
  });

  const personalCh = computed(() => personalPrefsChannel(session.value?.actor));

  /** Public directory — discover without session (assets/graffiti.md). */
  const { objects: chatsRaw, poll: pollChats } = useGraffitiDiscover(
    [DIRECTORY],
    schemaDirectoryCreate,
    undefined,
    false,
  );

  const { objects: chatUpdatesRaw, poll: pollChatUpdates } = useGraffitiDiscover(
    [DIRECTORY],
    schemaDirectoryUpdate,
    undefined,
    false,
  );

  const { objects: chatLeavesRaw, poll: pollChatLeaves } = useGraffitiDiscover(
    [DIRECTORY],
    schemaDirectoryLeave,
    undefined,
    false,
  );

  /** Stable Map key for thread channel ids (Create / Update / Leave must agree). */
  function chatChannelMapKey(cid) {
    if (cid === undefined || cid === null || cid === "") return "";
    return String(cid);
  }

  /**
   * channel -> latest Update from the **chat creator** for that channel.
   * Non-creator updates must not win by `published` alone — otherwise
   * `effectiveParticipants` ignores them and falls back to Create participants,
   * which still lists removed people ("already in this chat" after re-add).
   */
  const chatUpdatesByChannel = computed(() => {
    const creatorByKey = new Map();
    for (const c of chatsRaw.value) {
      const key = chatChannelMapKey(c.value?.channel);
      if (!key) continue;
      creatorByKey.set(key, c.actor);
    }
    const map = new Map();
    for (const u of chatUpdatesRaw.value) {
      const key = chatChannelMapKey(u.value?.channel);
      if (!key) continue;
      const creator = creatorByKey.get(key);
      if (!creator || u.actor !== creator) continue;
      const cur = map.get(key);
      if (!cur || (u.value.published || 0) > (cur.value.published || 0)) {
        map.set(key, u);
      }
    }
    return map;
  });

  /** channel -> Set<actor> of self-leavers. */
  const leavesByChannel = computed(() => {
    const map = new Map();
    for (const l of chatLeavesRaw.value) {
      const key = chatChannelMapKey(l.value?.channel);
      const a = l.actor;
      if (!key || !a) continue;
      if (!map.has(key)) map.set(key, new Set());
      map.get(key).add(a);
    }
    return map;
  });

  /**
   * channel key -> shared title from the latest creator Update that included a
   * `title` field. Empty string clears a prior name. Updates without `title`
   * leave the name unchanged. Create `title` is ignored.
   */
  const customTitleByChannel = computed(() => {
    const creatorByKey = new Map();
    for (const c of chatsRaw.value) {
      const key = chatChannelMapKey(c.value?.channel);
      if (!key) continue;
      creatorByKey.set(key, c.actor);
    }
    const latest = new Map();
    for (const u of chatUpdatesRaw.value) {
      const key = chatChannelMapKey(u.value?.channel);
      if (!key) continue;
      const creator = creatorByKey.get(key);
      if (!creator || u.actor !== creator) continue;
      const v = u.value;
      if (!v || !Object.prototype.hasOwnProperty.call(v, "title")) continue;
      const raw = v.title;
      const str = typeof raw === "string" ? raw.trim() : "";
      const pub = v.published ?? 0;
      const prev = latest.get(key);
      if (!prev || pub >= prev.pub) {
        latest.set(key, { str, pub });
      }
    }
    const out = new Map();
    for (const [k, row] of latest) {
      if (row.str) out.set(k, row.str);
    }
    return out;
  });

  function effectiveParticipants(chat) {
    if (!chat?.value?.channel) return [];
    const key = chatChannelMapKey(chat.value.channel);
    if (!key) return [];
    const update = chatUpdatesByChannel.value.get(key);
    /** `chatUpdatesByChannel` is creator-only; do not require `update.actor === chat.actor` — Graffiti may normalize actor strings differently on Create vs Update rows, which would drop valid updates and leave the roster stuck on the original Create list. */
    const fromUpdate =
      update && Array.isArray(update.value.participants)
        ? update.value.participants
        : null;
    const base =
      fromUpdate || (Array.isArray(chat.value.participants) ? chat.value.participants : []);
    const left = leavesByChannel.value.get(key);
    if (!left || !left.size) return base;
    /**
     * Self-leaves hide someone when we only have the stale Create participant list.
     * When the creator’s latest `Update` lists a roster, that list is authoritative:
     * re-adding someone after they left must not keep stripping them via `LeaveChat`.
     * Otherwise they vanish from the roster and from `myChats` / message discovery.
     */
    if (fromUpdate) return base;
    return base.filter((a) => !left.has(a));
  }

  const myChats = computed(() =>
    filterChatsForActor(chatsRaw.value, session.value?.actor, effectiveParticipants),
  );

  /**
   * All Create-Chat rows where I'm currently an effective participant
   * (including chats created by other members).
   */
  const chatsBySetForCurrentUser = computed(() => {
    const me = session.value?.actor;
    if (!me) return [];
    const out = [];
    for (const c of chatsRaw.value) {
      const eff = effectiveParticipants(c);
      if (eff.includes(me)) out.push(c);
    }
    return out;
  });

  function applyChatSelection(ch) {
    channel.value = ch;
    composeOpen.value = false;
    peopleFilterActors.value = [];
    dateFrom.value = "";
    dateTo.value = "";
  }

  function syncRouteToState() {
    const n = route.name;
    if (n === "home") {
      channel.value = null;
      composeOpen.value = false;
      if (route.query?.from === "thread-search" && normalizeThreadQuery(route.query.thread)) {
        showToast("Searching in this chat");
        const q = { ...route.query };
        delete q.from;
        router.replace({ name: "home", query: q, hash: route.hash || "#search-tools" });
      }
    } else if (n === "search-results") {
      channel.value = null;
      composeOpen.value = false;
    } else if (n === "compose") {
      channel.value = null;
      composeOpen.value = true;
      pendingRecipients.value = [];
      pendingRecipientInput.value = "";
    } else if (n === "chat" && route.params.chatId) {
      applyChatSelection(String(route.params.chatId));
      isManagingPeople.value = false;
      manageRecipientInput.value = "";
    }
  }

  watch(() => route.fullPath, syncRouteToState, { immediate: true });

  const discoverMessageChannels = computed(() => {
    const ids = [...new Set(myChats.value.map((c) => c.value.channel).filter(Boolean))];
    return ids.length ? ids : [NO_CHAT];
  });

  const { objects: allMessageObjects, poll: pollAllMessages } = useGraffitiDiscover(
    () => discoverMessageChannels.value,
    schemaMessage,
    undefined,
    false,
  );

  const { objects: threadMessageObjects, isFirstPoll: areMessageObjectsLoading } =
    useGraffitiDiscover(
      () => (channel.value ? [channel.value] : [NO_CHAT]),
      schemaMessage,
      undefined,
      true,
    );

  const sortedMessageObjects = computed(() =>
    threadMessageObjects.value.toSorted((a, b) => a.value.published - b.value.published),
  );

  function rosterActors(chat) {
    const me = session.value?.actor;
    if (!me) return [];
    const eff = effectiveParticipants(chat);
    if (!eff.length) return [];
    const others = eff.filter((a) => a && a !== me);
    return [...new Set(others)].toSorted((a, b) =>
      String(a).localeCompare(String(b)),
    );
  }

  /**
   * Peers to show in search/chat scope labels when `rosterActors` is empty but the
   * Create row still lists participants (e.g. before updates / edge cases).
   */
  function chatScopeFallbackActors(chat) {
    const others = rosterActors(chat);
    if (others.length) return others;
    const me = session.value?.actor;
    const raw = Array.isArray(chat?.value?.participants) ? chat.value.participants : [];
    const uniq = [...new Set(raw.filter(Boolean))];
    return uniq
      .filter((a) => a && a !== me)
      .toSorted((a, b) => String(a).localeCompare(String(b)));
  }

  /** Plain-text chip for actor ids (must match UserName-ish readability: DIDs, at://, handles). */
  function shortActorDisplay(a) {
    if (!a) return "?";
    const cached = peekActorDisplayCache(a);
    if (cached) return cached;
    const s = String(a).trim();
    if (!s) return "?";
    const h = formatHandle(s);
    const out = h || `…${s.slice(-6)}`;
    return out.length > 26 ? `…${s.slice(-6)}` : out;
  }

  /** Plain-text line for `<option>` labels; prefers shared/private title, else roster. */
  function chatScopeOptionLabel(chat) {
    void actorDisplayVersion.value;
    const named = chatResolvedLabel(chat);
    if (named) return named;
    const others = chatScopeFallbackActors(chat);
    if (!others.length) return "Conversation";
    return others.map((a) => shortActorDisplay(a)).join(" · ");
  }

  /** Shared name from the chat creator’s Updates (visible to everyone). */
  function chatCustomTitle(chat) {
    const key = chatChannelMapKey(chat?.value?.channel);
    return key ? customTitleByChannel.value.get(key) || "" : "";
  }

  const CHAT_LABEL_PREFIX = "hw10-chat-label-";
  function chatLabelStorageKey(actor) {
    return actor ? CHAT_LABEL_PREFIX + base64UrlFromUtf8(actor) : "";
  }

  const personalChatLabelsByChannel = ref({});

  function loadPersonalChatLabels(actor) {
    const k = chatLabelStorageKey(actor);
    if (!k) {
      personalChatLabelsByChannel.value = {};
      return;
    }
    try {
      const raw = localStorage.getItem(k);
      const parsed = raw ? JSON.parse(raw) : {};
      personalChatLabelsByChannel.value =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? parsed
          : {};
    } catch {
      personalChatLabelsByChannel.value = {};
    }
  }

  function persistPersonalChatLabels() {
    const k = chatLabelStorageKey(session.value?.actor);
    if (!k) return;
    try {
      localStorage.setItem(k, JSON.stringify(personalChatLabelsByChannel.value));
    } catch {
      /* ignore */
    }
  }

  watch(
    () => session.value?.actor,
    (a) => loadPersonalChatLabels(a),
    { immediate: true },
  );

  /** Label only this user sees (device-local). */
  function personalChatLabel(chat) {
    const key = chatChannelMapKey(chat?.value?.channel);
    if (!key) return "";
    const t = personalChatLabelsByChannel.value[key];
    return typeof t === "string" ? t.trim() : "";
  }

  function setPersonalChatLabel(chat, title) {
    const key = chatChannelMapKey(chat?.value?.channel);
    if (!key || !session.value?.actor) return;
    const t = String(title).trim().slice(0, CHAT_LABEL_MAX_LENGTH);
    if (!t) return;
    personalChatLabelsByChannel.value = {
      ...personalChatLabelsByChannel.value,
      [key]: t,
    };
    persistPersonalChatLabels();
  }

  function clearPersonalChatLabel(chat) {
    const key = chatChannelMapKey(chat?.value?.channel);
    if (!key || !session.value?.actor) return;
    const next = { ...personalChatLabelsByChannel.value };
    delete next[key];
    personalChatLabelsByChannel.value = next;
    persistPersonalChatLabels();
  }

  /** Shared title if set, otherwise this user’s private label. */
  function chatResolvedLabel(chat) {
    return chatCustomTitle(chat) || personalChatLabel(chat);
  }

  /** Whether this user can clear something (shared name as creator, or private label). */
  function chatCanRemoveLabel(chat) {
    if (!session.value?.actor || !chat) return false;
    if (personalChatLabel(chat)) return true;
    if (chat.actor === session.value.actor && chatCustomTitle(chat)) return true;
    return false;
  }

  /** Per-user read cursors (latest `published` treated as read per thread), local only. */
  const READ_CURSOR_PREFIX = "hw10-read-";
  function readCursorStorageKey(actor) {
    return actor ? READ_CURSOR_PREFIX + base64UrlFromUtf8(actor) : "";
  }

  const readCursorByChannel = ref({});

  function loadReadCursors(actor) {
    const k = readCursorStorageKey(actor);
    if (!k) {
      readCursorByChannel.value = {};
      return;
    }
    try {
      const raw = localStorage.getItem(k);
      const parsed = raw ? JSON.parse(raw) : {};
      readCursorByChannel.value =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? parsed
          : {};
    } catch {
      readCursorByChannel.value = {};
    }
  }

  function persistReadCursors() {
    const k = readCursorStorageKey(session.value?.actor);
    if (!k) return;
    try {
      localStorage.setItem(k, JSON.stringify(readCursorByChannel.value));
    } catch {
      /* ignore quota / privacy mode */
    }
  }

  watch(
    () => session.value?.actor,
    (a) => loadReadCursors(a),
    { immediate: true },
  );

  const lastMessageByChannel = computed(() => {
    const map = new Map();
    for (const m of allMessageObjects.value) {
      const tid = messageThreadId(m);
      if (tid === undefined || tid === null || tid === "") continue;
      const key = chatChannelMapKey(tid);
      const pub = m.value?.published ?? 0;
      const cur = map.get(key);
      const curPub = cur?.value?.published ?? -1;
      if (
        !cur ||
        pub > curPub ||
        (pub === curPub && String(m.url || "") > String(cur.url || ""))
      ) {
        map.set(key, m);
      }
    }
    return map;
  });

  function messageSnippetForList(m) {
    if (!m?.value) return "";
    const v = m.value;
    if (v.attachmentUrl) {
      const c = String(v.content || "").trim();
      if (c && c !== " ") return c.length > 100 ? `${c.slice(0, 98)}…` : c;
      return "Photo";
    }
    const c = String(v.content || "").trim();
    if (!c) return "";
    return c.length > 100 ? `${c.slice(0, 98)}…` : c;
  }

  function chatLastPreview(chat) {
    const key = chatChannelMapKey(chat?.value?.channel);
    if (!key) return "";
    const m = lastMessageByChannel.value.get(key);
    return m ? messageSnippetForList(m) : "";
  }

  function chatIsUnread(chat) {
    const sk = chatChannelMapKey(chat?.value?.channel);
    if (!sk) return false;
    const last = lastMessageByChannel.value.get(sk);
    if (!last) return false;
    const maxPub = last.value?.published ?? 0;
    if (maxPub <= 0) return false;
    const read = readCursorByChannel.value[sk] ?? 0;
    return maxPub > read;
  }

  function markChannelRead(cid, floorPublished) {
    if (!cid || !session.value?.actor) return;
    const sk = chatChannelMapKey(cid);
    let maxPub = 0;
    for (const m of allMessageObjects.value) {
      if (chatChannelMapKey(messageThreadId(m)) !== sk) continue;
      maxPub = Math.max(maxPub, m.value?.published ?? 0);
    }
    if (floorPublished != null && Number.isFinite(floorPublished)) {
      maxPub = Math.max(maxPub, floorPublished);
    }
    readCursorByChannel.value = { ...readCursorByChannel.value, [sk]: maxPub };
    persistReadCursors();
  }

  watch(
    [() => route.name, () => route.params.chatId, lastMessageByChannel],
    () => {
      if (route.name !== "chat" || !route.params.chatId) return;
      nextTick(() => markChannelRead(String(route.params.chatId)));
    },
    { flush: "post", immediate: true },
  );

  /** Chats ordered by recent message activity; tie-break roster label then channel id. */
  const chatsSortedForDisplay = computed(() =>
    [...myChats.value].toSorted((a, b) => {
      const ka = chatChannelMapKey(a.value?.channel);
      const kb = chatChannelMapKey(b.value?.channel);
      const pa = lastMessageByChannel.value.get(ka)?.value?.published ?? 0;
      const pb = lastMessageByChannel.value.get(kb)?.value?.published ?? 0;
      if (pb !== pa) return pb - pa;
      const cmp = chatScopeOptionLabel(a).localeCompare(chatScopeOptionLabel(b), undefined, {
        numeric: true,
        sensitivity: "base",
      });
      if (cmp !== 0) return cmp;
      return ka.localeCompare(kb);
    }),
  );

  const searchScopeOrphanNeeded = computed(() => {
    const v = searchScopeSelectValue.value;
    if (!v) return false;
    return !chatsSortedForDisplay.value.some((c) => chatScopeOptionValue(c) === v);
  });

  const searchScopeOrphanLabel = computed(() => {
    if (!searchScopeOrphanNeeded.value) return "";
    const ch = chatForChannel(searchScopeSelectValue.value);
    if (ch) return chatScopeOptionLabel(ch);
    const s = searchScopeSelectValue.value;
    return s.length > 28 ? `Chat · …${s.slice(-12)}` : `Chat · ${s}`;
  });

  /** Always-visible search scope text for the compact home toolbar. */
  const searchScopeSummaryLabel = computed(() => {
    const scope = searchScopeSelectValue.value;
    if (!scope) return "All chats";
    const ch = chatForChannel(scope);
    if (ch) return chatScopeOptionLabel(ch);
    return searchScopeOrphanLabel.value || "Selected chat";
  });

  /** Resolve participant handles for search scope labels (same names as chat list / UserName). */
  watch(
    () => chatsSortedForDisplay.value,
    (list) => {
      const me = session.value?.actor;
      if (!me || !list?.length) return;
      const seen = new Set();
      for (const chat of list) {
        for (const a of chatScopeFallbackActors(chat)) {
          if (!a || seen.has(a)) continue;
          seen.add(a);
          if (peekActorDisplayCache(a)) continue;
          void (async () => {
            try {
              const handle = await graffiti.actorToHandle(a);
              const formatted =
                formatHandle(handle) || formatHandle(a) || `…${String(a).slice(-6)}`;
              syncActorDisplayCache(a, formatted);
            } catch {
              syncActorDisplayCache(
                a,
                formatHandle(a) || `…${String(a).slice(-6)}`,
              );
            }
          })();
        }
      }
    },
    { flush: "post" },
  );

  const selectedRosterActors = computed(() => {
    const ch = channel.value;
    if (!ch) return [];
    const ob = myChats.value.find(
      (c) => chatChannelMapKey(c.value.channel) === chatChannelMapKey(ch),
    );
    return ob ? rosterActors(ob) : [];
  });

  const peopleFilterOptions = computed(() => {
    const s = new Set();
    for (const chat of myChats.value) {
      for (const a of effectiveParticipants(chat)) {
        if (a) s.add(a);
      }
    }
    const scopeTid = normalizeThreadQuery(route.query.thread);
    const scopeKey = scopeTid ? chatChannelMapKey(scopeTid) : null;
    const messagePool = scopeKey
      ? allMessageObjects.value.filter(
          (obj) => chatChannelMapKey(messageThreadId(obj)) === scopeKey,
        )
      : allMessageObjects.value;
    for (const o of messagePool) {
      const a = messageActor(o);
      if (a) s.add(a);
    }
    return [...s].toSorted((a, b) => String(a).localeCompare(String(b)));
  });

  function clearPeopleFilter() {
    peopleFilterActors.value = [];
  }

  function togglePeopleFilterActor(actor) {
    if (!actor) return;
    const cur = peopleFilterActors.value;
    if (cur.includes(actor)) {
      peopleFilterActors.value = cur.filter((a) => a !== actor);
    } else {
      peopleFilterActors.value = [...cur, actor].toSorted((a, b) =>
        String(a).localeCompare(String(b)),
      );
    }
  }

  function isPeopleFilterActorSelected(actor) {
    return actor ? peopleFilterActors.value.includes(actor) : false;
  }

  watch(
    peopleFilterOptions,
    (opts) => {
      const allowed = new Set(opts);
      const next = peopleFilterActors.value.filter((a) => allowed.has(a));
      if (next.length !== peopleFilterActors.value.length) {
        peopleFilterActors.value = next;
      }
    },
    { flush: "post" },
  );

  const { objects: recentSearchObjectsRaw, poll: pollRecentSearches } = useGraffitiDiscover(
    () => [personalCh.value],
    schemaRecentSearch,
    undefined,
    false,
  );

  const { objects: savedResultObjectsRaw, poll: pollSavedResults } = useGraffitiDiscover(
    () => [personalCh.value],
    schemaSaveSearchResult,
    undefined,
    false,
  );

  const recentSearchObjects = computed(() =>
    mineOnly(recentSearchObjectsRaw.value, session.value?.actor),
  );
  const savedResultObjects = computed(() =>
    mineOnly(savedResultObjectsRaw.value, session.value?.actor),
  );

  function pollThreadsAndMessages() {
    void pollChats();
    void pollChatUpdates();
    void pollChatLeaves();
    if (session.value?.actor) void pollAllMessages();
  }

  function pollPersonalObjects() {
    if (!session.value?.actor) return;
    void pollRecentSearches();
    void pollSavedResults();
  }

  let pollTimer;
  onMounted(() => {
    pollThreadsAndMessages();
    pollPersonalObjects();
    pollTimer = setInterval(pollThreadsAndMessages, 15000);
  });
  onUnmounted(() => {
    if (pollTimer) clearInterval(pollTimer);
  });

  watch(
    () => session.value?.actor,
    (actor, prev) => {
      if (actor && !prev) {
        pollThreadsAndMessages();
        pollPersonalObjects();
      }
    },
    { immediate: true },
  );

  watch(
    () => route.name,
    (n) => {
      if (n === "saved" || n === "home" || n === "search-results") pollPersonalObjects();
    },
  );

  const recentSearches = computed(() => {
    const seen = new Set();
    const out = [];
    for (const o of recentSearchObjects.value.toSorted(
      (a, b) => b.value.published - a.value.published,
    )) {
      const q = o.value.query?.trim();
      if (!q || seen.has(q.toLowerCase())) continue;
      seen.add(q.toLowerCase());
      out.push(q);
      if (out.length >= 20) break;
    }
    return out;
  });

  const savedPins = computed(() =>
    savedResultObjects.value.toSorted((a, b) => b.value.published - a.value.published),
  );

  /** Group `searchResults` by thread channel id; null for messages without a known thread. */
  const searchResultsByChat = computed(() => {
    const map = new Map();
    for (const obj of searchResults.value) {
      const tid = messageThreadId(obj) ?? "(unknown)";
      if (!map.has(tid)) map.set(tid, []);
      map.get(tid).push(obj);
    }
    const groups = [];
    for (const [tid, items] of map) {
      const sorted = items
        .slice()
        .toSorted((a, b) => (a.value.published || 0) - (b.value.published || 0));
      const latest = sorted[sorted.length - 1]?.value.published || 0;
      groups.push({
        threadId: tid === "(unknown)" ? null : tid,
        chat: tid === "(unknown)" ? null : chatForChannel(tid),
        items: sorted,
        latest,
      });
    }
    return groups.sort((a, b) => b.latest - a.latest);
  });

  function goSearch() {
    router.push({ name: "home", hash: "#search-tools" });
  }

  function goBack() {
    if (window.history.length > 1) {
      router.back();
    } else {
      router.push({ name: "home" });
    }
  }

  async function addPendingRecipient() {
    const raw = pendingRecipientInput.value.trim();
    if (!raw) return;
    isAddingRecipient.value = true;
    try {
      const actor = await resolveRecipientLine(graffiti, raw);
      if (!actor) {
        window.alert(
          `Could not resolve "${raw}" to a Graffiti actor.\n\nTry the full handle (e.g. oliviam.graffiti.actor) or paste the actor id (did:… / at://… / graffiti:…) from your friend's top bar.`,
        );
        return;
      }
      if (actor === session.value?.actor) {
        window.alert("That's you. Add at least one other person.");
        return;
      }
      if (pendingRecipients.value.includes(actor)) {
        window.alert("That person is already in the list.");
        pendingRecipientInput.value = "";
        return;
      }
      pendingRecipients.value = [...pendingRecipients.value, actor];
      pendingRecipientInput.value = "";
    } finally {
      isAddingRecipient.value = false;
    }
  }

  function removePendingRecipient(actor) {
    pendingRecipients.value = pendingRecipients.value.filter((a) => a !== actor);
  }

  function resetCompose() {
    pendingRecipients.value = [];
    pendingRecipientInput.value = "";
  }

  async function createConversation() {
    if (!session.value?.actor) return;
    if (!pendingRecipients.value.length) {
      window.alert(
        "Add at least one other person before starting the conversation.",
      );
      return;
    }
    const me = session.value.actor;
    const fullParticipants = [...new Set([me, ...pendingRecipients.value])];

    const existing = chatsBySetForCurrentUser.value.find((c) => {
      const p = effectiveParticipants(c);
      return sameParticipantSet(p, fullParticipants);
    });
    if (existing) {
      const ch = existing.value.channel;
      resetCompose();
      composeOpen.value = false;
      router.replace({ name: "chat", params: { chatId: ch } });
      return;
    }

    isCreatingChat.value = true;
    try {
      const newChannel = crypto.randomUUID();
      try {
        await graffiti.post(
          buildCreateChatPost(newChannel, fullParticipants),
          session.value,
        );
      } catch (err) {
        if (isStorageForbiddenError(err)) {
          alertGraffitiPostFailed("Create chat", err);
        } else {
          window.alert(
            `Could not create chat: ${err?.message || String(err)}\n\nPaste full actor ids if handles fail to resolve.`,
          );
        }
        return;
      }
      channel.value = newChannel;
      resetCompose();
      composeOpen.value = false;
      pollThreadsAndMessages();
      router.replace({ name: "chat", params: { chatId: newChannel } });
    } finally {
      isCreatingChat.value = false;
    }
  }

  function selectChat(ch) {
    router.push({ name: "chat", params: { chatId: ch } });
  }

  const currentChat = computed(() => {
    if (!channel.value) return null;
    return chatForChannel(channel.value);
  });

  const canManagePeople = computed(() => {
    const c = currentChat.value;
    return Boolean(c && session.value?.actor && c.actor === session.value.actor);
  });

  const canLeaveChat = computed(() => {
    const c = currentChat.value;
    return Boolean(c && session.value?.actor && c.actor !== session.value.actor);
  });

  async function postUpdateChat(chatObj, participants, opts = {}) {
    const val = {
      activity: "Update",
      type: "Chat",
      channel: chatObj.value.channel,
      participants,
      published: Date.now(),
    };
    if (opts?.clearTitle) {
      val.title = "";
    } else if (opts?.title != null) {
      const t = String(opts.title).trim().slice(0, CHAT_LABEL_MAX_LENGTH);
      if (t) val.title = t;
    }
    await graffiti.post(
      {
        value: val,
        channels: [DIRECTORY],
      },
      session.value,
    );
    await Promise.resolve(pollChatUpdates());
  }

  async function renameChat(chatObj) {
    if (!chatObj || !session.value?.actor) return;
    const isCreator = chatObj.actor === session.value.actor;
    const suggested =
      chatCustomTitle(chatObj) || personalChatLabel(chatObj) || "";
    const msg = isCreator
      ? `Conversation name (everyone in this chat sees it, max ${CHAT_LABEL_MAX_LENGTH} characters)`
      : `Your label for this chat (only you see it, max ${CHAT_LABEL_MAX_LENGTH} characters)`;
    const name = window.prompt(msg, suggested);
    if (name === null) return;
    const t = String(name).trim();
    if (!t) {
      window.alert("Name can’t be empty. Use “Remove label” to clear.");
      return;
    }
    if (t.length > CHAT_LABEL_MAX_LENGTH) {
      window.alert(
        `That name is too long. Use at most ${CHAT_LABEL_MAX_LENGTH} characters (about one short line).`,
      );
      return;
    }
    const eff = effectiveParticipants(chatObj);
    try {
      if (isCreator) {
        await postUpdateChat(chatObj, eff, { title: t });
        if (personalChatLabel(chatObj)) clearPersonalChatLabel(chatObj);
      } else {
        setPersonalChatLabel(chatObj, t);
      }
    } catch (err) {
      alertGraffitiPostFailed("Rename chat", err);
    }
  }

  async function removeChatLabel(chatObj) {
    if (!chatObj || !session.value?.actor) return;
    const me = session.value.actor;
    const isCreator = chatObj.actor === me;
    const shared = chatCustomTitle(chatObj);
    const personal = personalChatLabel(chatObj);
    if (!shared && !personal) return;

    let detail;
    if (isCreator && shared && personal) {
      detail =
        "This removes the shared name for everyone and your private label on this device.";
    } else if (isCreator && shared) {
      detail = "This removes the shared name for everyone in the chat.";
    } else if (personal && shared && !isCreator) {
      detail =
        "This removes only your private label. The name everyone sees will stay.";
    } else {
      detail = "This removes your private label for this chat.";
    }
    if (!window.confirm(`Remove conversation label?\n\n${detail}`)) return;

    if (isCreator && shared) {
      try {
        await postUpdateChat(
          chatObj,
          effectiveParticipants(chatObj),
          { clearTitle: true },
        );
      } catch (err) {
        alertGraffitiPostFailed("Remove label", err);
        return;
      }
    }
    if (personal) clearPersonalChatLabel(chatObj);
  }

  async function addParticipant(chatObj) {
    if (!chatObj || chatObj.actor !== session.value?.actor) return;
    const raw = manageRecipientInput.value.trim();
    if (!raw) return;
    isManageAdding.value = true;
    try {
      const actor = await resolveRecipientLine(graffiti, raw);
      if (!actor) {
        window.alert(
          `Could not resolve "${raw}" to a Graffiti actor.\n\nTry the full handle (e.g. oliviam.graffiti.actor) or paste the actor id.`,
        );
        return;
      }
      const eff = effectiveParticipants(chatObj);
      if (eff.includes(actor)) {
        window.alert("That person is already in this chat.");
        manageRecipientInput.value = "";
        return;
      }
      try {
        await postUpdateChat(chatObj, [...eff, actor]);
        manageRecipientInput.value = "";
        isManagingPeople.value = false;
        showToast("Person added to the chat");
      } catch (err) {
        alertGraffitiPostFailed("Add person", err);
      }
    } finally {
      isManageAdding.value = false;
    }
  }

  async function removeParticipant(chatObj, actor) {
    if (!chatObj || chatObj.actor !== session.value?.actor) return;
    if (!actor || actor === session.value.actor) return;
    if (!window.confirm("Remove this person from the chat?")) return;
    const eff = effectiveParticipants(chatObj);
    try {
      await postUpdateChat(chatObj, eff.filter((a) => a !== actor));
    } catch (err) {
      alertGraffitiPostFailed("Remove person", err);
    }
  }

  async function leaveChat(chatObj) {
    const me = session.value?.actor;
    if (!me || !chatObj) return;
    if (chatObj.actor === me) {
      window.alert(
        "You created this chat. Use Delete from the chat list to remove it for everyone.",
      );
      return;
    }
    if (
      !window.confirm(
        "Leave this chat? It'll disappear from your list. Other participants keep it.",
      )
    ) {
      return;
    }
    try {
      await graffiti.post(
        {
          value: {
            activity: "LeaveChat",
            type: "Chat",
            channel: chatObj.value.channel,
            published: Date.now(),
          },
          channels: [DIRECTORY],
        },
        session.value,
      );
      void pollChatLeaves();
      if (channel.value === chatObj.value.channel) {
        router.push({ name: "home" });
      }
    } catch (err) {
      alertGraffitiPostFailed("Leave chat", err);
    }
  }

  async function sendMessage() {
    const text = myMessage.value.trim();
    const file = selectedImageFile.value;
    if (!channel.value || (!text && !file)) return;

    isSending.value = true;
    try {
      let attachmentUrl;
      if (file) {
        try {
          attachmentUrl = await graffiti.postMedia({ data: file }, session.value);
        } catch (err) {
          alertGraffitiPostFailed("Image upload", err);
          return;
        }
      }
      try {
        const postBody = buildSendMessagePost(
          channel.value,
          text || (attachmentUrl ? " " : ""),
          session.value.actor,
          attachmentUrl,
        );
        await graffiti.post(postBody, session.value);
        markChannelRead(channel.value, postBody.value.published);
        myMessage.value = "";
        clearPendingImage();
      } catch (err) {
        alertGraffitiPostFailed("Message", err);
      }
    } finally {
      isSending.value = false;
    }
  }

  async function deleteMessage(message) {
    isDeleting.value.add(message.url);
    try {
      const mediaUrl = message.value?.attachmentUrl;
      if (mediaUrl) {
        try {
          await graffiti.deleteMedia(mediaUrl, session.value);
        } catch (e) {
          console.warn("deleteMedia:", e);
        }
      }
      await graffiti.delete(message, session.value);
    } finally {
      isDeleting.value.delete(message.url);
    }
  }

  async function deleteChat(chatObj) {
    if (chatObj.actor !== session.value?.actor) return;
    if (
      !window.confirm(
        "Delete this chat? The thread record is removed for everyone who could see it. Existing messages in the thread are not deleted automatically.",
      )
    ) {
      return;
    }
    isDeletingChat.value.add(chatObj.url);
    try {
      await graffiti.delete(chatObj, session.value);
      if (channel.value === chatObj.value.channel) {
        router.push({ name: "home" });
      }
      pollThreadsAndMessages();
    } finally {
      isDeletingChat.value.delete(chatObj.url);
    }
  }

  async function recordRecentSearch(q) {
    const trimmed = q.trim();
    if (!trimmed) return;
    await graffiti.post(
      {
        value: {
          activity: "RecentSearch",
          query: trimmed,
          published: Date.now(),
        },
        channels: [personalCh.value],
      },
      session.value,
    );
    pollPersonalObjects();
  }

  function chatForChannel(cid) {
    if (!cid) return null;
    const ck = chatChannelMapKey(cid);
    return (
      myChats.value.find((c) => chatChannelMapKey(c.value.channel) === ck) ??
      null
    );
  }

  /** Chat row for current `?thread=` (home / search-results); null if all-chats or unknown id. */
  const searchScopedChat = computed(() => {
    const tid = normalizeThreadQuery(route.query.thread);
    if (!tid) return null;
    return chatForChannel(tid);
  });

  function runSearch() {
    void recordRecentSearch(searchQuery.value);
    pollThreadsAndMessages();
    const scopeRaw = normalizeThreadQuery(route.query.thread);
    const scopeKey = scopeRaw ? chatChannelMapKey(scopeRaw) : null;
    const pool = scopeKey
      ? allMessageObjects.value.filter(
          (obj) => chatChannelMapKey(messageThreadId(obj)) === scopeKey,
        )
      : allMessageObjects.value;
    const q = searchQuery.value.trim().toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    const peopleActive = peopleFilterActors.value.length > 0;
    const adv =
      mediaFilter.value !== "any" ||
      peopleActive ||
      Boolean(String(dateFrom.value || "").trim()) ||
      Boolean(String(dateTo.value || "").trim());
    const fromMs = adv ? dayStartMs(dateFrom.value) : null;
    const toMs = adv ? dayEndMs(dateTo.value) : null;

    searchResults.value = pool.filter((obj) => {
      const content = obj.value.content || "";
      const haystack = contentSearchHaystack(content);
      const okWords = !words.length || words.every((w) => haystack.includes(w));
      if (!okWords) return false;

      if (!adv) return true;

      const ts = obj.value.published;
      if (fromMs != null && ts < fromMs) return false;
      if (toMs != null && ts > toMs) return false;

      if (peopleActive) {
        const act = messageActor(obj);
        if (!peopleFilterActors.value.includes(act)) return false;
      }

      let okMedia = true;
      if (mediaFilter.value === "text")
        okMedia = (obj.value.mediaType || "text") === "text";
      else if (mediaFilter.value === "links")
        okMedia =
          /https?:\/\//i.test(content) ||
          /\bwww\.[^\s<>"']+/i.test(content) ||
          /\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>"']*)?/i.test(content);
      else if (mediaFilter.value === "images")
        okMedia =
          (obj.value.mediaType || "") === "image" ||
          /\.(png|jpe?g|gif|webp)/i.test(content) ||
          (Boolean(obj.value.attachmentUrl) &&
            !/\.(mp4|webm|mov|m4v|ogv|avi)(\?|$)/i.test(String(obj.value.attachmentUrl)));
      else if (mediaFilter.value === "videos")
        okMedia =
          (obj.value.mediaType || "") === "video" ||
          /\.(mp4|webm|mov|m4v|ogv|avi)(\?[^"'>\s]*)?/i.test(content) ||
          (Boolean(obj.value.attachmentUrl) &&
            /\.(mp4|webm|mov|m4v|ogv|avi)(\?|$)/i.test(String(obj.value.attachmentUrl)));
      else if (mediaFilter.value === "files")
        okMedia = /\.(pdf|zip|docx?)/i.test(content);
      else if (mediaFilter.value === "chat") okMedia = true;

      return okMedia;
    });
    router.push({
      name: "search-results",
      query: scopeKey ? { thread: scopeKey } : {},
    });
  }

  function searchRouteThreadQuery() {
    const t = router.currentRoute.value.query?.thread;
    return typeof t === "string" && t.trim() ? { thread: t.trim() } : {};
  }

  function applyRecent(q) {
    searchQuery.value = q;
    router.push({ name: "home", query: searchRouteThreadQuery(), hash: "#search-tools" });
  }

  async function pinResult(obj) {
    const label = window.prompt("Name for this saved result?", "Important message");
    if (!label) return;
    try {
      await graffiti.post(
        {
          value: {
            activity: "SaveSearchResult",
            name: label.trim(),
            querySnapshot: searchQuery.value.trim() || "(browse)",
            snippet: (obj.value.content || "").slice(0, 2000),
            messageUrl: obj.url,
            threadChannel: messageThreadId(obj) || channel.value || "",
            published: Date.now(),
          },
          channels: [personalCh.value],
        },
        session.value,
      );
      pollPersonalObjects();
      showToast("Pinned to your Pinned tab");
    } catch (err) {
      alertGraffitiPostFailed("Pin message", err);
    }
  }

  const isDeletingSaved = ref(new Set());

  async function pinMessage(obj) {
    const label = window.prompt(
      "Label this pinned message (something you'll find later):",
      "Important",
    );
    if (!label) return;
    try {
      await graffiti.post(
        {
          value: {
            activity: "SaveSearchResult",
            name: label.trim(),
            querySnapshot: "(from chat)",
            snippet: (obj.value.content || "").slice(0, 2000),
            messageUrl: obj.url,
            threadChannel: messageThreadId(obj) || channel.value || "",
            published: Date.now(),
          },
          channels: [personalCh.value],
        },
        session.value,
      );
      pollPersonalObjects();
      showToast("Pinned to your Pinned tab");
    } catch (err) {
      alertGraffitiPostFailed("Pin message", err);
    }
  }

  /** Set of message URLs the current user has pinned (drives the Pinned chip). */
  const pinnedMessageUrls = computed(
    () =>
      new Set(
        savedResultObjects.value
          .map((o) => o.value?.messageUrl)
          .filter((u) => typeof u === "string" && u),
      ),
  );

  /** Unpin every SaveSearchResult I own that points at this message URL. */
  async function unpinMessageByUrl(messageUrl) {
    if (!messageUrl) return;
    const me = session.value?.actor;
    if (!me) return;
    const mine = savedResultObjects.value.filter(
      (o) => o.actor === me && o.value?.messageUrl === messageUrl,
    );
    if (!mine.length) return;
    try {
      await Promise.all(mine.map((o) => graffiti.delete(o, session.value)));
      showToast("Unpinned");
    } catch (err) {
      window.alert(`Could not unpin: ${err?.message || String(err)}`);
    } finally {
      pollPersonalObjects();
    }
  }

  async function deleteSavedPin(obj) {
    const title = (obj.value?.name || "saved result").slice(0, 120);
    if (!window.confirm(`Remove saved result “${title}”?`)) return;
    isDeletingSaved.value.add(obj.url);
    try {
      await graffiti.delete(obj, session.value);
      showToast("Removed from Pinned");
    } catch (err) {
      window.alert(`Could not remove: ${err?.message || String(err)}`);
    } finally {
      isDeletingSaved.value.delete(obj.url);
      pollPersonalObjects();
    }
  }

  return {
    channel,
    myMessage,
    imageInputKey,
    handleImageSelect,
    clearPendingImage,
    pendingImageName,
    pendingRecipients,
    pendingRecipientInput,
    isAddingRecipient,
    addPendingRecipient,
    removePendingRecipient,
    resetCompose,
    composeOpen,
    isSending,
    isDeleting,
    isDeletingChat,
    isCreatingChat,
    isManagingPeople,
    areMessageObjectsLoading,
    sortedMessageObjects,
    sendMessage,
    deleteMessage,
    deleteChat,
    createConversation,
    chats: chatsSortedForDisplay,
    selectChat,
    searchQuery,
    mediaFilter,
    peopleFilterActors,
    clearPeopleFilter,
    togglePeopleFilterActor,
    isPeopleFilterActorSelected,
    peopleFilterOptions,
    searchThreadScopeSelect,
    searchScopeSelectValue,
    chatScopeOptionValue,
    searchScopeOrphanNeeded,
    searchScopeOrphanLabel,
    searchScopeSummaryLabel,
    pickSearchScope,
    searchRunButtonLabel,
    searchCanSubmit,
    messageThreadId,
    chatForChannel,
    searchScopedChat,
    dateFrom,
    dateTo,
    runSearch,
    searchResults,
    searchResultsByChat,
    recentSearches,
    applyRecent,
    pinResult,
    pinMessage,
    pinnedMessageUrls,
    unpinMessageByUrl,
    savedPins,
    isDeletingSaved,
    deleteSavedPin,
    toast,
    showToast,
    rosterActors,
    selectedRosterActors,
    goSearch,
    goBack,
    currentChat,
    canManagePeople,
    canLeaveChat,
    manageRecipientInput,
    isManageAdding,
    addParticipant,
    removeParticipant,
    leaveChat,
    chatCustomTitle,
    chatResolvedLabel,
    chatScopeOptionLabel,
    chatCanRemoveLabel,
    chatLastPreview,
    chatIsUnread,
    renameChat,
    removeChatLabel,
  };
}
