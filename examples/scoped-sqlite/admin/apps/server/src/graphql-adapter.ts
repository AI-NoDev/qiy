import type { Repositories } from "./app";
import type { Authenticator } from "./auth/guard";
import { createGraphQLContext } from "./graphql";
import { createGraphQLResolvers } from "./graphql";

export function createGraphQLAdapterResolvers(repositories: Repositories, authenticate: Authenticator) {
  const root = createGraphQLResolvers(repositories, authenticate);
  return {
    Query: {
      records: async (_parent: unknown, args: any, context: { request: Request }) => root.records(args, await createGraphQLContext(authenticate, context.request)),
      recordsById: async (_parent: unknown, args: any, context: { request: Request }) => root.recordsById(args, await createGraphQLContext(authenticate, context.request)),
      recordsDistribution: async (_parent: unknown, args: any, context: { request: Request }) => root.recordsDistribution(args, await createGraphQLContext(authenticate, context.request)),
      recordsTrend: async (_parent: unknown, args: any, context: { request: Request }) => root.recordsTrend(args, await createGraphQLContext(authenticate, context.request)),
    },
    Mutation: {
      createRecords: async (_parent: unknown, args: any, context: { request: Request }) => root.createRecords(args, await createGraphQLContext(authenticate, context.request)),
      updateRecords: async (_parent: unknown, args: any, context: { request: Request }) => root.updateRecords(args, await createGraphQLContext(authenticate, context.request)),
      deleteRecords: async (_parent: unknown, args: any, context: { request: Request }) => root.deleteRecords(args, await createGraphQLContext(authenticate, context.request)),
      deleteRecordsMany: async (_parent: unknown, args: any, context: { request: Request }) => root.deleteRecordsMany(args, await createGraphQLContext(authenticate, context.request)),
    },
  };
}
