import { defineAsyncComponent, ref, computed, watch, onBeforeUnmount } from "vue";
import { useRouter } from "vue-router";
import { useGraffitiSession } from "@graffiti-garden/wrapper-vue";
import { MESSAGE_UNSEND_MS } from "../unsend-constants.js";
import LinkedText from "../linked-text/main.js";

function messageActor(obj) {
  return obj.value?.sender || obj.actor;
}

/** Async so route templates can register `components: { Message: MessageAsync }` without self-importing this module. */
export const MessageAsync = defineAsyncComponent(async () => ({
  components: { LinkedText },
  props: {
    object: { type: Object, required: true },
    messages: { type: Object, required: true },
  },
  setup(props) {
    const router = useRouter();
    const session = useGraffitiSession();

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

    const isUnsendReceipt = computed(
      () => props.object.value?.activity === "UnsendNotice",
    );

    const isMine = computed(() => {
      const me = session.value?.actor;
      return Boolean(me && messageActor(props.object) === me);
    });

    const unsendAvailable = ref(false);
    let unsendExpiryTimer;
    function clearUnsendTimer() {
      if (unsendExpiryTimer !== undefined) {
        clearTimeout(unsendExpiryTimer);
        unsendExpiryTimer = undefined;
      }
    }
    function syncUnsendWindow() {
      clearUnsendTimer();
      unsendAvailable.value = false;
      if (isUnsendReceipt.value) return;
      if (!isMine.value) return;
      const pub = Number(props.object.value?.published);
      if (!Number.isFinite(pub) || pub <= 0) return;
      const elapsed = Date.now() - pub;
      if (elapsed >= MESSAGE_UNSEND_MS) return;
      unsendAvailable.value = true;
      unsendExpiryTimer = setTimeout(() => {
        unsendAvailable.value = false;
        unsendExpiryTimer = undefined;
      }, MESSAGE_UNSEND_MS - elapsed);
    }
    watch(
      [
        isMine,
        isUnsendReceipt,
        () => props.object.value?.published,
        () => session.value?.actor,
      ],
      syncUnsendWindow,
      { immediate: true },
    );
    onBeforeUnmount(clearUnsendTimer);

    const showUnsend = computed(
      () => isMine.value && unsendAvailable.value && !isUnsendReceipt.value,
    );

    const isPinned = computed(() => {
      const set = props.messages.pinnedMessageUrls?.value;
      return Boolean(set && set.has(props.object.url));
    });

    const messageDomId = computed(() => `m-${encodeURIComponent(props.object.url)}`);
    const sentAtLabel = computed(() => formatPublished(props.object?.value?.published));

    const isVideoAttachment = computed(() => {
      const v = props.object.value;
      if (!v?.attachmentUrl) return false;
      if ((v.mediaType || "").toLowerCase() === "video") return true;
      return /\.(mp4|webm|mov|m4v|ogv|avi)(\?|$)/i.test(String(v.attachmentUrl));
    });

    function togglePin() {
      if (isUnsendReceipt.value) return;
      if (isPinned.value) props.messages.unpinMessageByUrl?.(props.object.url);
      else props.messages.pinMessage(props.object);
    }
    function handleUnsend() {
      props.messages.unsendMessage(props.object);
    }
    function goPinnedPage() {
      router.push({ name: "saved" });
    }

    return {
      isDeleting: props.messages.isDeleting,
      isUnsendReceipt,
      imageExpanded,
      toggleImageExpand,
      isPinned,
      messageDomId,
      sentAtLabel,
      isVideoAttachment,
      togglePin,
      handleUnsend,
      showUnsend,
      goPinnedPage,
    };
  },
  template: await fetch(new URL("./index.html", import.meta.url)).then((r) => r.text()),
}));
