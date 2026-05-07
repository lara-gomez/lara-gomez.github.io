import { ref, watch, nextTick, onMounted, onUnmounted, computed } from "vue";
import { MessageAsync } from "../message/main.js";

const COMPOSER_MAX_HEIGHT_PX = 160;

export default async () => ({
  props: {
    messages: { type: Object, required: true },
    chatId: { type: String, default: "" },
  },
  components: { Message: MessageAsync },
  setup(props) {
    const threadList = ref(null);
    const composerInput = ref(null);

    let resizeObserver;

    function scrollThreadToBottom() {
      const el = threadList.value;
      if (!el) return;
      el.scrollTop = el.scrollHeight;
    }

    function scheduleScroll() {
      nextTick(() => {
        scrollThreadToBottom();
        requestAnimationFrame(scrollThreadToBottom);
      });
    }

    function detachResizeObserver() {
      if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = undefined;
      }
    }

    function attachResizeObserver() {
      detachResizeObserver();
      const el = threadList.value;
      if (!el || typeof ResizeObserver === "undefined") return;
      resizeObserver = new ResizeObserver(() => {
        scrollThreadToBottom();
      });
      resizeObserver.observe(el);
    }

    /** Scroll when list length or last message identity changes (covers edits and long threads). */
    const threadScrollDigest = computed(() => {
      const arr = props.messages.sortedMessageObjects?.value ?? [];
      const n = arr.length;
      if (!n) return "0";
      const last = arr[n - 1];
      const u = last?.url ?? "";
      const pub = last?.value?.published ?? 0;
      const c = (last?.value?.content ?? "").length;
      return `${n}|${u}|${pub}|${c}`;
    });

    onMounted(() => {
      scheduleScroll();
      nextTick(attachResizeObserver);
    });

    onUnmounted(() => {
      detachResizeObserver();
    });

    watch(
      () => props.messages.areMessageObjectsLoading?.value,
      (loading, prev) => {
        if (prev && !loading) {
          scheduleScroll();
          nextTick(attachResizeObserver);
        }
      },
    );

    watch(threadScrollDigest, () => {
      scheduleScroll();
    });

    watch(
      () => props.chatId,
      () => {
        scheduleScroll();
        nextTick(attachResizeObserver);
      },
    );

    function autoSizeComposer() {
      const el = composerInput.value;
      if (!el) return;
      el.style.height = "auto";
      const next = Math.min(el.scrollHeight, COMPOSER_MAX_HEIGHT_PX);
      el.style.height = next + "px";
    }

    function onComposerInput() {
      autoSizeComposer();
      scheduleScroll();
    }

    watch(
      () => props.messages.myMessage?.value,
      () => nextTick(autoSizeComposer),
    );

    function onComposerEnter() {
      props.messages.sendMessage();
      nextTick(() => {
        autoSizeComposer();
        scheduleScroll();
      });
    }

    return {
      ...props.messages,
      messages: props.messages,
      chatId: props.chatId,
      threadList,
      composerInput,
      onComposerInput,
      onComposerEnter,
    };
  },
  template: await fetch(new URL("./index.html", import.meta.url)).then((r) => r.text()),
});
