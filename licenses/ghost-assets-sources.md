# 素材来源

## 当前v9外部像素素材

- 作者：`lascap`，页面链接其 Twitter/X `@pixearl1`。
- 作者说明页：[MakeCode forum post](https://forum.makecode.com/t/need-some-help-with-a-game/13172)。
- 原帖：[I did the ghost from destiny](https://www.reddit.com/r/PixelArt/comments/d156u2/i_did_the_ghost_from_destiny_any_criticism_is/)。
- 本地原始文件：`source/reference/pixel-candidates/pixearl-lascap-destiny-ghost.png`，800×600。
- 基础处理：裁出主 Ghost、通过与背景相连的容差 flood-fill 去灰背景，保留原有像素外观。开合版把原素材分为独立核心与四个完整前壳组，借其纹理投影出四个较暗的截角后壳片，按后壳、核心、前壳的顺序合成。壳片边界使用覆盖率采样，完整区域保留最近邻色块。侧身扫描另用前后平面的深度投影与深灰侧壁，原核心纹理投影到球面，原青眼随朝向移到右侧；没有运行时三维渲染。
- 状态：用户选择的 v9 外观已保留，完整扫描与边缘精修已经通过独立实际浏览器自然播放验收，`package` 中的最终两文件已安装。验收与发布图集 SHA256 为 `6f2b739a8d1160514b810e9fbcc973316c681ace232d872cfb1f7e8bbd807e34`，完整性记录为 `preview/qa/hacker/full-scan/observation.json`。旧固定侧身、早期 v9、v8和v6文件保留用于回退。
- 授权：页面和原帖未声明复用许可证；`[CC]` 是 constructive criticism 标签，不是 Creative Commons 许可。本版本仅供私人本地使用，不对外发布或再分发。
- 动作范围：待机六格表现前壳轻开、后壳错角转出和收回，核心青眼独立稳定。完整扫描依次为正面闭合准备、28度转身开壳、60度侧身发束、同体态扫动、关束收壳回转、正面闭合；只有中间两格发束，首末与待机闭合像素相同。其他动作使用原分层结构。16方向为整体方向偏移，并非独立眼球转向。壳体与球核是像素投影近似，不宣称官方壳片的精确三维运动轨迹或持续360°旋转。原生六格计时使每轮为820ms，其中侧扫240ms，属于可见逐格的快速扫描。

## 本轮开合与旋转结构参考

- Bungie 角色前后侧设定图，由 Destinypedia 存档：[Destiny Ghost Character Sheet](https://www.destinypedia.com/File:Destiny_Ghost_Character_Sheet.jpg)；本地 `source/reference/ghost-character-sheet-front-back.jpg`。
- Bungie 壳体展开概念图，由 Destinypedia 存档：[Destiny Concept GhostConstruct](https://www.destinypedia.com/File:Destiny-Concept-GhostConstruct.jpg)；本地 `source/reference/ghost-shell-structure-exploded.jpg`。
- 游戏内展开近照，由 Destinypedia 存档：[Ghost shell open](https://www.destinypedia.com/File:Ghost_shell_open.jpg)；本地 `source/reference/ghost-open-ingame.jpg`。
- 这些图用于理解独立核心、前后壳层和遮挡关系；静图不能单独证明完整运动轨迹。此次动画为保留 v9 外观的近似表现。
- 图生图姿态研究使用内置 imagegen，输出 `source/reference/generated/ghost-v9-shell-motion-reference.png`；完整提示词和用途见同目录 `ghost-v9-shell-motion-reference.prompt.md`。其四组壳片径向展开方式未选作最终运动目标，结构以随后查看的前后侧及展开图为准。

## 专用扫描参考

- Sava Zivkovic / Axis Studios 的《Destiny 2: Forsaken》结尾过场制作展示：[DESTINY 2: FORSAKEN — Epilogue Cinematic](https://www.behance.net/gallery/75495273/DESTINY-2-FORSAKEN-Epilogue-Cinematic)。页面注明该片为 Bungie 制作，作者负责导演与布局。
- 本地制作剧照：`source/reference/scan/forsaken-rebirth-scan-beam.jpg`，可见机灵从眼部向右下目标投出数条细蓝束，形成半透明扫描光面；近景保存在 `source/reference/scan/forsaken-rebirth-ghost-closeup.jpg`。
- 该画面用于确定眼部发射源、定向光束与轻薄扫描面的视觉特征。静态剧照不能单独证明壳片的运动轨迹或扫描周期；宠物中的扫动为受六格图集约束的像素近似。
- 用户进一步选择侧身扫描。侧身结构参考上面的角色侧视设定图与 `forsaken-rebirth-ghost-closeup.jpg`：前后壳有深度错位，球核保留体积，青眼在朝向目标的一侧。像素宠物用分层投影近似这些关系。
- 用户反馈动作不全后，补入准备、转身开壳、关束收壳和回正阶段。新六阶段的编排是为原生图集约束制作的像素动作；准备和回收过程没有新的官方逐帧轨迹证据，不能将它描述为完整复刻游戏动画。旧固定侧身版本仍保留。
- 页面内 Vimeo 视频未能通过当前网络读取，未把该视频当作已经观看的运动证据。
- 游戏内动态参考：[Destiny 2 EDZ Sunken Isles Ghost Scan](https://www.youtube.com/watch?v=VrEqDVfM8nc)，本地 `source/reference/scan-reference-VrEqDVfM8nc.mp4`；2–8秒可见机灵在目标旁扫描，目标表面覆盖蓝色网格全息影像，随后扫描结束。片段 `source/reference/scan-reference-edz-2to9s.mp4` 与联系图 `source/reference/scan-reference-VrEqDVfM8nc-contact.png` 已实际目视。此录屏用于区分目标扫描与巡逻四向绿脉冲，源可用流为480p，机灵在画面里很小，不据此主张每片壳体的精确轨迹。

## 旧v8外部像素素材

- 作者：`big_fat_bear`。
- 原帖：[Ghost Sprite!](https://www.reddit.com/r/destiny2/comments/omc7a3/ghost_sprite/)。
- 本地文件：`source/reference/pixel-candidates/big-fat-bear-destiny-ghost-sprite.gif`。文件内容实际是384×384的透明PNG编码，扩展名沿用下载文件名。
- 授权：原帖没有声明CC0、MIT、CC-BY或其他开放许可证。本版本仅供本机私人使用，不对外发布或再分发。
- 处理：使用最近邻缩放到192×192并垂直居中放入原生192×208单元；没有对旧高清图进行像素化。六个待机格和其他状态格均以该外部精灵为核心，附加整数像素位移或镜像。来源只有单帧，因此这些状态变化不代表真正的壳片开合连续动画。

该版本已由用户选择的v9外观替代；原始文件、安装备份和ZIP保留。其许可状态仍然不明确。

## 角色图与保留动作

- 原图文件名：Destiny-GhostConstruct.png。
- 文件说明页：https://www.destinypedia.com/File:Destiny-GhostConstruct.png
- 原图：https://destiny.wiki.gallery/images/8/88/Destiny-GhostConstruct.png
- 该图用于旧版本。当前v9不使用它生成图集；旧版本备份保留在工作区，便于回退。
- 更新前图集保存在 `source/ghost-states-v2-static.png`。

Destiny、Ghost 角色及原画权利属于 Bungie 及相应权利方。原图没有被声明为原创或公共领域。此项目为个人桌面使用的同人宠物，不是 Bungie 或 OpenAI 官方产品。

## 旧版连续待机动画

- 作者：Id Vox。
- 标题：Destiny 2 Ghost Idle Animation - Greenscreen。
- 视频：https://www.youtube.com/watch?v=aVk-PQu7zT0
- 上传日期：2021-03-10。
- 本地原视频：`source/reference/ghost-idle-reference.mp4`。
- 下载元数据：`source/reference/ghost-idle-reference.info.json`。
- 作者描述允许免费使用：“Please feel free to use this anywhere you need, it's yours for free!”

这是作者制作的简化三维同人动画，不是官方游戏录像。该素材用于已保留的v6连续APNG版本，不用于当前v9图集；当前开合版本使用上面列出的 v9 原像素纹理分层。

展开静图的研究参考：https://www.destinypedia.com/File:Ghost_shell_open.jpg 。它仅用于理解壳片的前后关系，不能单独确定连续运动轨迹。

## 本地格式依据

本机 Codex 26.1103.7773.0 的版本2图集为1536 × 2288，8列、11行，单元格192 × 208。前9行为行为动画，最后2行为16个视线方向。

只读核对应用加载链后，确认本地加载器保留 PNG 原始字节，显示组件直接使用 CSS `background-image`，原生计时器只切换 `background-position`。v2加载器强制1536×2288，不能通过等比缩小图集减少解码面积。当前v9使用静态PNG；旧v6才使用APNG。待机六格停留1680/660/660/840/840/1920ms，每轮6.6秒；其他动作默认三轮后回到待机。主预览沿用这些计时与退出规则。未修改 Codex 应用程序包。
