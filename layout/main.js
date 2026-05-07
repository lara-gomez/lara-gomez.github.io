import { computed, watch, ref, onUnmounted } from "vue";
import { useRoute } from "vue-router";
import { useGraffitiSession } from "@graffiti-garden/wrapper-vue";
import { useMessagesState } from "../state.js";

const SESSION_BOOT_WARNING_MS = 12000;

function setup() {
  const messages = useMessagesState();
  const route = useRoute();
  const session = useGraffitiSession();
  const sessionBootStalled = ref(false);
  let bootTimer;

  function clearBootTimer() {
    if (bootTimer !== undefined) {
      clearTimeout(bootTimer);
      bootTimer = undefined;
    }
  }

  watch(
    () => session.value,
    (v) => {
      clearBootTimer();
      sessionBootStalled.value = false;
      if (v !== undefined) return;
      bootTimer = window.setTimeout(() => {
        if (session.value === undefined) sessionBootStalled.value = true;
      }, SESSION_BOOT_WARNING_MS);
    },
    { immediate: true },
  );

  onUnmounted(() => clearBootTimer());

  function reloadApp() {
    window.location.reload();
  }

  const navChatsActive = computed(() =>
    ["home", "chat", "compose"].includes(route.name),
  );
  const navSavedActive = computed(() => route.name === "saved");
  return {
    ...messages,
    messages,
    route,
    navChatsActive,
    navSavedActive,
    sessionBootStalled,
    reloadApp,
  };
}

export default async () => ({
  setup,
  template: await fetch(new URL("./index.html", import.meta.url)).then((r) => r.text()),
});
