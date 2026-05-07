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

  /** channel -> latest valid Update obj (creator-only enforced via effectiveParticipants). */
  const chatUpdatesByChannel = computed(() => {
    const map = new Map();
    for (const u of chatUpdatesRaw.value) {
      const ch = u.value?.channel;
      if (!ch) continue;
      const cur = map.get(ch);
      if (!cur || (u.value.published || 0) > (cur.value.published || 0)) {
        map.set(ch, u);
      }
    }
    return map;
  });

  /** channel -> Set<actor> of self-leavers. */
  const leavesByChannel = computed(() => {
    const map = new Map();
    for (const l of chatLeavesRaw.value) {
      const ch = l.value?.channel;
      const a = l.actor;
      if (!ch || !a) continue;
      if (!map.has(ch)) map.set(ch, new Set());
      map.get(ch).add(a);
    }
    return map;
  });

  function effectiveParticipants(chat) {
    if (!chat?.value?.channel) return [];
    const ch = chat.value.channel;
    const update = chatUpdatesByChannel.value.get(ch);
    const fromUpdate =
      update &&
      update.actor === chat.actor &&
      Array.isArray(update.value.participants)
        ? update.value.participants
        : null;
    const base =
      fromUpdate || (Array.isArray(chat.value.participants) ? chat.value.participants : []);
    const left = leavesByChannel.value.get(ch);
    if (!left || !left.size) return base;
    return base.filter((a) => !left.has(a));
  }

  const myChats = computed(() =>
    filterChatsForActor(chatsRaw.value, session.value?.actor, effectiveParticipants),
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
    if (!session.value?.actor) return;
    void pollChats();
    void pollChatUpdates();
    void pollChatLeaves();
    void pollAllMessages();
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
    router.push({ name: "search" });
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
    const fullParticipants = [me, ...pendingRecipients.value];

    const existing = myChats.value.find((c) => {
      const p = Array.isArray(c.value?.participants) ? c.value.participants : [];
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

  async function postUpdateChat(chatObj, participants) {
    await graffiti.post(
      {
        value: {
          activity: "Update",
          type: "Chat",
          channel: chatObj.value.channel,
          participants,
          published: Date.now(),
        },
        channels: [DIRECTORY],
      },
      session.value,
    );
    void pollChatUpdates();
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
            published: Date.now(),
          },
          channels: [personalCh.value],
        },
        session.value,
      );
      pollPersonalObjects();
    } catch (err) {
      alertGraffitiPostFailed("Pin message", err);
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
    searchResultsByChat,
    recentSearches,
    applyRecent,
    pinResult,
    pinMessage,
    savedPins,
    isDeletingSaved,
    deleteSavedPin,
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
  };
}
