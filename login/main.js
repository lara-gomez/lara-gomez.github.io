import { watch } from "vue";
import { useRouter } from "vue-router";
import { useGraffitiSession } from "@graffiti-garden/wrapper-vue";

export default async () => ({
  setup() {
    const router = useRouter();
    const session = useGraffitiSession();
    watch(
      () => session.value?.actor,
      (actor) => {
        if (actor) router.replace({ name: "home" });
      },
    );
    return {};
  },
  template: await fetch(new URL("./index.html", import.meta.url)).then((r) => r.text()),
});
