# 0.1.6 验收记录

日期：2026-11-04。范围：正式插件。本轮修复见 [停用与重载复查记录](bug-audit-0.1.6.md)，此前见 [0.1.5 检查记录](bug-audit-0.1.5.md)、[0.1.4 检查记录](bug-audit-0.1.4.md)、[0.1.3 检查记录](bug-audit-0.1.3.md)、[0.1.2 检查记录](bug-audit-0.1.2.md) 和 [0.1.1 检查记录](bug-audit-0.1.1.md)。

## 环境与隔离

- macOS 上的真实 Obsidian 1.8.7，单独的临时应用配置与笔记库。
- Node.js 22，严格 TypeScript 检查；依赖通过锁文件完成干净安装。
- Python Playwright 经本机 CDP 连接该测试实例，任何操作前都核对库目录及 `decision-review-test-` 前缀。
- 临时记录、故障注入、清理、重载及界面截图均发生在该独立库，未使用日常笔记库。

## 自动化：81 项通过

运行：`npm test`；类型检查：`npm run typecheck`；构建：`npm run build`。

测试代码位于 `tests/domain.test.ts`、`tests/codec.test.ts`、`tests/store.test.ts`、`tests/audit-regression.test.ts`、`tests/safety-regression.test.ts`、`tests/relocation.test.ts`、`tests/visibility.test.ts`、`tests/import-regression.test.ts`、`tests/commit-recovery.test.ts` 和 `tests/lifecycle.test.ts`。

覆盖：

- 月末、闰年、跨年和夏令时的自然日加法；本地到期状态及 UTC 跨日时间的本地日期显示。
- 原始快照与后续修订隔离；同日多次回访排序；补记不回溯改变最新安排。
- 回访更正保留原文，不更改参照版本或后续安排。
- 格式版本、日期、唯一 ID、版本引用、路径及 URL 校验。
- Markdown / YAML 往返、BOM / CRLF、自由笔记原样保留、缺失或重复标记、YAML 重复键。
- 中英语言选择、用户内容原样插入、有效 URL 和 Unicode 文件链接。
- 文件重建、外部编辑冲突、原子写入冲突、创建失败重试、源文件删除。
- 写入成功但刷新失败的处理、异常文件缓存禁写、重复决定 ID 禁写。
- 经验已创建但源索引失败后的恢复、不覆盖同名普通文件、经验移动后的恢复。
- 资料改名时表单安全更新、演示标记与目录一致性、重复载入不覆盖、清除演示保留普通文件。
- 移到回收站保留资料和独立经验、切换目录不搬迁旧数据。
- 经验副本失败重试、历史日期更正、超限写入前保护、循环 YAML 禁止索引、目录失败状态通知。
- 含分隔标记的多行说明与资料标签仍可往返读取；写入前拒绝歧义分隔；中英文多行用户字段、自由笔记与经验正文保持可读；已改名文件缺少类型属性时显示错误并禁止覆盖。

- 目录切换排队期间和正在读取期间的旧创建、更新与移到回收站请求均停止；不重建旧目录、不写到新范围、不改变原文件。

- 拒绝隐藏数据目录；目录名中的普通点号和 Unicode 继续可用；旧引用不被改写；不可用目录保留禁写快照，恢复有效目录后解除保护。

- 导入枚举严格校验；跨时区与相同时间戳的更正正文不遗漏、不重复；独立经验按真实时间排序。
- 实际提交后丢失确认时，新建、回访、经验写入、来源索引和移到回收站的重试不重复操作，不覆盖普通资料。
- 停用后的旧表单及存储操作拒绝写入；读取期间停用时，创建、更新、移到回收站和重命名不提交后续修改。设置持久化跨实例保持顺序，启动读取等待已发出的写入，失败不会阻塞后续请求，不同笔记库独立排队。

## 真实 Obsidian 验收

`scripts/native-acceptance.py` 的完整主流程通过：

1. 空状态打开，真实表单创建决定，选择库内文件，阻止非 HTTP(S) URL，快捷键保存。
2. 主动选择回访评价，保存后离开到期队列但保留当前详情。
3. 保存独立经验 Markdown，并验证其来源决定及回访。
4. 更正回访，保留旧文字，不改写已保存经验。
5. 更正原记录，切换版本对照，首次记录不变。
6. 表单已打开时改名资料，当前与历史路径更新，输入保留且可继续保存。
7. 外部编辑后拒绝旧表单，输入保留，放弃需要明确确认。
8. 注入一次磁盘写入失败，表单保留；恢复后重试只保存一次回访。
9. 同一天多次回访显示最新结果；补充、结束与重新开启均保留历史。
10. 删除资料显示失效；切换英文不改写决定文件。
11. 整应用重载后恢复决定、修订、回访、安排、自由笔记和经验。
12. 深浅主题与窄面板可用，360px 浏览器下实际插件容器约 316px，仍能搜索、切换及保存回访。
13. 主流程未出现未捕获的 JavaScript 页面错误。

`scripts/native-edge-acceptance.py` 另行通过：回访默认聚焦实际结果；目录变更后旧表单拒绝保存；损坏文件显示已标注的旧快照并禁写，修复后恢复；重复 ID 阻止两份副本；清除演示保留真实记录和无标记文件，新示例按所选语言生成。

`scripts/native-state-acceptance.py` 通过：所有回访来源锚点被 Obsidian 索引；键盘可打开更多菜单，Escape 返回焦点；切换到经验笔记再重载，工作台保留搜索、选择、已展开历史及阅读位置。

`scripts/native-audit.py` 的 9 组断言通过：更正和补充资料的回访匹配、经验标题与来源名称搜索、保存期间资料改名仍保持控件锁定、保存失败后恢复控件、经验副本重试不重复、历史回访日期更正保留原安排，以及目录失败显示错误并清空旧列表。

`scripts/native-safety-acceptance.py` 的 7 组断言通过：真实表单保存含分隔标记的更正说明、重载保留原始与更正文字、已改名文件丢失类型属性后保留禁写快照并显示路径、新会话仍报告损坏文件、修复后恢复操作、原有决定和经验逐字节不变、无未捕获页面错误。旧版 0.1.1 在前四组断言失败，0.1.2 全部通过。

`scripts/native-relocation-acceptance.py` 的 13 组断言通过：连续目录改名、设置保存延迟、引用写入中再移动、设置写入暂时及持续失败、旧草稿禁写并保留输入、目录和关联持久化、重载后恢复、迁移后可继续编辑、迁移期间用户主动选择目录优先，以及其他笔记逐字节不变。0.1.2 在原 11 组核心检查中的 8 组失败；0.1.3 全部通过。

`scripts/native-visibility-acceptance.py` 的 15 组断言通过：拒绝根目录及嵌套隐藏路径、存储层阻止隐藏写入、大小写及索引外现有文件碰撞保护、旧隐藏配置持续提示实际路径、源文件字节不变、启动时打开面板等待布局、移回可见目录后恢复、Unicode 与普通点号目录重载、恢复后编辑、活动目录进入隐藏位置后跨重载暂停写入、恢复后解除保护，以及其他文件保持不变。0.1.3 在原 12 组检查中的 4 组失败。

`scripts/native-import-acceptance.py` 的 13 组断言通过：列表型回访枚举按文件报错且禁写、冷重载仍报告错误、修复后保留原状态；跨时区及同时间戳的 Markdown 正文包含全部更正各一次，界面最新回访与 YAML 原文保持正确；经验按实际时间排列；其他笔记逐字节不变。0.1.4 在其中 7 组断言失败，0.1.5 全部通过。

`scripts/native-lifecycle-acceptance.py` 的 9 组断言通过：停用后旧表单拒绝保存并保留输入；重新启用后旧草稿仍无效，新表单可用；延迟完成的旧设置请求不能覆盖新实例目录或重新接管命令；直接调用停用实例的设置请求被拒绝；整应用重载保持当前配置及记录；既有决定、经验及普通笔记逐字节不变，无未捕获页面错误。0.1.5 在其中 6 组断言失败。

本版共通过 87 组原生回归断言，另有下述 4 组安装包实装检查。

## 视觉检查

已查看真实界面的浅色、深色、英文、窄面板及窄窗口回访截图。深色检查等待宿主实际进入 theme-dark，背景计算色为 rgb(30, 30, 30)。测量的浏览器宽度为 1,280 / 900 / 760 / 460 / 360px，插件与详情均无水平溢出。

- [浅色工作台](screenshots/native-workspace-light.png)
- [深色工作台](screenshots/native-workspace-dark.png)
- [英文工作台](screenshots/native-workspace-en.png)
- [窄面板](screenshots/native-workspace-narrow.png)
- [窄窗口回访](screenshots/native-review-narrow.png)

## 安装包检查

`npm run package` 使用白名单打包：

```text
decision-review/
  main.js
  manifest.json
  styles.css
  LICENSE
  THIRD-PARTY-NOTICES.txt
```

打包脚本检查三个版本元数据一致、运行文件为普通文件、ZIP CRC 正确、全部归档内容与构建文件逐字节一致，生成 SHA-256 清单。源码 ZIP 使用明确的目录及扩展名白名单，排除依赖、输出、临时库和个人配置。

已通过 `scripts/native-package-acceptance.py` 将安装 ZIP 的五个文件解包到独立测试实例，重载后创建新决定、保存并结束回访，再重载读取结果并通过确认移到库内回收站；原有决定和经验保留。另以实际界面验证 UTC 时间跨日时按本地自然日显示。

源码归档通过 `scripts/verify-release.py` 的干净安装、81 项测试与构建检查，生成的运行三件套与安装 ZIP 逐字节一致。SHA-256 清单匹配，两份归档不包含依赖、临时库或个人配置。检查结果汇总保存在本地 `output/`，不进入安装包。

## 重现原生检查

1. 执行 `npm run build` 和 `node scripts/setup-test-vault.mjs`，取得新临时库与配置目录。
2. 用该配置启动独立 Obsidian，例如 macOS：

   ```sh
   /Applications/Obsidian.app/Contents/MacOS/Obsidian --user-data-dir=<上一步的 profile> --remote-debugging-port=9248
   ```

3. 在装有 Python Playwright 的环境中先运行 `scripts/native-lifecycle-acceptance.py`，再依次运行 `scripts/native-acceptance.py`、`scripts/native-edge-acceptance.py`、`scripts/native-state-acceptance.py`、`scripts/native-audit.py`、`scripts/native-safety-acceptance.py`、`scripts/native-relocation-acceptance.py`、`scripts/native-visibility-acceptance.py` 和 `scripts/native-import-acceptance.py`。首次启动如出现信任提示，确认的是这个独立测试库中的本插件。
4. 完整主流程要求空测试库。`--reset` 只用于重置同一个有前缀校验的临时验收库；`--capture-only` 仅重拍布局。

原生边界脚本当前包含 macOS 应用版本读取，其他系统需调整此环境检查。未进行 Windows / Linux 的原生验收，移动端未验收。同步冲突需要用户先解决，本版不自动合并多设备编辑。
