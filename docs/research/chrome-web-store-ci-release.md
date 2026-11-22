# Chrome Web Store 自动发布调研

核验日期：2026-11-22。仅调研官方文档；未配置 Google Cloud、GitHub Secrets 或发布流水线，未调用商店写入 API。

## 结论

支持自动上传、提审、查询状态，以及审核通过后自动上线。应使用 **Chrome Web Store API V2**；官方此前宣布 V1 计划于 2026-10-15 停止支持，不应新接入 V1。API 不能创建新商店条目，首次上传和商店资料仍需在控制台完成。[API 概览](https://developer.chrome.com/docs/webstore/api)、[V2 公告](https://developer.chrome.com/blog/cws-api-v2)

当前项目上下文：0.3.3 已人工创建并提审；现有 CI 完成检查、测试、浏览器测试、打包及 artifact 保存，尚未接入商店发布。包路径为 `dist/switch-tab-${version}.zip`。这些来自本次主任务检查，未在本调研中重新访问后台验证。

## 自动化流程与状态

| 步骤 | V2 请求 | 注意事项与来源 |
| --- | --- | --- |
| 上传 ZIP | `POST /upload/v2/publishers/{publisherId}/items/{itemId}:upload` | 请求体直接传 ZIP；递增 manifest version；若返回 `IN_PROGRESS`，先轮询上传状态。[使用指南](https://developer.chrome.com/docs/webstore/using-api) |
| 查询 | `GET /v2/publishers/{publisherId}/items/{itemId}:fetchStatus` | 分别检查 submitted 和 published revision；`distributionChannels[].crxVersion` 可核对目标版本。异步上传状态字段只覆盖过去 24 小时的异步上传。[fetchStatus](https://developer.chrome.com/docs/webstore/api/reference/rest/v2/publishers.items/fetchStatus) |
| 提审并自动上线 | `POST /v2/publishers/{publisherId}/items/{itemId}:publish` | `publishType: DEFAULT_PUBLISH`，审核通过即发布。[publish](https://developer.chrome.com/docs/webstore/api/reference/rest/v2/publishers.items/publish) |
| 提审后暂存 | 同一 `publish` 请求，`publishType: STAGED_PUBLISH` | 审核通过进入 `STAGED`；随后再调用 `publish` 发布已批准版本，无需为该暂存版本重复审核。[publish](https://developer.chrome.com/docs/webstore/api/reference/rest/v2/publishers.items/publish) |

成功上传或收到提审响应均不等于上线。应区分 `PENDING_REVIEW`、`STAGED`、`PUBLISHED`、`PUBLISHED_TO_TESTERS`、`REJECTED`、`CANCELLED`；正式上线验收应核对 published revision 的状态与目标版本。[ItemState](https://developer.chrome.com/docs/webstore/api/reference/rest/v2/ItemState)、[fetchStatus](https://developer.chrome.com/docs/webstore/api/reference/rest/v2/publishers.items/fetchStatus)

审核通常几天，也可能几周；新版本仍受审核。`skipReview` 不是绕过审核的开关，只有服务器判定符合条件才接受。建议默认不启用，并设 `blockOnWarnings: true`，遇到校验警告先处理。[审核流程](https://developer.chrome.com/docs/webstore/review-process)、[publish](https://developer.chrome.com/docs/webstore/api/reference/rest/v2/publishers.items/publish)

## 认证选择

**优先服务账号。** 官方明确支持 V2 服务账号用于 CI/CD：在 Cloud 项目启用 Chrome Web Store API，创建服务账号，再把其邮箱添加到开发者控制台 Account。当前每个 publisher 仅能关联一个服务账号；该授权覆盖此 publisher 的条目，不应假设仅限本扩展。官方给出服务账号 impersonation 和 JSON key/JWT 两条取令牌路线。[服务账号指南](https://developer.chrome.com/docs/webstore/service-accounts)

写入请求需要 OAuth scope `https://www.googleapis.com/auth/chromewebstore`；只读状态查询也接受 `chromewebstore.readonly`。不要用 API key 替代 OAuth access token。[认证说明](https://developer.chrome.com/docs/webstore/using-api)

**GitHub OIDC → WIF → 服务账号 → OAuth access token 是推荐待验证方案。** Google 维护的 auth Action 支持 `service_account`、`token_format: access_token` 和自定义 `access_token_scopes`；后者必须显式设为上述 CWS scope，不能沿用默认 `cloud-platform`。WIF 主体需目标服务账号上的 `roles/iam.workloadIdentityUser`，workflow 需 `id-token: write`，并限制 provider 的仓库/分支信任条件。[Google auth Action](https://github.com/google-github-actions/auth)

此建议由“CWS 接受服务账号令牌”和“Action 能为服务账号签发自定义 scope 令牌”组合推导，**尚未在本账号做端到端验证**；不能把 GitHub ID token、直接 WIF token 当作 CWS access token。落地时先用生成的 `access_token` 调用 `fetchStatus` 验证身份和条目权限，再启用上传。无需为了这一方案默认配置 domain-wide delegation。[服务账号指南](https://developer.chrome.com/docs/webstore/service-accounts)、[Google auth Action](https://github.com/google-github-actions/auth)

**备选为用户 OAuth refresh token。** 官方教程支持用条目所属开发者账号授权，保存 client ID、client secret、refresh token，再换取短期 access token。External + Testing 的 OAuth 应用所获 refresh token 通常 7 天过期，CWS scope 不属于基本个人资料例外；长期流水线不能忽略此限制。未获 OAuth 应用 verified 标记本身不阻止 CWS API 使用。[使用指南](https://developer.chrome.com/docs/webstore/using-api)、[令牌失效规则](https://developers.google.com/identity/protocols/oauth2#expiration)、[客户端验证](https://developer.chrome.com/docs/webstore/api)

## 本项目建议与配置前提

以下为工程建议，尚未实施：

1. 保留现有 CI；仅 release tag 或手动触发发布，消费同一已测试 ZIP，核对 tag 与 manifest version，并按扩展 ID 串行发布。
2. 默认选 `DEFAULT_PUBLISH` 满足“审核后自动上线”；需要控制正式上线时间时选择 `STAGED_PUBLISH`，增加独立的发布步骤。
3. 上传完成后提交审核即可结束该次上传任务，报告“已提审”；用独立状态查询任务跟踪审核，避免 runner 连续等待数天。遇到拒绝或已有待审版本时停止并报告，不自动取消当前提审。
4. 准备 Cloud project、已启用 API、关联服务账号、WIF provider 和 IAM 绑定；先通过只读探测。若采用 JSON key 或 refresh token，放 GitHub Secrets，不写入仓库、ZIP 或日志。
5. 设置 `CWS_PUBLISHER_ID=fadc2a12-9639-4045-b944-d48a8cb0e1e4`、`CWS_ITEM_ID=ideonahdmjchdogccohkedlkiakfdgbg`；执行前在对应 publisher 控制台复核。另设置 project ID、service account email、完整 WIF provider resource name。

账号发布/更新需开启两步验证；商店 Listing 和 Privacy 内容需已填写。API 沿用现有可见性，若在后台修改可见性，须先用新可见性手动发布一次，之后才可继续 API 发布。[官方前提与限制](https://developer.chrome.com/docs/webstore/using-api)

本次未验证：Cloud/API 是否已启用、服务账号是否已绑定、WIF 信任配置、实际 API 权限、审核结果及正式商店可安装状态。
