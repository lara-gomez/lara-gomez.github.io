import { createApp, watch, defineAsyncComponent } from "vue";
import { createRouter, createWebHashHistory, useRoute, useRouter } from "vue-router";
import { GraffitiDecentralized } from "@graffiti-garden/implementation-decentralized";
import { GraffitiPlugin, useGraffitiSession } from "@graffiti-garden/wrapper-vue";
import { UserName } from "./username/main.js";

function loadComponent(name) {
  return () => import(`./${name}/main.js`).then((m) => m.default());
}

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/login", name: "login", component: loadComponent("login") },
    {
      path: "/",
      component: loadComponent("layout"),
      children: [
        { path: "", name: "home", component: loadComponent("home") },
        { path: "compose", name: "compose", component: loadComponent("compose") },
        { path: "chat/:chatId", name: "chat", component: loadComponent("chat"), props: true },
        {
          path: "search",
          redirect: (to) => ({ name: "home", query: to.query, hash: to.hash || "#search-tools" }),
        },
        {
          path: "search/results",
          name: "search-results",
          component: loadComponent("search-results"),
        },
        { path: "saved", name: "saved", component: loadComponent("saved") },
      ],
    },
  ],
});

const app = createApp({
  template: "#template",
  components: {
    Home: defineAsyncComponent(loadComponent("home")),
  },
  setup() {
    const session = useGraffitiSession();
    const route = useRoute();
    const routerInstance = useRouter();
    watch(
      () => [session.value, route.name],
      () => {
        if (session.value === null && route.name !== "login") {
          routerInstance.replace({ name: "login" });
        }
        if (session.value?.actor && route.name === "login") {
          routerInstance.replace({ name: "home" });
        }
      },
      { flush: "post" },
    );
    return {};
  },
});

app.component("UserName", UserName);

app
  .use(router)
  .use(GraffitiPlugin, { graffiti: new GraffitiDecentralized() })
  .mount("#app");
