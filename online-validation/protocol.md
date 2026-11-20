# 联机验证协议

## 客户端消息

- `list_rooms`: 请求开放大厅列表。
- `create_room`: `{ roomId, roomName, name, clientId }`
- `join_room`: `{ roomId, name }`
- `set_participation`: `{ participation }`
- `set_required_players`: `{ count }`（房主）
- `set_room_lock`: `{ locked }`（房主）
- `chat`: `{ text }`
- `start_game` / `leave_room` / `end_room`
- `submit_commands`: `{ requestId, baseRevision, commands }`
- 重连使用相同 `{ roomId, clientId }` 重新发送 `join_room`，服务端恢复原席位和当前状态。

## 服务端消息

- `room_state`: 房间席位、完整状态和 `revision`。
- `room_list`: 可加入房间及席位占用摘要。
- `lobby_state`: 房间设置、席位在线/参与状态和最近聊天记录。
- `game_resumed`: 原客户端身份重连后的当前对局状态。
- `player_disconnected`: 暂时断线，进入 60 秒重连保留期。
- `left_room` / `room_closed`: 离开或房主结束房间。
- `command_rejected`: 提交级失败，整组命令不执行。
- `turn_result`: 每条命令的 `applied` 或 `skipped` 结果，以及新的状态。
- `player_joined` / `player_left`: 席位变化。
- `error`: 协议或业务错误。

## 权威原则

客户端只提交命令意图。服务器根据当前状态和房间绑定的 `rulesetId` 验证并执行命令，客户端显示服务器返回的状态，不上传击杀、位置结果或胜负结果。
