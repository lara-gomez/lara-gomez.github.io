import { useRoute } from "vue-router";

export default async () => ({
  props: {
    messages: { type: Object, required: true },
  },
  setup(props) {
    const route = useRoute();
    return { ...props.messages, messages: props.messages, route };
  },
  template: await fetch(new URL("./index.html", import.meta.url)).then((r) => r.text()),
});
