import { defineAsyncComponent, ref } from "vue";

/** Async so route templates can register `components: { Message: MessageAsync }` without self-importing this module. */
export const MessageAsync = defineAsyncComponent(async () => ({
  props: {
    object: { type: Object, required: true },
    messages: { type: Object, required: true },
  },
  setup(props) {
    const imageExpanded = ref(false);
    function toggleImageExpand() {
      imageExpanded.value = !imageExpanded.value;
    }
    return {
      deleteMessage: props.messages.deleteMessage,
      isDeleting: props.messages.isDeleting,
      pinMessage: props.messages.pinMessage,
      imageExpanded,
      toggleImageExpand,
    };
  },
  template: await fetch(new URL("./index.html", import.meta.url)).then((r) => r.text()),
}));
