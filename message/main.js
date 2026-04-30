import { defineAsyncComponent } from "vue";

/** Async so route templates can register `components: { Message: MessageAsync }` without self-importing this module. */
export const MessageAsync = defineAsyncComponent(async () => ({
  props: {
    object: { type: Object, required: true },
    messages: { type: Object, required: true },
  },
  setup(props) {
    return {
      deleteMessage: props.messages.deleteMessage,
      isDeleting: props.messages.isDeleting,
    };
  },
  template: await fetch(new URL("./index.html", import.meta.url)).then((r) => r.text()),
}));
