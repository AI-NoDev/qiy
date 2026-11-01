# 负载测试

Qiy 自带一个无外部依赖的 HTTP 负载冒烟工具，用于验证生成应用的延迟、错误率和吞吐，不替代 k6/Artillery 等专业压测。

## 运行

先启动应用：

```bash
bun run dev
```

再执行：

```bash
bun run load:test --url http://127.0.0.1:3000/api/v1/health --requests 200 --concurrency 20
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
| `--url` | 必填，HTTP/HTTPS 目标 |
| `--requests` | 总请求数，默认 100 |
| `--concurrency` | 并发 worker，默认 10 |
| `--timeout` | 单请求超时毫秒，默认 10000 |
| `--method` | GET/POST/PUT/PATCH/DELETE |
| `--header` | 请求头，可重复 |
| `--body` | 请求体 |
| `--p95` | p95 阈值，超过则退出码 1 |
| `--json` | 只输出 JSON 报告 |

## 报告

```text
Load test: 200 requests, 812.3 req/s
  success=200 failed=0 duration=246ms
  latency ms: p50=18.2 p90=31.0 p95=35.4 p99=48.1 max=52.0
  statuses: 200=200
```

- HTTP `4xx/5xx` 计为失败；
- 网络错误也会计数并输出最多 10 条；
- 任一失败或 p95 超阈值时进程退出码为 1，可直接接入 CI；
- 默认只做单机冒烟，不代表生产容量。

## CI 示例

```bash
bun run dev:server &
bun run load:test --url http://127.0.0.1:3000/api/v1/health --requests 100 --concurrency 10 --p95 500
```

生产压测应在独立环境、真实数据库和网关限流配置下进行；不要对生产直接压测。
