import { MessageAsync } from "../message/main.js";

export default async () => ({
  props: {
    messages: { type: Object, required: true },
    chatId: { type: String, default: "" },
  },
  components: { Message: MessageAsync },
  setup(props) {
    return { ...props.messages, messages: props.messages, chatId: props.chatId };
  },
  template: await fetch(new URL("./index.html", import.meta.url)).then((r) => r.text()),
});
