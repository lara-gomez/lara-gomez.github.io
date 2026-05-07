import { ref, onMounted, onBeforeUnmount } from "vue";

export default async () => ({
  props: {
    messages: { type: Object, required: true },
  },
  setup(props) {
    /** URL of the saved-pin row whose kebab menu is currently open (only one at a time). */
    const openMenuUrl = ref("");
    const menuRoots = new Map();

    function setMenuRef(url, el) {
      if (el) menuRoots.set(url, el);
      else menuRoots.delete(url);
    }
    function toggleMenu(url) {
      openMenuUrl.value = openMenuUrl.value === url ? "" : url;
    }
    function closeMenu() {
      openMenuUrl.value = "";
    }
    function onDocClick(ev) {
      if (!openMenuUrl.value) return;
      const root = menuRoots.get(openMenuUrl.value);
      if (root && !root.contains(ev.target)) closeMenu();
    }
    onMounted(() => document.addEventListener("mousedown", onDocClick));
    onBeforeUnmount(() => document.removeEventListener("mousedown", onDocClick));

    function pinAnchor(p) {
      const u = p?.value?.messageUrl;
      return u ? `#m-${encodeURIComponent(u)}` : "";
    }

    const expandedPins = ref(new Set());
    const SNIPPET_PREVIEW_MAX = 180;

    function pinPreviewText(p) {
      const s = String(p?.value?.snippet || "");
      if (s.length <= SNIPPET_PREVIEW_MAX) return s;
      if (expandedPins.value.has(p?.url)) return s;
      return `${s.slice(0, SNIPPET_PREVIEW_MAX).trimEnd()}…`;
    }

    function pinHasLongText(p) {
      return String(p?.value?.snippet || "").length > SNIPPET_PREVIEW_MAX;
    }

    function pinExpanded(p) {
      return expandedPins.value.has(p?.url);
    }

    function togglePinExpanded(p) {
      const url = p?.url;
      if (!url) return;
      const next = new Set(expandedPins.value);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      expandedPins.value = next;
    }

    /** Linkable iff we know the source thread channel (older pins lack it). */
    function pinIsLinkable(p) {
      return Boolean(p?.value?.threadChannel && p?.value?.messageUrl);
    }

    async function removeFromMenu(p) {
      closeMenu();
      await props.messages.deleteSavedPin(p);
    }

    return {
      ...props.messages,
      messages: props.messages,
      openMenuUrl,
      setMenuRef,
      toggleMenu,
      closeMenu,
      pinAnchor,
      pinIsLinkable,
      pinPreviewText,
      pinHasLongText,
      pinExpanded,
      togglePinExpanded,
      removeFromMenu,
    };
  },
  template: await fetch(new URL("./index.html", import.meta.url)).then((r) => r.text()),
});
