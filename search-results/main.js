import { computed, ref } from "vue";
import { useRoute } from "vue-router";
import LinkedText from "../linked-text/main.js";

export default async () => ({
  components: { LinkedText },
  props: {
    messages: { type: Object, required: true },
  },
  setup(props) {
    const RESULT_PREVIEW_MAX = 200;
    const RESULT_PREVIEW_LEAD = 56;
    const expandedResultUrls = ref(new Set());

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

    const queryWords = computed(() =>
      String(props.messages.searchQuery?.value || "")
        .toLowerCase()
        .trim()
        .split(/\s+/)
        .filter(Boolean),
    );

    function resultContent(obj) {
      return String(obj?.value?.content || "");
    }

    function resultExpanded(obj) {
      return expandedResultUrls.value.has(String(obj?.url || ""));
    }

    function resultCanExpand(obj) {
      return resultContent(obj).length > RESULT_PREVIEW_MAX;
    }

    function toggleResultExpanded(obj) {
      const url = String(obj?.url || "");
      if (!url) return;
      const next = new Set(expandedResultUrls.value);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      expandedResultUrls.value = next;
    }

    function resultMatchIndex(contentLower) {
      if (!queryWords.value.length) return -1;
      let best = -1;
      for (const w of queryWords.value) {
        const idx = contentLower.indexOf(w);
        if (idx >= 0 && (best < 0 || idx < best)) best = idx;
      }
      return best;
    }

    function previewSnippet(obj) {
      const raw = resultContent(obj);
      if (!raw) return "";
      if (resultExpanded(obj) || raw.length <= RESULT_PREVIEW_MAX) return raw;

      const lower = raw.toLowerCase();
      const hit = resultMatchIndex(lower);
      const center = hit >= 0 ? hit : 0;
      let start = Math.max(0, center - RESULT_PREVIEW_LEAD);
      let end = Math.min(raw.length, start + RESULT_PREVIEW_MAX);
      if (end - start < RESULT_PREVIEW_MAX && start > 0) {
        start = Math.max(0, end - RESULT_PREVIEW_MAX);
      }

      const chunk = raw.slice(start, end).trim();
      const prefix = start > 0 ? "…" : "";
      const suffix = end < raw.length ? "…" : "";
      return `${prefix}${chunk}${suffix}`;
    }

    const route = useRoute();
    return {
      ...props.messages,
      messages: props.messages,
      route,
      formatPublished,
      queryWords,
      previewSnippet,
      resultCanExpand,
      resultExpanded,
      toggleResultExpanded,
    };
  },
  template: await fetch(new URL("./index.html", import.meta.url)).then((r) => r.text()),
});
