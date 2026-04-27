import { createApp, ref, computed, watch } from "vue";
import { GraffitiDecentralized } from "@graffiti-garden/implementation-decentralized";
import {
  GraffitiPlugin,
  useGraffiti,
  useGraffitiSession,
  useGraffitiDiscover,
} from "@graffiti-garden/wrapper-vue";

const DIRECTORY = "hw10-messages-v3-participants";

const NO_CHAT = "hw10-no-chat-selected";

function personalPrefsChannel(actor) {
  if (!actor) return NO_CHAT;
  const id = btoa(unescape(encodeURIComponent(actor))).replace(/=+/g, "");
  return `personal-prefs-${id}`;
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

/**
 * Lines that are already Graffiti / AT actor identifiers (use as-is).
 */
function isExplicitActorId(l) {
  return (
    l.startsWith("graffiti:") || l.startsWith("at://") || l.startsWith("did:")
  );
}

/**
 * Resolve one recipient line to a canonical actor string.
 * Class handles like name.graffiti.actor must go through Graffiti’s handleToActor
 * so allowed / participants match session.actor (same as the decentralized login).
 */
async function resolveRecipientLine(graffiti, line) {
  const l = line.replace(/^@/, "").trim();
  if (!l) return null;
  if (isExplicitActorId(l)) return l;
  try {
    const resolved = await graffiti.handleToActor(l);
    if (resolved) return resolved;
  } catch (_) {
    /* fall through */
  }
  if (/\.graffiti\.actor$/i.test(l) && /^[a-z0-9._-]+$/i.test(l)) return l;
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

function setup() {
  const graffiti = useGraffiti();
  const session = useGraffitiSession();

  const channel = ref(null);
  const activeAllowedActors = ref([]);
  const myMessage = ref("");
  const composeRecipients = ref("");
  const composeOpen = ref(false);
  const isSending = ref(false);
  const isDeleting = ref(new Set());
  const isDeletingChat = ref(new Set());
  const isCreatingChat = ref(false);

  const sidebarView = ref("chats");
  const searchQuery = ref("");
  const advancedOpen = ref(false);
  const mediaFilter = ref("any");
  const peopleFilter = ref("any");
  const dateFrom = ref("");
  const dateTo = ref("");
  const searchResults = ref([]);
  /** When on, search only the thread open in the main panel; when off, search all your chats. */
  const searchOnlyOpenChat = ref(false);

  watch(channel, (ch) => {
    if (!ch) searchOnlyOpenChat.value = false;
  });

  const searchRunButtonLabel = computed(() =>
    searchOnlyOpenChat.value && channel.value ? "Search this chat" : "Search all my chats",
  );

  const personalCh = computed(() => personalPrefsChannel(session.value?.actor));

  const { objects: chats } = useGraffitiDiscover(
    [DIRECTORY],
    {
      properties: {
        value: {
          required: ["published", "channel", "activity", "type"],
          properties: {
            published: { type: "number" },
            channel: { type: "string" },
            activity: { const: "Create" },
            type: { const: "Chat" },
            participants: {
              type: "array",
              items: { type: "string" },
            },
            title: { type: "string" },
          },
        },
      },
    },
    () => session.value,
    true,
  );

  const myChats = computed(() => {
    const me = session.value?.actor;
    if (!me) return [];
    return chats.value.filter((c) => {
      const p = c.value.participants;
      if (Array.isArray(p) && p.length) return p.includes(me);
      return c.actor === me;
    });
  });

  const discoverMessageChannels = computed(() => {
    const ids = [...new Set(myChats.value.map((c) => c.value.channel).filter(Boolean))];
    return ids.length ? ids : [NO_CHAT];
  });

  const messageObjectSchema = {
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
        },
      },
    },
  };

  const { objects: allMessageObjects } = useGraffitiDiscover(
    () => discoverMessageChannels.value,
    messageObjectSchema,
    () => session.value,
    true,
  );

  const { objects: threadMessageObjects, isFirstPoll: areMessageObjectsLoading } =
    useGraffitiDiscover(
      () => (channel.value ? [channel.value] : [NO_CHAT]),
      messageObjectSchema,
      () => session.value,
      true,
    );

  const sortedMessageObjects = computed(() =>
    threadMessageObjects.value.toSorted((a, b) => a.value.published - b.value.published),
  );

  /** Other people in the thread (not you), deduped and sorted. */
  function rosterActors(chat) {
    const me = session.value?.actor;
    const p = chat.value?.participants;
    if (!Array.isArray(p) || !p.length || !me) return [];
    const others = p.filter((a) => a && a !== me);
    return [...new Set(others)].toSorted((a, b) =>
      String(a).localeCompare(String(b)),
    );
  }

  const selectedRosterActors = computed(() => {
    const ch = channel.value;
    if (!ch) return [];
    const ob = myChats.value.find((c) => c.value.channel === ch);
    return ob ? rosterActors(ob) : [];
  });

  /**
   * Everyone you could filter on: all participants across your chats (so people
   * who have not sent yet still appear), plus any actors seen on messages.
   */
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

  const { objects: saveSearchObjects } = useGraffitiDiscover(
    () => [personalCh.value],
    {
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
    },
    () => session.value,
    true,
  );

  const { objects: recentSearchObjects } = useGraffitiDiscover(
    () => [personalCh.value],
    {
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
    },
    () => session.value,
    true,
  );

  const { objects: savedResultObjects } = useGraffitiDiscover(
    () => [personalCh.value],
    {
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
    },
    () => session.value,
    true,
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

  function openCompose() {
    channel.value = null;
    activeAllowedActors.value = [];
    composeOpen.value = true;
    sidebarView.value = "chats";
  }

  function closeCompose() {
    composeOpen.value = false;
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
          `Could not resolve these lines to a Graffiti actor (check spelling, or paste a full at:// / did: / graffiti: id):\n\n${invalid.join("\n")}`,
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
      const allowed = participants;
      try {
        await graffiti.post(
          {
            value: {
              activity: "Create",
              type: "Chat",
              channel: newChannel,
              participants,
              published: Date.now(),
            },
            channels: [DIRECTORY],
            allowed,
          },
          session.value,
        );
      } catch (err) {
        window.alert(
          `Could not create chat in Graffiti: ${err?.message || String(err)}\n\nIf handles look right, try pasting each person’s full actor from their session (at://…).`,
        );
        return;
      }
      channel.value = newChannel;
      activeAllowedActors.value = [...allowed];
      composeRecipients.value = "";
      composeOpen.value = false;
      sidebarView.value = "chats";
    } finally {
      isCreatingChat.value = false;
    }
  }

  function selectChat(ch) {
    channel.value = ch;
    composeOpen.value = false;
    peopleFilter.value = "any";
    dateFrom.value = "";
    dateTo.value = "";
    const ob = myChats.value.find((c) => c.value.channel === ch);
    const p = ob?.value?.participants;
    if (Array.isArray(p) && p.length) activeAllowedActors.value = [...p];
    else if (ob?.allowed?.length) activeAllowedActors.value = [...ob.allowed];
    else activeAllowedActors.value = session.value?.actor ? [session.value.actor] : [];
    sidebarView.value = "chats";
  }

  async function sendMessage() {
    if (!channel.value || !myMessage.value.trim()) return;
    const allowed =
      activeAllowedActors.value.length > 0
        ? [...activeAllowedActors.value]
        : [session.value.actor];
    isSending.value = true;
    try {
      try {
        await graffiti.post(
          {
            value: {
              activity: "Send",
              type: "Message",
              content: myMessage.value.trim(),
              sender: session.value.actor,
              mediaType: "text",
              published: Date.now(),
            },
            channels: [channel.value],
            allowed,
          },
          session.value,
        );
        myMessage.value = "";
      } catch (err) {
        window.alert(
          `Message did not post: ${err?.message || String(err)}\n\nOften this means the thread’s allowed list does not match real Graffiti actors — recreate the chat after everyone uses resolvable handles.`,
        );
      }
    } finally {
      isSending.value = false;
    }
  }

  async function deleteMessage(message) {
    isDeleting.value.add(message.url);
    try {
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
        channel.value = null;
        activeAllowedActors.value = [];
      }
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
        allowed: [session.value.actor],
      },
      session.value,
    );
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

  function runSearch() {
    void recordRecentSearch(searchQuery.value);
    /** Open-thread discover is keyed by channel id; do not rely on `obj.channels` on each object. */
    const pool =
      searchOnlyOpenChat.value && channel.value
        ? threadMessageObjects.value
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
        okMedia = /\.(png|jpe?g|gif|webp)/i.test(content);
      else if (mediaFilter.value === "files")
        okMedia = /\.(pdf|zip|docx?)/i.test(content);
      else if (mediaFilter.value === "chat") okMedia = true;

      return okMedia;
    });
    sidebarView.value = "results";
  }

  function applyRecent(q) {
    searchQuery.value = q;
    sidebarView.value = "search";
  }

  function applySaved(s) {
    searchQuery.value = s.value.query;
    mediaFilter.value = ["any", "text", "images", "links", "files", "chat"].includes(
      s.value.mediaType,
    )
      ? s.value.mediaType
      : "any";
    sidebarView.value = "search";
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
        allowed: [session.value.actor],
      },
      session.value,
    );
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
        allowed: [session.value.actor],
      },
      session.value,
    );
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
    }
  }

  return {
    channel,
    myMessage,
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
    chats: myChats,
    selectChat,
    sidebarView,
    searchQuery,
    advancedOpen,
    mediaFilter,
    peopleFilter,
    peopleFilterOptions,
    searchOnlyOpenChat,
    searchRunButtonLabel,
    messageThreadId,
    chatForChannel,
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
    activeAllowedActors,
    openCompose,
    closeCompose,
    rosterActors,
    selectedRosterActors,
  };
}

const App = { template: "#template", setup };

createApp(App)
  .use(GraffitiPlugin, {
    graffiti: new GraffitiDecentralized(),
  })
  .mount("#app");
