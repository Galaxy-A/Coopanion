<!-- Owner: scripts/Start-Companion.ps1, integration/install-world.mjs, figures/destiny-ghost/figure.js, console/features/connections/index.ts, app/data-move.cjs, scripts/Sync-GhostCompanionRuntime.ps1, scripts/Data-Location.ps1, scripts/Manage-Data.ps1, scripts/build-console.mjs, core/guide.ts, packages/cortico-world-codex-activity/src/world.ts, packages/cortico-world-codex-activity/web/view.js, packages/cortico-world-desktop-pet/host/electron-main.cjs. -->
# GhostCompanion

GhostCompanion 是基于 [Pal AI Lab / Coopanion](https://github.com/Pal-AI-Lab/Coopanion)
的**非官方定制 fork**，保留上游提交历史，并加入 Codex 活动显示和机灵形象适配。

## 上游来源与定制范围

- 上游项目：由 Pal AI Lab（Pal-AI-Lab）开发维护的
  [Coopanion](https://github.com/Pal-AI-Lab/Coopanion)，本项目固定基于
  [v0.2.19](https://github.com/Pal-AI-Lab/Coopanion/tree/v0.2.19) 官方便携发行版，
  通过本地适配补丁运行。
- 上游功能：桌宠窗口、聊天与聊天记录、模型服务、自定义动作及设置等沿用
  Coopanion 实现，相关代码与贡献归原作者和贡献者。
- 本地定制：Codex 只读对话桥接、活动通知与状态动画、机灵形象适配，以及
  独立的数据目录、启动和模型配置脚本。
- 许可与素材：保留上游 `LICENSE` 和许可声明；角色素材的来源及权利说明
  另见本文末尾与 `licenses/`。

本仓库 fork 自 `Pal-AI-Lab/Coopanion`。定制启动入口仍采用官方便携版加本地补丁，
上游源码与提交历史一并保留，便于后续对照和升级。

## 启动

公开仓库不附带私人本地使用的机灵像素图集。使用机灵形象前，请自行准备有权使用、
符合图集格式的资源，分别放在：

```text
figures/destiny-ghost/spritesheet.png
codex/destiny-ghost/spritesheet.png
```

图集格式为 1536×2288 像素、8 列 11 行、每格 192×208 像素。
上述两条路径已加入 Git 忽略规则；素材来源与使用范围见 `licenses/ghost-assets-sources.md`。
本机图集独立于仓库源码管理。

双击 `Start-GhostCompanion.cmd`。

机灵显示在桌面上。双击机灵打开输入气泡，再点“在对话页继续编辑”
可展开完整聊天窗口；
托盘菜单可打开设置、显示或隐藏宠物、退出程序。
运行时的窗口标题保留上游名称 `Coopanion`。

## 模型供应商

首次使用可直接从托盘打开设置，在「开始 → 连接模型」或普通模式的
「模型供应商 → 供应商池」添加连接。两个入口使用同一份供应商池，
显示已保存的连接、当前模型和运行状态。

「添加供应商」支持服务预设和自定义服务，API 协议可选 OpenAI Responses、
Chat Completions、Anthropic Messages 和 Gemini。粘贴完整请求地址时，
会按所选协议移除 `/responses`、`/chat/completions`、`/v1/messages` 或 Gemini
请求尾路径，并显示最终请求地址。点击「获取模型」后可搜索并选择模型，
也可以直接填写模型 ID。

「保存」只写入连接配置。「保存并使用」会保存并启用连接，池中的
「使用并开始」会切换到该连接并继续运行；「测试连接」单独检查连通性。
编辑连接时，API Key 留空会保留已保存的密钥；更改地址或协议后必须重新填写
密钥，或选择「无需密钥」。温度与计价在编辑窗口的「更多配置」中。
高级模式可在同一供应商池中添加和编辑第三方供应商模块，包括模块协议配置。

应用页面保存的 API Key 由 Cortico 写入数据目录的
`home\providers\<供应商名称>\.env`，其中的值为明文。命令行备选入口
`Configure-Model.cmd` 需要先从托盘退出应用，配置完成后再启动；它的密钥通过
Windows 当前用户 DPAPI 加密保存，启动时仅传给应用子进程，不写入 `.env`。
两种入口的密钥存储方式各自独立。不要将密钥发到聊天中。
本项目不会读取或复用 Codex 的登录凭证。
命令行的 `-NoApiKey` 仅适用于本机回环地址上的 Responses／Chat 服务；
Anthropic／Gemini 协议仍需密钥。

更新后先从托盘退出应用，再双击 `Start-GhostCompanion.cmd`。启动器会先构建
当前源码的设置窗口，再同步本项目的应用文件、设置窗口和供应商实现。
缺少源码构建依赖时，使用内置 pnpm 按锁文件安装；首次启动需要联网和额外
磁盘空间，无需另行安装 Node 或 pnpm。

## 数据

应用数据默认位于 `%LOCALAPPDATA%\GhostCompanion`。
模型配置、对话历史、工作区记忆和 Chromium 配置均在这一独立目录。
对话历史与记忆功能复用上游实现，不另建一套 SQLite 格式。
原始对话事件为 `home\companion\data\runs\<run-id>\events.jsonl`，
聊天界面可以加载此前运行中的历史。
首次初始化后，启动脚本保留用户已经修改的配置和人设。

也可以在设置窗口的「习惯 → 通用 → 数据存放位置」查看完整路径和所在磁盘。
点击文件夹按钮选择目标目录并确认迁移；应用会先停止 Core，复制并校验完整数据，
然后自动删除旧目录并重新启动。目标目录必须为空或尚不存在。

数据目录可以迁移到其他磁盘。先从托盘退出 Coopanion，再双击
`Manage-GhostCompanionData.cmd`：

```powershell
# 查看当前数据目录和所在磁盘
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Manage-Data.ps1 -Show

# 打开文件夹选择器，复制完整数据并删除旧目录，最后重新启动
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Manage-Data.ps1 -Choose -Restart

# 直接指定新数据目录
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Manage-Data.ps1 -MoveTo D:\GhostCompanionData -Restart
```

迁移包含 `home`、`home\models`、`extensions`、日志、Chromium 配置和桥接状态。
迁移成功并通过完整性检查后，旧数据目录会自动删除；新位置由一个很小的路径记录
保存在 `%LOCALAPPDATA%\GhostCompanion-data-location.json`，下次启动自动使用新盘。
移动硬盘或网络位置未连接时，启动会明确报错，不会静默新建一份 C 盘数据。

迁移会更新数据目录内部的链接和已知 GPT-SoVITS 路径，保留外部链接目标。
如果 Equalizer APO 注册安装在数据目录内，请先卸载并重装到该目录外，
重新配置麦克风发送，再重试迁移。

默认使用中文与机灵人设；称呼用户为“守护者”。
默认关闭语音输入、本地语音模型自动下载、主动漫游和电脑控制，
不自动设为开机启动。模型未配置时，不会伪造 AI 回答。
无有效模型连接时，界面可以保留待发送消息；这不代表消息已经送达模型，
也不等于完成了一轮 AI 对话。

## Codex 活动 World

`cortico-world-codex-activity` 是独立的 World 扩展，World ID 为 `codex-activity`。
首次升级由启动器安装并启用；此后在设置的「我的 World」中启用、停用或重启
「Codex 活动」。停用会停止读取 Codex 记录并移除通知和对应状态；再次启用恢复
读取。停用后可在扩展管理中卸载，后续启动不会自动重新安装。

配置段为 `worlds.codex-activity`，会话目录、读取间隔和最大对话数分别为
`sessionsDir`、`pollMs`、`maxThreads`；保存后重启此 World 生效。
会话目录留空时使用 `CODEX_HOME/sessions`，未设置 `CODEX_HOME` 时使用当前用户的
`.codex/sessions`。指定目录时填写绝对路径。读取间隔默认 400 毫秒，范围为
100–60000 毫秒；最大对话数默认 32，范围为 1–32。包本身默认关闭，由部署启用。
扩展入口和后续开发位置见[扩展说明](packages/cortico-world-codex-activity/README.md)。

「完成后通知 Coopanion」对应 `notifyOnComplete`，默认开启。World 运行期间观察到
Codex 明确完成一轮工作后，会将完成事实和对话标题交给 Coopanion 的正常对话流程。
当前模型按已有的人设组织回应，并使用原有气泡、聊天记录和动作；启用语音扩展时
也沿用其配音流程。没有语音扩展时仍可显示气泡。完成回应需要有效模型连接，并遵循
Core 的暂停状态与 World 可见性。启动前的历史完成、失败和中断不会触发完成回应。

同一只机灵按本机原生宠物的通知结构显示
会话标题和最新公开进度或回复摘要。普通通知宽 330、高 56 CSS 像素，圆角 32，
标题和摘要分别单行截断；短标题搭配长摘要时改为行内组合，最多两行。
较小屏幕下宽度限制在视口内。公开消息到达后更新对应通知，不排队播放。

最多显示 `maxThreads` 条桌面对话，按当前轮开始时间从新到旧排列，时间不可用时回退
到会话活动时间；同轮进度更新不反复抢占首位。通知默认收叠，前三层偏移
0／8／16 像素、比例 1／0.94／0.86；多条时首次点击展开，展开后逐条显示，
间距 8 像素，再点对应通知回到 Codex。单条通知直接打开线程。没有页码、左右
轮播、眼睛按钮或全文阅读面板，也不设置固定 30 秒的完成展示期。

状态使用原生的 running（正在运行）、waiting（需要输入）、review（就绪）、
failed（已拦截）和 idle。等待、就绪、失败的通知资格分别为 24 小时、7 天、
1 小时；运行状态不因静默时间自动改成完成或过期。
逐条关闭使用左上角 20 像素按钮及 12 像素叉号，仅在悬停或键盘聚焦时显示；
也可以左滑通知关闭。关闭按线程和轮次保存，同轮更新不会重现，新轮可以再次
出现，关闭也不会取消任务或标记已读。
机灵角落的 24 像素角标用于整组活动：展开多条时先收叠，已收叠或只有一条时
隐藏整组；隐藏后显示数量，点击可恢复。整组隐藏独立保存，新通知不会擅自恢复，
宠物状态仍跟随首条未关闭通知。角标可拖到四个角落，位置会保存。
Escape 也可收回展开堆叠。聊天使用原有右侧功能入口或双击机灵，不另加重复入口。
需要输入或阻塞时点击通知回到 Codex；只读桥不提供审批、回复或停止任务按钮。

双击机灵和原有聊天窗口仍走 Coopanion 的聊天、聊天记录及模型服务；
自定义动作继续走原有动作链路。Codex 进度和回复摘要以纯文本展示，不作为模型
指令；完成事件进入正常对话流程后，Coopanion 的回应写入原有聊天记录。
Codex 活动面板与 Coopanion 聊天气泡是同一桌宠窗口内的独立显示区域。
原有聊天或输入时，通知收紧为活动条，避免覆盖输入框；拖动、自定义动作、
原有模型思考和语音状态仍优先。Codex 动画跟随首条可见通知：运行用第 7 行扫描、
等待用第 6 行、就绪用第 8 行检查、失败用第 5 行；每个状态连续播放三轮后待机，
同一轮同一状态的更新不会反复重启动画。被原有动作抢占时保存尚未播完的进度，
动作结束后继续剩余轮次；已播完三轮则保持待机。减少动态效果时显示对应动作首帧。
关闭通知后跟随下一条可见通知或待机，源任务仍保持原状态。
使用 Codex 活动显示不需要配置模型服务；聊天和完成回应使用 Coopanion 当前模型。
有外部显示 World 注册时，缺少模型连接不会周期自动弹出配置对话；主动聊天时仍会提示连接模型。

当前适配经过本机核对的 Codex `0.167.x` 桌面会话记录格式。
它只读本用户 Codex sessions 目录及相邻的 session_index.jsonl 标题索引，
筛选桌面来源，读取公开 assistant 消息、必要的轮次事件和当前轮首条用户任务摘要。
任务摘要最多 240 字；带技能、系统或环境封装的上下文整条跳过，不会当作用户任务。
不读取登录凭据或私有数据库，不转发推理、工具参数/结果或压缩内容。
公开消息清理常见 Markdown、控制字符和空白后生成最多 280 字的单行摘要，
不向桌宠发送完整长回复。消息是整条公开消息到达后的更新，不是逐字流。
本地记录不是稳定的官方扩展接口；其他版本会报告不兼容，不能保证覆盖尚未
写入记录的审批/错误状态。等待回应仅在明确的用户输入请求事件出现时展示。
记录静默不推断任务已结束；缺失终态或未落盘错误可能导致显示仍在运行。

原生 review 由 Codex 的 `hasUnreadTurn` 决定，当前允许读取的记录没有该字段。
本项目只把桥接运行期间完成的轮次作为本地待看通知，点击通知打开线程后清除；
启动前的历史完成项不当作新通知。直接在 Codex 中读过对话无法同步清除这一
本地提示，因此未读同步不能声称与原生完全等价。

Codex 原生宠物浮层仍由 Codex 管理。确认桥接正常后，在 Codex 中隐藏原生宠物，
桌面即可只保留这一只机灵；本项目不修改 Codex 私有设置、不卸载原生宠物素材。

也可先从托盘退出，再用兼容启动选项将此 World 设为停用：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Start-Companion.ps1 -NoCodexBridge
```

重新启用请使用「我的 World」中的开关。World 页面显示读取状态、会话目录和
当前对话数；诊断文件通常为应用数据目录中的
`home/companion/data/worlds/codex-activity/status.json`，`paths.data` 配置可更改其中的
World 数据目录。文件只含来源、线程、状态和计数，不保存对话正文。
原 `/api/codex-bridge` 路由已移除。
读取器由 World 生命周期启动，不再通过 `GHOST_CODEX_BRIDGE_MODULE` 环境变量启动。
显示用的回复摘要、任务摘要与标题只发送给带窗口凭据的机灵窗口，不广播给预览页或
本地监听客户端。开启完成回应时，完成事实和标题也会进入 Core 事件记录及当前模型
的上下文。已读记录仅在桌宠自己的本地存储中保存轮次标识和时间，不保存正文。

这仍是独立宿主对原生行为的适配，不是 Codex 原生 UI 扩展。当前记录没有覆盖的
审批内容、实时错误及逐字流式进度无法凭空恢复；需要回到 Codex 操作。
界面检查、源码审查与实际点击验收分别记录，不能用其中一项替代另外两项。

## 动作与形象包

`figures/destiny-ghost` 是 Coopanion API 2 形象包。
它复用 v9 白壳、红环、青核像素图集和完整侧身扫描动作。
模型可以使用 `scan`、`greet`、`inspect`、`wait`、`error`、`jump` 等动作词。
请求状态与思考状态通过宿主的形象接口切换动画。

`codex/destiny-ghost` 保留原始 `pet.json` 格式；`spritesheet.png` 仅在用户本机提供，
不随公开仓库分发。本地宠物包继续符合现有 Codex 格式，两个运行宿主使用相同图集。
Codex 消息和 Coopanion 聊天共同使用这个桌宠窗口。

## 项目结构

以下为本 fork 新增或定制的部分。Coopanion 上游源码目录继续保留，
上游构建方式见 `docs/DEVELOPMENT.md`。

```text
GhostCompanion/
  Start-GhostCompanion.cmd
  Manage-GhostCompanionData.cmd
  Configure-Model.cmd
  project.json
  scripts/                 数据迁移、运行时同步、下载、初始化、启动和模型配置
  integration/             便携运行时的 World 安装与旧桥接迁移
  packages/cortico-world-codex-activity/  Codex 活动读取、通知、状态和配置
  config/                  首次启动模板与机灵人设
  figures/destiny-ghost/   Coopanion 形象适配
  codex/destiny-ghost/     原格式 Codex 宠物包
  licenses/               素材来源
  runtime/                官方便携运行时，Git 忽略
  downloads/              固定版本下载缓存，Git 忽略
  artifacts/              本机验收记录，Git 忽略
```

## 运行底座

固定使用 Coopanion `v0.2.19` Windows x64 portable。
下载脚本核对 GitHub Release 公布的 SHA-256 后才解压。
启动器同步项目中的桌宠显示接口和 Codex 活动扩展，并把扩展登记到当前数据目录。
旧桥接迁移和运行时文件的恢复副本保存在 `resources/app/.ghost-bridge-originals`；
检测到未知运行时修改时停止安装并保留现场。Codex 特定读取和显示逻辑保存在
`packages/cortico-world-codex-activity/`，由 World 生命周期管理。
不安装为系统服务，不下载本地推理模型。
便携运行时包含 Electron，下载文件约 230 MB；像素素材轻量不代表
Electron 运行时本身体积很小，实际内存占用应以本机运行结果为准。

源码与发行版本：
https://github.com/Pal-AI-Lab/Coopanion/tree/v0.2.19

AGPL-3.0-or-later 许可见 `LICENSE`。
通知状态使用的 Lucide TriangleAlert 与 CircleCheck 图标许可见 `licenses/lucide-icons.txt`。
机灵图像、原始像素参考和 Destiny 角色的权利独立于代码许可，
来源保留在 `licenses/ghost-assets-sources.md`。

## 本机诊断

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Start-Companion.ps1
```

开发验收可以指定隔离的数据目录及本地调试端口：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Start-Companion.ps1 -DataDir .\artifacts\qa-profile -Inspect
```

正常启动不开放调试端口。尚未填入有效模型服务时，只能验收界面、
素材加载、动作播放和缺少配置的反馈，不能据此宣称远端模型调用成功。
`-Inspect -InspectPort 19331` 为主窗口使用 19331，机灵窗口使用 19332，
均只绑定本机。验收模式下机灵暂时显示在任务栏，方便原生窗口检查；
正常启动恢复透明工具窗口。
