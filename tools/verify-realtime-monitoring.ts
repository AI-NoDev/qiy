import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

const root = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("Usage: bun tools/verify-realtime-monitoring.ts <generated-workspace>");
const readYaml = async (path: string) => Bun.YAML.parse(await Bun.file(join(root, path)).text()) as any;
const monitor = await readYaml("deploy/kubernetes/realtime-servicemonitor.yaml");
const rule = await readYaml("deploy/kubernetes/realtime-prometheusrule.yaml");
const service = await readYaml("deploy/kubernetes/service.yaml");
const deployment = await readYaml("deploy/kubernetes/deployment.yaml");
const secret = await readYaml("deploy/kubernetes/secret.example.yaml");
const endpoint = monitor.spec.endpoints[0];
const app = service.metadata.name;
if (monitor.spec.selector.matchLabels.app !== service.metadata.labels.app) throw new Error("ServiceMonitor selector does not match Service");
if (!service.spec.ports.some((port: any) => port.name === endpoint.port)) throw new Error("ServiceMonitor port is missing");
if (endpoint.path !== "/api/v1/realtime/outbox/metrics/prometheus") throw new Error("Unexpected metrics path");
if (endpoint.authorization.credentials.name !== secret.metadata.name) throw new Error("Metrics Secret reference differs");
if (!(endpoint.authorization.credentials.key in secret.stringData)) throw new Error("Metrics Secret key is missing");
const env = deployment.spec.template.spec.containers[0].env;
const token = env.find((entry: any) => entry.name === "QIY_REALTIME_METRICS_TOKEN");
if (token?.valueFrom?.secretKeyRef?.name !== secret.metadata.name || token.valueFrom.secretKeyRef.key !== endpoint.authorization.credentials.key) throw new Error("Server and scraper credentials differ");
const dashboard = await Bun.file(join(root, "deploy/observability/grafana/qiy-realtime-outbox.json")).json();
if (dashboard.panels.length !== 5 || !dashboard.panels.every((panel: any) => panel.datasource?.uid === "${DS_PROMETHEUS}")) throw new Error("Grafana datasource binding is missing");

const evidence = await mkdtemp(join(tmpdir(), "qiy-prometheus-"));
await Bun.write(join(evidence, "rules.yml"), JSON.stringify({ groups: rule.spec.groups }));
const expected = (name: string, labels: Record<string, string>) => {
  const selected = rule.spec.groups[0].rules.find((item: any) => item.alert === name);
  return { exp_labels: { ...selected.labels, ...labels }, exp_annotations: selected.annotations };
};
await Bun.write(join(evidence, "tests.yml"), JSON.stringify({
  rule_files: ["rules.yml"], evaluation_interval: "1m",
  tests: [
    {
      name: "configured service alerts after their hold intervals", interval: "1m",
      input_series: [
        { series: `qiy_realtime_outbox_health{service="${app}"}`, values: "0+0x15" },
        { series: `qiy_realtime_outbox_dead_lettered{service="${app}"}`, values: "1+0x15" },
      ],
      alert_rule_test: [
        { eval_time: "0m", alertname: "QiyRealtimeOutboxDegraded", exp_alerts: [] },
        { eval_time: "6m", alertname: "QiyRealtimeOutboxDegraded", exp_alerts: [expected("QiyRealtimeOutboxDegraded", { service: app })] },
        { eval_time: "2m", alertname: "QiyRealtimeDeadLetters", exp_alerts: [expected("QiyRealtimeDeadLetters", { service: app })] },
        { eval_time: "11m", alertname: "QiyRealtimeMetricsAbsent", exp_alerts: [] },
      ],
    },
    {
      name: "other services cannot trigger this application's unhealthy alerts", interval: "1m",
      input_series: [
        { series: `qiy_realtime_outbox_health{service="${app}"}`, values: "1+0x15" },
        { series: 'qiy_realtime_outbox_health{service="other"}', values: "0+0x15" },
        { series: 'qiy_realtime_outbox_dead_lettered{service="other"}', values: "10+0x15" },
      ],
      alert_rule_test: ["QiyRealtimeOutboxDegraded", "QiyRealtimeDeadLetters", "QiyRealtimeMetricsAbsent"].map((alertname) => ({ eval_time: "11m", alertname, exp_alerts: [] })),
    },
    {
      name: "missing metrics alert after ten minutes", interval: "1m", input_series: [],
      alert_rule_test: [
        { eval_time: "9m", alertname: "QiyRealtimeMetricsAbsent", exp_alerts: [] },
        { eval_time: "11m", alertname: "QiyRealtimeMetricsAbsent", exp_alerts: [expected("QiyRealtimeMetricsAbsent", { service: app })] },
      ],
    },
  ],
}));
for (const args of [["check", "rules", "/evidence/rules.yml"], ["test", "rules", "/evidence/tests.yml"]]) {
  const result = Bun.spawnSync(["docker", "run", "--rm", "--mount", `type=bind,source=${evidence},target=/evidence,readonly`, "--workdir", "/evidence", "--entrypoint", "/bin/promtool", "prom/prometheus:v3.5.0", ...args]);
  const output = result.stdout.toString() + result.stderr.toString();
  console.log(output);
  await Bun.write(join(evidence, `${args[0]}.log`), output);
  if (result.exitCode !== 0) throw new Error(`promtool ${args[0]} failed; evidence: ${evidence}`);
}
console.log(`Monitoring manifests and rule behavior verified; evidence: ${evidence}`);
