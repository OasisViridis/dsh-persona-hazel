# dsh-persona-hazel

灰泽满（Hazel）人格**全局注入插件**：注册 `hazel:soul` 系统提示词区段，所有会话生效，不依赖 agent preset。

- 区段名刻意**不含 "persona"**：router-flash（网页端默认预设）的 `applyPersona` 会过滤名字匹配 `/persona/i` 的区段（`soul:persona` 因此失效），`hazel:soul` 绕过该过滤。
- 人格文本打包在 `persona.txt`（同源于 HazePersona/persona/soul-card.md，由仓库根部 `deploy.ps1` 同步），fs.watch 热重载。
- 全部配置字段可选（order / complete / fallback / watch / debounceMs），缺失不炸插件树。

## 安装

```powershell
# 仓库根目录执行；默认桌面端 desktop profile，web profile 用 -Profile web
.\deploy.ps1
.\deploy.ps1 -Verify   # 只校验接线
```

`deploy.ps1` 在目标 profile（`$DSH_HOME\profiles\<profile>`）里幂等维护三处：

1. `package.json` 的 `"dsh-persona-hazel": "link:<仓库路径>/plugin/dsh-persona-hazel"`；
2. `node_modules\dsh-persona-hazel` 链接（缺则建 junction；桌面端 pnpm 已建软链时不改动）；
3. `cordis.patch.yml` 的 `persona-hazel` insert 行。

> 桌面端（DSH 0.2.x）由 Electron 独占管理 `profiles/desktop`，`dsh plugin --profile desktop ...` 会被拒绝，
> 因此本地开发插件只能这样接线；本插件是普通插件，**不要**写进 `dsh.profile.bundles`。

新增插件后需**完整重启 DSH**（桌面端：托盘退出后重新打开；网页端：杀 dsh web 进程 → 弹窗点"重新启动"）。

## 卸载

1. 删 `$DSH_HOME\profiles\<profile>\cordis.patch.yml` 的 `persona-hazel` insert 行
2. 删同目录 `package.json` 的 `dsh-persona-hazel` link 条目
3. 删 `node_modules\dsh-persona-hazel`（junction：`cmd /c rmdir "<profile>\node_modules\dsh-persona-hazel"`，不要用 `Remove-Item -Recurse`）

改完完整重启 DSH 生效。
