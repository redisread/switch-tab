# Chrome Web Store 发布

工作流 `.github/workflows/release.yml` 使用 Google Cloud Workload Identity Federation 和服务账号获取短期令牌。

## 使用

合并到 main 后递增 `extension/manifest.json` 和 `package.json` 的版本，创建匹配的 `v<version>` 标签并推送。工作流运行完整 CI，下载该次验证生成的 ZIP，上传并提交审核，通过后自动发布。

也可在 Actions 中手动运行 Chrome Web Store，选择版本标签和 publish。默认 status 只查询已发布与待审版本，可用于身份验证和查看审核进度。提交成功后的输出表示待审核，正式上线以 published revision 为准。

发布提交必须属于 main。已有待审或暂存版本会阻止上传，已发布同版本会跳过，拒审修复后可上传新版本。异步上传超时或 HTTP 错误后先查询状态，再决定重跑。API 校验警告会停止提审，可在后台检查并完成提审。

## 仓库变量

- `CWS_PUBLISHER_ID`
- `CWS_ITEM_ID`
- `GCP_WORKLOAD_IDENTITY_PROVIDER`，完整的 projects/编号/locations/global/workloadIdentityPools/池/providers/提供方
- `GCP_SERVICE_ACCOUNT`，服务账号邮箱

Cloud 项目需要启用 Chrome Web Store API、IAM Credentials API、STS API。服务账号须在商店开发者后台关联。WIF provider 限制 GitHub 仓库数字 ID `1457530980` 和 owner ID `60874660`，限制 main 或版本标签，并限制 release.yml 工作流；目标服务账号只授予匹配仓库主体 `roles/iam.workloadIdentityUser`。请求令牌使用 chromewebstore scope。

本 PR 基于扩展实现分支。先将扩展实现合并 main，再将发布改动合并 main，才能使用手动触发及标签发布。
