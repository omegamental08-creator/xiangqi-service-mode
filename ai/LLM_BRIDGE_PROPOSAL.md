# 小模型接入「象棋兵役模式」——方案 + 待审阅清单
（2026-10-13 凌晨，浪浪猫整理；**下载模型前需要同志审阅**）

## 1. 接口现状（Codex 已写好，我读过了）

文件：`ai/chess_barracks_ai.js`（v1.1.0，协议 `chess-barracks-ai/v1`）

- `RuleBasedAI`：脚本 AI，三档难度（easy/normal/hard）+ 可调权重表（`defaultWeights`）。
- `ExternalAIAdapter`：**外部 AI 的接入点**。
  - POST 到指定 endpoint，body 为
    `{ protocol, player, state, legalActions, requestId }`
  - 期望响应里带 `action`（必须是 `legalActions` 里的某一个）
  - 默认超时 **12s**，失败自动回退脚本 AI（并触发 `onExternalError`）
- 游戏页面：`chess_service_final.html` 里已加载该脚本，并在房间设置里有输入框
  「**外部AI接口（可留空，留空时自动使用离线AI）**」→ 存到 `G.ai.externalEndpoint`
  （placeholder 是 `http://127.0.0.1:8091/move`）。
- 还看到 `ai.trainedWeights` / `matchId` 这些字段，说明后续"学习结果回灌"的位置也预留了。

## 2. 我今晚已经做好的（不含模型）

`ai/llm_bridge.mjs` —— 本地桥接服务（零依赖，Node 原生 http + fetch）：

```
游戏页面 --POST--> llm_bridge(127.0.0.1:8091) --HTTP--> Ollama(127.0.0.1:11434)
```

- 接收请求 → 把局面压成紧凑文本 + 给候选走法编号 → 调本地模型**约束输出** `{"index":n,"reason":"..."}` → 按编号取回原 `action` 返回。
- 自带 CORS（含 OPTIONS 预检），失败/超时返回 `action:null` 让游戏回退脚本 AI。
- 每次决策写日志 `ai/logs/llm-decisions.jsonl`（候选数、选中、理由、耗时、模型），第一次真实请求会留档原始 payload 到 `ai/logs/payloads/`（便于按真实 schema 微调压缩逻辑）。
- `MOCK=1` 时随机挑步，专门用来验证链路——**已跑通**：
  - `GET /` 返回 `{ok:true,...}`
  - OPTIONS 预检返回 `Access-Control-Allow-Origin: *`
  - POST 返回 `{"action":{...},"meta":{...}}`，日志正常写入。

运行方式：
```powershell
cd "C:\Users\mentalOmega\Desktop\象棋兵营模式设计\ai"
node llm_bridge.mjs                                  # 真模型
$env:MOCK='1'; node llm_bridge.mjs                   # 只测链路
# 可调：PORT / OLLAMA_URL / OLLAMA_MODEL / TIMEOUT_MS / TEMP
```

## 3. 模型候选（**请审阅后我再下载**）

全部走 Ollama（已装、已在跑），Q4 量化、CPU 可跑；本机 16GB 内存 / 无独显：

| 模型 | 体积(约) | 定位 |
|---|---|---|
| **Qwen3 4B** | 2.6 GB | **首选**：中文与指令跟随好，JSON 稳，速度可接受 |
| Qwen2.5 3B Instruct | 1.9 GB | 最快，做速度对照 |
| Qwen2.5 7B Instruct | 4.7 GB | 质量更高，CPU 慢（单步可能十几秒） |
| Gemma 3 4B | 3.3 GB | 备选对照（换一家风格） |
| Qwen2.5-Coder 7B | 4.7 GB | 留给"让 AI 写规则/棋子"那条线 |

建议先下 **3B + 4B** 两个做对照（合计约 4.5GB，D 盘还有 104GB），跑通再补 7B。
（下载走 Ollama 官方 registry；校园网速度未知，我可以先 HEAD 测一下再下。）

## 4. 明天的对战设计（草案）

- 对照组：① 脚本 hard vs 脚本 normal（基线）② 脚本 hard vs 小模型 ③ 小模型 vs 小模型（不同温度） ④ 小模型 + 脚本候选 top-5（混合）
- 每局固定随机种子，同一局面重复 N 次取平均；先跑 20~50 局
- 指标：胜率、平均决策耗时、超时回退率、非法步率（应恒为 0）、吃将军率
- ⚠️ **超时**：CPU 推理单步可能 3~15s，而适配器默认 12s → 建议先把外部 AI 超时提到 **25~30s**（改 `createController` 的 spec 或 UI 上加一个超时输入框），否则会被反复判定超时回退

## 5. 需要同志拍板的四件事

1. **下载哪几个模型**（我不会擅自下载）
2. 服务端口 **8091** 行不行
3. 日志/留档放 `ai/logs/` 行不行
4. 要不要我改那个 **12s 超时**（或做成 UI 可配）
