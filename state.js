import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  useGraffiti,
  useGraffitiSession,
  useGraffitiDiscover,
} from "@graffiti-garden/wrapper-vue";

/** Shared discover channel for chat Create objects (assets/graffiti.md). */
const DIRECTORY = "hw10-messages-v3-participants";

const NO_CHAT = "hw10-no-chat-selected";

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
        title: { type: "string" },
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

const schemaSaveSearch = {
  properties: {
    value: {
      required: ["published", "activity", "name", "query", "sender"],
      properties: {
        published: { type: "number" },
        activity: { const: "SaveSearch" },
        name: { type: "string" },
        query: { type: "string" },
        mediaType: { type: "string" },
        sender: { type: "string" },
      },
    },
  },
};

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

function messageActor(obj) {
  return obj.value.sender || obj.actor;
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

async function participantsFromLines(graffiti, session, raw) {
  const lines = raw
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const actors = new Set([session.actor]);
  const invalid = [];
  for (const line of lines) {
    const a = await resolveRecipientLine(graffiti, line);
    if (a) actors.add(a);
    else invalid.push(line);
  }
  return { actors: [...actors], invalid };
}

function filterChatsForActor(chats, actor) {
  if (!actor) return [];
  return chats.filter((c) => {
    const p = c.value?.participants;
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
  const route = useRoute();
  const router = useRouter();

  const channel = ref(null);
  const myMessage = ref("");
  /** Pending image for the next send (`File` from `<input type="file">`). */
  const selectedImageFile = ref(null);
  /** Bumps to reset the file input after send/clear. */
  const imageInputKey = ref(0);
  const composeRecipients = ref("");
  const composeOpen = ref(false);
  const isSending = ref(false);
  const isDeleting = ref(new Set());
  const isDeletingChat = ref(new Set());
  const isCreatingChat = ref(false);

  const searchQuery = ref("");
  const advancedOpen = ref(false);
  const mediaFilter = ref("any");
  const peopleFilter = ref("any");
  const dateFrom = ref("");
  const dateTo = ref("");
  const searchResults = ref([]);

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

  /** `?thread=` on Search / results — null means all conversations. */
  function normalizeThreadQuery(t) {
    if (typeof t !== "string") return null;
    const s = t.trim();
    return s || null;
  }

  const searchThreadScopeSelect = computed({
    get() {
      return normalizeThreadQuery(route.query.thread) ?? "";
    },
    set(v) {
      const tid = v && String(v).trim() ? String(v).trim() : null;
      const q = { ...route.query };
      if (tid) q.thread = tid;
      else delete q.thread;
      if (route.name === "search" || route.name === "search-results") {
        router.replace({ name: route.name, query: q });
      }
    },
  });

  /** Set search scope (channel id or empty for all); used by scope picker UI. */
  function pickSearchScope(channelId) {
    searchThreadScopeSelect.value = channelId ? String(channelId) : "";
  }

  const searchRunButtonLabel = computed(() =>
    normalizeThreadQuery(route.query.thread)
      ? "Search in this conversation"
      : "Search all my chats",
  );

  const personalCh = computed(() => personalPrefsChannel(session.value?.actor));

  /** Public directory — discover without session (assets/graffiti.md). */
  const { objects: chatsRaw, poll: pollChats } = useGraffitiDiscover(
    [DIRECTORY],
    schemaDirectoryCreate,
    undefined,
    false,
  );

  const myChats = computed(() =>
    filterChatsForActor(chatsRaw.value, session.value?.actor),
  );

  function applyChatSelection(ch) {
    channel.value = ch;
    composeOpen.value = false;
    peopleFilter.value = "any";
    dateFrom.value = "";
    dateTo.value = "";
  }

  function syncRouteToState() {
    const n = route.name;
    if (n === "home") {
      channel.value = null;
      composeOpen.value = false;
    } else if (n === "compose") {
      channel.value = null;
      composeOpen.value = true;
    } else if (n === "chat" && route.params.chatId) {
      applyChatSelection(String(route.params.chatId));
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
    const p = chat.value?.participants;
    if (!Array.isArray(p) || !p.length || !me) return [];
    const others = p.filter((a) => a && a !== me);
    return [...new Set(others)].toSorted((a, b) =>
      String(a).localeCompare(String(b)),
    );
  }

  /** Plain-text line for `<option>` labels; same tokens as roster order, joined for reading. */
  function chatScopeOptionLabel(chat) {
    const others = rosterActors(chat);
    if (!others.length) return "Conversation";
    return others
      .map((a) => {
        const s = String(a);
        const at = s.match(/at:\/\/([^/]+)/);
        if (at) return at[1];
        const g = s.match(/([a-z0-9_.-]+)\.graffiti\.actor/i);
        if (g) return g[1];
        return s.length > 28 ? `${s.slice(0, 26)}…` : s;
      })
      .join(" · ");
  }

  /** Chats ordered by readable title (not Graffiti / channel id order). */
  const chatsSortedForDisplay = computed(() =>
    [...myChats.value].toSorted((a, b) => {
      const la = chatScopeOptionLabel(a);
      const lb = chatScopeOptionLabel(b);
      const cmp = la.localeCompare(lb, undefined, { numeric: true, sensitivity: "base" });
      if (cmp !== 0) return cmp;
      return String(a.value?.channel || "").localeCompare(String(b.value?.channel || ""));
    }),
  );

  const selectedRosterActors = computed(() => {
    const ch = channel.value;
    if (!ch) return [];
    const ob = myChats.value.find((c) => c.value.channel === ch);
    return ob ? rosterActors(ob) : [];
  });

  const peopleFilterOptions = computed(() => {
    const s = new Set();
    for (const chat of myChats.value) {
      const p = chat.value?.participants;
      if (Array.isArray(p)) {
        for (const a of p) {
          if (a) s.add(a);
        }
      } else if (chat.actor) {
        s.add(chat.actor);
      }
    }
    for (const o of allMessageObjects.value) {
      const a = messageActor(o);
      if (a) s.add(a);
    }
    return [...s].toSorted((a, b) => String(a).localeCompare(String(b)));
  });

  const { objects: saveSearchObjectsRaw, poll: pollSavedSearches } = useGraffitiDiscover(
    () => [personalCh.value],
    schemaSaveSearch,
    undefined,
    false,
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

  const saveSearchObjects = computed(() =>
    mineOnly(saveSearchObjectsRaw.value, session.value?.actor),
  );
  const recentSearchObjects = computed(() =>
    mineOnly(recentSearchObjectsRaw.value, session.value?.actor),
  );
  const savedResultObjects = computed(() =>
    mineOnly(savedResultObjectsRaw.value, session.value?.actor),
  );

  function pollThreadsAndMessages() {
    if (!session.value?.actor) return;
    void pollChats();
    void pollAllMessages();
  }

  function pollPersonalObjects() {
    if (!session.value?.actor) return;
    void pollSavedSearches();
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
  );

  watch(
    () => route.name,
    (n) => {
      if (n === "saved" || n === "search") pollPersonalObjects();
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

  function goSearch() {
    router.push({ name: "search" });
  }

  async function createConversation() {
    isCreatingChat.value = true;
    try {
      const { actors: participants, invalid } = await participantsFromLines(
        graffiti,
        session.value,
        composeRecipients.value,
      );
      if (invalid.length) {
        window.alert(
          `Could not resolve these lines to a Graffiti actor:\n\n${invalid.join("\n")}\n\nEach person should copy their actor id from the top bar (did:… / at://… / graffiti:…) and paste it here. Bare names only work when Graffiti can resolve the handle.`,
        );
        return;
      }
      if (participants.length < 2) {
        window.alert(
          "Add at least one other person on their own line (e.g. oliviam.graffiti.actor).",
        );
        return;
      }
      const newChannel = crypto.randomUUID();
      try {
        await graffiti.post(
          buildCreateChatPost(newChannel, participants),
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
      composeRecipients.value = "";
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
        await graffiti.post(
          buildSendMessagePost(
            channel.value,
            text || (attachmentUrl ? " " : ""),
            session.value.actor,
            attachmentUrl,
          ),
          session.value,
        );
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

  function messageThreadId(obj) {
    const chs = obj.channels;
    if (Array.isArray(chs) && chs.length) return chs[0];
    return null;
  }

  function chatForChannel(cid) {
    if (!cid) return null;
    return myChats.value.find((c) => c.value.channel === cid) ?? null;
  }

  /** Chat row for current `?thread=` (search / search-results); null if all-chats or unknown id. */
  const searchScopedChat = computed(() => {
    const tid = normalizeThreadQuery(route.query.thread);
    if (!tid) return null;
    return chatForChannel(tid);
  });

  function runSearch() {
    void recordRecentSearch(searchQuery.value);
    pollThreadsAndMessages();
    const scope = normalizeThreadQuery(route.query.thread);
    const pool = scope
      ? allMessageObjects.value.filter((obj) => messageThreadId(obj) === scope)
      : allMessageObjects.value;
    const q = searchQuery.value.trim().toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    const adv = advancedOpen.value;
    const fromMs = adv ? dayStartMs(dateFrom.value) : null;
    const toMs = adv ? dayEndMs(dateTo.value) : null;

    searchResults.value = pool.filter((obj) => {
      const content = obj.value.content || "";
      const c = content.toLowerCase();
      const okWords = !words.length || words.every((w) => c.includes(w));
      if (!okWords) return false;

      if (!adv) return true;

      const ts = obj.value.published;
      if (fromMs != null && ts < fromMs) return false;
      if (toMs != null && ts > toMs) return false;

      if (peopleFilter.value !== "any" && messageActor(obj) !== peopleFilter.value)
        return false;

      let okMedia = true;
      if (mediaFilter.value === "text")
        okMedia = (obj.value.mediaType || "text") === "text";
      else if (mediaFilter.value === "links") okMedia = /https?:\/\//i.test(content);
      else if (mediaFilter.value === "images")
        okMedia =
          (obj.value.mediaType || "") === "image" ||
          Boolean(obj.value.attachmentUrl) ||
          /\.(png|jpe?g|gif|webp)/i.test(content);
      else if (mediaFilter.value === "files")
        okMedia = /\.(pdf|zip|docx?)/i.test(content);
      else if (mediaFilter.value === "chat") okMedia = true;

      return okMedia;
    });
    router.push({
      name: "search-results",
      query: scope ? { thread: scope } : {},
    });
  }

  function searchRouteThreadQuery() {
    const t = router.currentRoute.value.query?.thread;
    return typeof t === "string" && t.trim() ? { thread: t.trim() } : {};
  }

  function applyRecent(q) {
    searchQuery.value = q;
    router.push({ name: "search", query: searchRouteThreadQuery() });
  }

  function applySaved(s) {
    searchQuery.value = s.value.query;
    mediaFilter.value = ["any", "text", "images", "links", "files", "chat"].includes(
      s.value.mediaType,
    )
      ? s.value.mediaType
      : "any";
    router.push({ name: "search", query: searchRouteThreadQuery() });
  }

  async function saveCurrentSearch() {
    if (!searchQuery.value.trim()) return;
    await graffiti.post(
      {
        value: {
          activity: "SaveSearch",
          name: searchQuery.value.slice(0, 80) || "Saved search",
          query: searchQuery.value.trim(),
          mediaType: mediaFilter.value === "any" ? "text" : mediaFilter.value,
          sender: session.value.actor,
          published: Date.now(),
        },
        channels: [personalCh.value],
      },
      session.value,
    );
    pollPersonalObjects();
  }

  async function pinResult(obj) {
    const label = window.prompt("Name for this saved result?", "Important message");
    if (!label) return;
    await graffiti.post(
      {
        value: {
          activity: "SaveSearchResult",
          name: label.trim(),
          querySnapshot: searchQuery.value.trim() || "(browse)",
          snippet: (obj.value.content || "").slice(0, 2000),
          messageUrl: obj.url,
          published: Date.now(),
        },
        channels: [personalCh.value],
      },
      session.value,
    );
    pollPersonalObjects();
  }

  const isDeletingSaved = ref(new Set());

  async function deleteSavedSearch(obj) {
    const title = (obj.value?.name || "saved search").slice(0, 120);
    if (!window.confirm(`Remove saved search “${title}”? You can save it again later.`)) return;
    isDeletingSaved.value.add(obj.url);
    try {
      await graffiti.delete(obj, session.value);
    } catch (err) {
      window.alert(`Could not remove: ${err?.message || String(err)}`);
    } finally {
      isDeletingSaved.value.delete(obj.url);
      pollPersonalObjects();
    }
  }

  async function deleteSavedPin(obj) {
    const title = (obj.value?.name || "saved result").slice(0, 120);
    if (!window.confirm(`Remove saved result “${title}”?`)) return;
    isDeletingSaved.value.add(obj.url);
    try {
      await graffiti.delete(obj, session.value);
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
    composeRecipients,
    composeOpen,
    isSending,
    isDeleting,
    isDeletingChat,
    isCreatingChat,
    areMessageObjectsLoading,
    sortedMessageObjects,
    sendMessage,
    deleteMessage,
    deleteChat,
    createConversation,
    chats: chatsSortedForDisplay,
    selectChat,
    searchQuery,
    advancedOpen,
    mediaFilter,
    peopleFilter,
    peopleFilterOptions,
    searchThreadScopeSelect,
    pickSearchScope,
    searchRunButtonLabel,
    messageThreadId,
    chatForChannel,
    searchScopedChat,
    dateFrom,
    dateTo,
    runSearch,
    searchResults,
    recentSearches,
    mySavedSearches: saveSearchObjects,
    applyRecent,
    applySaved,
    saveCurrentSearch,
    pinResult,
    savedPins,
    isDeletingSaved,
    deleteSavedSearch,
    deleteSavedPin,
    rosterActors,
    selectedRosterActors,
    goSearch,
  };
}
