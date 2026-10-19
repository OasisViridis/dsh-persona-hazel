# TheMasterplan Agent Workflow

> 本文件是本仓库唯一入口:定义加载顺序与分域权威,不复制规则正文。
> TheMasterplan 规则由下方管理区块声明(apply/update 维护),区块外为
> 本项目专属内容,TheMasterplan 不会覆盖。

<!-- THEMASTERPLAN:BEGIN MANAGED -->
<!-- 本区块由 TheMasterplan（/TheMasterplan）管理（managed-block）。
     区块外内容属于项目，TheMasterplan 不会覆盖；项目事实请维护在区块外。 -->

# TheMasterplan

> 本文件是本仓库唯一入口：定义加载顺序与分域权威，不复制规则正文。
> 规则分布：
> - 治理所有权预检、任务、验证与交接：`core/workflow.md`
> - 权限与发布：`core/policy.md`
> - Git / jj 执行命令：`profiles/`
> - 普通 Harness 薄边界：`adapters/generic.md`
> 各层通过链接引用，不复制同一规则。

## 治理所有权预检

读取 Core 后先判断是否已有外部交付工作流拥有当前任务生命周期。若是，报告
`TheMasterplan: ABSTAINED — external delivery workflow owns this task.` 并停止
TheMasterplan；不运行更新检测，不修改外部工作流状态。

## 权威顺序

1. 系统安全、法律与平台权限
2. 项目安全、隐私、合规和数据保护要求
3. 受保护分支、发布、部署和破坏性操作限制（授权语义见 `core/policy.md`）
4. 根部 `AGENTS.md` 及其引用的 `core/` 规则
5. 当前 Issue 或明确人类授权
6. 项目架构、测试和交付资料
7. README、CONTRIBUTING 和其他辅助材料

## 加载顺序

1. 根部 `AGENTS.md`（本文件）；
2. `core/workflow.md`（先执行 §0 治理所有权预检）；
3. `core/policy.md`；
4. `ACTIVE` 时加载选用的 `profiles/` 与 `adapters/generic.md`；
5. 当前 Issue 或明确人类授权。
<!-- THEMASTERPLAN:END MANAGED -->

## 项目事实

- 项目名：HazePersona
- 项目目标：维护灰泽满（Hazel）人格蒸馏数据（`persona/`）与 DSH 全局注入插件 `dsh-persona-hazel`（区段 `hazel:soul`，绕过 router-flash 预设的 persona 区段过滤）；人格数据源自 MureasAm/Hzm-AI-Bot（MIT）
- 人格注入：`hazel:soul` 静态人设区段 + `hazel:recall` 动态召回/本地时间（`persona/recall/scenes.json` → `scripts/build-recall-data.mjs` → `plugin/dsh-persona-hazel/recall-data.json`）；人格评测 `scripts/persona-eval.mjs`
- 中央 Actions 接口：`OasisViridis/TheMasterplan/.github/workflows/themasterplan-check.yml`（原 `OasisSaber` 账号已重名为 `OasisViridis`；重命名后旧 owner 的 reusable workflow 引用无法解析，必须用当前 owner），本仓库通过 `uses ... @v4.0.0` + `policy-ref: v4.0.0` 调用（版本一致性规则，见 `.github/workflows/check.yml`）
- 默认分支：`main`
- 工具基线：Jujutsu `0.43.0`（已验证版本）；Git `2.34.0` 或更高版本
- 平台状态：`VERIFIED`（2026-08-17 真实 Windows + Git Bash / PowerShell 7 环境，采用烟雾测试通过）
- 验证入口：
  ```bash
  bash scripts/check.sh
  ```
  PowerShell 等价委托（`scripts/check.ps1` 只找 Git 自带的 bash 转发 `scripts/check.sh`，不复制规则；需要 Git for Windows 的 bash，Windows PowerShell 5.1 与 `pwsh` 均可）：
  ```powershell
  powershell -NoProfile -File scripts/check.ps1
  ```
- 部署与运行环境：DSH 桌面端（Electron，默认 `~/.dsh/profiles/desktop`，`/api` 端口 19387）为主，旧版网页端 `profiles/web` 兼容；`dsh plugin --profile desktop` 被桌面端拒绝，插件走 profile 文件接线
- 合并方式：只接受人类决定的 Squash Merge
- 部署与人格维护：见 [DSH-WORKSPACE.md](DSH-WORKSPACE.md)（DSH 挂载、deploy.ps1、人设卡修改流程、双注入禁忌）
- Codex 人格部署：codex-keysmith 路线把 `persona/soul-card.md` 部署为 Windows Codex 全局指令（`model_instructions_file`），手册与红线见 [docs/codex-deployment.md](docs/codex-deployment.md)。**状态：2026-10-08 被 keysmith uninstall**，当前 `~/.codex/config.toml` 里没有 `model_instructions_file`；两端是否一致用 `node scripts/cross-surface-check.mjs` 查（`--strict` 时不一致退出码 1）
- 人格质量回归：`node scripts/recall-eval.mjs`（召回标注集，离线、已接入 `check.sh` 第 7 项）与 `node scripts/persona-eval.mjs`（23 场景运行时评测，需 DSH 在 19387 运行；`--baseline` 比对基线、`--save` 存档）
- 数据来源与许可：见 [README.md](README.md) 与 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)

## 任务路径

复杂任务与小型低风险任务的路径、适用范围与授权记录要求见
[core/workflow.md](core/workflow.md) §1。无 Issue 时不得伪造编号；实现需要
扩大范围时必须停止，向人类说明原因并转为 Issue 路径。

## 验证与交付

工作区检查、任务 change 卫生、权威验证、完整 diff 审阅与 Agent 自审要求见
[core/workflow.md](core/workflow.md) §2-§6。每次 push 前必须运行权威验证
入口：

```bash
bash scripts/check.sh
```

PowerShell 等价入口只转发上述权威命令（不维护第二套验证规则；转发需要
Git for Windows 提供的 bash，Windows PowerShell 5.1 与 PowerShell 7 均可）：

```powershell
powershell -NoProfile -File scripts/check.ps1
```

验证失败时必须修正并重跑，不得把失败或未验证状态表述为成功。fetch 后发现
`main`、`main@origin` 或任务 bookmark 冲突时必须停止，不得猜测目标、自动
解决或 push。审查意见只使用三类表述：合并前必须修复、建议本次修复、可以
后续处理。

## 人工批准与聚合授权

人类保留最终决定权，不表示人类必须亲自操作。Agent 不得未经批准执行
merge、release、删除远端数据、破坏性操作或扩大范围；取得人类明确批准后，
Agent 可在批准范围内连续执行，不得把可由自身工具完成的操作转交人类手工
执行。

发布采用单一最终授权门，聚合授权的定义、审核要素、失效条件、部分失败处理
与术语对照见 [core/policy.md](core/policy.md)；jj 下的安全执行方式见
[profiles/jj.md](profiles/jj.md)。

Agent 不得把允许 push 或创建 Pull Request 解释为允许 merge 或 release。

## 安全与卫生

- 不提交密钥、访问令牌或明显的私人数据。
- 不提交本机绝对路径、缓存、临时文件或无关生成物（node_modules、`.jj`、`.themasterplan/cache/` 等）。
- `main` 只接受经 Pull Request 的人类决定 Squash Merge。
- 发现当前操作违反已记录规则、权限或范围时，必须在产生外部影响前停止并请求人类修正或明确授权。
