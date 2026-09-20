# New API 来源基线记录

> 状态：基线已冻结。用于记录独立运营平台提取 New API 组件时使用的来源、提交和工作区状态。每次提取都必须补充目标提交和文件清单。

## 来源仓库

| 项目 | 值 |
| --- | --- |
| 本地路径 | `D:\Desktop\object\newapi` |
| 当前分支 | `feature/promotion-system` |
| 基线提交 | `b64d461d795fcca8923377a3727fe105b9f2cdb5` |
| 基线短提交 | `b64d461d` |
| GitHub 只读参考 | `https://github.com/sucheng1101/new-api.git` |
| 许可证 | AGPL-3.0，见来源仓库 `LICENSE` |

## 基线工作区状态

基线提交之外存在以下未提交改动，提取时保留原工作区，不执行覆盖：

```text
controller/relay.go
model/task.go
model/wallet.go
model/wallet_test.go
service/billing_session.go
service/funding_source.go
service/task_billing.go
service/task_billing_test.go
service/funding_source_wallet_test.go（未跟踪）
```

这些改动属于来源仓库当前工作状态的一部分。M0 阶段只读取并记录，不对来源仓库执行重置、清理或提交；提取时应明确选择“基线提交内容”还是“工作区内容”，默认使用基线提交内容。

## 许可证与网络交互源码

- 目标项目保留 AGPL-3.0 许可证文本、来源归属和提取记录。
- 对外提供网络服务时，发布版本必须提供对应修改后的完整源代码或书面承诺的获取方式。
- 每个提取组件记录来源提交、来源文件、依赖闭包、目标文件和目标提交。
- 不复制 New API 原管理前端；管理端重新使用当前项目 React + Ant Design 实现。

## M0 冻结清单

- [x] 来源仓库路径已记录。
- [x] 基线提交已记录。
- [x] 当前来源工作区未提交文件已按本次冻结检查记录；该工作区仍有并行改动，实际提取默认从基线提交读取。
- [x] 许可证文件位置已记录。
- [x] 完成组件到目标阶段的首批映射，详见 `newapi-m0-component-inventory.md`。
- [ ] 完成依赖闭包和许可证扫描。
- [ ] 在无限画布仓库形成首次提取提交后，补充目标提交哈希。
