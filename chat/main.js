import { ref, watch, nextTick, onMounted, onUnmounted, computed } from "vue";
import { useRoute } from "vue-router";
import { MessageAsync } from "../message/main.js";

const COMPOSER_MAX_HEIGHT_PX = 160;
const STICK_TO_BOTTOM_THRESHOLD_PX = 80;
const HIGHLIGHT_DURATION_MS = 1500;

export default async () => ({
  props: {
    messages: { type: Object, required: true },
    chatId: { type: String, default: "" },
  },
  components: { Message: MessageAsync },
  setup(props) {
    const route = useRoute();
    const threadList = ref(null);
    const composerInput = ref(null);
    /** True iff the user is at (or close to) the bottom of the thread list. */
    const atBottom = ref(true);
    /** After sending from the composer, keep thread at bottom instead of `#m-` deep link. */
    const preferThreadBottomOverHash = ref(false);

    function isNearBottom(el) {
      if (!el) return true;
      return el.scrollTop + el.clientHeight >= el.scrollHeight - STICK_TO_BOTTOM_THRESHOLD_PX;
    }

    function scrollThreadToBottom() {
      const el = threadList.value;
      if (!el) return;
      el.scrollTop = el.scrollHeight;
    }

    /** Always force to bottom (chat open / chat switch / after own send). */
    function forceScrollToBottom() {
      atBottom.value = true;
      nextTick(() => {
        scrollThreadToBottom();
        requestAnimationFrame(scrollThreadToBottom);
      });
    }

    /** Only stick to bottom if user was already there. */
    function maybeScrollToBottom() {
      if (!atBottom.value) return;
      nextTick(() => {
        scrollThreadToBottom();
        requestAnimationFrame(scrollThreadToBottom);
      });
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

    const me = computed(() => props.messages.session?.value?.actor ?? null);

    function onScroll() {
      atBottom.value = isNearBottom(threadList.value);
    }

    /** True when the route has a `#m-...` deep link to a specific message. */
    function hashMessageId() {
      const h = route.hash || "";
      return h.startsWith("#m-") ? h.slice(1) : "";
    }

    /** Scroll the matching `<li>` into view and pulse-highlight it. */
    function scrollToHashMessage() {
      const id = hashMessageId();
      if (!id) return false;
      const el = document.getElementById(id);
      if (!el) return false;
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      el.classList.add("message-highlight");
      window.setTimeout(() => el.classList.remove("message-highlight"), HIGHLIGHT_DURATION_MS);
      return true;
    }

    /** Run after layout settles (DOM ids exist + scrollHeight is correct). */
    function tryScrollToHashMessage() {
      nextTick(() => {
        if (scrollToHashMessage()) return;
        requestAnimationFrame(() => {
          if (scrollToHashMessage()) return;
          window.setTimeout(scrollToHashMessage, 80);
        });
      });
    }

    onMounted(() => {
      if (hashMessageId()) {
        tryScrollToHashMessage();
      } else {
        forceScrollToBottom();
      }
    });

    watch(
      () => props.messages.areMessageObjectsLoading?.value,
      (loading, prev) => {
        if (prev && !loading) {
          if (hashMessageId()) tryScrollToHashMessage();
          else forceScrollToBottom();
        }
      },
    );

    watch(threadScrollDigest, () => {
      if (hashMessageId() && !preferThreadBottomOverHash.value) {
        tryScrollToHashMessage();
        return;
      }
      const arr = props.messages.sortedMessageObjects?.value ?? [];
      const last = arr[arr.length - 1];
      const lastSender = last ? (last.value?.sender || last.actor) : null;
      const isMine = Boolean(lastSender && me.value && lastSender === me.value);
      if (isMine) {
        forceScrollToBottom();
      } else {
        maybeScrollToBottom();
      }
    });

    watch(
      () => props.chatId,
      () => {
        preferThreadBottomOverHash.value = false;
        if (hashMessageId()) tryScrollToHashMessage();
        else forceScrollToBottom();
      },
    );

    watch(
      () => route.hash,
      (h) => {
        preferThreadBottomOverHash.value = false;
        if (h && h.startsWith("#m-")) tryScrollToHashMessage();
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
    }

    watch(
      () => props.messages.myMessage?.value,
      () => nextTick(autoSizeComposer),
    );

    function onComposerEnter() {
      preferThreadBottomOverHash.value = true;
      props.messages.sendMessage();
      nextTick(() => {
        autoSizeComposer();
        forceScrollToBottom();
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
      onScroll,
      atBottom,
    };
  },
  template: await fetch(new URL("./index.html", import.meta.url)).then((r) => r.text()),
});
