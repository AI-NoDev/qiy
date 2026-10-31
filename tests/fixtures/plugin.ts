export default {
  name: "test-generator-plugin",
  generate({ appName, files }: { appName: string; files: Record<string, string> }) {
    return {
      "docs/generated-by-plugin.md": `# ${appName}\n\nCore files: ${Object.keys(files).length}\n`,
      "apps/server/src/extensions/plugin-marker.ts": "export const pluginMarker = true;\n",
    };
  },
};
