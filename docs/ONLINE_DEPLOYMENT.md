# 公网部署准备（4.0开发中）

当前阶段已实现public模式的请求边界、私密邀请和公开房间列表；换设备和公网验收仍按开发规划推进。不要将本页理解为4.0已经发布。

## 配置

| 变量 | 含义 |
| --- | --- |
| `GAME_MODE=public` | 公网房间服务，任何连接均不能调用本地对局、教学、存档或统计接口 |
| `GAME_PUBLIC_ORIGIN` | 唯一HTTPS站点，例如`https://game.example.com`；没有路径、查询或凭证，必须与浏览器站点一致 |
| `PORT` | 平台分配的内部监听端口；默认4173 |
| `GAME_SAVE_DIR` | 必须位于持久磁盘，包含房间及统计恢复文件；容器默认`/data/saves` |
| `GAME_ROOM_DIR` | 可选房间目录，默认位于`GAME_SAVE_DIR/rooms`，也必须持久化 |
| `GAME_TRUSTED_PROXIES` | 可选明确代理IP列表，以逗号分隔；仅用于限流来源识别，不授予任何权限 |

公网Host必须匹配配置地址，写入请求Origin必须匹配同一HTTPS站点。不信任`X-Forwarded-Host`／`X-Forwarded-Proto`来生成地址或授予本机权限。代理应保留原Host并只从HTTPS入口转发游戏请求。Node内部端口不要直接开放到公网。

健康检查为`GET /api/health`，不包含玩家或本地游戏状态，可使用平台内部Host。公网Cookie为HttpOnly、SameSite=Strict、Secure，游戏客户端和API需由同一站点提供。

## 托管Node服务

使用Node.js24或本仓库Dockerfile，启动`node apps/server/server.ts`；不使用Windows桌面启动器。设置上表变量，绑定持久目录。先获取平台分配的HTTPS域名，再设置`GAME_PUBLIC_ORIGIN`，不能填写本机地址。

实例数为1；现有JSON恢复文件不支持多实例共享写入。更新部署会断开SSE，客户端重新连接，房间恢复后等待全员在线再继续。代理支持长连接并关闭事件流缓冲。

## 已有服务器：Docker＋Caddy

将域名解析到服务器，使用仓库`deploy/compose.yaml`。服务器需已经安装Docker Compose，80和443端口用于该域名。`GAME_DOMAIN`为纯主机名（无协议／路径），例如`game.example.com`。

```sh
GAME_DOMAIN=game.example.com docker compose -f deploy/compose.yaml up -d --build
```

只发布Caddy的80／443端口，app在内部网络提供服务；Caddy自动处理HTTPS并立即刷新事件流。模板使用`172.30.50.0/24`内部子网，部署前确认不与服务器已有网络冲突；如调整子网，须同步调整Caddy固定IP和app的受信代理IP。

游戏数据、证书与代理配置使用独立命名卷。更新镜像保留这些卷；备份需包含game-data，不能用清空卷作为重启方式。恢复后核对房间席位、骰点、决策阶段、资源与收据，再继续对局。

## 当前验证边界

公网请求边界、loopback代理隔离、错误Host／Origin、Secure Cookie、2／4人建房与原局域网接口已通过Node测试。当前开发机没有Docker，容器构建和Caddy证书尚未实测；尚未提供真实公网主机，因此跨网络手机验收仍未完成。正式发布前必须完成容器运行、持久卷恢复和不同网络对局验收。
