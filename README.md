# Nekobot for DeepSeek Harness

Nekobot 的 DSH 原生角色扮演工作台。从 DSH 侧边栏打开 **Nekobot**，进入角色会话、角色卡和世界书的完整界面。

## 使用

1. 在侧栏的「角色卡」中新建角色，上传 PNG/JPEG/WebP/GIF 立绘（最大 4 MB）或填写 https 图片地址，也可以导入 Nekobot JSON/ZIP、酒馆 V2/V3 JSON/PNG。
2. 在「世界书」中编辑关键词、内容、常驻规则、优先级和注入位置，再到角色卡中勾选关联。
3. 在首页选择角色并「开始对话」。左侧切换会话，中间使用 DSH 原生聊天与输入框，右侧展示立绘、角色设定和关联世界书。
4. 角色资料中的「设置」可调整当前会话的称呼与绑定；「记忆」管理当前角色在本会话中的记忆。Agent 通过 `nekobot_character_*`、`nekobot_worldbook_*`、`nekobot_memory_*` 工具共用这套数据。
5. 会话顶部可重命名、置顶或删除；删除会移除该会话的 Nekobot 绑定与记忆，并归档对应的 DSH 会话。资料栏可直接打开对应角色卡与世界书。记忆支持编辑，离开未保存的页面时会提示确认。

角色卡和世界书共用一个持久库；绑定、记忆按会话隔离。模型、流式回复与工具执行使用 DSH 的现有配置。

## Agent 工具

Agent 可用以下 DSH 工具直接维护角色库；所有写入与工作台共用同一持久数据，界面会读取到最新结果。

| 工具 | 作用 |
| --- | --- |
| `nekobot_character_list` / `nekobot_character_get` | 列出角色摘要、读取单张角色卡完整设定 |
| `nekobot_character_save` | 省略 `id` 新建，提供 `id` 时只更新提交的字段 |
| `nekobot_character_delete` | 删除角色卡（仍被会话绑定时返回 `inUse`） |
| `nekobot_worldbook_list` / `nekobot_worldbook_get` | 列出世界书摘要、分页读取条目（可按关键词过滤） |
| `nekobot_worldbook_save` / `nekobot_worldbook_delete` | 新建或局部更新世界书、删除世界书 |
| `nekobot_worldbook_entry_save` / `nekobot_worldbook_entry_delete` | 不改整本世界书，只增改或删除单条条目 |
| `nekobot_memory_list` / `nekobot_memory_save` / `nekobot_memory_delete` | 管理当前会话、当前绑定角色的记忆 |
| `nekobot_preview` | 预览当前角色提示词、命中的世界书条目和最终注入文本 |
| `nekobot_library` | 旧版通用入口，保留给既有会话和自动化调用 |

`nekobot_*_save` 新建时省略 `id`；更新时只提交要改的字段，未提交的字段保持原值（角色卡的世界书关联、六维关系和世界书条目都按此规则合并）。`nekobot_worldbook_save` 提交 `entries` 会整体替换条目，只改单条时用 `nekobot_worldbook_entry_save`。角色卡立绘只向模型返回 https 地址或 `hasAvatar`，不返回 base64 数据；世界书条目正文超过 20000 字时读取结果会截断并标记。

界面支持简体中文、繁体中文、英文、日文、韩文，跟随宿主主题，窄屏收起侧栏并将角色资料显示为抽屉。语言可在工作台右上角切换。

界面的工作台组织参考 [DS Bot](https://github.com/Fei2411/DS-Bot)，实现使用 DSH 的原生侧栏、全局面板和 Conversation Factory 扩展接口。

## 安装

已验证 DSH Desktop **0.2.1-rc.3** 的同版本宿主环境。

桌面版可在插件管理器中安装本目录或构建后的 `dist/dsh-nekobot-0.1.0.tgz`。安装完成后重新启动 DSH。

Web profile 可用：

```powershell
dsh plugin --profile web add ./dsh-nekobot-0.1.0.tgz
```

源码本地开发安装时先执行 `pnpm install`、`pnpm build`，再安装本目录。目录安装链接源码位置；请保留该目录。

## 当前范围

- 支持角色设定、立绘上传或图片 URL、标签、开场白参考、示例对话、规则和附加提示词。上传的立绘显示在角色列表、资料栏、开聊页和对话侧栏。
- 世界书按当前用户消息、最近对话和常驻规则匹配，并按优先级与字数预算筛选。
- 支持角色设定前后、注记前后的提示词段。按历史深度插入暂未接入；导入时保留该位置并提示调整。
- 选择性触发、概率、冷却等高级字段会保留，当前匹配器使用关键词与常驻规则。
- 导出为带版本的 Nekobot 插件角色库 JSON，可再次导入；本格式包含角色和世界书。
- 导入文件上限 12 MB。未知扩展字段保留，角色卡中的脚本不执行。
- 当前记忆由用户或 Agent 工具维护。自动记忆抽取、六维关系演化、剧情分支图及完整 Android 数据归档迁入尚未接入。
- 开场白在空会话与配置页预览，并供模型参考；开始对话后空会话预览收起。
- 新分支会话需要独立绑定角色；记忆不会从原会话自动复制。
- 删除会话只移除 Nekobot 绑定和该会话记忆，并归档对应的 DSH 会话；DSH 不提供会话日志的物理删除接口，归档后的原始记录仍保留在 DSH 的归档列表中，可手动恢复（恢复后成为普通 DSH 会话，不再带 Nekobot 绑定）。

## 验证

```powershell
pnpm check
$env:DSH_DESKTOP_EXE = 'D:\dsh-desktop\DeepSeek Harness.exe'
pnpm test:integration
pnpm pack --pack-destination dist
```

集成验证使用临时 profile，测试与界面共用的认证 API、无会话加载、创建角色会话、CRUD、工具操作、提示词组装、会话隔离和进程重启恢复；不会发起模型请求。界面交互测试覆盖工作台加载、角色开聊、世界书编辑、会话重命名与置顶、记忆编辑和未保存内容保护。同版本 DSH 原生渲染器测试另行覆盖会话目录同步、会话引用生命周期、空会话开场白与输入区布局，以及聊天、记忆、设置之间的切换。临时数据路径在测试结束时输出。

许可证沿用 Nekobot Android 的 GPL-3.0；原始图标随本插件提供。依赖许可证见 `THIRD_PARTY_LICENSES.txt`。
