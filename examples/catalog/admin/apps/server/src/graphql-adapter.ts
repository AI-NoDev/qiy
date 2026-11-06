import type { Repositories } from "./app";
import type { Authenticator } from "./auth/guard";
import { createGraphQLContext } from "./graphql";
import { createGraphQLResolvers } from "./graphql";

export function createGraphQLAdapterResolvers(repositories: Repositories, authenticate: Authenticator) {
  const root = createGraphQLResolvers(repositories, authenticate);
  return {
    Query: {
      products: async (_parent: unknown, args: any, context: { request: Request }) => root.products(args, await createGraphQLContext(authenticate, context.request)),
      productsById: async (_parent: unknown, args: any, context: { request: Request }) => root.productsById(args, await createGraphQLContext(authenticate, context.request)),
      productsDistribution: async (_parent: unknown, args: any, context: { request: Request }) => root.productsDistribution(args, await createGraphQLContext(authenticate, context.request)),
      productsTrend: async (_parent: unknown, args: any, context: { request: Request }) => root.productsTrend(args, await createGraphQLContext(authenticate, context.request)),
    },
    Mutation: {
      createProducts: async (_parent: unknown, args: any, context: { request: Request }) => root.createProducts(args, await createGraphQLContext(authenticate, context.request)),
      updateProducts: async (_parent: unknown, args: any, context: { request: Request }) => root.updateProducts(args, await createGraphQLContext(authenticate, context.request)),
      deleteProducts: async (_parent: unknown, args: any, context: { request: Request }) => root.deleteProducts(args, await createGraphQLContext(authenticate, context.request)),
      deleteProductsMany: async (_parent: unknown, args: any, context: { request: Request }) => root.deleteProductsMany(args, await createGraphQLContext(authenticate, context.request)),
    },
  };
}
