import { ref, computed, unref, onMounted, onBeforeUnmount } from "vue";
import { actorDisplayVersion, actorMatchesContactSearch } from "../state.js";

export default async () => ({
  props: {
    messages: { type: Object, required: true },
  },
  setup(props) {
    /** Stable key for which row’s kebab menu is open (one at a time). */
    const openChatMenuKey = ref("");
    const optionsOpen = ref(false);
    const chatMenuRoots = new Map();
    const optionsRoot = ref(null);

    function chatMenuKey(chat) {
      return String(chat?.url || chat?.value?.channel || "");
    }

    function setChatMenuRef(chat, el) {
      const k = chatMenuKey(chat);
      if (el) chatMenuRoots.set(k, el);
      else chatMenuRoots.delete(k);
    }
    function toggleChatMenu(chat) {
      const k = chatMenuKey(chat);
      openChatMenuKey.value = openChatMenuKey.value === k ? "" : k;
    }
    function closeChatMenu() {
      openChatMenuKey.value = "";
    }
    function onDocClick(ev) {
      if (optionsOpen.value && optionsRoot.value && !optionsRoot.value.contains(ev.target)) {
        optionsOpen.value = false;
      }
      if (!openChatMenuKey.value) return;
      const root = chatMenuRoots.get(openChatMenuKey.value);
      if (root && !root.contains(ev.target)) closeChatMenu();
    }
    onMounted(() => document.addEventListener("mousedown", onDocClick));
    onBeforeUnmount(() => document.removeEventListener("mousedown", onDocClick));

    async function deleteChatFromMenu(chat) {
      closeChatMenu();
      await props.messages.deleteChat(chat);
    }

    async function renameChatFromMenu(chat) {
      closeChatMenu();
      await props.messages.renameChat(chat);
    }

    async function removeChatLabelFromMenu(chat) {
      closeChatMenu();
      await props.messages.removeChatLabel(chat);
    }

    function toggleOptions() {
      optionsOpen.value = !optionsOpen.value;
    }

    /** Local filter for “From person” chips (not persisted). */
    const contactFilter = ref("");

    function peopleFilterOptionsList() {
      const list = unref(props.messages.peopleFilterOptions);
      return Array.isArray(list) ? list : [];
    }

    const filteredPeopleFilterOptions = computed(() => {
      void actorDisplayVersion.value;
      const arr = peopleFilterOptionsList();
      const q = contactFilter.value.trim().toLowerCase();
      if (!q) return arr;
      return arr.filter((a) => actorMatchesContactSearch(a, q));
    });

    const contactFilterNoMatch = computed(
      () =>
        Boolean(contactFilter.value.trim()) && filteredPeopleFilterOptions.value.length === 0,
    );

    return {
      ...props.messages,
      messages: props.messages,
      optionsOpen,
      optionsRoot,
      toggleOptions,
      openChatMenuKey,
      chatMenuKey,
      setChatMenuRef,
      toggleChatMenu,
      deleteChatFromMenu,
      renameChatFromMenu,
      removeChatLabelFromMenu,
      contactFilter,
      filteredPeopleFilterOptions,
      contactFilterNoMatch,
    };
  },
  template: await fetch(new URL("./index.html", import.meta.url)).then((r) => r.text()),
});
