import { computed } from "vue";
import { useRoute } from "vue-router";
import { useMessagesState } from "../state.js";

function setup() {
  const messages = useMessagesState();
  const route = useRoute();
  const navChatsActive = computed(() =>
    ["home", "chat", "compose"].includes(route.name),
  );
  const navSearchActive = computed(() =>
    ["search", "search-results"].includes(route.name),
  );
  const navSavedActive = computed(() => route.name === "saved");
  return {
    ...messages,
    messages,
    route,
    navChatsActive,
    navSearchActive,
    navSavedActive,
  };
}

export default async () => ({
  setup,
  template: await fetch(new URL("./index.html", import.meta.url)).then((r) => r.text()),
});
