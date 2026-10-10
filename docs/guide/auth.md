# 认证与权限

## 声明身份来源

```ts
auth { provider oidc; user users; subjectField externalSubject; roleField role; }
```

| 字段 | 说明 |
| --- | --- |
| `provider` | `oidc`、`oauth2` 或 `sso` |
| `user` | 用户实体名，必须存在 |
| `subjectField` | 外部身份 ID 映射到的字段，通常对应 `sub` |
| `roleField` | 角色字段，通常引用枚举 |

## 用户模型

```ts
enum userRole {
  value admin label "管理员" color red icon SafetyOutlined;
  value operator label "运营" color blue icon UserOutlined;
  value viewer label "只读" color default icon EyeOutlined;
}

entity users table users @label("用户") @icon(SafetyOutlined) {
  field id UUID @id;
  field email Text @unique;
  field displayName Text;
  field externalSubject Text @unique @listVisible(false) @showVisible(false);
  field role userRole @label("角色") @filterable(true);
  index users_email_idx btree(email) @unique;
}
```

`externalSubject` 通常不出现在列表和详情中，只用于登录时匹配身份。

## 生成结果

- server：OIDC discovery、JWKS 签名校验、issuer 与 audience 校验、角色守卫；
- web：Refine `AuthProvider` 与 `AccessControlProvider`；
- 路由：`login` 页面与认证回调。

生产请求必须携带通过验证的 Bearer JWT。未设置 `QIY_DEV_MODE=1` 时 API 拒绝启动，避免无认证的服务意外上线。

:::warning 当前限制

真实 IdP（Auth0、Keycloak、Okta 等）尚未完成端到端验收，V0 使用外部身份映射加本地用户表。

:::
