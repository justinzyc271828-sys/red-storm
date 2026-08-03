# Red Storm · 红色风暴

版本：v0.8.1

A tiny real-time strategy game dedicated to Simon. Free to play and share.
一款献给 Simon 的即时战略小游戏，免费发布，欢迎分享完整游戏包。

## English

**New in v0.8.1 — Full battlefield sound kit**: 12 new combat and feedback effects
(rifle fire, rocket launch, artillery, flamethrower, infantry steps, harvester engine,
ore unload, construction complete, unit ready, attack warning, victory/defeat stings),
all working even when `index.html` is opened directly from disk.

**New in v0.8.0 — Full English support**: the game launches in your system language
(English by default, 中文 available) and can be switched anytime via Settings → Language
on the title screen.

**Since v0.7.0 — Story Campaign: Three Chapters** (Hard / Ultra Hard): a 53-second opening
cinematic, tactical briefings, in-battle radio chatter and a 40-second finale. Your command
style is classified after Chapter 2, and on Ultra Hard the Chapter 3 enemy secretly adopts
counter-tactics. Sole objective in all three chapters: destroy the enemy Command Center.

### Run

1. Unzip the whole package into a normal folder; do not run inside the zip.
2. Double-click `index.html` — latest Chrome, Edge or Firefox recommended.
3. Click "Enable Sound"; first-time players should start with the Tutorial.

No install, no network, no data upload. If the browser blocks local pages, run
`python -m http.server 8000` in this folder, then open `http://localhost:8000`.

### Controls

- LMB: select / drag-box; click build & production panels or the minimap.
- RMB: move, attack, harvest, unload, set rally point.
- `Z + LMB`: attack-move. Wheel: zoom. `WASD` / arrows / MMB drag / screen edge: camera.
- `Left Alt+1`: all infantry; `Left Alt+2`: all combat vehicles; double-tap to jump to them.
- `P`: pause (auto-pauses when the tab loses focus). `M`: mute all. `Esc`: cancel.
- Win by destroying the enemy Command Center; lose if yours falls.

### Assets

Original design. All artwork was generated with GPT Image; music and sound effects were
generated with Suno under a paid subscription (plus procedurally synthesized audio). The
author holds usage rights for these assets, including public release and commercial use,
under the respective platform terms. The game itself is free — share the complete package.

## 中文

v0.8.1 装载全套战场音效：12 项新战斗与反馈音效（步枪、火箭、火炮、喷火、步兵脚步、
矿车引擎、卸矿、完工、出兵、遇袭警报、胜负音），双击 index.html 直接运行时同样生效。

v0.8.0 完整英文版：游戏跟随系统语言启动（默认英文），标题屏「设置 → 语言」可随时
切换中英双语；包含 v0.7.0 剧情模式三章战役全部内容。

v0.7.0 加入「剧情模式 · 三章战役」：标题页进入，可选 Hard / Ultra Hard。三章战役配有
53 秒开场 CG、战前战术简报、战场无线电台词和 40 秒终局胜败 CG；第二章胜利后后台判定
你的指挥风格，第三章 Ultra Hard 的敌军会针对性采用克制战术。三章唯一胜利目标：
摧毁敌方指挥中心。

v0.6.5 为现有配乐增加了动态“氛围底板”：低频空气与机械层负责重量，极轻的无词和声负责
空间；发展、交战和标题场景会平滑切换，战斗中自动让位给枪炮音效。标题画面的声音设置新增
“氛围厚度”，调到 0% 可以和原声直接 A/B 对比。

v0.6.4 让深层钻探车在选中时用绿色标出已经探索、确实可以展开的采空矿区位置；黑色
未探索区不会被提示泄露。敌方无人机现在严格优先袭击深层开采站、精炼厂与电站，无经济
目标时再追击坦克、步兵或无人机，并尽量绕开已经发现的防御炮塔和火箭兵。无人机可以互相
攻击，遗迹战甲、火箭兵和防御炮塔均可对空，其他普通地面单位仍不能攻击飞行目标。

v0.6.3 修复防御炮塔在 45° 等距视角下转向时“炮头竖起来”的透视错误：炮塔现在按完整
斜前/斜后方向帧切换，不再把一张带透视的炮头图片当俯视图自由旋转；同时更新浏览器缓存
版本，使用专用 2×2 建筑锚点贴合底座，并把遗迹战甲补入游戏内战地图鉴。

v0.6.1 新增「沙暴模式」(标题屏可选开关,默认关):开局 15-23 分钟随机时刻降临大沙暴——
双方小地图被沙雾遮蔽、视野骤缩,地图中部被吹出一座深埋的远古机甲遗迹;派维修车抢先修复
(单人 2 分钟,多人加速)即可唤醒"遗迹战甲"(超重型人形机甲,90 秒后才许攻城),
谁抢到谁就握住决胜钥匙。AI 也会侦察和抢修,小心它先下手。
同时修复"困难难度不够难":困难 AI 前期更会守家、不再无脑换家。

v0.5.0 对局节奏大调(平衡治理):修复"要么几分钟被平推、要么拖成半小时"的两极分化。
AI 前期会留兵守家、更早出喷火战车反制步兵海,快攻要付出代价;指挥中心与电站更结实;
自行火炮更耐打,围攻更能成立;中立矿更值钱,抢中场有回报;龟缩死守会被 AI 的火炮破门。
最想收集的反馈:你赢/输分别在第几分钟?是被平推还是有来有回?哪一刻觉得"稳赢/没法玩了"?

v0.4.2 加入中后期深层经济：矿区自然采空到一定程度后，可由战车工厂生产“深层钻探车”，
驶入枯竭矿区后按 `D` 或点击面板展开为开采站。开采站每 5 秒入账，周围采空越多效率越高；
每方最多两座、同矿区不能堆叠，并持续消耗 35 电力，缺电会完全停产。无人机会优先袭扰
开采站与电站，AI 也会根据已见残骸和矿区价值争夺无人机、发展深层经济，不按时间强制解锁。

v0.4.1 修正新手教学退出流程：教学全程都能立即关闭；完成全部步骤后会短暂显示总结，
并在 4 秒后自动退出，不再要求玩家额外点击“完成并关闭”。

v0.4.0 加入“赤曜战地档案”彩蛋：完整收录敌我兵种、建筑、战场资源、克制关系和
终局勋章，并配有新的 45° 等距像素插画。档案有一个标题页暗门，也有一座藏在地图
远角、需要先探索才能发现的废弃终端；打开档案时战局会自动冻结，关闭后继续。

v0.3.0 加入军团软分离：步兵、火箭兵和作战车辆在行军、追击及接敌时会逐步散开，
不再长期挤在同一坐标；它不是刚性碰撞，因此不会把狭窄通道堵死。胜利或基地陷落后
会显示完整本局战报，包括击毁/损失单位、摧毁/损失建筑、采集资源、生产数量、
经济最高/最低余额、总用时和至多三个本局成就。结算屏必须点击“返回标题”，
空白处和右键不会误重开。

## 开始游戏

1. 先把整个 ZIP 解压到一个普通文件夹，不要直接在压缩包里运行。
2. 双击 `index.html`，推荐使用最新版 Chrome 或 Edge。
3. 点击“开启声音”，第一次试玩请选择“新手教学”。

游戏不需要安装，不需要联网，也不会上传数据。若浏览器阻止打开本地页面，可在本文件夹打开终端并运行：

```text
python -m http.server 8000
```

然后在浏览器访问 `http://localhost:8000`。这是备用方法，只有电脑已安装 Python 时才需要使用。

## 核心操作

- 左键：点选、框选单位；点击建造栏、生产栏或小地图。
- 右键：移动、攻击、采矿、卸矿或设置集结点。
- `Z + 左键`：攻击移动。
- `左 Alt+1`：选择全部步兵和火箭兵。
- `左 Alt+2`：选择全部作战车辆，不包含矿车。
- 快速连续按两次同一兵种快捷键：将镜头移到该兵种。
- 滚轮：向前看细节，向后拉到战略视野。
- `WASD`、方向键、中键拖动或屏幕边缘：移动镜头。
- `P`：暂停或继续；手动暂停时只用 `P` 或左键恢复，右键不会误恢复。
- 切到其他标签页会自动暂停，回到游戏后自动继续。
- `M`：全部静音；`Esc`：取消当前操作。
- 选中己方建筑：左上角可以取消施工或回收建筑。
- 矿车只会自动寻找已探索矿脉；先派作战单位侦察黑色区域。
- 坠毁无人机只能用维修车修复；无人机可以互相攻击，遗迹战甲、火箭兵和防御炮塔可对空。
- 矿区大量采空后生产深层钻探车；选中它会显示绿色可展开区，驶入后按 `D` 或点击“展开”。
- 深层开采站每方最多两座；缺电时完全停产，保护开采站与电站同样重要。
- 部队会自动保持基本间距；狭窄地形仍允许穿行，不需要逐个拆分重叠单位。
- 胜负结算会统计本局战绩并颁发成就，数据只保存在当前这一局，不会联网。

## 第一次试玩目标

不看开发说明、不让别人现场指导，尝试完成以下事情：

1. 建造电站、兵营或战车工厂，并生产一批部队。
2. 使用右键和 `Z + 左键` 指挥部队。
3. 至少坚持到第一次敌军进攻，最好完成一整局。

试玩后只需要反馈三件事：能否独立启动、第一次卡在哪里、最终胜负和大约游玩时长。

## 素材说明

本游戏为原创设计。全部视觉素材由 GPT Image 生成；音乐与音效素材由 Suno 付费会员
期间生成（另含程序合成音效）；作者已按各平台服务条款取得上述素材的使用权，包括
公开发布与商用授权。游戏本体免费发布，欢迎分享完整游戏包。
