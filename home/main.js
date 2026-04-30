export default async () => ({
  props: {
    messages: { type: Object, required: true },
  },
  setup(props) {
    return { ...props.messages, messages: props.messages };
  },
  template: await fetch(new URL("./index.html", import.meta.url)).then((r) => r.text()),
});
