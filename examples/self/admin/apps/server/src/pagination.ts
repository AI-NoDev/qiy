export function withPaginationLimit<T extends object>(service: T): T {
  return new Proxy(service, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (property !== "list" || typeof value !== "function") return value;
      return (page: number, pageSize: number, ...args: unknown[]) => {
        if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new Error("Invalid pagination");
        return Reflect.apply(value, target, [page, pageSize, ...args]);
      };
    },
  });
}
