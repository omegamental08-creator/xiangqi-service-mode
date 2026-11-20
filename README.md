# 象棋兵役模式（Xiangqi Service Mode）

> ## ⚠️ 未经测试 / UNTESTED — 请勿当作可玩成品
>
> **这个仓库里的东西大部分处于实验状态。** 规则在反复推翻重写，AI 行为不稳定，
> 大量机制只跑过一两次手测，崩过一次的地方可能又崩。作者本人对当前版本的可靠性
> 不做任何承诺。把它当草稿箱，不要当发布版。
>
> 具体哪些部分测过、哪些完全没测，见下面「测试现状」一节。

一个把「兵营生产 + 地形 + 海运 + 空战 + 多国外交」塞进中国象棋的玩法原型。
核心形式是一份单文件 HTML，浏览器直接打开就能下；规则文档、AI 对手、联机校验
三部分各自独立演进。

---

## 怎么玩（最快路径）

```
直接用浏览器打开 chess_service_final.html
```

不需要安装、不需要服务器、不需要联网。

> ⚠️ **必须保持 `chess_service_final.html` 与 `ai/` 目录同层**：HTML 里用
> `<script src="ai/chess_barracks_ai.js">` 相对路径引用 AI 脚本，单独下载 HTML 放到别处会
> 导致 AI 脚本 404（对局本身仍可下，但 AI 功能不可用）。
> 只想要单文件？把 `ai/chess_barracks_ai.js` 一并下载并在旁边建 `ai/` 目录即可。

两个可选功能需要额外的本地服务，不用就留空：

- **外部 AI 接口**：默认留空，自动使用内置离线 AI；填 `http://127.0.0.1:8091/move` 之类才会外连
- **联机大厅**：会打开 `http://127.0.0.1:8080`，需要另跑 `online-validation/`（或 `xiangqi-service-mode/server.mjs`）

## 仓库结构

```
chess_service_final.html        主程序（约 400 KB 单文件：规则 + 界面），依赖同层 ai/
tests/pao.test.mjs              「炮」相关规则的单测（node tests/pao.test.mjs）
ai/                             独立 AI 实现 + 浏览器回归 + LLM 桥接实验
xiangqi-service-mode/           规则内核拆分版（ESM 模块 + 关系编辑器 + Electron 壳）
online-validation/              联机校验原型（node + ws，服务端校验规则）
match/                          对局自动化脚本（CDP 驱动 Chrome）
docs/rules/                     规则文档、关系图谱、测试报告、审阅记录
docs/rules/graph/               兵营规则图谱（按主题拆的十几个小条目）
```

## 玩法概要（会变，别背）

- 象棋底子：车马炮象士兵将，走法基本照旧
- **兵营与生产**：棋子从兵营出，兵营有等级和产能
- **地形与地图**：不同格地形影响通行与战斗
- **海战 / 空战**：额外兵种线，需要单独的规则文档（见 docs/rules）
- **外交与轮换**：多国之间的临时同盟、棋子轮换、狂热残局等特殊状态

完整规则在 `docs/rules/象棋兵营模式完整规则.md`；关系图谱在 `docs/rules/graph/`。
**注意：规则文档与代码实现经常不同步**，以代码里的实际判定为准，发现不一致请记 issue。

## 测试现状（诚实版）

| 模块 | 有没有自动化测试 | 实际状态 |
|---|---|---|
| 炮的走法/吃子 | 有（`tests/pao.test.mjs`） | 跑得通，覆盖面窄 |
| 规则内核（`xiangqi-service-mode/core`） | 有（`rules.test.mjs`、`relations.test.mjs`） | 只覆盖拆出来的那部分 |
| 主程序 `chess_service_final.html` | **无** | 全靠人肉试玩，绝大多数机制只跑过一两次 |
| AI（`ai/chess_barracks_ai.js`） | 有单测 + 浏览器回归脚本 | AI 仍会走非法动作，见 `ai/AI非法动作报错.md` |
| LLM 桥接（`ai/llm_bridge.mjs`） | 有实验脚本 | 实验性质，未稳定 |
| 联机校验（`online-validation/`） | 有冒烟脚本 | 只验证过协议能跑通，没做过真实双人对战 |

结论：**除了明确列出的单测，其它一律视为未验证。**

## 已知问题

- AI 偶发非法动作（记录见 `ai/AI非法动作报错.md`）
- 规则文档与实现有出入，尚未系统对齐
- 主程序是单文件大 HTML，改起来容易互相踩，尚无拆分计划
- 联机校验只做了协议层，没做完整对局校验
- 无版本号体系，靠文件名时间戳区分（历史备份没进这个仓库）

## 路线图（想到就写，不承诺）

1. 规则内核与主程序统一（现在有两套逻辑）
2. AI 合法性守卫：任何动作先过规则内核再提交
3. 联机校验接入主程序
4. 主程序拆模块（至少把规则与渲染分开）

## 运行单测

```bash
node tests/pao.test.mjs
node xiangqi-service-mode/core/rules.test.mjs
node xiangqi-service-mode/core/relations.test.mjs
```

## 许可

暂未选定许可证（作者保留所有权利）。要引用或二次分发请先联系作者。
