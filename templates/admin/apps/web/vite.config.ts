import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [reactRouter()],
  server: { proxy: { "/api": process.env.QIY_API_PROXY ?? "http://localhost:3000", "/graphql": process.env.QIY_API_PROXY ?? "http://localhost:3000" } },
});
