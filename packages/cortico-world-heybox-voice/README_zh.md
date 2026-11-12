<!-- Owner: src/definition.ts, src/world.ts, src/model-text.ts, src/ENV_PROMPT.md, src/setup.ts, src/microphone-setup.ts, src/microphone.ts, src/receive.ts, src/capture.ts, src/tts.ts, src/audio.ts, native/setup.ps1, native/microphone-setup.ps1, native/microphone-plugin.cpp, native/build-microphone.ps1, native/capture.cs, web/panel.js -->

# 黑盒语音 World

`heybox` World 单独采集黑盒进程及其子进程播放的音频，在本机识别后，通过 `heybox.speech` 交给 Core。回复通过现有 GPT-SoVITS HTTP 接口合成，可由免费 Equalizer APO 组件混入现有麦克风，也可使用明确选择的输出设备连接虚拟线路。黑盒扬声器可以继续使用原来的耳机或音箱。

Core 的房间回复使用 `heybox_say`，一次完成 GPT-SoVITS 合成和黑盒送音；本地桌面对话继续使用 `sovits_speak`。开启桥接不会把本地对话全部广播到房间。是否回应由 Core 结合房间上下文和称呼线索判断。

需要 Windows build 20348 或更新版本、Node.js 22+、GPT-SoVITS World，以及本仓库提供的 `cortico-world-desktop-pet/asr` 库导出。麦克风插件和引导安装器仅支持 Windows x64。共享库只提供识别组件，不调用或修改 desktop-pet World；产品运行时安装器会同步该导出。旧版 desktop-pet 0.2.0 若没有此导出，需随产品升级后再启用扩展。

在扩展页选择本包的本机目录安装，重启 Core，再启用 `heybox` World。扩展包含自有 x64 麦克风插件 DLL 及源码；C# 辅助程序启动时使用系统 Windows PowerShell 编译，用户不需要安装编译器。不捆绑第三方安装器、驱动、音频或模型权重。

## 首次配置

1. 打开面板，点击「配置黑盒语音」。扩展检查语音服务、Windows 版本、音频设备、识别模型与黑盒进程。新配置会建议使用默认麦克风；已有明确的输出设备配置会保留，切换「当前麦克风（免费组件）」即可更换路线。
2. 选择黑盒正在使用的实体麦克风。尚未安装组件时，点击「安装 Equalizer APO（免费）」。安装文件会下载到当前数据目录；随后由 Equalizer APO 官方安装器让你选择安装位置。扩展不会假定固定路径，安装完成后按 Windows 注册表报告的实际位置读取配置和设备选择器。无需购买 Soundpad 或另装混音软件。
3. 点击「启用麦克风送音」。管理员确认后，自有插件会安装到受保护目录，并向 Equalizer APO 追加独立 Include，保留其他配置。在官方设备选择器的录音设备中勾选同一个麦克风，按提示重启，并保持 Windows 麦克风音频增强开启。重新打开黑盒语音后，只有插件音频回调实际推进时，面板才显示就绪；一直未检测到处理时，检查设备选择并打开黑盒麦克风测试。黑盒保持使用同一个麦克风。
4. 在 GPT-SoVITS World 开启 HTTP 接口，默认地址为 `http://127.0.0.1:9880`。如果设置了令牌，将相同值保存为部署密钥 `HEYBOX_TTS_TOKEN`。本扩展只接受回环 HTTP(S) 地址，配置令牌后使用 `Authorization: Bearer`。
5. 面板提示缺少识别模型时，点击下载（约 240 MB）。已有 desktop-pet SenseVoice 模型会从共享模型缓存复用，不改变桌宠麦克风和识别配置。
6. 播放一句短句，请房间朋友确认听到，再点击播放按钮旁的「朋友已确认听到」。点击顶部操作栏的「检查接收」，请对方说话，等待其下方接收区域出现转写。接收区域会显示尚未启动或正在等待声音。检查期间的文字只显示在面板，不进入 Core；离开面板会停止检查采集。
7. 收发检查完成后点击「开始桥接」。以后直接点击此按钮即可。确认记录跨应用重启保留，采集每次启动均为停止状态。「停止桥接」释放采集并停止当前和排队语音。更换设备或重启黑盒后重新配置检查；多个黑盒根进程同时运行时需明确选择。

麦克风路线是「GPT-SoVITS HTTP → World 插件＋原麦克风声音 → 黑盒麦克风」。它作用于整个端点，其他同时使用此麦克风的录音应用也可能收到合成声音。建议使用耳机避免声学回授；「按键说话」开启时，发送期间仍需按住黑盒说话键。停止语音或桥接后，麦克风继续正常收音。「移除送音配置」只移除本 World 的 Include 和插件配置，不卸载 Equalizer APO，也不移除其他音效。

### 输出设备兼容路线

选择「虚拟线路 / 输出设备」可保留或使用已有线路。此模式配置时可以选择唯一的 `CABLE Input`；缺少驱动时，点击「下载并安装 VB-CABLE」，从官方下载安装包，校验签名后请求管理员安装。重启 Windows 后，在黑盒选择「CABLE Output (VB-Audio Virtual Cable)」作为麦克风。发送线路是「GPT-SoVITS HTTP → 所选 CABLE Input 播放端点 → CABLE Output 录音端点 → 黑盒麦克风」。此模式只发送合成语音，不混入实体麦克风。安装文件保存在 `<CORTICO_HOME>/drivers/vb-cable`。合成语音可先关闭自动增益、回声消除和降噪，再按实际效果调整。

接收使用 Windows 进程音频采集，包含 `HeyboxChat.exe` 的子进程，不需要虚拟线，也不更改系统默认音频设备。进程或设备缺失、重名时明确拒绝；发送失败不自动切换路线，采集不回退系统混音或默认麦克风。房间发送确认绑定所选线路，更换线路后需重新完成确认。

在接收转写下方的「称呼关键词」填写任意名字或短语，点击「保存关键词」，立即生效并跨应用重启保留。最近转写会显示是否包含已保存关键词，检查接收时也能查看。匹配按文字包含关系判断，忽略大小写与 Unicode 兼容形式差异，去掉关键词首尾空白；留空关闭标记。此配置作用于本 World 的进程音频转写。

## 运行契约

- `heybox_say({"text":"大家好。"})` 在桥接运行时可用，每句 1–2000 字符，最多八句活动或等待语音，整句被麦克风处理流消费或输出设备播放完成后返回。房间收听确认另由操作员记录。
- `heybox_hush({})` 取消 HTTP 等待、停止合成声音并清空队列，不关闭实体麦克风；服务端可能在客户端断连后继续推理。
- `heybox_status({})` 刷新服务、设备和进程，报告采集、识别及配置状态。
- `heybox.speech` 是外部音频识别内容，无法认证说话者身份；可能混合多位参与者、音乐和应用提示音。正文始终以 `[heybox.speech] HeyBox voice room | reply audio: heybox_say` 标明房间来源和回复线路，`Transcript` 后保留原转写，元数据 `transcript` 保留原文。使用 `flush` 投递，不打断 Core。
- 配置 `addressKeyword` 后，来源标记与转写之间附带 `HeyBox address cue` JSON（`keyword`、`matched`）；元数据增加 `addressKeyword` 和 `addressKeywordMatched`。匹配为 Core 提供可能有人在称呼自己的线索，由 Core 判断是否回应；未匹配的话仍会投递。默认留空，不附带称呼线索。

输出使用 WinMM 返回的唯一、精确名称；Windows 可能截断为 31 个 UTF-16 单元。设备重名时先在 Windows 更名再选择。TTS 只接受完整 PCM16 单/双声道 WAV，采样率 8–192 kHz，上限 32 MiB。播放取消等待原生辅助进程退出。识别最多等待四段音频，溢出会显示错误。目标进程退出后停止采集，需要重新开始。

识别使用 16 kHz 单声道 SenseVoice，默认能量门限 −42 dBFS，语言自动检测，可通过配置修改。原始采集音频仅在内存中用于识别，本 World 不保存录音。已有 `receiveViaDesktopPet` 配置保留为旧线路的语义提示；进程采集不会开启或修改该线路。

麦克风插件为自有 VST2-compatible DLL，不捆绑第三方 SDK。音频回调保留输入、混合重采样后的语音并限制混合峰值，命名管道读写在音频线程之外执行；每个活动处理实例各自接收一份语音。IPC 限制为配置用户及音频服务身份。开发者用 `native/build-microphone.ps1` 和自备编译器构建，运行时直接使用随包提供的 DLL。应用绕过 Equalizer APO 或设备不兼容时，需手动选择输出设备路线。
