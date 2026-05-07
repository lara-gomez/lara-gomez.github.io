import { watch, ref, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import { useGraffitiSession } from "@graffiti-garden/wrapper-vue";

const SESSION_BOOT_WARNING_MS = 12000;

export default async () => ({
  setup() {
    const router = useRouter();
    const session = useGraffitiSession();
    const bootStalled = ref(false);
    let bootTimer;

    function clearBootTimer() {
      if (bootTimer !== undefined) {
        clearTimeout(bootTimer);
        bootTimer = undefined;
      }
    }

    watch(
      () => session.value?.actor,
      (actor) => {
        if (actor) router.replace({ name: "home" }).catch(() => {});
      },
    );

    watch(
      () => session.value,
      (v) => {
        clearBootTimer();
        bootStalled.value = false;
        if (v !== undefined) return;
        bootTimer = window.setTimeout(() => {
          if (session.value === undefined) bootStalled.value = true;
        }, SESSION_BOOT_WARNING_MS);
      },
      { immediate: true },
    );

    function reloadLoginPage() {
      window.location.reload();
    }

    onUnmounted(() => clearBootTimer());

    return {
      bootStalled,
      reloadLoginPage,
    };
  },
  template: await fetch(new URL("./index.html", import.meta.url)).then((r) => r.text()),
});
