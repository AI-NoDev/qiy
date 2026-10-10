import { expect, test } from "bun:test";
import { buildSchema, validateSchema } from "graphql";
import { graphqlTypeDefs } from "../src/graphql";

test("generated GraphQL schema satisfies the GraphQL type system", () => {
  expect(validateSchema(buildSchema(graphqlTypeDefs)).map((error) => error.message)).toEqual([]);
});
