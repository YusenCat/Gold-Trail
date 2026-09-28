# 项目结构与模块边界

## 服务端与规则引擎

`apps/server/server.ts` 管本地 HTTP、当前对局会话与命令入口；它把命令交给规则引擎校验，再返回公开视图。存档读写独立在 `apps/server/save-store.ts`。

`packages/rules/src/engine.ts` 是兼容外部调用的命令调度器，规则按领域放在 `packages/rules/src/engine/`：

| 模块 | 职责 |
|---|---|
| `shared.ts` | 角色查找、资源/AP 校验、日志、卡牌与种子随机数、胜负判定等共享规则原语 |
| `lifecycle.ts` | 轮开始、事件/补给、角色回合开始与结束、轮末结算 |
| `movement.ts` | 普通/额外/轮前/受控移动，道路遭遇、阵营技能与契约拾取 |
| `tactics.ts` | 功能牌时机、目标校验、战术牌效果 |
| `economy.ts` | 采矿、兑换、补给、市场、拾取和装备效果 |
| `search.ts` | 官兵稽查、金矿搜寻、私刑收缴、分箱问答和响应结算 |

地图定义、合法动作枚举、AI 决策和初始状态仍分别属于 `map.ts`、`actions.ts`、`bot.ts`、`state.ts`。AI 的押运计划、收缴判断和卡牌时机分别位于 `bot/planning.ts`、`bot/search-policy.ts`、`bot/tactic-policy.ts`；`bot-baseline.ts` 保留旧评分策略供同种子对照。`content/` 提供卡牌、地图与平衡数据；规则逻辑不放在 UI 或 HTTP 路由中。

## 浏览器端

`apps/web/app.js` 负责应用状态、页面导航和对局流程编排。`apps/web/modules/` 通过依赖参数接收状态与回调：

| 模块 | 职责 |
|---|---|
| `api.js` | HTTP 请求、服务端视图合并与命令提交 |
| `board.js` | SVG 棋盘、路线预览、棋子与可达动作呈现 |
| `panels.js` | 决策、操作列表、结果面板 |
| `library.js` | 卡牌图鉴筛选与呈现 |

服务端只允许加载 `app.js`、`styles.css` 和白名单内的 `/modules/*.js` 文件。

## 依赖方向与边界

规则模块通过 `GameCommand` 和 `GameState` 交换状态，外部仍从 `engine.ts` 调用 `startGame` / `applyCommand`。功能间少数依赖是有意的：功能牌可以发起收缴；经济动作会检查阵营技能；轮前移动结束后进入轮次生命周期。

前端模块避免直接导入服务器或规则引擎；界面只提交动作，由服务器返回更新后的状态。组件仍共享应用级状态和 DOM 容器，所以这是一次职责拆分，不是多窗口/多用户状态隔离。服务端当前按本地单对局运行，不提供网络联机、多房间或身份系统。
