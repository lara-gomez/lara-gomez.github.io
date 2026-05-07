import { defineAsyncComponent, ref, watch } from "vue";
import { useGraffiti } from "@graffiti-garden/wrapper-vue";
import { formatHandle, syncActorDisplayCache } from "../state.js";

/** Process-wide cache of `actor -> displayName` so we resolve once per session. */
const handleCache = new Map();

/**
 * Renders an actor id as a stripped username (e.g. `oliviam` instead of
 * `oliviam.graffiti.actor`). Falls back to a 6-char tail of the actor id.
 */
export const UserName = defineAsyncComponent(async () => ({
  name: "UserName",
  props: {
    actor: { type: String, required: true },
  },
  setup(props) {
    const graffiti = useGraffiti();

    function fallbackFor(actor) {
      if (!actor) return "?";
      if (actor.length <= 8) return actor;
      return `…${actor.slice(-6)}`;
    }

    const display = ref(formatHandle(props.actor) || fallbackFor(props.actor));

    async function resolve(actor) {
      if (!actor) {
        display.value = "?";
        return;
      }
      if (handleCache.has(actor)) {
        display.value = handleCache.get(actor);
        syncActorDisplayCache(actor, display.value);
        return;
      }
      try {
        const handle = await graffiti.actorToHandle(actor);
        const formatted = formatHandle(handle) || formatHandle(actor) || fallbackFor(actor);
        handleCache.set(actor, formatted);
        display.value = formatted;
        syncActorDisplayCache(actor, formatted);
      } catch (_) {
        const formatted = formatHandle(actor) || fallbackFor(actor);
        handleCache.set(actor, formatted);
        display.value = formatted;
        syncActorDisplayCache(actor, formatted);
      }
    }

    watch(
      () => props.actor,
      (a) => {
        display.value = formatHandle(a) || fallbackFor(a);
        if (a) syncActorDisplayCache(a, display.value);
        resolve(a);
      },
      { immediate: true },
    );

    return { display };
  },
  template: await fetch(new URL("./index.html", import.meta.url)).then((r) => r.text()),
}));
