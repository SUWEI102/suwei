# 腾讯云 MySQL 异地灾备

## 架构

- 正式域名：`https://www.tuzhuzu.cn`
- 应用托管：Vercel / v0，代码仓库 `SUWEI102/suwei`
- 实时主库：Neon PostgreSQL（唯一业务写入源）
- 异地灾备：腾讯云 CynosDB for MySQL 8.0，数据库 `suwei_rental`
- 调度：Vercel Cron 每日北京时间 02:00（UTC 18:00）
- 保留：90 天

应用不会双写业务明细。每次备份先从 Neon 生成一致的完整恢复包，再使用 gzip 压缩和 AES-256-GCM 加密，最后写入腾讯云表 `suwei_backup_snapshots`。腾讯云不可用不会阻断正式站业务。

## 灾备范围

恢复包包含客户、合同、设备、账单、收款、资金流水、租赁事件、退租、丢失、买断、续租、合同快照、客户门户和系统设置。

认证部分包含正式账户资料、Better Auth 密码哈希和客户门户密码哈希。恢复包明确排除登录会话、session token、access token、refresh token、验证码和任何明文密码。

## Vercel 环境变量

在 Production、Preview、Development 环境中配置：

- `DATABASE_URL`：Neon PostgreSQL 连接地址
- `BETTER_AUTH_SECRET`：Better Auth 会话签名密钥
- `TENCENT_MYSQL_URL`：腾讯云 MySQL TLS 连接地址
- `TENCENT_BACKUP_KEY`：64 位十六进制 AES-256 密钥；必须离线保存
- `TENCENT_MYSQL_CA`：可选，腾讯云专用 CA PEM；未设置时使用系统可信 CA
- `CRON_SECRET`：保护每日备份接口

变量格式模板见 `tencent-cloud.env.template`。真实值不得提交到 GitHub。

## 腾讯云要求

1. 开启公网连接和 SSL。
2. 应用账号仅授权 `suwei_rental` 数据库的建表、查询、插入、更新和删除权限。
3. 安全组开放实例公网端口；生产环境建议使用 Vercel Static IP 白名单，不建议长期使用 `0.0.0.0/0`。
4. 保持腾讯云实例自身的自动备份和 binlog 开启。

## 备份与恢复

- 手动备份：正式站“版本与备份”页面创建备份，同时保存 Neon 快照和腾讯云加密副本。
- 自动备份：`GET /api/cron/tencent-backup`，仅接受 Vercel `CRON_SECRET` Bearer 授权。
- 恢复前必须先创建 `pre-restore` 快照。
- 腾讯云恢复通过备份接口指定 `source: "tencent"` 和 `snapshotId`，先预览校验摘要，再输入“确认恢复”。
- 恢复时校验格式、版本、所属账户和 SHA-256；所有业务表和密码哈希在同一 Neon 事务中恢复。

## 故障排查

- `ECONNRESET`：检查腾讯云公网连接、访问白名单、安全组和 SSL 设置。
- `ER_ACCESS_DENIED_ERROR`：检查 `suwei_app` 密码、账号主机范围和数据库授权。
- TLS 证书错误：下载腾讯云 CA PEM 并配置 `TENCENT_MYSQL_CA`。
- 备份密钥丢失：历史密文无法恢复；因此必须把 `TENCENT_BACKUP_KEY` 保存到独立密码管理器，不能只存在 Vercel。

## 安全边界

GitHub 只保存代码、变量名、模板、架构与恢复手册，不保存真实连接字符串、密码、密钥、证书私钥、客户资料或备份文件。任何已经出现在聊天、截图或提交历史中的密码必须立即轮换。
