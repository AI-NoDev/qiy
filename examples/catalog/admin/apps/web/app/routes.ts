import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  route("auth/login", "./routes/login.tsx"),
  index("./routes/home.tsx"),
  route(":resource", "./routes/list.tsx"),
  route(":resource/new", "./routes/create.tsx"),
  route(":resource/:id", "./routes/show.tsx"),
  route(":resource/:id/edit", "./routes/edit.tsx"),
] satisfies RouteConfig;
