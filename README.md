<p align="center">
  <img src="https://img.shields.io/badge/python-3.10+-blue" alt="Python">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License">
  <img src="https://img.shields.io/badge/mode-API_|_Claude_Code-orange" alt="Dual Mode">
</p>

# WeChat Skill Chat

**像素级复刻微信 PC 版界面的 AI 聊天应用。支持双模运行：API 直连 + Claude Code 管道。**

导入 skill persona，它就成了你的微信好友——像真人一样聊天、用黄脸表情、读文件、执行命令。私聊 + 群聊，所有对话持久化。

---

## 双模运行

| | API 模式 | Claude Code 模式 |
|---|---|---|
| **原理** | 直接调用 Anthropic 兼容 API | 启动本地 `ccb` 子进程，stream-json 管道通信 |
| **能力** | 纯文本对话 + 文件内容注入 | 完整 CC 能力：读写文件、执行命令、搜索等 |
| **权限** | 无需 | auto / bypassPermissions，设置页动态切换 |
| **启动** | 填 API Key 即可 | 需本地安装 `ccb`（或 `claude`） |
| **适用** | 轻量聊天 | 需要 AI 帮你干活的场景 |

- **CC 模式支持动态权限切换**：auto 和 bypassPermissions 之间随时切，不丢对话上下文
- **原生文件选择器**：CC 模式下点 📄 按钮 → macOS 原生对话框 → 文件/文件夹绝对路径直接填入输入框
- **400 自动恢复**：CC 内部工具拒绝产生的孤儿 tool_use 导致的 API 400 错误，后台自动重试，前端无感知
- **媒体附件**（API 模式）：多文件上传，自动提取 txt/docx/pdf 文本注入上下文

---

## 功能

- **双模切换** — 设置页一键切换 API / CC 模式，CC 模式下检测 CLI 可用性
- **动态权限** — auto（分类器自动决定）和 bypassPermissions（全部放行），设置页实时切换
- **私聊 + 群聊** — 多人群聊，支持 @提及，路由 agent 决定谁回复
- **微信界面** — 55px 导航栏、250px 联系人列表、聊天列表按最新消息排序
- **Skill 即联系人** — 每个 persona 是独立联系人，独立头像、聊天记录
- **对话持久化** — JSON 文件存储，关浏览器再开还在
- **文件附件** — API 模式下读文件内容注入上下文；CC 模式下选绝对路径传给 CC
- **右键菜单** — 复制消息、删除消息
- **表情包** — 微信黄脸表情 PNG，支持 `[捂脸]` `[旺柴]` 等代码

---

## 快速开始

```bash
pip install flask anthropic python-docx PyPDF2
python3 server.py
# 浏览器自动打开 http://localhost:5888
```

### API 模式
1. 设置页填入 API Key、Base URL、Model
2. 导入一个 Skill 文件夹（或直接在 `skills/` 下放 `.md` 文件，在 `skills_config.json` 注册）
3. 开始聊天

### Claude Code 模式
1. 确保 `ccb`（或 `claude`）在 PATH 中
2. 设置页切换到 Claude Code 模式，点「检测」确认可用
3. 权限模式选 `auto`（推荐）或 `bypassPermissions`
4. 开始聊天 — CC 能读文件、跑命令、写代码

---

## Skill 格式

每个 skill 是一个 `.md` 文件放在 `skills/` 目录，内容为 system prompt（角色描述、说话风格、行为规则）。

在 `skills_config.json` 中注册：

```json
{
  "skills": [
    {
      "id": "my_bot",
      "name": "小明",
      "skill_name": "xiaoming",
      "avatar": "avatars/xiaoming.jpg",
      "real_name": "小明"
    }
  ]
}
```

`skill_name` 对应 `skills/` 下的文件名（不含 `.md`）。

---

## 项目结构

```
wechat-skill-chat/
├── server.py              # Flask 入口
├── settings.json          # API Key、模式等配置
├── skills_config.json     # 联系人注册表
├── groups_config.json     # 群聊配置
├── backend/
│   ├── ai.py              # API 模式调用逻辑
│   ├── claude_cli.py      # CC CLI 检测
│   ├── claude_session.py  # CC 持久化子进程管理（stream-json I/O）
│   ├── config.py          # 设置读写
│   ├── history.py         # 聊天记录持久化
│   └── routes/            # Flask 路由
├── skills/                # Skill persona 文件（.md）
├── static/
│   ├── css/style.css
│   ├── js/chat.js         # 私聊前端
│   ├── js/group-chat.js   # 群聊前端
│   ├── avatars/           # 头像图片
│   └── emoji/             # 微信表情 PNG
└── templates/index.html
```

---

## 兼容 API

任何兼容 Anthropic Messages API（`/v1/messages`）的提供商均可使用：Anthropic、DeepSeek、及其他兼容网关。
