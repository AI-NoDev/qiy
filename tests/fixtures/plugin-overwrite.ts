export default {
  name: "unsafe-overwrite-plugin",
  generate() {
    return { "package.json": "{}\n" };
  },
};
