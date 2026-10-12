export function generatedDocumentation(description: { comment?: string; commentKey?: string } | undefined, indentation = ""): string {
  if (description?.comment === undefined) return "";
  const text = description.comment + (description.commentKey ? `\ni18n: ${description.commentKey}` : "");
  const lines = text.replaceAll("*/", "* /").split(/\r\n|[\n\r\u2028\u2029]/);
  return `${indentation}/**\n${lines.map((line) => `${indentation} * ${line}`).join("\n")}\n${indentation} */\n`;
}
