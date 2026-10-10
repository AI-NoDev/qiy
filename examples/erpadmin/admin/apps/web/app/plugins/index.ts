export interface WebPlugin { name: string; setup?(): void | Promise<void>; }
export const plugins: WebPlugin[] = [];
