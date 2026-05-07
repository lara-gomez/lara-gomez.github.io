/**
 * Kebab dropdown Teleport + fixed coords so menus aren't clipped by overflow:auto parents.
 */

import { ref, watch, nextTick, onMounted, onUnmounted } from "vue";

/** Min width aligns with `.message-menu` styles. */
const MENU_MIN_W_PX = 168;

/** Placement for `<Teleport to="body">` menus anchored to any button-like element. */
export function floatedMenuPlacementFromButton(btnEl) {
  if (!btnEl || typeof btnEl.getBoundingClientRect !== "function") {
    return {
      visibility: "hidden",
    };
  }
  const r = btnEl.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const preferredLeft = Math.min(r.right - MENU_MIN_W_PX, vw - MENU_MIN_W_PX - 12);
  const top = Math.max(8, Math.min(r.bottom + 4, vh - 40));
  return {
    position: "fixed",
    top: `${top}px`,
    left: `${Math.max(8, preferredLeft)}px`,
    minWidth: `${MENU_MIN_W_PX}px`,
    zIndex: 10050,
    visibility: "visible",
  };
}

export function useFloatingKebab() {
  const menuOpen = ref(false);
  const menuTriggerEl = ref(null);
  /** Teleported panel root — used with ref="menuTeleportEl". */
  const menuTeleportEl = ref(null);

  /** inline style object for `:style="menuFloatedStyle"` */
  const menuFloatedStyle = ref({ visibility: "hidden" });

  function measureAndPlace() {
    if (!menuOpen.value) return;
    menuFloatedStyle.value = floatedMenuPlacementFromButton(menuTriggerEl.value);
  }

  watch(menuOpen, (open) => {
    if (open) nextTick(measureAndPlace);
    else menuFloatedStyle.value = { visibility: "hidden" };
  });

  function onRepositionEvents() {
    if (menuOpen.value) measureAndPlace();
  }

  /** Close floating menu while scrolling nested panes — menu would detach visually. */
  function onScrollCapture() {
    if (menuOpen.value) menuOpen.value = false;
  }

  onMounted(() => {
    window.addEventListener("resize", onRepositionEvents);
    /** Capture scroll on any descendant scroll container */
    window.addEventListener("scroll", onScrollCapture, true);
  });

  onUnmounted(() => {
    window.removeEventListener("resize", onRepositionEvents);
    window.removeEventListener("scroll", onScrollCapture, true);
  });

  /** Bubble-phase outside click; safe with @click.stop on the trigger. */
  function attachOutsideCloser() {
    function onDocClick(event) {
      if (!menuOpen.value) return;
      const trig = menuTriggerEl.value;
      const panel = menuTeleportEl.value;
      if (
        trig &&
        typeof trig.contains === "function" &&
        trig.contains(event.target)
      ) {
        return;
      }
      if (
        panel &&
        typeof panel.contains === "function" &&
        panel.contains(event.target)
      ) {
        return;
      }
      menuOpen.value = false;
    }

    document.addEventListener("click", onDocClick, false);
    return () => document.removeEventListener("click", onDocClick, false);
  }

  return {
    menuOpen,
    menuTriggerEl,
    menuTeleportEl,
    menuFloatedStyle,
    measureAndPlace,
    attachOutsideCloser,
  };
}
