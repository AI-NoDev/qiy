import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  route("auth/login", "./routes/login.tsx"),
  route("auth/callback", "./routes/auth-callback.tsx"),
  index("./routes/home.tsx"),

  // Resource pages are wrapped in one guard per page action so a direct URL can
  // never render a page the access-control decision denies.
  layout("./routes/guard-list.tsx", [route(":resource", "./routes/list.tsx")]),
  layout("./routes/guard-create.tsx", [route(":resource/new", "./routes/create.tsx")]),
  layout("./routes/guard-show.tsx", [route(":resource/:id", "./routes/show.tsx")]),
  layout("./routes/guard-edit.tsx", [route(":resource/:id/edit", "./routes/edit.tsx")]),
] satisfies RouteConfig;
