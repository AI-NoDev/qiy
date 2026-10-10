# Android 国内应用商店分发

Qiy 的 Android 分发 CLI 位于 `deploy/index.ts`。它从一个受版本控制的安全配置读取应用元数据，再从环境变量读取访问密钥；配置文件中不应出现真实密码、Token、私钥或 Client Secret。

## 配置

从 `deploy/config.ts` 开始填写应用信息、各商店 `appId`、上架文案、隐私政策、图标和截图。所有敏感值只能写成 `env:变量名`：

```ts
huawei: {
  enabled: true,
  appId: "123456789",
  clientId: "env:QIY_HUAWEI_CLIENT_ID",
  clientSecret: "env:QIY_HUAWEI_CLIENT_SECRET",
  portalUrl: "https://developer.huawei.com/consumer/cn/service/josp/agc/index.html",
}
```

发布环境再提供真实值：

```powershell
$env:QIY_HUAWEI_CLIENT_ID = "..."
$env:QIY_HUAWEI_CLIENT_SECRET = "..."
```

本地覆盖可写入未提交的 `deploy/config.local.ts`，并用 `--config deploy/config.local.ts` 指定；该文件已被 Git 忽略。

## 选择发布目标

默认命令是安全的 dry-run。它会校验 APK/AAB、目标是否启用、下载 URL 和必要的发布字段，但不读取或输出密钥、更不会调用商店接口：

```powershell
# 选择一个或多个平台
bun run deploy -- --platform huawei,xiaomi --artifact build/app-release.apk --download-url "https://downloads.example.com/app-release.apk" --dry-run

# 选择所有平台
bun run deploy -- --all --artifact build/app-release.apk --dry-run
```

确认目标与版本后，显式加 `--confirm` 才会发送网络请求：

```powershell
bun run deploy -- --platform huawei,xiaomi --artifact build/app-release.apk --download-url "https://downloads.example.com/app-release.apk" --confirm
```

`--download-url` 是 Huawei 按 URL 提交模式所需的 HTTPS 可访问 APK/AAB 地址。可用对象存储、CI artifact relay 或签名的短期下载 URL 提供；不要把永久访问凭证拼进 URL。

## 平台适配器

| 平台 | 适配器 | 当前自动化路径 | 必填身份字段 |
| --- | --- | --- | --- |
| 华为 AppGallery Connect | `deploy/platforms/huawei.ts` | 官方按 URL 提交 API | `appId`、Client ID、Client Secret |
| 小米应用商店 | `deploy/platforms/xiaomi.ts` | 官方自动发布 API | 用户名、受加密凭据、平台公钥 |
| OPPO 软件商店 | `deploy/platforms/oppo.ts` | 每个平台独立 relay | App ID、App Key、App Secret |
| vivo 应用商店 | `deploy/platforms/vivo.ts` | 每个平台独立 relay | App ID、App Key、App Secret |
| 腾讯应用宝 | `deploy/platforms/tencent.ts` | 每个平台独立 relay | App ID、App Key、App Secret |
| 荣耀应用市场 | `deploy/platforms/honor.ts` | 每个平台独立 relay | App ID、Client ID、Client Secret |

OPPO、vivo、应用宝、荣耀的自动发布能力可能受开发者主体、合作伙伴等级、审核流程和专用 API 合同影响。为避免把未经验证的 endpoint 或签名算法硬编码进生成器，适配器默认 fail-closed：没有 `relay` 时只生成审核计划；配置受控 `relay.endpoint` 与 `relay.token` 后才会自动向企业发布中继提交元数据。中继负责保存各平台的正式合同、上传协议与审计记录。

## 发布治理

- 先执行 dry-run，再用 `--confirm`；
- 每个平台独立启用，避免 `--all` 意外把未准备的渠道投放；
- 保留商店审核状态、提交 reference 与 APK/AAB 的 SHA-256 在 CI release 记录中；
- 仅把环境变量注入 CI secret store，轮换密钥时不修改 Git 历史；
- 若需要真实账号/验证码用于审核，使用临时审计账号并在发布后轮换。
