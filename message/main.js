import { defineAsyncComponent, ref, computed, onMounted, onBeforeUnmount } from "vue";
import { useRouter } from "vue-router";
import LinkedText from "../linked-text/main.js";

/** Async so route templates can register `components: { Message: MessageAsync }` without self-importing this module. */
export const MessageAsync = defineAsyncComponent(async () => ({
  components: { LinkedText },
  props: {
    object: { type: Object, required: true },
    messages: { type: Object, required: true },
  },
  setup(props) {
    const router = useRouter();

    function formatPublished(ts) {
      const n = Number(ts);
      if (!Number.isFinite(n) || n <= 0) return "";
      try {
        return new Intl.DateTimeFormat(undefined, {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        }).format(new Date(n));
      } catch {
        return "";
      }
    }

    const imageExpanded = ref(false);
    function toggleImageExpand() {
      imageExpanded.value = !imageExpanded.value;
    }

    const menuOpen = ref(false);
    const menuRoot = ref(null);
    function toggleMenu() {
      menuOpen.value = !menuOpen.value;
    }
    function closeMenu() {
      menuOpen.value = false;
    }
    function onDocClick(ev) {
      if (!menuOpen.value) return;
      const root = menuRoot.value;
      if (root && !root.contains(ev.target)) closeMenu();
    }
    onMounted(() => document.addEventListener("mousedown", onDocClick));
    onBeforeUnmount(() => document.removeEventListener("mousedown", onDocClick));

    const isPinned = computed(() => {
      const set = props.messages.pinnedMessageUrls?.value;
      return Boolean(set && set.has(props.object.url));
    });

    const messageDomId = computed(() => `m-${encodeURIComponent(props.object.url)}`);
    const sentAtLabel = computed(() => formatPublished(props.object?.value?.published));

    function handlePin() {
      closeMenu();
      props.messages.pinMessage(props.object);
    }
    function handleUnpin() {
      closeMenu();
      props.messages.unpinMessageByUrl?.(props.object.url);
    }
    function handleDelete() {
      closeMenu();
      props.messages.deleteMessage(props.object);
    }
    function goPinnedPage() {
      router.push({ name: "saved" });
    }

    return {
      deleteMessage: props.messages.deleteMessage,
      isDeleting: props.messages.isDeleting,
      pinMessage: props.messages.pinMessage,
      imageExpanded,
      toggleImageExpand,
      menuOpen,
      menuRoot,
      toggleMenu,
      closeMenu,
      isPinned,
      messageDomId,
      sentAtLabel,
      handlePin,
      handleUnpin,
      handleDelete,
      goPinnedPage,
    };
  },
  template: await fetch(new URL("./index.html", import.meta.url)).then((r) => r.text()),
}));
