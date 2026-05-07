import { defineComponent, computed, h } from "vue";
import { parseTextWithLinks } from "../linkify.js";

function escRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export default defineComponent({
  name: "LinkedText",
  props: {
    text: { type: String, default: "" },
    highlightWords: { type: Array, default: () => [] },
  },
  setup(props) {
    const parts = computed(() => parseTextWithLinks(props.text || ""));
    const highlightRe = computed(() => {
      const ws = (props.highlightWords || [])
        .map((w) => String(w || "").trim())
        .filter(Boolean);
      if (!ws.length) return null;
      return new RegExp(`(${ws.map((w) => escRegExp(w)).join("|")})`, "gi");
    });

    function renderHighlightedText(text, keyPrefix) {
      const re = highlightRe.value;
      if (!re || !text) return [text];
      const chunks = String(text).split(re);
      return chunks.map((c, i) =>
        i % 2 === 1
          ? h("mark", { key: `${keyPrefix}-h-${i}`, class: "message-highlight-term" }, c)
          : c,
      );
    }

    return () =>
      h(
        "span",
        { class: "linked-text-inner" },
        parts.value.map((p, i) =>
          p.type === "link"
            ? h(
                "a",
                {
                  key: i,
                  class: "message-link",
                  href: p.href,
                  target: "_blank",
                  rel: "noopener noreferrer",
                },
                renderHighlightedText(p.text, `l${i}`),
              )
            : h(
                "span",
                { key: i, class: "linked-text-chunk" },
                renderHighlightedText(p.text, `t${i}`),
              ),
        ),
      );
  },
});
