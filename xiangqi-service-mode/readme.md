# 象棋兵役模式

基于《象棋兵役模式规则梳理.docx》的 1.0 原型。默认规则是经典 9x10 棋盘、纯陆战、双人对战；网页端和 Electron 桌面端共同使用 `core/rules.mjs`，不复制规则。

## 运行

```powershell
cd xiangqi-service-mode
npm install
npm test
npm run web
npm run desktop
```

网页默认地址：`http://localhost:5173`。

## 1.0 核心边界

- 开局棋盘只有将和两名士；车、马、象、炮进入双方生产区；每方五个兵营进入部署库存。
- 将席是双方各自底线中央的 2x2 核心区域。将军在将席内解锁兵营部署；将军在中心点可生产士。
- 河流是实体地形。将、士、象、兵营具备水性；象在河岸可消耗一步搭桥，车炮借己方桥梁过河。
- 士在将席内可直走或斜走，将席外直走一格；士拥有以己方同线棋子为轴的跳子行动。
- 马保留绊马脚，支持常规形态、部署形态、自爆和兵营直接生产部署马。
- 每回合一步，每方每回合最多一次主动攻击；吃掉敌方将军即获胜。
- 生产区清空后，淘汰区才可无步数轮换回生产区；将、兵营不参与轮换，士按规则进入淘汰池。

## 架构

- `core/rules.mjs`：纯状态转换内核。`initialState()` 建立状态，`legalActions()` 生成行动，`applyAction()` / `applyProduction()` 执行行动，`rotatePools()` 处理轮换。
- `core/rules.test.mjs`：核心规则测试，客户端不参与测试，保证网页和桌面共享同一规则。
- `web/`：仅负责渲染状态、选择行动和展示战报，不自行判断棋子规则。
- `electron-main.mjs`：桌面壳，加载同一份 `web/index.html`。
- `core/contracts.mjs`：版本化行动、存档格式和扩展契约。
- `core/map.mjs`：经典地图与未来自定义地图的统一描述接口。
- `core/extensions.mjs`：海战、空战、寄生棋子、多国战争的注册入口。
- `docs/architecture.md`：架构边界、版本策略和下一步路线。

## 扩展接口

`GameState.extensions` 预留 `naval`、`aerial`、`parasites` 等模块。通过 `registerModeExtension(state, name, extension)` 注册扩展；扩展应提供自己的状态字段、行动生成器和结算器，在核心行动边界上叠加，不直接篡改核心胜负、攻击次数和回合数据。后续自定义棋盘应使用独立地图描述，避免把 9x10 显示层写死进规则内核。

海战、空战、多国战争和寄生棋子暂不作为 1.0 默认规则启用。
