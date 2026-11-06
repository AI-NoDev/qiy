import { describe, expect, test } from "bun:test";
import { generateProject, projectGenerationOptions } from "../tools/generate-project";
import { parseQiyProject, serializeQiyProject } from "../tools/qiy-project";
import { applyStateMachines, stateMachineArtifacts, stateTransitionCommand } from "../tools/state-machines";

const app = (body: string, field = "field stage stage;") => `qiy v0;
application machine-demo {
  database sqlite {}
  enum stage { value draft label "Draft"; value review label "Review"; value published label "Published"; }
  entity posts { field id UUID @id; field title Text; ${field} }
  ${body}
}`;

const machine = `statemachine postFlow {
    resource posts;
    field stage;
    initial draft;
    transition submit { from draft; to review; }
    transition publish { from draft, review; to published; label "Publish"; confirm "Publish now?"; }
  }`;

describe("Qiy statemachine", () => {
  test("parses, round-trips and stays separate from declared commands", () => {
    const project = parseQiyProject(app(machine));
    expect(project.stateMachines).toEqual([{
      name: "postFlow", resource: "posts", field: "stage", initial: "draft",
      transitions: [
        { name: "submit", from: ["draft"], to: "review" },
        { name: "publish", from: ["draft", "review"], to: "published", label: "Publish", confirm: "Publish now?" },
      ],
    }]);
    expect(project.dataflows ?? []).toEqual([]);
    expect(project.actions ?? []).toEqual([]);
    expect(parseQiyProject(serializeQiyProject(project)).stateMachines).toEqual(project.stateMachines);
  });

  test("interleaves with dataflows and actions in any order", () => {
    const flow = `dataflow retitle { input { field postId UUID @required; } context { post = entity posts by id input.postId @required; } step rename { update post { title = "x"; } } result { return post; } }`;
    const project = parseQiyProject(app(`${flow} ${machine} action retitle { resource posts; dataflow retitle; placement show; label "Retitle"; when stage in "draft", "review"; }`));
    expect(project.stateMachines).toHaveLength(1);
    expect(project.actions?.[0]?.condition).toEqual({ field: "stage", operator: "in", values: ["draft", "review"] });
    expect(serializeQiyProject(project)).toContain('when stage in "draft", "review";');
  });

  test("compiles every transition to a guarded command and a conditional action", () => {
    const project = parseQiyProject(app(machine));
    const { dataflows, actions } = stateMachineArtifacts(project.stateMachines!, project.database.entities, project.database.enums ?? []);
    expect(dataflows.map((flow) => flow.name)).toEqual(["postFlowSubmit", "postFlowPublish"]);
    const [submit, publish] = dataflows;
    expect(submit!.steps[0]!.actions).toEqual([{ kind: "require", left: "record.stage", operator: "==", right: "draft", error: "submit is not allowed while stage is not draft", errorKey: "state.invalidTransition" }]);
    expect(publish!.steps[0]!.actions).toEqual([expect.objectContaining({ operator: "!=", right: "published" })]);
    expect(publish!.steps[1]!.actions[0]).toEqual({ kind: "update", context: "record", values: [{ field: "stage", value: "published" }] });
    expect(publish).toMatchObject({ idempotency: { required: true }, audit: "posts.publish", confirm: "Publish now?", context: [{ name: "record", entity: "posts", id: "id:input.recordId", required: true }] });
    expect(actions[0]!.condition).toEqual({ field: "stage", operator: "==", value: "draft" });
    expect(actions[1]!.condition).toEqual({ field: "stage", operator: "in", values: ["draft", "review"] });
    expect(actions[1]!.target).toEqual({ kind: "dataflow", dataflow: "postFlowPublish", confirm: "Publish now?" });
    expect(stateTransitionCommand({ name: "postFlow" }, { name: "submit" })).toBe("postFlowSubmit");
  });

  test("makes the owned field server-owned with the initial state as default", () => {
    const project = parseQiyProject(app(machine));
    const field = applyStateMachines(project.database, project.stateMachines!).entities[0]!.fields.find((item) => item.name === "stage");
    expect(field).toMatchObject({ stateMachine: "postFlow", defaultValue: { kind: "literal", value: "draft" } });
    const files = generateProject(project.database, project.name, projectGenerationOptions(project));
    const routes = files["apps/server/src/modules/posts/posts.routes.ts"] ?? "";
    expect(Object.entries(files).some(([path, content]) => path.startsWith("apps/server/src/") && content.includes("postFlowPublish"))).toBe(true);
    expect(routes).toMatch(/"title": t\./);
    expect(routes).not.toMatch(/"stage": t\./);
    expect(files["apps/web/app/resources.ts"]).toMatch(/"name": "stage",[\s\S]*?"formVisible": false/);
    expect(files["apps/web/app/actions.ts"]).toContain('"operator": "in"');
  });

  test("rejects machines that cannot own their field", () => {
    const fails = (body: string, field?: string) => expect(() => parseQiyProject(app(body, field)));
    fails(machine, "field stage Text;").toThrow("must be an enum field");
    fails(machine, "field stage stage @nullable;").toThrow("cannot be @nullable");
    fails(machine, 'field stage stage @default(review);').toThrow("remove the @default");
    fails(machine.replace("initial draft", "initial gone")).toThrow("unknown initial state");
    fails(machine.replace("to review;", "to gone;")).toThrow("unknown state stage.gone");
    fails(machine.replace("from draft, review;", "from review, review;")).toThrow("duplicate from state");
    fails(machine.replace("to published;", "to draft;")).toThrow("is also a from state");
    fails(machine.replace("resource posts;", "resource missing;")).toThrow("unknown resource");
    fails(`${machine} ${machine}`).toThrow("Duplicate statemachine postFlow");
    fails(`${machine} ${machine.replace("postFlow", "otherFlow")}`).toThrow("already has a state machine");
    fails(`statemachine empty { resource posts; field stage; initial draft; }`).toThrow("at least one transition");
    fails(`${machine} dataflow postFlowSubmit { input { field id UUID @required; } context { post = entity posts by id input.id @required; } step s { update post { title = "x"; } } result { return post; } }`).toThrow("collides with a declared dataflow or action");
    fails(`${machine} dataflow sneak { input { field id UUID @required; } context { post = entity posts by id input.id @required; } step s { update post { stage = "published"; } } result { return post; } }`).toThrow("belongs to a statemachine");
  });
});
