import type { DatabaseIR, EntityIR, EnumIR, FieldIR } from "./database-ir";
import type { DataflowIR, QiyAction, QiyStateMachine, QiyStateTransition } from "./qiy-project";

/** Commands, buttons and the server-owned field one state machine compiles to. */
export interface StateMachineArtifacts {
  dataflows: DataflowIR[];
  actions: QiyAction[];
}

const identifier = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export function stateTransitionCommand(machine: Pick<QiyStateMachine, "name">, transition: Pick<QiyStateTransition, "name">): string {
  return machine.name + transition.name[0]!.toUpperCase() + transition.name.slice(1);
}

function resolve(machine: QiyStateMachine, entities: readonly EntityIR[], enums: readonly EnumIR[]): { entity: EntityIR; field: FieldIR; states: string[]; key: FieldIR } {
  const entity = entities.find((candidate) => candidate.name === machine.resource || candidate.tableName === machine.resource);
  if (!entity) throw new Error(`Statemachine ${machine.name}: unknown resource ${machine.resource}`);
  const field = entity.fields.find((candidate) => candidate.name === machine.field);
  if (!field) throw new Error(`Statemachine ${machine.name}: unknown field ${entity.name}.${machine.field}`);
  const enumeration = field.enumName ? enums.find((candidate) => candidate.name === field.enumName) : undefined;
  if (!enumeration) throw new Error(`Statemachine ${machine.name}: ${entity.name}.${field.name} must be an enum field`);
  if (field.nullable) throw new Error(`Statemachine ${machine.name}: ${entity.name}.${field.name} cannot be @nullable; every record has a state`);
  const key = entity.fields.find((candidate) => candidate.primaryKey);
  if (!key) throw new Error(`Statemachine ${machine.name}: ${entity.name} needs a primary key`);
  return { entity, field, states: enumeration.values.map((value) => value.name), key };
}

/**
 * Checks one project's state machines against its entities and the commands it
 * already declares. The expanded commands then go through the regular dataflow
 * and action validation, so roles, permissions and labels follow the same rules.
 */
export function validateStateMachines(machines: readonly QiyStateMachine[], entities: readonly EntityIR[], enums: readonly EnumIR[], declared: { dataflows: readonly DataflowIR[]; actions: readonly QiyAction[] }): void {
  const names = new Set<string>();
  const owned = new Set<string>();
  const commands = new Set([...declared.dataflows.map((flow) => flow.name), ...declared.actions.map((action) => action.name)]);
  for (const machine of machines) {
    if (names.has(machine.name)) throw new Error(`Duplicate statemachine ${machine.name}`);
    names.add(machine.name);
    const { entity, field, states } = resolve(machine, entities, enums);
    const ownedField = `${entity.name}.${field.name}`;
    if (owned.has(ownedField)) throw new Error(`Statemachine ${machine.name}: ${ownedField} already has a state machine`);
    owned.add(ownedField);
    if (!states.includes(machine.initial)) throw new Error(`Statemachine ${machine.name}: unknown initial state ${field.enumName}.${machine.initial}`);
    const declaredDefault = field.defaultValue?.kind === "literal" ? field.defaultValue.value : undefined;
    if (field.defaultValue && declaredDefault !== machine.initial) throw new Error(`Statemachine ${machine.name}: ${ownedField} has @default(${String(declaredDefault ?? field.defaultValue.kind)}) but the initial state is ${machine.initial}; remove the @default`);
    if (!machine.transitions.length) throw new Error(`Statemachine ${machine.name}: declare at least one transition`);
    const transitions = new Set<string>();
    for (const transition of machine.transitions) {
      if (!identifier.test(transition.name)) throw new Error(`Statemachine ${machine.name}: invalid transition name ${transition.name}`);
      if (transitions.has(transition.name)) throw new Error(`Statemachine ${machine.name}: duplicate transition ${transition.name}`);
      transitions.add(transition.name);
      const where = `Statemachine ${machine.name}: transition ${transition.name}`;
      if (!transition.from.length) throw new Error(`${where} needs from`);
      if (!transition.to) throw new Error(`${where} needs to`);
      for (const state of [...transition.from, transition.to]) if (!states.includes(state)) throw new Error(`${where}: unknown state ${field.enumName}.${state}`);
      if (new Set(transition.from).size !== transition.from.length) throw new Error(`${where}: duplicate from state`);
      if (transition.from.includes(transition.to)) throw new Error(`${where}: to ${transition.to} is also a from state`);
      const command = stateTransitionCommand(machine, transition);
      if (commands.has(command)) throw new Error(`${where}: generated command ${command} collides with a declared dataflow or action`);
      commands.add(command);
    }
  }
  for (const flow of declared.dataflows) {
    const contexts = new Map(flow.context.map((item) => [item.name, item.entity]));
    for (const step of flow.steps) for (const action of step.actions) {
      if (action.kind !== "update" && action.kind !== "create") continue;
      const target = entities.find((candidate) => candidate.name === (action.kind === "create" ? action.entity : contexts.get(action.context)) || candidate.tableName === (action.kind === "create" ? action.entity : contexts.get(action.context)));
      const written = target && action.values.find((value) => owned.has(`${target.name}.${value.field}`));
      if (written) throw new Error(`Dataflow ${flow.name}: ${target.name}.${written.field} belongs to a statemachine; change it with a transition instead`);
    }
  }
}

/** The dataflow and list/detail action behind every transition. */
export function stateMachineArtifacts(machines: readonly QiyStateMachine[], entities: readonly EntityIR[], enums: readonly EnumIR[]): StateMachineArtifacts {
  const dataflows: DataflowIR[] = [];
  const actions: QiyAction[] = [];
  for (const machine of machines) {
    const { entity, field, states, key } = resolve(machine, entities, enums);
    for (const transition of machine.transitions) {
      const name = stateTransitionCommand(machine, transition);
      const error = `${transition.name} is not allowed while ${field.name} is not ${transition.from.join(" or ")}`;
      // `require` compares one value, so "one of several states" is written as
      // "none of the remaining states"; the enum makes the two equivalent.
      const guard: DataflowIR["steps"][number]["actions"] = transition.from.length === 1
        ? [{ kind: "require", left: `record.${field.name}`, operator: "==", right: transition.from[0]!, error, errorKey: "state.invalidTransition" }]
        : states.filter((state) => !transition.from.includes(state)).map((state) => ({ kind: "require", left: `record.${field.name}`, operator: "!=", right: state, error, errorKey: "state.invalidTransition" }));
      const event = `${entity.tableName}.${transition.name}`;
      const label = transition.label ?? transition.name;
      dataflows.push({
        name,
        label,
        ...(transition.labelKey && { labelKey: transition.labelKey }),
        ...(transition.confirm !== undefined && { confirm: transition.confirm }),
        ...(transition.confirmKey && { confirmKey: transition.confirmKey }),
        comment: `Statemachine ${machine.name}: ${transition.from.join(", ")} -> ${transition.to}`,
        // A retried transition replays its first result instead of failing the guard.
        idempotency: { required: true },
        audit: event,
        ...(transition.roles && { roles: transition.roles }),
        ...(transition.permission && { permission: transition.permission }),
        ...(transition.verification !== undefined && { verification: transition.verification }),
        input: [{ name: "recordId", type: "UUID", required: true }],
        context: [{ name: "record", entity: entity.name, id: `${key.name}:input.recordId`, required: true }],
        steps: [
          { name: "guard", order: 1, actions: guard },
          {
            name: "transition",
            order: 2,
            actions: [
              { kind: "update", context: "record", values: [{ field: field.name, value: transition.to }] },
              { kind: "emit", event, payload: [{ name: "id", source: "context", context: "record", value: key.name }, { name: field.name, source: "literal", value: transition.to }] },
            ],
          },
        ],
        result: "record",
      });
      actions.push({
        name,
        resource: entity.tableName,
        placements: ["list", "show"],
        label,
        ...(transition.labelKey && { labelKey: transition.labelKey }),
        condition: transition.from.length === 1 ? { field: field.name, operator: "==", value: transition.from[0]! } : { field: field.name, operator: "in", values: transition.from },
        target: { kind: "dataflow", dataflow: name, ...(transition.confirm !== undefined && { confirm: transition.confirm }), ...(transition.confirmKey && { confirmKey: transition.confirmKey }) },
      });
    }
  }
  return { dataflows, actions };
}

/**
 * The owned field starts at the initial state and only changes through the
 * transition commands: generic create/update inputs, CSV import and forms skip it.
 */
export function applyStateMachines(database: DatabaseIR, machines: readonly QiyStateMachine[]): DatabaseIR {
  if (!machines.length) return database;
  const owners = new Map(machines.map((machine) => {
    const { entity, field } = resolve(machine, database.entities, database.enums ?? []);
    return [`${entity.name}.${field.name}`, machine] as const;
  }));
  return {
    ...database,
    entities: database.entities.map((entity) => ({
      ...entity,
      fields: entity.fields.map((field) => {
        const machine = owners.get(`${entity.name}.${field.name}`);
        return machine ? { ...field, defaultValue: { kind: "literal" as const, value: machine.initial }, stateMachine: machine.name } : field;
      }),
    })),
  };
}
