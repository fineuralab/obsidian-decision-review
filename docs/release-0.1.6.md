# Decision Review 0.1.6 · 决策复盘助手（桌面预览版）

在 Obsidian 中记录当时的选择与理由，回访实际结果，保留更正历史，并生成独立经验笔记。简体中文 / English；数据保存在笔记库的 Markdown 文件中，无账号、联网或 AI 服务依赖。

本次仅通过 GitHub 发布，未提交 Obsidian 社区插件目录。

## 安装

1. 下载本页附件 **`decision-review-0.1.6.zip`** 并解压。
2. 将 `decision-review` 文件夹复制到 `<你的库>/.obsidian/plugins/`。
3. 确认 `main.js`、`manifest.json` 和 `styles.css` 直接位于该目录。
4. 完整重载 Obsidian，在「设置 → 第三方插件」中启用 **Decision Review**。

升级前先复制尚未保存的输入。替换运行文件后必须完整重载一次 Obsidian，以清除旧版仍在内存中的表单和回调。正常记录无需迁移，更新不移动既有数据。

## 本版修复

- 停用后，旧表单拒绝继续保存并保留输入；重新启用后需要打开新表单。
- 旧实例的延迟设置请求不能覆盖新实例的数据目录，或重新接管命令。
- 启动时打开工作台或笔记会等待宿主工作区就绪，避免打开面板失败。

详见 [复查记录](https://github.com/fineuralab/obsidian-decision-review/blob/0.1.6/docs/bug-audit-0.1.6.md)。

## 验证与范围

- 81 项自动测试、严格 TypeScript 检查与构建通过。
- 87 组原生 Obsidian 回归及 4 组安装包实装检查通过。
- 源码 ZIP 在干净目录中安装、测试和构建通过；构建结果与安装包逐字节一致。
- 实测环境：macOS、Obsidian 1.8.7。最低声明版本为 Obsidian 1.8.7，仅支持桌面；Windows、Linux 和更新宿主版本尚未完成原生验收。

`decision-review-0.1.6-source.zip` 和 GitHub 自动生成的 Source code 归档用于开发，需要先构建。直接安装请使用上面的安装 ZIP。运行三件套也作为独立附件提供；`SHA256SUMS.txt` 校验安装与源码 ZIP。

## English

Decision Review records why you chose something, revisits outcomes and saves lessons as independent Markdown notes. Chinese and English interfaces; local vault storage with no account, network service or AI provider required.

Download **`decision-review-0.1.6.zip`**, unzip it into `<vault>/.obsidian/plugins/`, fully reload Obsidian and enable **Decision Review**. Copy unsaved input before upgrading; existing records need no migration.

Version 0.1.6 blocks old forms and settings requests after disabling the plugin, prevents an obsolete instance from overwriting the current folder or commands, and waits for the workspace before opening views during startup.

This is a **desktop preview**, tested on macOS with Obsidian 1.8.7. It passed 81 automated tests, 87 native regression checks, four actual-package installation checks and a clean source build. Windows, Linux and newer host versions have not completed native acceptance testing. This release is distributed through GitHub and has not been submitted to the Obsidian community directory.

MIT license. See `THIRD-PARTY-NOTICES.txt` for the bundled YAML parser's ISC license.
