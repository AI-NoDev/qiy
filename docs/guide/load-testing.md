# 负载测试

Qiy 自带一个无外部依赖的 HTTP 负载工具，用于验证生成应用的延迟、错误率和吞吐。它支持固定请求数或固定时长、预热、阈值门禁，以及把多台压测机的报告合并成一份；不替代 k6/Artillery 等带场景编排的专业压测。

## 运行

先启动应用：

```bash
bun run dev
```

再执行：

```bash
bun run load:test --url http://127.0.0.1:3000/api/v1/health --requests 200 --concurrency 20
```

按时长压测数据库读路径，并设置门禁：

```bash
bun run load:test \
  --url "http://127.0.0.1:3000/api/v1/products?page=1&pageSize=10" \
  --duration 30 --warmup 50 --concurrency 50 \
  --p95 500 --p99 1000 --max-error-rate 0.001 --min-rps 200
```

带认证的端点：

```bash
bun run load:test \
  --url http://127.0.0.1:3000/api/v1/products \
  --requests 200 --concurrency 10 \
  --header "Authorization: Bearer $TOKEN"
```

## 参数

| 参数 | 说明 |
| --- | --- |
| `--url` | HTTP/HTTPS 目标（除 `--merge` 外必填） |
| `--requests` | 总请求数，默认 100 |
| `--duration` | 按秒持续发送，覆盖 `--requests` |
| `--warmup` | 预热请求数，不计入报告，默认 0 |
| `--concurrency` | 并发 worker，默认 10 |
| `--timeout` | 单请求超时毫秒，默认 10000 |
| `--method` | GET/POST/PUT/PATCH/DELETE |
| `--header` | 请求头，可重复 |
| `--body` | 请求体 |
| `--out` | 写出带原始延迟样本的 JSON 报告，供 `--merge` 使用 |
| `--merge` | 合并多份 `--out` 报告 |
| `--json` | 只输出 JSON 报告（不含样本） |

阈值（任一不满足时退出码 1）：

| 参数 | 说明 |
| --- | --- |
| `--p95` / `--p99` | 延迟上限（毫秒） |
| `--max-error-rate` | 允许的失败比例 0..1，默认 0（任一失败即失败） |
| `--min-rps` | 吞吐下限（req/s） |

## 报告

```text
Load test: 7011 requests, 700.4 req/s
  success=7011 failed=0 errorRate=0.00% duration=10011ms
  latency ms: p50=27.3 p90=40.9 p95=45.6 p99=58.9 max=74.1
  statuses: 200=7011
```

- HTTP `4xx/5xx` 计为失败，网络错误也会计数并输出最多 10 条；
- 违反的每个阈值都会单独打印到 stderr。

## 多机压测

单台压测机的 CPU、网卡和事件循环会先于被测服务饱和。要压到更高并发，在多台机器上**同时**运行，并各自写出报告：

```bash
# 机器 A、B、C 同时执行
bun run load:test --url https://staging.example.com/api/v1/products --duration 60 --concurrency 100 --out report-a.json
```

收集报告后合并：

```bash
bun run load:test --merge report-a.json report-b.json report-c.json --p99 1000 --min-rps 3000
```

合并规则：请求数、状态码和样本相加；吞吐是各压测机吞吐之和；时长取最长一份；p50/p90/p95/p99 由合并后的**原始样本**重新计算，而不是对百分位求平均。阈值参数同样作用于合并结果。

## 参考容量

下表是本地开发机（Windows 11、Bun 1.3.13、SQLite、`bun run dev:server`，压测机与服务同机）对 E2E fixture 应用的实测，用来说明量级，不是生产承诺：

| 端点 | 并发 | 时长 | 吞吐 | p95 | p99 | 错误 |
| --- | --- | --- | --- | --- | --- | --- |
| `GET /api/v1/health` | 50 | 10s | ≈22,000 req/s | 4.1ms | 7.3ms | 0 |
| `GET /api/v1/products?page=1&pageSize=10` | 20 | 10s | ≈700 req/s | 45.6ms | 58.9ms | 0 |

生产容量取决于数据库（PostgreSQL/MySQL 连接池与索引）、行策略与数据范围的子查询、网关限流和副本数，必须在独立的预发环境用真实数据量复测；不要对生产直接压测。

## CI 门禁

仓库 CI 的 `generated-e2e` 作业在生成应用 E2E 后启动 API，执行两道门禁：

```bash
bun run load:test --url http://localhost:3000/api/v1/health --requests 100 --concurrency 10 --p95 1000
bun run load:test --url "http://localhost:3000/api/v1/products?page=1&pageSize=10" \
  --duration 10 --warmup 20 --concurrency 20 --p95 1000 --p99 2000 --min-rps 20
```

CI runner 的性能波动较大，所以这里的阈值是回归护栏（发现数量级退化），容量结论以上面的多机压测为准。
